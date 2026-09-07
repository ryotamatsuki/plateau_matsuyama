#!/usr/bin/env python3
"""Corrected Urban Risk Explorer analysis entrypoint.

A31a flood ZIPs contain separate feature categories.  This module explicitly
selects the maximum-scale feature (A31a_205) and combines both Ehime Prefecture
(region 38) and Shikoku Regional Development Bureau (region 88) sources before
Matsuyama clipping.  Nationally managed rivers are not contained in prefecture
38 archives, so both management scopes are required for a complete city view.
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
            "ehime_main",
            r"A31a-25_38_10_GEOJSON\.zip$",
            "https://nlftp.mlit.go.jp/ksj/gml/data/A31a/A31a-25/A31a-25_38_10_GEOJSON.zip",
            "洪水予報河川・水位周知河川",
            "愛媛県",
        ),
        (
            "ehime_other",
            r"A31a-25_38_20_GEOJSON\.zip$",
            "https://nlftp.mlit.go.jp/ksj/gml/data/A31a/A31a-25/A31a-25_38_20_GEOJSON.zip",
            "その他河川",
            "愛媛県",
        ),
        (
            "shikoku_main",
            r"A31a-25_88_10_GEOJSON\.zip$",
            "https://nlftp.mlit.go.jp/ksj/gml/data/A31a/A31a-25/A31a-25_88_10_GEOJSON.zip",
            "洪水予報河川・水位周知河川",
            "四国地方整備局",
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
            geometry=[],
            crs=4326,
        )
    flood = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), geometry="geometry", crs=parts[0].crs).to_crs(4326)
    flood["rank"] = pd.to_numeric(flood["rank"], errors="coerce").fillna(0).astype(int)
    flood["depth_class"] = flood["rank"].map(base.FLOOD_LABELS).fillna("不明")
    base.log(f"combined flood polygons inside Matsuyama: {len(flood)}")
    return flood[["rank", "depth_class", "river", "river_class", "authority", "geometry"]]


# Keep the original downstream schema stable: write_geojson receives a fixed property
# list in base.main(), while joins use rank/river only.  The additional authority field
# remains available internally for diagnostics without breaking browser consumers.
base.build_flood = build_flood

if __name__ == "__main__":
    raise SystemExit(base.main())
