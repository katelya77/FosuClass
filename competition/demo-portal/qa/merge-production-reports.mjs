import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "..", "final-delivery", "qa", "live-final", "screenshots");
const keys = ["static", "student", "collaboration", "reschedule", "insight"];
const requiredScreenshots = [
  "01-home-1920x1080-final.png",
  "02-roles-1920x1080-final.png",
  "03-cases-1920x1080-final.png",
  "04-student-live-1920x1080-final.png",
  "05-collaboration-live-1920x1080-final.png",
  "06-reschedule-live-1920x1080-final.png",
  "07-insight-live-1920x1080-final.png",
  "08-verified-replay-1920x1080-final.png",
  "04-student-live-1366x768-final.png",
  "06-reschedule-live-1366x768-final.png",
  "09-mobile-experience-390x844-final.png",
];

const sources = keys.map((key) => {
  const file = path.join(out, `portal-production-qa-${key}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing production QA report: ${file}`);
  return { key, file, report: JSON.parse(fs.readFileSync(file, "utf8")) };
});

const merged = {
  baseUrl: "https://adp.katelya.top",
  generatedAt: new Date().toISOString(),
  sourceReports: sources.map(({ key, file, report }) => ({ key, file: path.basename(file), startedAt: report.startedAt, completedAt: report.completedAt, ok: report.ok })),
  screenshots: sources.flatMap(({ report }) => report.screenshots || []).map(({ name, capturedAt }) => ({ name, capturedAt })),
  viewports: sources.flatMap(({ report }) => report.viewports || []),
  liveCases: sources.flatMap(({ report }) => report.liveCases || []),
  consoleErrors: sources.flatMap(({ report }) => report.consoleErrors || []),
  pageErrors: sources.flatMap(({ report }) => report.pageErrors || []),
  issues: sources.flatMap(({ key, report }) => (report.issues || []).map((issue) => `${key}: ${issue}`)),
  requiredScreenshots: requiredScreenshots.map((name) => ({ name, exists: fs.existsSync(path.join(out, name)) })),
};
for (const source of sources) if (!source.report.ok) merged.issues.push(`${source.key}: source report is not PASS`);
for (const screenshot of merged.requiredScreenshots) if (!screenshot.exists) merged.issues.push(`missing screenshot: ${screenshot.name}`);
merged.ok = merged.issues.length === 0 && merged.consoleErrors.length === 0 && merged.pageErrors.length === 0;

fs.writeFileSync(path.join(out, "portal-production-qa.json"), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
console.log(`PORTAL PRODUCTION QA ${merged.ok ? "PASS" : "FAIL"} · reports=${sources.length} · live=${merged.liveCases.length} · viewports=${merged.viewports.length} · screenshots=${merged.requiredScreenshots.length} · console=${merged.consoleErrors.length} · page=${merged.pageErrors.length}`);
if (!merged.ok) process.exitCode = 1;
