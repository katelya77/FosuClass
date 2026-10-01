const http = require("../utils/request");
const options = { showLoading: false, silentError: true, suppressWarn: true, timeout: 8000, retries: 1, dedupe: false };
function endpoint(id) { return "/api/fosu/notices/" + encodeURIComponent(id) + "/reactions"; }
function unpack(response) {
  if (!response || response.success === false || !response.data) throw new Error(response && response.message || "表情暂时无法更新，请稍后重试");
  return response.data;
}
function get(id) { return http.get(endpoint(id), {}, options).then(unpack); }
function set(id, emoji) { return http.request(endpoint(id), "PUT", { emoji: emoji || null }, options).then(unpack); }
module.exports = { get, set };
