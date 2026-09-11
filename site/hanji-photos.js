(() => {
  const CATALOG_URL = '/foxcave/media/hanji/details/catalog.json';
  const REFRESH_INTERVAL = 10_000;
  const IS_LOCAL = ['127.0.0.1', 'localhost'].includes(location.hostname);
  const grid = document.querySelector('#hs-photo-grid');
  const filters = document.querySelectorAll('[data-photo-filter]');
  let selectedKind = 'all';
  let artworks = [];
  let signature = '';

  function createLink(href, label) {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    if (label) link.textContent = label;
    return link;
  }

  function makeCard(artwork) {
    const card = document.createElement('figure');
    card.className = 'hs-gallery-item';
    const link = createLink(artwork.src);
    link.className = 'hs-gallery-image';
    link.setAttribute('aria-label', artwork.title + ' 크게 보기, 새 창');
    const image = document.createElement('img');
    Object.assign(image, { src: artwork.src, alt: artwork.alt, width: artwork.width,
      height: artwork.height, loading: 'lazy' });
    link.append(image);
    const caption = document.createElement('figcaption');
    const title = document.createElement('span');
    title.textContent = artwork.title;
    caption.append(title, createLink(artwork.original, '원본 사진 보기'));
    card.append(link, caption);
    return card;
  }

  function render() {
    const visible = artworks.filter((item) => selectedKind === 'all' || item.kind === selectedKind);
    grid.replaceChildren(...visible.map(makeCard));
    document.querySelector('#hs-photo-count').textContent = String(artworks.length);
  }

  filters.forEach((button) => button.addEventListener('click', () => {
    selectedKind = button.dataset.photoFilter;
    filters.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    render();
  }));

  async function refresh() {
    try {
      const response = await fetch(CATALOG_URL, { cache: 'no-store', signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error('그림 목록 응답: ' + response.status);
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.some((row) =>
        !/^\/media\/hanji\/details\/[a-z0-9-]+\.jpg$/.test(row.src)
        || !/^\/media\/(product|class)\/[a-z0-9-]+\.png$/.test(row.original)
        || !['product', 'class'].includes(row.kind)
        || typeof row.title !== 'string' || typeof row.alt !== 'string'
        || !Number.isInteger(row.width) || !Number.isInteger(row.height) || row.width <= row.height
      )) throw new Error('잘못된 그림 목록');
      const nextSignature = JSON.stringify(rows);
      if (signature !== nextSignature) {
        signature = nextSignature;
        artworks = rows;
        render();
      }
    } catch (error) {
      console.warn('그림을 불러오지 못했어요.', error);
    } finally {
      if (IS_LOCAL) setTimeout(refresh, REFRESH_INTERVAL);
    }
  }
  refresh();
})();
