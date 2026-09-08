import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit, devices } from 'playwright';

const target = (process.argv[2] || 'http://127.0.0.1:8000/').replace(/\/?$/, '/');
const artifacts = process.env.E2E_ARTIFACT_DIR || 'e2e-artifacts';
fs.mkdirSync(artifacts, { recursive: true });

function attachDiagnostics(page, name) {
  const consoleErrors = [];
  const badResponses = [];
  const failedRequests = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => { if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`); });
  page.on('requestfailed', (req) => failedRequests.push(`${req.failure()?.errorText || 'failed'} ${req.url()}`));
  return {
    verify() {
      const materialConsoleErrors = consoleErrors.filter((x) => !/favicon|ResizeObserver loop/i.test(x));
      const materialFailures = failedRequests.filter((x) => !/ERR_ABORTED|cancelled/i.test(x));
      const materialHttp = badResponses.filter((x) => !/404 .*favicon/i.test(x));
      console.log(`[${name}] console errors:`, materialConsoleErrors);
      console.log(`[${name}] failed requests:`, materialFailures.slice(0, 20));
      console.log(`[${name}] HTTP >=400: ${materialHttp.length}`, materialHttp.slice(0, 20));
      assert.equal(materialConsoleErrors.length, 0, `${name}: console errors detected`);
      assert.ok(materialFailures.length <= 5, `${name}: too many failed network requests`);
      assert.ok(materialHttp.length <= 20, `${name}: too many HTTP errors`);
    }
  };
}

async function waitCore(page, timeout = 120000) {
  await page.waitForFunction(() => window.__matsuyamaViewer && !window.__matsuyamaViewer.isDestroyed(), null, { timeout });
  await page.waitForFunction(() => window.MatsuyamaImmersive && window.MatsuyamaImmersive.debug().base === 'seamlessphoto', null, { timeout });
  await page.waitForFunction(() => document.querySelector('#basemapStatus')?.textContent.includes('全国最新写真'), null, { timeout });
  await page.waitForFunction(() => document.querySelector('#terrainStatus')?.textContent.includes('DEM10B'), null, { timeout });
  await page.waitForFunction(() => /PLATEAU 2020年度 LOD1|建物表示中/.test(document.querySelector('#buildingStatus')?.textContent || ''), null, { timeout });
  await page.waitForFunction(() => window.MatsuyamaImmersive.debug().tilesetAttached === true, null, { timeout });
}

async function findBuildingPixel(page) {
  return await page.evaluate(() => {
    const viewer = window.__matsuyamaViewer, C = window.Cesium;
    viewer.scene.requestRender(); viewer.render();
    const w = viewer.canvas.clientWidth, h = viewer.canvas.clientHeight;
    for (let y = Math.floor(h * 0.30); y < h * 0.82; y += 28) {
      for (let x = Math.floor(w * 0.18); x < w * 0.86; x += 28) {
        const p = viewer.scene.pick(new C.Cartesian2(x, y));
        if (p instanceof C.Cesium3DTileFeature) return { x, y };
      }
    }
    return null;
  });
}

async function desktopChromium() {
  const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const diag = attachDiagnostics(page, 'chromium-desktop');
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitCore(page);

  let debug = await page.evaluate(() => window.MatsuyamaImmersive.debug());
  console.log('initial debug', debug);
  assert.equal(await page.locator('#basemap').inputValue(), 'seamlessphoto');
  assert.ok(debug.baseUrl.includes('/seamlessphoto/'));
  assert.equal(debug.baseMinimumLevel, 2);
  assert.equal(debug.baseMaximumLevel, 18);
  assert.equal(debug.verticalExaggeration, 1);
  assert.ok(debug.baseBrightness >= 1 && debug.baseBrightness <= 1.1);

  await page.locator('#basemap').selectOption('pale');
  await page.waitForFunction(() => window.MatsuyamaImmersive.debug().base === 'pale');
  await page.locator('#basemap').selectOption('std');
  await page.waitForFunction(() => window.MatsuyamaImmersive.debug().base === 'std');
  await page.locator('#basemap').selectOption('seamlessphoto');
  await page.waitForFunction(() => window.MatsuyamaImmersive.debug().base === 'seamlessphoto');

  await page.waitForFunction(() => /^3D水面：/.test(document.querySelector('#water3dStatus')?.textContent || ''), null, { timeout: 120000 });
  debug = await page.evaluate(() => window.MatsuyamaImmersive.debug());
  assert.ok(debug.hazardAlpha === null || debug.hazardAlpha <= 0.30, `3D water ON should keep 2D hazard thin; alpha=${debug.hazardAlpha}`);
  assert.equal(await page.locator('#hazard2dEnabled').isChecked(), true);

  await page.evaluate(() => window.MatsuyamaWalk.start());
  await page.waitForFunction(() => window.MatsuyamaWalk?.state?.active === true);
  await page.waitForFunction(() => (document.querySelector('#walkRisk')?.textContent || '').includes('現在地'), null, { timeout: 60000 });
  await page.evaluate(() => window.MatsuyamaWalk.toggleView());
  assert.equal(await page.evaluate(() => window.MatsuyamaWalk.state.view), 'first');
  await page.evaluate(() => window.MatsuyamaWalk.toggleView());
  assert.equal(await page.evaluate(() => window.MatsuyamaWalk.state.view), 'third');
  await page.evaluate(() => window.MatsuyamaWalk.stop());

  const buildingPixel = await findBuildingPixel(page);
  assert.ok(buildingPixel, 'No pickable PLATEAU building found in the initial Matsuyama view');
  await page.mouse.click(buildingPixel.x, buildingPixel.y);
  await page.waitForFunction(() => document.querySelector('#featureTitle')?.textContent.includes('建物リスクカルテ'), null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#properties .immersive-card-extra') !== null, null, { timeout: 30000 });

  await page.locator('#riskMode').selectOption('flood');
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#riskMode').inputValue(), 'flood');
  await page.locator('#riskMode').selectOption('normal');
  await page.waitForTimeout(500);

  await page.screenshot({ path: path.join(artifacts, 'desktop-aerial-water-buildings.png'), fullPage: false });
  diag.verify();
  await browser.close();
}

async function mobileWebKit() {
  const browser = await webkit.launch({ headless: true });
  const iphone = devices['iPhone 15'];
  const context = await browser.newContext({ ...iphone });
  const page = await context.newPage();
  const diag = attachDiagnostics(page, 'webkit-iphone');
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitCore(page, 150000);
  const debug = await page.evaluate(() => window.MatsuyamaImmersive.debug());
  assert.equal(debug.mobile, true);
  assert.equal(await page.locator('#basemap').inputValue(), 'seamlessphoto');
  const panelBox = await page.locator('#panel').boundingBox();
  const viewport = page.viewportSize();
  assert.ok(panelBox && viewport && panelBox.height <= viewport.height * 0.55, `Mobile settings panel too tall: ${panelBox?.height}/${viewport?.height}`);
  await page.evaluate(() => window.MatsuyamaWalk.start());
  await page.waitForFunction(() => window.MatsuyamaWalk?.state?.active === true);
  await page.waitForFunction(() => !document.querySelector('#walkHud')?.hidden && !document.querySelector('#walkTouch')?.hidden);
  await page.waitForFunction(() => (document.querySelector('#walkRisk')?.textContent || '').includes('現在地'), null, { timeout: 60000 });
  await page.screenshot({ path: path.join(artifacts, 'iphone-walk-water.png'), fullPage: false });
  await page.evaluate(() => window.MatsuyamaWalk.stop());
  diag.verify();
  await browser.close();
}

await desktopChromium();
await mobileWebKit();
console.log(`PASS immersive E2E: ${target}`);
