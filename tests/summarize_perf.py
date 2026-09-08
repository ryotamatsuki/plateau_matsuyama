#!/usr/bin/env python3
import json, math, statistics, sys
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
root=Path(sys.argv[1] if len(sys.argv)>1 else 'perf-artifacts'); data=json.loads((root/'raw.json').read_text())
def pct(xs,p):
    xs=sorted(float(x) for x in xs if math.isfinite(float(x)))
    if not xs:return None
    k=(len(xs)-1)*p/100;lo=math.floor(k);hi=math.ceil(k)
    return xs[lo] if lo==hi else xs[lo]*(hi-k)+xs[hi]*(k-lo)
def f(v,d=2):return 'n/a' if v is None else f'{v:.{d}f}'
def metrics(r):
    out={}
    for key in ['staticFrames','walkFrames','turnFrames','inputLatency']:
        xs=r[key];out[key]={'p50':pct(xs,50),'p95':pct(xs,95),'p99':pct(xs,99),'max':max(xs) if xs else None}
    ls=[x['duration'] for x in r['longTasks']];out['long']={'count':len(ls),'total':sum(ls),'max':max(ls) if ls else 0}
    return out
def imgdiff(a,b):
    ia=Image.open(a).convert('RGBA');ib=Image.open(b).convert('RGBA');
    if ia.size!=ib.size:return {'sizeMismatch':True}
    diff=ImageChops.difference(ia,ib); hist=diff.histogram();pixels=ia.width*ia.height
    different=sum(1 for v in diff.getdata() if v!=(0,0,0,0)); mean=sum(ImageStat.Stat(diff).mean[:3])/3
    return {'sizeMismatch':False,'differentPct':different/pixels*100,'meanAbs':mean,'maxChannel':max((i%256 for i,n in enumerate(hist) if n),default=0)}
summary={'baseline':{},'candidate':{},'images':{},'dem':{}}
lines=['# Runtime performance optimization report','','Baseline: `eb9393db71d8982277a7eedf6c155f68a117ac2c`','Candidate: `feature/runtime-performance-no-quality-loss`','','All browser results below are GitHub Actions emulation/headless runs, not physical-device measurements.','']
for device in ['desktop','iphone']:
    b=data['baseline'][device];c=data['candidate'][device];bm=metrics(b);cm=metrics(c);summary['baseline'][device]=bm;summary['candidate'][device]=cm
    demdiff=[abs(float(x)-float(y)) for x,y in zip(b['dem'],c['dem']) if math.isfinite(float(x)) and math.isfinite(float(y))];mx=max(demdiff) if demdiff else None;summary['dem'][device]={'maxAbsMeters':mx}
    img=imgdiff(root/f'baseline-{device}-scene.png',root/f'candidate-{device}-scene.png');summary['images'][device]=img
    lines += [f'## {device}', '', '| metric | baseline | candidate |', '|---|---:|---:|']
    for phase,label in [('staticFrames','frame static'),('walkFrames','frame walk'),('turnFrames','frame turn')]:
        for q in ['p50','p95','p99']:
            lines.append(f'| {label} {q} (ms) | {f(bm[phase][q])} | {f(cm[phase][q])} |')
    for q in ['p50','p95','p99']: lines.append(f'| input latency {q} (ms) | {f(bm["inputLatency"][q])} | {f(cm["inputLatency"][q])} |')
    lines += [f'| long tasks count | {bm["long"]["count"]} | {cm["long"]["count"]} |',f'| long tasks total (ms) | {f(bm["long"]["total"])} | {f(cm["long"]["total"])} |',f'| cold core-ready (ms) | {b["coldReady"]} | {c["coldReady"]} |',f'| warm core-ready (ms) | {b["warmReady"]} | {c["warmReady"]} |',f'| response count | {b["network"]["requests"]} | {c["network"]["requests"]} |',f'| building-risk responses | {b["network"]["buildingRiskRequests"]} | {c["network"]["buildingRiskRequests"]} |',f'| water JSON responses | {b["network"]["waterJsonRequests"]} | {c["network"]["waterJsonRequests"]} |',f'| JS heap (bytes, when exposed) | {b["heap"]} | {c["heap"]} |', '', f'DEM maximum absolute difference: **{f(mx,6)} m**.', f'Frozen-water screenshot difference: **{f(img.get("differentPct"),4)}% pixels**, mean absolute RGB channel difference **{f(img.get("meanAbs"),4)}**.', '']
    if mx is None or mx>1e-4: raise SystemExit(f'DEM regression {device}: {mx}')
    if img.get('sizeMismatch') or img.get('differentPct',100)>2.0: raise SystemExit(f'image regression {device}: {img}')
    if c['debug']['verticalExaggeration']!=b['debug']['verticalExaggeration'] or c['debug']['resolutionScale']!=b['debug']['resolutionScale']: raise SystemExit(f'quality tuning regression {device}')
(root/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));Path('PERFORMANCE_OPTIMIZATION.md').write_text('\n'.join(lines),encoding='utf-8');print('\n'.join(lines))
