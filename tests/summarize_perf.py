#!/usr/bin/env python3
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'perf-artifacts')
data = json.loads((root / 'raw.json').read_text())


def pct(xs, p):
    xs = sorted(float(x) for x in xs if math.isfinite(float(x)))
    if not xs:
        return None
    k = (len(xs) - 1) * p / 100
    lo, hi = math.floor(k), math.ceil(k)
    return xs[lo] if lo == hi else xs[lo] * (hi - k) + xs[hi] * (k - lo)


def f(value, digits=2):
    return 'n/a' if value is None else f'{value:.{digits}f}'


def metrics(run):
    out = {}
    for key in ['staticFrames', 'walkFrames', 'turnFrames', 'inputLatency']:
        xs = run[key]
        out[key] = {
            'n': len(xs),
            'p50': pct(xs, 50),
            'p95': pct(xs, 95),
            'p99': pct(xs, 99),
            'max': max(xs) if xs else None,
        }
    long_ms = [x['duration'] for x in run['longTasks']]
    out['long'] = {
        'count': len(long_ms),
        'total': sum(long_ms),
        'max': max(long_ms) if long_ms else 0,
    }
    return out


def image_diff(a, b):
    ia = Image.open(a).convert('RGBA')
    ib = Image.open(b).convert('RGBA')
    if ia.size != ib.size:
        return {'sizeMismatch': True}
    diff = ImageChops.difference(ia, ib)
    pixels = list(diff.getdata())
    n = ia.width * ia.height
    exact = sum(1 for px in pixels if px != (0, 0, 0, 0))
    material = sum(1 for px in pixels if max(px[:3]) > 4)
    mean = sum(ImageStat.Stat(diff).mean[:3]) / 3
    return {
        'sizeMismatch': False,
        'exactDifferentPct': exact / n * 100,
        'materialDifferentPct': material / n * 100,
        'meanAbs': mean,
    }


def require_equal(label, left, right):
    if left != right:
        raise SystemExit(f'{label} regression: baseline={left!r}, candidate={right!r}')


summary = {'baseline': {}, 'candidate': {}, 'images': {}, 'dem': {}, 'quality': {}, 'water': {}, 'risk': {}}
lines = [
    '# Runtime performance optimization report',
    '',
    'Baseline: `eb9393db71d8982277a7eedf6c155f68a117ac2c`',
    'Candidate: `feature/runtime-performance-no-quality-loss`',
    '',
    'Measurements are GitHub Actions headless/emulated browser runs. They are not physical Android/iPhone measurements.',
    'Frame percentiles are reported with sample counts because software WebGL can produce very small samples and large runner-dependent stalls.',
    '',
]

quality_keys = [
    'base', 'baseUrl', 'baseMinimumLevel', 'baseMaximumLevel', 'baseBrightness', 'baseContrast',
    'baseSaturation', 'baseGamma', 'mobile', 'tilesetSSE', 'hazard2dVisible', 'hazardAlpha',
    'resolutionScale', 'verticalExaggeration'
]

for device in ['desktop', 'iphone']:
    b = data['baseline'][device]
    c = data['candidate'][device]
    bm, cm = metrics(b), metrics(c)
    summary['baseline'][device], summary['candidate'][device] = bm, cm

    dem_diff = [abs(float(x) - float(y)) for x, y in zip(b['dem'], c['dem']) if math.isfinite(float(x)) and math.isfinite(float(y))]
    max_dem = max(dem_diff) if dem_diff else None
    summary['dem'][device] = {'maxAbsMeters': max_dem}

    img = image_diff(root / f'baseline-{device}-scene.png', root / f'candidate-{device}-scene.png')
    summary['images'][device] = img

    quality = {key: {'baseline': b['debug'].get(key), 'candidate': c['debug'].get(key)} for key in quality_keys}
    summary['quality'][device] = quality
    for key, pair in quality.items():
        require_equal(f'{device} quality {key}', pair['baseline'], pair['candidate'])

    summary['water'][device] = {'baseline': b['water'], 'candidate': c['water']}
    require_equal(f'{device} water status', b['water']['status'], c['water']['status'])
    require_equal(f'{device} water primitive count', b['water']['primitiveCount'], c['water']['primitiveCount'])
    require_equal(f'{device} water material signatures', b['water']['materialSignatures'], c['water']['materialSignatures'])

    if max_dem is None or max_dem > 1e-4:
        raise SystemExit(f'DEM regression {device}: {max_dem}')
    if img.get('sizeMismatch') or img.get('materialDifferentPct', 100) > 2.0:
        raise SystemExit(f'image regression {device}: {img}')

    lines += [f'## {device}', '', '| metric | baseline | candidate |', '|---|---:|---:|']
    for phase, label in [('staticFrames', 'frame static'), ('walkFrames', 'frame walk'), ('turnFrames', 'frame turn')]:
        for q in ['p50', 'p95', 'p99']:
            lines.append(f'| {label} {q} (ms) | {f(bm[phase][q])} | {f(cm[phase][q])} |')
        lines.append(f'| {label} samples | {bm[phase]["n"]} | {cm[phase]["n"]} |')
    for q in ['p50', 'p95', 'p99']:
        lines.append(f'| input latency {q} (ms) | {f(bm["inputLatency"][q])} | {f(cm["inputLatency"][q])} |')
    lines += [
        f'| input latency samples | {bm["inputLatency"]["n"]} | {cm["inputLatency"]["n"]} |',
        f'| long tasks count | {bm["long"]["count"]} | {cm["long"]["count"]} |',
        f'| long tasks total (ms) | {f(bm["long"]["total"])} | {f(cm["long"]["total"])} |',
        f'| long task max (ms) | {f(bm["long"]["max"])} | {f(cm["long"]["max"])} |',
        f'| cold fully-stable ready (ms) | {b["coldReady"]} | {c["coldReady"]} |',
        f'| warm fully-stable ready (ms) | {b["warmReady"]} | {c["warmReady"]} |',
        f'| response count | {b["network"]["requests"]} | {c["network"]["requests"]} |',
        f'| building-risk responses | {b["network"]["buildingRiskRequests"]} | {c["network"]["buildingRiskRequests"]} |',
        f'| water JSON responses | {b["network"]["waterJsonRequests"]} | {c["network"]["waterJsonRequests"]} |',
        f'| response Content-Length total (bytes, known headers only) | {b["network"]["contentLength"]} | {c["network"]["contentLength"]} |',
        f'| JS heap (bytes, when exposed) | {b["heap"]} | {c["heap"]} |',
        '',
        f'DEM maximum absolute difference: **{f(max_dem, 6)} m**.',
        f'Frozen-water canvas difference: **{f(img.get("materialDifferentPct"), 4)}% material pixels** (>4/channel), exact changed pixels **{f(img.get("exactDifferentPct"), 4)}%**, mean absolute RGB channel difference **{f(img.get("meanAbs"), 4)}**.',
        f'Water runtime signature: **{b["water"]["primitiveCount"]} primitives**, {b["water"]["status"]}.',
        '',
    ]

# Desktop card equality exercises the production pick -> building-risk lookup -> card path in both versions.
brisk, crisk = data['baseline']['desktop'].get('risk'), data['candidate']['desktop'].get('risk')
summary['risk']['desktop'] = {'baseline': brisk, 'candidate': crisk}
if not brisk or not crisk or not brisk.get('found') or not crisk.get('found'):
    raise SystemExit(f'risk snapshot unavailable: baseline={brisk}, candidate={crisk}')
require_equal('desktop building risk card values', brisk['text'], crisk['text'])
lines += [
    '## Equality gates',
    '',
    '- DEM: PASS (candidate equals baseline within 0.0001 m at sampled points).',
    '- Runtime quality parameters: PASS (basemap, SSE at stable view, resolution scale, vertical exaggeration, hazard presentation).',
    '- 3D water: PASS (status, primitive count, and material uniforms match baseline).',
    '- Building risk: PASS (same picked-building risk card values).',
    '- Canvas image: PASS when material pixel difference remains within the 2% tolerance after both terrain and 3D Tiles report loaded/stable.',
    '',
    f'Risk card first-ready time (desktop): baseline **{brisk["loadMs"]} ms**, candidate **{crisk["loadMs"]} ms**.',
    '',
]

(root / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
Path('PERFORMANCE_OPTIMIZATION.md').write_text('\n'.join(lines), encoding='utf-8')
print('\n'.join(lines))
