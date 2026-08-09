(function bootstrapCampusTaskWidget(global) {
  'use strict';

  const TITLES = {
    schedule: ['课表已核验', 'SCHEDULE RESULT'],
    classroom: ['空闲空间', 'AVAILABLE ROOMS'],
    conflict: ['冲突比较', 'CONFLICT CHECK'],
    day_plan: ['今日校园计划', 'DAY PLAN'],
    error: ['查询未完成', 'RECOVERY'],
    choice: ['请确认查询对象', 'ENTITY CHOICE'],
  };

  function text(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function listItems(payload) {
    const items = Array.isArray(payload.items) ? payload.items.slice(0, 5) : [];
    if (!items.length) return '<p class="empty-note">当前条件下没有可展示的结果</p>';

    return `<ul class="result-list">${items.map((item, index) => {
      if (payload.cardType === 'classroom') {
        return `<li class="result-row room-row" style="--row-index:${index}"><div><p class="row-title">${text(item.roomName)}</p><p class="row-detail">${text(item.building)} · ${text(item.campusName)} · ${text(item.periodText)}</p></div><span class="room-capacity">${text(item.capacity)}人</span></li>`;
      }
      if (payload.cardType === 'conflict') {
        return `<li class="result-row" style="--row-index:${index}"><span class="row-slot">${text(item.periodText || `第${item.periodStart}-${item.periodEnd}节`)}</span><div><p class="row-title">${text(item.weekdayName || '')} · ${text(item.first && item.first.courseName)} ↔ ${text(item.second && item.second.courseName)}</p><p class="row-detail">${text(item.date || '')}</p></div></li>`;
      }
      if (payload.cardType === 'day_plan') {
        const title = item.type === 'lesson' ? item.courseName : (item.suggestion || item.text || '空闲时段');
        const detail = item.type === 'lesson' ? `${item.roomName || ''} · ${(item.teachers || []).join('、')}` : (item.studyRooms || []).join(' / ');
        return `<li class="result-row" style="--row-index:${index}"><span class="row-slot">${text(item.periodText || '提醒')}</span><div><p class="row-title">${text(title)}</p><p class="row-detail">${text(detail)}</p></div></li>`;
      }
      return `<li class="result-row" style="--row-index:${index}"><span class="row-slot">${text(item.periodText || item.weekdayName || '课程')}</span><div><p class="row-title">${text(item.courseName || item.name || item.roomName)}</p><p class="row-detail">${text([item.roomName, item.campusName, (item.teachers || []).join('、')].filter(Boolean).join(' · '))}</p></div></li>`;
    }).join('')}</ul>`;
  }

  function choiceItems(payload) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    return `<div class="choice-list">${items.map((item, index) => `<button class="choice-button" type="button" data-choice-id="${text(item.id)}"><span class="choice-index">${String(index + 1).padStart(2, '0')}</span><strong>${text(item.name)}</strong><span class="choice-type">${text(item.type)}</span></button>`).join('')}</div>`;
  }

  function actions(payload) {
    const list = Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : [];
    if (!list.length) return '';
    return `<footer class="card-actions">${list.map((action, index) => `<button type="button" class="action-button${index ? ' secondary' : ''}" data-action="${text(action.type)}">${text(action.label)}</button>`).join('')}</footer>`;
  }

  function render(container, input) {
    if (!container) throw new Error('CampusTaskWidget 需要有效容器');
    const payload = Object.assign({ cardType: 'error', items: [], actions: [] }, input || {});
    const title = TITLES[payload.cardType] || TITLES.error;
    const query = payload.query || {};
    const entity = payload.resolvedEntity || {};
    const timeText = payload.timeText || [query.date, query.week ? `第${query.week}周` : '', query.weekday ? `周${'一二三四五六日'[query.weekday - 1]}` : '', query.periodText].filter(Boolean).join(' · ');
    const verified = Boolean(payload.evidence && payload.evidence.verified && payload.success !== false);
    const body = payload.cardType === 'choice'
      ? choiceItems(payload)
      : payload.cardType === 'error'
        ? `<div class="conflict-band">${text((payload.error && payload.error.message) || '工具暂时无法完成本次查询，请稍后重试。')}</div>`
        : listItems(payload);
    const extra = payload.cardType === 'conflict' && payload.summary
      ? `<div class="conflict-band">${payload.summary.hasConflict ? `发现 ${text(payload.summary.conflictCount)} 处时间重叠，请调整安排。` : '未发现时间重叠。'}</div>`
      : '';

    container.innerHTML = `<article class="task-card" data-kind="${text(payload.cardType)}">
      <header class="card-mast"><div><p class="card-eyebrow">${text(title[1])}</p><h2 class="card-title">${text(payload.title || entity.name || title[0])}</h2><p class="card-time">${text(timeText || payload.subtitle || '等待查询条件')}</p></div><div class="verified-stamp">${verified ? '已核验' : '待恢复'}<small>${verified ? 'VERIFIED' : 'CHECK'}</small></div></header>
      <div class="card-meta"><div class="meta-cell"><span class="meta-label">数据版本</span><span class="meta-value">${text(payload.dataVersion || 'competition-demo-v1')}</span></div><div class="meta-cell"><span class="meta-label">查询编号</span><span class="meta-value">${text(payload.queryId || '—')}</span></div></div>
      <div class="card-body"><p class="section-label">${text(payload.sectionLabel || '结构化结果')}</p>${extra}${body}</div>${actions(payload)}
    </article>`;

    container.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => emit(container, 'action', { type: button.dataset.action, payload })));
    container.querySelectorAll('[data-choice-id]').forEach((button) => button.addEventListener('click', () => emit(container, 'choice', { id: button.dataset.choiceId, payload })));
  }

  function emit(container, kind, detail) {
    container.dispatchEvent(new CustomEvent('campus-task-widget', { bubbles: true, detail: { kind, ...detail } }));
    if (global.parent && global.parent !== global) global.parent.postMessage({ source: 'campus-task-widget', kind, detail }, '*');
  }

  global.CampusTaskWidget = Object.freeze({ render });
})(window);
