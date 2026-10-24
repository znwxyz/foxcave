import { formValue, showError } from './common.js?v=20261019c';
import { checkInquiryService, submitInquiry } from './booking-service.js?v=20261024-2';

const form = document.querySelector('#inquiry-form');
const errorNode = document.querySelector('#form-error');
const button = form.querySelector('[type=submit]');
const connection = document.querySelector('#inquiry-connection');
const retry = document.querySelector('#inquiry-connect-retry');
const state = { ready: false, connecting: false, submitting: false, completed: false, pendingValues: null };
const fields = [...form.querySelectorAll('input, select, textarea, button')];
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
form.elements.desiredDate.min = today;
if (new URLSearchParams(location.search).get('kind') === 'question') {
  form.elements.kind.value = 'question';
  form.elements.party.value = '';
}
function renderKind() {
  const lecture = form.elements.kind.value === 'lecture';
  form.elements.party.required = lecture;
  document.querySelector('#inquiry-party-required').textContent = lecture ? '필수' : '선택';
}
async function connect() {
  if (state.connecting || state.submitting || state.completed || state.pendingValues) return;
  state.connecting = true; state.ready = false;
  button.disabled = true; retry.disabled = true; retry.hidden = true;
  connection.textContent = '문의 접수 연결을 확인하고 있어요.';
  try {
    await checkInquiryService();
    state.ready = true; button.disabled = false;
    connection.textContent = '';
  } catch {
    connection.textContent = '온라인 문의에 연결하지 못했어요. 잠시 후 다시 확인하거나 카카오톡·전화로 문의해 주세요.';
    retry.hidden = false;
  } finally { state.connecting = false; retry.disabled = false; }
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.ready || state.submitting || state.completed) return;
  showError(errorNode, '');
  if (!state.pendingValues && !form.reportValidity()) return;
  const values = state.pendingValues || { ...formValue(form), party: form.elements.party.value === '' ? null : Number(form.elements.party.value) };
  values.name = values.name.trim(); values.phone = values.phone.replace(/[\s-]/g, '');
  values.organization = values.organization.trim(); values.message = values.message.trim();
  if (!values.name || !values.message) { showError(errorNode, '이름과 문의 내용을 입력해 주세요.'); return; }
  if (!/^01[016789]\d{7,8}$/.test(values.phone)) { showError(errorNode, '휴대폰 번호를 확인해 주세요.'); form.elements.phone.focus(); return; }
  state.submitting = true;
  fields.forEach(field => { field.disabled = true; });
  form.setAttribute('aria-busy', 'true');
  button.textContent = '문의를 접수하고 있어요';
  try {
    const receipt = await submitInquiry(values);
    state.completed = true; state.pendingValues = null;
    document.querySelector('#inquiry-receipt-number').textContent = receipt.id;
    document.querySelector('#inquiry-receipt-kind').textContent = receipt.kind === 'lecture' ? '기업·기관 단체 강의 문의' : '일반 문의·희망 일정 상담';
    document.querySelector('#inquiry-confirmation-message').textContent = receipt.kind === 'lecture'
      ? '남겨주신 연락처로 상담 연락을 드릴게요. 강의 일정과 비용은 상담 후 확정됩니다.'
      : '내용을 확인한 뒤 남겨주신 연락처로 답변드릴게요.';
    form.hidden = true;
    const confirmation = document.querySelector('#inquiry-confirmation');
    confirmation.hidden = false;
    confirmation.focus();
    confirmation.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    showError(errorNode, error.message);
    state.pendingValues = error.uncertain ? values : null;
    fields.forEach(field => { field.disabled = Boolean(state.pendingValues); });
    button.disabled = false;
    button.textContent = state.pendingValues ? '같은 문의 다시 확인하기 ▸' : '문의 남기기 ▸';
  } finally { state.submitting = false; form.removeAttribute('aria-busy'); }
});
form.elements.kind.addEventListener('change', renderKind);
retry.addEventListener('click', connect);
renderKind(); connect();
