// Run through playwright-cli: run-code --filename tests/booking-time-browser-checks.js
// Uses the local fixture and mocked responses; no real bookings or emails.
async (page) => {
  const context = await page.context().browser().newContext({ timezoneId: 'America/Los_Angeles' });
  const passed = [];
  const errors = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const slot = (start, isAvailable = true) => ({ id: start, start, duration: 60, maxParty: 2, isAvailable });
  const fixture = async (time, slots) => {
    const tab = await context.newPage();
    const requests = [];
    let uncertain = false;
    tab.on('pageerror', (error) => errors.push(error.message));
    await tab.clock.install({ time: new Date(time) });
    await tab.clock.pauseAt(new Date(time));
    await tab.route('http://127.0.0.1:4174/exec**', async (route) => {
      const request = route.request();
      requests.push(request.method());
      if (request.method() === 'POST') {
        if (uncertain) {
          uncertain = false;
          await route.fulfill({ contentType: 'text/html', body: '<html>Lost response</html>' });
          return;
        }
        const values = JSON.parse(request.postData());
        await route.fulfill({ json: { service: 'foxcave-booking', version: 1, ok: true,
          receipt: { id: values.requestId, status: 'received', start: values.slotId, duration: 60, party: values.party } } });
        return;
      }
      await route.fulfill({ json: { service: 'foxcave-booking', version: 1, ok: true, slots, updatedAt: time } });
    });
    await tab.goto('http://127.0.0.1:4173/booking/');
    await tab.waitForFunction(() => document.querySelector('#calendar-message').textContent.length > 0);
    return { tab, requests, loseResponse: () => { uncertain = true; } };
  };
  const fill = async (tab) => {
    await tab.getByRole('textbox', { name: '이름 필수' }).fill('시간 경계 테스트');
    await tab.getByRole('textbox', { name: '휴대폰 번호 필수' }).fill('010-0000-0000');
    await tab.getByRole('checkbox', { name: /개인정보/ }).check();
  };
  const choose = async (tab) => {
    await tab.getByRole('button', { name: '2026-10-20, 신청 가능', exact: true }).click();
    await tab.locator('.fc-slot-option:not(:disabled)').first().click();
  };
  try {
    let { tab } = await fixture('2026-10-20T19:00:00+09:00', [
      slot('2026-10-19T19:00:00+09:00', false),
      slot('2026-10-20T14:00:00+09:00'),
      slot('2026-10-20T19:00:00+09:00'),
      slot('2026-10-20T21:00:00+09:00', false),
      slot('2026-10-21T19:00:00+09:00'),
    ]);
    const yesterday = tab.getByRole('button', { name: '2026-10-19, 열린 일정 없음', exact: true });
    assert(await yesterday.isDisabled() && await yesterday.locator('small').textContent() === '—', 'Past days must show a disabled dash');
    await tab.getByRole('button', { name: '2026-10-20, 마감', exact: true }).click();
    assert(await tab.locator('.fc-slot-option').count() === 1, 'Past and exactly-starting slots must be hidden');
    assert((await tab.locator('.fc-slot-option').textContent()).includes('21:00'), 'Future booked time must remain visible');
    assert(await tab.locator('.fc-slot-option').isDisabled(), 'Future booked time must remain closed');
    assert(await tab.getByRole('button', { name: '2026-10-21, 신청 가능', exact: true }).isEnabled(), 'Future open dates must remain available');
    passed.push('past dates and elapsed times are hidden; future bookings stay closed in a non-Korean browser timezone');
    await tab.close();

    ({ tab } = await fixture('2026-11-01T00:00:00+09:00', [slot('2026-11-01T19:00:00+09:00')]));
    assert(await tab.getByRole('heading', { name: '2026년 11월', exact: true }).isVisible(), 'Month must follow Korea even while the browser is still in October');
    passed.push('calendar month follows Korea across the midnight/month boundary');
    await tab.close();

    let fixtureState = await fixture('2026-10-20T18:59:59+09:00', [slot('2026-10-20T19:00:00+09:00')]);
    tab = fixtureState.tab;
    await choose(tab); await fill(tab);
    const reads = fixtureState.requests.length;
    await tab.clock.runFor(1000);
    assert(await tab.getByRole('button', { name: '2026-10-20, 열린 일정 없음', exact: true }).isDisabled(), 'At the exact start, the last time disappears without a reload');
    assert(await tab.locator('[name=slotId]').inputValue() === '', 'Expired selection must be cleared');
    assert(await tab.locator('#booking-form [type=submit]').isDisabled(), 'A month with no remaining availability must disable submission');
    assert(await tab.locator('#form-error').textContent() === '선택한 수업의 시작 시간이 지났어요. 다른 일정을 선택해 주세요.', 'Explain why a selected time was cleared');
    assert(fixtureState.requests.length === reads, 'Local expiry must not make a Google request');
    passed.push('open-page expiry clears the selected time and disables submission without a network request');
    await tab.close();

    fixtureState = await fixture('2026-10-20T18:59:59+09:00', [slot('2026-10-20T19:00:00+09:00'), slot('2026-10-20T21:00:00+09:00')]);
    tab = fixtureState.tab;
    await choose(tab); await fill(tab);
    // Advance wall time without firing the interval, then submit the stale form.
    await tab.clock.setSystemTime(new Date('2026-10-20T19:00:00+09:00'));
    await tab.locator('#booking-form').evaluate((form) => form.requestSubmit());
    assert(!fixtureState.requests.includes('POST'), 'An expired selection must never be sent as a new booking');
    assert(await tab.locator('[name=slotId]').inputValue() === '', 'Submit-time validation must clear the stale selection');
    assert(await tab.getByRole('button', { name: '2026-10-20, 신청 가능', exact: true }).isEnabled(), 'A later open time keeps today available');
    assert(await tab.locator('.fc-slot-option').count() === 1 && (await tab.locator('.fc-slot-option').textContent()).includes('21:00'), 'Only the later time remains');
    passed.push('submit-time expiry blocks stale bookings while preserving later classes on the same day');
    await tab.close();

    fixtureState = await fixture('2026-10-20T18:59:59+09:00', [slot('2026-10-20T19:00:00+09:00')]);
    tab = fixtureState.tab;
    await choose(tab); await fill(tab); fixtureState.loseResponse();
    await tab.locator('#booking-form [type=submit]').click();
    await tab.getByRole('button', { name: '같은 신청 다시 확인하기 ▸' }).waitFor();
    await tab.clock.runFor(1000);
    assert(await tab.locator('[name=slotId]').inputValue() === '2026-10-20T19:00:00+09:00', 'Uncertain receipts must retain their original selection after expiry');
    await tab.getByRole('button', { name: '같은 신청 다시 확인하기 ▸' }).click();
    await tab.locator('#booking-confirmation').waitFor({ state: 'visible' });
    assert(fixtureState.requests.filter((method) => method === 'POST').length === 2, 'Receipt recovery must still reach the server');
    passed.push('uncertain submissions can recover their receipt after the class start time');
    assert(errors.length === 0, 'Unexpected JavaScript errors: ' + errors.join(', '));
    return { passed: passed.length, checks: passed, javascriptErrors: errors };
  } finally { await context.close(); }
}
