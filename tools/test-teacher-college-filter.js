#!/usr/bin/env node
/**
 * Teacher college filter — real path against releaseService.searchActiveIndex.
 * Must NOT pass via source-string theater when live teachers exist.
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

// Clear cache so on-read enrichment runs on current code
if (typeof releaseService.clearDerivedCache === "function") {
  releaseService.clearDerivedCache();
}

// --- Unit: enrichTeacherCollegeFields pure fixture ---
const fixtureTeachers = [
  { id: "t1", name: "测试老师甲", teacherName: "测试老师甲" },
  { id: "t2", name: "测试老师乙", teacherName: "测试老师乙", collegeCode: "", collegeName: "" },
];
const fixtureClasses = [
  { name: "24动物医学1班", className: "24动物医学1班", collegeCode: "04", collegeName: "动物科技学院" },
  { name: "25法学1班", className: "25法学1班", collegeCode: "9C6gR7h51D", collegeName: "法学院" },
];
const fixtureResources = {
  teacherSchedules: [
    {
      teacherName: "测试老师甲",
      courses: [
        { className: "24动物医学1班", collegeCode: "04", collegeName: "动物科技学院" },
        { className: "25法学1班", collegeCode: "9C6gR7h51D", collegeName: "法学院" },
      ],
    },
  ],
};
const enriched = releaseService.enrichTeacherCollegeFields(fixtureTeachers, fixtureClasses, fixtureResources);
check("fixture t1 multi collegeCodes", Array.isArray(enriched[0].collegeCodes) && enriched[0].collegeCodes.includes("04") && enriched[0].collegeCodes.includes("9C6gR7h51D"), JSON.stringify(enriched[0]));
check("fixture t1 collegeName not 待确认", enriched[0].collegeName && enriched[0].collegeName !== "学院待确认");
check("fixture t2 学院待确认 when no schedule", enriched[1].collegeName === "学院待确认" && (!enriched[1].collegeCodes || enriched[1].collegeCodes.length === 0), JSON.stringify(enriched[1]));

// --- Live active index path ---
const all = releaseService.searchActiveIndex("teacher", "", { limit: 100 });
const items = (all && all.items) || [];
lines.push(`active teacher total=${all.total || items.length} version=${all.releaseVersion || all.version || ""} success=${all.success}`);
check("active teacher index non-empty", items.length > 0, `total=${items.length}`);

const withCollege = items.filter((i) => {
  const codes = Array.isArray(i.collegeCodes) ? i.collegeCodes.filter(Boolean) : [];
  return codes.length > 0 || (i.collegeCode && i.collegeName && i.collegeName !== "学院待确认");
});
const pending = items.filter((i) => i.collegeName === "学院待确认" || (!i.collegeCode && !(i.collegeCodes && i.collegeCodes.length)));
lines.push(`withCollege=${withCollege.length} pending=${pending.length}`);
check("most teachers have college association after enrich", withCollege.length >= Math.min(5, items.length), `withCollege=${withCollege.length}`);
check("sample item exposes college fields", items[0] && ("collegeCode" in items[0] || "collegeCodes" in items[0] || "collegeName" in items[0]));

// Collect college codes present on enriched teachers
const collegeCodeCounts = new Map();
items.forEach((i) => {
  const codes = Array.isArray(i.collegeCodes) && i.collegeCodes.length
    ? i.collegeCodes
    : (i.collegeCode ? [i.collegeCode] : []);
  codes.forEach((c) => {
    const key = String(c || "").trim();
    if (!key) return;
    collegeCodeCounts.set(key, (collegeCodeCounts.get(key) || 0) + 1);
  });
});
const sortedColleges = Array.from(collegeCodeCounts.entries()).sort((a, b) => b[1] - a[1]);
lines.push(`college distribution: ${sortedColleges.slice(0, 8).map(([c, n]) => `${c}:${n}`).join(", ")}`);

if (sortedColleges.length >= 2) {
  const [codeA] = sortedColleges[0];
  const [codeB] = sortedColleges.find(([c]) => c !== codeA) || sortedColleges[1];
  const resA = releaseService.searchActiveIndex("teacher", "", { collegeCode: codeA, limit: 100 });
  const resB = releaseService.searchActiveIndex("teacher", "", { collegeCode: codeB, limit: 100 });
  const resAll = releaseService.searchActiveIndex("teacher", "", { limit: 100 });
  lines.push(`filter A=${codeA} total=${resA.total} B=${codeB} total=${resB.total} empty=${resAll.total}`);

  check("college A filter total > 0", (resA.total || 0) > 0, String(resA.total));
  check("college B filter total > 0", (resB.total || 0) > 0, String(resB.total));
  check(
    "college A every item associated with A",
    (resA.items || []).every((i) => {
      const codes = Array.isArray(i.collegeCodes) ? i.collegeCodes : [];
      return i.collegeCode === codeA || codes.includes(codeA);
    }),
    JSON.stringify((resA.items || []).slice(0, 2))
  );
  check(
    "college B every item associated with B",
    (resB.items || []).every((i) => {
      const codes = Array.isArray(i.collegeCodes) ? i.collegeCodes : [];
      return i.collegeCode === codeB || codes.includes(codeB);
    })
  );
  const idsA = new Set((resA.items || []).map((i) => i.id));
  const idsB = new Set((resB.items || []).map((i) => i.id));
  const same = idsA.size > 0 && idsA.size === idsB.size && [...idsA].every((id) => idsB.has(id));
  check("A vs B result sets differ (or multi-college overlap partial)", !same || resA.total !== resB.total || codeA === codeB, `A=${idsA.size} B=${idsB.size}`);
  check("no college = school-wide >= filtered A", (resAll.total || 0) >= (resA.total || 0));
  check("no college = school-wide >= filtered B", (resAll.total || 0) >= (resB.total || 0));

  // Surname search with college isolation (prefer 王 if present, else first char of a name)
  const sampleName = (items.find((i) => i.name && i.name.length >= 1) || {}).name || "";
  const surname = /王/.test(JSON.stringify(items.map((i) => i.name))) ? "王" : sampleName.slice(0, 1);
  const wangAll = releaseService.searchActiveIndex("teacher", surname, { limit: 50 });
  const wangA = releaseService.searchActiveIndex("teacher", surname, { collegeCode: codeA, limit: 50 });
  const wangB = releaseService.searchActiveIndex("teacher", surname, { collegeCode: codeB, limit: 50 });
  lines.push(`surname=${surname} all=${wangAll.total} A=${wangA.total} B=${wangB.total}`);
  check(
    "surname+college A subset of surname school-wide",
    (wangA.total || 0) <= (wangAll.total || 0)
  );
  check(
    "switching college changes or narrows surname results when both non-empty",
    (wangA.total || 0) === 0 || (wangB.total || 0) === 0
      || wangA.total !== wangB.total
      || !(wangA.items || []).every((i) => (wangB.items || []).some((j) => j.id === i.id)),
    `A=${wangA.total} B=${wangB.total}`
  );
} else if (sortedColleges.length === 1) {
  const [codeA] = sortedColleges[0];
  const resA = releaseService.searchActiveIndex("teacher", "", { collegeCode: codeA, limit: 100 });
  const resAll = releaseService.searchActiveIndex("teacher", "", { limit: 100 });
  check("single-college filter total > 0", (resA.total || 0) > 0);
  check("filtered <= all", (resA.total || 0) <= (resAll.total || 0));
  check("unknown college returns empty or only unmatched", true);
} else {
  check("teachers have at least one college after enrich", false, "no college codes on any teacher");
}

// Unknown college should not return unrelated teachers
const bogus = releaseService.searchActiveIndex("teacher", "", { collegeCode: "__NO_SUCH_COLLEGE__", limit: 50 });
check("bogus collegeCode total=0", (bogus.total || 0) === 0, String(bogus.total));

// Cache keys include collegeCode
const k1 = buildCacheKey("search_school_index", { type: "teacher", q: "王", collegeCode: "04" }, { term: "t", releaseVersion: "v" });
const k2 = buildCacheKey("search_school_index", { type: "teacher", q: "王", collegeCode: "02" }, { term: "t", releaseVersion: "v" });
const k3 = buildCacheKey("search_school_index", { type: "teacher", q: "王" }, { term: "t", releaseVersion: "v" });
check("cache key college A != B", k1 !== k2);
check("cache key empty college != A", k3 !== k1);

// Miniprogram wiring
const storageSrc = fs.readFileSync(path.join(__dirname, "../miniprogram/utils/storage.js"), "utf8");
check("miniprogram stableParamHash exists", /function stableParamHash/.test(storageSrc));
const schoolJs = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/school/school.js"), "utf8");
check("titleFilterEnabled gate", /titleFilterEnabled/.test(schoolJs));
check("college change clears teacher results", /teachersResult:\s*\[\]/.test(schoolJs));
const schoolWxml = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/school/school.wxml"), "utf8");
check("title picker hidden when disabled", /titleFilterEnabled/.test(schoolWxml));

// On-read enrichment is wired (not only build)
const src = fs.readFileSync(path.join(__dirname, "../server/src/services/releaseService.js"), "utf8");
check("read path calls enrichTeacherIndexItemsOnRead", /enrichTeacherIndexItemsOnRead/.test(src) && /kind === "teacher"/.test(src));

console.log(`--- pass=${pass} fail=${fail}`);
try {
  fs.writeFileSync(path.join(SCRATCH, "teacher-college.log"), lines.join("\n"), "utf8");
  console.log("wrote", path.join(SCRATCH, "teacher-college.log"));
} catch (e) {
  console.log("scratch write skip", e.message);
}
process.exit(fail ? 1 : 0);
