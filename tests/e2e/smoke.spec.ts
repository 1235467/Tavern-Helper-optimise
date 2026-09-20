// Playwright e2e — drives a REAL SillyTavern instance with this extension
// installed as third-party/JS-Slash-Runner.
//
// Run (on a machine with playwright + a browser):
//   pnpm i -D @playwright/test && pnpm playwright install firefox
//   ST_URL=http://localhost:8000 pnpm playwright test tests/e2e/
//
// ST must have this extension enabled and a chat containing a full-HTML
// ```html fenced block — fixture setup is manual for now.

import { test, expect } from '@playwright/test';

const ST = process.env.ST_URL ?? 'http://localhost:8000';

test.beforeEach(async ({ page }) => {
  await page.goto(ST);
  await page.waitForLoadState('domcontentloaded');
});

test('extension activates and installs TavernHelper', async ({ page }) => {
  await page.waitForFunction(() => (window as any).TavernHelper !== undefined, null, {
    timeout: 30_000,
  });
  const isNg = await page.evaluate(() => (window as any).TavernHelper?.__th_ng === true);
  expect(isNg).toBe(true);
});

test('panel mounts into extensions settings', async ({ page }) => {
  await page.waitForSelector('#tavern_helper', { timeout: 30_000 });
  await page.waitForFunction(
    () => document.querySelector('#tavern_helper')?.childElementCount !== 0,
    null,
    { timeout: 15_000 },
  );
});

test('frontend iframe mounts with ABI naming', async ({ page }) => {
  const iframe = await page
    .waitForSelector('iframe[id^="TH-message--"]', { timeout: 20_000 })
    .catch(() => null);
  if (!iframe) {
    test.skip(true, 'no frontend code block present in the active chat');
    return;
  }
  const name = await iframe.getAttribute('name');
  expect(name).toMatch(/^TH-message--\d+--\d+(_\d+)?$/);
});

test('iframe exposes the ABI globals', async ({ page }) => {
  const iframe = await page
    .waitForSelector('iframe[id^="TH-message--"]', { timeout: 20_000 })
    .catch(() => null);
  if (!iframe) {
    test.skip(true, 'no frontend iframe present');
    return;
  }
  const frame = iframe.contentFrame();
  expect(frame).not.toBeNull();
  const globals = await frame!.evaluate(() => ({
    TavernHelper: typeof (window as any).TavernHelper === 'object',
    jq: typeof (window as any).$ === 'function',
    lodash: typeof (window as any)._ === 'function',
    Vue: typeof (window as any).Vue === 'object',
    eventOn: typeof (window as any).eventOn === 'function',
    getIframeName: typeof (window as any).getIframeName === 'function',
    thId: (window as any).__TH_IFRAME_ID ?? (window as any).name,
  }));
  expect(globals.TavernHelper).toBe(true);
  expect(globals.jq).toBe(true);
  expect(globals.lodash).toBe(true);
  expect(globals.Vue).toBe(true);
  expect(globals.eventOn).toBe(true);
  expect(globals.getIframeName).toBe(true);
  expect(globals.thId).toMatch(/^TH-message--/);
});
