import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, booking } from './apps-script-harness.mjs';

const ready = () => { const env = createHarness(); env.setup(); env.addSlot(); return env; };

test('setup creates private sheets and one retry trigger; rerunning preserves data and production mode', () => {
  const env = ready(); env.post(booking()); env.run('useProductionRecipient'); env.setup();
  assert.equal(env.creates, 1); assert.equal(env.requests().length, 1);
  assert.deepEqual(env.triggers, ['retryPendingNotifications']);
  assert.equal(env.properties.DELIVERY_MODE, 'PRODUCTION');
});
test('valid booking saves all fields and emails only test recipient with private row link', () => {
  const env = ready(); const input = booking(); const result = env.post(input);
  assert.equal(result.ok, true); assert.equal(result.receipt.id, input.requestId);
  const row = env.requests()[0];
  assert.equal(row[5], input.name); assert.equal(row[6], '01000000000'); assert.equal(row[8], input.message);
  assert.equal(row[10], '접수 대기'); assert.equal(row[11], '발송 완료'); assert.equal(row[13], 1);
  assert.equal(env.mail[0].to, 'replate.kr@gmail.com');
  assert.match(env.mail[0].subject, /^\[TEST\]/); assert.match(env.mail[0].body, /#gid=1&range=A2:S2/);
  assert.equal(JSON.stringify(result).includes('010'), false);
});
test('repeat of an accepted request remains idempotent after schedule closes or is deleted', () => {
  const env = ready(); const input = booking(); const first = env.post(input);
  env.book.getSheetByName('수업 일정').data.pop();
  assert.deepEqual(env.post(input), first);
  assert.equal(env.requests().length, 1); assert.equal(env.mail.length, 1);
});
test('same ID with changed fields is rejected without overwriting the original', () => {
  const env = ready(); const input = booking(); env.post(input);
  assert.equal(env.post({ ...input, name: '다른 신청' }).code, 'ID_CONFLICT');
  assert.equal(env.requests()[0][5], '테스트 신청'); assert.equal(env.mail.length, 1);
});
test('a second team cannot reserve the same slot and the public calendar reports it closed', () => {
  const env = ready(); env.post(booking());
  assert.equal(env.post(booking()).code, 'SLOT_CLOSED');
  assert.equal(env.get({ action: 'slots', month: '2026-10' }).slots[0].isAvailable, false);
  assert.equal(env.requests().length, 1);
});
test('cancellation reopens a future slot; confirmation keeps it occupied', () => {
  const env = ready(); env.post(booking()); const row = env.requests()[0];
  row[10] = '예약 확정'; assert.equal(env.get({ action: 'slots', month: '2026-10' }).slots[0].isAvailable, false);
  row[10] = '취소'; assert.equal(env.get({ action: 'slots', month: '2026-10' }).slots[0].isAvailable, true);
});
test('calendar and health responses expose no private reservation data, recipient or spreadsheet ID', () => {
  const env = ready(); env.post(booking());
  const publicData = JSON.stringify([env.get({ action: 'slots', month: '2026-10' }), env.get({ action: 'health' })]);
  for (const text of ['테스트 신청', '01000000000', 'test-private-sheet', '@gmail', '@naver', '로컬 검증']) assert.equal(publicData.includes(text), false);
});
test('required consent, invalid phone, excessive lengths, wrong kind and invalid party are rejected server-side', () => {
  for (const changes of [{ consent: false }, { consent: 'true' }, { phone: '010' }, { name: ' ' }, { name: 'a'.repeat(61) }, { name: '이름\n제목' }, { message: 'a'.repeat(2001) }, { kind: 'lecture' }, { party: 0 }, { party: 1.5 }, { party: '2' }, { channel: '__proto__' }, { requestId: 'fake-id' }, { website: 'spam' }]) {
    const env = ready(); assert.equal(env.post(booking(changes)).ok, false, JSON.stringify(changes));
    assert.equal(env.requests().length, 0); assert.equal(env.mail.length, 0);
  }
});
test('client cannot choose email recipient, delivery mode, timestamp or duration', () => {
  const env = ready(); const result = env.post(booking({ recipient: 'attacker@example.com', mode: 'PRODUCTION', duration: 1, start: '2099-01-01' }));
  assert.equal(result.ok, true); assert.equal(env.mail[0].to, 'replate.kr@gmail.com'); assert.equal(result.receipt.duration, 90);
});
test('HTML email bolds labels while escaping customer input, preserving line breaks and plain-text fallback', () => {
  const env = ready(); const result = env.post(booking({ name: '=HYPERLINK("bad")', message: '<img src=x onerror=alert(1)>\n=IMPORTXML("bad") & \'문의\'' }));
  assert.equal(result.ok, true); assert.equal(env.requests()[0][5], '=HYPERLINK("bad")');
  const mail = env.mail[0];
  assert.match(mail.body, /<img/);
  assert.match(mail.htmlBody, /&lt;img src=x onerror=alert\(1\)&gt;<br>/);
  assert.match(mail.htmlBody, /&amp; &#39;문의&#39;/);
  assert.equal(mail.htmlBody.includes('<img'), false);
  assert.equal(mail.htmlBody.includes('=HYPERLINK("bad")'), false);
  for (const label of ['접수번호', '수업 일시', '참여 인원', '소요시간', '이름', '연락처', '유입 경로', '요청사항']) {
    assert.ok(mail.htmlBody.includes('<strong style="font-weight:700">' + label + ':</strong>'));
  }
  assert.match(mail.htmlBody, /href="https:\/\/docs.google.com\/spreadsheets\/d\/test-private-sheet\/edit#gid=1&amp;range=A2:S2"/);
  assert.equal(env.run('sheetText_', '=1+1'), "'=1+1");
});
test('past, disabled and oversubscribed slots cannot be booked', () => {
  for (const setup of [env => { env.now = Date.parse('2026-10-21T00:00:00Z'); }, env => { env.book.getSheetByName('수업 일정').data[1][4] = false; }, env => { env.book.getSheetByName('수업 일정').data[1][3] = 1; }]) {
    const env = ready(); setup(env); assert.equal(env.post(booking()).ok, false); assert.equal(env.requests().length, 0);
  }
});
test('invalid dates and duplicate schedule rows fail closed', () => {
  for (const row of [['2026-02-30', '19:30', 90, 2, true], ['2026-10-21', '25:00', 90, 2, true], ['2026-10-20', '19:30', 90, 2, true]]) {
    const env = ready(); env.book.getSheetByName('수업 일정').data.push(row);
    assert.equal(env.get({ action: 'slots', month: '2026-10' }).code, 'SCHEDULE_CONFIG');
    assert.equal(env.post(booking()).code, 'SCHEDULE_CONFIG');
  }
});
test('empty schedule returns no invented availability', () => {
  const env = createHarness(); env.setup(); assert.deepEqual(env.get({ action: 'slots', month: '2026-10' }).slots, []);
});
test('unknown origin rejected and localhost accepted only in test mode', () => {
  const env = ready(); assert.equal(env.post(booking({ origin: 'https://attacker.example' })).code, 'BAD_ORIGIN');
  env.run('useProductionRecipient'); assert.equal(env.post(booking()).code, 'BAD_ORIGIN');
  assert.equal(env.post(booking({ origin: 'https://xn--bf0b077b2qa.com' })).ok, true);
  assert.equal(env.mail[0].to, 'replate.kr@gmail.com,foxcavebrew@naver.com');
});
test('production booking sends one message to both recipients and retries of the request do not duplicate it', () => {
  const env = ready(); env.run('useProductionRecipient');
  const input = booking({ origin: 'https://xn--bf0b077b2qa.com', recipient: 'attacker@example.com' });
  const receipt = env.post(input);
  assert.equal(receipt.ok, true); assert.deepEqual(env.post(input), receipt);
  assert.equal(env.requests().length, 1); assert.equal(env.mail.length, 1);
  assert.equal(env.mail[0].to, 'replate.kr@gmail.com,foxcavebrew@naver.com');
  assert.equal(env.requests()[0][18], env.mail[0].to);
  assert.equal(env.mail[0].subject.startsWith('[TEST]'), false);
  assert.equal(env.quota, 98);
});
test('one deployment switches real-domain bookings between test and production without resetting data', () => {
  const env = ready(); env.run('enableDailyEveningSchedule');
  env.run('useProductionRecipient'); env.run('useProductionRecipientTest');
  assert.equal(env.mail.length, 0); assert.equal(env.requests().length, 0);
  assert.equal(env.get({ action: 'health' }).mode, 'TEST');
  const first = booking({ origin: 'https://xn--bf0b077b2qa.com', slotId: '2026-10-19T19:00:00+09:00' });
  assert.equal(env.post(first).ok, true);
  assert.equal(env.requests()[0][18], 'replate.kr@gmail.com');
  assert.equal(env.mail[0].to, 'replate.kr@gmail.com'); assert.match(env.mail[0].subject, /^\[TEST\]/);
  assert.equal(env.get({ action: 'slots', month: '2026-10' }).slots[0].isAvailable, false);
  env.run('useProductionRecipient');
  assert.equal(env.get({ action: 'health' }).mode, 'PRODUCTION');
  assert.equal(env.post(booking({ origin: 'https://www.xn--bf0b077b2qa.com', slotId: '2026-10-25T19:00:00+09:00' })).ok, true);
  assert.equal(env.mail[1].to, 'replate.kr@gmail.com,foxcavebrew@naver.com');
  assert.equal(env.requests()[0][18], 'replate.kr@gmail.com');
  assert.equal(env.properties.DAILY_EVENING_ENABLED, 'true'); assert.equal(env.creates, 1);
  env.run('useProductionRecipientTest');
  assert.equal(env.get({ action: 'health' }).mode, 'TEST');
  assert.equal(env.requests().length, 2); assert.equal(env.mail.length, 2);
});
test('dual-recipient delivery waits for two quota units and sends once when quota recovers', () => {
  const env = ready(); env.run('useProductionRecipient'); env.quota = 1;
  const input = booking({ origin: 'https://xn--bf0b077b2qa.com' });
  assert.equal(env.post(input).ok, true);
  assert.equal(env.requests()[0][11], '재시도 대기'); assert.equal(env.requests()[0][13], 0);
  assert.equal(env.mail.length, 0); assert.equal(env.quota, 1);
  env.run('useTestRecipient'); env.quota = 2; env.run('retryPendingNotifications');
  assert.equal(env.mail[0].to, 'replate.kr@gmail.com,foxcavebrew@naver.com');
  assert.equal(env.quota, 0); assert.equal(env.requests()[0][11], '발송 완료');
  env.run('retryPendingNotifications'); assert.equal(env.mail.length, 1);
});
test('older queued production rows retain their original single recipient', () => {
  const env = ready(); env.run('useProductionRecipient'); env.quota = 0;
  env.post(booking({ origin: 'https://xn--bf0b077b2qa.com' }));
  env.requests()[0][18] = 'foxcavebrew@naver.com'; // A row saved before dual delivery was introduced.
  env.quota = 1; env.run('retryPendingNotifications');
  assert.equal(env.mail[0].to, 'foxcavebrew@naver.com'); assert.equal(env.quota, 0);
  assert.equal(env.requests()[0][11], '발송 완료');
});
test('queued notifications reject unknown or duplicate recipients', () => {
  for (const recipient of ['replate.kr@gmail.com,attacker@example.com', 'foxcavebrew@naver.com,foxcavebrew@naver.com', '']) {
    const env = ready(); env.quota = 0; env.post(booking());
    env.requests()[0][18] = recipient; env.quota = 100; env.run('retryPendingNotifications');
    assert.equal(env.mail.length, 0); assert.equal(env.requests()[0][11], '확인 필요');
  }
});
test('failed email still returns a saved receipt and retries without a duplicate booking', () => {
  const env = ready(); env.mailFails = true; const input = booking();
  assert.equal(env.post(input).ok, true); assert.equal(env.requests()[0][11], '재시도 대기');
  env.mailFails = false; env.now += 11 * 60 * 1000; env.run('retryPendingNotifications');
  assert.equal(env.requests()[0][11], '발송 완료'); assert.equal(env.mail.length, 1);
  env.post(input); env.run('retryPendingNotifications');
  assert.equal(env.mail.length, 1); assert.equal(env.requests().length, 1);
});
test('quota exhaustion queues mail until quota returns without failing a saved booking', () => {
  const env = ready(); env.quota = 0;
  assert.equal(env.post(booking()).ok, true); assert.equal(env.requests()[0][11], '재시도 대기'); assert.equal(env.requests()[0][13], 0);
  env.quota = 100; env.run('retryPendingNotifications'); assert.equal(env.mail.length, 1);
});
test('switching to production does not reroute pending test notifications', () => {
  const env = ready(); env.quota = 0; env.post(booking()); env.run('useProductionRecipient');
  env.quota = 100; env.run('retryPendingNotifications'); assert.equal(env.mail[0].to, 'replate.kr@gmail.com');
});
test('retry stops after three failures and does not send again on subsequent triggers', () => {
  const env = ready(); env.mailFails = true; env.post(booking());
  for (let i = 0; i < 4; i++) { env.now += 11 * 60 * 1000; env.run('retryPendingNotifications'); }
  assert.equal(env.requests()[0][13], 3); assert.equal(env.requests()[0][11], '재시도 종료');
});
test('interrupted mail status update is held for manual review instead of a duplicate send', () => {
  const env = ready(); env.afterSend = () => { env.book.getSheetByName('예약 신청').failWrites = true; };
  assert.equal(env.post(booking()).ok, true); assert.equal(env.requests()[0][11], '전송 중');
  env.book.getSheetByName('예약 신청').failWrites = false; env.now += 16 * 60 * 1000;
  env.run('retryPendingNotifications'); assert.equal(env.requests()[0][11], '확인 필요'); assert.equal(env.mail.length, 1);
});
test('lock contention cannot partially save or send a booking', () => {
  const env = ready(); env.lockBusy = true; assert.equal(env.post(booking()).code, 'BUSY');
  assert.equal(env.requests().length, 0); assert.equal(env.mail.length, 0);
});
test('spreadsheet failure never returns a successful receipt or sends mail', () => {
  const env = ready(); env.book.getSheetByName('예약 신청').failWrites = true;
  assert.equal(env.post(booking()).code, 'INTERNAL'); assert.equal(env.mail.length, 0);
});
test('daily contact limit is enforced after three bookings', () => {
  const env = ready();
  for (const time of ['14:00', '16:00', '18:00']) env.addSlot('2026-10-20', time);
  for (const time of ['14:00', '16:00', '18:00']) assert.equal(env.post(booking({ slotId: `2026-10-20T${time}:00+09:00` })).ok, true);
  assert.equal(env.post(booking()).code, 'PHONE_LIMIT'); assert.equal(env.mail.length, 3);
});
test('daily global limit prevents additional storage and email', () => {
  const env = ready(); const sheet = env.book.getSheetByName('예약 신청');
  for (let i = 0; i < 80; i++) sheet.data.push([`existing-${i}`, '2026-10-17 10:00:00']);
  assert.equal(env.post(booking()).code, 'DAILY_LIMIT'); assert.equal(env.mail.length, 0);
});
test('malformed JSON and unsupported public actions never reveal private data', () => {
  const env = ready();
  const malformed = JSON.parse(env.run('doPost', { postData: { contents: '{bad' } }).body);
  assert.equal(malformed.code, 'BAD_BODY');
  for (const action of ['retryPendingNotifications', 'useProductionRecipient', 'requests']) assert.equal(env.get({ action }).code, 'BAD_ACTION');
  assert.equal(env.get({ action: 'slots', month: '2026-99' }).code, 'BAD_MONTH');
});
test('diagnostic email always goes to the test account and creates no reservation', () => {
  const env = ready(); env.run('useProductionRecipient'); env.run('sendTestEmail');
  assert.equal(env.mail[0].to, 'replate.kr@gmail.com'); assert.equal(env.requests().length, 0);
  assert.match(env.mail[0].htmlBody, /<strong style="font-weight:700">참여 인원:<\/strong>/);
  assert.match(env.mail[0].body, /신청 행은 생성하지 않았으며 예약 시간도 마감되지 않습니다/);
  assert.equal(env.get({ action: 'slots', month: '2026-10' }).slots[0].isAvailable, true);
});

test('weekly schedule offers four 90-minute starts on Sunday, Monday and Tuesday from October 19 without an end date', () => {
  const env = createHarness(); env.setup(); env.run('enableWeeklyEveningSchedule');
  const october = env.get({ action: 'slots', month: '2026-10' }).slots;
  assert.equal(october.length, 20);
  assert.equal(october[0].start, '2026-10-19T19:00:00+09:00');
  assert.equal(october.at(-1).start, '2026-10-27T20:30:00+09:00');
  assert.deepEqual([...new Set(october.map((slot) => slot.start.slice(0, 10)))], ['2026-10-19', '2026-10-20', '2026-10-25', '2026-10-26', '2026-10-27']);
  assert.deepEqual(october.slice(0, 4).map((slot) => slot.start.slice(11, 16)), ['19:00', '19:30', '20:00', '20:30']);
  assert.ok(october.every((slot) => slot.duration === 90 && slot.maxParty === 5 && slot.isAvailable));
  assert.equal(env.get({ action: 'slots', month: '2026-09' }).slots.length, 0);
  for (const [month, count] of [['2026-11', 56], ['2027-02', 48], ['2028-02', 52], ['2100-02', 48], ['2100-12', 48]]) {
    const slots = env.get({ action: 'slots', month }).slots;
    assert.equal(slots.length, count, month);
    assert.ok(slots.every((slot) => [0, 1, 2].includes(new Date(slot.start).getUTCDay())));
    assert.equal(new Set(slots.map((slot) => slot.id)).size, count);
  }
  assert.equal(env.get({ action: 'slots', month: '2028-02' }).slots.at(-1).start, '2028-02-29T20:30:00+09:00');
  assert.equal(env.book.getSheetByName('수업 일정').data.length, 1);
  assert.equal(env.requests().length, 0); assert.equal(env.mail.length, 0);
});

test('recurrence activation and setup preserve existing schedules, reservations and recipient mode; disabling retains manual slots', () => {
  const env = ready(); env.post(booking()); env.run('useProductionRecipient');
  const before = structuredClone(env.book.getSheetByName('수업 일정').data);
  env.run('enableWeeklyEveningSchedule'); env.run('enableWeeklyEveningSchedule'); env.setup();
  assert.equal(env.properties.DELIVERY_MODE, 'PRODUCTION');
  assert.equal(env.get({ action: 'slots', month: '2026-10' }).slots.length, 20);
  assert.deepEqual(env.book.getSheetByName('수업 일정').data, before);
  assert.equal(env.requests().length, 1); assert.equal(env.mail.length, 1);
  env.run('disableWeeklyEveningSchedule');
  const slots = env.get({ action: 'slots', month: '2026-10' }).slots;
  assert.equal(slots.length, 1); assert.equal(slots[0].isAvailable, false);
});

test('existing activation property and old function names use the new weekly schedule without resetting data', () => {
  const env = createHarness(); env.setup();
  env.properties.DAILY_EVENING_ENABLED = 'true';
  assert.equal(env.get({ action: 'slots', month: '2026-10' }).slots.length, 20);
  env.run('disableDailyEveningSchedule');
  assert.equal(env.get({ action: 'slots', month: '2026-10' }).slots.length, 0);
  env.run('enableDailyEveningSchedule');
  assert.ok(env.get({ action: 'slots', month: '2026-10' }).slots.every((slot) => slot.duration === 90));
  assert.equal(env.properties.DELIVERY_MODE, 'TEST');
  assert.equal(env.requests().length, 0); assert.equal(env.mail.length, 0);
});

test('existing 60-minute receipts keep their agreed duration when weekly generation is enabled', () => {
  const env = createHarness(); env.setup();
  const sheet = env.book.getSheetByName('수업 일정');
  sheet.data.push(['2026-10-19', '19:00', 60, 2, true]);
  const input = booking({ slotId: '2026-10-19T19:00:00+09:00' });
  const original = env.post(input);
  assert.equal(original.receipt.duration, 60);
  sheet.data.pop(); env.run('enableWeeklyEveningSchedule');
  assert.equal(env.get({ action: 'slots', month: '2026-10' }).slots[0].duration, 90);
  assert.deepEqual(env.post(input), original);
  assert.equal(env.requests()[0][3], 60);
  assert.equal(env.requests().length, 1); assert.equal(env.mail.length, 1);
  // The operator can explicitly extend the saved booking after agreeing with the customer.
  env.requests()[0][3] = 90;
  const slots = env.get({ action: 'slots', month: '2026-10' }).slots.filter((slot) => slot.start.startsWith('2026-10-19'));
  assert.deepEqual(slots.filter((slot) => slot.isAvailable).map((slot) => slot.start.slice(11, 16)), ['20:30']);
});

test('manual overrides close individual starts or adjust duration and party limit without duplicate slots', () => {
  const env = createHarness(); env.setup(); env.run('enableWeeklyEveningSchedule');
  env.book.getSheetByName('수업 일정').data.push(['2026-10-19', '19:00', 90, 2, false], ['2026-10-20', '19:00', 120, 1, true]);
  const slots = env.get({ action: 'slots', month: '2026-10' }).slots;
  assert.equal(slots.length, 20); assert.equal(slots[0].isAvailable, false);
  assert.ok(slots.slice(1, 4).every((slot) => slot.isAvailable));
  assert.equal(env.post(booking({ slotId: slots[0].id })).code, 'SLOT_CLOSED');
  const adjusted = slots.find((slot) => slot.id === '2026-10-20T19:00:00+09:00');
  assert.equal(adjusted.duration, 120); assert.equal(adjusted.maxParty, 1);
  assert.equal(env.post(booking({ slotId: adjusted.id })).code, 'PARTY_LIMIT');
  assert.equal(env.post(booking({ slotId: adjusted.id, party: 1 })).receipt.duration, 120);
});

test('closing all four manual overrides closes the day; deleting an override restores only that start', () => {
  const env = createHarness(); env.setup(); env.run('enableWeeklyEveningSchedule');
  const sheet = env.book.getSheetByName('수업 일정');
  for (const time of ['19:00', '19:30', '20:00', '20:30']) env.addSlot('2026-10-19', time, 2, false);
  const daySlots = () => env.get({ action: 'slots', month: '2026-10' }).slots.filter((slot) => slot.start.startsWith('2026-10-19'));
  assert.ok(daySlots().every((slot) => !slot.isAvailable));
  sheet.data.pop();
  assert.deepEqual(daySlots().filter((slot) => slot.isAvailable).map((slot) => slot.start.slice(11, 16)), ['20:30']);
});

test('recurring slots can be booked directly; invented times, dates and excess party sizes are refused', () => {
  const env = createHarness(); env.setup(); env.run('enableWeeklyEveningSchedule');
  for (const slotId of ['2026-10-18T19:00:00+09:00', '2026-10-19T18:30:00+09:00', '2026-10-19T21:00:00+09:00', '2026-10-19T19:15:00+09:00', '2026-10-21T19:00:00+09:00', '2026-10-24T20:30:00+09:00', '2027-02-30T19:00:00+09:00', 'fake']) {
    assert.equal(env.post(booking({ slotId })).ok, false);
  }
  const input = booking({ slotId: '2026-10-19T19:00:00+09:00' });
  assert.equal(env.post({ ...input, party: 6 }).code, 'PARTY_LIMIT');
  const first = env.post(input); assert.equal(first.ok, true); assert.equal(first.receipt.duration, 90);
  assert.deepEqual(env.post(input), first);
  assert.equal(env.post(booking({ slotId: input.slotId })).code, 'SLOT_CLOSED');
  assert.equal(env.requests().length, 1); assert.equal(env.mail.length, 1);
  assert.equal(env.get({ action: 'slots', month: '2026-10' }).slots[0].isAvailable, false);
});

test('recurring classes accept one through five people, report the count consistently and reject six', () => {
  for (let party = 1; party <= 5; party++) {
    const env = createHarness(); env.setup(); env.run('enableWeeklyEveningSchedule');
    const input = booking({ slotId: '2026-10-19T19:00:00+09:00', party });
    assert.equal(env.post({ ...input, party: 6 }).code, 'PARTY_LIMIT');
    assert.equal(env.requests().length, 0); assert.equal(env.mail.length, 0);
    const result = env.post(input);
    assert.equal(result.ok, true); assert.equal(result.receipt.party, party);
    assert.equal(env.requests()[0][4], party);
    assert.ok(env.mail[0].body.includes('참여 인원: ' + party + '명'));
    assert.deepEqual(env.post(input), result);
    assert.equal(env.requests().length, 1); assert.equal(env.mail.length, 1);
  }
});

test('each 90-minute booking closes only overlapping starts, including pending and confirmed bookings', () => {
  const expected = { '19:00': ['20:30'], '19:30': [], '20:00': [], '20:30': ['19:00'] };
  for (const [firstTime, remaining] of Object.entries(expected)) {
    const env = createHarness(); env.setup(); env.run('enableWeeklyEveningSchedule');
    const input = booking({ slotId: `2026-10-20T${firstTime}:00+09:00` });
    assert.equal(env.post(input).ok, true);
    const daySlots = () => env.get({ action: 'slots', month: '2026-10' }).slots.filter((slot) => slot.start.startsWith('2026-10-20'));
    assert.equal(daySlots().length, 4);
    assert.deepEqual(daySlots().filter((slot) => slot.isAvailable).map((slot) => slot.start.slice(11, 16)), remaining);
    for (const slot of daySlots().filter((slot) => !slot.isAvailable)) assert.equal(env.post(booking({ slotId: slot.id })).code, 'SLOT_CLOSED');
    env.requests()[0][10] = '예약 확정';
    assert.deepEqual(daySlots().filter((slot) => slot.isAvailable).map((slot) => slot.start.slice(11, 16)), remaining);
    for (const state of ['취소', '진행 불가']) {
      env.requests()[0][10] = state;
      assert.ok(daySlots().every((slot) => slot.isAvailable));
    }
    assert.equal(env.requests().length, 1); assert.equal(env.mail.length, 1);
  }
});

test('19:00 and 20:30 bookings coexist in either order and cancellation respects the other booking', () => {
  for (const times of [['19:00', '20:30'], ['20:30', '19:00']]) {
    const env = createHarness(); env.setup(); env.run('enableWeeklyEveningSchedule');
    for (const time of times) assert.equal(env.post(booking({ slotId: `2026-10-19T${time}:00+09:00` })).ok, true);
    const daySlots = () => env.get({ action: 'slots', month: '2026-10' }).slots.filter((slot) => slot.start.startsWith('2026-10-19'));
    assert.ok(daySlots().every((slot) => !slot.isAvailable));
    assert.equal(env.requests().length, 2); assert.equal(env.mail.length, 2);
    assert.ok(env.requests().every((row) => row[3] === 90));
    env.requests()[0][10] = '취소';
    assert.deepEqual(daySlots().filter((slot) => slot.isAvailable).map((slot) => slot.start.slice(11, 16)), [times[0]]);
  }
});

test('occupied intervals are checked across midnight and month boundaries', () => {
  const env = createHarness(); env.setup(); env.run('enableDailyEveningSchedule');
  env.book.getSheetByName('수업 일정').data.push(['2026-10-31', '23:30', 60, 2, true], ['2026-11-01', '00:00', 60, 2, true]);
  assert.equal(env.post(booking({ slotId: '2026-10-31T23:30:00+09:00' })).ok, true);
  const slots = env.get({ action: 'slots', month: '2026-11' }).slots;
  assert.equal(slots[0].isAvailable, false); assert.equal(slots[1].isAvailable, true);
  assert.equal(env.post(booking({ slotId: slots[0].id })).code, 'SLOT_CLOSED');
});

test('past recurring classes cannot be booked, including exactly at the start time in Korea', () => {
  const env = createHarness({ now: '2026-10-19T10:00:00Z' }); env.setup(); env.run('enableDailyEveningSchedule');
  const slots = env.get({ action: 'slots', month: '2026-10' }).slots;
  assert.equal(slots[0].isAvailable, false); assert.equal(slots[1].isAvailable, true);
  assert.equal(env.post(booking({ slotId: slots[0].id })).code, 'SLOT_CLOSED');
});
test('booking grows the sheet after its initial row capacity is exhausted', () => {
  const env = ready(); const sheet = env.book.getSheetByName('예약 신청');
  sheet.maxRows = 1;
  assert.equal(env.post(booking()).ok, true);
  assert.equal(sheet.getMaxRows(), 501);
});
