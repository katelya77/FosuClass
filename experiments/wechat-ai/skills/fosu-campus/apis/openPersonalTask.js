const publicData = require('../client');

const TASKS = Object.freeze({
  today: { question: '今天有什么课', title: '在小序查看今日课程' },
  tomorrow: { question: '明天有什么课', title: '在小序查看明日课程' },
  next: { question: '我的下一节课', title: '在小序查看下一节课' },
  week: { question: '本周有什么课', title: '在小序查看本周课程' },
  reminder: { question: '查看我的课程提醒', title: '在小序查看课程提醒' },
  import: { question: '', title: '在小程序导入个人课表' },
});

module.exports = function openPersonalTask(args) {
  const task = args && typeof args === 'object' ? args.task : '';
  if (!Object.prototype.hasOwnProperty.call(TASKS, task)) {
    return publicData.resultError('请明确是查看今日、明日、下一节、本周课程、提醒，还是导入个人课表。');
  }
  const selected = TASKS[task];
  const pagePath = task === 'import'
    ? '/pages/personal-sync/personal-sync'
    : `/packageXiaofu/pages/ai-assistant/ai-assistant?${publicData.queryString({ q: selected.question })}`;
  const message = task === 'import'
    ? '请在佛课小表的小程序内完成个人课表导入；不要在微信 AI 对话中提交文件或凭据。'
    : `请打开佛课小表内的小序校园管家继续“${selected.question}”。个人课表只在小程序内读取。`;
  return publicData.resultOk(message, {
    task,
    pageTitle: selected.title,
    pagePath,
  }, publicData.pageHandoff(pagePath));
};
