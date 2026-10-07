"use strict";
// Geometry regression using actual WXML/WXSS translated to browser DOM.
// Native button sizing is modelled; this is not a WeChat device test.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { chromium } = require("../server/node_modules/playwright-core");
const catalog = require("../miniprogram/utils/noticeReactions");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const componentPath = "miniprogram/components/notice-reactions/notice-reactions";
const tickerPath = "miniprogram/components/notice-ticker/notice-ticker";
let definition;
vm.runInNewContext(read(componentPath + ".js"), {
  Component(value) { definition = value; },
  require(name) { return name.includes("noticeReactionService") ? {} : catalog; },
});
function componentData(summary, pickerOpen) {
  const instance = { data: { ...definition.data, compact: false }, setData(data) { Object.assign(this.data, data); } };
  definition.properties.notice.observer.call(instance, { id: "layout", reactions: summary });
  return { ...instance.data, pickerOpen };
}
const wxml = read(componentPath + ".wxml"), ticker = read(tickerPath + ".wxml");
const wxss = read(componentPath + ".wxss") + read(tickerPath + ".wxss");
let tickerDefinition;
vm.runInNewContext(read(tickerPath + ".js"), { Component(value) { tickerDefinition = value; }, require() { return {}; } });
const measureSource = tickerDefinition.methods.measureDetail.toString();
const output = path.join(root, ".local/notice-reactions-acceptance/layout");
async function render(page, width, summary, pickerOpen = true, content = "祝大家国庆快乐！") {
  const data = componentData(summary, pickerOpen);
  const currentNotice = { id: "layout", title: "祝大家国庆快乐！", content, typeLabel: "提醒", priority: "normal", dateText: "2026-10-01", closable: true, reactions: summary };
  const css = wxss.replace(/([\d.]+)rpx/g, (_, value) => Number(value) * width / 750 + "px");
  await page.setViewportSize({ width, height: 740 });
  await page.setContent('<style>body{margin:0;font-family:Arial,sans-serif;background:#e5e7eb}button{box-sizing:border-box;border:0;line-height:normal;background:transparent}button:not([size="mini"]){width:184px;margin:0 auto;padding:8px 24px}.wx-scroll-view{overflow-y:auto} ' + css + ' @media(prefers-reduced-motion:reduce){*{animation:none!important}}</style><main id="fixture"></main>');
  await page.evaluate(({ ticker, wxml, data, currentNotice, measureSource }) => {
    function expression(value, scope) { return Function(...Object.keys(scope), "return (" + value + ")")(...Object.values(scope)); }
    function interpolate(value, scope) { return value.replace(/{{([\s\S]*?)}}/g, (_, value) => String(expression(value, scope))); }
    function renderTemplate(source, scope) {
      const template = document.createElement("template"); template.innerHTML = source.replace(/<([\w-]+)([^>]*?)\/>/g, "<$1$2></$1>");
      const fragment = document.createDocumentFragment();
      function append(node, parent, scope, inLoop) {
        if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(interpolate(node.textContent, scope))); return; }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const loop = node.getAttribute("wx:for");
        if (loop && !inLoop) { expression(loop.slice(2, -2), scope).forEach((item, index) => append(node, parent, { ...scope, item, index }, true)); return; }
        const condition = node.getAttribute("wx:if");
        if (condition && !expression(condition.slice(2, -2), scope)) return;
        if (node.localName === "notice-reactions") {
          parent.append(renderTemplate(wxml, { ...data, compact: node.hasAttribute("compact") })); return;
        }
        const tag = node.localName === "text" ? "span" : node.localName === "button" ? "button" : "div";
        const element = document.createElement(tag);
        for (const attribute of node.attributes) {
          if (!attribute.name.startsWith("wx:") && !attribute.name.startsWith("catch") && !attribute.name.startsWith("bind")) element.setAttribute(attribute.name, interpolate(attribute.value, scope));
        }
        if (node.localName === "scroll-view") element.classList.add("wx-scroll-view");
        for (const child of node.childNodes) append(child, element, scope, false);
        parent.append(element);
      }
      for (const node of template.content.childNodes) append(node, fragment, scope, false);
      return fragment;
    }
    document.getElementById("fixture").append(renderTemplate(ticker, { currentNotice, detailVisible: true, panelBodyHeight: "auto", panelBodyScroll: false }));
    window.wx = { getWindowInfo() { return { windowWidth: innerWidth, windowHeight: innerHeight }; } };
    const instance = {
      data: { detailVisible: true },
      setData(patch) { const scroll=document.querySelector(".notice-ticker-panel-scroll");scroll.style.height=patch.panelBodyHeight;scroll.dataset.scroll=String(patch.panelBodyScroll); },
      createSelectorQuery() {
        const rectangles=[];
        return { select(selector) { rectangles.push(document.querySelector(selector).getBoundingClientRect());return this; }, boundingClientRect() { return this; }, exec(callback) { callback(rectangles); } };
      },
    };
    Function("return ({" + measureSource + "})")().measureDetail.call(instance);
  }, { ticker, wxml, data, currentNotice, measureSource });
}
async function run() {
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(value => value && fs.existsSync(value));
  assert(executablePath, "browser required"); fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath });
  let cases = 0;
  try {
    const page = await browser.newPage(); await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [320, 375, 390, 430]) {
      for (const ids of [catalog.DEFAULT_IDS, ["like", "heart", "celebrate"], ["like"]]) {
        const summary = { enabled: true, total: 1, items: [{ ...catalog.CATALOG[0], count: 1 }], myReaction: "like", allowedIds: ids };
        await render(page, width, summary);
        const geometry = await page.evaluate(() => {
          const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }; };
          return { grid: rect(document.querySelector(".reaction-grid")), options: [...document.querySelectorAll(".reaction-option")].map(rect), chip: rect(document.querySelector(".reaction-chip")), add: rect(document.querySelector(".reaction-add")), action: rect(document.querySelector(".notice-ticker-panel-action")), footer: rect(document.querySelector(".notice-ticker-panel-footer")) };
        });
        assert.strictEqual(geometry.options.length, ids.length);
        const rows = new Map();
        for (const option of geometry.options) {
          assert(Math.abs(option.width - geometry.grid.width / 6) < 1, "each emoji uses exactly one sixth of the grid");
          assert(option.x >= geometry.grid.x - 1 && option.right <= geometry.grid.right + 1, "emoji stays inside picker");
          const y = Math.round(option.y); rows.set(y, (rows.get(y) || 0) + 1);
        }
        assert.deepStrictEqual([...rows.values()], ids.length === 24 ? [6, 6, 6, 6] : [ids.length]);
        assert(Math.abs(geometry.chip.y - geometry.add.y) < 1, "one response and add control share a row");
        assert(geometry.chip.width < geometry.grid.width / 2, "response capsule must not become a full-width button");
        assert(Math.abs(geometry.action.width - geometry.footer.width) < 1, "footer action fills the panel");
        assert(await page.locator(".notice-ticker-panel-scroll").evaluate(element => element.dataset.scroll==="false" && element.scrollHeight<=element.clientHeight+1), "short notice and full emoji palette fit without scrolling");
        if (ids.length === 24) await page.locator(".notice-ticker-panel").screenshot({ path: path.join(output, "mini-component-" + width + ".png") });
        cases++;
      }
      const summary = { enabled: true, total: 24 * 99999, items: catalog.CATALOG.map(item => ({ ...item, count: 99999 })), myReaction: "", allowedIds: catalog.DEFAULT_IDS };
      await render(page, width, summary, true, "公告正文。".repeat(240));
      await page.locator(".notice-ticker-panel-scroll").evaluate(element => { element.scrollTop = element.scrollHeight; });
      assert(await page.evaluate(() => {
        const panel = document.querySelector(".notice-ticker-panel").getBoundingClientRect();
        const scroll = document.querySelector(".notice-ticker-panel-scroll");
        return panel.top >= 0 && panel.bottom <= innerHeight && scroll.scrollHeight > scroll.clientHeight && [...document.querySelectorAll(".reaction-chip,.reaction-option")].every(element => element.getBoundingClientRect().right <= panel.right);
      }), "long content and many counts scroll without horizontal overflow or hiding the footer");
      cases++;
      await render(page, width, { enabled: true, total: 0, items: [], allowedIds: catalog.DEFAULT_IDS }, false);
      assert.strictEqual(await page.locator(".reaction-chip").count(), 0); assert.strictEqual(await page.locator(".reaction-add").count(), 1); cases++;
      await render(page, width, { enabled: false, total: 1, items: [{ ...catalog.CATALOG[0], count: 1 }], myReaction: "like", allowedIds: [] }, false);
      assert.strictEqual(await page.locator(".reaction-add,.reaction-option").count(), 0); assert.strictEqual(await page.locator(".reaction-chip[aria-disabled=false]").count(), 1); cases++;
    }
    console.log("test-notice-reaction-layout passed (" + cases + " geometry cases; actual WXML/WXSS, 320/375/390/430px, six columns, compact chips, partial catalog, long content, many counts, zero/closed states; browser simulation only)");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
