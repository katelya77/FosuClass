const assert = require("assert");
const fs = require("fs");
const path = require("path");
const acorn = require("acorn");
const { collectDuplicateReports, walkJsFiles } = require("./test-miniprogram-top-level-duplicate-symbols");

const ROOT = path.resolve(__dirname, "..");
const MINIPROGRAM_ROOT = path.join(ROOT, "miniprogram");

function walkFiles(dir, predicate, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      walkFiles(fullPath, predicate, output);
    } else if (!predicate || predicate(fullPath)) {
      output.push(fullPath);
    }
  }
  return output;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseJs(filePath, sourceType) {
  const source = fs.readFileSync(filePath, "utf8");
  return acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType,
    locations: true,
    allowHashBang: true,
  });
}

function checkModuleStrictParse(jsFiles) {
  const failures = [];
  jsFiles.forEach((filePath) => {
    try {
      parseJs(filePath, "module");
    } catch (error) {
      failures.push({
        filePath,
        line: error.loc && error.loc.line,
        column: error.loc && error.loc.column,
        message: error.message,
      });
    }
  });

  if (failures.length) {
    console.error("Miniprogram module/strict parse failures:");
    failures.forEach((failure) => {
      const relative = path.relative(ROOT, failure.filePath);
      console.error(`${relative}:${failure.line || 0}:${failure.column || 0}: ${failure.message}`);
    });
    process.exit(1);
  }
}

function checkMiniprogramModuleBoundary(jsFiles) {
  const failures = [];
  jsFiles.forEach((filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    const pattern = /\brequire\(\s*["'](\.[^"']*)["']\s*\)/g;
    let match;
    while ((match = pattern.exec(source))) {
      const resolved = path.resolve(path.dirname(filePath), match[1]);
      const relative = path.relative(MINIPROGRAM_ROOT, resolved);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        failures.push(`${path.relative(ROOT, filePath)} requires module outside miniprogramRoot: ${match[1]}`);
      }
    }
  });
  if (failures.length) {
    console.error("Miniprogram package boundary failures:");
    failures.forEach((failure) => console.error(failure));
    process.exit(1);
  }
}

function checkGeneratedRuntimeCompatibility() {
  const entries = [
    { name: "termVisibility", source: "shared/termVisibility.js" },
    { name: "teachingEventResolver", source: "shared/teachingEventResolver.js" },
  ];
  const normalize = (value) => String(value || "").replace(/\r\n/g, "\n");
  entries.forEach((entry) => {
    const sourceFile = path.join(ROOT, entry.source);
    const targetFile = path.join(MINIPROGRAM_ROOT, "shared", `${entry.name}.generated.js`);
    const header = [
      `// Generated from ${entry.source} by tools/generate-miniprogram-runtime-compat.js.`,
      "// Do not edit this packaged compatibility module directly.",
    ].join("\n");
    const expected = `${header}\n${normalize(fs.readFileSync(sourceFile, "utf8"))}`;
    const actual = fs.existsSync(targetFile) ? normalize(fs.readFileSync(targetFile, "utf8")) : "";
    assert.strictEqual(actual, expected, `miniprogram packaged ${entry.name} module must match the canonical shared source`);
  });
}

function getPropertyName(property) {
  if (!property || property.computed) return "";
  if (property.key && property.key.type === "Identifier") return property.key.name;
  if (property.key && property.key.type === "Literal") return String(property.key.value || "");
  return "";
}

function isFunctionNode(node) {
  return node &&
    (node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionDeclaration");
}

function collectFunctionProperties(objectExpression, names) {
  if (!objectExpression || objectExpression.type !== "ObjectExpression") return;
  objectExpression.properties.forEach((property) => {
    if (!property || property.type !== "Property") return;
    const name = getPropertyName(property);
    if (!name) return;
    if (property.method || isFunctionNode(property.value)) {
      names.add(name);
    }
    if (property.value && property.value.type === "ObjectExpression") {
      collectFunctionProperties(property.value, names);
    }
  });
}

function walkAst(node, visitor) {
  if (!node || typeof node.type !== "string") return;
  visitor(node);
  Object.keys(node).forEach((key) => {
    if (key === "loc" || key === "range" || key === "start" || key === "end") return;
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach((child) => walkAst(child, visitor));
    } else if (value && typeof value.type === "string") {
      walkAst(value, visitor);
    }
  });
}

function collectDefinedHandlers(jsFile) {
  const names = new Set();
  const ast = parseJs(jsFile, "script");
  walkAst(ast, (node) => {
    if (node.type === "FunctionDeclaration" && node.id && node.id.name) {
      names.add(node.id.name);
      return;
    }
    if (node.type !== "CallExpression") return;
    if (!node.callee || node.callee.type !== "Identifier") return;
    if (!["App", "Page", "Component"].includes(node.callee.name)) return;
    const options = node.arguments && node.arguments[0];
    if (options && options.type === "ObjectExpression") {
      collectFunctionProperties(options, names);
    }
  });
  return names;
}

function collectWxmlHandlers(wxmlFile) {
  const source = fs.readFileSync(wxmlFile, "utf8");
  const handlers = [];
  const pattern = /\b(?:bind|catch|capture-bind|capture-catch|mut-bind)[A-Za-z0-9_:-]*\s*=\s*"([^"]+)"/g;
  let match;
  while ((match = pattern.exec(source))) {
    const name = String(match[1] || "").trim();
    if (!name || name === "true" || name === "false" || name.startsWith("{{")) continue;
    handlers.push(name);
  }
  return [...new Set(handlers)];
}

function checkWxmlHandlers() {
  const failures = [];
  walkFiles(MINIPROGRAM_ROOT, (filePath) => filePath.endsWith(".wxml")).forEach((wxmlFile) => {
    const handlers = collectWxmlHandlers(wxmlFile);
    if (!handlers.length) return;
    const jsFile = wxmlFile.replace(/\.wxml$/, ".js");
    if (!fs.existsSync(jsFile)) {
      failures.push(`${path.relative(ROOT, wxmlFile)} references handlers but ${path.relative(ROOT, jsFile)} is missing`);
      return;
    }
    let defined;
    try {
      defined = collectDefinedHandlers(jsFile);
    } catch (error) {
      failures.push(`${path.relative(ROOT, jsFile)} could not be parsed for WXML handler validation: ${error.message}`);
      return;
    }
    handlers.forEach((handler) => {
      if (!defined.has(handler)) {
        failures.push(`${path.relative(ROOT, wxmlFile)} references missing handler ${handler} in ${path.relative(ROOT, jsFile)}`);
      }
    });
  });

  if (failures.length) {
    console.error("WXML handler validation failures:");
    failures.forEach((failure) => console.error(failure));
    process.exit(1);
  }
}

function resolveComponentJson(jsonFile, componentPath) {
  if (/^(plugin:|plugin-private:|weui-miniprogram)/.test(componentPath)) return null;
  const base = componentPath.startsWith("/")
    ? path.join(MINIPROGRAM_ROOT, componentPath.slice(1))
    : path.resolve(path.dirname(jsonFile), componentPath);
  const noExtension = base.replace(/\.json$/i, "");
  return `${noExtension}.json`;
}

function checkJsonContracts() {
  const appJson = readJson(path.join(MINIPROGRAM_ROOT, "app.json"));
  assert(Array.isArray(appJson.pages) && appJson.pages.length, "miniprogram/app.json must declare pages");
  appJson.pages.forEach((page) => {
    ["js", "json", "wxml"].forEach((extension) => {
      const filePath = path.join(MINIPROGRAM_ROOT, `${page}.${extension}`);
      assert(fs.existsSync(filePath), `app.json page is missing ${path.relative(ROOT, filePath)}`);
    });
  });

  walkFiles(MINIPROGRAM_ROOT, (filePath) => filePath.endsWith(".json")).forEach((jsonFile) => {
    const json = readJson(jsonFile);
    const components = json.usingComponents || {};
    Object.keys(components).forEach((tag) => {
      const ref = String(components[tag] || "");
      assert(ref, `${path.relative(ROOT, jsonFile)} has empty component path for ${tag}`);
      const componentJson = resolveComponentJson(jsonFile, ref);
      if (!componentJson) return;
      assert(fs.existsSync(componentJson), `${path.relative(ROOT, jsonFile)} component ${tag} path is invalid: ${ref}`);
      const base = componentJson.replace(/\.json$/i, "");
      assert(fs.existsSync(`${base}.js`), `${tag} component JS is missing: ${path.relative(ROOT, `${base}.js`)}`);
      assert(fs.existsSync(`${base}.wxml`), `${tag} component WXML is missing: ${path.relative(ROOT, `${base}.wxml`)}`);
    });
  });
}

const NATIVE_WXML_TAGS = new Set([
  "ad", "ad-custom", "audio", "block", "button", "camera", "canvas",
  "channel-live", "channel-video", "checkbox", "checkbox-group", "cover-image",
  "cover-view", "editor", "form", "functional-page-navigator", "icon", "image",
  "input", "keyboard-accessory", "label", "live-player", "live-pusher", "map",
  "match-media", "movable-area", "movable-view", "navigation-bar", "navigator",
  "official-account", "open-data", "page-container", "page-meta", "picker",
  "picker-view", "picker-view-column", "progress", "radio", "radio-group",
  "rich-text", "root-portal", "scroll-view", "share-element", "slider", "slot",
  "swiper", "swiper-item", "switch", "text", "textarea", "video", "view",
  "voip-room", "web-view",
]);

function collectWxmlTags(wxmlFile) {
  const source = fs.readFileSync(wxmlFile, "utf8");
  const tags = new Set();
  const pattern = /<\/?([a-z][a-z0-9-]*)\b/g;
  let match;
  while ((match = pattern.exec(source))) tags.add(match[1]);
  return tags;
}

function checkWxmlComponentDeclarations() {
  const appJson = readJson(path.join(MINIPROGRAM_ROOT, "app.json"));
  const globalComponents = appJson.usingComponents || {};
  const failures = [];

  walkFiles(MINIPROGRAM_ROOT, (filePath) => filePath.endsWith(".wxml")).forEach((wxmlFile) => {
    const jsonFile = wxmlFile.replace(/\.wxml$/, ".json");
    const localComponents = fs.existsSync(jsonFile)
      ? (readJson(jsonFile).usingComponents || {})
      : {};
    collectWxmlTags(wxmlFile).forEach((tag) => {
      if (!tag.includes("-") || NATIVE_WXML_TAGS.has(tag)) return;
      if (globalComponents[tag] || localComponents[tag]) return;
      failures.push(`${path.relative(ROOT, wxmlFile)} uses undeclared component <${tag}>`);
    });
  });

  if (failures.length) {
    console.error("WXML component declaration failures:");
    failures.forEach((failure) => console.error(failure));
    process.exit(1);
  }
}

function checkProjectConfigNotFoundSources() {
  walkFiles(ROOT, (filePath) => /^project(?:\..*)?\.config\.json$/.test(path.basename(filePath))).forEach((filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    assert(!source.includes("wx://not-found"), `${path.relative(ROOT, filePath)} must not contain wx://not-found`);
  });
}

function run() {
  const miniprogramJsFiles = walkJsFiles(MINIPROGRAM_ROOT).sort();
  const duplicateReports = collectDuplicateReports(miniprogramJsFiles);
  if (duplicateReports.length) {
    console.error("Top-level duplicate symbols found during compile preflight:");
    duplicateReports.forEach((report) => {
      console.error(`${path.relative(ROOT, report.filePath)} | ${report.symbol} | ${report.firstLine} | ${report.secondLine}`);
    });
    process.exit(1);
  }

  checkModuleStrictParse(miniprogramJsFiles);
  checkMiniprogramModuleBoundary(miniprogramJsFiles);
  checkGeneratedRuntimeCompatibility();
  checkWxmlHandlers();
  checkJsonContracts();
  checkWxmlComponentDeclarations();
  checkProjectConfigNotFoundSources();

  console.log(`test-miniprogram-compile-preflight passed (${miniprogramJsFiles.length} JS files parsed)`);
}

run();
