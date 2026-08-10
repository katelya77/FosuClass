(function bootstrapCampusTaskWidget(global) {
  "use strict";

  const CARD_META = {
    schedule: { eyebrow: "SCHEDULE / VERIFIED", fallbackTitle: "课表结果" },
    classroom: { eyebrow: "SPACE / AVAILABLE", fallbackTitle: "空教室结果" },
    conflict: { eyebrow: "RISK / CONFLICT", fallbackTitle: "冲突与赶场" },
    day_plan: { eyebrow: "DAY PLAN / TIMELINE", fallbackTitle: "今日校园计划" },
    choice: { eyebrow: "CONFIRM / ENTITY", fallbackTitle: "确认查询对象" },
    error: { eyebrow: "RECOVERY / ACTION", fallbackTitle: "任务恢复" },
  };

  function text(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function filters(view) {
    const list = array(view.filters);
    if (!list.length) return "";
    return `<div class="filter-strip" aria-label="当前查询条件">${list.map((item) => `<span class="filter-chip">${text(item.label)}</span>`).join("")}</div>`;
  }

  function verifiedStamp(view) {
    const verified = Boolean(view.success !== false && view.evidence && view.evidence.verified === true);
    return `<div class="verified-stamp${verified ? "" : " pending"}"><span>${verified ? "已核验" : "未核验"}</span><small>${verified ? "VERIFIED" : "CHECK"}</small></div>`;
  }

  function summaryMetric(label, value) {
    return `<div class="summary-metric"><strong>${text(value)}</strong><span>${text(label)}</span></div>`;
  }

  function scheduleBody(view) {
    const items = array(view.items);
    if (!items.length) return `<div class="empty-state"><strong>当前范围没有课程</strong><span>可以换一天或查看整周。</span></div>`;
    const rows = items.map((item, index) => `<li class="timeline-item" style="--row-index:${index}">
      <div class="timeline-slot"><span>${text(item.periodText || "课程")}</span><small>${text([item.startTime, item.endTime].filter(Boolean).join("–"))}</small></div>
      <div class="timeline-content">
        <h3>${text(item.courseName || "未命名课程")}</h3>
        <p>${text([item.campusName, item.building, item.roomName].filter(Boolean).join(" · "))}</p>
        <p class="micro-copy">${text([array(item.teachers).join("、"), array(item.classes).join("、")].filter(Boolean).join(" · "))}</p>
      </div>
    </li>`).join("");
    const hidden = Number(view.summary && view.summary.hiddenCount || 0);
    return `<ol class="timeline-list">${rows}</ol>${hidden > 0 ? `<div class="more-summary">还有 ${hidden} 条未在首屏展开，可通过“查看整周”继续。</div>` : ""}`;
  }

  function classroomBody(view) {
    const items = array(view.items);
    if (!items.length) {
      return `<div class="empty-state room-empty"><strong>没有满足全部条件的空闲教室</strong><span>可以放宽容量、取消楼栋限制或换一个时段。</span></div>`;
    }
    const rows = items.map((item, index) => `<li class="room-card" style="--row-index:${index}">
      <div class="room-main">
        <div><h3>${text(item.roomName)}</h3><p>${text([item.campusName, item.building].filter(Boolean).join(" · "))}</p></div>
        <span class="capacity-ticket">${text(item.capacity || "—")}<small>人</small></span>
      </div>
      <div class="room-meta"><span>${text(item.roomType || "教室")}</span><span>${text(item.periodText || "")}</span></div>
    </li>`).join("");
    const total = Number(view.summary && view.summary.totalCount || items.length);
    const hidden = Number(view.summary && view.summary.hiddenCount || 0);
    return `<div class="result-count"><strong>${total}</strong><span>间符合当前条件</span></div><ul class="room-grid">${rows}</ul>${hidden > 0 ? `<div class="more-summary">首屏展示 ${items.length} 间，还有 ${hidden} 间可继续筛选。</div>` : ""}`;
  }

  function conflictLesson(lesson) {
    if (!lesson) return "—";
    return `${text(lesson.courseName || "课程")} · ${text(lesson.periodText || "")} · ${text([lesson.campusName, lesson.roomName].filter(Boolean).join(" · "))}`;
  }

  function conflictBody(view) {
    const summary = view.summary || {};
    const conflicts = array(view.items);
    const rushWarnings = array(view.rushWarnings);
    const statusClass = summary.conflictCount > 0 ? "danger" : rushWarnings.length > 0 ? "warning" : "safe";
    const statusText = summary.conflictCount > 0
      ? `发现 ${summary.conflictCount} 处时间重叠`
      : rushWarnings.length > 0
        ? `无时间冲突，但有 ${rushWarnings.length} 条赶场提醒`
        : "未发现时间冲突或赶场风险";

    const conflictRows = conflicts.length
      ? `<section class="risk-section"><p class="section-label">时间冲突</p>${conflicts.map((item, index) => `<div class="conflict-band" style="--row-index:${index}">
          <strong>${text([item.date, item.weekdayName, item.periodText].filter(Boolean).join(" · "))}</strong>
          <span>${conflictLesson(item.first)}</span>
          <em>⇄</em>
          <span>${conflictLesson(item.second)}</span>
        </div>`).join("")}</section>`
      : "";

    const rushRows = rushWarnings.length
      ? `<section class="risk-section"><p class="section-label">跨校区赶场</p>${rushWarnings.map((item, index) => `<div class="risk-band" style="--row-index:${index}">
          <div class="risk-time"><strong>${text(item.gapMinutes)} min</strong><span>${text(item.weekdayName || "")}</span></div>
          <div><p>${conflictLesson(item.from)}</p><span class="risk-arrow">→</span><p>${conflictLesson(item.to)}</p></div>
        </div>`).join("")}</section>`
      : "";

    return `<div class="status-band ${statusClass}">${text(statusText)}</div>${conflictRows}${rushRows}`;
  }

  function dayPlanBody(view) {
    const summary = view.summary || {};
    const items = array(view.items);
    const metrics = `<div class="summary-grid">${summaryMetric("课程", summary.lessonCount || 0)}${summaryMetric("空档", summary.gapCount || 0)}${summaryMetric("赶场", summary.hasCrossCampus ? "有" : "无")}</div>`;
    if (!items.length) return `${metrics}<div class="empty-state"><strong>今天没有需要展示的校园任务</strong><span>可以换一天继续规划。</span></div>`;

    const rows = items.map((item, index) => {
      const kind = ["lesson", "gap", "study", "risk"].includes(item.type) ? item.type : "note";
      const title = kind === "lesson" ? item.courseName : item.suggestion || (kind === "gap" ? "空闲时段" : "校园提醒");
      const detail = kind === "lesson"
        ? [item.campusName, item.roomName, array(item.teachers).join("、")].filter(Boolean).join(" · ")
        : array(item.studyRooms).join(" / ");
      return `<li class="plan-item ${kind}" style="--row-index:${index}">
        <div class="plan-node"></div>
        <div class="plan-time"><strong>${text(item.periodText || "提醒")}</strong><small>${text([item.startTime, item.endTime].filter(Boolean).join("–"))}</small></div>
        <div class="plan-content"><h3>${text(title || "校园任务")}</h3><p>${text(detail)}</p></div>
      </li>`;
    }).join("");
    return `${metrics}<ol class="plan-timeline">${rows}</ol>`;
  }

  function choiceBody(view, actionStore) {
    const items = array(view.items);
    if (!items.length) return `<div class="empty-state"><strong>暂时没有可选候选</strong><span>请重新描述查询对象。</span></div>`;
    return `<div class="choice-list">${items.map((item, index) => {
      const key = `choice-${index}`;
      actionStore.set(key, item.action);
      return `<button class="choice-button" type="button" data-choice-action="${key}">
        <span class="choice-index">${String(index + 1).padStart(2, "0")}</span>
        <span><strong>${text(item.name)}</strong><small>${text(item.description || "点击后继续原任务")}</small></span>
        <span class="choice-type">${text(item.type)}</span>
      </button>`;
    }).join("")}</div>`;
  }

  function errorBody(view) {
    const error = view.error || {};
    return `<div class="recovery-panel"><span class="recovery-mark">!</span><div><h3>${text(view.title || "这次没有查成功")}</h3><p>${text(error.message || "工具暂时无法完成本次任务，请修改条件或稍后重试。")}</p><small>动态事实未通过核验时，小序不会用模型补造结果。</small></div></div>`;
  }

  function actions(view, actionStore) {
    const list = array(view.actions).slice(0, 3);
    if (!list.length) return "";
    return `<footer class="card-actions">${list.map((action, index) => {
      const key = `footer-${index}`;
      actionStore.set(key, action);
      return `<button type="button" class="action-button${index === 0 ? " primary" : " secondary"}" data-action-key="${key}">${text(action.label)}</button>`;
    }).join("")}</footer>`;
  }

  function bodyFor(view, actionStore) {
    if (view.cardType === "schedule") return scheduleBody(view);
    if (view.cardType === "classroom") return classroomBody(view);
    if (view.cardType === "conflict") return conflictBody(view);
    if (view.cardType === "day_plan") return dayPlanBody(view);
    if (view.cardType === "choice") return choiceBody(view, actionStore);
    return errorBody(view);
  }

  function render(container, input) {
    if (!container) throw new Error("CampusTaskWidget 需要有效容器");
    const view = Object.assign({
      schemaVersion: "campus-widget/v2",
      cardType: "error",
      success: false,
      filters: [],
      summary: {},
      items: [],
      actions: [],
      interaction: { waitForUser: false },
      evidence: { verified: false },
    }, input || {});
    const meta = CARD_META[view.cardType] || CARD_META.error;
    const actionStore = new Map();
    const safeBody = bodyFor(view, actionStore);
    const safeActions = actions(view, actionStore);
    const verified = Boolean(view.success !== false && view.evidence && view.evidence.verified === true);

    container.innerHTML = `<article class="task-card" data-kind="${text(view.cardType)}" data-verified="${verified ? "true" : "false"}">
      <header class="card-mast">
        <div class="card-heading">
          <p class="card-eyebrow">${text(meta.eyebrow)}</p>
          <h2 class="card-title">${text(view.title || meta.fallbackTitle)}</h2>
          ${view.subtitle ? `<p class="card-subtitle">${text(view.subtitle)}</p>` : ""}
          ${view.timeText ? `<p class="card-time">${text(view.timeText)}</p>` : ""}
        </div>
        ${verifiedStamp(view)}
      </header>
      ${filters(view)}
      <div class="card-body">${safeBody}</div>
      <div class="trust-strip"><span>DATA</span><strong>${text(view.dataVersion || "competition-demo-v1")}</strong><span>QUERY</span><strong>${text(view.queryId || "—")}</strong></div>
      ${safeActions}
    </article>`;

    container.querySelectorAll("[data-action-key]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = actionStore.get(button.dataset.actionKey);
        if (action) emit(container, "action", { action });
      });
    });
    container.querySelectorAll("[data-choice-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = actionStore.get(button.dataset.choiceAction);
        if (action) emit(container, "choice", { action });
      });
    });
  }

  function emit(container, kind, detail) {
    const safeDetail = { kind, action: detail && detail.action ? detail.action : null };
    container.dispatchEvent(new CustomEvent("campus-task-widget", { bubbles: true, detail: safeDetail }));
    if (global.parent && global.parent !== global) {
      global.parent.postMessage({ source: "campus-task-widget", ...safeDetail }, "*");
    }
  }

  global.CampusTaskWidget = Object.freeze({ render });
})(window);
