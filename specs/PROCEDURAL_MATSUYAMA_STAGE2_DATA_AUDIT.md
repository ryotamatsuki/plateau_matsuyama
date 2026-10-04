# Procedural Matsuyama Stage 2 — data audit

## Scope

Stage 1 bbox:

- west 132.7600
- south 33.8345
- east 132.7712
- north 33.8441

The audit was executed against the current PLATEAU distribution API from GitHub Actions, not inferred from documentation alone.

Workflow:

- https://github.com/ryotamatsuki/plateau_matsuyama/actions/runs/37231824126

Reproducible audit:

- `tools/audit_stage2_citygml.py`
- `.github/workflows/stage2-data-audit.yml`
- `data/stage2-audit/stage2-data-audit.json`

## PLATEAU source actually returned for the bbox

- city: Matsuyama / 38201
- source year: 2020
- registration year: 2024
- PLATEAU spec: 4.1
- intersecting mesh codes: 50326600, 50326601, 50326610, 50326611
- feature types returned: bldg, dem, fld, lsld, luse, tnm, tran, urf
- no vegetation (`veg`) or CityFurniture (`frn`) files are exposed for this dataset/bbox.

The current repository's LOD1 analysis asset declares `gml_id` as the building ID property and records its geometry source as PLATEAU CityGML 38201-2020. Therefore LOD2 replacement can use `gml:id` as the primary join key instead of spatial matching alone.

## Building audit

Exact geometry intersection with the Stage 1 bbox:

| item | result |
| --- | ---: |
| total buildings | 1,572 |
| LOD2 buildings | 1,496 |
| LOD1-only buildings | 76 |
| LOD2 coverage | 95.17% |
| buildings with RoofSurface | 1,496 |
| buildings with WallSurface | 1,496 |
| buildings with non-horizontal roof geometry | 823 |
| LOD2 buildings with appearance texture target | 1,496 |
| wall texture target | 1,496 |
| roof texture target | 1,496 |
| distinct imageURI references found | 7,653 |

Conclusion: the Stage 1 pilot area is overwhelmingly covered by real LOD2. Procedural building geometry should not be the primary representation here.

### Production policy

1. LOD2 building with usable appearance:
   use real LOD2 geometry + real PLATEAU appearance.
2. LOD2 building with missing/broken appearance:
   use real LOD2 geometry + restrained material fallback.
3. LOD1-only building:
   retain Stage 1 procedural facade/roof treatment.
4. Never render the LOD1 and LOD2 copy of the same `gml:id` simultaneously.

The 76 LOD1-only buildings are the initial fallback set.

## Roof decision

823 of 1,496 LOD2 buildings contain roof surfaces whose Z values vary by more than 0.15 m within a roof surface.

This confirms that real pitched/non-horizontal roof geometry is materially present in the pilot area and should replace the Stage 1 synthetic roof treatment where available.

The remaining LOD2 buildings may legitimately have flat roofs; they must not be artificially converted to pitched roofs.

## Facade decision

All 1,496 LOD2 buildings have appearance targets associated with both wall and roof polygons in the audited CityGML.

The audit confirms the presence of CityGML texture references. Production import must additionally verify referenced image bytes and image decoding before the LOD2 layer is made canonical.

## Transportation audit

Exact bbox intersection:

| item | result |
| --- | ---: |
| Road objects | 560 |
| PLATEAU transportation max LOD | 1 |
| TrafficArea | 0 |
| AuxiliaryTrafficArea | 0 |
| function 1000 vehicle area | 0 |
| function 1020 intersection | 0 |
| function 2000 sidewalk | 0 |

Conclusion: PLATEAU Matsuyama provides official road geometry in this area, but only LOD1. It does not provide the LOD2 TrafficArea subdivision required to distinguish carriageway and sidewalk.

Therefore the original Stage 2 phrase “official road / sidewalk geometry from PLATEAU” must be split:

- official PLATEAU road footprint/surface: usable;
- official PLATEAU sidewalk polygon: unavailable in this dataset;
- sidewalk must come from another authoritative source or remain explicitly non-authoritative fallback.

## Matsuyama authoritative road source

Matsuyama publishes the Road Ledger Plan through “e-Yo Machi Navi”. The city states that road names, widths, and road areas can be viewed online.

Source:

- https://www.city.matsuyama.ehime.jp/kurashi/download/kurashi/dourokouen/dourodaichou.html
- https://www2.wagmap.jp/matsuyamacity/Portal

This is a stronger source for current road width/area than OSM. However, a documented reusable vector/API download and its reuse conditions were not found in the open-data catalog during this audit.

Do not scrape or republish the public GIS layer until its terms and technical endpoint are verified.

## Street-tree ledger

Matsuyama City Council's official newsletter records that the city manages street trees by assigning numbers by route and updates species, height and trunk circumference from field surveys.

Source:

- https://www.city.matsuyama.ehime.jp/shigikai/dayori/20251115dayori.files/20251115dayori.pdf

An earlier city information-disclosure record also shows that material identifying tree species by central-city route was fully disclosed.

Source:

- https://www.city.matsuyama.ehime.jp/shisei/keikaku/johokokai/jouhou.files/R3-jouhou.pdf

Conclusion: an authoritative street-tree inventory exists, but it is not currently exposed as an open downloadable GIS dataset found by this audit.

Stage 2 should treat acquisition through an official information-provision/open-data route as preferred. Until obtained, OSM nodes may remain as a clearly-labelled fallback; procedural trees must not be presented as surveyed assets.

## Road-lighting ledger

Matsuyama's Road Lighting Smart Light ESCO specification requires a management system able to manage and import/export, including:

- management number and location;
- pole/source identifiers;
- installation date and relocation;
- luminaire/pole specifications;
- electricity-contract information;
- repair/relocation history;
- photographs.

Source:

- https://www.city.matsuyama.ehime.jp/shisei/denshinyusatsu/gyoumuitaku/info/r4itaku/syoumeitou-esco.files/siyou.pdf

Conclusion: authoritative positional road-lighting data exists in the city's management system. It is not currently published in the open-data catalog located by this audit.

Preferred Stage 2 route is an official data provision/export for the pilot bbox. OSM street_lamp remains fallback only.

## Open-data check

The Matsuyama open-data portal was searched for roads, sidewalks, street trees and lighting. No downloadable street-tree or road-lighting inventory was found.

Source:

- https://www.city.matsuyama.ehime.jp/shisei/opendata/top.html
- https://www.city.matsuyama.ehime.jp/shisei/opendata/metadata/opendatalist.html

This is a statement about public availability, not about whether internal municipal datasets exist.

## Stage 2 architecture fixed by this audit

### Building layer

`LOD2 textured -> LOD2 material fallback -> Stage 1 procedural LOD1`

Use `gml:id` to mask the corresponding LOD1 building whenever the LOD2 building is active.

### Road layer

`authoritative road-ledger geometry if reusable -> PLATEAU LOD1 road geometry -> OSM fallback`

The PLATEAU tran layer can replace synthetic road footprints, but cannot provide sidewalk subdivision in Matsuyama 2020.

### Sidewalk layer

`authoritative road-ledger / other official polygon if obtainable -> OSM-derived Stage 1 fallback`

Never label the OSM-derived sidewalk band as official geometry.

### Vegetation

`Matsuyama street-tree ledger -> OSM natural=tree -> procedural infill`

Each rendered instance must retain a provenance field.

### Lighting

`Matsuyama road-lighting management export -> OSM highway=street_lamp -> procedural infill`

Each rendered instance must retain a provenance field.

## GPU and runtime implementation target

After source ingestion is fixed:

- convert repeated trees and luminaires from Cesium Entity primitives to instanced geometry;
- preserve per-instance provenance/ID for picking;
- load LOD2 only in the high-detail pilot envelope and by camera-distance/SSE gate;
- keep LOD1 as the far-field representation;
- pre-warm or defer LOD2 texture/shader pipelines without blocking initial GIS readiness;
- profile cold shader compilation, first pick, texture upload, and camera interaction separately;
- run the same OFF / LOD1 procedural / LOD2 hybrid regression matrix on desktop and mobile;
- perform final profiling on real GPU hardware in addition to GitHub Actions SwiftShader.

## Stage 2 implementation order

1. verify/download appearance image bytes for the four LOD2 meshes;
2. build an LOD2 import pipeline preserving `gml:id`;
3. render the four pilot meshes as a separate LOD2 layer;
4. suppress matching LOD1 features by `gml:id`;
5. retain the 76 LOD1-only procedural buildings;
6. replace Stage 1 road corridors with PLATEAU LOD1 road surfaces where appropriate;
7. investigate reusable Matsuyama road-ledger geometry for widths/road areas and sidewalk source;
8. request/obtain street-tree and road-lighting exports if possible;
9. implement instanced vegetation/luminaires;
10. run visual, compatibility and real-device GPU profiling gates.

## Acceptance gate before calling Stage 2 complete

- no duplicate LOD1/LOD2 buildings;
- LOD2 textures decode and render without broken references;
- all LOD2 buildings keep building query/risk linkage;
- flat roofs remain flat; real pitched roofs are preserved;
- provenance visible/debuggable for roads, sidewalks, trees and lights;
- hazard rendering remains authoritative over scenic materials;
- Stage 1 fallback works for the 76 LOD1-only buildings;
- mobile does not regress to black-frame/context-loss behavior;
- real-device cold shader/pick measurements are recorded.
