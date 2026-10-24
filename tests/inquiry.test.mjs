import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, booking, inquiry } from './apps-script-harness.mjs';

const ready = () => { const env = createHarness(); env.setup(); env.run('enableWeeklyEveningSchedule'); return env; };

test('upgrade adds the inquiry tab without replacing bookings, schedules, modes or triggers', () => {
  const env = ready(); env.book.sheets.delete('단체 강의·일반 문의');
  env.post(booking({ slotId: '2026-10-20T19:00:00+09:00' }));
  env.run('useProductionRecipient');
  const rows = structuredClone(env.requests());
  const slots = env.get({ action: 'slots', month: '2026-10' });
  env.setup(); env.post(inquiry({ origin: 'https://xn--bf0b077b2qa.com' }));
  env.setup();
  assert.deepEqual(env.requests(), rows);
  assert.deepEqual(env.get({ action: 'slots', month: '2026-10' }), slots);
  assert.equal(env.creates, 1); assert.equal(env.inquiries().length, 1);
  assert.equal(env.properties.DELIVERY_MODE, 'PRODUCTION');
  assert.deepEqual(env.triggers, ['retryPendingNotifications']);
  assert.ok(env.get({ action: 'health' }).capabilities.includes('inquiry'));
});

test('lecture inquiry saves in its own tab, sends bold fields with its row link and never closes slots', () => {
  const env = ready(); const before = env.get({ action: 'slots', month: '2026-10' });
  const input = inquiry(); const result = env.post(input); const row = env.inquiries()[0];
  assert.deepEqual(result.receipt, { id: input.requestId, status: 'received', kind: 'lecture' });
  assert.deepEqual(row.slice(2, 11), ['단체 강의', input.organization, 30, input.name, '01000000000', '2026-11-08', input.message, '동의', '접수']);
  assert.equal(row[11], '발송 완료'); assert.equal(env.requests().length, 0);
  assert.equal(env.mail[0].to, 'replate.kr@gmail.com');
  assert.equal(env.mail[0].subject, '[TEST] [여우굴] 단체 강의 접수');
  assert.match(env.mail[0].body, /#gid=3&range=A2:S2/);
  for (const label of ['접수번호', '문의 종류', '기관·모임 이름', '이름', '연락처', '희망 날짜', '예상 참여 인원', '문의 내용']) {
    assert.ok(env.mail[0].htmlBody.includes('<strong style="font-weight:700">' + label + ':</strong>'));
  }
  for (const status of ['접수', '상담 중', '상담 완료', '종료']) {
    row[10] = status;
    assert.deepEqual(env.get({ action: 'slots', month: '2026-10' }), before);
  }
  const publicData = JSON.stringify([result, env.get({ action: 'health' }), before]);
  for (const privateValue of ['01000000000', input.name, input.organization, input.message, 'test-private-sheet', '@gmail']) assert.ok(!publicData.includes(privateValue));
});

test('general questions allow blank organization, date and party; lectures allow up to 200 without class limits', () => {
  const env = ready();
  assert.equal(env.post(inquiry({ kind: 'question', organization: '', desiredDate: '', party: null })).ok, true);
  assert.equal(env.inquiries()[0][4], ''); assert.equal(env.inquiries()[0][7], '');
  assert.equal(env.mail[0].subject, '[TEST] [여우굴] 일반 문의 접수');
  assert.match(env.mail[0].body, /예상 참여 인원: 미정/);
  assert.equal(env.post(inquiry({ party: 200 })).ok, true);
  assert.equal(env.post(inquiry({ party: 201 })).code, 'BAD_PARTY');
  assert.equal(env.post(inquiry({ party: null })).code, 'BAD_PARTY');
});

test('inquiry replay returns the original receipt even after the desired date and status change', () => {
  const env = ready(); const input = inquiry(); const first = env.post(input);
  env.now = Date.parse('2026-11-10T00:00:00+09:00'); env.inquiries()[0][10] = '상담 완료';
  assert.deepEqual(env.post(input), first);
  assert.equal(env.inquiries().length, 1); assert.equal(env.mail.length, 1);
  assert.equal(env.post({ ...input, message: '변경된 문의' }).code, 'ID_CONFLICT');
});

test('invalid inquiry input is rejected without writing or mailing', () => {
  for (const changes of [{ kind: 'class' }, { kind: '__proto__' }, { requestId: 'bad' }, { consent: false }, { website: 'spam' },
    { name: '' }, { name: 'a'.repeat(61) }, { name: 'a\nb' }, { organization: 'a'.repeat(101) }, { organization: 'a\nb' },
    { phone: '010' }, { message: '' }, { message: 'a'.repeat(2001) }, { party: 0 }, { party: 201 }, { party: 1.5 }, { party: '2' },
    { desiredDate: '2026-02-30' }, { desiredDate: '2026-10-16' }, { desiredDate: '2026-13-01' }, { desiredDate: 'tomorrow' },
    { origin: 'https://attacker.example' }]) {
    const env = ready();
    assert.equal(env.post(inquiry(changes)).ok, false, JSON.stringify(changes));
    assert.equal(env.inquiries().length, 0); assert.equal(env.mail.length, 0);
  }
});

test('inquiry email escapes HTML and spreadsheet input uses plain text', () => {
  const env = ready();
  assert.equal(env.post(inquiry({ organization: '=HYPERLINK("bad")', message: '<img src=x>\n문의 & 답변' })).ok, true);
  assert.match(env.mail[0].htmlBody, /&lt;img src=x&gt;<br>문의 &amp; 답변/);
  assert.ok(!env.mail[0].htmlBody.includes('<img'));
  assert.ok(env.mail[0].htmlBody.includes('=HYPERLINK(&quot;bad&quot;)'));
});

test('booking and inquiry IDs cannot overwrite or impersonate each other', () => {
  const env = ready(); const first = inquiry(); env.post(first);
  assert.equal(env.post(booking({ requestId: first.requestId, slotId: '2026-10-20T19:00:00+09:00' })).code, 'ID_CONFLICT');
  const other = booking({ slotId: '2026-10-20T19:00:00+09:00' }); env.post(other);
  assert.equal(env.post(inquiry({ requestId: other.requestId })).code, 'ID_CONFLICT');
  assert.equal(env.requests().length, 1); assert.equal(env.inquiries().length, 1);
});

test('phone and daily limits cover bookings and inquiries together; retries still work', () => {
  const env = ready(); env.post(booking({ slotId: '2026-10-20T19:00:00+09:00' }));
  const input = inquiry(); env.post(input); env.post(inquiry());
  assert.equal(env.post(inquiry()).code, 'PHONE_LIMIT');
  assert.equal(env.post(booking({ slotId: '2026-10-20T20:30:00+09:00' })).code, 'PHONE_LIMIT');
  assert.equal(env.post(input).ok, true);
  const sheet = env.book.getSheetByName('단체 강의·일반 문의');
  while (env.requests().length + env.inquiries().length < 80) sheet.data.push([...sheet.data[1]]);
  assert.equal(env.post(inquiry({ phone: '01011112222' })).code, 'DAILY_LIMIT');
});

test('inquiry mail failure keeps the receipt and retries once with the right template and original recipient', () => {
  const env = ready(); env.mailFails = true; const input = inquiry();
  const first = env.post(input); assert.equal(first.ok, true);
  assert.equal(env.inquiries()[0][11], '재시도 대기'); assert.equal(env.mail.length, 0);
  env.run('useProductionRecipient'); env.mailFails = false; env.now += 11 * 60000;
  env.run('retryPendingNotifications'); env.run('retryPendingNotifications');
  assert.equal(env.mail.length, 1); assert.equal(env.mail[0].to, 'replate.kr@gmail.com');
  assert.equal(env.mail[0].subject, '[TEST] [여우굴] 단체 강의 접수');
  assert.equal(env.inquiries()[0][11], '발송 완료');
});

test('production inquiries use both recipients; exhausted quota queues mail and client overrides are ignored', () => {
  const env = ready(); env.run('useProductionRecipient'); env.quota = 1;
  assert.equal(env.post(inquiry()).code, 'BAD_ORIGIN');
  assert.equal(env.post(inquiry({ origin: 'https://xn--bf0b077b2qa.com', recipient: 'attacker@example.com', mode: 'TEST' })).ok, true);
  assert.equal(env.inquiries()[0][18], 'replate.kr@gmail.com,foxcavebrew@naver.com');
  assert.equal(env.inquiries()[0][11], '재시도 대기'); assert.equal(env.mail.length, 0);
  env.quota = 2; env.now += 11 * 60000; env.run('retryPendingNotifications');
  assert.equal(env.mail[0].to, 'replate.kr@gmail.com,foxcavebrew@naver.com');
  assert.equal(env.mail[0].subject, '[여우굴] 단체 강의 접수');
});

test('interrupted inquiry mail is flagged for review and never blindly resent', () => {
  const env = ready(); const sheet = env.book.getSheetByName('단체 강의·일반 문의');
  env.afterSend = () => { sheet.failWrites = true; };
  assert.equal(env.post(inquiry()).ok, true); assert.equal(env.mail.length, 1);
  sheet.failWrites = false; env.now += 16 * 60000; env.run('retryPendingNotifications');
  assert.equal(env.inquiries()[0][11], '확인 필요'); assert.equal(env.mail.length, 1);
});

test('missing inquiry setup stays closed while existing bookings work, and sheet capacity grows', () => {
  const env = ready(); env.book.sheets.delete('단체 강의·일반 문의');
  assert.deepEqual(env.get({ action: 'health' }).capabilities, ['booking']);
  assert.equal(env.post(inquiry()).code, 'SETUP');
  assert.equal(env.post(booking({ slotId: '2026-10-20T19:00:00+09:00' })).ok, true);
  env.setup(); const sheet = env.book.getSheetByName('단체 강의·일반 문의'); sheet.maxRows = 1;
  assert.equal(env.post(inquiry()).ok, true); assert.equal(sheet.maxRows, 501);
});

test('inquiries respect the shared lock', () => {
  const env = ready(); env.lockBusy = true;
  assert.equal(env.post(inquiry()).code, 'BUSY'); assert.equal(env.inquiries().length, 0);
});
