# Walk Mode 2.0 — W2.3 local collision and terrain cache

## Goal

Remove high-frequency dependency on rendered PLATEAU 3D Tiles for character collision in the central walk area, and remove asynchronous terrain sampling from the movement hot path.

## Local collision

W2.3 ships a compact local collider asset:

- `docs/walk-colliders-stage1.json`
- 1,572 PLATEAU building envelopes
- coverage: 132.7600–132.7712 E, 33.8345–33.8441 N
- source: `data/stage2-lod2/building-index.json`
- player radius: 0.38 m
- spatial hash cell size: 0.001°

The character is approximated horizontally by a 0.38 m radius capsule/circle. Collision is evaluated entirely on CPU against nearby building envelopes.

The first attempt tests the full movement vector. If blocked, X/Y components are tested separately to permit wall sliding instead of producing a hard stop.

The current asset uses axis-aligned CityGML building envelopes rather than exact ground-surface polygons. This is intentionally conservative and small enough for immediate browser loading. A future asset upgrade can replace envelopes with exact footprint rings without changing the runtime collision API.

## Fallback

Inside local-collider coverage, `scene.pickFromRay()` is not used for character movement.

Outside coverage, the previous PLATEAU 3D Tiles ray collision remains as a compatibility fallback. This preserves nationwide/Matsuyama-wide walk behavior while the local collider coverage is expanded incrementally.

## Terrain cache

The existing GSI DEM implementation already keeps decoded DEM PNG tiles in an LRU cache. W2.3 exposes synchronous reads from that cache:

- `sampleOrthometricHeightCached(lon, lat)`
- `sampleEllipsoidHeightCached(lon, lat)`
- `warmHeightCache(lon, lat, radiusMeters)`

Walk mode warms the current area asynchronously, then uses `sampleEllipsoidHeightCached()` directly during movement. The existing authoritative async sampler remains as a low-frequency refinement path.

Therefore the movement hot path no longer needs to await DEM fetch/decode.

## Acceptance criteria

1. local collider asset loads and contains 1,572 buildings;
2. a point at a known building envelope center is blocked;
3. inside local coverage, movement does not call `scene.pickFromRay()`;
4. outside coverage, ray collision fallback still works;
5. cached DEM sampling returns finite height after warm-up;
6. movement uses the cached terrain sampler;
7. W2.1 single-RAF ownership remains intact;
8. W2.2 GLB avatar behavior remains intact;
9. existing immersive, navigation, Stage 1 and Stage 2.2 tests remain green;
10. deployed Pages passes W2.1/W2.2/W2.3 E2E after merge.

## Deferred

W2.4 adds TPS spring camera, pointer-lock mouse look tuning and camera obstruction handling. W2.5 adds walk-specific LOD2 proximity/render budgets.
