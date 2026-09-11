const DEFAULT_ROTATION_INTERVAL_MS = 5000;
const SWIPE_THRESHOLD_PX = 45;
const SWIPE_DIRECTION_RATIO = 1.2;

function rotationControls(root, next) {
  const configuredInterval = Number(root.dataset.carouselInterval);
  const rotationInterval = Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : DEFAULT_ROTATION_INTERVAL_MS;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let isPaused = motion.matches;
  let isInView = true;
  let timer = null;
  const restart = () => {
    clearInterval(timer);
    timer = null;
    if (!isPaused && isInView && !document.hidden) timer = setInterval(next, rotationInterval);
  };
  const pause = (value = true) => {
    isPaused = value;
    root.dataset.paused = String(isPaused);
    restart();
  };
  root.addEventListener('focusin', () => pause());
  root.addEventListener('focusout', (event) => {
    if (!root.contains(event.relatedTarget)) pause(motion.matches);
  });
  document.addEventListener('visibilitychange', restart);
  motion.addEventListener('change', () => pause(motion.matches || root.contains(document.activeElement)));
  new IntersectionObserver(([entry]) => {
    isInView = entry.isIntersecting;
    restart();
  }, { threshold: 0 }).observe(root);
  pause(isPaused);
  return { restart, pause };
}

function enableSwipe(root, move, restart) {
  let start = null;
  root.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || event.target.closest('button')) { start = null; return; }
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  root.addEventListener('touchcancel', () => { start = null; }, { passive: true });
  root.addEventListener('touchend', (event) => {
    if (!start) return;
    const deltaX = event.changedTouches[0].clientX - start.x;
    const deltaY = event.changedTouches[0].clientY - start.y;
    start = null;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_DIRECTION_RATIO) return;
    move(deltaX < 0 ? 1 : -1);
    restart();
  }, { passive: true });
}

function initCarousel(root) {
  const slides = [...root.querySelectorAll('[data-carousel-slide]')];
  const dots = [...root.querySelectorAll('[data-carousel-dot]')];
  if (slides.length < 2) return;
  let current = 0;
  const show = (index) => {
    if (!Number.isInteger(index)) return;
    current = (index + slides.length) % slides.length;
    slides.forEach((slide, position) => {
      slide.classList.toggle('is-current', position === current);
      slide.setAttribute('aria-hidden', String(position !== current));
      slide.inert = position !== current;
    });
    dots.forEach((dot, position) => {
      if (position === current) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    root.dataset.currentSlide = String(current);
  };
  const move = (offset) => show(current + offset);
  const rotation = rotationControls(root, () => move(1));
  root.querySelector('[data-carousel-prev]')?.addEventListener('click', () => { move(-1); rotation.restart(); });
  root.querySelector('[data-carousel-next]')?.addEventListener('click', () => { move(1); rotation.restart(); });
  dots.forEach((dot) => dot.addEventListener('click', () => { show(Number(dot.dataset.carouselDot)); rotation.restart(); }));
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    rotation.pause();
    move(event.key === 'ArrowRight' ? 1 : -1);
  });
  enableSwipe(root, move, rotation.restart);
  const controls = root.querySelector('.hero-controls');
  if (controls) controls.hidden = false;
  show(0);
}

document.querySelectorAll('[data-carousel]').forEach(initCarousel);
