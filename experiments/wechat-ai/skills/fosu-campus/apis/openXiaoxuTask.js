const publicData = require('../client');

module.exports = function openXiaoxuTask(args) {
  const question = publicData.text(args && args.question, 80);
  if (!question || question.length < 2 || publicData.isSensitive(question) || /[\x00-\x1f\x7f]/.test(question)) {
    return publicData.resultError('请用不含个人信息的简短语句描述任务；凭据、学号和课表文件只能在小程序内处理。');
  }
  const pagePath = `/packageXiaofu/pages/ai-assistant/ai-assistant?${publicData.queryString({ q: question })}`;
  return publicData.resultOk('已准备进入佛课小表内的小序校园管家继续处理。个人数据在小程序内读取，写操作由用户在小程序内确认。', {
    pageTitle: '打开小序校园管家', pagePath,
  }, publicData.pageHandoff(pagePath));
};
