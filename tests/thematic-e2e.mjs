import { chromium, webkit } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:8000/';
const target = process.argv[3] || 'all';
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X7xR6QAAAABJRU5ErkJggg==', 'base64');

async function run(browserType, name) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext(name === 'webkit' ? {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  } : { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.route('**/bosai/jmatile/data/nowc/targetTimes_N1.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ basetime: '20260913130000', validtime: '20260913130000', elements: ['hrpns', 'hrpns_nd'] }])
  }));
  await page.route(/https:\/\/api\.open-meteo\.com\/v1\/forecast(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ current: { time: '2026-09-13T22:30', wind_speed_10m: 3.2, wind_direction_10m: 225, wind_gusts_10m: 5.1, precipitation: 0.0 } })
  }));
  await page.route('**/seamless/v2/api/1.3/legend.json**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ formationAge_ja: '新生代', lithology_ja: '堆積岩' })
  }));
  await page.route(/https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/sih\/10\/\d+\/\d+\.geojson(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/geo+json',
    body: JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'テスト指定避難所' }, geometry: { type: 'Point', coordinates: [132.7657, 33.8392] } }] })
  }));
  await page.route(/https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/sfh\/10\/\d+\/\d+\.geojson(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify({ type: 'FeatureCollection', features: [] }) }));
  await page.route('**/bosai/jmatile/data/nowc/**.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: tinyPng }));
  await page.route('**/seamless/v2/api/1.3/tiles/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: tinyPng }));

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.MatsuyamaApp && window.MatsuyamaThematic, null, { timeout: 60000 });

  const options = await page.locator('#thematicLayer option').evaluateAll((els) => els.map((e) => e.value));
  for (const required of ['geology', 'fault', 'forest', 'did2020']) {
    if (!options.includes(required)) throw new Error(`${name}: missing thematic option ${required}`);
  }

  await page.selectOption('#thematicLayer', 'geology');
  await page.waitForFunction(() => document.querySelector('#thematicStatus')?.textContent?.includes('新生代'));

  await page.check('#sheltersEnabled');
  await page.waitForFunction(() => document.querySelector('#shelterStatus')?.textContent?.includes('1件'));

  await page.locator('#rainEnabled').evaluate((el) => el.click());
  await page.waitForFunction(() => document.querySelector('#rainStatus')?.textContent?.includes('雨雲実況'));

  await page.locator('#weatherRefresh').evaluate((el) => el.click());
  await page.waitForFunction(() => document.querySelector('#weatherStatus')?.textContent?.includes('3.2 m/s'));

  if (errors.length) throw new Error(`${name}: page errors: ${errors.join(' | ')}`);
  await page.screenshot({ path: `e2e-artifacts/${name}-thematic-layers.png`, fullPage: true });
  await browser.close();
}

if (target === 'all' || target === 'chromium') await run(chromium, 'chromium');
if (target === 'all' || target === 'webkit') await run(webkit, 'webkit');
console.log(`thematic layer E2E (${target}): PASS`);
