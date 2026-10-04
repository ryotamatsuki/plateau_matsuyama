#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import math
import pathlib
import re
import shutil
import tempfile
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable

BBOX = (132.7600, 33.8345, 132.7712, 33.8441)
CITY_CODE = "38201"
EXPECTED_TOTAL = 1572
EXPECTED_LOD2 = 1496
EXPECTED_FALLBACK = 76
CATALOG_API = "https://api.plateauview.mlit.go.jp/datacatalog/citygml"
UA = "plateau-matsuyama-stage2-1/1.0 (+https://github.com/ryotamatsuki/plateau_matsuyama)"
GML_ID = "{http://www.opengis.net/gml}id"
XLINK_HREF = "{http://www.w3.org/1999/xlink}href"

def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag

def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def request(url: str, *, method: str = "GET", timeout: int = 90):
    req = urllib.request.Request(url, headers={"User-Agent": UA}, method=method)
    return urllib.request.urlopen(req, timeout=timeout)

def get_json(url: str):
    with request(url, timeout=60) as r:
        return json.load(r)

def download(url: str, dest: pathlib.Path, retries: int = 3) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    last = None
    for i in range(retries):
        try:
            with request(url, timeout=180) as r, dest.open("wb") as f:
                shutil.copyfileobj(r, f, 1024 * 1024)
            return
        except Exception as exc:
            last = exc
            try:
                dest.unlink()
            except FileNotFoundError:
                pass
            time.sleep(2 ** i)
    raise RuntimeError(f"download failed: {url}: {last}")

def catalog_url() -> str:
    cond = "r:" + ",".join(f"{x:.7f}" for x in BBOX)
    return f"{CATALOG_API}/{cond}"

def choose_city(payload: dict) -> dict:
    cities = payload.get("cities") or []
    choices = [x for x in cities if str(x.get("cityCode", "")).startswith(CITY_CODE)]
    if not choices:
        raise RuntimeError("Matsuyama dataset not returned by PLATEAU catalog API")
    return sorted(choices, key=lambda x: (int(x.get("year") or 0), int(x.get("registrationYear") or 0)), reverse=True)[0]

def number_list(text: str | None) -> list[float]:
    if not text:
        return []
    try:
        return [float(x) for x in text.split()]
    except ValueError:
        return []

def coordinate_points(elem: ET.Element) -> list[tuple[float, float, float | None]]:
    out = []
    for x in elem.iter():
        if local(x.tag) not in ("pos", "posList"):
            continue
        vals = number_list(x.text)
        if not vals:
            continue
        try:
            dim = int(x.attrib.get("srsDimension", ""))
        except ValueError:
            dim = 0
        if dim not in (2, 3):
            dim = 3 if len(vals) % 3 == 0 else 2
        for i in range(0, len(vals) - dim + 1, dim):
            a, b = vals[i], vals[i + 1]
            z = vals[i + 2] if dim == 3 else None
            if 20 <= a <= 50 and 120 <= b <= 155:
                lat, lon = a, b
            elif 120 <= a <= 155 and 20 <= b <= 50:
                lon, lat = a, b
            else:
                continue
            out.append((lon, lat, z))
    return out

def envelope(points: Iterable[tuple[float, float, float | None]]):
    pts = list(points)
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))

def intersects(a, b) -> bool:
    return bool(a) and not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])

def polygon_ids(elem: ET.Element) -> set[str]:
    return {
        x.attrib[GML_ID]
        for x in elem.iter()
        if local(x.tag) in ("Polygon", "Surface") and GML_ID in x.attrib
    }

def has_sloped_geometry(elem: ET.Element) -> bool:
    for x in elem.iter():
        if local(x.tag) not in ("pos", "posList"):
            continue
        zs = [p[2] for p in coordinate_points(x) if p[2] is not None and math.isfinite(p[2])]
        if len(zs) >= 3 and max(zs) - min(zs) > 0.15:
            return True
    return False

def target_uri(target: ET.Element) -> str | None:
    u = target.attrib.get("uri") or target.attrib.get(XLINK_HREF)
    if u:
        return u.lstrip("#")
    for x in target.iter():
        u = x.attrib.get("uri") or x.attrib.get(XLINK_HREF)
        if u:
            return u.lstrip("#")
    return None

def parse_gml(path: pathlib.Path, source_url: str, mesh: str):
    buildings: dict[str, dict] = {}
    textures: list[dict] = []
    for _, elem in ET.iterparse(path, events=("end",)):
        name = local(elem.tag)
        if name == "Building":
            bid = elem.attrib.get(GML_ID)
            if not bid:
                elem.clear()
                continue
            bb = envelope(coordinate_points(elem))
            if intersects(bb, BBOX):
                roofs = [x for x in elem.iter() if local(x.tag) == "RoofSurface"]
                walls = [x for x in elem.iter() if local(x.tag) == "WallSurface"]
                roof_ids = set().union(*(polygon_ids(x) for x in roofs)) if roofs else set()
                wall_ids = set().union(*(polygon_ids(x) for x in walls)) if walls else set()
                lod2 = any(local(x.tag).startswith("lod2") for x in elem.iter()) or bool(roofs or walls)
                buildings[bid] = {
                    "gml_id": bid,
                    "mesh": mesh,
                    "bbox": [round(x, 8) for x in bb] if bb else None,
                    "lod2": lod2,
                    "roof_surface_count": len(roofs),
                    "wall_surface_count": len(walls),
                    "sloped_roof": any(has_sloped_geometry(x) for x in roofs),
                    "_roof_polygon_ids": roof_ids,
                    "_wall_polygon_ids": wall_ids,
                }
            elem.clear()
        elif name in ("ParameterizedTexture", "GeoreferencedTexture"):
            image_uri = None
            for x in elem.iter():
                if local(x.tag) == "imageURI" and x.text and x.text.strip():
                    image_uri = x.text.strip()
                    break
            if image_uri:
                targets = []
                for x in elem.iter():
                    if local(x.tag) == "target":
                        u = target_uri(x)
                        if u:
                            targets.append(u)
                if targets:
                    textures.append({
                        "image_uri": image_uri,
                        "resolved_url": urllib.parse.urljoin(source_url, image_uri),
                        "targets": sorted(set(targets)),
                        "texture_type": name,
                        "mesh": mesh,
                    })
            elem.clear()
    return buildings, textures

def image_probe(path: pathlib.Path) -> dict:
    from PIL import Image
    with Image.open(path) as im:
        im.verify()
    with Image.open(path) as im:
        return {"format": im.format, "width": im.width, "height": im.height, "mode": im.mode}

def download_texture(item: tuple[str, str], snapshot_dir: pathlib.Path):
    key, url = item
    ext = pathlib.PurePosixPath(urllib.parse.urlparse(url).path).suffix.lower() or ".bin"
    path = snapshot_dir / "textures" / f"{key}{ext}"
    download(url, path)
    meta = image_probe(path)
    return key, {
        "url": url,
        "sha256": sha256_file(path),
        "bytes": path.stat().st_size,
        **meta,
        "snapshot_name": path.name,
    }

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="stage2-1-assets")
    ap.add_argument("--snapshot", action="store_true", help="keep downloaded source files/textures in output for CI artifact")
    ap.add_argument("--workers", type=int, default=12)
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    work = pathlib.Path(tempfile.mkdtemp(prefix="stage2-1-"))
    snapshot_dir = out / "snapshot" if args.snapshot else work / "snapshot"
    snapshot_dir.mkdir(parents=True, exist_ok=True)

    payload = get_json(catalog_url())
    city = choose_city(payload)
    bldg_files = [x for x in (city.get("files") or {}).get("bldg", []) if int(x.get("maxLod") or 0) >= 2]
    if len(bldg_files) != 4:
        raise RuntimeError(f"expected four LOD2 building mesh files, got {len(bldg_files)}")

    source_files = []
    buildings: dict[str, dict] = {}
    texture_records = []
    try:
        for item in bldg_files:
            mesh = str(item["code"])
            url = item["url"]
            gml_path = snapshot_dir / "citygml" / pathlib.PurePosixPath(urllib.parse.urlparse(url).path).name
            download(url, gml_path)
            parsed_buildings, parsed_textures = parse_gml(gml_path, url, mesh)
            overlap = set(buildings) & set(parsed_buildings)
            if overlap:
                raise RuntimeError(f"duplicate building IDs across mesh files: {sorted(overlap)[:5]}")
            buildings.update(parsed_buildings)
            texture_records.extend(parsed_textures)
            source_files.append({
                "mesh": mesh,
                "url": url,
                "sha256": sha256_file(gml_path),
                "bytes": gml_path.stat().st_size,
                "filename": gml_path.name,
                "bbox_buildings": len(parsed_buildings),
                "bbox_lod2": sum(1 for x in parsed_buildings.values() if x["lod2"]),
            })

        target_to_texture: dict[str, set[str]] = defaultdict(set)
        texture_url_by_key: dict[str, str] = {}
        for tr in texture_records:
            url = tr["resolved_url"]
            key = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
            texture_url_by_key[key] = url
            for target in tr["targets"]:
                target_to_texture[target].add(key)

        used_texture_keys: set[str] = set()
        lod2_count = 0
        fallback_count = 0
        missing_texture_buildings = []
        for b in buildings.values():
            roof_ids = b.pop("_roof_polygon_ids")
            wall_ids = b.pop("_wall_polygon_ids")
            roof_tex = sorted(set().union(*(target_to_texture.get(x, set()) for x in roof_ids))) if roof_ids else []
            wall_tex = sorted(set().union(*(target_to_texture.get(x, set()) for x in wall_ids))) if wall_ids else []
            b["roof_texture_keys"] = roof_tex
            b["wall_texture_keys"] = wall_tex
            b["texture_keys"] = sorted(set(roof_tex) | set(wall_tex))
            used_texture_keys.update(b["texture_keys"])
            if b["lod2"]:
                lod2_count += 1
                if not roof_tex or not wall_tex:
                    missing_texture_buildings.append({
                        "gml_id": b["gml_id"],
                        "mesh": b["mesh"],
                        "roof_texture_count": len(roof_tex),
                        "wall_texture_count": len(wall_tex),
                    })
            else:
                fallback_count += 1

        if len(buildings) != EXPECTED_TOTAL or lod2_count != EXPECTED_LOD2 or fallback_count != EXPECTED_FALLBACK:
            raise RuntimeError(
                f"source freeze gate changed: total={len(buildings)} lod2={lod2_count} fallback={fallback_count}; "
                f"expected {EXPECTED_TOTAL}/{EXPECTED_LOD2}/{EXPECTED_FALLBACK}"
            )
        if missing_texture_buildings:
            raise RuntimeError(f"{len(missing_texture_buildings)} LOD2 buildings lack roof/wall texture targets")

        texture_items = sorted((k, texture_url_by_key[k]) for k in used_texture_keys)
        texture_manifest: dict[str, dict] = {}
        failures = []
        with cf.ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
            futures = {ex.submit(download_texture, x, snapshot_dir): x for x in texture_items}
            for future in cf.as_completed(futures):
                key, url = futures[future]
                try:
                    k, meta = future.result()
                    texture_manifest[k] = meta
                except Exception as exc:
                    failures.append({"key": key, "url": url, "error": repr(exc)})

        if failures:
            (out / "texture-failures.json").write_text(json.dumps(failures, ensure_ascii=False, indent=2), encoding="utf-8")
            raise RuntimeError(f"{len(failures)} referenced texture images failed download/decode")

        for b in buildings.values():
            for key in b["texture_keys"]:
                if key not in texture_manifest:
                    raise RuntimeError(f"building {b['gml_id']} references missing texture key {key}")

        source_bytes = sum(x["bytes"] for x in source_files)
        texture_bytes = sum(x["bytes"] for x in texture_manifest.values())
        summary = {
            "lock_version": 1,
            "city_code": city.get("cityCode"),
            "city_name": city.get("cityName"),
            "year": city.get("year"),
            "registration_year": city.get("registrationYear"),
            "spec": city.get("spec"),
            "bbox": {"west": BBOX[0], "south": BBOX[1], "east": BBOX[2], "north": BBOX[3]},
            "catalog_url": catalog_url(),
            "dataset_zip_url": city.get("url"),
            "source_meshes": source_files,
            "counts": {
                "buildings": len(buildings),
                "lod2_buildings": lod2_count,
                "lod1_fallback_buildings": fallback_count,
                "sloped_roof_buildings": sum(1 for x in buildings.values() if x["lod2"] and x["sloped_roof"]),
                "unique_texture_images": len(texture_manifest),
                "source_gml_bytes": source_bytes,
                "texture_bytes": texture_bytes,
                "snapshot_bytes": source_bytes + texture_bytes,
                "invalid_or_missing_textures": 0,
            },
            "freeze_gate": {
                "expected_buildings": EXPECTED_TOTAL,
                "expected_lod2": EXPECTED_LOD2,
                "expected_fallback": EXPECTED_FALLBACK,
                "all_lod2_have_roof_and_wall_texture": True,
                "all_referenced_images_downloaded_and_decoded": True,
            },
        }

        lock = {
            **summary,
            "textures": {k: texture_manifest[k] for k in sorted(texture_manifest)},
        }
        index = {
            "version": 1,
            "id_property": "gml_id",
            "bbox": summary["bbox"],
            "buildings": [buildings[k] for k in sorted(buildings)],
        }
        (out / "stage2-1-source-lock.json").write_text(json.dumps(lock, ensure_ascii=False, indent=2), encoding="utf-8")
        (out / "stage2-1-building-index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
        (out / "stage2-1-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

        md = f"""# Stage 2.1 LOD2 source freeze

- Dataset: {city.get('cityName')} {city.get('year')} / PLATEAU spec {city.get('spec')}
- Target bbox: {BBOX}
- Source meshes: {', '.join(x['mesh'] for x in source_files)}
- Buildings: **{len(buildings)}**
- LOD2: **{lod2_count}**
- LOD1 fallback: **{fallback_count}**
- Real non-horizontal roofs: **{summary['counts']['sloped_roof_buildings']}**
- Unique referenced texture images used by target buildings: **{len(texture_manifest)}**
- CityGML bytes downloaded and hashed: **{source_bytes:,}**
- Texture bytes downloaded, decoded and hashed: **{texture_bytes:,}**
- Full source snapshot bytes: **{source_bytes + texture_bytes:,}**
- Missing/broken referenced textures: **0**

The repository lock files contain source URLs, SHA-256 values, image dimensions/formats, and the gml:id-level building-to-texture mapping. Raw CityGML and texture bytes are intentionally kept as CI artifacts instead of being committed automatically; Stage 2.2 must re-download and verify every byte against this lock before conversion.
"""
        (out / "stage2-1-summary.md").write_text(md, encoding="utf-8")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    finally:
        if not args.snapshot:
            shutil.rmtree(work, ignore_errors=True)

if __name__ == "__main__":
    main()
