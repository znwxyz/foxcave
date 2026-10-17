// Run through playwright-cli with `npm run test:serve` running.
// Hold schedule responses to inspect loading, failure and recovery without Google calls.
async (page) => {
  const context = await page.context().browser().newContext();
  const passed = [];
  const errors = [];
  const now = '2026-10-17T17:00:00+09:00';
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const slot = (time, isAvailable = true) => {
    const start = '2026-10-20T' + time + ':00+09:00';
    return { id: start, start, duration: 90, maxParty: 2, isAvailable };
  };
  const slots = [slot('19:00'), slot('20:30')];
  const fixture = async ({ holdScript = false, mobile = false } = {}) => {
    const tab = await context.newPage();
    tab.setDefaultTimeout(15000);
    await tab.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    tab.on('pageerror', error => errors.push(error.message));
    await tab.clock.install({ time: new Date(now) });
    await tab.clock.pauseAt(new Date(now));
    const pending = [];
    const requests = [];
    let waiting;
    const wait = () => pending.length ? Promise.resolve() : new Promise(resolve => { waiting = resolve; });
    await tab.route('http://127.0.0.1:4174/exec**', route => {
      requests.push(route.request().method());
      pending.push(route);
      waiting?.(); waiting = null;
    });
    let scriptArrived;
    const scriptRequest = new Promise(resolve => { scriptArrived = resolve; });
    if (holdScript) await tab.route('**/site/booking.js?*', route => scriptArrived(route));
    await tab.goto('http://127.0.0.1:4173/booking/', { waitUntil: holdScript ? 'commit' : 'domcontentloaded' });
    const respond = async (resultSlots = slots, status = 200) => {
      await wait();
      await pending.shift().fulfill({ status, json: { service: 'foxcave-booking', version: 1, ok: true, slots: resultSlots, updatedAt: now } });
      await tab.locator('#calendar-loading').waitFor({ state: 'hidden' });
    };
    const startScript = async () => {
      // The parser reaches this footer script before it can finish the page.
      await tab.locator('#booking-form').waitFor();
      const scriptRoute = await scriptRequest;
      await scriptRoute.continue();
      await wait();
    };
    if (!holdScript) await wait();
    return { tab, wait, respond, startScript, requests, pending };
  };
  const checkLoading = async (tab) => {
    assert(await tab.locator('#calendar-loading').isVisible(), 'Show the central loading notice');
    assert(await tab.locator('#calendar-grid').getAttribute('aria-busy') === 'true', 'Announce the busy calendar');
    assert(await tab.locator('#calendar-unavailable').isHidden(), 'Do not show failure while loading');
    assert(await tab.locator('.fc-calendar-day:not(:disabled)').count() === 0, 'Dates cannot be selected before the response');
    assert(await tab.locator('.fc-calendar-day.has-slot').count() === 0, 'Do not show old availability');
    const labels = await tab.locator('.fc-calendar-day small').allTextContents();
    assert(labels.every(text => text === ''), 'Unknown dates must not look closed or available');
    assert(await tab.locator('#calendar-retry').isDisabled(), 'Avoid duplicate refresh clicks');
    assert(await tab.locator('#month-next').isDisabled() && await tab.locator('#month-prev').isDisabled(), 'Hold month navigation during a request');
    assert(await tab.locator('#booking-form [type=submit]').isDisabled(), 'Do not submit while checking availability');
  };
  const ready = tab => tab.locator('#calendar-stage[data-state=ready]').waitFor();
  try {
    let current = await fixture({ holdScript: true });
    let tab = current.tab;
    await tab.locator('#calendar-loading').waitFor();
    await checkLoading(tab);
    await current.startScript();
    await checkLoading(tab);
    await tab.getByRole('textbox', { name: '이름 필수' }).fill('로딩 중 입력');
    await tab.locator('.fc-chat-toggle').click();
    assert(await tab.locator('#chat-panel').isVisible(), 'Contact remains usable while loading');
    await tab.keyboard.press('Escape');
    await tab.locator('.fc-calendar-panel').screenshot({ path: 'output/playwright/booking-loading-actual-desktop.png' });
    await current.respond(); await ready(tab);
    assert(await tab.locator('.fc-calendar-day.has-slot').count() === 1, 'Show authoritative availability after loading');
    assert(await tab.getByRole('textbox', { name: '이름 필수' }).inputValue() === '로딩 중 입력', 'Keep form input through loading');
    passed.push('initial HTML and delayed script/API show loading without false availability; input and contact remain usable');

    await tab.locator('#month-next').click(); await current.wait();
    await checkLoading(tab);
    assert(await tab.locator('#calendar-month').textContent() === '2026년 11월', 'Show the month being fetched');
    await current.respond([]); await ready(tab);
    assert((await tab.locator('.fc-calendar-day small').allTextContents()).every(text => text === '마감'), 'Only a successful empty response closes every date');
    assert((await tab.locator('#calendar-message').textContent()).includes('열린 일정이 없어요'), 'Explain a genuinely empty month');
    assert(await tab.locator('#calendar-unavailable').isHidden(), 'Empty schedule is not a connection error');
    passed.push('month navigation shows loading, then distinguishes a successful empty month');
    await tab.close();

    current = await fixture(); tab = current.tab;
    await current.respond(); await ready(tab);
    await tab.locator('.fc-calendar-day.has-slot').click();
    await tab.locator('.fc-slot-option').first().click();
    await tab.getByRole('textbox', { name: '이름 필수' }).fill('입력 유지 확인');
    await tab.getByRole('textbox', { name: '휴대폰 번호 필수' }).fill('01000000000');
    await tab.getByRole('checkbox', { name: /개인정보/ }).check();
    await tab.locator('#calendar-retry').click(); await current.wait();
    await checkLoading(tab);
    assert(await tab.locator('.fc-slot-option').count() === 0, 'Hide old time options while refreshing');
    const requestCount = current.requests.length;
    await tab.evaluate(() => {
      document.querySelector('#booking-form').requestSubmit();
      document.querySelector('#calendar-retry').dispatchEvent(new Event('click'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await tab.clock.runFor(1000);
    assert(current.requests.length === requestCount && !current.requests.includes('POST'), 'Ignore parallel refresh and synthetic submit while loading');
    await current.respond([slot('19:00', false), slot('20:30')]); await ready(tab);
    assert(await tab.locator('[name=slotId]').inputValue() === '', 'Clear a selection that has since closed');
    assert((await tab.locator('#form-error').textContent()).includes('접수 상태가 바뀌었어요'), 'Explain a changed selection');
    assert(await tab.getByRole('textbox', { name: '이름 필수' }).inputValue() === '입력 유지 확인', 'Preserve personal input when availability changes');
    assert(await tab.locator('.fc-slot-option:not(:disabled)').count() === 1, 'Only the fresh available time can be selected');
    passed.push('refresh hides stale availability, preserves form values and blocks duplicate reads or stale submissions');

    await tab.locator('#calendar-retry').click(); await current.wait();
    await current.respond([], 503);
    assert(await tab.locator('#calendar-unavailable').isVisible(), 'Failed response replaces the spinner with retry guidance');
    assert(await tab.locator('#calendar-grid').getAttribute('aria-busy') === 'false', 'Failure ends the busy state');
    assert((await tab.locator('.fc-calendar-day small').allTextContents()).every(text => text === ''), 'Failure must not falsely close dates');
    assert(await tab.locator('#calendar-retry').isEnabled(), 'Retry is available after failure');
    assert(await tab.locator('#booking-form [type=submit]').isDisabled(), 'Unknown availability cannot be submitted');
    await tab.locator('#calendar-retry').click(); await current.wait(); await checkLoading(tab);
    await current.respond(); await ready(tab);
    assert(await tab.locator('#calendar-unavailable').isHidden(), 'Successful retry clears the failure notice');
    assert(await tab.getByRole('textbox', { name: '이름 필수' }).inputValue() === '입력 유지 확인', 'Keep personal input through failure and retry');
    passed.push('failed refresh shows an unknown state and recovers on retry without losing input');
    await tab.close();

    current = await fixture(); tab = current.tab;
    await tab.clock.runFor(45001);
    await tab.locator('#calendar-unavailable').waitFor();
    assert(await tab.locator('#calendar-loading').isHidden(), 'Timeout must not leave a permanent spinner');
    assert(await tab.locator('#calendar-retry').isEnabled(), 'Timeout allows retry');
    passed.push('45-second timeout exits loading and offers retry');
    await tab.close();

    current = await fixture({ mobile: true }); tab = current.tab;
    await tab.emulateMedia({ reducedMotion: 'reduce' });
    await checkLoading(tab);
    assert(await tab.locator('.fc-calendar-spinner').evaluate(node => getComputedStyle(node).animationName) === 'none', 'Respect reduced-motion preferences');
    assert(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile loading must fit the viewport');
    await tab.locator('.fc-calendar-panel').screenshot({ path: 'output/playwright/booking-loading-actual-mobile.png' });
    await current.respond(); await ready(tab);
    assert(await tab.locator('.fc-calendar-day.has-slot').count() === 1, 'Mobile availability appears after loading');
    passed.push('390px mobile loading fits the screen and respects reduced motion');
    assert(errors.length === 0, 'Unexpected JavaScript exceptions: ' + errors.join(', '));
    return { passed: passed.length, checks: passed, javascriptErrors: errors };
  } finally { await context.close(); }
}
