#!/usr/bin/env node
"use strict";
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const auth = require("./schoolSession"), terminal = require("./terminalPrompt"), collector = require("./collector");
const { readJson, acquireLock } = require("./runStore");
const DATA_ROOT = "/var/lib/fosuclass/schedule-collector";
const HELP = `佛课小表 WYZ 手动入口
  fosu-collector status [--check-session --approve-school-access]
  fosu-collector login [--login-profile=mobile|desktop] [--approve-school-access]
  fosu-collector manual-sync [--mode=sample] [--sample-kind=class|four] [--run-id=sc-…]
      [--login-profile=mobile|desktop] [--approve-school-access]
  fosu-collector inspect
账号和密码只从 PAM TTY 隐藏输入。默认 mobile（Chromium 移动模拟）。
sample 必须先由 Oracle 管理员创建限期、有界任务；不会发布或替换正式 Staging。
阶段 A 的 routine/full 锁定，等待真实权限与覆盖验收。所有真实访问须单独批准。
status 默认只读本机与 Oracle；检查学校 Session 需要 --check-session 和授权。
认证失败后不会自动重试；人工处理后可加 --acknowledge-auth-failure（冷却/日限仍生效）。
`;
const MESSAGES = {
  INVALID_CREDENTIALS:"学校账号或密码不正确；已停止，请确认或更换密码后人工处理。",
  SCHOOL_SECURITY_CHALLENGE:"学校要求验证码或安全核验；已停止，不会绕过或再次提交密码。",
  SCHOOL_LOGIN_FORM_CHANGED:"学校登录页面或表单已变化；已停止，需要检查适配。",
  SCHOOL_PAGE_CHANGED:"受保护教务页面结构已变化；无法确认登录有效。",
  SCHOOL_SESSION_EXPIRED:"学校 Session 已失效；本轮已停止，需要人工重新登录。",
  SCHOOL_TLS_OR_ORIGIN_REJECTED:"学校证书或跳转来源不可信；严格 TLS 校验已拒绝访问。",
  SCHOOL_NETWORK_TIMEOUT:"访问学校超时；已停止，没有自动重试密码。",
  FOUR_SOURCE_INCOMPLETE:"四源来源或数据验证不完整；禁止上传与发布。",
  STAGING_UPLOAD_FAILED:"Oracle Staging 上传或审核确认失败；不能报告同步成功。",
  STAGING_SAMPLE_API_UNAVAILABLE:"现网尚未提供受控 sample 协议；已在学校访问前停止。需另行批准后端候选部署。",
  SCHOOL_ACCESS_NOT_AUTHORIZED:"学校访问或 sample 任务尚未获得有效授权；已停止。",
  SCHOOL_SCOPE_REVIEW_REQUIRED:"routine/full 尚未开放；先验收登录、最小样本与四类样本，再单独审核。",
  SCHOOL_AUTH_INTERACTIVE_TTY_REQUIRED:"需要 PAM 交互式 TTY 和隐藏输入；禁止管道、重定向或密码参数。",
  SCHOOL_AUTH_MANUAL_ACTION_REQUIRED:"此前认证或安全验证失败，需要人工处理；处理后显式确认失败状态。",
  SCHOOL_AUTH_COOLDOWN:"学校登录仍在 30 分钟冷却期；请勿反复提交密码。",
  SCHOOL_AUTH_DAILY_LIMIT:"24 小时内已达到两次登录尝试上限；已停止。",
  SCHOOL_REQUEST_BUDGET_EXCEEDED:"本次样本请求已达到审核上限；已停止，不扩大范围。",
  SCHOOL_SAMPLE_REDIRECT_REJECTED:"学校样本接口出现未审核的跳转；已在下一次请求前停止，需要检查真实接口。",
  COLLECTOR_LOCKED:"另一个采集或学校会话操作正在运行；未抢锁、未停止服务。",
  COLLECTOR_STOPPED:"操作已取消；不会继续登录、采集或上传。",
  CLI_ARGUMENT_REJECTED:"参数不受支持；密码、账号、Token 和任意配置路径不能通过参数传入。",
  ROOT_REQUIRED:"此入口需要 WYZ PAM root 终端。",
};
function fail(code) { return Object.assign(new Error(code), { code }); }
function errorCode(error) {
  let code = auth.transportCode(error);
  if (/^(ORACLE_|COLLECTOR_|RUN_|PRIVATE_|READ_ONLY_|SAMPLE_|CLI_)/.test(error.code || "") && /^[A-Z0-9_]+$/.test(error.code)) code=error.code;
  if (code === "SESSION_EXPIRED" || error.code === "SESSION_EXPIRED") code = "SCHOOL_SESSION_EXPIRED";
  if (error.code === "FOUR_DIRECT_SOURCE_INVALID" || /^SAMPLE_(SOURCE|DATA|CONTRACT)_/.test(error.code || "")) code = "FOUR_SOURCE_INCOMPLETE";
  if (/^(STAGING_|SAMPLE_FINALIZE)/.test(error.code || "")) code = error.code === "STAGING_SAMPLE_API_UNAVAILABLE" ? error.code : "STAGING_UPLOAD_FAILED";
  if (/^(ROOT_REQUIRED|CLI_ARGUMENT_REJECTED|COLLECTOR_LOCKED|SESSION_PERMISSIONS_REJECTED)$/.test(error.code || "")) code = error.code;
  if (error.code === "ORACLE_AUTH_OR_ENDPOINT_REJECTED") code = "STAGING_SAMPLE_API_UNAVAILABLE";
  return code;
}
function parse(args) {
  const options = { command:args[0] || "help", mode:"sample", sampleKind:"class", loginProfile:"mobile" };
  if (!["help","status","login","manual-sync","inspect"].includes(options.command)) throw fail("CLI_ARGUMENT_REJECTED");
  const seen = new Set();
  for (const arg of args.slice(1)) {
    const match = arg.match(/^--(mode|sample-kind|login-profile|run-id)=(.+)$/);
    const key = match ? match[1] : arg;
    if (seen.has(key)) throw fail("CLI_ARGUMENT_REJECTED");
    seen.add(key);
    if (match) options[{"mode":"mode","sample-kind":"sampleKind","login-profile":"loginProfile","run-id":"runId"}[key]] = match[2];
    else if (arg === "--approve-school-access") options.approved = true;
    else if (arg === "--check-session") options.checkSession = true;
    else if (arg === "--acknowledge-auth-failure") options.acknowledgeFailure = true;
    else throw fail("CLI_ARGUMENT_REJECTED");
  }
  if (!["sample","routine","full"].includes(options.mode) || !["class","four"].includes(options.sampleKind) || !["mobile","desktop"].includes(options.loginProfile) || options.runId && !/^sc-[A-Za-z0-9-]+$/.test(options.runId)) throw fail("CLI_ARGUMENT_REJECTED");
  const allowed = {
    help:[], inspect:[], status:["--check-session","--approve-school-access","login-profile"],
    login:["--approve-school-access","--acknowledge-auth-failure","login-profile"],
    "manual-sync":["mode","sample-kind","run-id","login-profile","--approve-school-access","--acknowledge-auth-failure"],
  }[options.command];
  if ([...seen].some(key => !allowed.includes(key))) throw fail("CLI_ARGUMENT_REJECTED");
  if (options.checkSession && !options.approved) throw fail("SCHOOL_ACCESS_NOT_AUTHORIZED");
  return options;
}
function serviceState(name, action, deps) {
  if (deps.serviceState) return deps.serviceState(name, action);
  try { return execFileSync("systemctl",[action,name],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim(); }
  catch (error) { const value = String(error.stdout || "").trim(); return ["inactive","disabled","failed"].includes(value) ? value : "UNKNOWN"; }
}
function localStatus(cfg, deps = {}) {
  auth.secureDirectory(cfg.dataRoot, deps.platform);
  let session = "SESSION_FILE_MISSING";
  if (fs.existsSync(cfg.sessionPath)) { auth.secureFile(cfg.sessionPath, deps.platform); session = "PRESENT_UNVERIFIED"; }
  const status = readJson(path.join(cfg.dataRoot,"collector-status.json"),{}), state = readJson(path.join(cfg.dataRoot,"school-auth-state.json"),{});
  return {
    collector:serviceState("wyz-schedule-collector.service","is-active",deps),
    timer:serviceState("wyz-schedule-collector.timer","is-enabled",deps),
    networkStatus:["healthy","recovering","degraded","fatal","starting","stopped"].includes(status.networkStatus) ? status.networkStatus : "UNKNOWN",
    lastSuccessfulHeartbeatAt: validTime(status.lastSuccessfulHeartbeatAt),
    session, lastSessionSuccessAt:state.lastSuccessAt ? validTime(new Date(state.lastSuccessAt).toISOString()) : null,
    authBlocked:state.blocked === true, lastAuthFailureCode:/^[A-Z_]+$/.test(state.lastFailureCode || "") ? state.lastFailureCode : null,
    credentialsConfigured:fs.existsSync("/etc/fosuclass/school-auth.json"), schoolLoginAttempts:0, schoolRequests:0,
  };
}
function validTime(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null; }
function sampleView(value) {
  if (!value || !/^sc-[A-Za-z0-9-]+$/.test(value.runId || "") || value.mode !== "sample") return null;
  const result = {};
  for (const key of ["runId","term","mode","sampleKind","result","schoolRequestCount","stagingRawBytes","stagingGzipBytes","published","finishedAt","canonicalHash","uploadId"]) result[key] = value[key];
  result.directSourceSummary={};
  for(const kind of ["class","teacher","classroom","course"]){
    const stat=value.directSourceSummary?.[kind];if(!stat)continue;
    result.directSourceSummary[kind]={sourceMode:stat.sourceMode==="network-direct"?"network-direct":"UNVERIFIED"};
    for(const key of ["discoveredEntities","requestedEntities","success","empty","failed","parserErrors","requestCount","scheduleDocuments","courseEvents"])result.directSourceSummary[kind][key]=Number.isSafeInteger(stat[key])&&stat[key]>=0?stat[key]:null;
  }
  return result;
}
function connection(deps) {
  if (deps.connection) return deps.connection();
  const env = require("./credentials").readEnvFile("/etc/fosuclass/full-sync.env");
  const cfg = collector.config(env);
  const fetcher = cfg.transport.mode === "cloudflare-default" ? fetch : require("./oracleTransport").createFetcher(cfg.transport);
  return { cfg, request:collector.client(cfg,fetcher,{signal:deps.signal}), close:()=>{ if(fetcher.close) fetcher.close(); } };
}
async function authorize(options, deps, label) {
  if (options.approved) return;
  const answer = await deps.ask(label + "。已获得学校访问批准后，输入 LOGIN 继续（默认停止）: ");
  if (answer !== "LOGIN") throw fail("SCHOOL_ACCESS_NOT_AUTHORIZED");
}
async function login(cfg, options, deps) {
  await authorize(options,deps,"即将检查/登录学校 CAS，仅本次使用密码");
  deps.output("阶段 1/3：检查学校 Session；有效 Session 会询问是否复用。");
  const result = await auth.interactiveSession(cfg,{
    ...deps, approved:true, acknowledgeFailure:options.acknowledgeFailure,
    readCredentials:()=>{deps.output("阶段 2/3：新建隔离 CAS 会话；账号和密码隐藏输入，仅提交一次。");return terminal.credentials({signal:deps.signal,...deps.terminal});},
    confirmReuse:async()=> { const answer=await deps.ask("已有有效学校 Session。输入 REUSE 复用；输入 LOGIN 重新登录: "); if(!["REUSE","LOGIN"].includes(answer))throw fail("SCHOOL_ACCESS_NOT_AUTHORIZED");return answer==="REUSE"; },
    ...(deps.authDeps || {}),
  });
  deps.output("阶段 3/3：受保护页面与候选 Session 校验完成。密码未保存。");
  return result;
}
async function main(args = process.argv.slice(2), deps = {}) {
  if (args[0] === "--help" && args.length === 1) args = ["help"];
  const options = parse(args), output = deps.output || (value=>console.log(typeof value === "string" ? value : JSON.stringify(value)));
  if (options.command === "help") { output(HELP); return {status:"help"}; }
  if (!deps.skipRootCheck && (process.platform === "win32" || process.getuid() !== 0)) throw fail("ROOT_REQUIRED");
  auth.assertSafeRuntime();
  const cfg = { dataRoot:DATA_ROOT,sessionPath:path.join(DATA_ROOT,"session.json"),...(deps.cfg || {}),loginProfile:options.loginProfile };
  const ctx = { ...deps,output,ask:deps.ask || (prompt=>terminal.readHidden(prompt,{signal:deps.signal,...deps.terminal})) };
  if (options.command === "status") {
    const status = localStatus(cfg,ctx);
    let conn;
    try { conn=connection(ctx); const remote = await conn.request("GET","/api/full-sync/v1/status"); status.oracleProtocol=remote.protocol; status.lastFullCollectionAt=remote.status?.lastSuccessAt || null;status.recent=remote.status?.recent; }
    catch (error) { status.oracleStatus="UNVERIFIED"; status.oracleCode=errorCode(error); }
    finally { if(conn)conn.close(); }
    if (options.checkSession) {
      const checked=await auth.checkSession(cfg,{...deps.authDeps,signal:deps.signal,approved:true});
      status.session=checked.status; output(status);
      if (checked.status !== "SESSION_VALID") throw fail("SCHOOL_SESSION_EXPIRED");
      return status;
    }
    output(status); return status;
  }
  if (options.command === "inspect") {
    auth.secureDirectory(cfg.dataRoot,deps.platform);
    const value = sampleView(readJson(path.join(cfg.dataRoot,"last-manual-sample.json"),null));
    const inspection={lastSample:value,localResult:value?value.result:"NO_SAMPLE",oracleStagingStatus:"UNVERIFIED",comparison:"sample不能证明全校覆盖或与完整Release比较",publication:"人工门禁；sample不能发布"};
    let conn;
    try{
      conn=connection(ctx);const remote=await conn.request("GET","/api/full-sync/v1/status");
      if(remote.protocol!=="collector-manual.v1")throw fail("STAGING_SAMPLE_API_UNAVAILABLE");
      const run=(remote.status?.recent||[]).find(r=>r.id===value?.runId);
      inspection.oracleStagingStatus=run?.result||"NO_MATCHING_RUN";
      inspection.uploadMatches=Boolean(run&&run.uploadId===value?.uploadId);
    }catch(error){inspection.oracleCode=errorCode(error);}finally{if(conn)conn.close();}
    output(inspection);
    return value;
  }
  if (options.command === "manual-sync" && options.mode !== "sample") throw fail("SCHOOL_SCOPE_REVIEW_REQUIRED");
  if (!deps.ask && (!process.stdin.isTTY || !process.stderr.isTTY || typeof process.stdin.setRawMode !== "function")) throw fail("SCHOOL_AUTH_INTERACTIVE_TTY_REQUIRED");
  auth.secureDirectory(cfg.dataRoot, deps.platform);
  const unlock = acquireLock(cfg.dataRoot,"manual-sync.lock");
  let conn;
  try {
    if (options.command === "login") { const result=await login(cfg,options,ctx); output(result); return result; }
    // Check approved scope/API before any school request or credential prompt.
    conn=connection(ctx);
    const remote=await conn.request("GET","/api/full-sync/v1/status");
    if (remote.protocol !== "collector-manual.v1") throw fail("STAGING_SAMPLE_API_UNAVAILABLE");
    const queued=remote.status?.current;
    if (!queued || queued.mode !== "sample" || queued.finishedAt || queued.samplePolicy?.kind !== options.sampleKind ||
        options.runId && queued.id !== options.runId || !/^sc-[A-Za-z0-9-]+$/.test(queued.id || "") ||
        !Number.isFinite(Date.parse(queued.approvalExpiresAt || "")) || Date.parse(queued.approvalExpiresAt) <= Date.now() ||
        remote.status.enabled !== true || remote.status.stopForDay || queued.stage !== "idle") throw fail("SCHOOL_ACCESS_NOT_AUTHORIZED");
    require("../../server/src/shared/sampleCollectionContract").policy(queued.samplePolicy.kind,queued.samplePolicy.requestBudget);
    output("阶段 1/6：Oracle 已审核 sample 任务 " + queued.id + "；每类一个请求目标，预算 " + queued.samplePolicy.requestBudget + " 次。班级接口的一个目标是专业/年级请求组。");
    if (await ctx.ask("确认本次 sample 范围并上传私有审核记录，输入 SAMPLE " + options.sampleKind + ": ") !== "SAMPLE " + options.sampleKind) throw fail("SCHOOL_ACCESS_NOT_AUTHORIZED");
    await login(cfg,options,ctx);
    output("阶段 4/6：领取指定 sample 租约，低频直采；不会自动重新登录。");
    let previousProgress;
    const result=await collector.runOnce({...conn.cfg,...cfg,execute:true,concurrency:1},{
      ...deps.runDeps,request:conn.request,signal:deps.signal,claimSelector:{runId:queued.id,mode:"sample"},
      ensureSchoolSession:async (value, bounds)=>{ const checked=await auth.checkSession(value,{...deps.authDeps,...bounds,approved:true}); if(checked.status!=="SESSION_VALID")throw fail("SCHOOL_SESSION_EXPIRED"); },
      onProgress:value=>{ const text=JSON.stringify({stage:value.stage,schoolRequestCount:value.schoolRequestCount,uploadBytes:value.uploadBytes}); if(text!==previousProgress){output(text);previousProgress=text;} },
    });
    if (result.status === "idle" || result.result !== "PENDING SAMPLE REVIEW") throw fail("SCHOOL_ACCESS_NOT_AUTHORIZED");
    output("阶段 6/6：样本校验与 Oracle 私有 Staging 上传完成，等待样本审核；正式版未发布。");
    output(sampleView(result)); return result;
  } finally { if(conn)conn.close(); unlock(); }
}
async function run(args, deps = {}) {
  const control = new AbortController(), stop=()=>control.abort();
  process.once("SIGINT",stop);process.once("SIGTERM",stop);
  try { return await main(args,{...deps,signal:control.signal}); }
  catch(error) { const code=errorCode(error); (deps.errorOutput || console.error)(JSON.stringify({status:"failed",code,message:MESSAGES[code] || "操作失败，已停止；请按错误码检查环境或权限。"})); process.exitCode=code==="COLLECTOR_STOPPED"?130:1; }
  finally { process.removeListener("SIGINT",stop);process.removeListener("SIGTERM",stop); }
}
if(require.main===module)run(process.argv.slice(2));
module.exports={main,run,parse,errorCode,localStatus,HELP,MESSAGES};
