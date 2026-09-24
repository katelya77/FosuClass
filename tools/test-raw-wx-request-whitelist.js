const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const miniprogramRoot = path.join(root, "miniprogram");
const whitelist = new Set([
  path.normalize(path.join(miniprogramRoot, "utils", "request.js")),
  path.normalize(path.join(miniprogramRoot, "services", "securitySessionService.js")),
  path.normalize(path.join(miniprogramRoot, "services", "staticAccessService.js")),
  path.normalize(path.join(miniprogramRoot, "services", "fosuDirectClient.js")),
]);

function walk(dir, output = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "miniprogram_npm" || entry.name === "node_modules") return;
      walk(fullPath, output);
      return;
    }
    if (entry.isFile() && fullPath.endsWith(".js")) {
      output.push(fullPath);
    }
  });
  return output;
}

function findWxRequestCalls(source) {
  const calls = [];
  let index = 0;
  let state = "code";
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (char === "\n") state = "code";
      index += 1;
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "code";
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      const quote = state === "single" ? "'" : (state === "double" ? "\"" : "`");
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) state = "code";
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      state = "line-comment";
      index += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block-comment";
      index += 2;
      continue;
    }
    if (char === "'") {
      state = "single";
      index += 1;
      continue;
    }
    if (char === "\"") {
      state = "double";
      index += 1;
      continue;
    }
    if (char === "`") {
      state = "template";
      index += 1;
      continue;
    }

    if (source.slice(index, index + 10) === "wx.request") {
      let cursor = index + 10;
      while (/\s/.test(source[cursor] || "")) cursor += 1;
      if (source[cursor] === "(") {
        calls.push(index);
      }
    }
    index += 1;
  }
  return calls;
}

const offenders = [];
walk(miniprogramRoot).forEach((filePath) => {
  const normalized = path.normalize(filePath);
  const source = fs.readFileSync(filePath, "utf-8");
  const calls = findWxRequestCalls(source);
  if (calls.length && !whitelist.has(normalized)) {
    offenders.push(path.relative(root, filePath));
  }
});

const requestFiles = walk(miniprogramRoot).filter((filePath) => path.basename(filePath) === "request.js");
assert.deepStrictEqual(
  requestFiles.map((filePath) => path.relative(root, filePath)).sort(),
  [path.join("miniprogram", "utils", "request.js")],
  "miniprogram should only contain one request.js"
);
assert.deepStrictEqual(offenders, [], `raw wx.request is only allowed in the class transport whitelist or fosuDirectClient: ${offenders.join(", ")}`);

console.log("test-raw-wx-request-whitelist passed");
