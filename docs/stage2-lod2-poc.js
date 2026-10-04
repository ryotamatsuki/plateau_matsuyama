'use strict';
(function(global){
  const C=global.Cesium;
  const MANIFEST_URL='stage2-lod2-poc-manifest.json';
  const ID_CANDIDATES=['gml_id','gml:id','gmlId','id'];
  const ACTIVE_HEIGHT=1400;
  let viewer=null, manifest=null, tileset=null, enabled=false, loading=false, failed=false;
  let selected=new Set(), seenSelected=new Set(), propertyIds=new Set(), lastError=null;
  let previousOpacity=null, comparisonActive=false, filterPasses=0, textureRequests=0;

  const $=(id)=>document.getElementById(id);
  const status=(text)=>{const el=$('stage2Lod2PocStatus');if(el)el.textContent=text;};
  const requestRender=()=>{try{viewer?.scene?.requestRender();}catch(_){}};

  function featureId(feature){
    if(!feature)return null;
    for(const key of ID_CANDIDATES){
      try{
        if(feature.hasProperty?.(key)){
          const value=feature.getProperty(key);
          if(value!==undefined&&value!==null&&String(value)!=='')return String(value);
        }
      }catch(_){}
    }
    try{
      const ids=feature.getPropertyIds?.()||[];
      ids.forEach((x)=>propertyIds.add(String(x)));
      for(const key of ids){
        if(!/gml.*id|^id$/i.test(String(key)))continue;
        const value=feature.getProperty(key);
        if(value!==undefined&&value!==null&&String(value)!=='')return String(value);
      }
    }catch(_){}
    return null;
  }

  function visitContent(content,fn){
    if(!content)return;
    const inner=content.innerContents;
    if(Array.isArray(inner)){inner.forEach((x)=>visitContent(x,fn));return;}
    const n=Number(content.featuresLength||0);
    for(let i=0;i<n;i++){
      try{fn(content.getFeature(i));}catch(_){}
    }
  }

  function filterTile(tile){
    if(!tile?.content)return;
    visitContent(tile.content,(feature)=>{
      try{
        const ids=feature.getPropertyIds?.()||[];
        ids.forEach((x)=>propertyIds.add(String(x)));
      }catch(_){}
      const id=featureId(feature);
      const keep=!!id&&selected.has(id);
      feature.show=keep;
      if(keep){seenSelected.add(id);filterPasses++;}
    });
  }

  function riskIsNormal(){return ($('riskMode')?.value||'normal')==='normal';}
  function baseBuildingsVisible(){return $('buildings')?.checked!==false;}
  function cameraNear(){
    if(!viewer||!manifest)return false;
    const h=Number(viewer.camera?.positionCartographic?.height||Infinity);
    const c=manifest.center;
    const here=viewer.camera.positionCartographic;
    if(!here)return false;
    const lon=C.Math.toDegrees(here.longitude),lat=C.Math.toDegrees(here.latitude);
    const dx=(lon-c.lon)*Math.cos(c.lat*Math.PI/180)*111320,dy=(lat-c.lat)*110540;
    return Math.hypot(dx,dy)<2600&&h<ACTIVE_HEIGHT;
  }

  function setComparison(on){
    const slider=$('buildingOpacity'),value=$('buildingValue');
    if(!slider)return;
    if(on&&!comparisonActive){
      previousOpacity=slider.value;
      slider.value='32';
      if(value)value.textContent='32%';
      slider.dispatchEvent(new Event('input',{bubbles:true}));
      comparisonActive=true;
    }else if(!on&&comparisonActive){
      if(previousOpacity!==null)slider.value=previousOpacity;
      if(value)value.textContent=`${slider.value}%`;
      slider.dispatchEvent(new Event('input',{bubbles:true}));
      comparisonActive=false;
      previousOpacity=null;
    }
  }

  function shouldShow(){return enabled&&!!tileset&&riskIsNormal()&&baseBuildingsVisible()&&cameraNear();}

  function updateVisibility(){
    const show=shouldShow();
    if(tileset)tileset.show=show;
    setComparison(show);
    if(!enabled){
      status('Stage 2.2 POCはOFFです。');
    }else if(failed){
      status('LOD2実データを読み込めません。既存LOD1表示を継続しています。');
    }else if(loading){
      status('PLATEAU公式LOD2＋実テクスチャを読み込み中…');
    }else if(!riskIsNormal()){
      status('建物リスク表示中はLOD2比較を一時停止します。');
    }else if(!cameraNear()){
      status('県庁周辺へ近づくとLOD2 POCを表示します。');
    }else if(tileset){
      status(`LOD2 POC表示中｜対象 ${manifest?.buildingCount||36}棟｜現在確認済み ${seenSelected.size}棟｜LOD1は比較用32%`);
    }
    requestRender();
  }

  async function load(){
    if(tileset||loading)return;
    loading=true;failed=false;lastError=null;updateVisibility();
    try{
      const response=await fetch(MANIFEST_URL,{cache:'no-cache'});
      if(!response.ok)throw new Error(`manifest ${response.status}`);
      manifest=await response.json();
      selected=new Set((manifest.selected||[]).map((x)=>String(x.gml_id)));
      if(selected.size!==Number(manifest.buildingCount))throw new Error('POC manifest count mismatch');
      const url=manifest.source.tilesetUrl;
      const t=await C.Cesium3DTileset.fromUrl(url,{
        maximumScreenSpaceError:8,
        cacheBytes:96*1024*1024,
        maximumCacheOverflowBytes:64*1024*1024,
        dynamicScreenSpaceError:true,
        preloadWhenHidden:false,
      });
      tileset=viewer.scene.primitives.add(t);
      tileset.show=false;
      tileset.tileVisible.addEventListener(filterTile);
      tileset.tileLoad.addEventListener((tile)=>{filterTile(tile);});
      const oldFetch=global.fetch;
      if(!global.__stage2TextureProbeInstalled){
        global.__stage2TextureProbeInstalled=true;
        global.addEventListener('stage2-lod2-texture-request',()=>{textureRequests++;});
      }
      loading=false;updateVisibility();
    }catch(error){
      loading=false;failed=true;lastError=String(error?.message||error);setComparison(false);updateVisibility();
      console.error('Stage 2.2 LOD2 POC failed',error);
    }
  }

  async function setEnabled(value){
    enabled=!!value;
    if(enabled&&!tileset&&!failed)await load();
    updateVisibility();
  }

  function scanResource(url){
    if(!url)return;
    if(/plateau.*\.(?:jpe?g|png)(?:\?|$)/i.test(String(url))||/_appearance\//i.test(String(url)))textureRequests++;
  }

  async function init(){
    if(!C)return;
    for(let i=0;i<160;i++){
      viewer=global.__matsuyamaViewer;
      if(viewer&&!viewer.isDestroyed())break;
      await new Promise((r)=>setTimeout(r,100));
    }
    if(!viewer)return;
    try{
      const r=await fetch(MANIFEST_URL,{cache:'no-cache'});
      if(r.ok){manifest=await r.json();selected=new Set((manifest.selected||[]).map((x)=>String(x.gml_id)));}
    }catch(_){}
    const checkbox=$('stage2Lod2Poc');
    if(checkbox){
      checkbox.checked=false;
      checkbox.addEventListener('change',()=>setEnabled(checkbox.checked));
    }
    $('riskMode')?.addEventListener('change',updateVisibility);
    $('buildings')?.addEventListener('change',updateVisibility);
    viewer.camera.moveEnd.addEventListener(updateVisibility);
    viewer.scene.globe.tileLoadProgressEvent.addEventListener(()=>{if(enabled)updateVisibility();});
    const oldResourceFetch=C.Resource.prototype.fetchImage;
    if(oldResourceFetch&&!C.Resource.prototype.__stage2Wrapped){
      C.Resource.prototype.__stage2Wrapped=true;
      C.Resource.prototype.fetchImage=function(...args){scanResource(this.url);return oldResourceFetch.apply(this,args);};
    }
    status('Stage 2.2 POCはOFFです。');
  }

  global.MatsuyamaStage2Lod2Poc={
    setEnabled,
    flyToPilot(){
      if(!viewer||!manifest)return;
      const center=C.Cartesian3.fromDegrees(manifest.center.lon,manifest.center.lat,30);
      viewer.camera.flyToBoundingSphere(
        new C.BoundingSphere(center,180),
        {offset:new C.HeadingPitchRange(C.Math.toRadians(12),C.Math.toRadians(-32),520),duration:1.0}
      );
    },
    debug(){
      return{
        enabled,loading,failed,lastError,
        loaded:!!tileset,show:!!tileset?.show,
        selectedCount:selected.size,seenSelected:seenSelected.size,
        seenIds:[...seenSelected].sort(),
        propertyIds:[...propertyIds].sort(),
        filterPasses,textureRequests,
        comparisonActive,
        tilesLoaded:tileset?.tilesLoaded||false,
        url:manifest?.source?.tilesetUrl||null,
      };
    }
  };
  init();
})(window);
