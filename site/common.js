export async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(path, { ...options, signal: controller.signal, cache: 'no-store',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
    let result;
    try { result = await response.json(); }
    catch { throw new Error('안내를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    if (!response.ok) throw new Error(result.error || '요청을 처리하지 못했어요. 다시 시도해 주세요.');
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('연결이 원활하지 않아요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    throw error;
  } finally { clearTimeout(timeout); }
}
export function showError(node, message) { node.textContent = message; node.hidden = !message; }
export function formValue(form) {
  const values = Object.fromEntries(new FormData(form));
  return { ...values, party: Number(values.party || 1), consent: values.consent === 'on' };
}
export function dateLabel(start) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long',
    day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(start));
}
export function currentMonth() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());
}
export function makeElement(tag, text = '', className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
const menuButton = document.querySelector('.fc-menu-toggle');
menuButton?.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!isOpen));
  menuButton.innerHTML = `${isOpen ? '메뉴 열기' : '메뉴 닫기'} <span aria-hidden="true">${isOpen ? '＋' : '−'}</span>`;
  document.querySelector('.fc-nav').classList.toggle('is-open', !isOpen);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') { menuButton.click(); menuButton.focus(); }
});
export const configuration = api('/foxcave/api/config').catch(() => ({ isPreview: false, isAcceptingRequests: false }));
const search = document.querySelector('#faq-search');
search?.addEventListener('input', () => {
  const query = search.value.trim().toLocaleLowerCase('ko');
  let count = 0;
  document.querySelectorAll('[data-faq-item]').forEach((item) => {
    const matches = item.textContent.toLocaleLowerCase('ko').includes(query);
    item.hidden = !matches; count += Number(matches);
  });
  document.querySelector('#faq-count').textContent = `${count}개의 답변`;
  document.querySelector('#faq-empty').hidden = count > 0;
});
const chatToggle = document.querySelector('.fc-chat-toggle');
const chatPanel = document.querySelector('#chat-panel');
function setChatOpen(isOpen) {
  chatToggle.setAttribute('aria-expanded', String(isOpen));
  chatPanel.hidden = !isOpen;
}
chatToggle?.addEventListener('click', () => setChatOpen(chatToggle.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('click', (event) => {
  if (chatToggle?.getAttribute('aria-expanded') === 'true' && !event.target.closest('.fc-chat')) setChatOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && chatToggle?.getAttribute('aria-expanded') === 'true') { setChatOpen(false); chatToggle.focus(); }
});
const topButton = document.querySelector('.fc-top');
const TOP_BUTTON_OFFSET = 700;
if (topButton) {
  const syncTopButton = () => topButton.classList.toggle('is-on', window.scrollY > TOP_BUTTON_OFFSET);
  window.addEventListener('scroll', syncTopButton, { passive: true });
  topButton.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  syncTopButton();
}
