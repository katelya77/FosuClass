const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("../admin-web/node_modules/typescript");
const { resolveWriteModule } = require("./lib/admin-rollout-manifest");

const ROOT = path.resolve(__dirname, "..");
const ADMIN_SOURCE = path.join(ROOT, "admin-web", "src");
const AUTH_PATHS = new Set(["/api/admin/login", "/api/admin/logout"]);
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isStringLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function getString(node) {
  return isStringLike(node) ? node.text : null;
}

function getCallName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) return expression.name.text;
  return null;
}

function getMethod(call, sourceFile, errors) {
  if (call.arguments.length < 2) return "GET";
  const options = call.arguments[1];
  if (!ts.isObjectLiteralExpression(options)) {
    errors.push(`${sourceFile.fileName}:${sourceFile.getLineAndCharacterOfPosition(options.getStart()).line + 1} dynamic request options are not allowed`);
    return null;
  }
  const method = options.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === "method") ||
        (ts.isStringLiteral(property.name) && property.name.text === "method")),
  );
  if (!method) return "GET";
  const value = getString(method.initializer);
  if (value === null) {
    errors.push(`${sourceFile.fileName}:${sourceFile.getLineAndCharacterOfPosition(method.getStart()).line + 1} dynamic request method is not allowed`);
    return null;
  }
  return value.toUpperCase();
}

function staticPathPrefix(expression) {
  if (isStringLike(expression)) return expression.text;
  if (ts.isTemplateExpression(expression)) return expression.head.text;
  return null;
}

function scanText(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const errors = [];
  const writes = [];

  function visit(node) {
    if (ts.isCallExpression(node) && ["api", "fetch"].includes(getCallName(node.expression))) {
      const route = staticPathPrefix(node.arguments[0]);
      const methodErrors = [];
      const method = getMethod(node, sourceFile, methodErrors);
      if (route !== null) errors.push(...methodErrors);
      if (method && !READ_METHODS.has(method)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        if (route === null) {
          errors.push(`${fileName}:${line} dynamic write path is not allowed`);
        } else if (!AUTH_PATHS.has(route)) {
          const moduleName = resolveWriteModule(route);
          if (!moduleName) {
            errors.push(`${fileName}:${line} write path ${route} has no manifest module`);
          } else {
            writes.push({ route, method, module: moduleName, fileName, line });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { writes, errors };
}

function scriptBlocks(sourceText) {
  const blocks = [];
  const pattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(sourceText))) blocks.push(match[1]);
  return blocks;
}

function listSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(target);
    return /\.(ts|vue)$/.test(entry.name) ? [target] : [];
  });
}

function scanFiles(files) {
  return files.reduce(
    (result, fileName) => {
      const sourceText = fs.readFileSync(fileName, "utf8");
      const blocks = fileName.endsWith(".vue") ? scriptBlocks(sourceText) : [sourceText];
      for (const block of blocks) {
        const current = scanText(block, path.relative(ROOT, fileName));
        result.writes.push(...current.writes);
        result.errors.push(...current.errors);
      }
      return result;
    },
    { writes: [], errors: [] },
  );
}

function assertFixtureFailures() {
  const fixture = scanText(
    `
      api('/api/admin/unknown-write', { method: 'POST' });
      api(dynamicPath, { method: 'POST' });
      fetch('/api/admin/catalog/meta', { method: dynamicMethod });
    `,
    "fixture.ts",
  );
  assert.ok(fixture.errors.some((error) => error.includes("unknown-write")), "unknown literal writes must fail");
  assert.ok(fixture.errors.some((error) => error.includes("dynamic write path")), "dynamic write paths must fail");
  assert.ok(fixture.errors.some((error) => error.includes("dynamic request method")), "dynamic write methods must fail");
}

assertFixtureFailures();
const result = scanFiles(listSourceFiles(ADMIN_SOURCE));
assert.deepStrictEqual(result.errors, [], result.errors.join("\n"));
assert.ok(result.writes.length > 0, "expected admin-next write calls to be scanned");
console.log(`Admin next write route guard passed (${result.writes.length} writes).`);
