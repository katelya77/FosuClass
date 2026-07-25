/**
 * 班级别名解析器 —— 数据驱动，不硬编码任何单个班级。
 *
 * 解析策略：
 * 1. 结构化解析用户实体："24动医1" → { grade:"2024", majorAlias:"动医", classNo:1 }
 * 2. 用专业别名字典（config/major-alias-dictionary.json，可维护）+ 索引自身 majorName
 *    双向展开候选专业全称；同时支持从索引 majorName 自动生成缩写（取各分词首字），
 *    所以字典里没有的别名也能靠自动缩写命中。
 * 3. 在全校班级索引（releaseService.searchActiveIndex 全量 class 列表）中按
 *    grade + majorName + 班号 三维过滤。
 * 4. 结果：唯一匹配 → unique；多候选 → ambiguous（交给澄清）；零匹配 → not_found。
 */

const fs = require("fs");
const path = require("path");

const ALIAS_DICT_PATH = path.resolve(__dirname, "../../config/major-alias-dictionary.json");

let aliasDictCache = null;

function loadAliasDict() {
  if (aliasDictCache) return aliasDictCache;
  try {
    const raw = JSON.parse(fs.readFileSync(ALIAS_DICT_PATH, "utf8"));
    aliasDictCache = raw && typeof raw === "object" ? raw : {};
  } catch (error) {
    aliasDictCache = {};
  }
  return aliasDictCache;
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

/**
 * 解析班级实体短语。
 * 支持：24动医1 / 24动医1班 / 24动物医学1班 / 2024级动物医学1班 / 动物医学1班
 * @returns {null|{grade:string, majorAlias:string, classNo:number}}
 */
function parseClassEntity(entity) {
  const text = normalizeText(entity);
  if (!text) return null;
  // 2024级动物医学1班
  let m = text.match(/^(20\d{2})级?([\u3400-\u9fffA-Za-z]{2,16}?)(\d{1,2})班?$/);
  if (m) return { grade: m[1], majorAlias: m[2], classNo: Number(m[3]) };
  // 24动医1（两位年级 → 20xx）
  m = text.match(/^(\d{2})([\u3400-\u9fffA-Za-z]{2,16}?)(\d{1,2})班?$/);
  if (m) return { grade: `20${m[1]}`, majorAlias: m[2], classNo: Number(m[3]) };
  // 动物医学1班（无年级）
  m = text.match(/^([\u3400-\u9fffA-Za-z]{2,16}?)(\d{1,2})班$/);
  if (m) return { grade: "", majorAlias: m[1], classNo: Number(m[2]) };
  // 24动物医学（无班号）
  m = text.match(/^(20\d{2})级?([\u3400-\u9fffA-Za-z]{2,16}?)班?$/) || text.match(/^(\d{2})([\u3400-\u9fffA-Za-z]{2,16}?)班?$/);
  if (m) {
    const grade = m[1].length === 2 ? `20${m[1]}` : m[1];
    return { grade, majorAlias: m[2], classNo: 0 };
  }
  return null;
}

/**
 * 从专业全称自动生成可能的缩写：
 * 动物医学 → 动医；机械电子工程 → 机电/机械电子；汉语言文学 → 汉语言
 * 规则：去掉括号段；按语义后缀（工程/学/技术/教育/管理/设计）切分取首字组合。
 */
function autoAliases(majorName) {
  const name = normalizeText(majorName).replace(/（[^）]*）|\([^)]*\)/g, "");
  if (!name || name.length < 3) return [];
  const out = new Set();
  // 两字组合：首字+第三字（动物医学→动医）；首字+末字
  if (name.length >= 4) {
    out.add(name[0] + name[2]);
    out.add(name[0] + name[name.length - 2]);
    out.add(name[0] + name[name.length - 1]);
  }
  if (name.length === 3) {
    out.add(name[0] + name[1]);
    out.add(name[0] + name[2]);
  }
  // 去掉常见后缀的全称前缀（汉语言文学→汉语言）
  const suffixStripped = name.replace(/(工程|技术|教育|管理|设计|科学)$/, "");
  if (suffixStripped !== name && suffixStripped.length >= 2) out.add(suffixStripped);
  return Array.from(out).filter((a) => a.length >= 2 && a !== name);
}

/**
 * 在全校班级索引中解析班级。
 * @param {string} entity 用户输入的班级短语
 * @param {Array} classIndex 全校班级索引条目数组
 * @returns {{status:"unique"|"ambiguous"|"not_found", match?:object, candidates?:Array}}
 */
function resolveClass(entity, classIndex) {
  const parsed = parseClassEntity(entity);
  const items = Array.isArray(classIndex) ? classIndex : [];
  if (!items.length) return { status: "not_found", candidates: [] };

  const exact = normalizeText(entity);
  // 0. 先精确匹配 name/className（“24动物医学1班”直接命中）
  const exactHits = items.filter((item) => {
    const name = normalizeText(item.name || item.className);
    return name && name === exact;
  });
  if (exactHits.length === 1) return { status: "unique", match: exactHits[0] };
  if (exactHits.length > 1) return { status: "ambiguous", candidates: exactHits.slice(0, 5) };

  if (!parsed) {
    // 无法结构化解析：退化到名称包含匹配
    const fuzzy = items.filter((item) => {
      const name = normalizeText(item.name || item.className);
      return name && exact.length >= 2 && name.includes(exact);
    });
    if (fuzzy.length === 1) return { status: "unique", match: fuzzy[0] };
    if (fuzzy.length > 1) return { status: "ambiguous", candidates: fuzzy.slice(0, 5) };
    return { status: "not_found", candidates: [] };
  }

  // 1. 建立 别名 → 专业全称 映射（配置字典 + 索引自动缩写）
  const dict = loadAliasDict();
  const majorNames = Array.from(new Set(items.map((item) => normalizeText(item.majorName)).filter(Boolean)));
  const aliasToMajors = new Map();
  majorNames.forEach((major) => {
    const cleanMajor = major.replace(/（[^）]*）|\([^)]*\)/g, "");
    // 全称自身可匹配
    addAlias(aliasToMajors, cleanMajor, major);
    // 配置字典：{ "动物医学": ["动医", "动物医学"] }
    const dictAliases = Array.isArray(dict[cleanMajor]) ? dict[cleanMajor] : (Array.isArray(dict[major]) ? dict[major] : []);
    dictAliases.forEach((alias) => addAlias(aliasToMajors, normalizeText(alias), major));
    // 反向查字典：{ "动医": "动物医学" } 形式
    if (typeof dict[parsed.majorAlias] === "string") {
      addAlias(aliasToMajors, parsed.majorAlias, dict[parsed.majorAlias]);
    }
    // 自动缩写
    autoAliases(major).forEach((alias) => addAlias(aliasToMajors, alias, major));
  });

  // 2. 候选专业集合
  const alias = parsed.majorAlias;
  let targetMajors = aliasToMajors.get(alias) || [];
  if (!targetMajors.length) {
    // 别名不在映射里：试试别名是否为某专业的前缀/子串
    targetMajors = majorNames.filter((major) => major.includes(alias) || alias.includes(major.replace(/（[^）]*）|\([^)]*\)/g, "")));
  }
  if (!targetMajors.length) return { status: "not_found", candidates: [] };

  // 3. grade + major + classNo 三维过滤
  let pool = items.filter((item) => targetMajors.includes(normalizeText(item.majorName)));
  if (parsed.grade) {
    const graded = pool.filter((item) => String(item.grade || "") === parsed.grade);
    if (graded.length) pool = graded;
  }
  if (parsed.classNo) {
    const numbered = pool.filter((item) => {
      const name = normalizeText(item.name || item.className);
      const m = name.match(/(\d{1,2})班$/);
      return m && Number(m[1]) === parsed.classNo;
    });
    if (numbered.length) pool = numbered;
  }

  // 只保留真实班级课表（专业聚合表不是班级）
  const classOnly = pool.filter((item) => item.displayType !== "major-schedule" && !item.isAggregated);
  if (classOnly.length) pool = classOnly;

  if (pool.length === 1) return { status: "unique", match: pool[0] };
  if (pool.length > 1) return { status: "ambiguous", candidates: pool.slice(0, 5) };
  return { status: "not_found", candidates: [] };
}

function addAlias(map, alias, major) {
  const key = normalizeText(alias);
  if (!key || key.length < 2) return;
  if (!map.has(key)) map.set(key, []);
  const list = map.get(key);
  if (!list.includes(major)) list.push(major);
}

module.exports = {
  parseClassEntity,
  resolveClass,
  autoAliases,
  loadAliasDict,
  _resetCache() { aliasDictCache = null; },
};
