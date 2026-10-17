// Run through playwright-cli with `npm run test:serve` running.
// Checks the shared UI on pages that previously loaded common.js twice.
async (page) => {
  const base = 'http://127.0.0.1:4173';
  const passed = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const path of ['/index.html', '/booking/', '/inquiry/', '/booking/status/', '/admin/']) {
      await page.goto(base + path);
      const chat = page.locator('.fc-chat-toggle');
      const panel = page.locator('#chat-panel');
      if (await chat.count()) {
        assert(await panel.isHidden(), path + ': chat starts closed');
        await chat.click();
        assert(await panel.isVisible() && await chat.getAttribute('aria-expanded') === 'true', path + ': one click opens chat');
        const link = panel.getByRole('link', { name: /카카오톡으로 문의하기/ });
        assert(await link.getAttribute('href') === 'https://pf.kakao.com/_xjxixfxaX/chat', path + ': correct Kakao destination');
        await chat.click();
        assert(await panel.isHidden(), path + ': second click closes chat');
        await chat.focus();
        await page.keyboard.press('Enter');
        assert(await panel.isVisible(), path + ': keyboard opens chat');
        await page.keyboard.press('Escape');
        assert(await panel.isHidden(), path + ': Escape closes chat');
        assert(await chat.evaluate((node) => node === document.activeElement), path + ': Escape returns focus');
        await chat.click();
        // The panel can cover footer text on mobile; click the page's left gutter.
        await page.mouse.click(1, Math.floor(page.viewportSize().height / 2));
        assert(await panel.isHidden(), path + ': outside click closes chat');
        if (path === '/booking/') {
          await chat.click();
          await page.screenshot({ path: `output/playwright/booking-chat-${width}.png` });
          await page.keyboard.press('Escape');
        }
      }
      if (width === 390) {
        const menu = page.locator('.fc-menu-toggle');
        await menu.click();
        assert(await menu.getAttribute('aria-expanded') === 'true', path + ': one click opens mobile menu');
        assert(await page.locator('.fc-nav').evaluate((node) => node.classList.contains('is-open')), path + ': navigation becomes visible');
        await menu.click();
        assert(await menu.getAttribute('aria-expanded') === 'false', path + ': second click closes mobile menu');
        await menu.click();
        await page.keyboard.press('Escape');
        assert(await menu.getAttribute('aria-expanded') === 'false', path + ': Escape closes mobile menu');
      }
      const commonModules = await page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => new URL(entry.name).pathname === '/site/common.js').map((entry) => entry.name));
      assert(commonModules.length === 1, path + ': shared handlers must be loaded once');
      passed.push(`${path} at ${width}px: shared UI toggles correctly and initializes once`);
    }
  }
  assert(errors.length === 0, 'Unexpected JavaScript errors: ' + errors.join(', '));
  return { passed: passed.length, checks: passed, javascriptErrors: errors };
}
