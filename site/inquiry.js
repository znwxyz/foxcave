import { api, formValue, showError } from './common.js';

const form = document.querySelector('#inquiry-form');
const errorNode = document.querySelector('#form-error');
if (new URLSearchParams(location.search).get('kind') === 'question') form.elements.kind.value = 'question';
form.addEventListener('submit', async (event) => {
  event.preventDefault(); showError(errorNode, '');
  if (!form.reportValidity()) return;
  const button = form.querySelector('[type=submit]'); button.disabled = true; button.textContent = '문의를 접수하고 있어요';
  try {
    const result = await api('/foxcave/api/requests', { method: 'POST', body: JSON.stringify(formValue(form)) });
    location.href = `/foxcave/booking/status/#${result.token}`;
  } catch (error) {
    showError(errorNode, error.message); button.disabled = false; button.textContent = '문의 남기기 ↗';
  }
});
