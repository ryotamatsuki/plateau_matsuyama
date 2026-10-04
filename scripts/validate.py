import json, pathlib, struct
root=pathlib.Path(__file__).resolve().parents[1]
d=root/'data/buildings'; tiles=json.loads((d/'tileset.json').read_text()); refs=[]
def visit(t):
 if 'content' in t:
  u=t['content'].get('uri',t['content'].get('url')); assert u;refs.append(u)
 for child in t.get('children',[]):visit(child)
visit(tiles['root'])
assert len(refs)==2132, f'expected 2132 3D Tiles references, got {len(refs)}'
for u in refs:
 p=d/u;assert p.is_file(),u
 b=p.read_bytes();assert b[:4]==b'b3dm',u
 assert struct.unpack_from('<I',b,8)[0]==len(b),u
 assert len(b)<100_000_000,u
for f in ['index.html','app.js','style.css','gsi-terrain.js','walk-mode.js','water-volume.js','immersive-gis.js','procedural-matsuyama-stage1.js','procedural-matsuyama-stage1-streets.js','stage2-lod2-poc.js','stage2-lod2-poc-manifest.json','data-config.json','source-metadata.json']:assert (root/'docs'/f).is_file(),f
html=(root/'docs/index.html').read_text(encoding='utf-8')
assert '<option value="seamlessphoto" selected>' in html, 'seamlessphoto must be the default basemap'
assert html.index('value="seamlessphoto"') < html.index('value="pale"') < html.index('value="std"'), 'basemap order must be aerial, pale, standard'
assert 'immersive-gis.js' in html
assert 'procedural-matsuyama-stage1.js' in html
assert 'procedural-matsuyama-stage1-streets.js' in html
assert 'stage2-lod2-poc.js' in html
assert 'id="stage2Lod2Poc"' in html
proc=(root/'docs/procedural-matsuyama-stage1.js').read_text(encoding='utf-8')
streets=(root/'docs/procedural-matsuyama-stage1-streets.js').read_text(encoding='utf-8')
for token in ['CustomShader','ambientOcclusion','initialTilesLoaded','u_on','setUniform','featureId_0','MatsuyamaProceduralStage1']: assert token in proc, token
for token in ['overpass-api.de','corridor','sampleEllipsoidHeight','street_lamp']: assert token in streets, token
assert '全国最新写真（シームレス）' in html
analysis=root/'data/analysis'
if analysis.exists():
 m=json.loads((analysis/'manifest.json').read_text(encoding='utf-8'))
 assert m.get('complete') is True
 assert int(m.get('pipelineVersion',0))>=3
 assert int(m['counts']['buildings'])>0
 assert int(m['counts']['floodFeatures'])>0
 assert int(m['counts']['landslideFeatures'])>0
 br=json.loads((analysis/'building-risk.json').read_text(encoding='utf-8'))
 assert len(br.get('schema',[]))>=10
 assert len(br.get('records',[]))==int(m['counts']['buildings'])
 for f in ['city_boundary.geojson','hazards/flood_max.geojson','hazards/landslide.geojson','hazards/tsunami.geojson','building-properties.json']:
  assert (analysis/f).is_file(),f
 water=analysis/'water3d'
 if water.exists():
  wm=json.loads((water/'manifest.json').read_text(encoding='utf-8'))
  assert wm.get('complete') is True
  assert float(wm.get('verticalScale',0))==1.0
  for name in ['flood','tsunami']:
   meta=wm[name];assert int(meta['features'])>0
   wp=water/meta['file'];assert wp.is_file() and wp.stat().st_size>1000
   payload=json.loads(wp.read_text(encoding='utf-8'))
   assert payload.get('version')==1
   assert payload.get('scenario')==name
   assert len(payload.get('features',[]))==int(meta['features'])
  print('PASS water3d:',wm)
 print('PASS analysis:',m['counts'])
elevation=root/'data/elevation/manifest.json'
if elevation.exists():
 em=json.loads(elevation.read_text(encoding='utf-8'))
 assert em.get('complete') is True
 assert int(em.get('availableTiles',0))>0
 assert int(em.get('expectedTiles',0))>=int(em.get('availableTiles',0))
 assert em.get('heightReference')
 assert em.get('geoid',{}).get('rows',0)>0 and em.get('geoid',{}).get('cols',0)>0
 print('PASS elevation:', {k:em.get(k) for k in ['availableTiles','expectedTiles','missingTileCount','complete']})
stage2_poc=root/'docs/stage2-lod2-poc-manifest.json'
if stage2_poc.exists():
 p=json.loads(stage2_poc.read_text(encoding='utf-8'))
 assert p.get('stage')=='2.2'
 assert int(p.get('buildingCount',0))==36
 assert len(p.get('selected',[]))==36
 ids=[x.get('gml_id') for x in p['selected']]
 assert all(ids) and len(set(ids))==36
 assert sum(1 for x in p['selected'] if x.get('sloped_roof'))==13
 assert p.get('source',{}).get('tilesetUrl')=='https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/38201-bldg-lod2-texture-2020/tileset.json'
 print('PASS stage2-2-poc:', {'buildings':36,'sloped':13})
stage2_lod2=root/'data/stage2-lod2'
if stage2_lod2.exists():
 summary=json.loads((stage2_lod2/'summary.json').read_text(encoding='utf-8'))
 lock=json.loads((stage2_lod2/'source-lock.json').read_text(encoding='utf-8'))
 index=json.loads((stage2_lod2/'building-index.json').read_text(encoding='utf-8'))
 counts=summary['counts']
 assert int(counts['buildings'])==1572
 assert int(counts['lod2_buildings'])==1496
 assert int(counts['lod1_fallback_buildings'])==76
 assert int(counts['invalid_or_missing_textures'])==0
 assert len(summary.get('source_meshes',[]))==4
 assert all(len(x.get('sha256',''))==64 and int(x.get('bytes',0))>100_000_000 for x in summary['source_meshes'])
 textures=lock.get('textures',{})
 assert len(textures)==1496
 assert all(len(v.get('sha256',''))==64 and int(v.get('bytes',0))>0 for v in textures.values())
 assert all(v.get('format')=='JPEG' and int(v.get('width',0))>0 and int(v.get('height',0))>0 for v in textures.values())
 buildings=index.get('buildings',[])
 assert len(buildings)==1572
 ids=[b.get('gml_id') for b in buildings]
 assert all(ids) and len(set(ids))==len(ids)
 lod2=[b for b in buildings if b.get('lod2')]
 fallback=[b for b in buildings if not b.get('lod2')]
 assert len(lod2)==1496 and len(fallback)==76
 assert all(len(b.get('texture_keys',[]))==1 for b in lod2)
 assert all(len(b.get('roof_texture_keys',[]))==1 and len(b.get('wall_texture_keys',[]))==1 for b in lod2)
 assert all(k in textures for b in lod2 for k in b.get('texture_keys',[]))
 print('PASS stage2-lod2:', counts)
print(f'PASS: {len(refs)} 3D tile references and headers; local assets present; aerial basemap default validated')
