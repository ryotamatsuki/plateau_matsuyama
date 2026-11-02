import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const base='https://cdn.jsdelivr.net/npm/cesium@1.130.0/Build/Cesium/';
const files=['Cesium.js','Widgets/widgets.css','Workers/createTaskProcessorWorker.js','Assets/approximateTerrainHeights.json'];
const rows=[];
for(const pathname of files){
  const url=base+pathname;
  try{
    const res=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(45000)});
    if(!res.ok)throw Error('HTTP '+res.status);
    const bytes=Buffer.from(await res.arrayBuffer());
    rows.push({path:pathname,ok:true,bytes:bytes.length,sha384:'sha384-'+crypto.createHash('sha384').update(bytes).digest('base64'),cors:res.headers.get('access-control-allow-origin'),type:res.headers.get('content-type')});
  }catch(e){rows.push({path:pathname,ok:false,error:String(e)})}
}
await fs.mkdir('security-reports',{recursive:true});
await fs.writeFile('security-reports/cesium-cdn-probe.json',JSON.stringify({base,files:rows},null,2)+'\n');
console.log(JSON.stringify({base,files:rows},null,2));
if(rows.some(x=>!x.ok || !['*','https://ryotamatsuki.github.io'].includes(x.cors)))process.exitCode=1;
