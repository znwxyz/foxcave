const HANJI_SUBJECTS = Object.freeze({
  product: Object.freeze({
    heading: ['바삭한 전 한 접시', '곁들이는 하양한모금'],
    description: ['한 달의 발효·숙성으로 빚었습니다.', '맑고 가벼운 목넘김, 깔끔하게 남는 끝맛.'],
    image: '/foxcave/media/hanji/hayang-table-bottle-fixed-painted.jpg',
    alt: '하양한모금과 전을 차린 식탁을 한지 질감으로 표현한 일러스트',
    href: '/foxcave/product/',
    action: '하양한모금 알아보기',
  }),
  class: Object.freeze({
    heading: ['쌀과 누룩을 섞고', '내 손으로 빚는 한 통'],
    description: ['눈앞의 재료가 막걸리가 되는 과정.', '직접 만지고 섞으며 양조를 배웁니다.'],
    image: '/foxcave/media/hanji/brewing-class.jpg',
    alt: '쌀과 누룩을 섞어 막걸리를 빚는 한지 질감 일러스트',
    href: '/foxcave/class/',
    action: '막걸리 클래스 알아보기',
  }),
});

function showHanjiSubject(subjectKey) {
  const subject = HANJI_SUBJECTS[subjectKey];
  if (!subject) return;
  document.querySelector('#hs-title-first').textContent = subject.heading[0];
  document.querySelector('#hs-title-second').textContent = subject.heading[1];
  document.querySelector('#hs-description').replaceChildren(
    document.createTextNode(subject.description[0]),
    document.createElement('br'),
    document.createTextNode(subject.description[1]),
  );
  const image = document.querySelector('#hs-banner-image');
  image.src = subject.image;
  image.alt = subject.alt;
  document.querySelector('#hs-banner-link').href = subject.href;
  document.querySelector('#hs-link-label').textContent = subject.action;
  document.querySelectorAll('[data-hs-subject]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.hsSubject === subjectKey));
  });
}

document.querySelectorAll('[data-hs-subject]').forEach((button) => {
  button.addEventListener('click', () => showHanjiSubject(button.dataset.hsSubject));
});
