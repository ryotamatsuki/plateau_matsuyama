import { stage1Routes } from './stage1-test-support.mjs';
import { chromium, webkit } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:8000/';
const target = process.argv[3] || 'all';
const scenario = process.argv[4] || 'all';
// Valid 256px tile (the previous 1px PNG had a corrupt IDAT CRC).
const tilePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAADIklEQVR4nO3UMQHAIADAsDGfCEAKfhCIDI4mCnp1zL3OByT9rwOAdwwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwgwAwi6zowQDpk3AWwAAAABJRU5ErkJggg==', 'base64');

async function run(browserType, name) {
  const browser = await browserType.launch({ headless: true, ...(browserType===chromium?{args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader']}: {}) });
  const context = await browser.newContext(name === 'webkit' ? {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  } : { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await stage1Routes(page);
  await page.addInitScript(()=>{
    for(const type of ['pointerdown','pointerup','click','change'])document.addEventListener(type,e=>{
      if(['sheltersEnabled','rainEnabled','weatherRefresh'].includes(e.target?.id))console.log('UI input event',JSON.stringify({type,id:e.target.id,time:performance.now(),checked:e.target.checked}));
    },true);
  });
  page.on('console',m=>{if(m.text().startsWith('UI input event'))console.log(name,m.text());});

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
  await page.route('**/bosai/jmatile/data/nowc/**.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: tilePng }));
  await page.route('**/seamless/v2/api/1.3/tiles/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: tilePng }));

  const errors = [];
  page.on('crash', () => console.error(`${name}: renderer crash`));
  page.on('pageerror', (e) => { errors.push(String(e)); console.error('pageerror', e.stack); });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.MatsuyamaApp && window.MatsuyamaThematic, null, { timeout: 60000, polling:100 });
  // Capture the actual finished map; taking a WebKit snapshot while b3dm decoding competes with the GPU is unstable.
  await page.waitForFunction(() => /PLATEAU 2020年度 LOD1|建物表示中/.test(document.querySelector('#buildingStatus')?.textContent || ''), null, { timeout: 150000, polling:100 });

  // Text/state readiness uses timer polling; a busy WebGL compositor can delay RAF
  // after the native click/change and DOM update have already completed.
  const options = await page.locator('#thematicLayer option').evaluateAll((els) => els.map((e) => e.value));
  for (const required of ['geology', 'fault', 'forest', 'did2020']) {
    if (!options.includes(required)) throw new Error(`${name}: missing thematic option ${required}`);
  }

  if (scenario === 'all' || scenario === 'geology') {
    await page.selectOption('#thematicLayer', 'geology');
    await page.waitForFunction(() => document.querySelector('#thematicStatus')?.textContent?.includes('新生代'), null, {polling:100});
  }

  if (scenario === 'all' || scenario === 'shelters') {
    await page.locator('#sheltersEnabled').scrollIntoViewIfNeeded();
    console.log('shelters hit test', await page.locator('#sheltersEnabled').evaluate(el => { const b=el.getBoundingClientRect(); return {box:b.toJSON(),hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.outerHTML.slice(0,200),scroll:document.querySelector('#panel').scrollTop}; }));
    await page.screenshot({path:`e2e-artifacts/${name}-before-shelters.png`,timeout:90000,animations:'disabled'});
    await page.check('#sheltersEnabled');
    try {await page.waitForFunction(() => document.querySelector('#shelterStatus')?.textContent?.includes('1件'), null, {polling:100});}
    catch(e){console.error('shelter diagnostics',await page.evaluate(()=>({status:document.querySelector('#shelterStatus')?.textContent,checked:document.querySelector('#sheltersEnabled')?.checked,stage:window.MatsuyamaProceduralStage1?.debug()})));throw e;}
  }

  if (scenario === 'all' || scenario === 'rain') {
    await page.check('#rainEnabled');
    await page.waitForFunction(() => document.querySelector('#rainStatus')?.textContent?.includes('雨雲実況'), null, {polling:100});
  }

  if (scenario === 'all' || scenario === 'weather') {
    await page.click('#weatherRefresh');
    await page.waitForFunction(() => document.querySelector('#weatherStatus')?.textContent?.includes('3.2 m/s'), null, {polling:100});
  }

  if (errors.length) throw new Error(`${name}: page errors: ${errors.join(' | ')}`);
  await page.screenshot({ path: `e2e-artifacts/${name}-${scenario}-thematic-layers.png`, fullPage: false, animations:'disabled', timeout:90000 });
  await browser.close();
}

if (target === 'all' || target === 'chromium') await run(chromium, 'chromium');
if (target === 'all' || target === 'webkit') await run(webkit, 'webkit');
console.log(`thematic layer E2E (${target}/${scenario}): PASS`);
