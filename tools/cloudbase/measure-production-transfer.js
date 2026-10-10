#!/usr/bin/env node
"use strict";
const https=require("https"),zlib=require("zlib"),fs=require("fs"),path=require("path");
const bases={cloudbase:require("../../miniprogram/config/cloudbase").CLOUDBASE_HOSTING_BASE_URL,oracle:require("../../miniprogram/config/api").ORACLE_API_BASE_URL};
function get(url){
  if(!Object.values(bases).includes(new URL(url).origin))return Promise.reject(Error("MEASUREMENT_ORIGIN_REJECTED"));
  const start=performance.now();
  return new Promise((resolve,reject)=>{const req=https.get(url,{headers:{"accept-encoding":"gzip, deflate, br","user-agent":"FosuPublicTransferMeasurement/1"},timeout:15000},res=>{
    const chunks=[];let bytes=0;res.on("data",c=>{bytes+=c.length;if(bytes>32*1024*1024)req.destroy(Error("MEASUREMENT_BODY_LIMIT"));else chunks.push(c);});res.on("error",reject);
    res.on("end",()=>{try{const raw=Buffer.concat(chunks),encoding=res.headers["content-encoding"]||"identity";let data=raw;if(encoding==="gzip")data=zlib.gunzipSync(raw);else if(encoding==="br")data=zlib.brotliDecompressSync(raw);else if(encoding==="deflate")data=zlib.inflateSync(raw);
      const record={path:new URL(url).pathname,status:res.statusCode,httpBodyBytes:bytes,decodedBytes:data.length,contentEncoding:encoding,cacheControl:res.headers["cache-control"]||"",cacheStatus:res.headers["x-cache"]||res.headers["x-cache-status"]||"UNKNOWN",elapsedMs:Math.round(performance.now()-start)};
      if(res.statusCode!==200)throw Object.assign(Error("MEASUREMENT_HTTP_"+res.statusCode),{record});resolve({record,json:JSON.parse(data.toString("utf8"))});
    }catch(e){reject(e);}});
  });req.on("timeout",()=>req.destroy(Error("MEASUREMENT_TIMEOUT")));req.on("error",reject);});
}
async function measure(source){
  const base=bases[source],prefix=source==="oracle"?"/static":"",records=[],errors=[];
  async function read(relative){try{const result=await get(base+prefix+"/"+relative);records.push(result.record);return result.json;}catch(e){errors.push({path:relative,code:e.message,record:e.record});return null;}}
  const pointer=await read("runtime/active.json?measurement="+Date.now());
  const version=pointer&&pointer.releaseVersion;
  if(!/^[A-Za-z0-9_.-]+$/.test(version||""))return {source,errors};
  const manifest=await read("releases/"+version+"/manifest.json");
  for(const kind of ["class","teacher","classroom","course"]){
    const index=await read("releases/"+version+"/index/"+kind+"/all.json");
    const files=Object.keys(manifest&&manifest.files||{}).filter(p=>p.startsWith("detail/"+kind+"/")&&p.endsWith(".json")&&!p.includes(".."));
    if(files[0])await read("releases/"+version+"/"+files[0]);
  }
  return {source,releaseVersion:version,measuredAt:new Date().toISOString(),records,errors,totalHttpBodyBytes:records.reduce((a,r)=>a+r.httpBodyBytes,0),measurementBoundary:"Actual encoded HTTP response body bytes; excludes TLS/TCP/header overhead and is not a China phone/CDN percentile benchmark"};
}
if(require.main===module)(async()=>{const reports=[];for(const source of Object.keys(bases))reports.push(await measure(source));const output=path.resolve(".local/cloudbase-transfer-measurement.json");fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));})().catch(()=>{console.error("PUBLIC_TRANSFER_MEASUREMENT_FAILED");process.exitCode=1;});
module.exports={get,measure};
