'use strict';
(function(){
  if(!window.Cesium||window.__matsuyamaProc1Core)return;
  window.__matsuyamaProc1Core=true;
  var C=Cesium,$=function(id){return document.getElementById(id);};
  var mobile=matchMedia('(pointer:coarse)').matches||innerWidth<=700;
  var A={west:132.7600,south:33.8345,east:132.7712,north:33.8441,lon:132.7656,lat:33.8393};
  var S={viewer:null,tileset:null,shader:null,enabled:true,near:true,ao:null,shadows:null};
  function render(){if(S.viewer&&!S.viewer.isDestroyed())S.viewer.scene.requestRender();}
  function status(text,warn){var e=$('proceduralStage1Status');if(e){e.textContent=text;e.style.color=warn?'#f4d675':'';}}
  function ensureUi(){
    if($('proceduralStage1'))return;
    var scenic=$('buildingScenic'),sec=scenic&&scenic.closest('section');if(!sec)return;
    var label=document.createElement('label');label.className='check';label.innerHTML='<input id="proceduralStage1" type="checkbox" checked>中心市街地 高精細表示（Stage 1）';
    var p=document.createElement('p');p.id='proceduralStage1Status';p.className='small';p.textContent='県庁〜大街道〜松山城南側の約1 km四方を高精細化します。';
    var note=document.createElement('p');note.className='small';note.textContent='外壁・窓・屋根はPLATEAU LOD1への景観補間。道路・歩道・樹木・街灯はOpenStreetMapを基礎にし、不足箇所は景観補間します。現況調査値ではありません。';
    var anchor=$('buildingScenicStatus');if(anchor&&anchor.parentNode===sec){anchor.after(label);label.after(p);p.after(note);}else sec.append(label,p,note);
  }
  function findTileset(){if(S.tileset)return S.tileset;var p=S.viewer.scene.primitives;for(var i=0;i<p.length;i++){var x=p.get(i);if(x instanceof C.Cesium3DTileset){S.tileset=x;return x;}}return null;}
  function makeShader(){
    if(!C.CustomShader)return null;
    var lo=C.Math.toRadians(A.lon),la=C.Math.toRadians(A.lat),ctr=C.Cartesian3.fromDegrees(A.lon,A.lat);
    var east=new C.Cartesian3(-Math.sin(lo),Math.cos(lo),0);
    var north=new C.Cartesian3(-Math.sin(la)*Math.cos(lo),-Math.sin(la)*Math.sin(lo),Math.cos(la));
    var up=C.Cartesian3.normalize(ctr,new C.Cartesian3());
    var fragment='void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material){'+
      'if(u_on<.5)return;vec3 d=fsInput.attributes.positionWC-u_c;float e=dot(d,u_e),n=dot(d,u_n),z=dot(d,u_u);'+
      'if(abs(e)>525.||abs(n)>535.)return;vec3 nw=normalize(mat3(czm_inverseView)*fsInput.attributes.normalEC);float U=abs(dot(nw,u_u));'+
      'float s=fract(sin(dot(floor(vec2(e,n)*.08),vec2(12.9898,78.233)))*43758.5453);'+
      'if(U>.70){vec3 r=mix(vec3(.22,.24,.25),vec3(.31,.24,.20),step(.72,s));float q=smoothstep(.03,.08,abs(fract((e+n)*.11)-.5));'+
      'material.diffuse=mix(material.diffuse,r*mix(.88,1.02,q),.52);material.roughness=max(material.roughness,.76);return;}'+
      'if(U<.38){float h=abs(dot(nw,u_e))>abs(dot(nw,u_n))?n:e;float b=fract((h+s*.8)/3.15),row=fract((z+s*1.7+.35)/3.05);'+
      'float w=step(.16,b)*step(b,.84)*step(.20,row)*step(row,.76);vec3 facade=mix(vec3(.57,.53,.47),vec3(.49,.52,.54),step(.48,s));'+
      'material.diffuse=mix(material.diffuse,facade,.22);vec3 glass=mix(vec3(.035,.055,.075),vec3(.08,.11,.13),s);material.diffuse=mix(material.diffuse,glass,w*.78);'+
      'material.roughness=mix(max(material.roughness,.72),.24,w*.72);}}';
    return new C.CustomShader({mode:C.CustomShaderMode.MODIFY_MATERIAL,lightingModel:C.LightingModel.PBR,uniforms:{
      u_on:{type:C.UniformType.FLOAT,value:1},u_c:{type:C.UniformType.VEC3,value:ctr},u_e:{type:C.UniformType.VEC3,value:east},u_n:{type:C.UniformType.VEC3,value:north},u_u:{type:C.UniformType.VEC3,value:up}
    },fragmentShaderText:fragment});
  }
  function shaderOn(){var risk=$('riskMode'),scenic=$('buildingScenic');return S.enabled&&(!risk||risk.value==='normal')&&(!scenic||scenic.checked);}
  function syncShader(){var t=findTileset();if(!t)return false;if(!S.shader)S.shader=makeShader();if(!S.shader)return false;t.customShader=S.shader;S.shader.setUniform('u_on',shaderOn()?1:0);render();return true;}
  function effects(){
    if(S.shadows===null)S.shadows=!!S.viewer.shadows;S.viewer.shadows=S.enabled&&!mobile&&S.near?true:S.shadows;
    var ao=S.viewer.scene.postProcessStages&&S.viewer.scene.postProcessStages.ambientOcclusion;if(!ao)return;if(S.ao===null)S.ao=!!ao.enabled;
    var supported=true;try{supported=!C.PostProcessStageLibrary.isAmbientOcclusionSupported||C.PostProcessStageLibrary.isAmbientOcclusionSupported(S.viewer.scene);}catch(_){ }
    var on=S.enabled&&!mobile&&S.near&&supported;ao.enabled=on?true:S.ao;if(on&&ao.uniforms){if('intensity'in ao.uniforms)ao.uniforms.intensity=1.6;if('bias'in ao.uniforms)ao.uniforms.bias=.12;if('lengthCap'in ao.uniforms)ao.uniforms.lengthCap=.42;if('stepSize'in ao.uniforms)ao.uniforms.stepSize=1.6;if('frustumLength'in ao.uniforms)ao.uniforms.frustumLength=1100;}
  }
  function gate(){var c=C.Cartesian3.fromDegrees(A.lon,A.lat);S.near=C.Cartesian3.distance(S.viewer.camera.positionWC,c)<3600;effects();window.dispatchEvent(new CustomEvent('matsuyama-proc1-change'));render();}
  function enable(on){S.enabled=!!on;syncShader();gate();status(on?'Stage 1：建物高精細化を有効化。道路・街路景観を準備中…':'Stage 1 高精細表示はオフです。');}
  function init(v){
    S.viewer=v;ensureUi();$('proceduralStage1').addEventListener('change',function(e){enable(e.target.checked);});
    ['riskMode','buildingScenic'].forEach(function(id){var e=$(id);if(e)e.addEventListener('change',function(){setTimeout(syncShader,0);});});
    v.camera.moveEnd.addEventListener(gate);var attach=function(){if(!syncShader())setTimeout(attach,300);};attach();gate();
    var api={area:A,state:S,setEnabled:enable,status:status,render:render,isVisible:function(){return S.enabled&&S.near;},debug:function(){return{enabled:S.enabled,near:S.near,shader:!!(S.tileset&&S.tileset.customShader===S.shader),ao:!!(S.viewer.scene.postProcessStages.ambientOcclusion&&S.viewer.scene.postProcessStages.ambientOcclusion.enabled),shadows:!!S.viewer.shadows};}};
    window.MatsuyamaProceduralStage1=api;
  }
  (function wait(){var v=window.__matsuyamaViewer;if(v&&!v.isDestroyed())init(v);else setTimeout(wait,80);})();
})();
