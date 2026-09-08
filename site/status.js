import { api, dateLabel, makeElement } from './common.js';

const token = location.hash.slice(1);
const node = document.querySelector('#request-status');
const feedback = document.querySelector('#status-feedback');
const HEADERS = { 'x-reservation-key': token };
const LABELS = { pending: '신청이 접수되었어요', confirmed: '예약이 확정되었어요', cancelled: '신청이 취소되었어요',
  declined: '이번 일정은 진행이 어려워요', contacted: '상담 안내를 진행했어요' };
const DETAILS = { pending: '아직 예약 확정 전입니다. 신청 내용을 확인하고 연락드릴게요.',
  confirmed: '확인된 일정에 맞춰 방문해 주세요. 변경이 필요하면 전화로 알려 주세요.',
  cancelled: '신청 진행이 중단되었습니다. 다른 일정은 다시 신청할 수 있어요.',
  declined: '다른 날짜를 선택하거나 전화로 일정을 의논해 주세요.',
  contacted: '외부 강의와 기타 문의의 최종 일정·비용은 담당자와 나눈 안내를 확인해 주세요.' };
async function refresh() {
  try {
    const request = await api('/api/request', { headers: HEADERS });
    node.replaceChildren(makeElement('span', request.kind === 'class' ? '원데이클래스' : '외부 강의 · 문의', 'fc-pill'),
      makeElement('h2', LABELS[request.status]), makeElement('p', DETAILS[request.status]),
      makeElement('p', request.start ? `${dateLabel(request.start)} · ${request.duration}분 · ${request.party}명` : `예상 참여 인원 ${request.party}명`),
      makeElement('p', `접수 번호 ${request.id.slice(0, 8)}`, 'fc-fine'));
    document.querySelector('#cancel-panel').hidden = ['cancelled', 'declined'].includes(request.status);
  } catch (error) { node.replaceChildren(makeElement('h2', '신청 내역을 확인해 주세요'), makeElement('p', error.message)); }
}
document.querySelector('#copy-status').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); feedback.textContent = '확인 링크를 복사했어요. 안전한 곳에 저장해 주세요.'; }
  catch { feedback.textContent = '자동 복사가 어려워요. 주소창의 링크를 직접 복사해 주세요.'; }
});
document.querySelector('#refresh-status').addEventListener('click', refresh);
document.querySelector('#cancel-request').addEventListener('click', async (event) => {
  const button = event.currentTarget; button.disabled = true;
  try { await api('/api/request/cancel', { method: 'POST', headers: HEADERS, body: '{}' }); await refresh(); }
  catch (error) { feedback.textContent = error.message; }
  finally { button.disabled = false; }
});
setInterval(() => { if (!document.hidden) refresh(); }, 15000);
refresh();
