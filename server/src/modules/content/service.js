/**
 * Content domain service — re-exports appConfigService notice/news APIs.
 * Single business implementation for Legacy + Vue.
 */
const appConfigService = require("../../services/appConfigService");

module.exports = {
  listNotices: () => appConfigService.listNotices(),
  createNotice: (payload) => appConfigService.createNotice(payload),
  updateNotice: (id, payload, options) => appConfigService.updateNotice(id, payload, options),
  deleteNotice: (id) => appConfigService.deleteNotice(id),
  listNews: () => appConfigService.listNews(),
  createNews: (payload) => appConfigService.createNews(payload),
  updateNews: (id, payload, options) => appConfigService.updateNews(id, payload, options),
  deleteNews: (id) => appConfigService.deleteNews(id),
  NOTICES_PATH: appConfigService.NOTICES_PATH,
  NEWS_PATH: appConfigService.NEWS_PATH,
};
