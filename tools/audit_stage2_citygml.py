#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, math, pathlib, re, shutil, tempfile, time, urllib.request
import xml.etree.ElementTree as ET
from collections import Counter

BBOX=(132.7600,33.8345,132.7712,33.8441)
API="https://api.plateauview.mlit.go.jp/datacatalog/citygml"
CITY="38201"
UA="plateau-matsuyama-stage2-audit/1.0 (+https://github.com/ryotamatsuki/plateau_matsuyama)"
GML_ID="{http://www.opengis.net/gml}id"

def local(tag): return tag.rsplit("}",1)[-1] if "}" in tag else tag

def get_json(url):
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=60) as r: return json.load(r)

def download(url,dest):
    last=None
    for i in range(3):
        try:
            req=urllib.request.Request(url,headers={"User-Agent":UA})
            with urllib.request.urlopen(req,timeout=120) as r, open(dest,"wb") as f:
                shutil.copyfileobj(r,f,1024*1024)
            return
        except Exception as e:
            last=e; time.sleep(2**i)
    raise RuntimeError(f"download failed: {url}: {last}")

def datasets(p):
    if isinstance(p,list): return [x for x in p if isinstance(x,dict)]
    if not isinstance(p,dict): return []
    out=[]
    if "files" in p: out.append(p)
    for k in ("datasets","items","results","data"):
        v=p.get(k)
        if isinstance(v,list): out += [x for x in v if isinstance(x,dict)]
        elif isinstance(v,dict) and "files" in v: out.append(v)
    if not out: out=[v for v in p.values() if isinstance(v,dict) and "files" in v]
    return out

def choose(p):
    ds=datasets(p)
    m=[d for d in ds if str(d.get("cityCode","")).startswith(CITY)]
    if m: return sorted(m,key=lambda d:int(d.get("year") or 0),reverse=True)[0]
    if len(ds)==1: return ds[0]
    raise RuntimeError(f"Matsuyama dataset not found; candidates={len(ds)}")

def entries(ds,t):
    v=(ds.get("files") or {}).get(t) or []
    if isinstance(v,dict): v=list(v.values())
    return [x for x in v if isinstance(x,dict) and x.get("url")]

def nums(s):
    try:return [float(x) for x in (s or "").split()]
    except:return []

def points(elem):
    out=[]
    for x in elem.iter():
        if local(x.tag) not in ("pos","posList"): continue
        a=nums(x.text)
        if not a: continue
        try: dim=int(x.attrib.get("srsDimension",""))
        except: dim=0
        if dim not in (2,3): dim=3 if len(a)%3==0 else 2
        for i in range(0,len(a)-dim+1,dim):
            u,v=a[i],a[i+1]; z=a[i+2] if dim==3 else None
            if 20<=u<=50 and 120<=v<=155: lat,lon=u,v
            elif 120<=u<=155 and 20<=v<=50: lon,lat=u,v
            else: continue
            out.append((lon,lat,z))
    return out

def box(pts):
    if not pts:return None
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    return min(xs),min(ys),max(xs),max(ys)

def hit(a,b):
    return bool(a) and not (a[2]<b[0] or a[0]>b[2] or a[3]<b[1] or a[1]>b[3])

def polyids(e):
    return {x.attrib[GML_ID] for x in e.iter() if local(x.tag) in ("Polygon","Surface") and GML_ID in x.attrib}

def sloped(e):
    for x in e.iter():
        if local(x.tag) not in ("pos","posList"): continue
        zs=[p[2] for p in points(x) if p[2] is not None and math.isfinite(p[2])]
        if len(zs)>=3 and max(zs)-min(zs)>0.15:return True
    return False

def audit_bldg(path,bbox):
    bs={}; targets=set(); images=set()
    for _,e in ET.iterparse(path,events=("end",)):
        n=local(e.tag)
        if n=="Building":
            bid=e.attrib.get(GML_ID) or f"anon:{len(bs)}"
            bb=box(points(e))
            if hit(bb,bbox):
                roofs=[x for x in e.iter() if local(x.tag)=="RoofSurface"]
                walls=[x for x in e.iter() if local(x.tag)=="WallSurface"]
                rp=set().union(*(polyids(x) for x in roofs)) if roofs else set()
                wp=set().union(*(polyids(x) for x in walls)) if walls else set()
                bs[bid]={"lod2":any(local(x.tag).startswith("lod2") for x in e.iter()) or bool(roofs or walls),
                         "roof_surfaces":len(roofs),"wall_surfaces":len(walls),
                         "sloped_roof":any(sloped(x) for x in roofs),"rp":rp,"wp":wp}
            e.clear()
        elif n=="target":
            u=e.attrib.get("uri") or e.attrib.get("{http://www.w3.org/1999/xlink}href")
            if u: targets.add(u.lstrip("#"))
            e.clear()
        elif n=="imageURI":
            if e.text and e.text.strip(): images.add(e.text.strip())
            e.clear()
    for b in bs.values():
        b["wall_texture_ref"]=bool(b.pop("wp")&targets)
        b["roof_texture_ref"]=bool(b.pop("rp")&targets)
        b["texture_ref"]=b["wall_texture_ref"] or b["roof_texture_ref"]
    return bs,images,len(targets)

def childtext(e,name):
    for x in e.iter():
        if local(x.tag)==name and x.text and x.text.strip():return x.text.strip()

def audit_tran(path,bbox):
    roads={}
    for _,e in ET.iterparse(path,events=("end",)):
        if local(e.tag)!="Road":continue
        rid=e.attrib.get(GML_ID) or f"anon:{len(roads)}"
        if hit(box(points(e)),bbox):
            ta=[x for x in e.iter() if local(x.tag)=="TrafficArea"]
            aa=[x for x in e.iter() if local(x.tag)=="AuxiliaryTrafficArea"]
            fc=Counter(filter(None,(childtext(x,"function") for x in ta)))
            ac=Counter(filter(None,(childtext(x,"function") for x in aa)))
            lods=sorted({int(m.group(1)) for x in e.iter() if (m:=re.match(r"lod([0-4])",local(x.tag)))})
            roads[rid]={"lods":lods,"traffic":len(ta),"aux":len(aa),"functions":dict(fc),"aux_functions":dict(ac)}
        e.clear()
    return roads

def pct(a,b):return round(100*a/b,2) if b else 0.0

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--out",default="stage2-audit"); a=ap.parse_args()
    out=pathlib.Path(a.out); out.mkdir(parents=True,exist_ok=True)
    cond="r:"+",".join(f"{x:.7f}" for x in BBOX); url=f"{API}/{cond}"
    payload=get_json(url); (out/"catalog-response.json").write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
    ds=choose(payload); files=ds.get("files") or {}; types=sorted(files) if isinstance(files,dict) else []
    tmp=pathlib.Path(tempfile.mkdtemp(prefix="stage2-audit-")); bs={}; roads={}; images=set(); bf=[]; tf=[]
    try:
        for i,x in enumerate(entries(ds,"bldg")):
            p=tmp/f"bldg-{i}.gml"; download(x["url"],p); b,im,tc=audit_bldg(p,BBOX); bs.update(b); images|=im
            bf.append({k:x.get(k) for k in ("code","maxLod","features","lod1","lod2","fileSize","url")}|{"bbox_buildings":len(b),"texture_targets":tc})
        for i,x in enumerate(entries(ds,"tran")):
            p=tmp/f"tran-{i}.gml"; download(x["url"],p); r=audit_tran(p,BBOX); roads.update(r)
            tf.append({k:x.get(k) for k in ("code","maxLod","features","lod1","lod2","fileSize","url")}|{"bbox_roads":len(r)})
    finally: shutil.rmtree(tmp,ignore_errors=True)
    bv=list(bs.values()); lod2=sum(x["lod2"] for x in bv); roof=sum(x["roof_surfaces"]>0 for x in bv); wall=sum(x["wall_surfaces"]>0 for x in bv)
    slope=sum(x["sloped_roof"] for x in bv); tex=sum(x["texture_ref"] for x in bv); wtex=sum(x["wall_texture_ref"] for x in bv); rtex=sum(x["roof_texture_ref"] for x in bv)
    fc=Counter(); ac=Counter(); lc=Counter(); nta=naa=0
    for r in roads.values():
        fc.update(r["functions"]); ac.update(r["aux_functions"]); lc.update(r["lods"]); nta+=r["traffic"]; naa+=r["aux"]
    rep={"audit_version":1,"city_code":ds.get("cityCode"),"city_name":ds.get("cityName"),"year":ds.get("year"),"registration_year":ds.get("registrationYear"),
         "spec":ds.get("spec"),"bbox":{"west":BBOX[0],"south":BBOX[1],"east":BBOX[2],"north":BBOX[3]},"catalog_url":url,
         "available_feature_types":types,"feature_types":ds.get("featureTypes") or {},"building_files":bf,"transportation_files":tf,
         "buildings":{"count":len(bv),"lod2":lod2,"lod2_percent":pct(lod2,len(bv)),"with_roof_surface":roof,"with_wall_surface":wall,
                      "with_sloped_roof":slope,"sloped_roof_percent_of_lod2":pct(slope,lod2),"with_texture_reference":tex,
                      "texture_percent_of_lod2":pct(tex,lod2),"with_wall_texture_reference":wtex,"with_roof_texture_reference":rtex,
                      "image_uri_count":len(images),"image_uri_examples":sorted(images)[:20]},
         "transportation":{"road_count":len(roads),"road_lod_histogram":dict(lc),"traffic_area_count":nta,"auxiliary_traffic_area_count":naa,
                           "traffic_function_counts":dict(fc),"auxiliary_function_counts":dict(ac),"vehicle_area_1000":fc["1000"],
                           "intersection_area_1020":fc["1020"],"sidewalk_area_2000":fc["2000"],"has_official_sidewalk_geometry":fc["2000"]>0},
         "stage2_source_decision":{"lod2_buildings_available":lod2>0,"building_textures_referenced":tex>0,"official_road_geometry_available":len(roads)>0,
                                   "official_sidewalk_geometry_available":fc["2000"]>0,"vegetation_citygml_available":any(k in types for k in ("veg","vegetation")),
                                   "city_furniture_citygml_available":any(k in types for k in ("frn","cityfurniture","furniture"))}}
    (out/"stage2-data-audit.json").write_text(json.dumps(rep,ensure_ascii=False,indent=2),encoding="utf-8")
    b=rep["buildings"]; t=rep["transportation"]; d=rep["stage2_source_decision"]
    md=f"""# Procedural Matsuyama Stage 2 data audit

- Dataset: {rep['city_name']} / year {rep['year']} / spec `{rep['spec']}`
- Stage 1 bbox: `{BBOX[0]}, {BBOX[1]}, {BBOX[2]}, {BBOX[3]}`
- Catalog: `{url}`
- Feature types: `{', '.join(types)}`

## Buildings

- Buildings intersecting bbox: **{b['count']}**
- LOD2 buildings: **{b['lod2']} ({b['lod2_percent']}%)**
- RoofSurface / WallSurface: **{b['with_roof_surface']} / {b['with_wall_surface']}**
- Non-horizontal roof geometry: **{b['with_sloped_roof']}**
- Appearance texture target: **{b['with_texture_reference']}**
- Wall / roof texture target: **{b['with_wall_texture_reference']} / {b['with_roof_texture_reference']}**

## Transportation

- Road objects intersecting bbox: **{t['road_count']}**
- TrafficArea / AuxiliaryTrafficArea: **{t['traffic_area_count']} / {t['auxiliary_traffic_area_count']}**
- function 1000 vehicle / 1020 intersection / 2000 sidewalk: **{t['vehicle_area_1000']} / {t['intersection_area_1020']} / {t['sidewalk_area_2000']}**
- Official sidewalk geometry usable: **{t['has_official_sidewalk_geometry']}**

## Stage 2 source decision

"""
    for k,v in d.items(): md+=f"- `{k}`: **{v}**\n"
    md+="\nTexture presence means CityGML appearance targets were found; referenced image bytes are audited separately before production import.\n"
    (out/"stage2-data-audit.md").write_text(md,encoding="utf-8")
    print(json.dumps(rep,ensure_ascii=False,indent=2))

if __name__=="__main__": main()
