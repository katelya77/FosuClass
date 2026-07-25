#!/usr/bin/env node
/**
 * Teacher college filter — real production filter functions + optional live pack.
 * Always exercises enrichTeacherCollegeFields + filterActiveIndexItems / searchActiveIndex(_items).
 * Live active pack is additional evidence when present (not required for CI green).
 */
const fs = require("fs");
const path = require("path");
const releaseService = require("../server/src/services/releaseService");
const { buildCacheKey } = require("../server/src/services/ai/planner/toolResultCache");

const SCRATCH = process.env.GROK_SCRATCH
  || path.join(process.env.TEMP || process.env.TMP || ".", "grok-goal-teacher");
try { fs.mkdirSync(SCRATCH, { recursive: true }); } catch (e) { /* ignore */ }

let pass = 0;
let fail = 0;
const lines = [];
function check(name, cond, extra) {
  const msg = cond ? `PASS ${name}` : `FAIL ${name}${extra ? ` :: ${extra}` : ""}`;
  lines.push(msg);
  console.log(msg);
  if (cond) pass += 1; else fail += 1;
}

if (typeof releaseService.clearDerivedCache === "function") {
  releaseService.clearDerivedCache();
}

// ========== 1) Pure enrich fixture ==========
const fixtureTeachers = [
  { id: "t-a", name: "白银山", teacherName: "白银山" },
  { id: "t-b", name: "蔡晨晖", teacherName: "蔡晨晖" },
  { id: "t-c", name: "白志红", teacherName: "白志红" },
  { id: "t-d", name: "无名氏", teacherName: "无名氏" },
  { id: "t-e", name: "王安", teacherName: "王安" },
];
const fixtureClasses = [
  { name: "25动物医学1班", collegeCode: "04", collegeName: "动物科技学院" },
  { name: "25光电1班", collegeCode: "02", collegeName: "物理与光电工程学院" },
];
const fixtureResources = {
  teacherSchedules: [
    {
      teacherName: "白银山",
      courses: [{ className: "25动物医学1班", collegeCode: "04", collegeName: "动物科技学院" }],
    },
    {
      teacherName: "蔡晨晖",
      courses: [{ className: "25光电1班", collegeCode: "02", collegeName: "物理与光电工程学院" }],
    },
    {
      teacherName: "白志红",
      courses: [
        { collegeCode: "04", collegeName: "动物科技学院" },
        { collegeCode: "02", collegeName: "物理与光电工程学院" },
      ],
    },
    {
      teacherName: "王安",
      courses: [{ collegeCode: "04", collegeName: "动物科技学院" }],
    },
  ],
};

const enriched = releaseService.enrichTeacherCollegeFields(fixtureTeachers, fixtureClasses, fixtureResources);
check("enrich 白银山 → 04", enriched.find((t) => t.name === "白银山").collegeCodes.includes("04"));
check("enrich 蔡晨晖 → 02", enriched.find((t) => t.name === "蔡晨晖").collegeCodes.includes("02"));
check("enrich 白志红 multi", {
  codes: enriched.find((t) => t.name === "白志红").collegeCodes,
}.codes.includes("04") && enriched.find((t) => t.name === "白志红").collegeCodes.includes("02"));
check("enrich 无名氏 学院待确认", enriched.find((t) => t.name === "无名氏").collegeName === "学院待确认");

// ========== 2) Production filter function A/B/empty (via _items — same code path as searchActiveIndex) ==========
const resEmpty = releaseService.searchActiveIndex("teacher", "", { _items: enriched, limit: 50 });
const res04 = releaseService.searchActiveIndex("teacher", "", { _items: enriched, collegeCode: "04", limit: 50 });
const res02 = releaseService.searchActiveIndex("teacher", "", { _items: enriched, collegeCode: "02", limit: 50 });
const resBogus = releaseService.searchActiveIndex("teacher", "", { _items: enriched, collegeCode: "__NONE__", limit: 50 });

lines.push(`fixture empty=${resEmpty.total} c04=${res04.total} c02=${res02.total} bogus=${resBogus.total}`);
check("fixture empty = all enriched", resEmpty.total === enriched.length, String(resEmpty.total));
check("fixture college 04 total=3 (白银山,白志红,王安)", res04.total === 3, String(res04.total));
check("fixture college 02 total=2 (蔡晨晖,白志红)", res02.total === 2, String(res02.total));
check("fixture 04 names correct", (res04.items || []).every((i) => ["白银山", "白志红", "王安"].includes(i.name)));
check("fixture 02 names correct", (res02.items || []).every((i) => ["蔡晨晖", "白志红"].includes(i.name)));
check("fixture A vs B differ", res04.total !== res02.total || !(res04.items || []).every((i) => (res02.items || []).some((j) => j.id === i.id)));
check("fixture empty >= 04", resEmpty.total >= res04.total);
check("fixture empty >= 02", resEmpty.total >= res02.total);
check("fixture bogus college total=0", resBogus.total === 0);

// surname 王 + college
const wangAll = releaseService.searchActiveIndex("teacher", "王", { _items: enriched, limit: 50 });
const wang04 = releaseService.searchActiveIndex("teacher", "王", { _items: enriched, collegeCode: "04", limit: 50 });
const wang02 = releaseService.searchActiveIndex("teacher", "王", { _items: enriched, collegeCode: "02", limit: 50 });
lines.push(`fixture 王 all=${wangAll.total} 04=${wang04.total} 02=${wang02.total}`);
check("fixture 王 school-wide hits 王安", wangAll.total === 1 && wangAll.items[0].name === "王安");
check("fixture 王+04 hits 王安", wang04.total === 1);
check("fixture 王+02 empty", wang02.total === 0);

// filterActiveIndexItems direct
const page = releaseService.filterActiveIndexItems("teacher", enriched, "", { collegeCode: "04", limit: 10 });
check("filterActiveIndexItems same as search", page.total === res04.total);

// matchesCollege unit
check("matchesCollege multi codes", releaseService.matchesCollege({ collegeCodes: ["04", "02"] }, "02", "") === true);
check("matchesCollege reject", releaseService.matchesCollege({ collegeCode: "04" }, "02", "") === false);

// ========== 3) Live pack when available ==========
const live = releaseService.searchActiveIndex("teacher", "", { limit: 100 });
const liveItems = (live && live.items) || [];
lines.push(`live success=${live.success} total=${live.total || liveItems.length} version=${live.releaseVersion || live.version || ""}`);

if (live.success && liveItems.length > 0) {
  const withCollege = liveItems.filter((i) => {
    const codes = Array.isArray(i.collegeCodes) ? i.collegeCodes.filter(Boolean) : [];
    return codes.length > 0 || (i.collegeCode && i.collegeName && i.collegeName !== "学院待确认");
  });
  check("live teachers enriched with college", withCollege.length >= Math.min(3, liveItems.length), `withCollege=${withCollege.length}`);

  const collegeCodeCounts = new Map();
  liveItems.forEach((i) => {
    const codes = Array.isArray(i.collegeCodes) && i.collegeCodes.length ? i.collegeCodes : (i.collegeCode ? [i.collegeCode] : []);
    codes.forEach((c) => {
      const key = String(c || "").trim();
      if (key) collegeCodeCounts.set(key, (collegeCodeCounts.get(key) || 0) + 1);
    });
  });
  const sorted = Array.from(collegeCodeCounts.entries()).sort((a, b) => b[1] - a[1]);
  lines.push(`live college dist: ${sorted.slice(0, 6).map(([c, n]) => `${c}:${n}`).join(",")}`);

  if (sorted.length >= 2) {
    const codeA = sorted[0][0];
    const codeB = sorted.find(([c]) => c !== codeA)[0];
    const a = releaseService.searchActiveIndex("teacher", "", { collegeCode: codeA, limit: 100 });
    const b = releaseService.searchActiveIndex("teacher", "", { collegeCode: codeB, limit: 100 });
    lines.push(`live A=${codeA}:${a.total} B=${codeB}:${b.total} empty=${live.total}`);
    check("live college A > 0", (a.total || 0) > 0);
    check("live college B > 0", (b.total || 0) > 0);
    check("live A items all match A", (a.items || []).every((i) => i.collegeCode === codeA || (i.collegeCodes || []).includes(codeA)));
    check("live empty >= A", (live.total || 0) >= (a.total || 0));
    check("live A vs B differ", a.total !== b.total || !(a.items || []).every((i) => (b.items || []).some((j) => j.id === i.id)));
  } else {
    check("live at least one college code present", sorted.length >= 1);
  }
} else {
  lines.push("live pack unavailable in CI — fixture path is authoritative");
  check("live optional skip recorded (fixture covers A/B/empty)", true);
}

// ========== 4) Cache / UI wiring ==========
const k1 = buildCacheKey("search_school_index", { type: "teacher", q: "王", collegeCode: "04" }, { term: "t", releaseVersion: "v" });
const k2 = buildCacheKey("search_school_index", { type: "teacher", q: "王", collegeCode: "02" }, { term: "t", releaseVersion: "v" });
check("cache key college A != B", k1 !== k2);

const schoolJs = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/school/school.js"), "utf8");
check("titleFilterEnabled + college clear", /titleFilterEnabled/.test(schoolJs) && /teachersResult:\s*\[\]/.test(schoolJs));
const src = fs.readFileSync(path.join(__dirname, "../server/src/services/releaseService.js"), "utf8");
check("read path enrich wired", /enrichTeacherIndexItemsOnRead/.test(src));

console.log(`--- pass=${pass} fail=${fail}`);
try {
  fs.writeFileSync(path.join(SCRATCH, "teacher-college.log"), lines.join("\n"), "utf8");
  console.log("wrote", path.join(SCRATCH, "teacher-college.log"));
} catch (e) {
  console.log("scratch write skip", e.message);
}
process.exit(fail ? 1 : 0);
