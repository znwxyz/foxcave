import { api, configuration, dateLabel, currentMonth, makeElement, showError } from './common.js';

const loginForm = document.querySelector('#admin-login');
const workspace = document.querySelector('#admin-workspace');
const month = document.querySelector('#admin-month');
const message = document.querySelector('#admin-message');
const LABELS = { pending: '확인 대기', confirmed: '예약 확정', cancelled: '취소', declined: '진행 불가', contacted: '연락 완료' };
month.value = currentMonth();
configuration.then(({ isPreview }) => { document.querySelector('#preview-login').hidden = !isPreview; });
async function login(isPreview = false) {
  showError(document.querySelector('#login-error'), '');
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ preview: isPreview, password: loginForm.elements.password.value }) });
    loginForm.reset(); await load();
  } catch (error) { showError(document.querySelector('#login-error'), error.message); }
}
function requestCard(request) {
  const card = makeElement('article', '', 'fc-admin-request');
  card.dataset.requestId = request.id;
  card.append(makeElement('span', LABELS[request.status], 'fc-admin-tag'),
    makeElement('h3', `${request.name} · ${request.party}명 · ${request.kind === 'class' ? '원데이클래스' : request.kind === 'lecture' ? '외부 강의' : '일반 문의'}`));
  const phone = makeElement('a', request.phone); phone.href = `tel:${request.phone}`;
  const contact = makeElement('p'); contact.append(phone);
  card.append(contact, makeElement('p', request.start ? dateLabel(request.start) : `희망일: ${request.desiredDate || '미정'} · 기관: ${request.organization || '미기재'}`));
  if (request.message) card.append(makeElement('p', request.message));
  card.append(makeElement('p', `유입: ${request.channel} · 접수: ${dateLabel(request.createdAt)} · 번호: ${request.id.slice(0, 8)}`, 'fc-fine'));
  const actions = makeElement('div', '', 'fc-admin-request-actions');
  if (!['cancelled', 'declined'].includes(request.status)) {
    const options = request.kind === 'class' ? [['confirmed', '이 신청 확정하기'], ['cancelled', '이 신청 취소하기']] : [['contacted', '연락 완료로 표시하기']];
    if (request.status === 'pending') options.push(['declined', '진행 불가로 표시하기']);
    options.filter(([status]) => status !== request.status).forEach(([status, label]) => {
      const button = makeElement('button', label); button.dataset.status = status;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await api(`/api/admin/requests/${request.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
          message.textContent = `신청을 ${LABELS[status]} 상태로 변경했어요. 확인 링크에도 반영됩니다.`; await load(); }
        catch (error) { message.textContent = error.message; button.disabled = false; }
      });
      actions.append(button);
    });
  }
  card.append(actions); return card;
}
function slotCard(slot) {
  const card = makeElement('article', '', 'fc-admin-slot');
  card.append(makeElement('strong', dateLabel(slot.start)), makeElement('p', `${slot.duration}분 · 최대 ${slot.maxParty}명 · ${slot.isAvailable ? '신청 가능' : '접수 마감'}`));
  const button = makeElement('button', slot.isOpen ? '일정 접수 닫기' : '일정 접수 열기', 'fc-text-button');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await api(`/api/admin/slots/${slot.id}`, { method: 'PATCH', body: JSON.stringify({ isOpen: !slot.isOpen }) }); await load(); }
    catch (error) { message.textContent = error.message; button.disabled = false; }
  });
  card.append(button); return card;
}
async function load() {
  try {
    const [requests, result] = await Promise.all([api('/api/admin/requests'), api(`/api/slots?month=${month.value}`)]);
    workspace.hidden = false; loginForm.hidden = true;
    document.querySelector('#admin-requests').replaceChildren(...(requests.length ? requests.map(requestCard) : [makeElement('p', '아직 접수된 신청이 없어요. 열어둔 일정에서 신청이 들어오면 여기에 표시됩니다.', 'fc-empty')]));
    document.querySelector('#admin-slots').replaceChildren(...(result.slots.length ? result.slots.map(slotCard) : [makeElement('p', '이 달에 열린 일정이 없어요. 위에서 진행 가능한 날짜를 열어 주세요.', 'fc-empty')]));
  } catch (error) { message.textContent = error.message; workspace.hidden = true; loginForm.hidden = false; }
}
loginForm.addEventListener('submit', (event) => { event.preventDefault(); login(); });
document.querySelector('#preview-login').addEventListener('click', () => login(true));
document.querySelector('#admin-refresh').addEventListener('click', load);
month.addEventListener('change', load);
document.querySelector('#slot-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const input = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button'); button.disabled = true;
  try {
    await api('/api/admin/slots', { method: 'POST', body: JSON.stringify({
      start: `${input.date}T${input.time}:00+09:00`, duration: Number(input.duration), maxParty: Number(input.maxParty) }) });
    month.value = input.date.slice(0, 7); message.textContent = '일정을 열었어요. 손님 일정표에도 반영됩니다.'; await load();
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
});
document.querySelector('#admin-logout').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); workspace.hidden = true; loginForm.hidden = false; }
  catch (error) { message.textContent = error.message; }
});
load();
