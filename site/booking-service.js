// Public deployment URL only. Email recipients and credentials stay in Apps Script.
let configuration;
let lastAttempt;
let lastInquiryAttempt;
const ATTEMPT_KEY = 'foxcave-booking-attempt-v1';
const INQUIRY_ATTEMPT_KEY = 'foxcave-inquiry-attempt-v1';
const CONNECTION_ERROR = '접수 결과를 확인하지 못했어요. 이미 접수되었을 수 있으니 입력 내용을 그대로 두고 다시 신청해 주세요. 같은 신청은 중복 접수되지 않습니다.';
function uncertainError() { const error = new Error(CONNECTION_ERROR); error.uncertain = true; return error; }

async function endpoint() {
  if (!configuration) {
    configuration = fetch('/site/booking-config.json', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('예약 설정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
        const { webAppUrl } = await response.json();
        if (!webAppUrl) throw new Error('온라인 예약을 준비하고 있어요. 카카오톡이나 전화로 문의해 주세요.');
        const url = new URL(webAppUrl);
        const localTest = ['localhost', '127.0.0.1'].includes(location.hostname)
          && ['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:';
        if (!localTest && !(url.origin === 'https://script.google.com' && /^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname))) {
          throw new Error('예약 연결을 확인 중입니다. 카카오톡이나 전화로 문의해 주세요.');
        }
        return url.href;
      }).catch((error) => { configuration = undefined; throw error; });
  }
  return configuration;
}

async function request(action, payload, params = {}) {
  const url = new URL(await endpoint());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const options = { signal: controller.signal, credentials: 'omit', redirect: 'follow' };
    if (payload) {
      options.method = 'POST';
      // A simple CORS request: Apps Script has no OPTIONS handler.
      options.headers = { 'Content-Type': 'text/plain;charset=UTF-8' };
      options.body = JSON.stringify({ ...payload, action, version: 1, origin: location.origin });
    } else {
      url.searchParams.set('action', action);
      Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
      url.searchParams.set('_', Date.now());
    }
    const response = await fetch(url, options);
    if (!response.ok || response.type === 'opaque') throw new Error('unreadable-response');
    const result = await response.json();
    if (result.service !== 'foxcave-booking' || result.version !== 1 || typeof result.ok !== 'boolean') throw new Error('invalid-response');
    if (!result.ok) {
      const error = new Error(result.error || '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
      error.serverResponse = true;
      error.uncertain = result.code === 'INTERNAL';
      throw error;
    }
    return result;
  } catch (error) {
    if (error.serverResponse) throw error;
    if (payload) throw uncertainError();
    throw new Error('일정을 불러오지 못했어요. 잠시 후 일정을 다시 확인하거나 카카오톡으로 문의해 주세요.');
  } finally { clearTimeout(timeout); }
}

export async function loadSlots(month) {
  const result = await request('slots', null, { month });
  if (!Array.isArray(result.slots) || !Number.isFinite(Date.parse(result.updatedAt))) throw new Error('일정 응답을 확인하지 못했어요. 다시 확인해 주세요.');
  return result;
}

export async function submitBooking(values) {
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values)))))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (!lastAttempt) {
    try { lastAttempt = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY)); } catch { /* Storage may be disabled. */ }
  }
  if (lastAttempt?.digest !== digest || !/^[0-9a-f-]{36}$/.test(lastAttempt?.id || '')) {
    lastAttempt = { digest, id: crypto.randomUUID() };
    try { sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(lastAttempt)); } catch { /* In-memory retries still work. */ }
  }
  const result = await request('submit', { ...values, requestId: lastAttempt.id });
  if (result.receipt?.id !== lastAttempt.id || result.receipt?.status !== 'received'
    || !Number.isFinite(Date.parse(result.receipt.start)) || !Number.isInteger(result.receipt.party)
    || !Number.isInteger(result.receipt.duration)) throw uncertainError();
  return result.receipt;
}

export async function checkInquiryService() {
  const result = await request('health');
  if (!Array.isArray(result.capabilities) || !result.capabilities.includes('inquiry')) {
    throw new Error('온라인 문의를 준비하고 있어요. 카카오톡이나 전화로 문의해 주세요.');
  }
}

export async function submitInquiry(values) {
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values)))))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (!lastInquiryAttempt) {
    try { lastInquiryAttempt = JSON.parse(sessionStorage.getItem(INQUIRY_ATTEMPT_KEY)); } catch { /* Storage may be disabled. */ }
  }
  if (lastInquiryAttempt?.digest !== digest || !/^[0-9a-f-]{36}$/.test(lastInquiryAttempt?.id || '')) {
    lastInquiryAttempt = { digest, id: crypto.randomUUID() };
    try { sessionStorage.setItem(INQUIRY_ATTEMPT_KEY, JSON.stringify(lastInquiryAttempt)); } catch { /* In-memory retries still work. */ }
  }
  const result = await request('inquiry', { ...values, requestId: lastInquiryAttempt.id });
  if (result.receipt?.id !== lastInquiryAttempt.id || result.receipt?.status !== 'received'
    || result.receipt?.kind !== values.kind) throw uncertainError();
  return result.receipt;
}
