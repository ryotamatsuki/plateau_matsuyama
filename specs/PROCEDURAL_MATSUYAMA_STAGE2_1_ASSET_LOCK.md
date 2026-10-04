# Procedural Matsuyama Stage 2.1 — LOD2 Asset Import / Source Freeze

## Goal

Freeze the exact PLATEAU LOD2 source used by the Stage 1 pilot bbox before any renderer conversion is attempted.

This stage does **not** change Cesium runtime behavior. It creates a reproducible, integrity-checked source contract for Stage 2.2.

Target bbox:

- west 132.7600
- south 33.8345
- east 132.7712
- north 33.8441

## Canonical source

- City: Matsuyama / 38201
- Source year: 2020
- PLATEAU registration year: 2024
- PLATEAU spec: 4.1
- meshes: 50326600, 50326601, 50326610, 50326611
- source: PLATEAU CityGML distribution API

The four source building GML files are individually 113–167 MB and total **536,216,034 bytes**. Each is larger than GitHub's normal single-blob limit, so raw CityGML is intentionally not committed to this repository.

Instead, the repository stores:

- the exact source URL for each mesh;
- SHA-256 for every source GML file;
- byte length for every source GML file;
- gml:id-level building index;
- building-to-texture mapping;
- exact source URL, SHA-256, byte length, format and dimensions for every referenced texture image.

Stage 2.2 must re-download source bytes and verify the lock before conversion.

## Measured source freeze

Final freeze workflow:

https://github.com/ryotamatsuki/plateau_matsuyama/actions/runs/37237516356

Results:

| Item | Result |
| --- | ---: |
| Buildings intersecting bbox | 1,572 |
| LOD2 buildings | 1,496 |
| LOD1 fallback buildings | 76 |
| LOD2 coverage | 95.17% |
| Non-horizontal roof buildings | 823 |
| Unique texture atlas images used by target LOD2 buildings | 1,496 |
| Source GML bytes | 536,216,034 |
| Referenced texture bytes | 39,898,461 |
| Full validated snapshot bytes | 576,114,495 |
| Missing/broken texture images | 0 |

Every one of the 1,496 LOD2 buildings maps to exactly one JPEG texture atlas. The same atlas is referenced by both the building's wall and roof appearance targets.

All 1,496 JPEGs were downloaded and decoded successfully with Pillow during the freeze run.

Texture size range:

- minimum: 410 bytes
- median: 13,186 bytes
- maximum: 740,859 bytes
- largest decoded dimensions observed: 2048×2048

## Source mesh lock

| Mesh | bbox buildings | bbox LOD2 | bytes | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| 50326600 | 306 | 246 | 117,503,716 | 2b3c02424adb35b939979821e443be8b8a7977857d011dbfef7605f4a33224bb |
| 50326601 | 1,138 | 1,122 | 167,215,737 | f5575b7582038535ff613dab2f6b4d5de21248c963c2f8a4cb503530088091c9 |
| 50326610 | 4 | 4 | 138,402,507 | 100e88cb9aa173bb452214629650bcd057e17d8f90f7f964bc14d9be2eea9750 |
| 50326611 | 124 | 124 | 113,094,074 | 4812d35a05234c5d01991e84058e2eda1b66520685a3021c62853c3bc8c6e53d |

## Repository artifacts

- `tools/import_stage2_lod2.py`
  - downloads all four source GML files;
  - parses only buildings intersecting the Stage 1 bbox;
  - resolves Appearance target -> imageURI relations;
  - downloads all texture atlases used by target buildings;
  - decodes images;
  - hashes GML and images;
  - fails if the frozen counts change or any referenced image is unavailable/broken.

- `data/stage2-lod2/source-lock.json`
  - source GML hashes and texture hashes/metadata.

- `data/stage2-lod2/building-index.json`
  - gml:id-level LOD2/fallback classification and wall/roof texture mapping.

- `data/stage2-lod2/summary.json`
  - compact canonical metrics.

- `.github/workflows/stage2-1-lod2-assets.yml`
  - reproducible full freeze run and temporary raw snapshot artifact.

- `scripts/validate.py`
  - permanently validates the lock counts, IDs, texture keys and hashes in normal CI.

## Storage decision

Do not commit the 576 MB raw source snapshot directly.

Reasons:

1. all four GML files exceed the normal GitHub 100 MB blob limit individually;
2. duplicating public PLATEAU source would significantly inflate an already data-heavy repository;
3. the public source URLs plus cryptographic hashes are sufficient to verify exact bytes before deterministic conversion;
4. the full raw snapshot remains available as a short-lived Actions artifact for inspection during the freeze run.

If long-term byte-level archival becomes necessary, use an explicit large-object/release-object strategy rather than ordinary Git history.

## Stage 2.2 handoff contract

Before converting any LOD2 building to Cesium/3D Tiles/glTF, Stage 2.2 must:

1. load `source-lock.json`;
2. download the four CityGML source files;
3. verify exact GML SHA-256 and byte length;
4. download only the texture atlases required by the target gml:id set;
5. verify image SHA-256, format and dimensions;
6. fail closed if any locked byte changes;
7. preserve `gml:id` through conversion;
8. preserve the 76-building LOD1 fallback set;
9. keep source provenance in the derived asset manifest.

Stage 2.2 may generate optimized derived assets, but must never silently accept a source that differs from this freeze.

## Acceptance result

Stage 2.1 is complete when:

- four LOD2 source GML files are downloaded and cryptographically locked;
- all 1,496 target LOD2 buildings are indexed by gml:id;
- all wall/roof appearance targets resolve;
- all 1,496 referenced JPEG atlases download and decode;
- missing/broken texture count is zero;
- 76 LOD1-only fallback buildings are explicitly identified;
- lock data is committed and enforced by CI;
- no Cesium runtime behavior is changed.

All of these conditions are satisfied by the current Stage 2.1 branch.
