import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit, devices } from 'playwright';

const [baseline, candidate] = process.argv.slice(2);
if (!baseline || !candidate) throw new Error('usage: perf.mjs baseline candidate');

const outDir = process.env.PERF_ARTIFACT_DIR || 'perf-artifacts';
const sampleMs = Number(process.env.PERF_SAMPLE_MS || 3500);
const moveMs = Number(process.env.PERF_MOVE_MS || 2800);
const inputN = Number(process.env.PERF_INPUT_N || 16);
fs.mkdirSync(outDir, { recursive: true });

const results = { baseline: {}, candidate: {} };

function statsHook(page) {
  return page.addInitScript(() => {
    window.__perf = { long: [] };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__perf.long.push({ start: e.startTime, duration: e.duration });
      }).observe({ type: 'longtask', buffered: true });
    } catch (_) {}
  });
}

async function waitCore(page, timeout = 150000) {
  await page.waitForFunction(() => window.__matsuyamaViewer && !window.__matsuyamaViewer.isDestroyed(), null, { timeout });
  await page.waitForFunction(() => window.MatsuyamaImmersive?.debug().tilesetAttached === true, null, { timeout });
  await page.waitForFunction(() => document.querySelector('#terrainStatus')?.textContent.includes('DEM10B'), null, { timeout });
}

async function waitWater(page, timeout = 120000) {
  await page.waitForFunction(() => /^3D水面：/.test(document.querySelector('#water3dStatus')?.textContent || ''), null, { timeout });
}

async function waitStableTiles(page, timeout = 150000) {
  const waitOnce = () => page.waitForFunction(() => {
    const v = window.__matsuyamaViewer, C = window.Cesium;
    if (!v || !C || !v.scene?.globe?.tilesLoaded) return false;
    const primitives = v.scene.primitives;
    for (let i = 0; i < primitives.length; i++) {
      const p = primitives.get(i);
      if (p instanceof C.Cesium3DTileset) return p.tilesLoaded === true;
    }
    return false;
  }, null, { timeout });
  await waitOnce();
  await page.waitForTimeout(900);
  await waitOnce();
  await page.evaluate(() => {
    window.__matsuyamaViewer.scene.requestRender();
    window.__matsuyamaViewer.render();
  });
}

async function fixedView(page) {
  await page.evaluate(() => {
    const v = window.__matsuyamaViewer, C = window.Cesium;
    v.camera.setView({
      destination: C.Cartesian3.fromDegrees(132.7657, 33.8392, 650),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 }
    });
    v.scene.requestRender();
  });
  await waitStableTiles(page);
}

async function frameSamples(page, ms = sampleMs) {
  return await page.evaluate(async (duration) => {
    const out = [];
    let last = performance.now(), end = last + duration;
    while (performance.now() < end) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      out.push(now - last);
      last = now;
    }
    return out;
  }, ms);
}

async function inputSamples(page, n = inputN) {
  return await page.evaluate(async (count) => {
    const out = [], w = window.MatsuyamaWalk;
    for (let i = 0; i < count; i++) {
      const before = w.state.cameraHeading, t = performance.now();
      w.setVirtualStick('look', .75, 0);
      await new Promise((resolve) => {
        const started = performance.now();
        const check = () => {
          if (Math.abs(w.state.cameraHeading - before) > 1e-5 || performance.now() - started > 5000) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });
      out.push(performance.now() - t);
      w.setVirtualStick('look', 0, 0);
      await new Promise(requestAnimationFrame);
    }
    return out;
  }, n);
}

async function demSamples(page) {
  return await page.evaluate(async () => {
    const C = window.Cesium, v = window.__matsuyamaViewer;
    const pts = [
      [132.7657, 33.8392], [132.7863, 33.8518], [132.7514, 33.8392],
      [132.7150, 33.7880], [132.7180, 33.8640], [132.8120, 33.8230]
    ].map(([lon, lat]) => C.Cartographic.fromDegrees(lon, lat));
    const r = await C.sampleTerrain(v.terrainProvider, 14, pts);
    return r.map((x) => x.height);
  });
}

async function waterSnapshot(page) {
  return await page.evaluate(() => {
    const v = window.__matsuyamaViewer, p = v.scene.primitives, signatures = [];
    let count = 0;
    for (let i = 0; i < p.length; i++) {
      const u = p.get(i)?.appearance?.material?.uniforms;
      if (!u || !('animationSpeed' in u) || !('frequency' in u) || !('amplitude' in u)) continue;
      count++;
      signatures.push(`${Number(u.frequency)}|${Number(u.animationSpeed)}|${Number(u.amplitude)}|${Number(u.specularIntensity ?? -1)}`);
    }
    return {
      status: document.querySelector('#water3dStatus')?.textContent || '',
      primitiveCount: count,
      materialSignatures: [...new Set(signatures)].sort()
    };
  });
}

async function freezeWater(page) {
  await page.evaluate(() => {
    const viewer = window.__matsuyamaViewer, C = window.Cesium;
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = C.JulianDate.fromIso8601('2026-09-08T00:00:00Z');
    const p = viewer.scene.primitives;
    for (let i = 0; i < p.length; i++) {
      const u = p.get(i)?.appearance?.material?.uniforms;
      if (u && 'animationSpeed' in u) u.animationSpeed = 0;
    }
    viewer.scene.requestRender();
    viewer.render();
  });
}

async function riskSnapshot(page) {
  const point = await page.evaluate(() => {
    const viewer = window.__matsuyamaViewer, C = window.Cesium;
    viewer.scene.requestRender();
    viewer.render();
    const w = viewer.canvas.clientWidth, h = viewer.canvas.clientHeight;
    const cx = Math.floor(w / 2), cy = Math.floor(h / 2), step = 12;
    for (let radius = 0; radius <= Math.min(w, h) * 0.44; radius += step * 2) {
      const x0 = Math.max(2, cx - radius), x1 = Math.min(w - 2, cx + radius);
      const y0 = Math.max(2, cy - radius), y1 = Math.min(h - 2, cy + radius);
      for (let y = y0; y <= y1; y += step) {
        for (let x = x0; x <= x1; x += step) {
          if (radius > 0 && x > x0 && x < x1 && y > y0 && y < y1) continue;
          const picked = viewer.scene.pick(new C.Cartesian2(x, y));
          if (picked instanceof C.Cesium3DTileFeature) {
            const rect = viewer.canvas.getBoundingClientRect();
            return { x: rect.left + x, y: rect.top + y };
          }
        }
      }
    }
    return null;
  });
  if (!point) return { found: false, loadMs: null, text: '' };
  const started = Date.now();
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => document.querySelector('#featureTitle')?.textContent.includes('建物リスクカルテ'), null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#properties .immersive-card-extra') !== null, null, { timeout: 120000 });
  const text = await page.locator('#properties .immersive-card-extra').innerText();
  return { found: true, loadMs: Date.now() - started, text: text.replace(/\s+/g, ' ').trim() };
}

async function canvasScreenshot(page, filename) {
  await freezeWater(page);
  await page.waitForTimeout(150);
  await page.locator('#map canvas').screenshot({ path: path.join(outDir, filename), animations: 'disabled', timeout: 90000 });
}

async function launch(browserType) {
  return browserType === 'chromium'
    ? chromium.launch({ headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'] })
    : webkit.launch({ headless: true });
}

async function runVariant(browserType, contextOpts, url, label, variant) {
  const browser = await launch(browserType);
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  await statsHook(page);
  const requests = [];
  page.on('response', (r) => requests.push({ url: r.url(), status: r.status(), len: Number(r.headers()['content-length'] || 0) }));

  const navStart = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitCore(page);
  await waitWater(page);
  await fixedView(page);
  const coldReady = Date.now() - navStart;

  const staticFrames = await frameSamples(page);
  const dem = await demSamples(page);
  const water = await waterSnapshot(page);

  await page.evaluate(() => window.MatsuyamaWalk.start());
  await page.waitForFunction(() => window.MatsuyamaWalk?.state?.active === true);
  await page.waitForTimeout(700);
  const walkFramesPromise = frameSamples(page);
  await page.evaluate(() => window.MatsuyamaWalk.setVirtualStick('move', 0, .9));
  await page.waitForTimeout(moveMs);
  await page.evaluate(() => window.MatsuyamaWalk.setVirtualStick('move', 0, 0));
  const walkFrames = await walkFramesPromise;

  const inputLatency = await inputSamples(page);
  const turnFramesPromise = frameSamples(page);
  await page.evaluate(() => window.MatsuyamaWalk.setVirtualStick('look', .8, .25));
  await page.waitForTimeout(moveMs);
  await page.evaluate(() => window.MatsuyamaWalk.setVirtualStick('look', 0, 0));
  const turnFrames = await turnFramesPromise;
  await page.evaluate(() => window.MatsuyamaWalk.stop());

  await fixedView(page);
  const debug = await page.evaluate(() => window.MatsuyamaImmersive.debug());
  const risk = label === 'desktop' ? await riskSnapshot(page) : null;
  await canvasScreenshot(page, `${variant}-${label}-scene.png`);

  const longTasks = await page.evaluate(() => window.__perf.long.slice());
  const heap = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : null);

  const warmStart = Date.now();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitCore(page);
  await waitWater(page);
  await fixedView(page);
  const warmReady = Date.now() - warmStart;

  await browser.close();
  return {
    coldReady, warmReady, staticFrames, walkFrames, turnFrames, inputLatency, longTasks,
    dem, water, risk, debug,
    network: {
      requests: requests.length,
      contentLength: requests.reduce((s, x) => s + (x.len || 0), 0),
      buildingRiskRequests: requests.filter((x) => x.url.includes('building-risk.json')).length,
      waterJsonRequests: requests.filter((x) => /water3d\/(flood|tsunami)\.json/.test(x.url)).length
    },
    heap
  };
}

const configs = [
  ['chromium', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, 'desktop'],
  ['webkit', { ...devices['iPhone 15'] }, 'iphone']
];

for (const [browserType, opts, label] of configs) {
  results.baseline[label] = await runVariant(browserType, opts, baseline, label, 'baseline');
  results.candidate[label] = await runVariant(browserType, opts, candidate, label, 'candidate');
}

fs.writeFileSync(path.join(outDir, 'raw.json'), JSON.stringify(results));
console.log('PERF RAW COMPLETE');
