#!/usr/bin/env python3
"""Build compact, visualization-only 3D inundation meshes from analysis GeoJSON.

The source hazard datasets contain depth *classes*, not continuous hydraulic water
surfaces. This output preserves those classes and stores representative/upper
class depths for 1:1 vertical rendering. Geometry is simplified only for the 3D
visual layer; the canonical analysis GeoJSON remains unchanged.
"""
from __future__ import annotations

import json
from pathlib import Path
from shapely.geometry import mapping
import geopandas as gpd

ROOT = Path(__file__).resolve().parents[1]
ANALYSIS = ROOT / "data" / "analysis"
OUT = ANALYSIS / "water3d"
SIMPLIFY_METERS = 5.0
ROUND_DECIMALS = 6
PROJECTED_CRS = 32653  # UTM 53N; Matsuyama lies within zone 53.

FLOOD_CLASSES = {
    1: {"label": "0m以上0.5m未満", "mid": 0.25, "upper": 0.5, "color": "#70d6e8"},
    2: {"label": "0.5m以上3.0m未満", "mid": 1.75, "upper": 3.0, "color": "#42b7dc"},
    3: {"label": "3.0m以上5.0m未満", "mid": 4.0, "upper": 5.0, "color": "#2589c5"},
    4: {"label": "5.0m以上10.0m未満", "mid": 7.5, "upper": 10.0, "color": "#1762a0"},
    5: {"label": "10.0m以上20.0m未満", "mid": 15.0, "upper": 20.0, "color": "#0b3b77"},
    6: {"label": "20.0m以上", "mid": 22.5, "upper": 25.0, "color": "#062653"},
}
TSUNAMI_CLASSES = {
    2: {"label": "0.01m以上～0.3m未満", "mid": 0.155, "upper": 0.3, "color": "#8fd8f5"},
    3: {"label": "0.3m以上～1m未満", "mid": 0.65, "upper": 1.0, "color": "#67c4ea"},
    4: {"label": "1m以上～2m未満", "mid": 1.5, "upper": 2.0, "color": "#45a8dc"},
    5: {"label": "2m以上～3m未満", "mid": 2.5, "upper": 3.0, "color": "#3189cc"},
    6: {"label": "3m以上～4m未満", "mid": 3.5, "upper": 4.0, "color": "#2569b3"},
    7: {"label": "4m以上～5m未満", "mid": 4.5, "upper": 5.0, "color": "#194d95"},
    8: {"label": "5m以上～10m未満", "mid": 7.5, "upper": 10.0, "color": "#103673"},
    9: {"label": "10m以上", "mid": 12.5, "upper": 15.0, "color": "#08214f"},
}


def round_coords(value):
    if isinstance(value, (list, tuple)):
        return [round_coords(v) for v in value]
    if isinstance(value, float):
        return round(value, ROUND_DECIMALS)
    return value


def compact_classes(classes):
    return {str(k): [v["label"], v["mid"], v["upper"], v["color"]] for k, v in classes.items()}


def build_one(name: str, source: Path, class_column: str, classes: dict[int, dict], warning: str | None = None):
    gdf = gpd.read_file(source)
    if gdf.crs is None:
        gdf = gdf.set_crs(4326)
    gdf = gdf.to_crs(PROJECTED_CRS)
    gdf["geometry"] = gdf.geometry.simplify(SIMPLIFY_METERS, preserve_topology=True)
    gdf = gdf.to_crs(4326)

    features = []
    output_vertices = 0
    for _, row in gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        try:
            cls = int(row[class_column])
        except Exception:
            continue
        if cls not in classes:
            continue
        geo = mapping(geom)
        if geo["type"] not in ("Polygon", "MultiPolygon"):
            continue
        type_code = 0 if geo["type"] == "Polygon" else 1
        coords = round_coords(geo["coordinates"])
        features.append([cls, type_code, coords])
        if type_code == 0:
            output_vertices += sum(len(r) for r in coords)
        else:
            output_vertices += sum(len(r) for p in coords for r in p)

    payload = {
        "version": 1,
        "scenario": name,
        "verticalScale": 1.0,
        "depthSemantics": "class-range",
        "defaultDepthMode": "mid",
        "simplifyMeters": SIMPLIFY_METERS,
        "coordinateDecimals": ROUND_DECIMALS,
        "classes": compact_classes(classes),
        "warning": warning,
        "featureCount": len(features),
        "features": features,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {"file": path.name, "features": len(features), "bytes": path.stat().st_size, "vertices": output_vertices}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    flood = build_one(
        "flood",
        ANALYSIS / "hazards" / "flood_max.geojson",
        "rank",
        FLOOD_CLASSES,
        "A31a 2025想定最大規模。3D水面は浸水深区分の代表値または上限値を1:1で表示する概算可視化で、連続的な水位面ではない。",
    )
    tsunami = build_one(
        "tsunami",
        ANALYSIS / "hazards" / "tsunami.geojson",
        "severity",
        TSUNAMI_CLASSES,
        "公開取得可能なA40旧ベクトルを使用。愛媛県2025-09-02変更の最新津波浸水想定ではない。3D水面は参考表示。",
    )
    manifest = {
        "complete": True,
        "version": 1,
        "simplifyMeters": SIMPLIFY_METERS,
        "coordinateDecimals": ROUND_DECIMALS,
        "verticalScale": 1.0,
        "flood": flood,
        "tsunami": tsunami,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
