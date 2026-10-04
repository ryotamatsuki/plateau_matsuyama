# Procedural Matsuyama Stage 2.2 — LOD2 renderer POC

## Goal

Stage 2.1 froze the original Matsuyama 2020 CityGML and appearance assets. Stage 2.2 determines the production rendering path before the full LOD1/LOD2 replacement in Stage 2.3.

The first-choice renderer is the official PLATEAU distribution service 3D Tiles endpoint:

`https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/38201-bldg-lod2-texture-2020/tileset.json`

PLATEAU documents the composite 3D Tiles endpoint as the recommended CesiumJS access path. The API is currently a trial service and may change, so Stage 2.1 source locks remain the reproducible fallback source.

## Pilot set

The POC contains the 36 nearest LOD2 buildings to the Ehime Prefectural Government pilot center:

- center: 132.7658, 33.8416
- 36 LOD2 buildings
- 13 with non-horizontal roof geometry
- all 36 have Stage 2.1 locked texture references
- IDs are fixed in `docs/stage2-lod2-poc-manifest.json`

Selection is by the CityGML building envelope centroid recorded in the Stage 2.1 building index. It is not a claim about cadastral parcel membership.

## Runtime isolation

Stage 2.2 is opt-in and OFF by default.

When OFF:

- the official LOD2 tileset is not requested;
- Stage 1 and all existing GIS behavior are unchanged.

When ON:

- the official PLATEAU LOD2 textured tileset is loaded lazily;
- only the 36 selected `gml_id` features are shown;
- existing LOD1 buildings remain as a comparison layer at 32% opacity;
- the POC only displays within 2.6 km of the pilot center and below 1,400 m camera height.

When building risk coloring is not `normal`, the LOD2 POC is hidden and the original LOD1 opacity is restored. Stage 2.2 must not obscure authoritative hazard/risk visualization.

## Why direct official 3D Tiles first

A direct PLATEAU 3D Tiles path avoids committing or rebuilding the 536 MB CityGML source and keeps the original texture mapping and geometry conversion managed by the PLATEAU distribution pipeline.

The direct path is accepted for Stage 2.3 only if the browser POC proves:

1. CesiumJS 1.130 loads the endpoint without runtime errors.
2. feature metadata exposes a stable `gml_id`-equivalent property.
3. the selected IDs from the Stage 2.1 CityGML lock are present in the 3D Tiles.
4. appearance texture requests succeed.
5. a selected LOD2 feature can be returned by `scene.pick`.
6. disabling the POC restores the existing LOD1 presentation.
7. risk mode immediately suppresses the POC.
8. default OFF causes zero LOD2 endpoint requests.

If any of 1–5 fails, Stage 2.2 falls back to a repository-controlled CityGML-to-glTF/3D-Tiles conversion pipeline verified against the Stage 2.1 SHA-256 lock.

## Explicit non-goals

Stage 2.2 does not:

- replace all 1,496 LOD2 buildings;
- permanently suppress matching LOD1 features;
- transfer building risk cards to LOD2 features;
- optimize mobile/GPU performance;
- replace Stage 1 roads, sidewalks, trees or lights.

Those belong to Stage 2.3 and later.

## Diagnostics

`window.MatsuyamaStage2Lod2Poc.debug()` reports:

- enabled/loading/failed state;
- selected and observed IDs;
- feature property IDs;
- visible state;
- texture request observations;
- comparison-layer state;
- source tileset URL.

## Acceptance gate

Stage 2.2 is complete only when the dedicated browser E2E and all existing Immersive / Navigation / Stage 1 / Thematic regression tests pass, followed by Pages deployment and public-URL validation.

The POC must remain OFF by default after merge.
