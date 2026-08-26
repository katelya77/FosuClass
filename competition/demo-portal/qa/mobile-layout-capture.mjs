import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.QA_BASE || "http://127.0.0.1:4174";
const OUT = process.env.QA_OUT
  ? path.resolve(process.env.QA_OUT)
  : path.resolve(process.cwd(), "../final-delivery/qa/responsive-mobile");

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars"],
});

const routes = [
  { hash: "#/", name: "home" },
  { hash: "#/experience", name: "experience-all" },
  { hash: "#/experience/query", name: "experience-query" },
];
const viewports = [
  [430, 932],
  [390, 844],
  [375, 812],
  [360, 800],
];
const issues = [];
const results = [];

for (const [width, height] of viewports) {
  for (const route of routes) {
    const page = await browser.newPage();
    page.on("pageerror", (error) => issues.push(`${route.name} ${width}x${height} pageerror: ${error.message}`));
    await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/${route.hash}`, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 250));

    const geometry = await page.evaluate(() => {
      const rectOf = (selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      };
      const visibleOverflow = [...document.querySelectorAll("body *")]
        .filter((element) => element instanceof HTMLElement)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].slice(0, 2).map((name) => `.${name}`).join("")}`,
            left: rect.left,
            right: rect.right,
            display: style.display,
            visibility: style.visibility,
          };
        })
        .filter((item) => item.display !== "none" && item.visibility !== "hidden" && (item.left < -1 || item.right > innerWidth + 1))
        .filter((item) => !item.selector.includes("app-blob") && !item.selector.includes("home-agent-shine"))
        .slice(0, 20);
      const labels = [...document.querySelectorAll(".mobile-nav__label")].map((element) => ({
        text: element.textContent?.trim(),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      return {
        viewportWidth: innerWidth,
        htmlScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        nav: rectOf(".mobile-nav"),
        route: rectOf(".route-frame"),
        storyline: rectOf(".experience-storyline"),
        native: rectOf(".native-adp"),
        nativeHeader: rectOf(".native-adp__header"),
        nativeRail: rectOf(".native-adp__rail"),
        labels,
        visibleOverflow,
      };
    });

    const prefix = `${route.name} ${width}x${height}`;
    if (geometry.htmlScrollWidth > width + 1 || geometry.bodyScrollWidth > width + 1) {
      issues.push(`${prefix} document-overflow ${JSON.stringify(geometry)}`);
    }
    for (const [name, rect] of Object.entries({
      nav: geometry.nav,
      route: geometry.route,
      storyline: geometry.storyline,
      native: geometry.native,
      nativeHeader: geometry.nativeHeader,
      nativeRail: geometry.nativeRail,
    })) {
      if (rect && (rect.left < -1 || rect.right > width + 1)) {
        issues.push(`${prefix} ${name}-overflow ${JSON.stringify(rect)}`);
      }
    }
    if (!geometry.nav || geometry.labels.length !== 5) {
      issues.push(`${prefix} mobile-nav-missing`);
    }
    const clippedLabels = geometry.labels.filter((label) => label.scrollWidth > label.clientWidth + 1);
    if (clippedLabels.length) issues.push(`${prefix} nav-label-clipped ${JSON.stringify(clippedLabels)}`);
    if (geometry.visibleOverflow.length) issues.push(`${prefix} element-overflow ${JSON.stringify(geometry.visibleOverflow)}`);

    results.push({ route: route.name, width, height, geometry });
    await page.screenshot({ path: path.join(OUT, `${route.name}-${width}x${height}.png`), fullPage: true });
    await page.close();
  }
}

await browser.close();
fs.writeFileSync(path.join(OUT, "mobile-layout-results.json"), `${JSON.stringify({ base: BASE, results, issues }, null, 2)}\n`);

if (issues.length) {
  console.error(issues.join("\n"));
  process.exit(1);
}

console.log(`Mobile layout QA passed for ${results.length} route/viewport combinations at ${BASE}`);
