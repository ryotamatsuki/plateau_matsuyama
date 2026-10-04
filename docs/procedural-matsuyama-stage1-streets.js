'use strict';
(function installStage1Streets() {
  if(!window.Cesium || window.__matsuyamaProc1Streets) return;
  window.__matsuyamaProc1Streets=true;
  const C=Cesium, cache='matsuyama-proc1-osm-v3';
  const endpoints=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
  const mobile=matchMedia('(pointer:coarse)').matches || innerWidth<=700;
  const limits={roads:mobile?150:260,trees:mobile?70:150,lamps:mobile?70:160};
  const E=[], P=[];
  const colors={road:C.Color.fromCssColorString('#555a5e').withAlpha(.62),walk:C.Color.fromCssColorString('#b8b2a7').withAlpha(.65),tree:C.Color.fromCssColorString('#58785c'),tree2:C.Color.fromCssColorString('#759064'),trunk:C.Color.fromCssColorString('#65513f'),pole:C.Color.fromCssColorString('#555c61'),lamp:C.Color.fromCssColorString('#fff0c5')};
  const priority={trunk:0,primary:1,secondary:2,tertiary:3,pedestrian:4,unclassified:5,residential:6,living_street:7,service:8,footway:9,cycleway:10,path:11,steps:12};
  let loaded=false, loading=null, scheduled=false, generation=0, failed=false, details={}, sampleRecords=[];
  const api=()=>window.MatsuyamaProceduralStage1;
  const yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,20));
  function inArea(p) {const a=api().area;return p[0]>=a.west && p[0]<=a.east && p[1]>=a.south && p[1]<=a.north;}
  function meters(a,b){const dx=(b[0]-a[0])*111320*Math.cos(C.Math.toRadians((a[1]+b[1])/2)),dy=(b[1]-a[1])*110540;return Math.hypot(dx,dy);}
  function compact(j) {
    const d={at:Date.now(),roads:[],trees:[],lamps:[],buildings:[]};
    for(const e of j.elements || []) {
      const tags=e.tags || {};
      if(e.type==='way' && e.geometry?.length>1) {
        const p=e.geometry.filter(q=>Number.isFinite(q.lon)&&Number.isFinite(q.lat)).map(q=>[q.lon,q.lat]);
        if(tags.building && p.length>=4) d.buildings.push(p);
        const h=tags.highway?.replace(/_link$/,'');
        if(h in priority && tags.tunnel!=='yes' && tags.bridge!=='yes' && tags.covered!=='yes' && (!tags.level || tags.level==='0'))
          d.roads.push({id:e.id,h,l:tags.lanes||'',w:tags.width||'',sw:tags.sidewalk||'',lit:tags.lit||'',tree:tags.tree_lined||'',p});
      } else if(e.type==='node' && inArea([e.lon,e.lat])) {
        const q={p:[e.lon,e.lat],source:'osm',osmId:e.id};
        if(tags.natural==='tree') d.trees.push(q);
        if(tags.highway==='street_lamp') d.lamps.push(q);
      }
    }
    return d;
  }
  async function osm(force) {
    if(!force)try{const old=JSON.parse(localStorage.getItem(cache)||'null');if(old && Array.isArray(old.buildings) && Date.now()-old.at<604800000)return old;}catch(_){}
    const a=api().area,b=[a.south,a.west,a.north,a.east].join(',');
    const q='[out:json][timeout:20];(way["highway"]('+b+');way["building"]('+b+');node["natural"="tree"]('+b+');node["highway"="street_lamp"]('+b+'););out geom;';
    let error;
    for(const url of endpoints) {
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
      try {
        const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({data:q}),cache:'no-store',signal:controller.signal});
        if(!r.ok)throw Error('Overpass '+r.status);
        const raw=await r.json();if(!Array.isArray(raw.elements))throw Error('Overpass response has no elements');
        const d=compact(raw);try{localStorage.setItem(cache,JSON.stringify(d));}catch(_){}
        return d;
      }catch(e){error=e;}finally{clearTimeout(timer);}
    }
    throw error || Error('OSM unavailable');
  }
  function width(r) {
    const defaults={trunk:10,primary:8,secondary:7,tertiary:6,unclassified:4.8,residential:4.8,living_street:4,service:3.5,pedestrian:3.5,footway:1.8,cycleway:2.2,path:1.5,steps:1.5};
    const w=parseFloat(r.w),lanes=parseFloat(r.l);
    const guessed=Number.isFinite(w)&&w>0?w:Number.isFinite(lanes)&&lanes>0?lanes*2.8:defaults[r.h];
    return C.Math.clamp(guessed,1.2,['trunk','primary','secondary'].includes(r.h)?14:['footway','path','steps','cycleway'].includes(r.h)?3:8);
  }
  function sides(r) {
    if(['pedestrian','footway','path','steps','cycleway'].includes(r.h) || /^(no|none|separate)$/.test(r.sw))return [];
    if(r.sw==='left')return [1];if(r.sw==='right')return [-1];
    if(/^(both|yes)$/.test(r.sw))return [-1,1];
    return ['trunk','primary','secondary'].includes(r.h)?[-1,1]:[];
  }
  function offset(p,a,b,dist) {
    const scale=111320*Math.cos(C.Math.toRadians(p[1]));
    const dx=(b[0]-a[0])*scale,dy=(b[1]-a[1])*110540,len=Math.hypot(dx,dy);
    if(len<.01)return p.slice();return[p[0]-dy/len*dist/scale,p[1]+dx/len*dist/110540];
  }
  function inside(p,poly) {
    let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;
    }return yes;
  }
  function buildingIndex(polys) {
    const rows=polys.map(p=>({p,w:Math.min(...p.map(q=>q[0])),e:Math.max(...p.map(q=>q[0])),s:Math.min(...p.map(q=>q[1])),n:Math.max(...p.map(q=>q[1]))}));
    return p=>rows.some(r=>p[0]>=r.w && p[0]<=r.e && p[1]>=r.s && p[1]<=r.n && inside(p,r.p));
  }
  // Clip complete ways returned by `out geom` to the requested Stage 1 bbox.
  function clipped(p) {
    const a=api().area,out=[];let line=[];
    for(let i=1;i<p.length;i++){
      const x=p[i-1],y=p[i],dx=y[0]-x[0],dy=y[1]-x[1];let lo=0,hi=1,ok=true;
      for(const [v,q] of [[-dx,x[0]-a.west],[dx,a.east-x[0]],[-dy,x[1]-a.south],[dy,a.north-x[1]]]){
        if(v===0){if(q<0)ok=false;continue;}const t=q/v;if(v<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
      }
      if(!ok || lo>hi){if(line.length>1)out.push(line);line=[];continue;}
      const start=[x[0]+dx*lo,x[1]+dy*lo],end=[x[0]+dx*hi,x[1]+dy*hi];
      if(line.length && meters(line[line.length-1],start)>.1){out.push(line);line=[];}
      if(!line.length)line.push(start);line.push(end);
      if(hi<1){out.push(line);line=[];}
    }
    if(line.length>1)out.push(line);return out;
  }
  function clear(list) {const v=api().state.viewer;for(const e of list)v.entities.remove(e);list.length=0;}
  function add(list,options,source='osm',osmId) {
    const e=api().state.viewer.entities.add({...options,show:api().isVisible(),properties:{stage1:true,source,osmId}});list.push(e);return e;
  }
  async function buildRoads(rows,blocked,token) {
    let count=0;
    for(const r of rows){if(token!==generation)return;
      const w=width(r);
      for(const p of clipped(r.p)) {
        add(E,{corridor:{positions:p.map(q=>C.Cartesian3.fromDegrees(...q)),width:w,material:colors.road,cornerType:C.CornerType.MITERED,classificationType:C.ClassificationType.TERRAIN,distanceDisplayCondition:new C.DistanceDisplayCondition(0,2200),zIndex:21}},'osm',r.id);
        for(const side of sides(r)){
          const shifted=p.map((q,i)=>offset(q,p[Math.max(0,i-1)],p[Math.min(p.length-1,i+1)],side*(w/2+.75)));
          // Do not draw an inferred sidewalk through mapped building footprints.
          let run=[];for(const q of shifted){if(inArea(q)&&!blocked(q)){run.push(q);}else{if(run.length>1)addWalk(run,r.id);run=[];}}if(run.length>1)addWalk(run,r.id);
        }
        if(['primary','secondary','tertiary'].includes(r.h))add(E,{polyline:{positions:p.map(q=>C.Cartesian3.fromDegrees(...q)),width:1,clampToGround:true,material:new C.PolylineDashMaterialProperty({color:C.Color.WHITE.withAlpha(.32),dashLength:18}),distanceDisplayCondition:new C.DistanceDisplayCondition(0,1000),zIndex:22}},'interpolated',r.id);
      }
      count++;if(count%6===0){api().render();await yieldFrame();}
    }
    return count;
  }
  function addWalk(p,id){add(E,{corridor:{positions:p.map(q=>C.Cartesian3.fromDegrees(...q)),width:1.5,material:colors.walk,cornerType:C.CornerType.MITERED,classificationType:C.ClassificationType.TERRAIN,distanceDisplayCondition:new C.DistanceDisplayCondition(0,1800),zIndex:20}},'interpolated',id);}
  function infill(rows,kind,max,blocked) {
    const out=[],spacing=kind==='tree'?58:48;
    for(const r of rows){const sideList=sides(r);
      if(!sideList.length || (kind==='tree' && !['yes','both','left','right'].includes(r.tree) && !['primary','secondary'].includes(r.h)) || (kind==='lamp' && r.lit==='no'))continue;
      for(let i=1;i<r.p.length && out.length<max;i++){
        const a=r.p[i-1],b=r.p[i],len=meters(a,b),steps=Math.floor(len/spacing);
        for(let j=1;j<=steps && out.length<max;j++){
          const t=j/(steps+1),p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
          const q=offset(p,a,b,sideList[j%sideList.length]*(width(r)/2+.65));
          if(inArea(q)&&!blocked(q))out.push({p:q,source:'interpolated',osmId:r.id});
        }
      }
      if(out.length>=max)break;
    }return out;
  }
  function dedupe(rows,min,max) {const out=[];for(const q of rows){if(out.length>=max)break;if(inArea(q.p)&&!out.some(x=>meters(q.p,x.p)<min))out.push(q);}return out;}
  async function buildProps(d,rows,blocked,token) {
    const trees=dedupe(d.trees.concat(infill(rows,'tree',limits.trees,blocked)),12,limits.trees);
    const lamps=dedupe(d.lamps.concat(infill(rows,'lamp',limits.lamps,blocked)),16,limits.lamps);
    const jobs=trees.map(q=>({...q,kind:'tree'})).concat(lamps.map(q=>({...q,kind:'lamp'})));
    const counts={trees:0,lamps:0,osmTrees:0,osmLamps:0,interpolatedTrees:0,interpolatedLamps:0,skippedHeights:0};sampleRecords=[];
    for(let start=0;start<jobs.length;start+=4){if(token!==generation)return;
      const batch=jobs.slice(start,start+4);
      const heights=await Promise.all(batch.map(async q=>{try{return await window.MatsuyamaTerrain.sampleEllipsoidHeight(...q.p);}catch(_){return null;}}));
      batch.forEach((q,i)=>{
        const g=heights[i];if(!Number.isFinite(g)||g< -500||g>3000){counts.skippedHeights++;return;}
        const pos=h=>C.Cartesian3.fromDegrees(q.p[0],q.p[1],g+h),dd=new C.DistanceDisplayCondition(0,q.kind==='tree'?1200:1000);
        if(q.kind==='tree'){
          const h=5.6+(start+i)%4*.25,tr=2.65,rad=1.45+(start+i)%3*.15;
          add(P,{position:pos(tr/2),cylinder:{length:tr,topRadius:.1,bottomRadius:.17,slices:8,numberOfVerticalLines:0,material:colors.trunk,shadows:mobile?C.ShadowMode.DISABLED:C.ShadowMode.ENABLED,distanceDisplayCondition:dd}},q.source,q.osmId);
          add(P,{position:pos(tr+(h-tr)/2),ellipsoid:{radii:new C.Cartesian3(rad,rad*.92,(h-tr)/2),slicePartitions:8,stackPartitions:6,subdivisions:8,material:(start+i)%3?colors.tree:colors.tree2,shadows:mobile?C.ShadowMode.DISABLED:C.ShadowMode.ENABLED,distanceDisplayCondition:dd}},q.source,q.osmId);
          counts.trees++;counts[q.source==='osm'?'osmTrees':'interpolatedTrees']++;
        }else{
          const h=5.7;add(P,{position:pos(h/2),cylinder:{length:h,topRadius:.05,bottomRadius:.08,slices:6,numberOfVerticalLines:0,material:colors.pole,shadows:mobile?C.ShadowMode.DISABLED:C.ShadowMode.ENABLED,distanceDisplayCondition:dd}},q.source,q.osmId);
          add(P,{position:pos(h),ellipsoid:{radii:new C.Cartesian3(.28,.16,.12),slicePartitions:6,stackPartitions:4,material:colors.lamp,distanceDisplayCondition:dd}},q.source,q.osmId);
          counts.lamps++;counts[q.source==='osm'?'osmLamps':'interpolatedLamps']++;
        }
        sampleRecords.push({...q,ground:g});
      });api().render();await yieldFrame();
    }return counts;
  }
  function visible(){if(!api())return;const show=api().isVisible();for(const e of E.concat(P))if(e.show!==show)e.show=show;api().render();}
  async function load(force=false) {
    if(loading)return loading;
    if(!api().canLoadStreets())return;
    const token=++generation;
    loading=(async()=>{const a=api();a.status('Stage 1：道路 → 樹木 → 街灯を段階表示中…');failed=false;
      try{
        const d=await osm(force);if(token!==generation)return;
        clear(E);clear(P);
        const rows=d.roads.slice().sort((x,y)=>priority[x.h]-priority[y.h] || meters(x.p[0],[a.area.lon,a.area.lat])-meters(y.p[0],[a.area.lon,a.area.lat])).slice(0,limits.roads);
        const blocked=buildingIndex(d.buildings),roads=await buildRoads(rows,blocked,token),props=await buildProps(d,rows,blocked,token);
        if(token!==generation)return;loaded=true;details={roads,...props};
        a.status('Stage 1表示中｜道路 '+roads+'本｜樹木 '+props.trees+'・街灯 '+props.lamps+'（景観補間を含む）');visible();
      }catch(e){failed=true;a.status('建物の高精細表示は利用できます。道路・街路景観の取得に失敗しました（'+e.message+'）。',true);}
      finally{loading=null;}
    })();return loading;
  }
  function schedule(){visible();if(loaded || loading || scheduled || failed || !api().canLoadStreets())return;scheduled=true;
    const run=()=>{scheduled=false;if(api().canLoadStreets())load();};
    if(window.requestIdleCallback)requestIdleCallback(run,{timeout:2000});else setTimeout(run,300);
  }
  function start(){const a=api();if(!a){setTimeout(start,80);return;}
    a.state.viewer.creditDisplay.addStaticCredit(new C.Credit('<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'));
    window.addEventListener('matsuyama-proc1-change',schedule);window.addEventListener('matsuyama-proc1-ready',schedule);
    a.reloadOsm=()=>{loaded=false;failed=false;try{localStorage.removeItem(cache);}catch(_){}return load(true);};
    a.streetSamples=()=>sampleRecords.map(q=>({...q,p:q.p.slice()}));
    const old=a.debug;a.debug=()=>({...old(),roadEntities:E.length,streetEntities:P.length,streetLoaded:loaded,streetLoading:!!loading,streetFailed:failed,visibleStreetEntities:E.concat(P).filter(e=>e.show).length,...details});
    schedule();
  }
  start();
})();
