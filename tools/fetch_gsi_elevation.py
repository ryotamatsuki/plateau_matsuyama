#!/usr/bin/env python3
"""Fetch and cache GSI DEM tiles for the PLATEAU Matsuyama 2020 extent.

The script is intentionally resumable: existing valid PNG files are reused, so a
stopped GitHub Actions run only downloads missing tiles on the next execution.
It also extracts a small GSIGEO2011 v2.2 grid subset used by the browser to
convert GSI orthometric elevations to ellipsoidal heights for Cesium/3D Tiles.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

BBOX = {
    "west": 132.63722640711262,
    "south": 33.73550184858689,
    "east": 132.8751398557756,
    "north": 34.00948691854943,
}
MIN_ZOOM = 1
MAX_ZOOM = 14
GSI_DEM_URL = "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png"
GSIGEO2011_ZIP_URL = "https://www.gsi.go.jp/common/000275009.zip"
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


def fetch_dem_tiles(root: Path, downloader: ThrottledDownloader, max_new: int | None) -> dict:
    expected = reused = downloaded = missing = 0
    ranges: dict[str, dict[str, int]] = {}
    missing_tiles: list[dict[str, int]] = []

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
                payload = downloader.get(url)
                if payload is None:
                    missing += 1
                    missing_tiles.append({"z": zoom, "x": x, "y": y})
                    continue
                if not payload.startswith(PNG_SIGNATURE):
                    raise RuntimeError(f"non-PNG response for {url}")
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
        "ranges": ranges,
        "missingTiles": missing_tiles,
    }


def fetch_geoid_subset(root: Path, downloader: ThrottledDownloader) -> dict:
    output = root / "geoid2011.json"
    if output.exists():
        try:
            existing = json.loads(output.read_text(encoding="utf-8"))
            if existing.get("model") == "GSIGEO2011 Ver.2.2" and existing.get("data"):
                return {"reused": True, "rows": existing["rows"], "cols": existing["cols"]}
        except (OSError, ValueError, KeyError):
            pass

    payload = downloader.get(GSIGEO2011_ZIP_URL)
    if payload is None:
        raise RuntimeError("GSIGEO2011 archive returned 404")

    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".asc")]
        if not names:
            raise RuntimeError("GSIGEO2011 archive does not contain an .asc file")
        asc_name = names[0]
        with zf.open(asc_name) as raw:
            text = io.TextIOWrapper(raw, encoding="cp932", errors="strict")
            header = text.readline().strip().split()
            if len(header) < 6:
                raise RuntimeError("unexpected GSIGEO2011 header")
            lat0, lon0, dlat, dlon = map(float, header[:4])
            nrows, ncols = int(header[4]), int(header[5])

            # One extra source-grid row/column on each side guarantees bilinear
            # interpolation remains valid throughout the PLATEAU extent.
            row_min = max(0, math.floor((BBOX["south"] - lat0) / dlat) - 1)
            row_max = min(nrows - 1, math.ceil((BBOX["north"] - lat0) / dlat) + 1)
            col_min = max(0, math.floor((BBOX["west"] - lon0) / dlon) - 1)
            col_max = min(ncols - 1, math.ceil((BBOX["east"] - lon0) / dlon) + 1)
            wanted_rows = row_max - row_min + 1
            wanted_cols = col_max - col_min + 1
            subset = [[999.0] * wanted_cols for _ in range(wanted_rows)]

            flat_index = 0
            for line in text:
                for token in line.split():
                    row = flat_index // ncols
                    col = flat_index - row * ncols
                    if row > row_max:
                        break
                    if row_min <= row <= row_max and col_min <= col <= col_max:
                        subset[row - row_min][col - col_min] = float(token)
                    flat_index += 1
                else:
                    continue
                break

    if any(v == 999.0 for row in subset for v in row):
        # Matsuyama land should have a complete geoid grid. Failing loudly is
        # safer than silently falling back to a constant vertical correction.
        raise RuntimeError("GSIGEO2011 subset contains no-data values")

    result = {
        "model": "GSIGEO2011 Ver.2.2",
        "heightReference": "geoid height N used as h_ellipsoid = H_orthometric + N",
        "originLat": lat0 + row_min * dlat,
        "originLon": lon0 + col_min * dlon,
        "dLat": dlat,
        "dLon": dlon,
        "rows": wanted_rows,
        "cols": wanted_cols,
        "nodata": 999.0,
        "data": subset,
        "source": GSIGEO2011_ZIP_URL,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {"reused": False, "rows": wanted_rows, "cols": wanted_cols}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/elevation", help="output directory")
    parser.add_argument("--max-new", type=int, default=None, help="download at most N new DEM tiles")
    args = parser.parse_args()

    root = Path(args.output)
    root.mkdir(parents=True, exist_ok=True)
    downloader = ThrottledDownloader()
    dem = fetch_dem_tiles(root, downloader, args.max_new)
    geoid = fetch_geoid_subset(root, downloader)

    complete = dem["reused"] + dem["downloaded"] + dem["missing"] == dem["expected"]
    manifest = {
        "dataset": "GSI elevation tile DEM10B PNG",
        "source": GSI_DEM_URL,
        "bbox": BBOX,
        "minZoom": MIN_ZOOM,
        "maxZoom": MAX_ZOOM,
        "heightReference": "GSI orthometric elevation; browser adds GSIGEO2011 geoid height for Cesium ellipsoidal coordinates",
        "requestIntervalSeconds": MIN_INTERVAL_SECONDS,
        "expectedTiles": dem["expected"],
        "availableTiles": dem["reused"] + dem["downloaded"],
        "newTiles": dem["downloaded"],
        "reusedTiles": dem["reused"],
        "missingTileCount": dem["missing"],
        "missingTiles": dem["missingTiles"],
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
