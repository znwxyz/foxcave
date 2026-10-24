// Run through playwright-cli: run-code --filename tests/inquiry-browser-checks.js
// Requires `npm run test:serve`; all Google services and emails stay in memory.
async (page) => {
  page.setDefaultTimeout(15000);
  const base = 'http://127.0.0.1:4173';
  const passed = []; const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const data = async () => (await page.request.get(base + '/__test/state')).json();
  const reset = async (options = {}, path = '/inquiry/') => {
    await page.request.post(base + '/__test/reset', { data: options });
    await page.goto(base + path);
  };
  const ready = () => page.waitForFunction(() => !document.querySelector('#inquiry-form [type=submit]').disabled);
  const field = name => page.locator('#inquiry-form [name="' + name + '"]');
  const fill = async (lecture = true) => {
    await field('name').fill('문의 브라우저 테스트');
    await field('phone').fill('010-0000-0000');
    await field('message').fill('일정과 비용을 상담하고 싶습니다.\n실제 발송 없는 로컬 검증입니다.');
    if (lecture) {
      await field('organization').fill('테스트 기관');
      await field('party').fill('30');
      const future = new Date(Date.now() + 14 * 86400000);
      await field('desiredDate').fill(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(future));
    }
    await field('consent').check();
  };
  const submit = () => page.locator('#inquiry-form [type=submit]').click();
  const success = () => page.locator('#inquiry-confirmation').waitFor({ state: 'visible' });
  const retry = () => page.getByRole('button', { name: '같은 문의 다시 확인하기 ▸' }).waitFor();

  await reset({ missingConfig: true });
  await page.locator('#inquiry-connect-retry').waitFor({ state: 'visible' });
  assert(await page.locator('#inquiry-form [type=submit]').isDisabled(), 'Missing URL must disable submission');
  assert((await data()).requests.length === 0, 'No fallback API when configuration is absent');
  passed.push('missing configuration stays closed');

  await reset({ mode: 'old-deployment' });
  await page.locator('#inquiry-connect-retry').waitFor({ state: 'visible' });
  assert(await page.locator('#inquiry-form [type=submit]').isDisabled(), 'Old backend must not accept inquiry');
  assert((await data()).requests.every(r => r.method !== 'POST'), 'No POST to unsupported backend');
  await page.request.post(base + '/__test/reset', { data: {} });
  await page.locator('#inquiry-connect-retry').click(); await ready();
  passed.push('old deployment gate and reconnect after upgrade');

  await submit();
  assert((await data()).inquiries.length === 0, 'Required fields must not submit');
  await fill(); await field('phone').fill('123'); await submit();
  await page.getByText('휴대폰 번호를 확인해 주세요.', { exact: true }).waitFor();
  await field('phone').fill('01000000000'); await field('party').fill('201'); await submit();
  assert((await data()).requests.every(r => r.method !== 'POST'), 'Invalid fields must not make a POST');
  passed.push('required fields, phone and lecture party validation');

  await reset({ mode: 'slow' }); await ready();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fill();
  const slotsBefore = (await data()).slots.slots;
  await page.locator('#inquiry-form').screenshot({ path: 'output/playwright/inquiry-desktop.png' });
  await submit();
  await page.locator('#inquiry-form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await success();
  let state = await data();
  assert(state.inquiries.length === 1 && state.mails.length === 1 && state.rows.length === 0, 'One inquiry and email, no booking');
  assert(state.requests.filter(r => r.method === 'POST').length === 1, 'Double click makes one POST');
  assert(state.requests.every(r => r.method !== 'OPTIONS'), 'Simple CORS request needs no preflight');
  assert(state.requests.find(r => r.method === 'POST').contentType.startsWith('text/plain'), 'POST must be text/plain');
  assert(state.inquiries[0][4] === 30 && state.inquiries[0][3] === '테스트 기관', 'Lecture fields saved intact');
  assert(await page.locator('#inquiry-receipt-number').textContent() === state.inquiries[0][0], 'Receipt matches saved inquiry');
  assert((await page.locator('#inquiry-confirmation-message').textContent()).includes('상담 후 확정'), 'Lecture confirmation explains consultation');
  assert(JSON.stringify(slotsBefore) === JSON.stringify(state.slots.slots), 'Inquiry must leave class availability unchanged');
  assert(new URL(page.url()).pathname === '/inquiry/', 'Success remains on inquiry page');
  await page.locator('#inquiry-confirmation').screenshot({ path: 'output/playwright/inquiry-success-desktop.png' });
  passed.push('lecture submission, duplicate click, CORS redirect, receipt and unchanged calendar');

  const originalId = state.inquiries[0][0];
  await page.reload(); await ready(); await fill(); await submit(); await success();
  state = await data();
  assert(state.inquiries.length === 1 && state.mails.length === 1 && await page.locator('#inquiry-receipt-number').textContent() === originalId, 'Reload retry must preserve receipt and avoid duplicate email');
  passed.push('same inquiry after reload reuses receipt without a duplicate');

  await reset({ mode: 'disconnect-after-save' }); await ready(); await fill(); await submit(); await retry();
  assert(await page.locator('#inquiry-confirmation').isHidden(), 'Lost response must not look successful');
  assert(await field('message').isDisabled(), 'Uncertain request must keep original payload');
  await page.request.post(base + '/__test/mode', { data: { mode: 'normal' } });
  await submit(); await success(); state = await data();
  assert(state.inquiries.length === 1 && state.mails.length === 1, 'Lost-response retry saves and emails once');
  passed.push('saved inquiry with lost response recovers without duplicates');

  for (const mode of ['html', 'wrong-receipt']) {
    await reset({ mode }); await ready(); await fill(); await submit(); await retry();
    assert(await page.locator('#inquiry-confirmation').isHidden(), mode + ' must not show success');
    await page.request.post(base + '/__test/mode', { data: { mode: 'normal' } });
    await submit(); await success(); state = await data();
    assert(state.inquiries.length === 1 && state.mails.length === 1, mode + ' retry must resolve one request');
    passed.push(mode + ' response is rejected and safely retried');
  }

  await reset({ mode: 'mail-fail' }); await ready(); await fill(); await submit(); await success();
  state = await data();
  assert(state.inquiries.length === 1 && state.inquiries[0][11] === '재시도 대기' && state.mails.length === 0, 'Saved inquiry succeeds even when mail queues');
  passed.push('email failure preserves inquiry and queues notification');

  await reset({}, '/faq/');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: /다른 내용 문의하기/ }).click(); await ready();
  assert(await field('kind').inputValue() === 'question' && await field('party').inputValue() === '', 'FAQ preselects general question without party');
  assert(await field('party').getAttribute('required') === null, 'General question party is optional');
  await field('kind').selectOption('lecture');
  assert(await field('party').getAttribute('required') !== null, 'Switching to lecture requires party');
  await field('kind').selectOption('question');
  await fill(false);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile form fits width');
  await page.locator('#inquiry-form').screenshot({ path: 'output/playwright/inquiry-mobile.png' });
  await submit(); await success(); state = await data();
  assert(state.inquiries[0][2] === '일반 문의' && state.inquiries[0][4] === '' && state.inquiries[0][7] === '', 'General fields can be blank');
  assert(state.mails[0].subject.includes('일반 문의'), 'General inquiry email uses its template');
  assert((await page.locator('#inquiry-confirmation-message').textContent()).includes('답변드릴게요'), 'General question uses a reply confirmation');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile receipt fits width');
  await page.locator('#inquiry-confirmation').screenshot({ path: 'output/playwright/inquiry-success-mobile.png' });
  passed.push('FAQ general inquiry with optional fields and mobile layout');
  await page.locator('.fc-chat-toggle').click();
  assert(await page.locator('#chat-panel').isVisible(), 'Chat opens after inquiry');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: /문의 화면으로 돌아가기/ }).click(); await ready();
  assert(await field('name').inputValue() === '' && await page.locator('#inquiry-confirmation').isHidden(), 'Return opens empty form');
  assert((await data()).inquiries.length === 1 && (await data()).mails.length === 1, 'Return does not delete or resubmit inquiry');
  passed.push('mobile chat and return preserve accepted inquiry');

  await reset({}, '/booking/');
  await page.getByRole('link', { name: /희망 일정 문의하기/ }).click(); await ready();
  assert(await field('kind').inputValue() === 'question', 'Booking inquiry link sets general question');
  await fill(false); await submit(); await success();
  assert((await data()).inquiries[0][2] === '일반 문의', 'Booking desired-date inquiry saves correctly');
  passed.push('booking desired-date inquiry link and submission');
  assert(errors.length === 0, 'Unexpected JavaScript exceptions: ' + errors.join(', '));
  return { passed: passed.length, checks: passed, javascriptErrors: errors };
}
