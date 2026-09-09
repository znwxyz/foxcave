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

// 홈 히어로 배너. 자동으로 넘기되 사용자가 손대면 멈춘다.
const HERO_INTERVAL = 5500;
document.querySelectorAll('[data-hero]').forEach((banner) => {
  const track = banner.querySelector('[data-hero-track]');
  const slides = [...banner.querySelectorAll('.fc-slide')];
  const dots = [...banner.querySelectorAll('[data-hero-go]')];
  if (slides.length < 2) return;

  const stillPreferred = matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let timer = null;
  let stopped = false;

  const show = (next) => {
    current = (next + slides.length) % slides.length;
    track.style.transform = `translateX(-${current * 100}%)`;
    slides.forEach((slide, index) => { slide.toggleAttribute('aria-hidden', index !== current); });
    dots.forEach((dot, index) => {
      if (index === current) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  };
  const stopAuto = () => { clearInterval(timer); timer = null; };
  const startAuto = () => {
    stopAuto();
    if (stopped || stillPreferred.matches) return;
    timer = setInterval(() => show(current + 1), HERO_INTERVAL);
  };
  // 화살표나 점을 누른 뒤에는 자동 넘김을 다시 켜지 않는다.
  const goByUser = (next) => { stopped = true; stopAuto(); show(next); };

  banner.querySelector('[data-hero-prev]').addEventListener('click', () => goByUser(current - 1));
  banner.querySelector('[data-hero-next]').addEventListener('click', () => goByUser(current + 1));
  dots.forEach((dot) => dot.addEventListener('click', () => goByUser(Number(dot.dataset.heroGo))));
  banner.addEventListener('mouseenter', stopAuto);
  banner.addEventListener('mouseleave', startAuto);
  banner.addEventListener('focusin', stopAuto);
  banner.addEventListener('focusout', startAuto);
  // 다른 탭을 보는 동안에는 넘기지 않는다.
  document.addEventListener('visibilitychange', () => (document.hidden ? stopAuto() : startAuto()));
  stillPreferred.addEventListener('change', startAuto);

  // 좁은 화면에서는 손가락으로 옆으로 밀어 넘긴다.
  let touchX = null;
  banner.addEventListener('touchstart', (event) => { touchX = event.changedTouches[0].clientX; }, { passive: true });
  banner.addEventListener('touchend', (event) => {
    if (touchX === null) return;
    const moved = event.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(moved) > 45) goByUser(current + (moved < 0 ? 1 : -1));
  }, { passive: true });

  show(0);
  startAuto();
});
