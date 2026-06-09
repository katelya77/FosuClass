const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_ROOTS = [
  path.join(ROOT, "miniprogram"),
  path.join(ROOT, "server", "src"),
].filter((dir) => fs.existsSync(dir));

function walkJsFiles(dir, output = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      walkJsFiles(fullPath, output);
    } else if (item.isFile() && item.name.endsWith(".js")) {
      output.push(fullPath);
    }
  }
  return output;
}

function isIdentifierStart(ch) {
  return /[A-Za-z_$]/.test(ch);
}

function isIdentifierPart(ch) {
  return /[A-Za-z0-9_$]/.test(ch);
}

function isBoundary(source, index) {
  return index < 0 || index >= source.length || !isIdentifierPart(source[index]);
}

function lineStarts(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineForOffset(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return high + 1;
}

function skipWhitespace(source, index) {
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

function readIdentifier(source, index) {
  if (!isIdentifierStart(source[index])) return null;
  let end = index + 1;
  while (end < source.length && isIdentifierPart(source[end])) end += 1;
  return { name: source.slice(index, end), end };
}

function skipQuoted(source, index, quote) {
  index += 1;
  while (index < source.length) {
    const ch = source[index];
    if (ch === "\\") {
      index += 2;
      continue;
    }
    index += 1;
    if (ch === quote) break;
  }
  return index;
}

function skipLineComment(source, index) {
  const end = source.indexOf("\n", index + 2);
  return end === -1 ? source.length : end + 1;
}

function skipBlockComment(source, index) {
  const end = source.indexOf("*/", index + 2);
  return end === -1 ? source.length : end + 2;
}

function skipIgnored(source, index) {
  const ch = source[index];
  const next = source[index + 1];
  if (ch === "\"" || ch === "'" || ch === "`") return skipQuoted(source, index, ch);
  if (ch === "/" && next === "/") return skipLineComment(source, index);
  if (ch === "/" && next === "*") return skipBlockComment(source, index);
  return index;
}

function matchKeyword(source, index, keyword) {
  return source.slice(index, index + keyword.length) === keyword &&
    isBoundary(source, index - 1) &&
    isBoundary(source, index + keyword.length);
}

function parseVariableDeclaration(source, index, kind, starts, declarations) {
  let cursor = skipWhitespace(source, index + kind.length);
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let expectDeclarator = true;

  while (cursor < source.length) {
    const ignored = skipIgnored(source, cursor);
    if (ignored !== cursor) {
      cursor = ignored;
      continue;
    }

    const ch = source[cursor];
    if (expectDeclarator) {
      cursor = skipWhitespace(source, cursor);
      const id = readIdentifier(source, cursor);
      if (id) {
        declarations.push({
          name: id.name,
          kind,
          line: lineForOffset(starts, cursor),
        });
        cursor = id.end;
      }
      expectDeclarator = false;
      continue;
    }

    if (ch === "(") parenDepth += 1;
    if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (ch === "{") braceDepth += 1;
    if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
    if (ch === "[") bracketDepth += 1;
    if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);

    const nested = parenDepth || braceDepth || bracketDepth;
    if (!nested && ch === ",") {
      expectDeclarator = true;
      cursor += 1;
      continue;
    }
    if (!nested && ch === ";") return cursor + 1;

    cursor += 1;
  }
  return cursor;
}

function scanTopLevelDeclarations(source) {
  const starts = lineStarts(source);
  const declarations = [];
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let index = 0;

  while (index < source.length) {
    const ignored = skipIgnored(source, index);
    if (ignored !== index) {
      index = ignored;
      continue;
    }

    const atTopLevel = braceDepth === 0 && parenDepth === 0 && bracketDepth === 0;
    if (atTopLevel && matchKeyword(source, index, "function")) {
      let nameIndex = skipWhitespace(source, index + "function".length);
      if (source[nameIndex] === "*") nameIndex = skipWhitespace(source, nameIndex + 1);
      const id = readIdentifier(source, nameIndex);
      if (id) {
        declarations.push({
          name: id.name,
          kind: "function",
          line: lineForOffset(starts, nameIndex),
        });
      }
    } else if (atTopLevel && matchKeyword(source, index, "class")) {
      const nameIndex = skipWhitespace(source, index + "class".length);
      const id = readIdentifier(source, nameIndex);
      if (id) {
        declarations.push({
          name: id.name,
          kind: "class",
          line: lineForOffset(starts, nameIndex),
        });
      }
    } else if (atTopLevel && matchKeyword(source, index, "const")) {
      index = parseVariableDeclaration(source, index, "const", starts, declarations);
      continue;
    } else if (atTopLevel && matchKeyword(source, index, "let")) {
      index = parseVariableDeclaration(source, index, "let", starts, declarations);
      continue;
    }

    const ch = source[index];
    if (ch === "{") braceDepth += 1;
    if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
    if (ch === "(") parenDepth += 1;
    if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (ch === "[") bracketDepth += 1;
    if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    index += 1;
  }

  return declarations;
}

function collectDuplicateReports(files) {
  const reports = [];
  files.forEach((filePath) => {
    const seen = new Map();
    const source = fs.readFileSync(filePath, "utf8");
    scanTopLevelDeclarations(source).forEach((item) => {
      if (!seen.has(item.name)) {
        seen.set(item.name, item);
        return;
      }
      const first = seen.get(item.name);
      reports.push({
        filePath,
        symbol: item.name,
        firstLine: first.line,
        secondLine: item.line,
        firstKind: first.kind,
        secondKind: item.kind,
      });
    });
  });
  return reports;
}

function formatReport(report) {
  return [
    path.relative(ROOT, report.filePath),
    report.symbol,
    `${report.firstLine}`,
    `${report.secondLine}`,
    `${report.firstKind}->${report.secondKind}`,
  ].join(" | ");
}

function run() {
  const files = SCAN_ROOTS.flatMap((dir) => walkJsFiles(dir)).sort();
  const reports = collectDuplicateReports(files);
  if (reports.length) {
    console.error("Top-level duplicate symbols found:");
    console.error("file | symbol | firstLine | secondLine | kinds");
    reports.forEach((report) => console.error(formatReport(report)));
    process.exit(1);
  }
  console.log(`test-miniprogram-top-level-duplicate-symbols passed (${files.length} JS files scanned)`);
}

if (require.main === module) {
  run();
}

module.exports = {
  collectDuplicateReports,
  scanTopLevelDeclarations,
  walkJsFiles,
};
