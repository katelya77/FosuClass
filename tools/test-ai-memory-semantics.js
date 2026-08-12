// 第五章行为验证：preferredName 收窄 / namedRelation 关系记忆 / 隐私黑名单 / Working Memory 落地与遗忘
process.env.AI_AGENT_ENABLED = process.env.AI_AGENT_ENABLED || "false";
const assert = require("assert");

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log("PASS " + name);
  } catch (e) {
    fail++;
    console.log("FAIL " + name + " :: " + e.message);
  }
}

const extractor = require("../server/src/services/ai/memory/memoryCandidateExtractor");
const wm = require("../server/src/services/ai/memory/workingMemory");
const { MemoryController } = require("../server/src/services/ai/memory/memoryController");

function pick(candidates, prefix) {
  return candidates.filter((c) => String(c.key || "").startsWith(prefix));
}

// ---------- preferredName 收窄 ----------
check("preferredName: 「我叫X」提取", () => {
  const out = extractor.extractFromMessage("我叫思囿");
  assert.strictEqual(pick(out, "preferredName").length, 1);
  assert.strictEqual(pick(out, "preferredName")[0].value, "思囿");
});
check("preferredName: 「我的名字叫X」提取", () => {
  const out = extractor.extractFromMessage("我的名字叫思囿");
  assert.strictEqual(pick(out, "preferredName").length, 1);
});
check("preferredName: 「以后叫我X」提取", () => {
  const out = extractor.extractFromMessage("以后叫我小思");
  assert.strictEqual(pick(out, "preferredName").length, 1);
});
check("preferredName: 「记住我的名字是X」不再提取（收窄）", () => {
  const out = extractor.extractFromMessage("记住我的名字是张三");
  assert.strictEqual(pick(out, "preferredName").length, 0);
});
check("preferredName: 「我的名字是张三」不再提取（收窄）", () => {
  const out = extractor.extractFromMessage("我的名字是张三");
  assert.strictEqual(pick(out, "preferredName").length, 0);
});

// ---------- namedRelation ----------
check("namedRelation: 「我妈妈叫刘秀英」提取 relation+name，scope=working", () => {
  const out = extractor.extractFromMessage("我妈妈叫刘秀英");
  const rel = pick(out, "namedRelation:");
  assert.strictEqual(rel.length, 1);
  assert.strictEqual(rel[0].value.relation, "mother");
  assert.strictEqual(rel[0].value.displayRelation, "妈妈");
  assert.strictEqual(rel[0].value.name, "刘秀英");
  assert.strictEqual(rel[0].scope, "working");
});
check("namedRelation: 「我爸是李刚」提取 father", () => {
  const out = extractor.extractFromMessage("我爸是李刚。");
  const rel = pick(out, "namedRelation:");
  assert.strictEqual(rel.length, 1);
  assert.strictEqual(rel[0].value.relation, "father");
  assert.strictEqual(rel[0].value.name, "李刚");
});
check("namedRelation: 「我的辅导员是陈老师」提取 counselor", () => {
  const out = extractor.extractFromMessage("我的辅导员是陈老师，");
  const rel = pick(out, "namedRelation:");
  assert.strictEqual(rel.length, 1);
  assert.strictEqual(rel[0].value.relation, "counselor");
});
check("namedRelation: 「我妈妈叫我去吃饭」不误匹配", () => {
  const out = extractor.extractFromMessage("我妈妈叫我去吃饭");
  assert.strictEqual(pick(out, "namedRelation:").length, 0);
});
check("namedRelation: 「忘掉我妈妈」产出 forget 候选", () => {
  const out = extractor.extractFromMessage("忘掉我妈妈");
  const f = pick(out, "namedRelationForget:");
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].value.relation, "mother");
});

// ---------- 隐私黑名单 ----------
check("黑名单: 手机号内容整体不提取", () => {
  const out = extractor.extractFromMessage("我叫张三，电话13812345678");
  assert.strictEqual(out.length, 0);
});
check("黑名单: 身份证内容整体不提取", () => {
  const out = extractor.extractFromMessage("我叫张三，身份证号44010219900307421X");
  assert.strictEqual(out.length, 0);
});
check("黑名单: 住址内容整体不提取", () => {
  const out = extractor.extractFromMessage("我叫张三，家庭住址是江湾路18号");
  assert.strictEqual(out.length, 0);
});

// ---------- controller 落地 ----------
function makeController(spies) {
  return new MemoryController({
    conversationMemory: {
      persistAfterSuccess(input) {
        spies.persisted.push(input);
        return { persisted: true, revision: 1 };
      },
    },
    userMemory: {
      commit(input) {
        spies.userCommits.push(input);
        return { persisted: false, keys: [] };
      },
    },
  });
}

check("load: empty server slots do not erase sanitized current request slots", () => {
  const controller = new MemoryController({
    conversationMemory: {
      loadForChat(input) {
        return {
          principal: { principalKey: "t", authenticated: true },
          state: { workingMemory: wm.emptyWorkingMemory(), contextSlots: { className: "", week: null } },
          memory: { mode: "session_state" },
          context: input.context,
        };
      },
    },
    userMemory: {
      load() { return { items: [], values: {}, revision: 0, policy: {} }; },
      retrieve() { return { items: [], episodes: [], revision: 0 }; },
    },
  });
  const loaded = controller.load({
    message: "查课表",
    context: { conversationSlots: { className: "25动医6班", week: 8 } },
  });
  assert.strictEqual(loaded.conversationState.workingMemory.className, "25动医6班");
  assert.strictEqual(loaded.conversationState.workingMemory.teachingWeek, 8);
});

check("commit: current turn working memory wins over empty persisted state", () => {
  const spies = { persisted: [], userCommits: [] };
  const controller = makeController(spies);
  const current = wm.updateWorkingMemory(wm.emptyWorkingMemory(), {
    contextSlots: { className: "25动医6班", week: 8 },
  });
  const result = controller.commit({
    principal: { principalKey: "t", authenticated: true },
    state: { workingMemory: wm.emptyWorkingMemory(), contextSlots: {}, recentTurns: [], conversationSummary: "" },
    workingMemory: current,
    memoryMode: "session_state",
    message: "那周三呢",
    contextSlots: { weekday: 3 },
    runId: "r-current-working",
    status: "completed",
  });
  assert.strictEqual(result.workingMemory.className, "25动医6班");
  assert.strictEqual(result.workingMemory.teachingWeek, 8);
  assert.strictEqual(result.workingMemory.weekday, 3);
});

check("commit: failed turn preserves current working view without persisting", () => {
  const spies = { persisted: [], userCommits: [] };
  const controller = makeController(spies);
  const current = wm.updateWorkingMemory(wm.emptyWorkingMemory(), {
    contextSlots: { className: "25动医6班" },
  });
  const result = controller.commit({
    principal: { principalKey: "t", authenticated: true },
    state: { workingMemory: wm.emptyWorkingMemory(), contextSlots: {} },
    workingMemory: current,
    memoryMode: "session_state",
    failed: true,
    status: "failed",
  });
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.workingMemory.className, "25动医6班");
  assert.strictEqual(spies.persisted.length, 0);
});

check("commit: namedRelation 落地 workingMemory.namedRelations 且 durable=false", () => {
  const spies = { persisted: [], userCommits: [] };
  const controller = makeController(spies);
  const r = controller.commit({
    principal: { principalKey: "t", authenticated: true },
    state: { workingMemory: wm.emptyWorkingMemory(), contextSlots: {}, recentTurns: [], conversationSummary: "" },
    memoryMode: "cloud_sync",
    message: "我妈妈叫刘秀英",
    runId: "r1",
  });
  assert.strictEqual(r.workingMemory.namedRelations.length, 1);
  assert.strictEqual(r.workingMemory.namedRelations[0].name, "刘秀英");
  assert.strictEqual(r.workingMemory.namedRelations[0].relation, "mother");
  // 第三方人物信息默认不进长期 User Memory
  const committed = spies.userCommits[0];
  const durableKeys = (committed.candidates || []).filter((c) => c.durable).map((c) => c.key);
  assert.ok(!durableKeys.some((k) => k.startsWith("namedRelation")), "namedRelation 不得 durable");
});

check("commit: 同 relation 覆盖即纠正", () => {
  const spies = { persisted: [], userCommits: [] };
  const controller = makeController(spies);
  const prev = wm.emptyWorkingMemory();
  prev.namedRelations = [{ relation: "mother", displayRelation: "妈妈", name: "刘秀英" }];
  const r = controller.commit({
    principal: { principalKey: "t", authenticated: true },
    state: { workingMemory: prev, contextSlots: {}, recentTurns: [], conversationSummary: "" },
    memoryMode: "cloud_sync",
    message: "不对，我妈妈叫刘英秀",
    runId: "r2",
  });
  assert.strictEqual(r.workingMemory.namedRelations.length, 1);
  assert.strictEqual(r.workingMemory.namedRelations[0].name, "刘英秀");
});

check("commit: forget 候选删除对应 relation", () => {
  const spies = { persisted: [], userCommits: [] };
  const controller = makeController(spies);
  const prev = wm.emptyWorkingMemory();
  prev.namedRelations = [{ relation: "mother", displayRelation: "妈妈", name: "刘秀英" }];
  const r = controller.commit({
    principal: { principalKey: "t", authenticated: true },
    state: { workingMemory: prev, contextSlots: {}, recentTurns: [], conversationSummary: "" },
    memoryMode: "cloud_sync",
    message: "忘掉我妈妈",
    runId: "r3",
  });
  assert.strictEqual(r.workingMemory.namedRelations.length, 0);
});

check("summarizeWorkingMemory: 含当前课表与关系摘要", () => {
  const w = wm.emptyWorkingMemory();
  w.currentScheduleTarget = { type: "class", detailId: "d1", name: "24动物医学1班" };
  w.namedRelations = [{ relation: "mother", displayRelation: "妈妈", name: "刘秀英" }];
  const s = wm.summarizeWorkingMemory(w);
  assert.ok(s.includes("当前课表 24动物医学1班"), "含当前课表");
  assert.ok(s.includes("妈妈=刘秀英"), "含关系");
});

console.log("---");
console.log("pass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
