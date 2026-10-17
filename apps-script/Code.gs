/**
 * 여우굴 클래스 예약 — Google Apps Script V8
 * 1. Code.gs에 이 파일 전체 붙여넣기  2. setup 실행  3. 웹 앱 배포
 * 설치 순서: docs/google-apps-script-setup.md
 * 공개 API는 일정 조회와 접수만 제공합니다. 신청자 정보는 공개하지 않습니다.
 */
const FC = Object.freeze({
  VERSION: 1,
  OWNER_EMAIL: 'replate.kr@gmail.com',
  TEST_EMAIL: 'replate.kr@gmail.com',
  PRODUCTION_EMAIL: 'foxcavebrew@naver.com',
  ORIGINS: ['https://xn--bf0b077b2qa.com', 'https://www.xn--bf0b077b2qa.com'],
  TIMEZONE: 'Asia/Seoul',
  REQUESTS: '예약 신청',
  SLOTS: '수업 일정',
  DAILY_LIMIT: 80,
  PHONE_DAILY_LIMIT: 3,
  MAX_MAIL_ATTEMPTS: 3,
  WEEKLY_EVENING: Object.freeze({
    startDate: '2026-10-19', weekdays: Object.freeze([0, 1, 2]),
    times: Object.freeze(['19:00', '19:30', '20:00', '20:30']), duration: 90, maxParty: 2,
  }),
  SCHEDULE_NOTE: '자동 일정은 일·월·화 19:00 / 19:30 / 20:00 / 20:30 시작, 각 90분입니다. 같은 날짜·시작 시간의 수동 행이 우선합니다. 하루를 쉬려면 네 시간 모두 접수 열기를 해제하세요. 수동 행을 삭제하면 해당 시간의 자동 일정이 다시 적용됩니다.',
  HEADERS: ['접수번호', '접수일시', '수업일시', '소요시간 분', '인원', '이름', '휴대폰 번호', '유입 경로', '요청사항', '개인정보 동의', '예약 상태', '메일 상태', '메일 발송일시', '메일 시도 횟수', '최근 메일 시도', '메일 오류', '중복 확인값', '발송 모드', '알림 수신자'],
  SLOT_HEADERS: ['날짜 YYYY-MM-DD', '시작 시간 HH:mm', '소요시간 분', '최대 인원', '접수 열기'],
});
const COL = Object.freeze({ ID: 0, CREATED: 1, START: 2, DURATION: 3, PARTY: 4, NAME: 5, PHONE: 6, CHANNEL: 7, MESSAGE: 8, CONSENT: 9, STATUS: 10, MAIL: 11, SENT: 12, ATTEMPTS: 13, LAST_ATTEMPT: 14, ERROR: 15, DIGEST: 16, MODE: 17, RECIPIENT: 18 });
const CHANNELS = Object.freeze({ unknown: '선택 안 함', search: '검색·네이버 지도', instagram: '인스타그램', friend: '지인 소개', other: '기타' });

// 처음 한 번 실행합니다. 재실행해도 기존 신청과 일정을 지우지 않습니다.
function setup() {
  const properties = PropertiesService.getScriptProperties();
  let id = properties.getProperty('SPREADSHEET_ID');
  const book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('여우굴 클래스 예약');
  if (!id) properties.setProperty('SPREADSHEET_ID', book.getId());
  if (!properties.getProperty('DELIVERY_MODE')) properties.setProperty('DELIVERY_MODE', 'TEST');
  book.setSpreadsheetTimeZone(FC.TIMEZONE);
  const requests = prepareSheet_(book, FC.REQUESTS, FC.HEADERS);
  const slots = prepareSheet_(book, FC.SLOTS, FC.SLOT_HEADERS);
  requests.getRange('G:G').setNumberFormat('@');
  slots.getRange('A:B').setNumberFormat('@');
  const statusRule = SpreadsheetApp.newDataValidation().requireValueInList(['접수 대기', '예약 확정', '취소', '진행 불가'], true).setAllowInvalid(false).build();
  requests.getRange('K2:K1000').setDataValidation(statusRule);
  slots.getRange('E2:E1000').setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  slots.getRange('A1').setNote(FC.SCHEDULE_NOTE);
  requests.getRange('L1').setNote('발송 완료는 MailApp의 발송 처리 성공입니다. 받은편지함 도착 여부는 수신 메일함에서 확인합니다.');
  requests.getRange('Q1').setNote('중복 접수 방지용입니다. A열과 Q:S열은 수정하지 마세요.');
  if (!ScriptApp.getProjectTriggers().some((trigger) => trigger.getHandlerFunction() === 'retryPendingNotifications')) {
    ScriptApp.newTrigger('retryPendingNotifications').timeBased().everyMinutes(10).create();
  }
  // 메일 권한을 첫 설치에서 함께 승인받습니다. 메일은 보내지 않습니다.
  MailApp.getRemainingDailyQuota();
  console.log('설정 완료. 시트: ' + book.getUrl() + '\n현재 모드: ' + delivery_().mode + '\n수업 일정 탭에 일정을 등록하세요.');
}

// 정식 도메인에서도 실제 시트 저장 + 리플레잇 단독 수신으로 점검합니다.
// 함수 실행은 설정만 바꾸며 메일을 보내거나 예약을 추가하지 않습니다.
function useProductionRecipientTest() {
  PropertiesService.getScriptProperties().setProperty('DELIVERY_MODE', 'TEST');
  console.log('정식 도메인 테스트 모드: 여우굴.com에서 신청하면 실제 시트에 저장하고 ' + FC.TEST_EMAIL + '에만 알림을 보냅니다.\n설정 변경 완료. 다음 신청부터 적용됩니다.');
}

// 이전 가이드와의 호환성을 위해 유지합니다. 위 함수와 같은 설정입니다.
function useTestRecipient() { useProductionRecipientTest(); }

function useProductionRecipient() {
  PropertiesService.getScriptProperties().setProperty('DELIVERY_MODE', 'PRODUCTION');
  console.log('앞으로 접수되는 신청의 알림 수신자: ' + productionRecipients_());
}

// 2026-10-19부터 일·월·화, 종료일 없음. 기존 활성화 설정 키를 유지합니다.
function enableWeeklyEveningSchedule() {
  book_().getSheetByName(FC.SLOTS).getRange('A1').setNote(FC.SCHEDULE_NOTE);
  PropertiesService.getScriptProperties().setProperty('DAILY_EVENING_ENABLED', 'true');
  console.log('주간 일정 활성화: 2026-10-19부터 일·월·화, 시작 19:00 / 19:30 / 20:00 / 20:30, 각 90분, 최대 2명·한 팀. 종료일 없음.\n19:00 예약 후 20:30 예약 가능, 19:30 또는 20:00 예약 후 해당 날짜 마감.\n수업 일정의 수동 행이 우선하므로 예전 60분 일정과 테스트 행을 확인하세요. 기존 신청과 이메일 모드는 유지됩니다.');
}

function disableWeeklyEveningSchedule() {
  PropertiesService.getScriptProperties().setProperty('DAILY_EVENING_ENABLED', 'false');
  console.log('주간 자동 일정 중지. 수업 일정 시트에 직접 등록한 일정은 그대로 유지됩니다.');
}

// 이전 함수 이름도 같은 주간 일정 설정을 사용합니다.
function enableDailyEveningSchedule() { enableWeeklyEveningSchedule(); }
function disableDailyEveningSchedule() { disableWeeklyEveningSchedule(); }

// 실제 발송 점검용. 항상 테스트 주소로만 보내고 예약 행은 추가하지 않습니다.
function sendTestEmail() {
  const book = book_();
  const row = [];
  row[COL.ID] = 'TEST-EMAIL-ONLY'; row[COL.MODE] = 'TEST';
  row[COL.START] = FC.WEEKLY_EVENING.startDate + 'T' + FC.WEEKLY_EVENING.times[0] + ':00+09:00';
  row[COL.DURATION] = FC.WEEKLY_EVENING.duration; row[COL.PARTY] = 2;
  row[COL.NAME] = '메일 서식 테스트'; row[COL.PHONE] = '010-0000-0000';
  row[COL.CHANNEL] = '테스트'; row[COL.MESSAGE] = '항목명이 굵게 표시되는지 확인해 주세요.\n실제 예약이 아닌 가상 예시입니다.';
  MailApp.sendEmail(Object.assign({ to: FC.TEST_EMAIL, name: '여우굴 예약 알림' }, bookingEmail_(row, book.getUrl(), true)));
  console.log('테스트 메일 발송 처리 완료. ' + FC.TEST_EMAIL + '의 받은편지함과 스팸함을 확인하세요.');
}

function doGet(event) {
  try {
    const params = event && event.parameter || {};
    if (params.action === 'health') {
      book_();
      return json_({ ok: true, mode: delivery_().mode });
    }
    if (params.action !== 'slots') fail_('BAD_ACTION', '지원하지 않는 요청입니다.');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(params.month || '')) fail_('BAD_MONTH', '조회할 달을 확인해 주세요.');
    const book = book_();
    const rows = rows_(book.getSheetByName(FC.REQUESTS), FC.HEADERS.length);
    const occupied = occupiedPeriods_(rows);
    const slots = readSlots_(book, params.month).map((slot) => ({
      id: slot.id, start: slot.start, duration: slot.duration, maxParty: slot.maxParty,
      isAvailable: slot.isOpen && Date.parse(slot.start) > Date.now() && !isOccupied_(slot, occupied),
    }));
    return json_({ ok: true, slots: slots, updatedAt: new Date().toISOString() });
  } catch (error) { return errorJson_(error); }
}

function doPost(event) {
  try {
    const raw = event && event.postData && event.postData.contents;
    if (typeof raw !== 'string' || raw.length > 16000) fail_('BAD_BODY', '신청 내용을 확인해 주세요.');
    let input;
    try { input = JSON.parse(raw); } catch (_) { fail_('BAD_BODY', '신청 내용을 확인해 주세요.'); }
    if (!input || input.action !== 'submit' || input.version !== FC.VERSION) fail_('BAD_ACTION', '예약 페이지를 새로 열어 주세요.');
    const delivery = delivery_();
    // origin is a guardrail, not authentication; rate limits and validation are also enforced.
    const local = delivery.mode === 'TEST' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(input.origin || '');
    if (!local && FC.ORIGINS.indexOf(input.origin) < 0) fail_('BAD_ORIGIN', '여우굴 홈페이지에서 신청해 주세요.');
    const data = validate_(input);
    return json_(withLock_(function () { return saveBooking_(data, delivery); }));
  } catch (error) { return errorJson_(error); }
}

function saveBooking_(data, delivery) {
  const book = book_();
  const sheet = book.getSheetByName(FC.REQUESTS);
  const rows = rows_(sheet, FC.HEADERS.length);
  const digest = digest_(JSON.stringify(data));
  const existingIndex = rows.findIndex((row) => row[COL.ID] === data.requestId);
  if (existingIndex >= 0) {
    const existing = rows[existingIndex];
    if (existing[COL.DIGEST] !== digest) fail_('ID_CONFLICT', '이전 신청과 내용이 다릅니다. 페이지를 새로 열고 다시 신청해 주세요.');
    // Respond with the original receipt even if the slot has since closed.
    return { ok: true, receipt: receipt_(existing) };
  }
  const today = date_(new Date(), 'yyyy-MM-dd');
  const todayRows = rows.filter((row) => String(row[COL.CREATED]).startsWith(today));
  if (todayRows.length >= FC.DAILY_LIMIT) fail_('DAILY_LIMIT', '오늘 온라인 접수가 많아 잠시 쉬고 있어요. 카카오톡이나 전화로 문의해 주세요.');
  if (todayRows.filter((row) => row[COL.PHONE] === data.phone).length >= FC.PHONE_DAILY_LIMIT) fail_('PHONE_LIMIT', '같은 연락처의 신청이 여러 건 접수되었어요. 추가 신청이나 변경은 카카오톡으로 문의해 주세요.');
  const slot = readSlots_(book, data.slotId.slice(0, 7)).find((candidate) => candidate.id === data.slotId);
  if (!slot || !slot.isOpen || Date.parse(slot.start) <= Date.now() || isOccupied_(slot, occupiedPeriods_(rows))) fail_('SLOT_CLOSED', '선택한 일정의 접수가 마감되었어요. 다른 일정을 선택해 주세요.');
  if (data.party > slot.maxParty) fail_('PARTY_LIMIT', '선택한 일정의 최대 인원을 확인해 주세요.');
  const row = [data.requestId, date_(new Date(), 'yyyy-MM-dd HH:mm:ss'), slot.start, slot.duration, data.party,
    data.name, data.phone, CHANNELS[data.channel], data.message, '동의', '접수 대기', '대기', '', 0, '', '', digest, delivery.mode, delivery.recipient];
  // Plain text also prevents spreadsheet formulas in user input.
  const rowNumber = sheet.getLastRow() + 1;
  if (rowNumber > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 500);
  sheet.getRange(rowNumber, 1, 1, row.length).setNumberFormat('@').setValues([row.map(sheetText_)]);
  sheet.getRange(rowNumber, COL.STATUS + 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['접수 대기', '예약 확정', '취소', '진행 불가'], true).setAllowInvalid(false).build());
  SpreadsheetApp.flush();
  // Saving is authoritative. Email failures never make a saved booking look rejected.
  try { notifyRow_(sheet, rowNumber, row, book); } catch (_) { console.error('Notification state could not be updated; inspect the private sheet.'); }
  return { ok: true, receipt: receipt_(row) };
}

function validate_(input) {
  if (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) fail_('BAD_ID', '페이지를 새로 열고 다시 신청해 주세요.');
  if (input.website) fail_('SPAM', '신청 내용을 확인해 주세요.');
  if (input.consent !== true) fail_('CONSENT', '개인정보 수집·이용 동의가 필요합니다.');
  if (input.kind !== 'class') fail_('BAD_KIND', '클래스 예약 페이지에서 신청해 주세요.');
  const name = text_(input.name, 60, true);
  if (/[\r\n]/.test(name)) fail_('BAD_NAME', '이름을 한 줄로 입력해 주세요.');
  const phone = text_(input.phone, 20, true).replace(/[\s-]/g, '');
  if (!/^01[016789]\d{7,8}$/.test(phone)) fail_('BAD_PHONE', '휴대폰 번호를 확인해 주세요.');
  if (!Number.isInteger(input.party) || input.party < 1 || input.party > 20) fail_('BAD_PARTY', '참여 인원을 확인해 주세요.');
  if (!Object.prototype.hasOwnProperty.call(CHANNELS, input.channel)) fail_('BAD_CHANNEL', '유입 경로를 다시 선택해 주세요.');
  const slotId = text_(input.slotId, 40, true);
  if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}T([01]\d|2[0-3]):[0-5]\d:00\+09:00$/.test(slotId)) fail_('BAD_SLOT', '날짜와 시간을 다시 선택해 주세요.');
  const message = text_(input.message, 2000, false);
  return { requestId: input.requestId.toLowerCase(), slotId: slotId, party: input.party, name: name, phone: phone, channel: input.channel, message: message, consent: true };
}

function readSlots_(book, month) {
  const sheet = book.getSheetByName(FC.SLOTS);
  if (!sheet) fail_('SETUP', '온라인 예약을 준비하고 있어요. 카카오톡으로 문의해 주세요.');
  const rows = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getDisplayValues();
  const ids = new Set();
  const manual = rows.filter((row) => row.some((value) => String(value).trim() && String(value) !== 'FALSE')).map((row) => {
    const date = String(row[0]).trim();
    const time = String(row[1]).trim();
    const start = date + 'T' + time + ':00+09:00';
    const duration = Number(row[2]);
    const maxParty = Number(row[3]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
      || !Number.isFinite(Date.parse(start)) || date_(new Date(start), 'yyyy-MM-dd') !== date
      || !Number.isInteger(duration) || duration < 30 || duration > 240
      || !Number.isInteger(maxParty) || maxParty < 1 || maxParty > 20 || ids.has(start)) {
      fail_('SCHEDULE_CONFIG', '수업 일정을 정리하고 있어요. 잠시 후 다시 확인하거나 카카오톡으로 문의해 주세요.');
    }
    ids.add(start);
    return { id: start, start: start, duration: duration, maxParty: maxParty, isOpen: String(row[4]).toUpperCase() === 'TRUE' };
  });
  // A manually entered date + start time overrides the recurring slot, including a closed checkbox.
  const merged = new Map(weeklyEveningSlots_(month).map((slot) => [slot.id, slot]));
  manual.filter((slot) => slot.start.startsWith(month)).forEach((slot) => merged.set(slot.id, slot));
  return Array.from(merged.values()).sort((a, b) => a.start.localeCompare(b.start));
}

function weeklyEveningSlots_(month) {
  if (PropertiesService.getScriptProperties().getProperty('DAILY_EVENING_ENABLED') !== 'true') return [];
  const settings = FC.WEEKLY_EVENING;
  const slots = [];
  for (let day = 1; day <= 31; day++) {
    const dayString = month + '-' + ('0' + day).slice(-2);
    // UTC midnight is used only to identify the weekday of this Korean calendar date.
    const date = new Date(dayString + 'T00:00:00Z');
    if (dayString < settings.startDate || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dayString
      || settings.weekdays.indexOf(date.getUTCDay()) < 0) continue;
    settings.times.forEach((time) => {
      const start = dayString + 'T' + time + ':00+09:00';
      slots.push({ id: start, start: start, duration: settings.duration, maxParty: settings.maxParty, isOpen: true });
    });
  }
  return slots;
}

function occupiedPeriods_(rows) {
  return rows.filter((row) => row[COL.ID] && ['취소', '진행 불가'].indexOf(row[COL.STATUS]) < 0).map((row) => {
    const start = Date.parse(row[COL.START]);
    return { id: row[COL.START], start: start, end: start + Number(row[COL.DURATION]) * 60000 };
  });
}

function isOccupied_(slot, occupied) {
  const start = Date.parse(slot.start);
  const end = start + slot.duration * 60000;
  return occupied.some((period) => period.id === slot.id || start < period.end && period.start < end);
}

function notifyRow_(sheet, number, row, book) {
  if (['발송 완료', '확인 필요', '전송 중', '재시도 종료'].indexOf(row[COL.MAIL]) >= 0) return;
  const attempts = Number(row[COL.ATTEMPTS]) || 0;
  if (attempts >= FC.MAX_MAIL_ATTEMPTS) { setMail_(sheet, number, row, '재시도 종료', ''); return; }
  // Keep recipients captured when the request was saved, including older single-recipient rows.
  if ([FC.TEST_EMAIL, FC.PRODUCTION_EMAIL, productionRecipients_()].indexOf(row[COL.RECIPIENT]) < 0) { setMail_(sheet, number, row, '확인 필요', '수신자 설정 확인 필요'); return; }
  const recipientCount = row[COL.RECIPIENT].split(',').length;
  if (MailApp.getRemainingDailyQuota() < recipientCount) { setMail_(sheet, number, row, '재시도 대기', '일일 이메일 잔여 한도 부족: 수신자 ' + recipientCount + '명 필요'); return; }
  row[COL.ATTEMPTS] = attempts + 1;
  row[COL.LAST_ATTEMPT] = new Date().toISOString();
  setMail_(sheet, number, row, '전송 중', '');
  SpreadsheetApp.flush();
  const link = book.getUrl() + '#gid=' + sheet.getSheetId() + '&range=A' + number + ':S' + number;
  try {
    MailApp.sendEmail(Object.assign({ to: row[COL.RECIPIENT], name: '여우굴 예약 알림' }, bookingEmail_(row, link)));
  } catch (_) {
    setMail_(sheet, number, row, attempts + 1 >= FC.MAX_MAIL_ATTEMPTS ? '재시도 종료' : '재시도 대기', '메일 발송 실패. 실행 내역과 발송 권한을 확인해 주세요.');
    return;
  }
  // If this update fails, leave '전송 중' for manual review rather than sending twice.
  row[COL.SENT] = date_(new Date(), 'yyyy-MM-dd HH:mm:ss');
  setMail_(sheet, number, row, '발송 완료', '');
}

function bookingEmail_(row, link, preview) {
  const test = row[COL.MODE] === 'TEST' ? '[TEST] ' : '';
  const title = test + (preview ? '여우굴 예약 이메일 미리보기' : '여우굴 클래스 예약 신청');
  const fields = [
    ['접수번호', row[COL.ID]],
    ['수업 일시', date_(new Date(row[COL.START]), 'yyyy-MM-dd HH:mm') + ' (한국 시간)'],
    ['참여 인원', row[COL.PARTY] + '명'], ['소요시간', row[COL.DURATION] + '분'],
    ['이름', row[COL.NAME]], ['연락처', row[COL.PHONE]], ['유입 경로', row[COL.CHANNEL]],
    ['요청사항', row[COL.MESSAGE] || '없음'],
  ];
  const note = preview ? '메일 서식 확인용 가상 예시입니다. 신청 행은 생성하지 않았으며 예약 시간도 마감되지 않습니다.'
    : '현재 상태는 접수 대기입니다. 고객에게 확인 연락 후 시트의 예약 상태를 변경해 주세요.';
  const linkLabel = preview ? '예약 시트 확인' : '신청 행 확인';
  return {
    subject: preview ? '[여우굴 TEST] 이메일 연결 확인' : test + '[여우굴] 클래스 예약 신청 · ' + date_(new Date(row[COL.START]), 'MM-dd HH:mm') + ' · ' + row[COL.PARTY] + '명',
    body: [title, '', note, '', ...fields.map((field) => field[0] + ': ' + field[1]), '', linkLabel + ': ' + link].join('\n'),
    htmlBody: '<div lang="ko" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#292724;max-width:640px">'
      + '<h2 style="font-size:20px;margin:0 0 16px">' + html_(title) + '</h2>'
      + '<p style="margin:0 0 20px;color:#666">' + html_(note) + '</p>'
      + fields.map((field) => '<p style="margin:0 0 12px;overflow-wrap:anywhere;word-break:break-word"><strong style="font-weight:700">'
        + html_(field[0]) + ':</strong> ' + html_(field[1]).replace(/\r\n|\r|\n/g, '<br>') + '</p>').join('')
      + '<p style="margin:20px 0 0"><a style="color:#6b4a30" href="' + html_(link) + '"><strong>' + linkLabel + '</strong></a></p></div>',
  };
}

function html_(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

// setup이 만든 10분 주기 트리거에서 실행합니다. 공개 웹 API로 실행할 수 없습니다.
function retryPendingNotifications() {
  withLock_(function () {
    const book = book_();
    const sheet = book.getSheetByName(FC.REQUESTS);
    const rows = rows_(sheet, FC.HEADERS.length);
    let processed = 0;
    rows.forEach((row, index) => {
      const age = Date.now() - Date.parse(row[COL.LAST_ATTEMPT] || '1970-01-01T00:00:00Z');
      if (row[COL.MAIL] === '전송 중' && age > 15 * 60 * 1000) {
        setMail_(sheet, index + 2, row, '확인 필요', '발송 중 실행이 중단되었습니다. 수신함 확인 후 처리하세요.');
      }
      if (processed < 10 && row[COL.ID] && ['대기', '재시도 대기'].indexOf(row[COL.MAIL]) >= 0 && age >= 10 * 60 * 1000) {
        processed++;
        notifyRow_(sheet, index + 2, row, book);
      }
    });
  });
}

function setMail_(sheet, number, row, state, error) {
  row[COL.MAIL] = state;
  row[COL.ERROR] = error;
  sheet.getRange(number, COL.MAIL + 1, 1, 5).setValues([row.slice(COL.MAIL, COL.ERROR + 1)]);
}
function receipt_(row) { return { id: row[COL.ID], status: 'received', start: row[COL.START], duration: Number(row[COL.DURATION]), party: Number(row[COL.PARTY]) }; }
function delivery_() {
  const mode = PropertiesService.getScriptProperties().getProperty('DELIVERY_MODE') || 'TEST';
  if (['TEST', 'PRODUCTION'].indexOf(mode) < 0) fail_('SETUP', '온라인 예약 설정을 확인 중입니다.');
  return { mode: mode, recipient: mode === 'PRODUCTION' ? productionRecipients_() : FC.TEST_EMAIL };
}
function productionRecipients_() { return [FC.OWNER_EMAIL, FC.PRODUCTION_EMAIL].join(','); }
function book_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) fail_('SETUP', '온라인 예약을 준비하고 있어요. 카카오톡으로 문의해 주세요.');
  return SpreadsheetApp.openById(id);
}
function prepareSheet_(book, name, headers) {
  const sheet = book.getSheetByName(name) || book.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (JSON.stringify(sheet.getRange(1, 1, 1, headers.length).getValues()[0]) !== JSON.stringify(headers)) throw new Error(name + ' 시트의 첫 행 제목을 확인하세요.');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8e0d5');
  return sheet;
}
function rows_(sheet, width) {
  if (!sheet) fail_('SETUP', '온라인 예약을 준비하고 있어요. 카카오톡으로 문의해 주세요.');
  return sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
}
function text_(value, max, required) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail_('BAD_FIELD', '입력 내용의 길이와 형식을 확인해 주세요.');
  const clean = value.trim();
  if (required && !clean) fail_('REQUIRED', '필수 항목을 입력해 주세요.');
  return clean;
}
function sheetText_(value) { return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value; }
function date_(date, format) { return Utilities.formatDate(date, FC.TIMEZONE, format); }
function digest_(text) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8).map((byte) => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join(''); }
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail_('BUSY', '다른 신청을 처리하고 있어요. 입력 내용을 유지한 채 잠시 후 다시 신청해 주세요.');
  try { return fn(); } finally { lock.releaseLock(); }
}
function fail_(code, message) { const error = new Error(message); error.code = code; throw error; }
function errorJson_(error) {
  if (!error.code) console.error('Booking service error; inspect configuration and execution status.');
  return json_({ ok: false, code: error.code || 'INTERNAL', error: error.code ? error.message : '접수 결과를 확인하지 못했어요. 입력 내용을 그대로 두고 다시 신청해 주세요.' });
}
function json_(data) { return ContentService.createTextOutput(JSON.stringify(Object.assign({ service: 'foxcave-booking', version: FC.VERSION }, data))).setMimeType(ContentService.MimeType.JSON); }
