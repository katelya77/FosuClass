// Stable identifiers shared by the mini program, server and admin editor.
const CATALOG = [
  ["like", "👍", "赞"], ["heart", "❤️", "喜欢"], ["celebrate", "🎉", "庆祝"],
  ["laugh", "😂", "开心"], ["clap", "👏", "鼓掌"], ["fire", "🔥", "太棒了"],
  ["love", "🥰", "暖心"], ["star", "🤩", "期待"], ["wow", "😮", "惊讶"],
  ["think", "🤔", "思考"], ["thanks", "🙏", "感谢"], ["hundred", "💯", "满分"],
  ["smile", "😊", "微笑"], ["cool", "😎", "酷"], ["cry", "😢", "难过"],
  ["sad", "🥺", "不舍"], ["strong", "💪", "加油"], ["ok", "👌", "收到"],
  ["check", "✅", "已了解"], ["eyes", "👀", "关注"], ["hug", "🤗", "抱抱"],
  ["party", "🥳", "节日快乐"], ["flower", "🌸", "美好"], ["sun", "☀️", "好心情"],
].map((item) => ({ id: item[0], emoji: item[1], label: item[2] }));
const DEFAULT_IDS = CATALOG.map((item) => item.id);
function normalizeIds(value) {
  return Array.isArray(value) ? DEFAULT_IDS.filter((id) => value.indexOf(id) >= 0) : DEFAULT_IDS.slice();
}
function formatCount(value) {
  const count = Math.max(0, Number(value) || 0);
  return count >= 10000 ? (count / 10000).toFixed(1).replace(/\.0$/, "") + "万" : String(count);
}
module.exports = { CATALOG, DEFAULT_IDS, normalizeIds, formatCount };
