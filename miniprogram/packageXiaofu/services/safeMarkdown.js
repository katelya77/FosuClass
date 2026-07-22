/**
 * Small, deterministic Markdown parser for the Xiaofo mini-program subpackage.
 * It produces data-only nodes consumed by WXML; HTML is never executed.
 */
const MAX_INPUT_CHARS = 12000;
const MAX_BLOCKS = 120;
const MAX_CODE_CHARS = 4000;
const COLLAPSE_CHAR_THRESHOLD = 2400;
const COLLAPSE_BLOCK_THRESHOLD = 16;

function stripUnsafeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/<[^>]{0,1000}>/g, "")
    .replace(/\bon(?:abort|blur|change|click|error|focus|load|mouse|submit)\s*=/gi, "")
    .replace(/\b(?:javascript|data|vbscript|file):[^\s)\]]*/gi, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function sanitizeLanguage(value) {
  const language = String(value || "").trim().toLowerCase();
  return /^[a-z0-9_+\-]{1,20}$/.test(language) ? language : "text";
}

function sanitizeLink(value) {
  const source = String(value || "").trim();
  if (!source || source.length > 500 || !/^https:\/\//i.test(source)) return "";
  try {
    const parsed = new URL(source);
    const host = String(parsed.hostname || "").toLowerCase();
    const path = String(parsed.pathname || "");
    const isFosu = host === "fosu.edu.cn" || host.endsWith(".fosu.edu.cn");
    const isProject = host === "github.com" && /^\/katelya77\/FosuClass(?:\/|$)/i.test(path);
    if (!isFosu && !isProject) return "";
    if (parsed.username || parsed.password) return "";
    return parsed.toString();
  } catch (_) {
    return "";
  }
}

function textNode(text, flags) {
  const value = stripUnsafeHtml(text);
  if (!value) return null;
  return Object.assign({
    type: "text",
    text: value,
    bold: false,
    italic: false,
    deleted: false,
    code: false,
    link: false,
    href: "",
  }, flags || {});
}

function parseInline(value) {
  const source = String(value == null ? "" : value);
  const pattern = /(\[([^\]\n]{1,160})\]\(([^)\s]{1,500})\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|`([^`\n]+)`|\*([^*\n]+)\*|_([^_\n]+)_)/g;
  const output = [];
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(source))) {
    if (match.index > lastIndex) {
      const plain = textNode(source.slice(lastIndex, match.index));
      if (plain) output.push(plain);
    }
    let node = null;
    if (match[2] !== undefined) {
      const href = sanitizeLink(match[3]);
      node = textNode(match[2], href ? { type: "link", link: true, href } : {});
    } else if (match[4] !== undefined || match[5] !== undefined) {
      node = textNode(match[4] || match[5], { bold: true });
    } else if (match[6] !== undefined) {
      node = textNode(match[6], { deleted: true });
    } else if (match[7] !== undefined) {
      node = textNode(match[7], { code: true });
    } else if (match[8] !== undefined || match[9] !== undefined) {
      node = textNode(match[8] || match[9], { italic: true });
    }
    if (node) output.push(node);
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < source.length) {
    const tail = textNode(source.slice(lastIndex));
    if (tail) output.push(tail);
  }
  return output;
}

function splitTableRow(line) {
  let value = String(line || "").trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  const cells = [];
  let current = "";
  let escaped = false;
  for (let index = 0; index < value.length && cells.length < 12; index += 1) {
    const char = value[index];
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (cells.length < 12) cells.push(current.trim());
  return cells;
}

function isTableDivider(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function tableAlignment(value) {
  const cell = String(value || "");
  if (/^:-+:$/.test(cell)) return "center";
  if (/-+:$/.test(cell)) return "right";
  return "left";
}

function startsBlock(lines, index) {
  const line = lines[index] || "";
  if (!line.trim()) return true;
  if (/^```/.test(line) || /^(#{1,6})\s+/.test(line) || /^\s*>/.test(line)) return true;
  if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(line)) return true;
  if (/^\s*((?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) return true;
  return index + 1 < lines.length && line.includes("|") && isTableDivider(lines[index + 1]);
}

function makeCell(text, align) {
  const safe = stripUnsafeHtml(text).slice(0, 500);
  return { text: safe, inlines: parseInline(safe), align: align || "left" };
}

function parseMarkdown(value) {
  const raw = String(value == null ? "" : value).replace(/\r\n?/g, "\n");
  const truncated = raw.length > MAX_INPUT_CHARS;
  const source = raw.slice(0, MAX_INPUT_CHARS);
  const lines = source.split("\n");
  const blocks = [];
  let index = 0;

  function push(block) {
    if (!block || blocks.length >= MAX_BLOCKS) return false;
    blocks.push(Object.assign({ id: `md-${blocks.length + 1}` }, block));
    return true;
  }

  while (index < lines.length && blocks.length < MAX_BLOCKS) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```\s*([A-Za-z0-9_+\-]{0,20})\s*$/);
    if (fence) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const code = codeLines.join("\n");
      push({
        type: "code",
        language: sanitizeLanguage(fence[1]),
        text: code.slice(0, MAX_CODE_CHARS),
        truncated: code.length > MAX_CODE_CHARS,
      });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const text = stripUnsafeHtml(heading[2]).slice(0, 500);
      push({ type: "heading", level: heading[1].length, text, inlines: parseInline(text) });
      index += 1;
      continue;
    }

    if (/^\s*((?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      push({ type: "divider" });
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      const text = stripUnsafeHtml(quoteLines.join("\n")).slice(0, 1200);
      push({ type: "quote", text, inlines: parseInline(text) });
      continue;
    }

    const listMatch = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const items = [];
      while (index < lines.length && items.length < 30) {
        const current = lines[index].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
        if (!current || /^\d/.test(current[1]) !== ordered) break;
        const text = stripUnsafeHtml(current[2]).slice(0, 600);
        items.push({
          marker: ordered ? `${items.length + 1}.` : "•",
          text,
          inlines: parseInline(text),
        });
        index += 1;
      }
      push({ type: "list", ordered, items });
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableDivider(lines[index + 1])) {
      const headerValues = splitTableRow(line);
      const alignmentValues = splitTableRow(lines[index + 1]);
      const alignments = headerValues.map((_, cellIndex) => tableAlignment(alignmentValues[cellIndex] || "---"));
      const headers = headerValues.map((cell, cellIndex) => makeCell(cell, alignments[cellIndex]));
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && rows.length < 30) {
        const values = splitTableRow(lines[index]);
        rows.push(headers.map((_, cellIndex) => makeCell(values[cellIndex] || "", alignments[cellIndex])));
        index += 1;
      }
      push({ type: "table", headers, rows, alignments });
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && !startsBlock(lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const text = stripUnsafeHtml(paragraphLines.join("\n")).slice(0, 2000);
    if (text) push({ type: "paragraph", text, inlines: parseInline(text) });
  }

  const blockLimitReached = index < lines.length || blocks.length >= MAX_BLOCKS;
  return {
    type: "document",
    blocks,
    charCount: source.length,
    truncated: truncated || blockLimitReached,
    collapsible: truncated || blockLimitReached || source.length > COLLAPSE_CHAR_THRESHOLD || blocks.length > COLLAPSE_BLOCK_THRESHOLD,
  };
}

module.exports = {
  COLLAPSE_BLOCK_THRESHOLD,
  COLLAPSE_CHAR_THRESHOLD,
  MAX_BLOCKS,
  MAX_CODE_CHARS,
  MAX_INPUT_CHARS,
  parseInline,
  parseMarkdown,
  sanitizeLanguage,
  sanitizeLink,
  stripUnsafeHtml,
};
