// 로컬에서 ?live=1로 연 작업 화면만 갱신한다. 공개 홈페이지에서는 실행하지 않는다.
const IS_LOCAL = ['127.0.0.1', 'localhost'].includes(location.hostname);
const IS_LIVE = new URLSearchParams(location.search).get('live') === '1';
const SCROLL_KEY = `yeougul-preview-scroll:${location.pathname}`;
const RELOAD_INTERVAL = 2000;
let originalHtml = '';
let isChecking = false;
let hasEditedForm = false;

async function checkPreview() {
  if (document.hidden || hasEditedForm || isChecking) return;
  isChecking = true;
  try {
    const response = await fetch(location.href, { cache: 'no-store' });
    if (!response.ok) throw new Error(`미리보기 응답 ${response.status}`);
    const nextHtml = await response.text();
    if (originalHtml && originalHtml !== nextHtml) {
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
      location.reload();
    }
    originalHtml = nextHtml;
  } catch (error) { console.warn('미리보기 갱신을 다음 확인 때 다시 시도합니다.', error.message); }
  finally { isChecking = false; }
}

if (IS_LOCAL && IS_LIVE) {
  const savedScroll = Number(sessionStorage.getItem(SCROLL_KEY) || 0);
  if (savedScroll) window.addEventListener('load', () => window.scrollTo({ top: savedScroll, behavior: 'instant' }), { once: true });
  sessionStorage.removeItem(SCROLL_KEY);
  document.addEventListener('input', () => { hasEditedForm = true; }, { once: true });
  document.querySelectorAll('a[href^="/"]').forEach(anchor => {
    const target = new URL(anchor.href, location.origin);
    if (target.origin !== location.origin) return;
    target.searchParams.set('live', '1');
    anchor.href = target.href;
  });
  checkPreview();
  setInterval(checkPreview, RELOAD_INTERVAL);
}
