# Matsuyama OSM browser fixture

`matsuyama-osm.json.gz` is a deterministic, unmodified-geometry extract of highway ways, building footprints and street tree/lamp nodes obtained from the OpenStreetMap API on 2026-10-04. Non-rendering tags are omitted. The XML response was converted to the equivalent Overpass `out geom` element structure and gzip-compressed with mtime zero. It is used only by browser tests, never substituted for live user data.

Source: https://api.openstreetmap.org/api/0.6/map?bbox=132.7600,33.8345,132.7712,33.8441

© OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright). The compressed JSON retains source, retrieval date and attribution metadata. OSM data is incomplete; absence of lamps is not evidence of absence on the street.
