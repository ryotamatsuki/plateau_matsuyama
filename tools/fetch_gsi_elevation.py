#!/usr/bin/env python3
"""Fetch and cache GSI DEM10B tiles for the PLATEAU Matsuyama 2020 extent.

The importer is resumable. Existing valid PNG files and the cached GSIGEO2011
interpolation grid are reused. New network requests are throttled. The geoid
subset is obtained from GSI's official GSIGEO2011 Ver.2.2 REST API instead of
the legacy-renegotiation ZIP host, which is incompatible with current GitHub
Actions OpenSSL defaults.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BBOX = {
    "west": 132.63722640711262,
    "south": 33.73550184858689,
    "east": 132.8751398557756,
    "north": 34.00948691854943,
}
# Extent of the z14 XYZ tiles that cover BBOX, computed from the PLATEAU bounds.
# A geoid grid over this slightly larger extent avoids an interpolation edge at
# the local terrain-cache boundary.
GEOID_BBOX = {
    "west": 132.626953125,
    "south": 33.7243396617476,
    "east": 132.890625,
    "north": 34.016241889667015,
}
GEOID_GRID_ROWS = 7
GEOID_GRID_COLS = 7
MIN_ZOOM = 1
MAX_ZOOM = 14
GSI_DEM_URL = "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png"
GSIGEO2011_API_URL = "https://vldb.gsi.go.jp/sokuchi/surveycalc/geoid/calcgh2011/cgi/geoidcalc.pl"
MIN_INTERVAL_SECONDS = 1.25
USER_AGENT = "plateau_matsuyama/1.0 (+https://github.com/ryotamatsuki/plateau_matsuyama)"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def lonlat_to_tile(lon: float, lat: float, zoom: int) -> tuple[float, float]:
    n = 2**zoom
    x = (lon + 180.0) / 360.0 * n
    lat_rad = math.radians(max(-85.05112878, min(85.05112878, lat)))
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
    return x, y


def tile_range(zoom: int) -> tuple[int, int, int, int]:
    xw, ys = lonlat_to_tile(BBOX["west"], BBOX["south"], zoom)
    xe, yn = lonlat_to_tile(BBOX["east"], BBOX["north"], zoom)
    return (
        math.floor(min(xw, xe)),
        math.floor(max(xw, xe)),
        math.floor(min(ys, yn)),
        math.floor(max(ys, yn)),
    )


def is_valid_png(path: Path) -> bool:
    try:
        if path.stat().st_size < 64:
            return False
        with path.open("rb") as f:
            return f.read(8) == PNG_SIGNATURE
    except OSError:
        return False


class ThrottledDownloader:
    def __init__(self, min_interval: float = MIN_INTERVAL_SECONDS) -> None:
        self.min_interval = min_interval
        self.last_request = 0.0

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self.last_request
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)

    def get(self, url: str, *, retries: int = 5) -> bytes | None:
        for attempt in range(retries):
            self._throttle()
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            try:
                with urllib.request.urlopen(req, timeout=45) as response:
                    self.last_request = time.monotonic()
                    return response.read()
            except urllib.error.HTTPError as exc:
                self.last_request = time.monotonic()
                if exc.code == 404:
                    return None
                if exc.code not in (408, 429, 500, 502, 503, 504) or attempt == retries - 1:
                    raise
            except urllib.error.URLError:
                self.last_request = time.monotonic()
                if attempt == retries - 1:
                    raise
            time.sleep(min(30.0, 2.0 ** (attempt + 1)))
        raise RuntimeError(f"failed to download {url}")


def fetch_geoid_subset(root: Path, downloader: ThrottledDownloader) -> dict:
    output = root / "geoid2011.json"
    if output.exists():
        try:
            existing = json.loads(output.read_text(encoding="utf-8"))
            if (
                existing.get("model") == "GSIGEO2011 Ver.2.2"
                and existing.get("sourceMethod") == "GSI REST API sampled grid"
                and existing.get("data")
            ):
                return {"reused": True, "rows": existing["rows"], "cols": existing["cols"]}
        except (OSError, ValueError, KeyError):
            pass

    rows, cols = GEOID_GRID_ROWS, GEOID_GRID_COLS
    dlat = (GEOID_BBOX["north"] - GEOID_BBOX["south"]) / (rows - 1)
    dlon = (GEOID_BBOX["east"] - GEOID_BBOX["west"]) / (cols - 1)
    data: list[list[float]] = []

    for row in range(rows):
        lat = GEOID_BBOX["south"] + row * dlat
        values: list[float] = []
        for col in range(cols):
            lon = GEOID_BBOX["west"] + col * dlon
            query = urllib.parse.urlencode(
                {"outputType": "json", "latitude": f"{lat:.8f}", "longitude": f"{lon:.8f}"}
            )
            url = f"{GSIGEO2011_API_URL}?{query}"
            value: float | None = None
            for attempt in range(5):
                payload = downloader.get(url)
                if payload is None:
                    raise RuntimeError(f"GSIGEO2011 API returned 404 at {lat},{lon}")
                try:
                    body = json.loads(payload.decode("utf-8"))
                    raw = body["OutputData"]["geoidHeight"]
                    value = float(raw)
                    if math.isfinite(value):
                        break
                except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                    value = None
                time.sleep(min(10.0, 2.0 ** attempt))
            if value is None or not math.isfinite(value):
                raise RuntimeError(f"invalid GSIGEO2011 API response at {lat},{lon}")
            values.append(value)
            print(f"geoid row={row + 1}/{rows} col={col + 1}/{cols} N={value:.4f}", flush=True)
        data.append(values)

    result = {
        "model": "GSIGEO2011 Ver.2.2",
        "sourceMethod": "GSI REST API sampled grid",
        "heightReference": "geoid height N used as h_ellipsoid = H_orthometric + N",
        "originLat": GEOID_BBOX["south"],
        "originLon": GEOID_BBOX["west"],
        "dLat": dlat,
        "dLon": dlon,
        "rows": rows,
        "cols": cols,
        "data": data,
        "source": GSIGEO2011_API_URL,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {"reused": False, "rows": rows, "cols": cols}


def fetch_dem_tiles(root: Path, downloader: ThrottledDownloader, max_new: int | None) -> dict:
    expected = reused = downloaded = missing = errors = 0
    ranges: dict[str, dict[str, int]] = {}
    missing_tiles: list[dict[str, int]] = []
    failed_tiles: list[dict[str, object]] = []

    for zoom in range(MIN_ZOOM, MAX_ZOOM + 1):
        xmin, xmax, ymin, ymax = tile_range(zoom)
        ranges[str(zoom)] = {"xmin": xmin, "xmax": xmax, "ymin": ymin, "ymax": ymax}
        for x in range(xmin, xmax + 1):
            for y in range(ymin, ymax + 1):
                expected += 1
                dest = root / "dem_png" / str(zoom) / str(x) / f"{y}.png"
                if is_valid_png(dest):
                    reused += 1
                    continue
                if max_new is not None and downloaded >= max_new:
                    continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                url = GSI_DEM_URL.format(z=zoom, x=x, y=y)
                try:
                    payload = downloader.get(url)
                except Exception as exc:
                    errors += 1
                    failed_tiles.append({"z": zoom, "x": x, "y": y, "error": str(exc)[:240]})
                    print(f"transient failure z={zoom} x={x} y={y}: {exc}", flush=True)
                    continue
                if payload is None:
                    missing += 1
                    missing_tiles.append({"z": zoom, "x": x, "y": y})
                    continue
                if not payload.startswith(PNG_SIGNATURE):
                    errors += 1
                    failed_tiles.append({"z": zoom, "x": x, "y": y, "error": "non-PNG response"})
                    continue
                tmp = dest.with_suffix(".png.part")
                tmp.write_bytes(payload)
                os.replace(tmp, dest)
                downloaded += 1
                print(f"downloaded z={zoom} x={x} y={y} ({downloaded} new)", flush=True)

    return {
        "expected": expected,
        "reused": reused,
        "downloaded": downloaded,
        "missing": missing,
        "errors": errors,
        "ranges": ranges,
        "missingTiles": missing_tiles,
        "failedTiles": failed_tiles,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/elevation", help="output directory")
    parser.add_argument("--max-new", type=int, default=None, help="download at most N new DEM tiles")
    args = parser.parse_args()

    root = Path(args.output)
    root.mkdir(parents=True, exist_ok=True)
    downloader = ThrottledDownloader()

    # Cache the geoid grid first. Once written it is reused, and subsequent DEM
    # checkpoint batches do not make any more geoid API calls.
    geoid = fetch_geoid_subset(root, downloader)
    dem = fetch_dem_tiles(root, downloader, args.max_new)

    processed = dem["reused"] + dem["downloaded"] + dem["missing"]
    complete = processed == dem["expected"] and dem["errors"] == 0
    manifest = {
        "dataset": "GSI elevation tile DEM10B PNG",
        "source": GSI_DEM_URL,
        "bbox": BBOX,
        "minZoom": MIN_ZOOM,
        "maxZoom": MAX_ZOOM,
        "heightReference": "GSI DEM10B orthometric elevation; browser adds GSIGEO2011 geoid height for Cesium ellipsoidal coordinates",
        "requestIntervalSeconds": MIN_INTERVAL_SECONDS,
        "expectedTiles": dem["expected"],
        "availableTiles": dem["reused"] + dem["downloaded"],
        "newTiles": dem["downloaded"],
        "reusedTiles": dem["reused"],
        "missingTileCount": dem["missing"],
        "missingTiles": dem["missingTiles"],
        "transientErrorCount": dem["errors"],
        "failedTiles": dem["failedTiles"],
        "ranges": dem["ranges"],
        "geoid": geoid,
        "complete": complete,
    }
    (root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2), flush=True)
    if not complete:
        print("DEM cache is partial; rerun to fetch remaining tiles.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
