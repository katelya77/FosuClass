"use strict";
const assert = require("assert/strict"), fs = require("fs"), os = require("os"), path = require("path"), https = require("https"), net = require("net"), crypto = require("crypto"), { execFileSync } = require("child_process");
const transport = require("./wyz-schedule-collector/oracleTransport"), collector = require("./wyz-schedule-collector/collector"), recovery = require("./wyz-schedule-collector/heartbeatRecovery"), signature = require("../server/src/security/fullSyncSignature");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-tls-fixture-")); fs.chmodSync(root, 0o700);
const policy = { schema: 1, mode: "oracle-direct", originIpv4: transport.ORIGIN_IPV4 };
const env = { FULL_SYNC_AGENT_ID: "wyz-schedule-collector", FULL_SYNC_AGENT_TOKEN: crypto.randomBytes(32).toString("hex"), FULL_SYNC_SIGNING_SECRET: crypto.randomBytes(32).toString("hex"), FOSU_COLLECTOR_DATA_DIR: root };
Object.assign(process.env, env); const cfg = collector.config(env); let cases = 0;
async function check(name, task) { await task(); cases++; console.log("PASS " + name); }
async function main() {
  await check("default transport preserves previous Cloudflare path", () => assert.deepEqual(transport.load(root), transport.DEFAULT));
  await check("policy refuses arbitrary IP, IPv6, CA override, credentials and unknown fields", () => {
    for (const item of [{ ...policy, originIpv4: "127.0.0.1" }, { ...policy, originIpv4: "::1" }, { ...policy, mode: "unknown" }, { ...policy, rejectUnauthorized: false }, { ...policy, ca: "fixture" }, { ...policy, token: "fixture" }, { schema: 1, mode: "cloudflare-default", originIpv4: transport.ORIGIN_IPV4 }]) assert.throws(() => transport.validate(item), /TRANSPORT_REJECTED/);
  });
  await check("root-only policy validation and explicit old-path rollback", () => {
    const file = path.join(root, "oracle-transport.json"); fs.writeFileSync(file, JSON.stringify(policy), { mode: 0o600 }); assert.deepEqual(transport.load(root), policy);
    fs.writeFileSync(file, JSON.stringify(transport.DEFAULT)); assert.deepEqual(transport.load(root), transport.DEFAULT);
    fs.writeFileSync(file, "not-json"); assert.throws(() => transport.load(root), /TRANSPORT_REJECTED/); fs.unlinkSync(file);
  });
  if (process.platform !== "win32") await check("unsafe permissions and symlink rejected", () => {
    const file = path.join(root, "oracle-transport.json"), other = path.join(root, "outside.json"); fs.writeFileSync(file, JSON.stringify(policy), { mode: 0o644 }); assert.throws(() => transport.load(root), /TRANSPORT_REJECTED/); fs.unlinkSync(file);
    fs.writeFileSync(other, JSON.stringify(policy), { mode: 0o600 }); fs.symlinkSync(other, file); assert.throws(() => transport.load(root), /TRANSPORT_REJECTED/); fs.unlinkSync(file);
  }); else console.log("SKIP root ownership/symlink on Windows; required in Linux CI");
  await check("lookup pins only approved origin, Host/SNI/TLS identity remains domain", async () => {
    const options = transport.connectionOptions(policy); assert.equal(options.servername, transport.HOST); assert.equal(options.rejectUnauthorized, true); assert.equal(options.family, 4); assert.equal(options.maxSockets, 1);
    await new Promise((resolve, reject) => options.lookup(transport.HOST, {}, (error, ip, family) => { if (error) return reject(error); assert.equal(ip, transport.ORIGIN_IPV4); assert.equal(family, 4); resolve(); }));
    await new Promise(resolve => options.lookup("example.org", {}, error => { assert.equal(error.code, "COLLECTOR_TRANSPORT_REJECTED"); resolve(); }));
  });
  await check("Cloudflare IPv4 mode changes only its private lookup", async () => {
    const dns = require("dns"), old = dns.lookup; let calls = 0;
    dns.lookup = (host, opts, callback) => { calls++; assert.equal(host, transport.HOST); assert.equal(opts.family, 4); callback(null, "104.21.76.75", 4); };
    try { await new Promise((resolve, reject) => transport.connectionOptions({ schema: 1, mode: "cloudflare-ipv4" }).lookup(transport.HOST, {}, error => error ? reject(error) : resolve())); assert.equal(calls, 1); }
    finally { dns.lookup = old; }
  });
  const openssl = process.platform === "win32" ? path.resolve(execFileSync("where.exe", ["git"], { encoding: "utf8" }).split(/\r?\n/)[0], "../../usr/bin/openssl.exe") : "openssl";
  const ssl = args => execFileSync(openssl, args, { cwd: root, stdio: "ignore" });
  ssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1", "-subj", "/CN=Collector Fixture CA", "-addext", "basicConstraints=critical,CA:TRUE", "-keyout", "ca-key.pem", "-out", "ca.pem"]);
  function leaf(name, domain) {
    ssl(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=" + domain, "-keyout", name+"-key.pem", "-out", name+".csr"]);
    fs.writeFileSync(path.join(root, name+".ext"), "subjectAltName=DNS:"+domain+"\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n");
    ssl(["x509", "-req", "-in", name+".csr", "-CA", "ca.pem", "-CAkey", "ca-key.pem", "-CAcreateserial", "-days", "1", "-sha256", "-extfile", name+".ext", "-out", name+".pem"]);
    return { key: fs.readFileSync(path.join(root,name+"-key.pem")), cert: fs.readFileSync(path.join(root,name+".pem")) };
  }
  const good = leaf("good", transport.HOST), wrong = leaf("wrong", "wrong.example.org"), ca = fs.readFileSync(path.join(root,"ca.pem"));
  let mode = "ok", received = 0, connections = 0; const nonces = [], traces = [];
  const server = https.createServer(good, (req,res) => {
    const chunks = []; req.on("data", chunk => chunks.push(chunk)); req.on("end", () => {
      received++; assert.equal(req.socket.servername, transport.HOST); assert.equal(req.headers.host, transport.HOST); assert.equal(req.headers["accept-encoding"], "identity");
      if (req.url===recovery.HEARTBEAT) { assert.equal(signature.verifySignedRequest({ method: req.method, originalUrl: req.url, headers: req.headers, rawBody: Buffer.concat(chunks) }).ok, true); nonces.push(req.headers["x-full-sync-nonce"]); }
      if (mode==="reset") { mode="ok"; return req.socket.destroy(); }
      if (mode==="slow-upload" && req.url!==recovery.HEARTBEAT) return setTimeout(()=>{res.setHeader("content-type","application/json");res.end('{"ok":true}');},150);
      if (mode==="503-once") {mode="ok";res.statusCode=503;res.end('{}');return;}
      res.statusCode = Number(mode) || 200; res.setHeader("content-type", "application/json"); if(mode==="redirect"){res.statusCode=307;res.setHeader("Location","https://example.org");} res.end('{"ok":true}');
    });
  }); server.on("secureConnection", () => connections++); server.on("tlsClientError",()=>{});
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const agents = [];
  function fetcher(target = server, trust = true, timeout) {
    const pools=new Map();
    return transport.createFetcher(policy, { connectTimeoutMs:timeout, onConnection: t=>traces.push(t), request: (url,opts,cb) => {
      if(!pools.has(opts.agent)){const agent=new https.Agent({keepAlive:true,maxSockets:1,...(trust?{ca}:{}),lookup:(_,hint,done)=>hint.all?done(null,[{address:"127.0.0.1",family:4}]):done(null,"127.0.0.1",4)});pools.set(opts.agent,agent);agents.push(agent);}
      return https.request(url,{...opts,port:target.address().port,agent:pools.get(opts.agent)},cb);
    } });
  }
  const native = fetcher(), api = collector.client(cfg,native);
  try {
    await check("real TLS, Host, SNI, fresh HMAC and connection reuse", async () => {
      await api("POST",recovery.HEARTBEAT,{}); await api("POST",recovery.HEARTBEAT,{});
      assert.equal(connections,1); assert.equal(new Set(nonces).size,2); assert.equal(traces.at(-1).reusedSocket,true); assert.equal(traces.at(-1).tlsAuthorized,true);
    });
    await check("reset recovers without route switching or credential exposure", async () => {
      mode="reset"; const hb=recovery.createHeartbeat(api,{delays:[1]}); await hb(); assert.equal(hb.state.consecutiveFailures,0); assert.ok(!JSON.stringify(traces).includes(env.FULL_SYNC_AGENT_TOKEN));
    });
    await check("heartbeats never queue behind a slow data operation",async()=>{mode="slow-upload";let finished=false;const uploading=api("POST","/api/full-sync/v1/runs/sc-fixture/upload/finalize",{}).then(()=>{finished=true;});await new Promise(r=>setTimeout(r,20));await api("POST",recovery.HEARTBEAT,{});assert.equal(finished,false);await uploading;});
    await check("native HTTP 503 heartbeat recovery re-signs",async()=>{mode="503-once";const before=received;await recovery.createHeartbeat(api,{delays:[1]})();assert.equal(received,before+2);});
    for (const status of [401,403]) await check("HTTP "+status+" is fatal, no heartbeat retry", async () => { mode=String(status); const before=received; await assert.rejects(recovery.createHeartbeat(api,{sleep:()=>assert.fail("auth retry")})(), e=>e.errorCategory==="authentication"); assert.equal(received,before+1); });
    await check("redirect rejected without forwarding credentials", async () => { mode="redirect"; await assert.rejects(api("POST",recovery.HEARTBEAT,{}),/ORACLE_HTTP_307/); });
    await check("wrong origin, query and API scope are rejected before connection", async () => { const before=received; for(const url of ["https://example.org/api/health",transport.ORIGIN+"/api/health?secret=fixture",transport.ORIGIN+"/admin"]) await assert.rejects(native(url,{redirect:"error"}),/TRANSPORT_REJECTED/); assert.equal(received,before); });
    await check("untrusted certificate is rejected with zero HTTP requests", async () => { const before=received, untrusted=fetcher(server,false); try { await assert.rejects(collector.client(cfg,untrusted)("POST",recovery.HEARTBEAT,{}),e=>e.code==="ORACLE_TLS_FAILED"); } finally {untrusted.close();} assert.equal(received,before); });
    const badServer=https.createServer(wrong,(_,res)=>{assert.fail("wrong-host TLS reached HTTP");res.end();}); badServer.on("tlsClientError",()=>{}); await new Promise(resolve=>badServer.listen(0,"127.0.0.1",resolve));
    await check("trusted CA with wrong hostname is rejected", async () => {const f=fetcher(badServer);try{await assert.rejects(collector.client(cfg,f)("POST",recovery.HEARTBEAT,{}),e=>e.code==="ORACLE_TLS_FAILED"&&e.transportCode==="ERR_TLS_CERT_ALTNAME_INVALID");}finally{f.close();badServer.closeAllConnections();await new Promise(r=>badServer.close(r));}});
    const stalled=net.createServer(()=>{}); const sockets=new Set(); stalled.on("connection",s=>{sockets.add(s);s.on("close",()=>sockets.delete(s));}); await new Promise(r=>stalled.listen(0,"127.0.0.1",r));
    await check("TCP/TLS connect timeout remains shorter than task lease", async()=>{const f=fetcher(stalled,true,30);try{await assert.rejects(collector.client(cfg,f)("POST",recovery.HEARTBEAT,{}),/ORACLE_TIMEOUT/);}finally{f.close();for(const s of sockets)s.destroy();await new Promise(r=>stalled.close(r));}});
    await check("per-run lease abort cancels an in-flight request", async()=>{
      const control=new AbortController(); const keepAlive=setTimeout(()=>{},1000);
      try {const pending=collector.client(cfg,async(_,opts)=>new Promise((_,reject)=>opts.signal.addEventListener("abort",()=>reject(opts.signal.reason),{once:true})))("POST","/api/full-sync/v1/runs/sc-fixture/upload/finalize",{},false,{signal:control.signal});control.abort();await assert.rejects(pending,/COLLECTOR_STOPPED/);}finally{clearTimeout(keepAlive);}
    });
    await check("run watchdog aborts in-flight finalize and preserves checkpoint/latest",async()=>{
      const data=require("./fixtures/four-direct-source")();
      const run={id:"sc-fixture-abort",claimId:"a".repeat(48),mode:"routine",term:data.term,termConfig:data.termConfig};
      let aborted=false,finalizes=0,checkpoint;
      const request=collector.client(cfg,async(url,spec)=>{
        const route=new URL(url).pathname;
        if(route.endsWith("/finalize")){finalizes++;return new Promise((_,reject)=>spec.signal.addEventListener("abort",()=>{aborted=true;reject(spec.signal.reason);},{once:true}));}
        const value=route.endsWith("/claim")?{run}:route===recovery.HEARTBEAT?{ok:true}:{};
        return{status:200,ok:true,json:async()=>value};
      });
      await assert.rejects(collector.runOnce({...cfg,execute:true},{request,leaseMs:50,watchIntervalMs:5,heartbeatIntervalMs:1000,assertSession:()=>{},executeSync:async(_,__,dir)=>{fs.writeFileSync(path.join(dir,"staging.json"),JSON.stringify(data));checkpoint=path.join(dir,"checkpoint.json");fs.writeFileSync(checkpoint,'{"fixtureCompleted":1}');},upload:async api=>api("POST","/api/full-sync/v1/runs/"+run.id+"/upload/finalize",{}),promoteRun:()=>assert.fail("expired run promoted")}),/COLLECTOR_LEASE_EXPIRED/);
      assert.equal(aborted,true);assert.equal(finalizes,1);assert.equal(fs.readFileSync(checkpoint,"utf8"),'{"fixtureCompleted":1}');assert.equal(fs.existsSync(path.join(root,"last-success.json")),false);
    });
    await check("unsigned route probe is bounded, never reads credentials and never claims",async()=>{
      const logs=[],routes=[],waits=[];
      const result=await require("./wyz-schedule-collector/probe-oracle-transport").probe({mode:"cloudflare-default",samples:2,fetcher:async(url,opts)=>{routes.push(url);assert.equal(opts.headers.authorization,undefined);return{ok:true,json:async()=>({ok:true})};},sleep:async ms=>waits.push(ms),log:v=>logs.push(v)});
      assert.equal(result.failures,0);assert.deepEqual(waits,[30000]);assert.ok(routes.every(url=>url===transport.ORIGIN+"/api/health"));assert.ok(logs.some(v=>v.authentication==="NOT_TESTED"));
      for(const samples of [0,4,2.5])await assert.rejects(require("./wyz-schedule-collector/probe-oracle-transport").probe({samples}),/ARGUMENT_REJECTED/);
    });
  } finally {native.close();for(const agent of agents)agent.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));}
  console.log("collector-oracle-transport: "+cases+" PASS; real local TLS fixtures; school requests 0");
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
