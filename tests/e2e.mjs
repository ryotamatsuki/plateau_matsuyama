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
      const materialConsoleErrors = consoleErrors.filter((x) => !/favicon|ResizeObserver loop|Failed to load resource/i.test(x));
      const materialFailures = failedRequests.filter((x) => !/ERR_ABORTED|cancelled/i.test(x));
      const materialHttp = badResponses.filter((x) => !/404 .*favicon/i.test(x));
      const localElevationHttp = materialHttp.filter((x) => /\/elevation\/dem_png\//.test(x));
      console.log(`[${name}] console errors:`, materialConsoleErrors);
      console.log(`[${name}] failed requests:`, materialFailures.slice(0, 20));
      console.log(`[${name}] HTTP >=400: ${materialHttp.length}`, materialHttp.slice(0, 20));
      console.log(`[${name}] local elevation HTTP errors: ${localElevationHttp.length}`, localElevationHttp.slice(0, 20));
      assert.equal(materialConsoleErrors.length, 0, `${name}: JavaScript console errors detected`);
      assert.ok(materialFailures.length <= 5, `${name}: too many failed network requests`);
      assert.equal(localElevationHttp.length, 0, `${name}: cached DEM requested known-missing tiles`);
      assert.ok(materialHttp.length <= 20, `${name}: too many HTTP errors`);
    }
  };
}

async function safeScreenshot(page, filename) {
  try {
    await page.screenshot({
      path: path.join(artifacts, filename),
      fullPage: false,
      animations: 'disabled',
      timeout: 90000,
    });
  } catch (error) {
    console.warn(`diagnostic screenshot skipped (${filename}): ${error.message}`);
  }
}

async function waitCore(page, timeout = 120000) {
  await page.waitForFunction(() => window.__matsuyamaViewer && !window.__matsuyamaViewer.isDestroyed(), null, { timeout });
  await page.waitForFunction(() => window.MatsuyamaImmersive && window.MatsuyamaImmersive.debug().base === 'seamlessphoto', null, { timeout });
  await page.waitForFunction(() => document.querySelector('#basemapStatus')?.textContent.includes('全国最新写真'), null, { timeout });
  await page.waitForFunction(() => document.querySelector('#terrainStatus')?.textContent.includes('DEM10B'), null, { timeout });
  await page.waitForFunction(() => /PLATEAU 2020年度 LOD1|建物表示中/.test(document.querySelector('#buildingStatus')?.textContent || ''), null, { timeout });
  await page.waitForFunction(() => window.MatsuyamaImmersive.debug().tilesetAttached === true, null, { timeout });
}

async function focusCentralBuildings(page, height = 650) {
  await page.evaluate((cameraHeight) => {
    const viewer = window.__matsuyamaViewer, C = window.Cesium;
    viewer.camera.setView({
      destination: C.Cartesian3.fromDegrees(132.7657, 33.8392, cameraHeight),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 }
    });
    viewer.scene.requestRender();
  }, height);
  await page.waitForTimeout(7000);
  await page.evaluate(() => { window.__matsuyamaViewer.scene.requestRender(); window.__matsuyamaViewer.render(); });
}

async function findBuildingPixel(page) {
  const scan = async (step) => await page.evaluate((gridStep) => {
    const viewer = window.__matsuyamaViewer, C = window.Cesium;
    viewer.scene.requestRender(); viewer.render();
    const w = viewer.canvas.clientWidth, h = viewer.canvas.clientHeight;
    const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
    for (let radius = 0; radius <= Math.min(w, h) * 0.44; radius += gridStep * 2) {
      const x0 = Math.max(2, cx - radius), x1 = Math.min(w - 2, cx + radius);
      const y0 = Math.max(2, cy - radius), y1 = Math.min(h - 2, cy + radius);
      for (let y = y0; y <= y1; y += gridStep) {
        for (let x = x0; x <= x1; x += gridStep) {
          if (radius > 0 && x > x0 && x < x1 && y > y0 && y < y1) continue;
          const p = viewer.scene.pick(new C.Cartesian2(x, y));
          if (p instanceof C.Cesium3DTileFeature) return { x, y };
        }
      }
    }
    return null;
  }, step);

  await focusCentralBuildings(page, 650);
  let found = await scan(14);
  if (found) return found;
  await focusCentralBuildings(page, 360);
  return await scan(10);
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
  const thirdCameraBefore = await page.evaluate(() => ({
    heading: window.MatsuyamaWalk.state.heading,
    cameraHeading: window.MatsuyamaWalk.state.cameraHeading
  }));
  await page.evaluate(() => window.MatsuyamaWalk.setVirtualStick('look', 0.65, 0));
  await page.waitForTimeout(350);
  await page.evaluate(() => window.MatsuyamaWalk.setVirtualStick('look', 0, 0));
  const thirdCameraAfter = await page.evaluate(() => ({
    heading: window.MatsuyamaWalk.state.heading,
    cameraHeading: window.MatsuyamaWalk.state.cameraHeading
  }));
  assert.ok(Math.abs(thirdCameraAfter.cameraHeading - thirdCameraBefore.cameraHeading) > 0.02, 'Third-person camera did not orbit');
  assert.ok(Math.abs(thirdCameraAfter.heading - thirdCameraBefore.heading) < 0.01, 'Third-person camera orbit unexpectedly rotated avatar');

  await page.evaluate(() => window.MatsuyamaWalk.toggleView());
  assert.equal(await page.evaluate(() => window.MatsuyamaWalk.state.view), 'first');
  await page.evaluate(() => window.MatsuyamaWalk.toggleView());
  assert.equal(await page.evaluate(() => window.MatsuyamaWalk.state.view), 'third');
  await page.evaluate(() => window.MatsuyamaWalk.stop());

  const buildingPixel = await findBuildingPixel(page);
  assert.ok(buildingPixel, 'No pickable PLATEAU building found after zooming into central Matsuyama');
  await page.locator('#map canvas').click({ position: buildingPixel });
  await page.waitForFunction(() => document.querySelector('#featureTitle')?.textContent.includes('建物リスクカルテ'), null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#properties .immersive-card-extra') !== null, null, { timeout: 30000 });

  await page.locator('#riskMode').selectOption('flood');
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#riskMode').inputValue(), 'flood');
  await page.locator('#riskMode').selectOption('normal');
  await page.waitForTimeout(500);

  diag.verify();
  await safeScreenshot(page, 'desktop-aerial-water-buildings.png');
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

  assert.equal(await page.locator('#walkMoveStick').isVisible(), true, 'Move joystick not visible on mobile');
  assert.equal(await page.locator('#walkLookStick').isVisible(), true, 'Camera joystick not visible on mobile');
  assert.equal(await page.locator('#panel').isVisible(), false, 'GIS settings panel should be hidden during mobile walk mode');
  assert.equal(await page.locator('#feature').isVisible(), false, 'Building feature card should be hidden during mobile walk mode');
  assert.equal(await page.evaluate(() => document.body.classList.contains('walk-mode-active')), true);

  const before = await page.evaluate(() => ({
    heading: window.MatsuyamaWalk.state.heading,
    cameraHeading: window.MatsuyamaWalk.state.cameraHeading,
    cameraPitch: window.MatsuyamaWalk.state.cameraPitch
  }));
  await page.evaluate(() => window.MatsuyamaWalk.setVirtualStick('look', 0.8, 0.35));
  await page.waitForTimeout(450);
  await page.evaluate(() => window.MatsuyamaWalk.setVirtualStick('look', 0, 0));
  const after = await page.evaluate(() => ({
    heading: window.MatsuyamaWalk.state.heading,
    cameraHeading: window.MatsuyamaWalk.state.cameraHeading,
    cameraPitch: window.MatsuyamaWalk.state.cameraPitch
  }));
  assert.ok(Math.abs(after.cameraHeading - before.cameraHeading) > 0.03, 'Mobile camera stick did not rotate third-person camera');
  assert.ok(Math.abs(after.cameraPitch - before.cameraPitch) > 0.005, 'Mobile camera stick did not tilt third-person camera');
  assert.ok(Math.abs(after.heading - before.heading) < 0.01, 'Mobile camera stick unexpectedly rotated avatar');

  await page.evaluate(() => window.MatsuyamaWalk.setVirtualStick('move', 0.5, 0.8));
  assert.deepEqual(await page.evaluate(() => window.MatsuyamaWalk.state.analog.move), { x:0.5, y:0.8 });
  await page.evaluate(() => window.MatsuyamaWalk.setVirtualStick('move', 0, 0));

  await page.evaluate(() => window.MatsuyamaWalk.stop());
  assert.equal(await page.evaluate(() => document.body.classList.contains('walk-mode-active')), false);
  assert.equal(await page.locator('#panel').isVisible(), true, 'GIS settings panel should return after leaving walk mode');

  diag.verify();
  await safeScreenshot(page, 'iphone-walk-water.png');
  await browser.close();
}

await desktopChromium();
await mobileWebKit();
console.log(`PASS immersive E2E: ${target}`);
