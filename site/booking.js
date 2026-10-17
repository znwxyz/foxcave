import { dateLabel, currentMonth, makeElement, formValue, showError } from './common.js?v=20261017b';
import { loadSlots, submitBooking } from './booking-service.js?v=20261017';

const form = document.querySelector('#booking-form');
const grid = document.querySelector('#calendar-grid');
const slotArea = document.querySelector('#day-slots');
const message = document.querySelector('#calendar-message');
const errorNode = document.querySelector('#form-error');
const state = { month: currentMonth(), slots: [], selectedDay: null, selectedSlot: null, requestNumber: 0, submitting: false, completed: false, pendingValues: null };
const submitButton = form.querySelector('[type=submit]');
submitButton.disabled = true;
// Slot timestamps include +09:00, so this also works outside Korea.
const isUpcoming = (slot) => Date.parse(slot.start) > Date.now();
const emptyMonthMessage = '이번 달에 열린 일정이 없어요. 다음 달을 보거나 희망 날짜를 문의해 주세요.';
const endTime = (slot) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(Date.parse(slot.start) + slot.duration * 60000));
function clearSelection() {
  state.selectedSlot = null;
  form.elements.slotId.value = '';
  document.querySelector('#selected-slot').textContent = '날짜와 시간을 먼저 선택해 주세요';
}
function expireSlots() {
  // An uncertain submission must keep its original values for receipt recovery.
  if (state.submitting || state.completed || state.pendingValues) return;
  const upcoming = state.slots.filter(isUpcoming);
  if (upcoming.length === state.slots.length) return;
  state.slots = upcoming;
  if (state.selectedSlot && !isUpcoming(state.selectedSlot)) {
    clearSelection(); showError(errorNode, '선택한 수업의 시작 시간이 지났어요. 다른 일정을 선택해 주세요.');
  }
  if (!state.slots.some((slot) => slot.start.startsWith(state.selectedDay ?? '!'))) state.selectedDay = null;
  submitButton.disabled = !state.slots.some((slot) => slot.isAvailable);
  if (submitButton.disabled) message.textContent = emptyMonthMessage;
  renderCalendar(); renderSlots();
}
function dayButton(date, number) {
  const slots = state.slots.filter((slot) => slot.start.startsWith(date));
  const available = slots.some((slot) => slot.isAvailable);
  const button = makeElement('button', String(number), 'fc-calendar-day');
  button.type = 'button'; button.disabled = slots.length === 0;
  button.classList.toggle('has-slot', available);
  button.classList.toggle('is-selected', state.selectedDay === date);
  button.setAttribute('aria-pressed', String(state.selectedDay === date));
  button.setAttribute('aria-label', `${date}, ${available ? '신청 가능' : '마감'}`);
  button.dataset.date = date;
  button.append(makeElement('small', available ? '신청 가능' : '마감'));
  button.addEventListener('click', () => {
    if (state.submitting || state.completed || state.pendingValues) return;
    if (state.selectedDay !== date) clearSelection();
    state.selectedDay = date; renderCalendar(); renderSlots();
  });
  return button;
}
function renderCalendar() {
  const focusedDate = document.activeElement?.dataset.date;
  const [year, month] = state.month.split('-').map(Number);
  document.querySelector('#calendar-month').textContent = `${year}년 ${month}월`;
  document.querySelector('#month-prev').disabled = state.month <= currentMonth();
  const weekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = Array.from({ length: weekday }, () => makeElement('span'));
  for (let day = 1; day <= count; day++) cells.push(dayButton(`${state.month}-${String(day).padStart(2, '0')}`, day));
  grid.replaceChildren(...cells);
  if (focusedDate) grid.querySelector(`[data-date="${focusedDate}"]`)?.focus({ preventScroll: true });
}
function selectSlot(slot) {
  if (state.submitting || state.completed || state.pendingValues) return;
  if (!isUpcoming(slot)) { expireSlots(); return; }
  state.selectedSlot = slot;
  form.elements.slotId.value = slot.id;
  const options = Array.from({ length: slot.maxParty }, (_, index) => {
    const option = makeElement('option', `${index + 1}명`); option.value = index + 1; return option;
  });
  const oldParty = Number(form.elements.party.value);
  form.elements.party.replaceChildren(...options);
  form.elements.party.value = String(Math.min(oldParty, slot.maxParty));
  document.querySelector('#selected-slot').textContent = `${dateLabel(slot.start)}~${endTime(slot)} · ${slot.duration}분 · 한 팀 진행`;
  renderPrice(); renderSlots();
}
function renderSlots() {
  const focusedSlot = document.activeElement?.dataset.slotId;
  const slots = state.slots.filter((slot) => slot.start.startsWith(state.selectedDay ?? '!'));
  if (!state.selectedDay) { slotArea.replaceChildren(makeElement('p', '신청 가능한 날짜를 선택해 주세요.', 'fc-empty')); return; }
  const heading = makeElement('h3', `${state.selectedDay.slice(5).replace('-', '월 ')}일의 클래스`);
  const buttons = slots.map((slot) => {
    const button = makeElement('button', '', 'fc-slot-option'); button.type = 'button';
    button.dataset.slotId = slot.id;
    button.classList.toggle('is-selected', state.selectedSlot?.id === slot.id);
    button.setAttribute('aria-pressed', String(state.selectedSlot?.id === slot.id));
    button.disabled = !slot.isAvailable;
    const title = makeElement('span', `${slot.start.slice(11, 16)}~${endTime(slot)}`);
    title.append(makeElement('small', `${slot.duration}분 · 최대 ${slot.maxParty}명 · 한 팀 진행`));
    button.append(title, makeElement('span', slot.isAvailable ? '이 시간 선택' : '마감'));
    button.addEventListener('click', () => selectSlot(slot)); return button;
  });
  slotArea.replaceChildren(heading, ...buttons);
  if (focusedSlot) slotArea.querySelector(`[data-slot-id="${focusedSlot}"]`)?.focus({ preventScroll: true });
}
function renderPrice() {
  const count = Number(form.elements.party.value);
  document.querySelector('#booking-price').textContent = count === 1 ? '35,000원' : count === 2 ? '65,000원' : '상담 후 안내';
}
async function refresh() {
  if (state.submitting || state.completed || state.pendingValues) return;
  const number = ++state.requestNumber;
  try {
    const result = await loadSlots(state.month);
    if (number !== state.requestNumber || state.submitting || state.completed) return;
    state.slots = result.slots.filter(isUpcoming);
    submitButton.disabled = !state.slots.some((slot) => slot.isAvailable);
    const selected = state.slots.find((slot) => slot.id === state.selectedSlot?.id);
    if (state.selectedSlot && !selected?.isAvailable) {
      clearSelection(); showError(errorNode, '선택한 일정의 접수 상태가 바뀌었어요. 다른 일정을 선택해 주세요.');
    }
    const time = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(result.updatedAt));
    message.textContent = state.slots.some((slot) => slot.isAvailable) ? `${time} 확인 · 신청 후 확인 연락을 받아야 예약이 확정됩니다.` : emptyMonthMessage;
    renderCalendar(); renderSlots();
  } catch (error) {
    if (number !== state.requestNumber || state.submitting || state.completed) return;
    state.slots = []; clearSelection(); renderCalendar(); renderSlots();
    submitButton.disabled = true;
    message.textContent = `${error.message} 아래에서 일정을 다시 확인할 수 있어요.`;
  }
}
function shiftMonth(amount) {
  if (state.submitting || state.completed || state.pendingValues) return;
  const [year, month] = state.month.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + amount, 1));
  state.month = next.toISOString().slice(0, 7);
  state.selectedDay = null; state.slots = []; submitButton.disabled = true; clearSelection(); renderCalendar(); renderSlots(); refresh();
}
form.addEventListener('submit', async (event) => {
  event.preventDefault(); showError(errorNode, '');
  if (state.submitting || state.completed) return;
  if (!state.pendingValues && state.selectedSlot && !isUpcoming(state.selectedSlot)) { expireSlots(); return; }
  if (!state.selectedSlot) { showError(errorNode, '날짜와 시간을 먼저 선택해 주세요.'); document.querySelector('#calendar-month').scrollIntoView(); return; }
  if (!state.pendingValues && !form.reportValidity()) return;
  const values = state.pendingValues || formValue(form);
  values.name = values.name.trim();
  values.phone = values.phone.replace(/[\s-]/g, '');
  values.message = values.message.trim();
  if (!values.name) { showError(errorNode, '이름을 입력해 주세요.'); form.elements.name.focus(); return; }
  if (!/^01[016789]\d{7,8}$/.test(values.phone)) { showError(errorNode, '휴대폰 번호를 확인해 주세요.'); form.elements.phone.focus(); return; }
  state.submitting = true;
  state.requestNumber++;
  const fields = [...form.querySelectorAll('input, select, textarea, button')];
  fields.forEach((field) => { field.disabled = true; });
  form.setAttribute('aria-busy', 'true');
  submitButton.textContent = '신청 내용을 접수하고 있어요';
  try {
    const receipt = await submitBooking(values);
    state.completed = true;
    const bookedStart = Date.parse(receipt.start);
    const bookedEnd = bookedStart + receipt.duration * 60000;
    state.slots = state.slots.map((slot) => {
      const start = Date.parse(slot.start);
      return start < bookedEnd && bookedStart < start + slot.duration * 60000 ? { ...slot, isAvailable: false } : slot;
    });
    renderCalendar(); renderSlots();
    message.textContent = '신청하신 시간대는 접수가 마감되었습니다. 확인 연락 후 예약이 확정됩니다.';
    const confirmation = document.querySelector('#booking-confirmation');
    document.querySelector('#receipt-details').textContent = `${dateLabel(receipt.start)}~${endTime(receipt)} · ${receipt.duration}분 · ${receipt.party}명`;
    document.querySelector('#receipt-number').textContent = receipt.id;
    form.hidden = true;
    confirmation.hidden = false;
    confirmation.focus();
    confirmation.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    showError(errorNode, error.message);
    // Keep the exact selection after an uncertain response so retries use the same ID.
    state.pendingValues = error.uncertain ? values : null;
    fields.forEach((field) => { field.disabled = Boolean(state.pendingValues); });
    submitButton.disabled = false;
    submitButton.textContent = state.pendingValues ? '같은 신청 다시 확인하기 ▸' : '예약 신청하기 ▸';
  } finally {
    state.submitting = false;
    form.removeAttribute('aria-busy');
  }
});
document.querySelector('#month-prev').addEventListener('click', () => shiftMonth(-1));
document.querySelector('#month-next').addEventListener('click', () => shiftMonth(1));
document.querySelector('#calendar-retry').addEventListener('click', refresh);
form.elements.party.addEventListener('change', renderPrice);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { expireSlots(); refresh(); } });
// This only updates the page; Google is still queried at the existing interval.
setInterval(() => { if (!document.hidden) expireSlots(); }, 1000);
setInterval(() => { if (!document.hidden && !state.selectedSlot) refresh(); }, 60000);
renderCalendar(); refresh();
