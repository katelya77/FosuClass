/**
 * Content domain service — re-exports appConfigService notice/news APIs.
 * Single business implementation for Legacy + Vue.
 */
const appConfigService = require("../../services/appConfigService");

module.exports = {
  listNotices: () => appConfigService.listNotices(),
  getDailyKnowledgeAdminState: (now) => appConfigService.getDailyKnowledgeAdminState(now),
  saveDailyKnowledgePolicy: (payload) => appConfigService.saveDailyKnowledgePolicy(payload),
  exportDailyKnowledgePack: (scope, now) => appConfigService.exportDailyKnowledgePack(scope, now),
  seedBuiltinDailyKnowledge: (options) => appConfigService.seedBuiltinDailyKnowledge(options),
  bulkDailyKnowledge: (payload, options) => appConfigService.bulkDailyKnowledge(payload, options),
  importDailyKnowledgePack: (payload, options) => appConfigService.importDailyKnowledgePack(payload, options),
  createNotice: (payload, options) => appConfigService.createNotice(payload, options),
  createNoticeOperation: (payload, options) => appConfigService.createNoticeOperation(payload, options),
  updateNotice: (id, payload, options) => appConfigService.updateNotice(id, payload, options),
  deleteNotice: (id) => appConfigService.deleteNotice(id),
  listNews: () => appConfigService.listNews(),
  createNews: (payload) => appConfigService.createNews(payload),
  updateNews: (id, payload, options) => appConfigService.updateNews(id, payload, options),
  deleteNews: (id) => appConfigService.deleteNews(id),
  NOTICES_PATH: appConfigService.NOTICES_PATH,
  CONFIG_PATH: appConfigService.CONFIG_PATH,
  NOTICE_IDEMPOTENCY_PATH: appConfigService.NOTICE_IDEMPOTENCY_PATH,
  NEWS_PATH: appConfigService.NEWS_PATH,
};
