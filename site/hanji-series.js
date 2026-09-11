(() => {
  const CATALOG_URL = '/foxcave/media/hanji/series-02/catalog.json';
  const TOTAL_ARTWORKS = 6;
  const REFRESH_INTERVAL_MS = 10_000;
  const FETCH_TIMEOUT_MS = 7_000;
  const IS_LOCALHOST = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
  const IMAGE_PATH = /^\/media\/hanji\/series-02\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/;
  const container = document.querySelector('#hs-series-ready');
  const emptyState = document.querySelector('#hs-series-empty');
  const thumbnails = document.querySelector('#hs-series-thumbnails');
  let artworks = [];
  let selectedId = null;
  let catalogSignature = '';

  function validateArtwork(value) {
    const isText = (text, limit) => typeof text === 'string' && text.trim().length > 0 && text.length <= limit;
    const hasValidDimensions = [value?.width, value?.height].every((size) => Number.isInteger(size) && size > 0 && size <= 8192);
    if (!value || !/^0[125678]$/.test(value.id) || !isText(value.title, 80)
      || !isText(value.alt, 300) || !IMAGE_PATH.test(value.src)
      || !['product', 'class'].includes(value.kind)
      || !['몰입형', '실험형'].includes(value.approach) || !hasValidDimensions) {
      throw new Error('Invalid artwork in the hanji catalog.');
    }
    return Object.freeze({ id: value.id, title: value.title.trim(), alt: value.alt.trim(),
      src: value.src, width: value.width, height: value.height });
  }

  function showArtwork(id) {
    const artwork = artworks.find((item) => item.id === id);
    if (!artwork) return;
    selectedId = artwork.id;
    const image = document.querySelector('#hs-series-image');
    if (image.getAttribute('src') !== artwork.src) image.src = artwork.src;
    image.alt = artwork.alt;
    image.width = artwork.width;
    image.height = artwork.height;
    document.querySelector('#hs-series-number').textContent = artwork.id;
    document.querySelector('#hs-series-name').textContent = artwork.title;
    document.querySelector('#hs-series-image-link').href = artwork.src;
    document.querySelector('#hs-series-original').href = artwork.src;
    thumbnails.querySelectorAll('button').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.artId === artwork.id));
    });
  }

  function makeThumbnail(artwork) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hs-series-thumbnail';
    button.dataset.artId = artwork.id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-controls', 'hs-series-image');
    const image = document.createElement('img');
    image.src = artwork.src;
    image.alt = '';
    image.width = artwork.width;
    image.height = artwork.height;
    image.loading = 'lazy';
    const label = document.createElement('span');
    label.textContent = `${artwork.id} ${artwork.title}`;
    button.append(image, label);
    button.addEventListener('click', () => showArtwork(artwork.id));
    return button;
  }

  function updateGallery(nextArtworks) {
    const signature = JSON.stringify(nextArtworks);
    if (signature === catalogSignature) return;
    catalogSignature = signature;
    artworks = nextArtworks;
    document.querySelector('#hs-series-count').textContent = String(artworks.length);
    emptyState.hidden = artworks.length > 0;
    container.hidden = artworks.length === 0;
    if (!artworks.length) return;
    const focusedId = document.activeElement?.dataset.artId;
    thumbnails.replaceChildren(...artworks.map(makeThumbnail));
    showArtwork(artworks.some((artwork) => artwork.id === selectedId) ? selectedId : artworks[0].id);
    if (focusedId) thumbnails.querySelector(`[data-art-id="${focusedId}"]`)?.focus({ preventScroll: true });
  }

  async function refreshCatalog() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(CATALOG_URL, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`Hanji catalog returned ${response.status}.`);
      const catalog = await response.json();
      if (!Array.isArray(catalog) || catalog.length > TOTAL_ARTWORKS) throw new Error('Invalid hanji catalog.');
      const nextArtworks = catalog.map(validateArtwork).sort((a, b) => Number(a.id) - Number(b.id));
      if (new Set(nextArtworks.map((artwork) => artwork.id)).size !== nextArtworks.length) throw new Error('Duplicate artwork IDs.');
      updateGallery(nextArtworks);
    } catch (error) {
      console.warn('한지 그림 목록을 불러오지 못했습니다.', error);
    } finally {
      clearTimeout(timeout);
      if (IS_LOCALHOST) setTimeout(refreshCatalog, REFRESH_INTERVAL_MS);
    }
  }

  refreshCatalog();
})();
