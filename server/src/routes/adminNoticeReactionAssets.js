"use strict";
const { CATALOG } = require("../content/noticeReactions");
const NOTICE_REACTION_FORM = String.raw`
<div class="wide notice-reaction-editor"><label for="contentCenterNoticeReactionsEnabled">表情互动</label><select id="contentCenterNoticeReactionsEnabled"><option value="true">开放 · 每人一个表情</option><option value="false">关闭 · 保留已有计数</option></select><p>可切换、可撤回，不收集文字评论，不展示回应者身份。</p><label>可选表情</label><div id="contentCenterReactionChoices" class="notice-reaction-editor-grid"></div><small id="contentCenterReactionSelectionHint">选择学生可以使用的表情</small></div>`;
const NOTICE_REACTION_STYLES = String.raw`
.notice-reaction-editor { border-top:1px solid var(--border); margin-top:4px; padding-top:14px; }
.notice-reaction-editor p,.notice-reaction-editor small { color:var(--text-muted); font-size:11px; line-height:1.6; }
.notice-reaction-editor-grid { display:grid; grid-template-columns:repeat(8,minmax(0,1fr)); gap:6px; margin:8px 0; }
.notice-reaction-editor-grid button { min-height:38px; width:100%; padding:4px; border:1px solid var(--border); background:var(--surface); border-radius:9px; font-size:22px; transition:transform 150ms,background 150ms; }
.notice-reaction-editor-grid button[aria-pressed="true"] { border-color:#c83a32; background:var(--brand-soft); }
.notice-reaction-editor-grid button:hover { transform:translateY(-2px); }
.notice-reaction-admin-summary { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.notice-reaction-admin-summary span { border-radius:99px; background:var(--surface-muted); padding:4px 8px; color:var(--text-secondary); font-size:11px; }
.notice-preview-glance { flex-shrink:0; font-size:10px; color:#88716a; background:#f8f4f3; padding:3px 5px; border-radius:20px; }
.notice-preview-detail { border:1px solid #eee5e1; border-radius:16px; padding:15px; margin:10px 0; background:var(--phone-paper); color:#19202e; box-shadow:0 7px 20px #37231e0a; animation:noticePreviewIn 180ms ease-out; }
.preview-phone:has(.notice-preview-detail) { height:740px; }
.content-center-phone-stack { overflow-y:auto; overflow-x:hidden; }
.content-center-phone-stack > * { flex-shrink:0; }
.notice-preview-detail h4 { font-size:15px; line-height:1.5; margin:8px 0; overflow-wrap:anywhere; }
.notice-preview-detail p { font-size:12px; line-height:1.7; margin:10px 0; white-space:pre-wrap; overflow-wrap:anywhere; max-height:170px; overflow:auto; color:#626773; }
.notice-preview-detail .notice-preview-meta { font-size:10px; color:#98929a; }
.notice-preview-reactions { margin-top:14px; padding-top:12px; border-top:1px solid #f0eeed; }
.notice-preview-reactions header { display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#958989; margin-bottom:10px; }
.notice-preview-reactions header strong { color:#4c4040; font-size:12px; }
.notice-preview-chips { display:flex; flex-wrap:wrap; gap:6px; }
.notice-preview-chips button { display:flex; align-items:center; gap:5px; width:auto; min-height:31px; padding:5px 9px; background:#f5f5f7; color:#685e61; border:1px solid transparent; border-radius:99px; font-size:11px; }
.notice-preview-chips button span { font-size:19px; }
.notice-preview-chips button.selected { background:var(--phone-label-soft); border-color:#c83a32; color:#b4232a; }
.notice-preview-picker { margin-top:10px; border:1px solid #eee6e2; border-radius:13px; background:#faf7f5; padding:9px; }
.notice-preview-picker-grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:3px; }
.notice-preview-picker-grid button { width:100%; min-height:35px; border:1px solid transparent; padding:4px 0; font-size:24px; border-radius:8px; background:transparent; }
.notice-preview-picker-grid button.selected { background:#ffe8e4; border-color:#d7897e; }
.notice-preview-footnote { display:block; color:#aaa0a0; font-size:9px; margin-top:9px; }
.notice-preview-collapse { width:100%; margin-top:12px; border:0; border-radius:9px; background:var(--phone-label-soft); color:#b4232a; font-size:11px; padding:8px; }
@keyframes noticePreviewIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
@media(max-width:740px) { .notice-reaction-editor-grid { grid-template-columns:repeat(6,minmax(0,1fr)); } }
@media(prefers-reduced-motion:reduce) { .notice-preview-detail { animation:none; } }
`;
const NOTICE_REACTION_SCRIPT = String.raw`
var noticeReactionCatalog = ${JSON.stringify(CATALOG)};
var noticeReactionAllowed = noticeReactionCatalog.map(function(item){return item.id;});
var noticePreviewExpanded = false, noticePreviewPicker = false, noticePreviewMine = "";
function setNoticeReactionEditor(item) {
  var ids=item&&item.reactionEmojis;
  noticeReactionAllowed=Array.isArray(ids)?ids.slice():noticeReactionCatalog.map(function(entry){return entry.id;});
  setValue("contentCenterNoticeReactionsEnabled",String(!item||item.reactionsEnabled!==false));
  noticePreviewExpanded=false;noticePreviewPicker=false;noticePreviewMine="";renderNoticeReactionEditor();
}
function renderNoticeReactionEditor() {
  var grid=$("contentCenterReactionChoices");if(!grid)return;grid.textContent="";
  var enabled=value("contentCenterNoticeReactionsEnabled")!=="false";
  noticeReactionCatalog.forEach(function(item){var button=document.createElement("button");button.type="button";button.textContent=item.emoji;button.title=item.label;button.setAttribute("aria-label",item.label);button.setAttribute("aria-pressed",String(noticeReactionAllowed.indexOf(item.id)>=0));button.disabled=!enabled;button.addEventListener("click",function(){var index=noticeReactionAllowed.indexOf(item.id);if(index>=0)noticeReactionAllowed.splice(index,1);else noticeReactionAllowed.push(item.id);renderNoticeReactionEditor();renderContentPreview();});grid.appendChild(button);});
  contentCenterSetText("contentCenterReactionSelectionHint",enabled?"已选 "+noticeReactionAllowed.length+" 个表情 · 至少保留一个":"互动已关闭，已有回应会保留，用户仍可撤回");
}
function appendNoticeReactionStats(card,item) {
  var data=item.reactions||{},row=document.createElement("div");row.className="notice-reaction-admin-summary";
  var total=document.createElement("span");total.textContent=data.unavailable?"表情统计暂不可用":(data.total||0)+" 人回应 · "+(item.reactionsEnabled===false?"互动关闭":"互动开放");row.appendChild(total);
  (data.items||[]).forEach(function(entry){var pill=document.createElement("span");pill.textContent=entry.emoji+" "+entry.count;row.appendChild(pill);});card.appendChild(row);
}
function appendNoticeReactionPreview(screen,box,notice) {
  var stored=contentCenterEditingNotice&&contentCenterEditingNotice.id===notice.id?contentCenterEditingNotice.reactions:(notice.reactions||{});
  var data=stored||{},items=(data.items||[]).map(function(item){return Object.assign({},item);}),total=data.total||0;
  if(noticePreviewMine){var found=items.find(function(item){return item.id===noticePreviewMine;});if(found)found.count++;else{var entry=noticeReactionCatalog.find(function(item){return item.id===noticePreviewMine;});items.push(Object.assign({count:1},entry));}total++;}
  if(total){var glance=document.createElement("span");glance.className="notice-preview-glance";glance.textContent=items.slice(0,2).map(function(item){return item.emoji;}).join("")+" "+total;box.insertBefore(glance,box.querySelector(".content-center-phone-ticker-arrow"));}
  box.style.cursor="pointer";box.setAttribute("role","button");box.setAttribute("tabindex","0");box.setAttribute("aria-label","打开公告表情预览");
  function expand(){noticePreviewExpanded=!noticePreviewExpanded;renderContentPreview();}
  box.addEventListener("click",expand);box.addEventListener("keydown",function(event){if(event.key==="Enter"||event.key===" "){event.preventDefault();expand();}});
  if(!noticePreviewExpanded)return;
  var detail=document.createElement("div");detail.className="notice-preview-detail";detail.innerHTML="<span class='notice-preview-meta'>公告详情 · 交互预览</span><h4>"+escapeHtml(notice.title||"")+"</h4><p>"+escapeHtml(notice.content||"")+"</p>";
  var enabled=notice.reactionsEnabled!==false,allowed=notice.reactionEmojis||noticeReactionAllowed;
  if(enabled||total){var section=document.createElement("div");section.className="notice-preview-reactions";section.innerHTML="<header><strong>表情回应</strong><span>"+(total?total+" 人回应":"用一个表情，说声收到")+"</span></header>";var chips=document.createElement("div");chips.className="notice-preview-chips";
    function choose(id){noticePreviewMine=noticePreviewMine===id?"":id;noticePreviewPicker=false;renderContentPreview();}
    items.forEach(function(item){var button=document.createElement("button");button.type="button";button.className=noticePreviewMine===item.id?"selected":"";button.innerHTML="<span>"+escapeHtml(item.emoji)+"</span>"+item.count+(noticePreviewMine===item.id?" ✓":"");button.disabled=!enabled&&noticePreviewMine!==item.id;button.addEventListener("click",function(){choose(item.id);});chips.appendChild(button);});
    if(enabled){var add=document.createElement("button");add.type="button";add.textContent=noticePreviewPicker?"☺ −":"☺ +";add.setAttribute("aria-label","选择预览表情");add.addEventListener("click",function(){noticePreviewPicker=!noticePreviewPicker;renderContentPreview();});chips.appendChild(add);}section.appendChild(chips);
    if(noticePreviewPicker&&enabled){var picker=document.createElement("div");picker.className="notice-preview-picker";picker.innerHTML="<header>选一个，表达你的心情</header>";var grid=document.createElement("div");grid.className="notice-preview-picker-grid";noticeReactionCatalog.filter(function(item){return allowed.indexOf(item.id)>=0;}).forEach(function(item){var button=document.createElement("button");button.type="button";button.textContent=item.emoji;button.className=noticePreviewMine===item.id?"selected":"";button.setAttribute("aria-label",item.label);button.addEventListener("click",function(){choose(item.id);});grid.appendChild(button);});picker.appendChild(grid);section.appendChild(picker);}
    var hint=document.createElement("small");hint.className="notice-preview-footnote";hint.textContent=enabled?"每人一个表情 · 点已选表情可撤回":"表情互动已关闭";section.appendChild(hint);detail.appendChild(section);}
  var close=document.createElement("button");close.className="notice-preview-collapse";close.type="button";close.textContent="收起公告";close.addEventListener("click",expand);detail.appendChild(close);var note=document.createElement("small");note.className="notice-preview-footnote";note.textContent="预览操作不会发送真实回应";detail.appendChild(note);screen.appendChild(detail);
}
`;
module.exports = { NOTICE_REACTION_FORM, NOTICE_REACTION_STYLES, NOTICE_REACTION_SCRIPT };
