#!/usr/bin/env python3
"""Corrected Urban Risk Explorer analysis entrypoint.

Key corrections over the first implementation:
1. A31a ZIPs contain separate feature categories, so select the maximum-scale
   flood feature explicitly by A31a_205.
2. Combine Ehime Prefecture (region 38) and Shikoku Regional Development Bureau
   (region 88), because nationally managed rivers are not in the prefecture ZIP.
3. B3DM batch tables carry feature attributes but not per-building lon/lat.
   Use the canonical PLATEAU 2020 CityGML geometry + gml:id for spatial joins,
   while retaining the B3DM batch-table ID property name for browser matching.
"""
from __future__ import annotations

import shutil
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd

import build_risk_analysis as base

CITYGML_STABLE = "https://api.plateauview.mlit.go.jp/datacatalog/citygml/38201-2020/citygml.zip"
CITYGML_FALLBACK = "https://assets.cms.plateau.reearth.io/assets/20/1943f5-9008-428c-b92e-7dbf16e6089f/38201_matsuyama-shi_2020_citygml_4_op.zip"


def read_vector_with_columns(path: Path, work: Path, required: set[str]) -> gpd.GeoDataFrame:
    folder = base.extract_zip(path, work)
    files: list[Path] = []
    for pat in ["*.geojson", "*.json", "*.shp", "*.gml", "*.xml"]:
        files.extend(sorted(folder.rglob(pat)))
    files = [p for p in files if "schema" not in p.name.lower() and not p.name.lower().endswith(".xsd")]
    errors: list[str] = []
    seen_columns: list[list[str]] = []
    for original in files:
        p = original
        try:
            if p.suffix.lower() == ".xml":
                alias = p.with_suffix(".gml")
                if not alias.exists():
                    shutil.copy2(p, alias)
                p = alias
            gdf = gpd.read_file(p)
            seen_columns.append(list(map(str, gdf.columns)))
            if gdf.empty or "geometry" not in gdf:
                continue
            if not required.issubset(set(map(str, gdf.columns))):
                continue
            if gdf.crs is None:
                gdf = gdf.set_crs(4326)
            base.log(
                f"selected {p.name}: rows={len(gdf)} crs={gdf.crs} "
                f"bounds={tuple(round(float(v), 5) for v in gdf.total_bounds)}"
            )
            return gdf.to_crs(4326)
        except Exception as exc:
            errors.append(f"{p.name}: {exc}")
    raise RuntimeError(
        f"required columns {sorted(required)} not found in {path.name}; "
        f"vectors={len(files)} sample_columns={seen_columns[:8]} errors={errors[:5]}"
    )


def build_flood(city: gpd.GeoDataFrame, work: Path) -> gpd.GeoDataFrame:
    parts: list[gpd.GeoDataFrame] = []
    specs = [
        (
            "ehime_main", r"A31a-25_38_10_GEOJSON\.zip$",
            "https://nlftp.mlit.go.jp/ksj/gml/data/A31a/A31a-25/A31a-25_38_10_GEOJSON.zip",
            "洪水予報河川・水位周知河川", "愛媛県",
        ),
        (
            "ehime_other", r"A31a-25_38_20_GEOJSON\.zip$",
            "https://nlftp.mlit.go.jp/ksj/gml/data/A31a/A31a-25/A31a-25_38_20_GEOJSON.zip",
            "その他河川", "愛媛県",
        ),
        (
            "shikoku_main", r"A31a-25_88_10_GEOJSON\.zip$",
            "https://nlftp.mlit.go.jp/ksj/gml/data/A31a/A31a-25/A31a-25_88_10_GEOJSON.zip",
            "洪水予報河川・水位周知河川", "四国地方整備局",
        ),
    ]
    try:
        links = base.page_links(base.PAGES["flood"])
    except Exception as exc:
        base.log(f"warning: flood page discovery failed: {exc}")
        links = []

    for key, pattern, fallback, river_class, authority in specs:
        hits = [u for u in links if base.re.search(pattern, base.urllib.parse.unquote(u), base.re.I)]
        url = hits[0] if hits else fallback
        archive = base.download(url, work / Path(base.urllib.parse.urlparse(url).path).name)
        gdf = read_vector_with_columns(archive, work, {"A31a_205"})
        raw_count = len(gdf)
        rank = pd.to_numeric(gdf["A31a_205"], errors="coerce")
        rank_values = sorted({int(v) for v in rank.dropna().unique() if float(v).is_integer()})
        gdf = gdf[rank.between(1, 6)].copy()
        if not gdf.empty:
            gdf["rank"] = pd.to_numeric(gdf["A31a_205"], errors="coerce").astype("Int64")
            gdf["river"] = gdf.get("A31a_202", pd.Series(index=gdf.index, dtype=object)).fillna("").astype(str)
            gdf["river_class"] = river_class
            gdf["authority"] = authority
            gdf = base.clip_city(gdf, city)
        base.log(
            f"flood source {key}: raw={raw_count} rank_values={rank_values[:20]} "
            f"inside_matsuyama={len(gdf)}"
        )
        if not gdf.empty:
            parts.append(gdf[["rank", "river", "river_class", "authority", "geometry"]])

    if not parts:
        return gpd.GeoDataFrame(
            {"rank": [], "depth_class": [], "river": [], "river_class": [], "authority": []},
            geometry=[], crs=4326,
        )
    flood = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), geometry="geometry", crs=parts[0].crs).to_crs(4326)
    flood["rank"] = pd.to_numeric(flood["rank"], errors="coerce").fillna(0).astype(int)
    flood["depth_class"] = flood["rank"].map(base.FLOOD_LABELS).fillna("不明")
    base.log(f"combined flood polygons inside Matsuyama: {len(flood)}")
    return flood[["rank", "depth_class", "river", "river_class", "authority", "geometry"]]


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def element_text(elem: ET.Element, names: set[str]) -> str | None:
    for node in elem.iter():
        if local_name(node.tag) in names and node.text and node.text.strip():
            return node.text.strip()
    return None


def coordinates_from_building(elem: ET.Element) -> list[tuple[float, float]]:
    coords: list[tuple[float, float]] = []
    for node in elem.iter():
        if local_name(node.tag) not in {"pos", "posList"} or not node.text:
            continue
        try:
            values = [float(v) for v in node.text.split()]
        except ValueError:
            continue
        try:
            dim = int(node.attrib.get("srsDimension", "0") or "0")
        except ValueError:
            dim = 0
        if dim not in (2, 3):
            dim = 3 if len(values) >= 3 and len(values) % 3 == 0 else 2
        for i in range(0, len(values) - dim + 1, dim):
            a, b = values[i], values[i + 1]
            # EPSG:6697/JGD2011 geographic 3D commonly serializes latitude,
            # longitude, height. Accept both axis orders defensively.
            if 20 <= a <= 50 and 120 <= b <= 150:
                lat, lon = a, b
            elif 120 <= a <= 150 and 20 <= b <= 50:
                lon, lat = a, b
            else:
                continue
            coords.append((lon, lat))
    return coords


def b3dm_id_property() -> tuple[str | None, dict[str, int], int]:
    files = sorted(base.BUILDINGS_DIR.rglob("*.b3dm"))
    counts: Counter[str] = Counter()
    for path in files:
        try:
            n, bt = base.parse_b3dm(path)
        except Exception:
            continue
        if n <= 0:
            continue
        counts.update({k: n for k, v in bt.items() if isinstance(v, list) and len(v) == n})
    prop = base.preferred_property(counts)
    base.log(f"B3DM ID property: {prop}; top properties={counts.most_common(12)}")
    return prop, dict(counts.most_common()), len(files)


def extract_buildings_citygml() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    id_prop, property_counts, tile_count = b3dm_id_property()
    with tempfile.TemporaryDirectory(prefix="matsuyama-citygml-") as td:
        tmp = Path(td)
        archive = tmp / "38201_matsuyama_2020_citygml.zip"
        try:
            base.download(CITYGML_STABLE, archive)
            source_url = CITYGML_STABLE
        except Exception as exc:
            base.log(f"warning: stable CityGML endpoint failed ({exc}); using CMS fallback")
            base.download(CITYGML_FALLBACK, archive)
            source_url = CITYGML_FALLBACK

        rows: list[dict[str, Any]] = []
        seen: set[str] = set()
        with zipfile.ZipFile(archive) as zf:
            names = [n for n in zf.namelist() if not n.endswith("/") and n.lower().endswith(".gml") and "/bldg/" in n.replace("\\", "/").lower()]
            if not names:
                names = [n for n in zf.namelist() if not n.endswith("/") and n.lower().endswith(".gml") and "bldg" in Path(n).name.lower()]
            if not names:
                raise RuntimeError("no building GML files in PLATEAU CityGML archive")
            base.log(f"PLATEAU CityGML building files: {len(names)}")
            for file_no, name in enumerate(sorted(names), 1):
                with zf.open(name) as fp:
                    for _, elem in ET.iterparse(fp, events=("end",)):
                        if local_name(elem.tag) != "Building":
                            continue
                        gid = elem.attrib.get("{http://www.opengis.net/gml}id") or elem.attrib.get("id")
                        xy = coordinates_from_building(elem)
                        if not gid or gid in seen or not xy:
                            elem.clear()
                            continue
                        xs = [p[0] for p in xy]; ys = [p[1] for p in xy]
                        xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
                        lon, lat = (xmin + xmax) / 2, (ymin + ymax) / 2
                        if not (132.0 <= lon <= 133.2 and 33.2 <= lat <= 34.3):
                            elem.clear()
                            continue
                        measured = base.num(element_text(elem, {"measuredHeight"}))
                        floors = element_text(elem, {"storeysAboveGround"})
                        usage = element_text(elem, {"usage"})
                        name_text = element_text(elem, {"name"})
                        rows.append({
                            "key": gid, "source_id": gid,
                            "x": lon, "y": lat,
                            "xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax,
                            "height": measured,
                            "floors": floors, "usage": usage, "name": name_text,
                        })
                        seen.add(gid)
                        if len(rows) % 25000 == 0:
                            base.log(f"CityGML buildings parsed: {len(rows)}")
                        elem.clear()
                if file_no % 25 == 0 or file_no == len(names):
                    base.log(f"CityGML files parsed {file_no}/{len(names)}; buildings={len(rows)}")

    return rows, {
        "tileCount": tile_count,
        "buildingCount": len(rows),
        "idProperty": id_prop,
        "propertyCounts": property_counts,
        "geometrySource": "PLATEAU CityGML 38201-2020",
        "geometrySourceUrl": source_url,
        "joinMethod": "gml:id + CityGML building XY envelope",
    }


base.build_flood = build_flood
base.extract_buildings = extract_buildings_citygml

if __name__ == "__main__":
    raise SystemExit(base.main())
