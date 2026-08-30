const DAILY_KNOWLEDGE_STYLES = String.raw`
    /* 每日知识工作台：校园编辑部式内容编排 */
    #section-daily-knowledge { --knowledge-red:#c13b33; --knowledge-ink:#243042; --knowledge-paper:#fffdf8; --knowledge-green:#127a68; --knowledge-amber:#b45309; }
    .knowledge-hero { position:relative; display:grid; grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr); gap:28px; overflow:hidden; margin-bottom:18px; padding:26px 28px; border:1px solid color-mix(in srgb,var(--knowledge-red) 24%,var(--border)); border-radius:10px 28px 10px 10px; background:linear-gradient(118deg,var(--knowledge-paper) 0%,var(--surface) 62%,var(--brand-soft) 100%); }
    .knowledge-hero::after { content:""; position:absolute; right:-34px; bottom:-66px; width:190px; height:190px; border:28px solid color-mix(in srgb,var(--knowledge-red) 8%,transparent); border-radius:50%; pointer-events:none; }
    .knowledge-hero-copy { position:relative; z-index:1; max-width:720px; }
    .knowledge-hero-kicker { margin-bottom:8px; color:var(--knowledge-red); font-size:11px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
    .knowledge-hero h3 { margin:0; color:var(--knowledge-ink); font-size:clamp(22px,3vw,34px); line-height:1.15; }
    .knowledge-hero p { max-width:640px; margin:10px 0 0; color:var(--text-secondary); font-size:13px; line-height:1.7; }
    .knowledge-metrics { position:relative; z-index:1; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); align-self:end; gap:8px; }
    .knowledge-metric { min-width:0; padding:12px; border:1px solid var(--border); background:color-mix(in srgb,var(--surface) 88%,transparent); }
    .knowledge-metric span { display:block; color:var(--text-muted); font-size:10px; }
    .knowledge-metric strong { display:block; margin-top:4px; color:var(--knowledge-ink); font-size:20px; }
    .knowledge-studio { display:grid; grid-template-columns:minmax(230px,.72fr) minmax(360px,1.18fr) 310px; gap:16px; align-items:start; }
    .knowledge-library,.knowledge-editor { min-width:0; }
    .knowledge-library-head,.knowledge-editor-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
    .knowledge-library-head p,.knowledge-editor-head p { margin:4px 0 0; color:var(--text-muted); font-size:11px; line-height:1.5; }
    .knowledge-list { display:grid; gap:8px; max-height:650px; margin-top:14px; overflow-y:auto; padding-right:3px; }
    .knowledge-item { position:relative; padding:12px 12px 12px 16px; border:1px solid var(--border); border-radius:7px; background:var(--surface-muted); }
    .knowledge-item::before { content:""; position:absolute; inset:10px auto 10px 0; width:3px; background:var(--knowledge-green); }
    .knowledge-item.warning::before { background:var(--knowledge-amber); }
    .knowledge-item.info::before { background:var(--knowledge-red); }
    .knowledge-item-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .knowledge-item-head strong { color:var(--knowledge-ink); font-size:12px; }
    .knowledge-item p { margin:7px 0 0; color:var(--text-secondary); font-size:11px; line-height:1.55; }
    .knowledge-item-actions { display:flex; gap:6px; margin-top:10px; }
    .knowledge-item-actions button { min-height:28px; padding:4px 9px; font-size:11px; }
    .knowledge-source-label { display:inline-flex; align-items:center; min-height:20px; padding:2px 7px; border-radius:999px; background:var(--brand-soft); color:var(--knowledge-red); font-size:9px; font-weight:800; }
    .knowledge-source-label.managed { background:color-mix(in srgb,var(--knowledge-green) 12%,var(--surface)); color:var(--knowledge-green); }
    .knowledge-editor .form-row.full textarea { min-height:156px; }
    .knowledge-editor-note { margin:0; padding:10px 12px; border-left:3px solid var(--knowledge-green); background:color-mix(in srgb,var(--knowledge-green) 7%,var(--surface)); color:var(--text-secondary); font-size:11px; line-height:1.55; }
    .knowledge-preview-box { position:sticky; top:24px; }
    .knowledge-phone-home { display:grid; gap:9px; }
    .knowledge-phone-brand { padding:10px; border-radius:7px; background:var(--surface); color:var(--knowledge-ink); font-size:11px; font-weight:800; }
    .knowledge-phone-skeleton { display:grid; grid-template-columns:repeat(3,1fr); gap:4px; padding:8px; border:1px solid var(--border); border-radius:7px; background:var(--surface); }
    .knowledge-phone-skeleton span { display:block; height:42px; border-radius:4px; background:var(--surface-muted); }
    .knowledge-preview-card { position:relative; display:grid; grid-template-columns:42px 1fr; gap:9px; overflow:hidden; padding:11px; border:1px solid #dcebe6; border-radius:8px; background:linear-gradient(116deg,#eff8f4,#fffdf8 70%); }
    .knowledge-preview-card.warning { border-color:#f4ddc0; background:linear-gradient(116deg,#fff4e5,#fffdf8 70%); }
    .knowledge-preview-art { display:grid; place-items:center; width:38px; height:38px; border:1px solid color-mix(in srgb,var(--knowledge-green) 35%,transparent); border-radius:11px 50% 11px 50%; color:var(--knowledge-green); font-size:16px; font-weight:900; transform:rotate(-6deg); }
    .knowledge-preview-card.warning .knowledge-preview-art { border-color:color-mix(in srgb,var(--knowledge-amber) 35%,transparent); color:var(--knowledge-amber); }
    .knowledge-preview-meta { display:flex; justify-content:space-between; gap:6px; color:var(--knowledge-green); font-size:8px; font-weight:800; }
    .knowledge-preview-card.warning .knowledge-preview-meta { color:var(--knowledge-amber); }
    .knowledge-preview-title { margin-top:4px; color:var(--knowledge-ink); font-size:10px; font-weight:900; }
    .knowledge-preview-content { margin-top:4px; color:#586474; font-size:8px; line-height:1.5; }
    .knowledge-empty { padding:18px 8px; color:var(--text-muted); font-size:11px; line-height:1.6; text-align:left; }
    @media (max-width:1260px) { .knowledge-studio { grid-template-columns:minmax(230px,.8fr) minmax(360px,1.2fr); } .knowledge-preview-box { position:static; grid-column:1/-1; max-width:340px; } }
    @media (max-width:820px) { .knowledge-hero,.knowledge-studio { grid-template-columns:1fr; } .knowledge-metrics { grid-template-columns:repeat(3,minmax(0,1fr)); } .knowledge-preview-box { grid-column:auto; } }
    @media (max-width:520px) { .knowledge-hero { padding:20px; } .knowledge-metrics { grid-template-columns:1fr; } }
`;

const DAILY_KNOWLEDGE_SECTION = String.raw`
      <!-- 每日知识：正式版首页内容工作台 -->
      <section id="section-daily-knowledge" class="section">
        <div class="knowledge-hero">
          <div class="knowledge-hero-copy"><div class="knowledge-hero-kicker">Campus Daily Editorial</div><h3>把每天的一条提醒，做成可信赖的校园日签</h3><p>心理关怀、防诈提醒与校园常识会在正式版首页轮换展示。管理员内容优先；没有启用内容时自动回退到内置知识库，首页不会出现空白。</p></div>
          <div class="knowledge-metrics" aria-label="每日知识统计"><div class="knowledge-metric"><span>当前来源</span><strong id="dailyKnowledgeMode">内置</strong></div><div class="knowledge-metric"><span>已启用</span><strong id="dailyKnowledgeActiveCount">0</strong></div><div class="knowledge-metric"><span>内容总量</span><strong id="dailyKnowledgeTotalCount">0</strong></div></div>
        </div>
        <div class="knowledge-studio">
          <div class="card knowledge-library"><div class="knowledge-library-head"><div><h3 class="card-title" style="margin-bottom:0;">内容库</h3><p>后台内容可编辑；内置内容作为稳定兜底。</p></div><span id="dailyKnowledgeSourceBadge" class="knowledge-source-label">内置兜底</span></div><div id="dailyKnowledgeList" class="knowledge-list"></div></div>
          <div class="card form-box knowledge-editor">
            <div class="knowledge-editor-head"><div><h3 id="dailyKnowledgeFormTitle" class="card-title" style="margin-bottom:0;">新建每日知识</h3><p>保存后立即进入正式版日签池，按上海自然日稳定轮换。</p></div><button id="clearDailyKnowledgeButton" class="ghost" type="button" style="padding:4px 10px;font-size:12px;">新建</button></div>
            <div class="form-row"><div><label for="dailyKnowledgeCategory">内容分类</label><select id="dailyKnowledgeCategory"><option value="mind">心理关怀</option><option value="fraud">防诈提醒</option><option value="campus">校园日签</option></select></div><div><label for="dailyKnowledgeEnabled">展示状态</label><select id="dailyKnowledgeEnabled"><option value="true">启用并参与轮换</option><option value="false">保存为停用内容</option></select></div></div>
            <div class="form-row full"><div><label for="dailyKnowledgeTitle">卡片标题</label><input id="dailyKnowledgeTitle" maxlength="60" placeholder="例如：给情绪留一点空间"></div></div>
            <div class="form-row full"><div><label for="dailyKnowledgeContent">正文内容</label><textarea id="dailyKnowledgeContent" maxlength="500" placeholder="输入一条准确、具体、无需外部模型也能长期使用的校园知识。"></textarea></div></div>
            <div class="form-row"><div><label for="dailyKnowledgeStartAt">生效开始时间（选填）</label><input id="dailyKnowledgeStartAt" placeholder="YYYY-MM-DD HH:MM"></div><div><label for="dailyKnowledgeEndAt">生效结束时间（选填）</label><input id="dailyKnowledgeEndAt" placeholder="YYYY-MM-DD HH:MM"></div></div>
            <p class="knowledge-editor-note">正式版只读取已启用且在生效时间内的内容。所有保存、编辑和删除操作继续使用现有管理员权限、审计、备份和回滚机制。</p><button id="saveDailyKnowledgeButton" class="primary" type="button">保存到正式版内容池</button>
          </div>
          <div class="preview-box knowledge-preview-box"><h3 class="card-title" style="margin-bottom:0;">正式版首页预览</h3><div class="preview-phone"><div class="phone-bar"><span>9:41</span><span>佛课小表</span><span>Wi-Fi</span></div><div class="phone-screen knowledge-phone-home" id="dailyKnowledgePhoneScreen"></div></div></div>
        </div>
      </section>
`;

const DAILY_KNOWLEDGE_SCRIPT = String.raw`
      function dailyKnowledgeCategoryMeta(category) {
        var map={mind:{label:"心理关怀",title:"心理小知识",mark:"心",type:"success"},fraud:{label:"防诈提醒",title:"防诈小知识",mark:"盾",type:"warning"},campus:{label:"校园日签",title:"校园小知识",mark:"校",type:"info"}};
        return map[category]||map.campus;
      }
      function dailyKnowledgeCategoryForItem(item) { if(item&&["mind","fraud","campus"].indexOf(item.category)>=0)return item.category; return item&&item.type==="warning"?"fraud":(item&&item.type==="success"?"mind":"campus"); }
      function dailyKnowledgePayload() {
        var category=value("dailyKnowledgeCategory")||"mind",meta=dailyKnowledgeCategoryMeta(category),payload={title:value("dailyKnowledgeTitle")||meta.title,content:value("dailyKnowledgeContent"),category:category,type:meta.type,priority:"normal",displayMode:"daily-tip",targetPage:"home",startAt:value("dailyKnowledgeStartAt"),endAt:value("dailyKnowledgeEndAt"),enabled:boolValue("dailyKnowledgeEnabled"),closable:false};
        if(state.editingDailyKnowledgeId){var current=(state.dailyKnowledge.managed||[]).find(function(item){return item.id===state.editingDailyKnowledgeId;});if(current&&current.version)payload.expectedVersion=current.version;}
        return payload;
      }
      function updateDailyKnowledgePreview(sourceItem) {
        var category=sourceItem?dailyKnowledgeCategoryForItem(sourceItem):(value("dailyKnowledgeCategory")||"mind"),meta=dailyKnowledgeCategoryMeta(category),title=sourceItem&&sourceItem.title||value("dailyKnowledgeTitle")||meta.title,content=sourceItem&&sourceItem.content||value("dailyKnowledgeContent")||"先完成眼前最小的一步，让注意力从担心回到可以行动的事情上。",type=sourceItem&&sourceItem.type||meta.type,screen=$("dailyKnowledgePhoneScreen");
        if(!screen)return;
        screen.innerHTML="<div class='knowledge-phone-brand'>佛课小表 · 今日课表</div><div class='knowledge-phone-skeleton'><span></span><span></span><span></span></div><div class='knowledge-preview-card "+escapeHtml(type)+"'><div class='knowledge-preview-art'>"+escapeHtml(meta.mark)+"</div><div><div class='knowledge-preview-meta'><span>"+escapeHtml(meta.label)+"</span><span>今日</span></div><div class='knowledge-preview-title'>"+escapeHtml(title)+"</div><div class='knowledge-preview-content'>"+escapeHtml(content)+"</div></div></div>";
      }
      function clearDailyKnowledgeForm() { state.editingDailyKnowledgeId=""; if($("dailyKnowledgeFormTitle"))$("dailyKnowledgeFormTitle").textContent="新建每日知识"; if($("dailyKnowledgeCategory"))$("dailyKnowledgeCategory").value="mind"; if($("dailyKnowledgeEnabled"))$("dailyKnowledgeEnabled").value="true"; setValue("dailyKnowledgeTitle","给情绪留一点空间"); setValue("dailyKnowledgeContent","任务很多时，先写下眼前最小的一步并完成它，比反复担心整个任务更容易重新获得掌控感。"); setValue("dailyKnowledgeStartAt",""); setValue("dailyKnowledgeEndAt",""); updateDailyKnowledgePreview(); }
      function editDailyKnowledge(item) { state.editingDailyKnowledgeId=item.id; if($("dailyKnowledgeFormTitle"))$("dailyKnowledgeFormTitle").textContent="编辑："+item.title; if($("dailyKnowledgeCategory"))$("dailyKnowledgeCategory").value=dailyKnowledgeCategoryForItem(item); if($("dailyKnowledgeEnabled"))$("dailyKnowledgeEnabled").value=String(item.enabled!==false); setValue("dailyKnowledgeTitle",item.title); setValue("dailyKnowledgeContent",item.content); setValue("dailyKnowledgeStartAt",item.startAt?formatDate(item.startAt):""); setValue("dailyKnowledgeEndAt",item.endAt?formatDate(item.endAt):""); updateDailyKnowledgePreview(item); }
      function saveDailyKnowledge() {
        if(state.dailyKnowledgeSaving)return; var payload=dailyKnowledgePayload();
        if(!payload.content){showToast("请先填写每日知识正文","warning");if($("dailyKnowledgeContent"))$("dailyKnowledgeContent").focus();return;}
        var isEdit=Boolean(state.editingDailyKnowledgeId),path=isEdit?"/api/admin/notices/"+encodeURIComponent(state.editingDailyKnowledgeId):"/api/admin/notices",payloadFingerprint=JSON.stringify(payload);
        if(!isEdit&&(!state.dailyKnowledgeCreateOperation||state.dailyKnowledgeCreateOperation.fingerprint!==payloadFingerprint))state.dailyKnowledgeCreateOperation={fingerprint:payloadFingerprint,key:"daily-knowledge:"+Date.now()+":"+Math.random().toString(36).slice(2)};
        var headers={}; if(!isEdit)headers["Idempotency-Key"]=state.dailyKnowledgeCreateOperation.key; state.dailyKnowledgeSaving=true; var saveButton=$("saveDailyKnowledgeButton"); if(saveButton)saveButton.disabled=true;
        api(path,{method:isEdit?"PUT":"POST",headers:headers,body:JSON.stringify(payload)}).then(function(){state.dailyKnowledgeCreateOperation=null;showToast(isEdit?"每日知识已更新":"每日知识已加入正式版内容池","success");clearDailyKnowledgeForm();return Promise.all([loadDailyKnowledge(),loadNotices()]);}).catch(function(error){showToast(error.message||"每日知识保存失败","error");}).finally(function(){state.dailyKnowledgeSaving=false;if(saveButton)saveButton.disabled=false;});
      }
      function deleteDailyKnowledge(id) { if(!confirm("确定要删除这条每日知识吗？删除后无法从当前列表恢复。"))return; api("/api/admin/notices/"+encodeURIComponent(id),{method:"DELETE"}).then(function(){showToast("每日知识已删除；无可用后台内容时将自动使用内置兜底","success");if(state.editingDailyKnowledgeId===id)clearDailyKnowledgeForm();return Promise.all([loadDailyKnowledge(),loadNotices()]);}).catch(function(error){showToast(error.message||"每日知识删除失败","error");}); }
      function renderDailyKnowledge() {
        var data=state.dailyKnowledge||{},counts=data.counts||{},managed=Array.isArray(data.managed)?data.managed:[],builtin=Array.isArray(data.builtin)?data.builtin:[];
        if($("dailyKnowledgeMode"))$("dailyKnowledgeMode").textContent=data.mode==="managed"?"后台内容":"内置兜底"; if($("dailyKnowledgeActiveCount"))$("dailyKnowledgeActiveCount").textContent=String(counts.active||0); if($("dailyKnowledgeTotalCount"))$("dailyKnowledgeTotalCount").textContent=String((counts.managed||0)+(counts.builtin||0));
        var sourceBadge=$("dailyKnowledgeSourceBadge"); if(sourceBadge){sourceBadge.textContent=data.mode==="managed"?"后台内容优先":"内置兜底生效";sourceBadge.className="knowledge-source-label"+(data.mode==="managed"?" managed":"");}
        var list=$("dailyKnowledgeList"); if(!list)return; list.textContent=""; var entries=managed.map(function(item){return{item:item,source:"managed"};}).concat(builtin.map(function(item){return{item:item,source:"builtin"};})); if(!entries.length)list.innerHTML="<div class='knowledge-empty'>当前没有可用内容。点击右侧新建一条每日知识。</div>";
        entries.forEach(function(entry){var item=entry.item,meta=dailyKnowledgeCategoryMeta(dailyKnowledgeCategoryForItem(item)),card=document.createElement("article");card.className="knowledge-item "+escapeHtml(item.type||meta.type);card.innerHTML="<div class='knowledge-item-head'><strong>"+escapeHtml(item.title||meta.title)+"</strong><span class='knowledge-source-label "+(entry.source==="managed"?"managed":"")+"'>"+(entry.source==="managed"?(item.enabled===false?"后台 · 停用":"后台 · 启用"):"内置兜底")+"</span></div><p>"+escapeHtml(item.content||"")+"</p>";if(entry.source==="managed"){var actions=document.createElement("div");actions.className="knowledge-item-actions";var editButton=document.createElement("button");editButton.className="secondary";editButton.type="button";editButton.textContent="编辑";editButton.addEventListener("click",function(){editDailyKnowledge(item);});var deleteButton=document.createElement("button");deleteButton.className="danger";deleteButton.type="button";deleteButton.textContent="删除";deleteButton.addEventListener("click",function(){deleteDailyKnowledge(item.id);});actions.appendChild(editButton);actions.appendChild(deleteButton);card.appendChild(actions);}card.addEventListener("click",function(event){if(event.target&&event.target.tagName==="BUTTON")return;updateDailyKnowledgePreview(item);});list.appendChild(card);});
        if(!state.editingDailyKnowledgeId&&data.selected)updateDailyKnowledgePreview(data.selected);
      }
`;

const DAILY_KNOWLEDGE_BINDINGS = String.raw`
      ["dailyKnowledgeTitle","dailyKnowledgeContent"].forEach(function(id){safeBind(id,"input",function(){updateDailyKnowledgePreview();});});
      ["dailyKnowledgeCategory","dailyKnowledgeEnabled"].forEach(function(id){safeBind(id,"change",function(){updateDailyKnowledgePreview();});});
`;

module.exports = { DAILY_KNOWLEDGE_BINDINGS, DAILY_KNOWLEDGE_SCRIPT, DAILY_KNOWLEDGE_SECTION, DAILY_KNOWLEDGE_STYLES };
