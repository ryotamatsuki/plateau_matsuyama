'use strict';
(function installProceduralStage1() {
  if (!window.Cesium || window.__matsuyamaProc1Core) return;
  window.__matsuyamaProc1Core = true;
  const C = Cesium, $ = id => document.getElementById(id);
  const mobile = matchMedia('(pointer:coarse)').matches || innerWidth <= 700;
  const A = {west:132.7600,south:33.8345,east:132.7712,north:33.8441,lon:132.7656,lat:33.8393};
  const center = C.Cartesian3.fromDegrees(A.lon, A.lat);
  const S = {viewer:null,tileset:null,shader:null,enabled:true,near:false,close:false,ready:false,moving:false,initialTilesMs:null,shaderActive:false};
  let baseline, removeReady;
  const centerEC = new C.Cartesian3();
  function render() { if (S.viewer && !S.viewer.isDestroyed()) S.viewer.scene.requestRender(); }
  function status(text, warn=false) { const e=$('proceduralStage1Status'); if(e){e.textContent=text;e.style.color=warn?'#f4d675':'';} }
  function normal() { return (!$('riskMode') || $('riskMode').value==='normal') && (!$('buildingScenic') || $('buildingScenic').checked); }
  function makeShader() {
    const lo=C.Math.toRadians(A.lon), la=C.Math.toRadians(A.lat);
    const east=new C.Cartesian3(-Math.sin(lo),Math.cos(lo),0);
    const north=new C.Cartesian3(-Math.sin(la)*Math.cos(lo),-Math.sin(la)*Math.sin(lo),Math.cos(la));
    const up=new C.Cartesian3(Math.cos(la)*Math.cos(lo),Math.cos(la)*Math.sin(lo),Math.sin(la));
    return new C.CustomShader({mode:C.CustomShaderMode.MODIFY_MATERIAL,uniforms:{
      u_on:{type:C.UniformType.FLOAT,value:0},
      u_cEC:{type:C.UniformType.VEC3,value:centerEC},u_e:{type:C.UniformType.VEC3,value:east},u_n:{type:C.UniformType.VEC3,value:north},u_u:{type:C.UniformType.VEC3,value:up}
    },fragmentShaderText:`
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        if(u_on<0.5) return;
        // Eye-relative subtraction preserves metre-scale detail; positionWC loses precision at ECEF magnitudes.
        vec3 d=mat3(czm_inverseView)*(fsInput.attributes.positionEC-u_cEC);
        float e=dot(d,u_e), n=dot(d,u_n), z=dot(d,u_u);
        if(abs(e)>525.0 || abs(n)>535.0) return;
        vec3 nw=normalize(mat3(czm_inverseView)*fsInput.attributes.normalEC);
        float vertical=dot(nw,u_u);
        // BATCH_ID is per building in the committed PLATEAU 1.0 b3dm tiles.
        float seed=fract(sin(float(fsInput.featureIds.featureId_0)*1.618+0.47)*437.585);
        if(vertical>0.70) {
          vec3 roof=mix(vec3(0.36,0.38,0.39),vec3(0.42,0.32,0.27),step(0.78,seed));
          float seam=smoothstep(0.02,0.06,abs(fract((e+n)*0.32+seed)-0.5));
          material.diffuse=mix(material.diffuse,roof*mix(0.91,1.02,seam),0.56);
          material.roughness=max(material.roughness,0.78);
        } else if(abs(vertical)<0.38) {
          vec3 tangent=normalize(cross(u_u,nw));
          float bay=fract((dot(d,tangent)+seed*5.0)/mix(2.7,3.15,seed));
          float row=fract((z+seed*3.1)/3.1);
          float windowMask=smoothstep(0.27,0.30,bay)*(1.0-smoothstep(0.70,0.73,bay))
                         *smoothstep(0.25,0.28,row)*(1.0-smoothstep(0.66,0.69,row));
          vec3 wall=mix(vec3(0.72,0.68,0.61),vec3(0.65,0.69,0.72),seed);
          material.diffuse=mix(material.diffuse,wall,0.28);
          vec3 glass=mix(vec3(0.16,0.22,0.26),vec3(0.25,0.31,0.34),seed);
          material.diffuse=mix(material.diffuse,glass,windowMask*0.68);
          material.roughness=mix(max(material.roughness,0.74),0.32,windowMask*0.65);
        }
      }`});
  }
  function syncShader() {
    if(!S.tileset || !S.ready) return;
    const on=S.enabled && S.near && S.viewer.camera.positionCartographic.height<900 && normal();
    if(on && !S.shader) S.shader=makeShader();
    // Changing tileset.customShader rebuilds every loaded model pipeline. Keep the compiled
    // shader while disabling its material edits immediately for hazard colors and OFF.
    if(S.shader){
      if(S.tileset.customShader!==S.shader)S.tileset.customShader=S.shader;
      S.shader.setUniform('u_on',on?1:0);
    }
    S.shaderActive=on && !!S.shader;
    render();
  }
  function effects() {
    if(!baseline) return;
    // Shadows at the overview scale expand tile selection well beyond the Stage 1 area.
    const on=S.ready && S.enabled && S.close && !S.moving && normal() && !mobile;
    const scene=S.viewer.scene, ao=scene.postProcessStages.ambientOcclusion;
    S.viewer.shadows=on || baseline.shadows;
    if(on){scene.shadowMap.maximumDistance=300;scene.shadowMap.size=1024;}
    else{scene.shadowMap.maximumDistance=baseline.shadowDistance;scene.shadowMap.size=baseline.shadowSize;}
    const supported=C.PostProcessStageLibrary.isAmbientOcclusionSupported(scene);
    ao.enabled=on && supported ? true : baseline.ao;
    if(on && supported){ao.uniforms.intensity=1.15;ao.uniforms.bias=0.15;ao.uniforms.lengthCap=0.32;ao.uniforms.stepCount=4;ao.uniforms.directionCount=4;}
    else Object.assign(ao.uniforms,baseline.aoUniforms);
  }
  function gate() {
    S.near=C.Cartesian3.distance(S.viewer.camera.positionWC,center)<3600;
    S.close=S.near && S.viewer.camera.positionCartographic.height<300;
    syncShader();effects();
    window.dispatchEvent(new CustomEvent('matsuyama-proc1-change'));
    render();
  }
  function enable(on) {
    S.enabled=!!on;
    if($('proceduralStage1')) $('proceduralStage1').checked=S.enabled;
    gate();
    if(!on) status('Stage 1 高精細表示はオフです。');
    else if(!S.ready) status('Stage 1：地形・建物の初期表示を待っています。');
    else status('Stage 1：外壁・窓・屋根を表示。近景で道路・街路景観を読み込みます。');
  }
  function attach() {
    if(S.viewer.isDestroyed()) return;
    const primitives=S.viewer.scene.primitives;
    for(let i=0;i<primitives.length;i++){
      const t=primitives.get(i);
      if(!(t instanceof C.Cesium3DTileset)) continue;
      S.tileset=t;
      const ready=()=>{if(S.ready)return;S.ready=true;S.initialTilesMs=performance.now();if(removeReady)removeReady();enable(S.enabled);window.dispatchEvent(new CustomEvent('matsuyama-proc1-ready'));};
      removeReady=t.initialTilesLoaded.addEventListener(ready);
      if(/PLATEAU 2020年度 LOD1|建物表示中/.test($('buildingStatus')?.textContent || '')) ready();
      return;
    }
    setTimeout(attach,150);
  }
  function init(v) {
    S.viewer=v;S.enabled=$('proceduralStage1')?.checked!==false;
    const scene=v.scene, ao=scene.postProcessStages.ambientOcclusion;
    baseline={shadows:!!v.shadows,shadowDistance:scene.shadowMap.maximumDistance,shadowSize:scene.shadowMap.size,ao:!!ao.enabled,aoUniforms:{intensity:ao.uniforms.intensity,bias:ao.uniforms.bias,lengthCap:ao.uniforms.lengthCap,stepCount:ao.uniforms.stepCount,directionCount:ao.uniforms.directionCount}};
    $('proceduralStage1')?.addEventListener('change',e=>enable(e.target.checked));
    ['riskMode','buildingScenic'].forEach(id=>$(id)?.addEventListener('change',gate));
    v.camera.moveStart.addEventListener(()=>{S.moving=true;effects();});
    v.camera.moveEnd.addEventListener(()=>{S.moving=false;gate();});
    window.addEventListener('matsuyama-navigation-motion',e=>{S.moving=!!e.detail?.moving;effects();if(!S.moving)gate();});
    scene.preRender.addEventListener(()=>{if(S.shader){C.Matrix4.multiplyByPoint(v.camera.viewMatrix,center,centerEC);S.shader.setUniform('u_cEC',centerEC);}});
    window.MatsuyamaProceduralStage1={area:A,state:S,setEnabled:enable,status,render,
      isVisible:()=>S.enabled && S.near && normal(),
      canLoadStreets:()=>S.ready && S.enabled && S.near && !S.moving && normal() && v.camera.positionCartographic.height<900 && !!window.MatsuyamaTerrain?.sampleEllipsoidHeight,
      debug:()=>({enabled:S.enabled,near:S.near,close:S.close,ready:S.ready,initialTilesMs:S.initialTilesMs,mobile,shader:S.shaderActive,shaderAttached:!!(S.shader && S.tileset?.customShader===S.shader),shaderUniform:S.shaderActive?1:0,ao:!!ao.enabled,shadows:!!v.shadows})};
    gate();attach();enable(S.enabled);
  }
  (function wait(){const v=window.__matsuyamaViewer;if(v&&!v.isDestroyed())init(v);else setTimeout(wait,80);})();
})();
