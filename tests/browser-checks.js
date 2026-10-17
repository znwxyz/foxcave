// Run through playwright-cli: run-code --filename tests/browser-checks.js
// Requires `npm run test:serve`; no real Google API or email is used here.
async (page) => {
  page.setDefaultTimeout(15000);
  const base = 'http://127.0.0.1:4173';
  const passed = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const data = async () => (await page.request.get(base + '/__test/state')).json();
  const reset = async (options = {}) => {
    await page.request.post(base + '/__test/reset', { data: options });
    await page.goto(base + '/booking/');
  };
  const choose = async (target = page) => {
    await target.waitForFunction(() => document.querySelector('#calendar-message').textContent.length > 0);
    if (!await target.locator('.fc-calendar-day.has-slot').count()) {
      await target.getByRole('button', { name: '다음 달', exact: true }).click();
    }
    await target.locator('.fc-calendar-day.has-slot').first().click();
    await target.locator('.fc-slot-option:not(:disabled)').first().click();
  };
  const fill = async (target = page, name = '브라우저 테스트') => {
    await target.getByRole('textbox', { name: '이름 필수' }).fill(name);
    await target.getByRole('textbox', { name: '휴대폰 번호 필수' }).fill('010-0000-0000');
    await target.getByRole('combobox', { name: /여우굴을 어떻게/ }).selectOption('instagram');
    await target.getByRole('textbox', { name: /미리 알려주실 내용/ }).fill('브라우저 자동 검증용 가상 신청입니다.');
    await target.getByRole('checkbox', { name: /개인정보/ }).check();
  };
  const submit = (target = page) => target.locator('#booking-form [type=submit]').click();
  const success = (target = page) => target.locator('#booking-confirmation').waitFor({ state: 'visible' });

  await reset({ missingConfig: true });
  await page.getByText(/온라인 예약을 준비하고 있어요/).waitFor();
  assert(await page.locator('#booking-form [type=submit]').isDisabled(), 'Unconfigured form must be disabled');
  assert((await data()).requests.length === 0, 'Missing URL must not submit to a fallback API');
  passed.push('unconfigured deployment stays closed');

  await reset();
  await page.locator('.fc-calendar-day.has-slot').first().waitFor();
  await submit();
  await page.getByText('날짜와 시간을 먼저 선택해 주세요.', { exact: true }).waitFor();
  await choose();
  await submit();
  assert((await data()).rows.length === 0, 'Empty fields must not be submitted');
  await fill();
  await page.getByRole('textbox', { name: '휴대폰 번호 필수' }).fill('123');
  await submit();
  await page.getByText('휴대폰 번호를 확인해 주세요.', { exact: true }).waitFor();
  assert((await data()).requests.every((req) => req.method !== 'POST'), 'Invalid form must not make a POST');
  passed.push('date, required fields and phone validation');

  await reset({ mode: 'slow' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await choose(); await fill();
  await page.locator('.fc-booking-layout').screenshot({ path: 'output/playwright/booking-desktop.png' });
  await submit();
  await page.locator('#booking-form').evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
  await success();
  let state = await data();
  assert(state.rows.length === 1 && state.mails.length === 1, 'Double click must save and email once');
  assert(state.requests.filter((req) => req.method === 'POST').length === 1, 'Double click must make one POST');
  assert(state.requests.every((req) => req.method !== 'OPTIONS'), 'CORS must not require preflight');
  assert(state.requests.find((req) => req.method === 'POST').contentType.startsWith('text/plain'), 'Use simple Content-Type');
  assert((await page.locator('#receipt-number').textContent()) === state.rows[0][0], 'Receipt must match saved row');
  assert(state.mails[0].to === 'replate.kr@gmail.com', 'Test recipient must be fixed on backend');
  assert(await page.locator('.fc-slot-option.is-selected').isDisabled(), 'Accepted slot must close immediately on the same page');
  await page.locator('#booking-confirmation').screenshot({ path: 'output/playwright/booking-success-desktop.png' });
  passed.push('desktop submission, cross-origin redirect, duplicate-click protection and matching receipt');

  await reset({ mode: 'disconnect-after-save' });
  await choose(); await fill(); await submit();
  await page.getByRole('button', { name: '같은 신청 다시 확인하기 ▸' }).waitFor();
  assert(await page.locator('#booking-confirmation').isHidden(), 'Lost response must not look successful');
  assert(await page.getByRole('textbox', { name: '이름 필수' }).isDisabled(), 'Keep uncertain request unchanged');
  const selection = await page.locator('#selected-slot').textContent();
  await page.getByRole('button', { name: '일정 새로 확인하기 ↻' }).click();
  assert(await page.locator('#selected-slot').textContent() === selection, 'Refresh must preserve uncertain selection');
  await page.request.post(base + '/__test/mode', { data: { mode: 'normal' } });
  await submit(); await success();
  state = await data();
  assert(state.rows.length === 1 && state.mails.length === 1, 'Retry after saved/disconnected must not duplicate');
  assert(state.requests.filter((req) => req.method === 'POST').length >= 2, 'Retry should actually check server');
  passed.push('lost response recovered with same ID and no duplicate row or email');

  await reset({ mode: 'html' });
  await choose(); await fill(); await submit();
  await page.getByRole('button', { name: '같은 신청 다시 확인하기 ▸' }).waitFor();
  assert(await page.locator('#booking-confirmation').isHidden(), 'Google login HTML is not a successful booking');
  assert((await data()).rows.length === 0, 'Login HTML scenario must have no saved row');
  passed.push('HTML permission/login response never becomes a fake success');

  await reset({ mode: 'wrong-receipt' });
  await choose(); await fill(); await submit();
  await page.getByRole('button', { name: '같은 신청 다시 확인하기 ▸' }).waitFor();
  assert(await page.locator('#booking-confirmation').isHidden(), 'Unrelated receipt must not be accepted');
  passed.push('mismatched receipt rejected');

  await reset({ mode: 'mail-fail' });
  await choose(); await fill(); await submit(); await success();
  state = await data();
  assert(state.rows.length === 1 && state.rows[0][11] === '재시도 대기', 'Saved request remains accepted after mail failure');
  assert(state.mails.length === 0, 'Failure scenario must not pretend email was sent');
  passed.push('saved request accepted while failed email remains queued');

  await reset();
  const second = await page.context().newPage();
  await second.goto(base + '/booking/');
  await choose(); await fill(page, '첫 번째 팀');
  await choose(second); await fill(second, '두 번째 팀');
  await Promise.all([submit(page), submit(second)]);
  await Promise.all([page.waitForFunction(() => !document.querySelector('#booking-form').hasAttribute('aria-busy')), second.waitForFunction(() => !document.querySelector('#booking-form').hasAttribute('aria-busy'))]);
  state = await data();
  assert(state.rows.length === 1 && state.mails.length === 1, 'Only one team may occupy a slot');
  const visibleCount = Number(await page.locator('#booking-confirmation').isVisible()) + Number(await second.locator('#booking-confirmation').isVisible());
  assert(visibleCount === 1, 'Only the winning submission may show success');
  const loser = await page.locator('#booking-confirmation').isVisible() ? second : page;
  assert((await loser.locator('#form-error').textContent()).includes('마감'), 'Losing team must see clear closed-slot message');
  await second.close();
  passed.push('two visitors competing for one slot');

  await reset();
  await page.setViewportSize({ width: 390, height: 844 });
  await choose(); await fill();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile form overflows viewport');
  await page.locator('.fc-booking-layout').screenshot({ path: 'output/playwright/booking-mobile.png' });
  await submit(); await success();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile receipt overflows viewport');
  await page.locator('#booking-confirmation').screenshot({ path: 'output/playwright/booking-success-mobile.png' });
  assert(errors.length === 0, 'Unexpected browser JavaScript errors: ' + errors.join(', '));
  passed.push('mobile form and confirmation at 390px without horizontal overflow');

  await reset({ mode: 'daily' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await choose();
  const dailySlot = await page.locator('.fc-slot-option.is-selected').getAttribute('data-slot-id');
  assert(dailySlot.endsWith('T19:00:00+09:00'), 'Recurring time must be 19:00 Korean time');
  assert((await page.locator('.fc-slot-option.is-selected').textContent()).includes('60분'), 'Daily class must last one hour');
  await page.locator('.fc-booking-layout').screenshot({ path: 'output/playwright/booking-daily-desktop.png' });
  await fill(); await submit(); await success();
  assert(await page.locator('.fc-slot-option.is-selected').isDisabled(), 'Recurring slot must immediately show closed');
  assert((await page.locator('#receipt-details').textContent()).includes('60분'), 'Daily receipt must report one hour');
  state = await data();
  assert(state.rows.length === 1 && state.mails.length === 1, 'Daily slot saves and emails once');
  assert(state.mails[0].htmlBody.includes('<strong style="font-weight:700">접수번호:</strong>'), 'Booking notification includes HTML labels');
  await page.reload();
  await page.locator(`[data-date="${dailySlot.slice(0, 10)}"]`).click();
  await page.locator(`[data-slot-id="${dailySlot}"]`).waitFor();
  assert(await page.locator(`[data-slot-id="${dailySlot}"]`).isDisabled(), 'New visitors must see the daily slot closed');
  const oldMonth = await page.locator('#calendar-month').textContent();
  await page.getByRole('button', { name: '다음 달', exact: true }).click();
  await page.locator('.fc-calendar-day.has-slot').first().waitFor();
  assert((await page.locator('#calendar-month').textContent()) !== oldMonth, 'Daily schedule continues next month');
  assert((await page.locator('.fc-calendar-day.has-slot').count()) >= 28, 'All next-month dates are generated');
  assert(errors.length === 0, 'Unexpected browser JavaScript errors: ' + errors.join(', '));
  passed.push('daily 19:00 one-hour schedule, receipt, immediate closure, new-visitor closure and next month');
  return { passed: passed.length, checks: passed, javascriptErrors: errors };
}
