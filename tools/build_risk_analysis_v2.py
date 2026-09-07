#!/usr/bin/env python3
"""Compatibility entrypoint for the Urban Risk Explorer analysis build.

National Land Numerical Information A31a archives contain multiple GeoJSON
categories. Select the maximum-scale flood file explicitly by its A31a_205
attribute instead of accepting the first vector file in the ZIP.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import geopandas as gpd
import pandas as pd

import build_risk_analysis as base


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
            return gdf.to_crs(4326)
        except Exception as exc:
            errors.append(f"{p.name}: {exc}")
    raise RuntimeError(
        f"required columns {sorted(required)} not found in {path.name}; "
        f"vectors={len(files)} sample_columns={seen_columns[:8]} errors={errors[:5]}"
    )


def build_flood(city: gpd.GeoDataFrame, work: Path) -> gpd.GeoDataFrame:
    parts = []
    specs = [
        ("flood_main", r"A31a-25_38_10_GEOJSON\.zip$"),
        ("flood_other", r"A31a-25_38_20_GEOJSON\.zip$"),
    ]
    try:
        links = base.page_links(base.PAGES["flood"])
    except Exception as exc:
        base.log(f"warning: flood page discovery failed: {exc}")
        links = []
    for key, pattern in specs:
        hits = [u for u in links if base.re.search(pattern, base.urllib.parse.unquote(u), base.re.I)]
        url = hits[0] if hits else base.FALLBACK_URLS[key][0]
        archive = base.download(url, work / Path(base.urllib.parse.urlparse(url).path).name)
        gdf = read_vector_with_columns(archive, work, {"A31a_205"})
        rank = pd.to_numeric(gdf["A31a_205"], errors="coerce")
        gdf = gdf[rank.between(1, 6)].copy()
        gdf["rank"] = pd.to_numeric(gdf["A31a_205"], errors="coerce").astype("Int64")
        gdf["river"] = gdf.get("A31a_202", pd.Series(index=gdf.index, dtype=object)).fillna("").astype(str)
        gdf["river_class"] = "洪水予報河川・水位周知河川" if key == "flood_main" else "その他河川"
        parts.append(gdf[["rank", "river", "river_class", "geometry"]])
    flood = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), geometry="geometry", crs=parts[0].crs).to_crs(4326)
    flood = base.clip_city(flood, city)
    flood["rank"] = pd.to_numeric(flood["rank"], errors="coerce").fillna(0).astype(int)
    flood["depth_class"] = flood["rank"].map(base.FLOOD_LABELS).fillna("不明")
    return flood[["rank", "depth_class", "river", "river_class", "geometry"]]


base.build_flood = build_flood

if __name__ == "__main__":
    raise SystemExit(base.main())
