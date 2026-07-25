/**
 * Goal-first intent parser.
 * 把用户消息解析成结构化目标 { goal, entityType, entity, constraints, desiredOutcome }。
 * 操作类意图（设为/切换/绑定/修改/删除/打开/提醒…）优先于查询类意图：
 * 同一条消息里只要出现明确操作动词 + 可操作对象，就先按操作目标理解，
 * 不再落入“全校课表查询（默认 teacher）”的兜底。
 *
 * 纯函数、无 I/O、不访问模型。
 */

function normalizeText(value) {
  return String(value || "").trim();
}

function compact(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

// 操作动词 → 目标类别。顺序即优先级（更具体的放前面）。
const OPERATION_PATTERNS = [
  {
    goal: "set_current_schedule",
    verbs: /(?:设为|设置成|设置|设成|设定为|设定|切换成|切换为|切换到|切换|换成|换为|换到|绑定成|绑定为|绑定|固定为|固定|默认用|默认看)/,
    objects: /(?:当前)?(?:首页)?课表|首页|当前课表|我的课表/,
  },
  {
    // 仅“打开/查看/显示”类动词；裸“查…课表”仍走查询澄清/索引，避免与 search 链路抢意图
    goal: "open_schedule",
    verbs: /(?:打开|看看|看一下|查看|显示)/,
    objects: /(?:课表|课程表)/,
  },
  {
    goal: "create_reminder",
    verbs: /(?:创建|新建|添加|加一个|设置|设一个)/,
    objects: /(?:提醒|通知)/,
  },
  {
    goal: "update_reminder",
    verbs: /(?:修改|调整|改成|改为)/,
    objects: /(?:提醒|通知)/,
  },
  {
    goal: "delete_reminder",
    verbs: /(?:删除|取消|关闭)/,
    objects: /(?:提醒|通知)/,
  },
  {
    goal: "forget_memory",
    verbs: /(?:忘掉|忘记|删除|清除|别记|不要记)/,
    objects: /(?:记忆|记住的|称呼|名字|偏好|关系)/,
  },
];

// 实体类型推断：只返回可判定的类型；无法判定时返回 ""，绝不默认 teacher。
function inferEntityType(text) {
  const value = compact(text);
  if (!value) return "";
  if (/老师|教师|任课/.test(value)) return "teacher";
  if (/教室|课室|自习室|楼栋/.test(value)) return "classroom";
  // 教室编号：C7-305 / A1-101 / 教1-201 等
  if (/^[A-Za-z]\d{0,2}[-–—]?\d{2,4}$/.test(value) || /[A-Za-z]\d{1,2}[-–—]\d{2,4}/.test(value)) {
    return "classroom";
  }
  if (/^(?:教|实验|实训|机房)/.test(value) && /\d/.test(value)) return "classroom";
  // 班级：含“班”字，或 年级+专业+数字 模式（24动医1 / 24动物医学1班 / 2024级动物医学1班）
  if (/班级|行政班|专业|\d{2,4}级/.test(value)) return "class";
  if (/(?:^|\D)(\d{2})[\u3400-\u9fff]{2,10}\d{1,2}(?:班)?(?:$|\D)/.test(value)) return "class";
  if (/[\u3400-\u9fff]{2,12}\d{1,2}班/.test(value)) return "class";
  if (/班/.test(value) && !/老师|教师|教室/.test(value)) return "class";
  // 课程：出现“课程/科目”或纯中文课程名（无班号/老师/教室特征）
  if (/课程|科目/.test(value)) return "course";
  // 纯中文 2～12 字且无数字班号 → 倾向课程（如“有机化学”）
  if (/^[\u3400-\u9fff]{2,12}$/.test(value) && !/老师|教师|教室|课室|班/.test(value)) {
    return "course";
  }
  return "";
}

// 从操作句中提取实体短语：剥掉操作动词、目标词、语气词，保留核心实体。
function extractEntity(message, goal) {
  let text = normalizeText(message);
  // 去掉常见前缀语气
  text = text.replace(/^(?:请|帮我|麻烦|给我|我要|我想|把)/g, "");
  if (goal === "set_current_schedule") {
    // 句式 B：动词在前、实体在后 —— “切换首页课表到25汉语言文学1班” / “设为24动医1”
    const postVerb = text.match(/(?:切换成|切换为|切换到|切换|换成|换为|换到|设为|设置成|设成|设定为|设定|绑定成|绑定为|固定为)\s*(?:当前首页课表|首页课表|当前课表|我的课表|课表|首页)?\s*(?:到|为|成)?\s*([0-9A-Za-z\u3400-\u9fff]{2,20}?(?:班|\d))[\s。！？!?.]*$/);
    if (postVerb && postVerb[1] && /班|\d/.test(postVerb[1])) {
      return postVerb[1].trim();
    }
    // 句式 A：实体在前 —— “将24动医1的课表设为当前首页课表” → “24动医1”
    text = text
      .replace(/(?:设为|设置成|设置|设成|设定为|设定|切换成|切换为|切换到|换成|换为|换到|绑定成|绑定为|绑定|固定为|固定|默认用|默认看)[\s\S]*$/, "")
      .replace(/(?:的)?(?:当前)?(?:首页)?课表\s*$/, "")
      .replace(/(?:的)?课程表\s*$/, "")
      .trim();
    // “将…设为”句式中“将/把”前缀已在上面去掉
    return text.replace(/^(?:将|把)/, "").trim();
  }
  if (goal === "open_schedule") {
    let entity = text
      .replace(/^(?:请|帮我|麻烦|给我|我要|我想|把)/g, "")
      .replace(/(?:打开|看看|看一下|查看|显示)/g, " ")
      // “查” alone often means “查询” without a concrete entity — strip carefully
      .replace(/(?:^|[\s，,])查(?:一下|下|询)?/g, " ")
      .replace(/课表|课程表/g, " ")
      .replace(/[的地得]/g, " ")
      .replace(/\s+/g, "")
      .trim();
    // 剥离纯语气残留（保留「老师」供 inferEntityType 识别 teacher，q 在 toolRegistry 再剥离称谓）
    entity = entity.replace(/^(?:一下|下|下下)+|(?:一下|下)$/g, "").trim();
    return entity;
  }
  return text;
}

/** 仅类型词、无具体名称 → 不算可执行实体 */
function isGenericTypeEntity(entity) {
  const value = compact(entity);
  if (!value) return true;
  return /^(?:老师|教师|任课老师|教室|课室|班级|行政班|课程|科目|课表|课程表)$/.test(value);
}

// “把刚刚查到的班级设为我的课表”这类无显式实体、依赖上下文的指令。
function isDeicticReference(text) {
  const value = compact(text);
  return /(?:刚刚|刚才|刚刚查到|刚查到|这个|那个|当前|上面)(?:查到|看到|搜到|查的|搜的)?的?(?:班级|课表|老师|教室)?/.test(value)
    && !/\d{2}[\u3400-\u9fff]{2,10}\d/.test(value)
    && !/[\u3400-\u9fff]{2,12}\d{1,2}班/.test(value);
}

/**
 * 解析消息目标。返回 null 表示不是可识别的操作目标（交给后续查询路由）。
 * @returns {null|{goal:string, entityType:string, entity:string, constraints:object, desiredOutcome:string, explicitCommand:boolean, deictic:boolean}}
 */
function parseGoal(message, context = {}) {
  const raw = normalizeText(message);
  const text = compact(raw);
  if (!text) return null;

  for (const rule of OPERATION_PATTERNS) {
    if (!rule.verbs.test(text) || !rule.objects.test(text)) continue;
    const goal = rule.goal;
    // 查询语义保护：疑问句（“怎么设”“在哪设置”）不是操作指令
    if (/怎么|如何|哪(?:里|儿)|能不能|可以吗|是什么|为什么/.test(text) && !/^(?:请|帮我|把|将)/.test(text)) {
      return null;
    }
    const deictic = isDeicticReference(text);
    let entity = deictic ? "" : extractEntity(raw, goal);
    // 泛型实体（“老师/教室/课表”本身）不算可执行对象 → 留给后续 clarify
    if (entity && isGenericTypeEntity(entity)) {
      if (goal === "open_schedule") {
        // “帮我查老师课表” 不是打开具体老师；返回 null 走查询澄清链路
        return null;
      }
      entity = "";
    }
    const entityType = entity ? inferEntityType(entity) : (deictic ? "class" : "");
    // 操作指令必须能落到实体或上下文指代，否则不算明确操作
    if (!entity && !deictic) return null;

    const resolvedEntityType = entityType || (goal === "set_current_schedule" ? "class" : "");
    return {
      goal,
      entityType: resolvedEntityType,
      entity,
      normalizedEntity: compact(entity),
      constraints: {},
      confidence: resolvedEntityType ? 0.92 : (entity ? 0.7 : 0.5),
      needsClarification: !resolvedEntityType && !deictic,
      source: "rule_parser",
      desiredOutcome: goal === "set_current_schedule"
        ? "首页当前课表切换为目标班级课表"
        : (goal === "open_schedule" ? "打开目标课表并展示卡片" : goal),
      // explicit_user_command：消息本身就是用户明确指令，无需二次确认
      explicitCommand: true,
      deictic,
    };
  }
  return null;
}

module.exports = {
  parseGoal,
  inferEntityType,
  extractEntity,
  isDeicticReference,
  isGenericTypeEntity,
};
