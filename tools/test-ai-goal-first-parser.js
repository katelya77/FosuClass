const { parseGoal } = require("../server/src/services/ai/planner/goalParser");
const { parseClassEntity, resolveClass } = require("../server/src/services/ai/classAliasResolver");
const releaseService = require("../server/src/services/releaseService");

console.log("=== goalParser v2 ===");
[
  "将24动医1的课表设为当前首页课表",
  "把24动物医学1班设成当前课表",
  "把刚刚查到的班级设为我的课表",
  "切换首页课表到25汉语言文学1班",
  "24动医1的课表",
  "怎么设置首页课表",
  "王奕章老师的课表",
].forEach((msg) => {
  const g = parseGoal(msg);
  console.log(JSON.stringify({ msg, goal: g && { goal: g.goal, entityType: g.entityType, entity: g.entity, deictic: g.deictic } }));
});

(async () => {
  const items = await releaseService.readActiveIndex("class");
  const list = Array.isArray(items) ? items : (items && items.items) || [];
  console.log("class index total:", list.length);
  console.log("sample:", JSON.stringify(list[0] || {}).slice(0, 300));
  ["24动医1", "24动物医学1班", "25汉语言文学1班", "不存在的班级9班"].forEach((e) => {
    const r = resolveClass(e, list);
    console.log(e, "→", r.status, r.match ? (r.match.name || r.match.className) : (r.candidates || []).map((c) => c.name).join("|"));
  });
})();
