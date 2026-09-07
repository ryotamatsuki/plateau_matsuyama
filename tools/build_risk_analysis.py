#!/usr/bin/env python3
"""Build browser-side risk analysis assets for Matsuyama Urban Risk Explorer.

Sources:
- MLIT National Land Numerical Information N03 2026 administrative area
- A31a 2025 flood inundation assumption (maximum scale)
- A33 2025 sediment disaster warning/special warning zones
- A40 Ehime publicly downloadable tsunami GIS (latest publicly downloadable national vector;
  currently older than Ehime Prefecture's 2025-09-02 revised official assumption)
- PLATEAU Matsuyama 2020 B3DM batch-table building metadata
- locally cached GSI DEM10B for approximate ground elevation

The script deliberately records provenance and staleness instead of silently mixing vintages.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import struct
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import geopandas as gpd
import numpy as np
import pandas as pd
from PIL import Image
from shapely.geometry import Point, box, mapping
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
BUILDINGS_DIR = ROOT / "data" / "buildings"
ELEVATION_DIR = ROOT / "data" / "elevation"
OUT_DIR = ROOT / "data" / "analysis"
PIPELINE_VERSION = 3
USER_AGENT = "Matsuyama-Urban-Risk-Explorer/1.0 (+https://github.com/ryotamatsuki/plateau_matsuyama)"

PAGES = {
    "boundary": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html",
    "flood": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A31a-2025.html",
    "landslide": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A33-2025.html",
    "tsunami": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A40-2024.html",
}

FALLBACK_URLS = {
    "boundary": ["https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2026/N03-20260101_38_GML.zip"],
    "flood_main": ["https://nlftp.mlit.go.jp/ksj/gml/data/A31a/A31a-25/A31a-25_38_10_GEOJSON.zip"],
    "flood_other": ["https://nlftp.mlit.go.jp/ksj/gml/data/A31a/A31a-25/A31a-25_38_20_GEOJSON.zip"],
    "landslide": ["https://nlftp.mlit.go.jp/ksj/gml/data/A33/A33-25/A33-25_38_GEOJSON.zip"],
    "tsunami": [
        "https://nlftp.mlit.go.jp/ksj/gml/data/A40/A40-16/A40-16_38_SHP.zip",
        "https://nlftp.mlit.go.jp/ksj/gml/data/A40/A40-16/A40-16_38_GML.zip",
    ],
}

FLOOD_LABELS = {1:"0m以上0.5m未満",2:"0.5m以上3.0m未満",3:"3.0m以上5.0m未満",4:"5.0m以上10.0m未満",5:"10.0m以上20.0m未満",6:"20.0m以上"}
LANDSLIDE_PHENOMENA = {1:"急傾斜地の崩壊",2:"土石流",3:"地すべり"}
LANDSLIDE_ZONES = {1:("警戒区域","指定済",1),2:("特別警戒区域","指定済",2),3:("警戒区域","指定前",0),4:("特別警戒区域","指定前",0)}

def log(msg:str)->None: print(msg,flush=True)

def http_get(url:str,timeout:int=90)->bytes:
    req=urllib.request.Request(url,headers={"User-Agent":USER_AGENT}); last=None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req,timeout=timeout) as r:return r.read()
        except Exception as exc:
            last=exc
            if attempt==3: raise
            time.sleep(2**attempt)
    raise RuntimeError(str(last))

def download(url:str,dest:Path)->Path:
    if dest.exists() and dest.stat().st_size>1024:return dest
    log(f"download: {url}"); body=http_get(url); dest.parent.mkdir(parents=True,exist_ok=True); dest.write_bytes(body); return dest

def page_links(page_url:str)->list[str]:
    html=http_get(page_url).decode("utf-8",errors="ignore")
    hrefs=re.findall(r'href=["\']([^"\']+)["\']',html,flags=re.I)
    return [urllib.parse.urljoin(page_url,h.replace("&amp;","&")) for h in hrefs]

def find_download(page_url:str,patterns:Iterable[str],fallbacks:Iterable[str])->str:
    try:
        links=page_links(page_url)
        for pat in patterns:
            hits=[u for u in links if re.search(pat,urllib.parse.unquote(u),re.I)]
            if hits:
                hits.sort(key=lambda u:(0 if "GEOJSON" in u.upper() else 1 if "SHP" in u.upper() else 2,len(u)))
                return hits[0]
    except Exception as exc: log(f"warning: download discovery failed for {page_url}: {exc}")
    for url in fallbacks:return url
    raise RuntimeError(f"no download candidate for {page_url}")

def extract_zip(path:Path,work:Path)->Path:
    out=work/path.stem
    if out.exists():shutil.rmtree(out)
    out.mkdir(parents=True)
    with zipfile.ZipFile(path) as zf:zf.extractall(out)
    return out

def read_vector_archive(path:Path,work:Path)->gpd.GeoDataFrame:
    folder=extract_zip(path,work); files=[]
    for pat in ["*.geojson","*.json","*.shp","*.gml","*.xml"]:files.extend(sorted(folder.rglob(pat)))
    files=[p for p in files if "schema" not in p.name.lower() and not p.name.lower().endswith(".xsd")]; errors=[]
    for p in files:
        try:
            if p.suffix.lower()==".xml":
                alias=p.with_suffix(".gml")
                if not alias.exists():shutil.copy2(p,alias)
                p=alias
            gdf=gpd.read_file(p)
            if not gdf.empty and "geometry" in gdf:
                if gdf.crs is None:gdf=gdf.set_crs(4326)
                return gdf.to_crs(4326)
        except Exception as exc:errors.append(f"{p.name}: {exc}")
    raise RuntimeError(f"cannot read vector archive {path.name}; tried {len(files)} files: {' | '.join(errors[:5])}")

def normalize_geom(gdf:gpd.GeoDataFrame)->gpd.GeoDataFrame:
    gdf=gdf[gdf.geometry.notna()&~gdf.geometry.is_empty].copy()
    try:gdf.geometry=gdf.geometry.make_valid()
    except Exception:gdf.geometry=gdf.geometry.buffer(0)
    return gdf[gdf.geometry.notna()&~gdf.geometry.is_empty]

def city_boundary(work:Path)->gpd.GeoDataFrame:
    url=find_download(PAGES["boundary"],[r"N03-20260101_38_(?:GEOJSON|SHP|GML)\.zip$"],FALLBACK_URLS["boundary"])
    gdf=normalize_geom(read_vector_archive(download(url,work/Path(urllib.parse.urlparse(url).path).name),work))
    name_col="N03_004" if "N03_004" in gdf.columns else next((c for c in gdf.columns if "市区町村" in str(c)),None)
    if name_col is None:raise RuntimeError(f"N03 municipality column not found: {list(gdf.columns)}")
    city=gdf[gdf[name_col].astype(str).str.strip()=="松山市"].copy()
    if city.empty:city=gdf[gdf[name_col].astype(str).str.contains("松山市",na=False)].copy()
    if city.empty:raise RuntimeError("松山市 boundary not found in N03")
    return city[["geometry"]].dissolve().reset_index(drop=True).set_crs(4326)

def clip_city(gdf:gpd.GeoDataFrame,city:gpd.GeoDataFrame)->gpd.GeoDataFrame:
    gdf=normalize_geom(gdf.to_crs(4326)); minx,miny,maxx,maxy=city.total_bounds; gdf=gdf.cx[minx:maxx,miny:maxy]
    if gdf.empty:return gdf
    try:out=gpd.clip(gdf,city,keep_geom_type=False)
    except Exception:
        city_geom=city.geometry.iloc[0]; out=gdf[gdf.intersects(city_geom)].copy(); out.geometry=out.geometry.intersection(city_geom)
    return normalize_geom(out)

def build_flood(city:gpd.GeoDataFrame,work:Path)->gpd.GeoDataFrame:
    parts=[]; specs=[("flood_main",r"A31a-25_38_10_GEOJSON\.zip$"),("flood_other",r"A31a-25_38_20_GEOJSON\.zip$")]
    try:links=page_links(PAGES["flood"])
    except Exception as exc:log(f"warning: flood page discovery failed: {exc}");links=[]
    for key,pattern in specs:
        hits=[u for u in links if re.search(pattern,urllib.parse.unquote(u),re.I)];url=hits[0] if hits else FALLBACK_URLS[key][0]
        gdf=read_vector_archive(download(url,work/Path(urllib.parse.urlparse(url).path).name),work)
        if "A31a_205" not in gdf.columns:raise RuntimeError(f"A31a_205 missing: {list(gdf.columns)}")
        rank=pd.to_numeric(gdf["A31a_205"],errors="coerce");gdf=gdf[rank.between(1,6)].copy();gdf["rank"]=pd.to_numeric(gdf["A31a_205"],errors="coerce").astype("Int64")
        gdf["river"]=gdf.get("A31a_202",pd.Series(index=gdf.index,dtype=object)).fillna("").astype(str);gdf["river_class"]="洪水予報河川・水位周知河川" if key=="flood_main" else "その他河川"
        parts.append(gdf[["rank","river","river_class","geometry"]])
    flood=gpd.GeoDataFrame(pd.concat(parts,ignore_index=True),geometry="geometry",crs=parts[0].crs).to_crs(4326);flood=clip_city(flood,city);flood["rank"]=pd.to_numeric(flood["rank"],errors="coerce").fillna(0).astype(int);flood["depth_class"]=flood["rank"].map(FLOOD_LABELS).fillna("不明")
    return flood[["rank","depth_class","river","river_class","geometry"]]

def build_landslide(city:gpd.GeoDataFrame,work:Path)->gpd.GeoDataFrame:
    url=find_download(PAGES["landslide"],[r"A33-25_38_GEOJSON\.zip$"],FALLBACK_URLS["landslide"]);gdf=read_vector_archive(download(url,work/Path(urllib.parse.urlparse(url).path).name),work)
    for col in ("A33_001","A33_002"):
        if col not in gdf.columns:raise RuntimeError(f"{col} missing in A33: {list(gdf.columns)}")
    gdf["phenomenon_code"]=pd.to_numeric(gdf["A33_001"],errors="coerce").fillna(0).astype(int);gdf["zone_code"]=pd.to_numeric(gdf["A33_002"],errors="coerce").fillna(0).astype(int);gdf["phenomenon"]=gdf["phenomenon_code"].map(LANDSLIDE_PHENOMENA).fillna("不明");gdf["zone_type"]=gdf["zone_code"].map(lambda v:LANDSLIDE_ZONES.get(v,("不明","不明",0))[0]);gdf["designation"]=gdf["zone_code"].map(lambda v:LANDSLIDE_ZONES.get(v,("不明","不明",0))[1]);gdf["risk_level"]=gdf["zone_code"].map(lambda v:LANDSLIDE_ZONES.get(v,("不明","不明",0))[2]).astype(int)
    gdf["zone_no"]=gdf.get("A33_004",pd.Series(index=gdf.index,dtype=object)).fillna("").astype(str);gdf["name"]=gdf.get("A33_005",pd.Series(index=gdf.index,dtype=object)).fillna("").astype(str);gdf["notice_date"]=gdf.get("A33_007",pd.Series(index=gdf.index,dtype=object)).fillna("").astype(str);gdf=clip_city(gdf,city)
    return gdf[["phenomenon_code","phenomenon","zone_code","zone_type","designation","risk_level","zone_no","name","notice_date","geometry"]]

def tsunami_severity(value:Any)->int:
    s=str(value);nums=[float(x) for x in re.findall(r"\d+(?:\.\d+)?",s)]
    if not nums:return 1 if s.strip() else 0
    m=max(nums)
    if m>=20:return 9
    if m>=10:return 8
    if m>=5:return 7
    if m>=4:return 6
    if m>=3:return 5
    if m>=2:return 4
    if m>=1:return 3
    if m>=.3:return 2
    return 1

def build_tsunami(city:gpd.GeoDataFrame,work:Path)->tuple[gpd.GeoDataFrame,str]:
    url=find_download(PAGES["tsunami"],[r"A40-16_38_SHP\.zip$",r"A40-16_38_GML\.zip$"],FALLBACK_URLS["tsunami"])
    try:arc=download(url,work/Path(urllib.parse.urlparse(url).path).name)
    except Exception:url=FALLBACK_URLS["tsunami"][-1];arc=download(url,work/Path(urllib.parse.urlparse(url).path).name)
    gdf=read_vector_archive(arc,work);depth_col="A40_003" if "A40_003" in gdf.columns else next((c for c in gdf.columns if "003" in str(c)),None)
    if depth_col is None:raise RuntimeError(f"A40 depth class missing: {list(gdf.columns)}")
    gdf["depth_class"]=gdf[depth_col].fillna("").astype(str);gdf["severity"]=gdf["depth_class"].map(tsunami_severity).astype(int);gdf=clip_city(gdf,city)
    return gdf[["depth_class","severity","geometry"]],url

def json_safe(v:Any)->Any:
    if v is None:return None
    if isinstance(v,(str,int,bool)):return v
    if isinstance(v,float):return None if not math.isfinite(v) else v
    if hasattr(v,"item"):
        try:return json_safe(v.item())
        except Exception:pass
    if isinstance(v,(list,tuple)):return [json_safe(x) for x in v]
    if isinstance(v,dict):return {str(k):json_safe(x) for k,x in v.items()}
    return str(v)

def parse_b3dm(path:Path)->tuple[int,dict[str,Any]]:
    b=path.read_bytes()
    if len(b)<28 or b[:4]!=b"b3dm":raise ValueError(f"invalid b3dm: {path}")
    version,byte_len,ft_json_len,ft_bin_len,bt_json_len,bt_bin_len=struct.unpack_from("<6I",b,4)
    if version!=1 or byte_len!=len(b):raise ValueError(f"invalid b3dm header: {path}")
    off=28;ft={}
    if ft_json_len:
        raw=b[off:off+ft_json_len].rstrip(b" \t\r\n\x00")
        if raw:ft=json.loads(raw.decode("utf-8"))
    off+=ft_json_len+ft_bin_len;bt={}
    if bt_json_len:
        raw=b[off:off+bt_json_len].rstrip(b" \t\r\n\x00")
        if raw:bt=json.loads(raw.decode("utf-8"))
    n=int(ft.get("BATCH_LENGTH",0) or 0)
    if n<=0:n=max([len(v) for v in bt.values() if isinstance(v,list)],default=0)
    return n,bt

def num(v:Any)->float|None:
    try:
        x=float(v);return x if math.isfinite(x) else None
    except Exception:return None

def first_value(row:dict[str,Any],names:Iterable[str])->Any:
    lower={k.lower():k for k in row}
    for name in names:
        k=lower.get(name.lower())
        if k and row.get(k) not in (None,""):return row[k]
    return None

def preferred_property(keys:Counter[str])->str|None:
    lower={k.lower():k for k in keys}
    for wanted in ["gml_id","gml:id","gmlid","id"]:
        if wanted in lower:return lower[wanted]
    candidates=[k for k in keys if "gml" in k.lower() and "id" in k.lower()]
    if candidates:return max(candidates,key=lambda k:keys[k])
    candidates=[k for k in keys if k.lower().endswith("_id") or k.lower().endswith("id")]
    return max(candidates,key=lambda k:keys[k]) if candidates else None

def extract_buildings()->tuple[list[dict[str,Any]],dict[str,Any]]:
    files=sorted(BUILDINGS_DIR.rglob("*.b3dm"));
    if not files:raise RuntimeError("no B3DM building tiles")
    key_counts=Counter();raw_rows=[]
    for idx,path in enumerate(files,1):
        n,bt=parse_b3dm(path)
        if n<=0:continue
        array_keys=[k for k,v in bt.items() if isinstance(v,list) and len(v)==n];key_counts.update({k:n for k in array_keys})
        for i in range(n):
            row={k:json_safe(bt[k][i]) for k in array_keys};x=num(row.get("_x"));y=num(row.get("_y"))
            if x is None or y is None:
                xmin,xmax,ymin,ymax=num(row.get("_xmin")),num(row.get("_xmax")),num(row.get("_ymin")),num(row.get("_ymax"))
                if None not in (xmin,xmax):x=(xmin+xmax)/2
                if None not in (ymin,ymax):y=(ymin+ymax)/2
            if x is None or y is None or not(-180<=x<=180 and -90<=y<=90):continue
            row["__x"]=x;row["__y"]=y;raw_rows.append(row)
        if idx%250==0:log(f"parsed B3DM {idx}/{len(files)}; buildings={len(raw_rows)}")
    id_prop=preferred_property(key_counts);rows=[];seen=Counter()
    for r in raw_rows:
        x,y=r["__x"],r["__y"];raw_id=r.get(id_prop) if id_prop else None;key=str(raw_id) if raw_id not in (None,"") else f"xy:{x:.7f},{y:.7f}";seen[key]+=1
        if seen[key]>1:key=f"{key}#{seen[key]}"
        xmin,ymin,xmax,ymax=num(r.get("_xmin")),num(r.get("_ymin")),num(r.get("_xmax")),num(r.get("_ymax"));zmin,zmax=num(r.get("_zmin")),num(r.get("_zmax"));height=(zmax-zmin) if zmin is not None and zmax is not None and zmax>=zmin else None
        rows.append({"key":key,"source_id":json_safe(raw_id),"x":x,"y":y,"xmin":xmin,"ymin":ymin,"xmax":xmax,"ymax":ymax,"height":height,"floors":json_safe(first_value(r,["storeysAboveGround","floors","地上階数"])),"usage":json_safe(first_value(r,["usage","用途","buildingUse"])),"name":json_safe(first_value(r,["name","建物名称","buildingName"]))})
    return rows,{"tileCount":len(files),"buildingCount":len(rows),"idProperty":id_prop,"propertyCounts":dict(key_counts.most_common())}

def tile_xy(lon:float,lat:float,z:int)->tuple[int,int,float,float]:
    n=2**z;xf=(lon+180)/360*n;latr=math.radians(max(-85.05112878,min(85.05112878,lat)));yf=(1-math.asinh(math.tan(latr))/math.pi)/2*n;x,y=int(math.floor(xf)),int(math.floor(yf));return x,y,xf-x,yf-y

def decode_dem_pixel(rgb:tuple[int,int,int])->float|None:
    r,g,b=rgb;x=r*65536+g*256+b
    if x==8388608:return None
    return (x if x<8388608 else x-16777216)*.01

def bilinear_dem(img:Image.Image,fx:float,fy:float)->float|None:
    px=max(0,min(255,fx*255));py=max(0,min(255,fy*255));x0,y0=int(math.floor(px)),int(math.floor(py));x1,y1=min(255,x0+1),min(255,y0+1);ax,ay=px-x0,py-y0;vals=[decode_dem_pixel(img.getpixel((x0,y0))[:3]),decode_dem_pixel(img.getpixel((x1,y0))[:3]),decode_dem_pixel(img.getpixel((x0,y1))[:3]),decode_dem_pixel(img.getpixel((x1,y1))[:3])];ws=[(1-ax)*(1-ay),ax*(1-ay),(1-ax)*ay,ax*ay];good=[(v,w) for v,w in zip(vals,ws) if v is not None]
    if not good:return None
    den=sum(w for _,w in good);return sum(v*w for v,w in good)/den if den else good[0][0]

def ground_elevation(lon:float,lat:float,cache:dict[str,Image.Image|None])->float|None:
    for z in range(14,0,-1):
        x,y,fx,fy=tile_xy(lon,lat,z);key=f"{z}/{x}/{y}"
        if key not in cache:
            p=ELEVATION_DIR/"dem_png"/str(z)/str(x)/f"{y}.png";cache[key]=Image.open(p).convert("RGB") if p.exists() else None
        if cache[key] is not None:return bilinear_dem(cache[key],fx,fy)
    return None

def apply_flood_join(rows,points,boxes,flood):
    geoms=list(flood.geometry)
    if not geoms:return
    tree=STRtree(geoms);ranks=flood["rank"].astype(int).to_numpy();rivers=flood["river"].fillna("").astype(str).to_numpy();pairs=tree.query(boxes,predicate="intersects");hits=defaultdict(list)
    if getattr(pairs,"shape",(0,))[0]==2:
        for bi,hi in zip(pairs[0],pairs[1]):hits[int(bi)].append(int(hi))
    for bi,his in hits.items():
        mr=max(int(ranks[h]) for h in his);rows[bi]["flood_rank"]=mr;rows[bi]["flood_label"]=FLOOD_LABELS.get(mr,"不明");rows[bi]["flood_rivers"]=sorted({rivers[h] for h in his if int(ranks[h])==mr and rivers[h]})[:8]
    pp=tree.query(points,predicate="intersects");cent=defaultdict(int)
    if getattr(pp,"shape",(0,))[0]==2:
        for bi,hi in zip(pp[0],pp[1]):cent[int(bi)]=max(cent[int(bi)],int(ranks[int(hi)]))
    for bi,rank in cent.items():rows[bi]["flood_centroid_rank"]=rank

def apply_simple_join(rows,points,hazard,prefix,severity_col,label_col):
    geoms=list(hazard.geometry)
    if not geoms:return
    tree=STRtree(geoms);sev=hazard[severity_col].fillna(0).astype(int).to_numpy();labels=hazard[label_col].fillna("").astype(str).to_numpy();pairs=tree.query(points,predicate="intersects");best={}
    if getattr(pairs,"shape",(0,))[0]==2:
        for bi,hi in zip(pairs[0],pairs[1]):
            bi,hi=int(bi),int(hi)
            if bi not in best or sev[hi]>sev[best[bi]]:best[bi]=hi
    for bi,hi in best.items():rows[bi][f"{prefix}_severity"]=int(sev[hi]);rows[bi][f"{prefix}_label"]=labels[hi]

def apply_landslide_join(rows,boxes,hazard):
    geoms=list(hazard.geometry)
    if not geoms:return
    tree=STRtree(geoms);level=hazard["risk_level"].fillna(0).astype(int).to_numpy();phen=hazard["phenomenon"].fillna("").astype(str).to_numpy();designation=hazard["designation"].fillna("").astype(str).to_numpy();zone=hazard["zone_type"].fillna("").astype(str).to_numpy();pairs=tree.query(boxes,predicate="intersects");hits=defaultdict(list)
    if getattr(pairs,"shape",(0,))[0]==2:
        for bi,hi in zip(pairs[0],pairs[1]):hits[int(bi)].append(int(hi))
    for bi,his in hits.items():rows[bi]["landslide_level"]=max(int(level[h]) for h in his);rows[bi]["landslide_phenomena"]=sorted({phen[h] for h in his if phen[h]});rows[bi]["landslide_zones"]=sorted({f"{zone[h]}（{designation[h]}）" for h in his if zone[h]})

def spatial_join_buildings(rows,flood,tsunami,landslide):
    points=[Point(r["x"],r["y"]) for r in rows];boxes=[]
    for r,p in zip(rows,points):
        if None not in (r["xmin"],r["ymin"],r["xmax"],r["ymax"]):
            try:boxes.append(box(r["xmin"],r["ymin"],r["xmax"],r["ymax"]))
            except Exception:boxes.append(p)
        else:boxes.append(p)
    log("spatial join: flood");apply_flood_join(rows,points,boxes,flood);log("spatial join: tsunami");apply_simple_join(rows,points,tsunami,"tsunami","severity","depth_class");log("spatial join: landslide");apply_landslide_join(rows,boxes,landslide);log("sample GSI DEM10B")
    cache={}
    for i,r in enumerate(rows,1):
        e=ground_elevation(r["x"],r["y"],cache);r["elevation"]=round(e,1) if e is not None else None
        if i%25000==0:log(f"DEM sampled {i}/{len(rows)}")
    for img in cache.values():
        if img is not None:img.close()

def compact_buildings(rows,id_property):
    schema=["key","sourceId","lon","lat","elevation","height","floors","usage","name","floodRank","floodCentroidRank","floodLabel","floodRivers","tsunamiSeverity","tsunamiLabel","landslideLevel","landslidePhenomena","landslideZones"]
    records=[]
    for r in rows:records.append([r.get("key"),r.get("source_id"),round(r["x"],7),round(r["y"],7),r.get("elevation"),round(r["height"],1) if r.get("height") is not None else None,r.get("floors"),r.get("usage"),r.get("name"),int(r.get("flood_rank",0) or 0),int(r.get("flood_centroid_rank",0) or 0),r.get("flood_label",""),r.get("flood_rivers",[]),int(r.get("tsunami_severity",0) or 0),r.get("tsunami_label",""),int(r.get("landslide_level",0) or 0),r.get("landslide_phenomena",[]),r.get("landslide_zones",[])])
    return {"version":1,"schema":schema,"idProperty":id_property,"fallbackKey":"_x/_y rounded to 7 decimals","records":records}

def write_geojson(gdf,path,properties):
    path.parent.mkdir(parents=True,exist_ok=True);features=[]
    for _,row in gdf.iterrows():
        if row.geometry is None or row.geometry.is_empty:continue
        features.append({"type":"Feature","properties":{p:json_safe(row.get(p)) for p in properties},"geometry":mapping(row.geometry)})
    path.write_text(json.dumps({"type":"FeatureCollection","features":features},ensure_ascii=False,separators=(",",":")),encoding="utf-8");return len(features)

def summarize(rows):
    return {"buildings":len(rows),"floodAny":sum((r.get("flood_rank") or 0)>=1 for r in rows),"flood05":sum((r.get("flood_rank") or 0)>=2 for r in rows),"flood3":sum((r.get("flood_rank") or 0)>=3 for r in rows),"flood5":sum((r.get("flood_rank") or 0)>=4 for r in rows),"tsunami":sum((r.get("tsunami_severity") or 0)>0 for r in rows),"landslideWarning":sum((r.get("landslide_level") or 0)>=1 for r in rows),"landslideSpecial":sum((r.get("landslide_level") or 0)>=2 for r in rows)}

def main()->int:
    ap=argparse.ArgumentParser();ap.add_argument("--force",action="store_true");args=ap.parse_args();manifest_path=OUT_DIR/"manifest.json"
    if manifest_path.exists() and not args.force:
        try:
            old=json.loads(manifest_path.read_text(encoding="utf-8"))
            if old.get("complete") and old.get("pipelineVersion")==PIPELINE_VERSION:log("analysis cache already complete; use --force to rebuild");return 0
        except Exception:pass
    if OUT_DIR.exists():shutil.rmtree(OUT_DIR)
    (OUT_DIR/"hazards").mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="matsuyama-risk-") as td:
        work=Path(td);log("1/6 boundary + official hazard vectors");city=city_boundary(work);flood=build_flood(city,work);landslide=build_landslide(city,work);tsunami,tsunami_url=build_tsunami(city,work)
        if flood.empty or landslide.empty:raise RuntimeError(f"hazard source unexpectedly empty: flood={len(flood)} landslide={len(landslide)}")
        bc=write_geojson(city,OUT_DIR/"city_boundary.geojson",[]);fc=write_geojson(flood,OUT_DIR/"hazards/flood_max.geojson",["rank","depth_class","river","river_class"]);lc=write_geojson(landslide,OUT_DIR/"hazards/landslide.geojson",["phenomenon_code","phenomenon","zone_code","zone_type","designation","risk_level","zone_no","name","notice_date"]);tc=write_geojson(tsunami,OUT_DIR/"hazards/tsunami.geojson",["depth_class","severity"])
        log("2/6 extract PLATEAU building metadata");rows,diag=extract_buildings();city_geom=city.geometry.iloc[0];rows=[r for r in rows if city_geom.intersects(Point(r["x"],r["y"]))];log(f"PLATEAU buildings inside Matsuyama boundary: {len(rows)}")
        if not rows:raise RuntimeError("no PLATEAU building records inside Matsuyama")
        spatial_join_buildings(rows,flood,tsunami,landslide);(OUT_DIR/"building-risk.json").write_text(json.dumps(compact_buildings(rows,diag.get("idProperty")),ensure_ascii=False,separators=(",",":")),encoding="utf-8");counts=summarize(rows)
        manifest={"complete":True,"pipelineVersion":PIPELINE_VERSION,"generatedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"city":"松山市","bbox":list(map(float,city.total_bounds)),"counts":{**counts,"floodFeatures":fc,"landslideFeatures":lc,"tsunamiFeatures":tc,"boundaryFeatures":bc},"buildingJoin":{"idProperty":diag.get("idProperty"),"tileCount":diag.get("tileCount"),"method":"PLATEAU B3DM batch-table metadata; flood/landslide use building bbox intersection; tsunami and DEM10B use centroid","floodConservative":"maximum depth rank intersecting PLATEAU feature bounding box; centroid rank retained separately"},"sources":{"boundary":{"dataset":"国土数値情報 行政区域 N03","year":2026,"page":PAGES["boundary"]},"flood":{"dataset":"国土数値情報 洪水浸水想定区域 A31a","year":2025,"scenario":"想定最大規模","page":PAGES["flood"]},"landslide":{"dataset":"国土数値情報 土砂災害警戒区域 A33","year":2025,"referenceDate":"2025-08-01","page":PAGES["landslide"]},"tsunamiAnalysis":{"dataset":"国土数値情報 津波浸水想定 A40（公開取得可能な愛媛県ベクトル）","sourceVintage":2016,"download":tsunami_url,"status":"stale-public-vector","warning":"愛媛県は2025-09-02に津波浸水想定を変更。最新GIS元データはWeb公開ではなく利用手続により提供されるため、本分析値は最新県想定ではない。"},"tsunamiLatestOfficial":{"date":"2025-09-02","url":"https://www.pref.ehime.jp/page/120626.html","damageStudyUpdated":"2026-02-16","damageStudyUrl":"https://www.pref.ehime.jp/page/135020.html"},"terrain":{"dataset":"国土地理院 DEM10B","role":"approximate ground elevation at building centroid"},"buildings":{"dataset":"Project PLATEAU 松山市 2020 LOD1"}},"limitations":["分析結果は避難判断・測量・法定区域確認には使用しないこと。","PLATEAU建物は2020年度LOD1。建物属性とハザードの基準時点は一致しない。","洪水の建物判定はPLATEAU収録bboxとの交差最大ランクで保守的に付与し、公式な個別建物被害判定ではない。","標高はDEM10Bの概略値。","津波の分析用ベクトルは愛媛県2025年9月2日変更想定を反映した最新GISではない。最新県資料を必ず確認すること。"]}
        manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8");(OUT_DIR/"building-properties.json").write_text(json.dumps(diag,ensure_ascii=False,indent=2),encoding="utf-8");log(json.dumps(manifest["counts"],ensure_ascii=False,indent=2))
    return 0

if __name__=="__main__":raise SystemExit(main())
