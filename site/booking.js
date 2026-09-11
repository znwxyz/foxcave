import { api, dateLabel, currentMonth, makeElement, formValue, showError } from './common.js';

const form = document.querySelector('#booking-form');
const grid = document.querySelector('#calendar-grid');
const slotArea = document.querySelector('#day-slots');
const message = document.querySelector('#calendar-message');
const errorNode = document.querySelector('#form-error');
const state = { month: currentMonth(), slots: [], selectedDay: null, selectedSlot: null, requestNumber: 0 };
function clearSelection() {
  state.selectedSlot = null;
  form.elements.slotId.value = '';
  document.querySelector('#selected-slot').textContent = '날짜와 시간을 먼저 선택해 주세요';
}
function dayButton(date, number) {
  const slots = state.slots.filter((slot) => slot.start.startsWith(date));
  const available = slots.some((slot) => slot.isAvailable);
  const button = makeElement('button', String(number), 'fc-calendar-day');
  button.type = 'button'; button.disabled = slots.length === 0;
  button.classList.toggle('has-slot', available);
  button.classList.toggle('is-selected', state.selectedDay === date);
  button.setAttribute('aria-pressed', String(state.selectedDay === date));
  button.setAttribute('aria-label', `${date}, ${available ? '신청 가능' : slots.length ? '마감' : '열린 일정 없음'}`);
  button.dataset.date = date;
  button.append(makeElement('small', available ? '신청 가능' : slots.length ? '마감' : '—'));
  button.addEventListener('click', () => {
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
  state.selectedSlot = slot;
  form.elements.slotId.value = slot.id;
  const options = Array.from({ length: slot.maxParty }, (_, index) => {
    const option = makeElement('option', `${index + 1}명`); option.value = index + 1; return option;
  });
  const oldParty = Number(form.elements.party.value);
  form.elements.party.replaceChildren(...options);
  form.elements.party.value = String(Math.min(oldParty, slot.maxParty));
  document.querySelector('#selected-slot').textContent = `${dateLabel(slot.start)} · ${slot.duration}분 · 한 팀 진행`;
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
    const title = makeElement('span', slot.start.slice(11, 16));
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
  const number = ++state.requestNumber;
  try {
    const result = await api(`/foxcave/api/slots?month=${state.month}`);
    if (number !== state.requestNumber) return;
    state.slots = result.slots;
    const selected = state.slots.find((slot) => slot.id === state.selectedSlot?.id);
    if (state.selectedSlot && !selected?.isAvailable) {
      clearSelection(); showError(errorNode, '선택한 일정의 접수 상태가 바뀌었어요. 다른 일정을 선택해 주세요.');
    }
    const time = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(result.updatedAt));
    message.textContent = state.slots.some((slot) => slot.isAvailable) ? `${time} 확인 · 15초마다 일정을 새로 확인합니다.` : '이번 달에 열린 일정이 없어요. 다음 달을 보거나 희망 날짜를 문의해 주세요.';
    renderCalendar(); renderSlots();
  } catch (error) {
    if (number !== state.requestNumber) return;
    state.slots = []; clearSelection(); renderCalendar(); renderSlots();
    message.textContent = `${error.message} 아래에서 일정을 다시 확인할 수 있어요.`;
  }
}
function shiftMonth(amount) {
  const [year, month] = state.month.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + amount, 1));
  state.month = next.toISOString().slice(0, 7);
  state.selectedDay = null; state.slots = []; clearSelection(); renderCalendar(); renderSlots(); refresh();
}
form.addEventListener('submit', async (event) => {
  event.preventDefault(); showError(errorNode, '');
  if (!state.selectedSlot) { showError(errorNode, '날짜와 시간을 먼저 선택해 주세요.'); document.querySelector('#calendar-month').scrollIntoView(); return; }
  if (!form.reportValidity()) return;
  const button = form.querySelector('[type=submit]'); button.disabled = true; button.textContent = '신청 내용을 접수하고 있어요';
  try {
    const result = await api('/foxcave/api/requests', { method: 'POST', body: JSON.stringify(formValue(form)) });
    location.href = `/foxcave/booking/status/#${result.token}`;
  } catch (error) {
    showError(errorNode, error.message); await refresh(); button.disabled = false; button.textContent = '예약 신청하기 ▸';
  }
});
document.querySelector('#month-prev').addEventListener('click', () => shiftMonth(-1));
document.querySelector('#month-next').addEventListener('click', () => shiftMonth(1));
document.querySelector('#calendar-retry').addEventListener('click', refresh);
form.elements.party.addEventListener('change', renderPrice);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 15000);
renderCalendar(); refresh();
