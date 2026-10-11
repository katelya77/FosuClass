const SCHEDULE_COLLECTOR_CARD = `<div class="card" id="scheduleCollectorCard"><div class="card-header"><h3>全校课表采集</h3></div><p class="muted">查看链路证据、申请有界样本与审核四源数据。</p><a href="/admin/schedule-collector">进入全校课表采集</a></div>`;
const SCHEDULE_COLLECTOR_STYLES = `
 #section-schedule-collector { min-width:0; }
 #section-schedule-collector.active { display:grid; grid-template-columns:minmax(0,1fr); gap:12px; }
 #section-schedule-collector .card { min-width:0; }
 #section-schedule-collector .sc-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(175px,1fr)); gap:8px; }
 #section-schedule-collector .sc-stat { border:1px solid var(--border); border-radius:var(--radius); padding:10px; background:var(--surface-muted); overflow-wrap:anywhere; }
 #section-schedule-collector .sc-stat b { display:block; font-size:14px; }
 #section-schedule-collector .sc-stat span { font-size:12px; color:var(--text-muted); }
 #section-schedule-collector .sc-table { overflow:auto; min-width:0; max-width:100%; max-height:420px; }
 #section-schedule-collector table { width:100%; border-collapse:collapse; font-size:12px; }
 #section-schedule-collector td,#section-schedule-collector th { text-align:left; padding:8px; border-bottom:1px solid var(--border); white-space:nowrap; }
 #section-schedule-collector form { display:flex; flex-wrap:wrap; gap:10px; align-items:end; }
 #section-schedule-collector label { display:grid; gap:4px; font-size:12px; min-width:120px; }
 #section-schedule-collector input,#section-schedule-collector select { max-width:100%; }
 #section-schedule-collector pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:500px; overflow:auto; font-size:12px; }
 #section-schedule-collector [hidden] { display:none!important; }
 @media(max-width:600px) { #section-schedule-collector .card { padding:12px; } #section-schedule-collector form label { flex:1; } }
`;
const SCHEDULE_COLLECTOR_SECTION = `
 <section id="section-schedule-collector" class="section">
  <div class="card"><div class="card-header"><h2>全校课表采集</h2><button type="button" class="secondary" id="scRefreshBtn">刷新证据</button></div>
   <p class="muted">WYZ 负责校园网采集，Oracle 负责任务和审核。样本不代表全校覆盖，审核前不发布。</p>
   <p id="scNotice" role="status" aria-live="polite">等待加载真实证据</p><div id="scHealth" class="sc-grid"></div>
  </div>
  <div class="card"><div class="card-header"><h3>四源采集概况</h3><span id="scSourceScope" class="muted">尚无采集证据</span></div>
   <div class="sc-table"><table><thead><tr><th>来源</th><th>状态</th><th>发现</th><th>已请求</th><th>成功</th><th>空表</th><th>失败</th><th>文档</th><th>课程事件</th><th>解析异常</th></tr></thead><tbody id="scSources"></tbody></table></div>
   <p class="muted">班级的采集单位可能是专业请求组，返回多个行政班。未知数量显示“未上报”。</p>
  </div>
  <div class="card"><div class="card-header"><h3>任务控制</h3><span id="scReadiness" class="muted">检查中</span></div>
   <form id="scSampleForm"><label>学期<input id="scTerm" placeholder="使用当前学期" maxlength="20"></label>
    <label>样本范围<select id="scSampleKind"><option value="class">班级：一个请求组</option><option value="four">四源：各一个目标</option></select></label>
    <label>请求预算<input id="scBudget" type="number" min="1" max="120" value="40" required></label>
    <button id="scSampleBtn" type="submit" disabled>申请 Sample 任务</button><button id="scNewApprovalBtn" type="button" class="secondary">新申请标识</button>
   </form><p class="muted">审批有效期 30 分钟，并发 1。学校访问仍需独立批准后在 PAM 手动执行，网页不会读取学校凭据或启动 Shell。</p>
   <div class="button-row"><button id="scPauseBtn" type="button" class="secondary" disabled>暂停后续任务</button><button id="scResumeBtn" type="button" class="secondary" disabled>恢复队列准入</button><button id="scCancelBtn" type="button" class="secondary" disabled>取消当前任务</button>
    <button id="scRoutineBtn" type="button" class="secondary" hidden>执行日常采集</button><button id="scFullBtn" type="button" class="secondary" hidden>执行完整采集</button></div>
   <p id="scApprovalBoundary" class="muted">正式采集待独立范围审批；定时任务未获验收时保持禁用。</p>
  </div>
  <div class="card"><h3>运行记录与审核</h3><div class="sc-table"><table><thead><tr><th>任务</th><th>范围 / 阶段</th><th>状态</th><th>请求 / 预算</th><th>开始 / 结束</th><th>错误 / 审核</th><th>详情</th></tr></thead><tbody id="scRuns"></tbody></table></div><p id="scHistoryNote" class="muted"></p></div>
  <div class="card"><h3>数据质量与审核</h3><p id="scActive" class="muted">正式版本证据加载中</p>
   <p class="muted">Sample 校验周次、节次、重复课程、行政班与来源身份；有界目标之间的跨源一致性和学校人工对照仍需审核。正式 Staging 沿用现有差异、下降与发布门禁。</p>
   <div class="button-row"><a href="/admin/sync" id="scStagingLink">查看正式 Staging 差异与发布门禁</a><a href="/admin/quality">查看数据质量中心</a></div>
   <p id="scReviewNotice" role="status"></p><div id="scReviewFacts"></div>
   <div id="scHumanReview" hidden><label><input id="scCompared" type="checkbox">我已与教务原始课表逐项对照</label><div class="button-row"><button type="button" id="scApproveReview">记录对照通过</button><button type="button" class="secondary" id="scRejectReview">记录审核拒绝</button></div><p class="muted">只保存此样本的人工审核结果，不授权正式采集、全覆盖或发布。</p></div>
   <details><summary>查看脱敏审核证据</summary><pre id="scReview" hidden></pre></details>
  </div>
 </section>`;
const SCHEDULE_COLLECTOR_SCRIPT = `
 (function () {
  var section=document.getElementById('section-schedule-collector'); if(!section || typeof api!=='function') return;
  var pending=null, busy=false, latest=null, stopped=false, reviewEpoch=0, selectedReview=null;
  var labels={class:'班级',teacher:'教师',classroom:'教室',course:'课程'};
  var states={HEARTBEAT_RECENT:'近期收到签名心跳',HEARTBEAT_STALE:'心跳过期',UNKNOWN:'未验证',SESSION_FILE_MISSING:'Session 文件缺失',PRESENT_UNVERIFIED:'文件存在，有效性未验证',SESSION_EXPIRED:'Session 已失效',RESPONDED:'本次 API 响应成功','PENDING SAMPLE REVIEW':'待私有样本审核','PENDING REVIEW':'待正式审核','NO CHANGE':'无变化',FAILED:'失败',idle:'空闲 / 待领取'};
  function node(id){return document.getElementById(id);}
  function text(id,value){node(id).textContent=value;}
  function label(value){return states[value] || value || '未验证';}
  function clear(element){while(element.firstChild) element.removeChild(element.firstChild);}
  function count(value){return Number.isSafeInteger(value)&&value>=0?String(value):'未上报';}
  function cell(row,value){var td=document.createElement('td');td.textContent=value;row.appendChild(td);return td;}
  function safeError(error){return /^[A-Z0-9_]{1,80}$/.test(error&&error.code||'')?error.code:'COLLECTOR_REQUEST_FAILED';}
  function controls(){var p=latest&&latest.permissions||{},r=latest&&latest.readiness||{},s=latest&&latest.status||{};
   node('scSampleBtn').disabled=busy||!p.sample||!r.ready||Boolean(s.current&&!s.current.finishedAt);
   ['scPauseBtn','scResumeBtn','scCancelBtn'].forEach(function(id){node(id).disabled=busy||!p.control;});
   ['scRoutineBtn','scFullBtn'].forEach(function(id){node(id).hidden=!p.full;node(id).disabled=busy;});
   node('scNewApprovalBtn').disabled=busy||Boolean(s.current&&!s.current.finishedAt);
  }
  function paint(value){latest=value;var s=value.status,h=value.health,r=value.readiness;var health=node('scHealth');clear(health);
   [['WYZ / 心跳',label(h.collector)],['Collector 版本',h.observation&&h.observation.revision||'未上报'],['CAS Session',label(h.session)+(h.observation&&!h.observationFresh?'（旧观测）':'')],['Oracle API',label(h.oracleApi)],['Oracle 版本',h.oracleRevision||'未验证'],['签名协议',h.signatureConfigured?'签名配置已检测；连接仍以心跳为证':'签名配置缺失'],['当前阶段',label(h.phase)],['最后成功采集',h.lastCollectionSuccessAt||'尚无成功证据'],['最后心跳',s.lastHeartbeat||'未收到'],['定时采集',s.timerVerified?'验收标记存在；进程状态待现场核实':'未验收，保持禁用']].forEach(function(item){var box=document.createElement('div');box.className='sc-stat';var title=document.createElement('b'),detail=document.createElement('span');title.textContent=item[0];detail.textContent=item[1];box.appendChild(title);box.appendChild(detail);health.appendChild(box);});
   var source=node('scSources');clear(source);Object.keys(labels).forEach(function(kind){var stat=value.sources.summary[kind],row=document.createElement('tr');cell(row,labels[kind]);cell(row,!stat?'无证据':stat.failed||stat.parserErrors?'存在异常':stat.sourceMode==='network-direct'?'直接采集证据':'来源待核实');['discoveredEntities','requestedEntities','success','empty','failed','scheduleDocuments','courseEvents','parserErrors'].forEach(function(key){cell(row,count(stat&&stat[key]));});source.appendChild(row);});
   text('scSourceScope',value.sources.runId?(value.sources.sampleOnly?'有界 Sample · 覆盖率未验证 · ':'')+value.sources.runId:'尚无采集证据');
   text('scReadiness',(r.ready?'Sample API 可用':'Sample API 阻断')+' · '+r.code+' · '+(s.enabled?'队列准入开启':'队列暂停'));
   text('scApprovalBoundary',value.fullCollectionApproved?'正式采集范围审批标记存在，执行仍需权限与二次确认；发布单独审核。':'正式采集待独立范围审批；网页只申请有界 Sample，发布单独审核。');
   text('scActive','正式版本：'+(value.active.version||'未验证')+' · 学期 '+(value.active.term||'未验证'));
   var runs=node('scRuns');clear(runs);value.runs.forEach(function(run){var row=document.createElement('tr');cell(row,run.id);cell(row,run.mode+(run.samplePolicy?' / '+run.samplePolicy.kind:'')+' / '+label(run.stage));cell(row,run.result?label(run.result):run.finishedAt?'已结束':'待完成');cell(row,count(run.schoolRequestCount)+' / '+(run.samplePolicy?count(run.samplePolicy.requestBudget):'以审批为准'));cell(row,run.startedAt+' / '+(run.finishedAt||'未结束'));cell(row,run.failureCode||(run.sampleHumanReview?run.sampleHumanReview.decision==='confirmed'?'人工对照已确认':'人工审核拒绝':(run.reasons||[]).join('、'))||'未审核');var td=cell(row,'');if(value.permissions.review){var button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='查看审核';button.addEventListener('click',function(){showReview(run.id);});td.appendChild(button);}else td.textContent='需要审核权限';runs.appendChild(row);});
   text('scHistoryNote',value.runs.length?'显示最近 '+value.runs.length+' 条持久化记录；未结束任务不自动视为成功。':'尚无持久化运行记录');controls();
  }
  function refresh(){if(pending)return pending;pending=api('/api/admin/schedule-collector/overview').then(function(body){paint(body.overview);text('scNotice','证据更新于 '+body.overview.generatedAt);}).catch(function(error){latest=null;controls();text('scNotice','证据加载失败 · '+safeError(error)+'；页面上次显示的数据已过期。');}).finally(function(){pending=null;});return pending;}
  function mutate(path,body){if(busy)return Promise.resolve();busy=true;controls();return api('/api/admin/schedule-collector/actions/'+path,{method:'POST',body:JSON.stringify(body||{})}).then(function(value){text('scReviewNotice',value.queued?'任务申请回执：'+(value.queued.run&&value.queued.run.id||value.queued.reason):'操作已提交，重新读取状态。');return refresh();}).catch(function(error){text('scReviewNotice','操作未确认成功 · '+safeError(error)+'；保留当前申请标识，重试将使用同一幂等键。');}).finally(function(){busy=false;controls();});}
  function showReview(id){var epoch=++reviewEpoch;selectedReview=null;node('scReview').hidden=true;node('scHumanReview').hidden=true;clear(node('scReviewFacts'));text('scReviewNotice','加载受保护审核证据…');api('/api/admin/schedule-collector/runs/'+encodeURIComponent(id)+'/review').then(function(body){if(epoch!==reviewEpoch)return;selectedReview=body.review;text('scReviewNotice','审核证据 · '+id+(body.review.run.sampleHumanReview?'；人工审核已记录。':'；学校人工对照仍需独立完成。'));text('scReview',JSON.stringify(body.review,null,2));node('scReview').hidden=false;renderReview(body.review);}).catch(function(error){if(epoch===reviewEpoch)text('scReviewNotice','审核证据不可用 · '+safeError(error));});}
  function renderReview(value){var facts=node('scReviewFacts');if(!value.schedules)return;var status=document.createElement('p');status.textContent='规范化校验通过 · 周次与节次有效 · 无重复事件 · 全校覆盖未验证 · 跨源一致性待独立验收';facts.appendChild(status);
   Object.keys(labels).forEach(function(kind){var source=value.schedules[kind];if(!source.total)return;var title=document.createElement('h4');title.textContent=labels[kind]+'样本 · '+source.total+' 份文档'+(source.truncated?'（只展示前 25 份）':'');facts.appendChild(title);source.documents.forEach(function(doc){var name=document.createElement('p');name.textContent=doc.name+' · '+doc.eventCount+' 个课程事件'+(doc.classIdentity?' · 行政班 '+(doc.classIdentity.classId||'未上报'):'')+(doc.truncated?'（仅展示前 40 项）':'');facts.appendChild(name);var wrap=document.createElement('div'),table=document.createElement('table'),head=document.createElement('tr');wrap.className='sc-table';['课程','教师','教室','星期','节次','教学周'].forEach(function(label){cell(head,label);});table.appendChild(head);doc.events.forEach(function(event){var row=document.createElement('tr');[event.courseName,event.teacherName||'未上报',event.roomName||'未上报',event.weekday,event.startSection+'–'+event.endSection,event.weeks.join('、')].forEach(function(item){cell(row,item);});table.appendChild(row);});wrap.appendChild(table);facts.appendChild(wrap);});});
   node('scCompared').checked=false;node('scHumanReview').hidden=Boolean(value.run.sampleHumanReview)||!(latest&&latest.permissions.review);node('scApproveReview').disabled=true;
  }
  node('scCompared').addEventListener('change',function(){node('scApproveReview').disabled=!node('scCompared').checked||busy;});
  [['scApproveReview','confirmed'],['scRejectReview','rejected']].forEach(function(item){node(item[0]).addEventListener('click',function(){if(!selectedReview||busy||node(item[0]).disabled)return;if(window.prompt('记录此样本审核，输入 REVIEW SAMPLE 二次确认')!=='REVIEW SAMPLE')return;var run=selectedReview.run;mutate('review',{runId:run.id,canonicalHash:run.canonicalHash,decision:item[1],comparisonAttested:node('scCompared').checked,confirmation:'REVIEW SAMPLE',idempotencyKey:'review-'+run.id}).then(function(){showReview(run.id);});});});
  node('scRefreshBtn').addEventListener('click',refresh);
  node('scSampleForm').addEventListener('submit',function(event){event.preventDefault();if(node('scSampleBtn').disabled)return;var body={sampleKind:node('scSampleKind').value,requestBudget:Number(node('scBudget').value)};var term=node('scTerm').value.trim();if(term)body.term=term;if(!Number.isSafeInteger(body.requestBudget)||body.requestBudget<1||body.requestBudget>120)return;
   if(!window.confirm('仅申请 '+(body.sampleKind==='four'?'四源各一个目标':'一个班级请求组')+' 的 Sample，预算 '+body.requestBudget+' 次。学校访问和发布分别审批。确认申请？'))return;
   var intent=JSON.stringify(body),saved=null;try{saved=JSON.parse(sessionStorage.getItem('fosu-collector-sample-request'));}catch(_){}
   if(!saved||saved.intent!==intent)saved={intent:intent,key:'sample-'+crypto.randomUUID()};body.idempotencyKey=saved.key;try{sessionStorage.setItem('fosu-collector-sample-request',JSON.stringify(saved));}catch(_){}mutate('sample',body);
  });
  node('scNewApprovalBtn').addEventListener('click',function(){if(!node('scNewApprovalBtn').disabled&&window.confirm('建立新的申请标识？此前的任务和审核历史会保留。')){try{sessionStorage.removeItem('fosu-collector-sample-request');}catch(_){}text('scReviewNotice','下次申请将使用新的标识。');}});
  [['scPauseBtn','pause','暂停后续任务准入？在途任务会保留。'],['scResumeBtn','resume','恢复队列准入？这不会启用 timer 或启动学校登录。'],['scCancelBtn','cancel','取消当前任务？保留检查点与审核历史。']].forEach(function(item){node(item[0]).addEventListener('click',function(){if(!node(item[0]).disabled&&window.confirm(item[2]))mutate(item[1]);});});
  [['scRoutineBtn','routine'],['scFullBtn','full']].forEach(function(item){node(item[0]).addEventListener('click',function(){var confirmation='RUN '+item[1].toUpperCase();if(!node(item[0]).disabled&&window.prompt('已独立批准学校范围后，输入 '+confirmation+' 确认')===confirmation)mutate(item[1],{confirmation:confirmation});});});
  window.loadScheduleCollector=refresh;
  var timer=window.setInterval(function(){if(!stopped&&!document.hidden&&section.classList.contains('active'))refresh();},12000);
  window.addEventListener('pagehide',function(){stopped=true;window.clearInterval(timer);});
  if(window.location.pathname==='/admin/schedule-collector')refresh();
 })();`;
module.exports = { SCHEDULE_COLLECTOR_CARD, SCHEDULE_COLLECTOR_SECTION, SCHEDULE_COLLECTOR_STYLES, SCHEDULE_COLLECTOR_SCRIPT };
