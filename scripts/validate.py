import json, pathlib, struct
root=pathlib.Path(__file__).resolve().parents[1]
d=root/'data/buildings'; tiles=json.loads((d/'tileset.json').read_text()); refs=[]
def visit(t):
 if 'content' in t:
  u=t['content'].get('uri',t['content'].get('url')); assert u;refs.append(u)
 for child in t.get('children',[]):visit(child)
visit(tiles['root'])
for u in refs:
 p=d/u;assert p.is_file(),u
 b=p.read_bytes();assert b[:4]==b'b3dm',u
 assert struct.unpack_from('<I',b,8)[0]==len(b),u
 assert len(b)<100_000_000,u
for f in ['index.html','app.js','style.css','gsi-terrain.js','data-config.json','source-metadata.json']:assert (root/'docs'/f).is_file(),f
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
 print('PASS analysis:',m['counts'])
print(f'PASS: {len(refs)} 3D tile references and headers; local assets present')
