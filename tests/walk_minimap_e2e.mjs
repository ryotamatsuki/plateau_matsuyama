import fs from 'node:fs';
import { chromium, webkit, devices } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:8000/';
fs.mkdirSync('e2e-artifacts', { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function runCase(browserType, label, contextOptions = {}) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => Boolean(window.MatsuyamaWalk?.start && document.getElementById('walkMinimap')), null, { timeout: 60_000 });
    await page.evaluate(() => window.MatsuyamaWalk.start());
    await page.waitForFunction(() => {
      const mini = document.getElementById('walkMinimap');
      return document.body.classList.contains('walk-mode-active') && mini && !mini.hidden && mini.dataset.latitude && mini.dataset.longitude;
    }, null, { timeout: 20_000 });

    const initial = await page.evaluate(() => {
      const mini = document.getElementById('walkMinimap');
      return {
        lat: Number(mini.dataset.latitude),
        lon: Number(mini.dataset.longitude),
        heading: Number(mini.dataset.heading),
        tileCount: mini.querySelectorAll('.walk-minimap-tiles img').length,
        tileSrcs: [...mini.querySelectorAll('.walk-minimap-tiles img')].map((img) => img.src),
        coord: mini.querySelector('.walk-minimap-coord')?.textContent || '',
        arrow: mini.querySelector('.walk-minimap-arrow')?.style.transform || ''
      };
    });

    assert(Number.isFinite(initial.lat) && Number.isFinite(initial.lon), `${label}: current coordinates missing`);
    assert(initial.tileCount === 9, `${label}: expected 9 minimap tiles, got ${initial.tileCount}`);
    assert(initial.tileSrcs.every((src) => src.includes('/xyz/std/17/')), `${label}: unexpected minimap tile source`);
    assert(initial.coord.includes(','), `${label}: coordinate label missing`);
    assert(initial.arrow.includes('rotate('), `${label}: direction arrow not initialized`);

    await page.evaluate(() => {
      window.MatsuyamaWalk.state.lon += 0.00002;
      window.MatsuyamaWalk.state.heading += 0.4;
    });
    await page.waitForTimeout(350);

    const updated = await page.evaluate(() => {
      const mini = document.getElementById('walkMinimap');
      const box = mini.getBoundingClientRect();
      const look = document.querySelector('[data-stick-zone="look"]')?.getBoundingClientRect();
      const lookStyle = document.querySelector('[data-stick-zone="look"]') ? getComputedStyle(document.querySelector('[data-stick-zone="look"]')) : null;
      return {
        lon: Number(mini.dataset.longitude),
        heading: Number(mini.dataset.heading),
        hidden: mini.hidden,
        box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
        look: look ? { left: look.left, right: look.right, top: look.top, bottom: look.bottom } : null,
        lookVisible: Boolean(lookStyle && lookStyle.display !== 'none' && lookStyle.visibility !== 'hidden')
      };
    });

    assert(Math.abs(updated.lon - initial.lon) > 0.00001, `${label}: minimap did not follow walk position`);
    assert(Math.abs(updated.heading - initial.heading) > 5, `${label}: minimap direction did not follow walk heading`);
    assert(!updated.hidden, `${label}: minimap unexpectedly hidden during walk mode`);
    if (updated.lookVisible && updated.look) {
      assert(!overlaps(updated.box, updated.look), `${label}: minimap overlaps the right camera stick`);
    }

    await page.screenshot({ path: `e2e-artifacts/walk-minimap-${label}.png`, fullPage: false });
    await page.evaluate(() => window.MatsuyamaWalk.stop());
    await page.waitForFunction(() => document.getElementById('walkMinimap')?.hidden === true, null, { timeout: 5_000 });
    assert(errors.length === 0, `${label}: page errors: ${errors.join(' | ')}`);
    console.log(`[${label}] PASS walk minimap`, { lat: initial.lat, lon: initial.lon, heading: initial.heading });
  } finally {
    await context.close();
    await browser.close();
  }
}

await runCase(chromium, 'chromium-desktop', { viewport: { width: 1440, height: 900 } });
await runCase(webkit, 'webkit-iphone', { ...devices['iPhone 15'] });
console.log(`PASS walk minimap E2E: ${baseUrl}`);
