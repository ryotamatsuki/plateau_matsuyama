import { gunzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
export async function stage1Routes(page) {
  const mode=process.env.STAGE1_MODE;
  if (mode==='off'||mode==='shader') await page.route('**/procedural-matsuyama-stage1*.js', route=>route.fulfill({contentType:'text/javascript',body:mode==='off'||route.request().url().includes('-streets')?'':fs.readFileSync('docs/procedural-matsuyama-stage1.js','utf8')}));
  if (process.env.STAGE1_OSM_FIXTURE==='1') await page.route(/https:\/\/overpass[^/]*\/api\/interpreter$/, route=>route.fulfill({status:200,contentType:'application/json',body:gunzipSync(fs.readFileSync('tests/fixtures/matsuyama-osm.json.gz'))}));
  // Branch tests use the same committed PLATEAU bytes without remote GitHub throttling.
  if (process.env.STAGE1_LOCAL_TILES==='1') await page.route('https://raw.githubusercontent.com/ryotamatsuki/plateau_matsuyama/main/data/buildings/**', route=>{
    const file=route.request().url().split('/main/')[1];
    return route.fulfill({path:path.resolve(file)});
  });
}
