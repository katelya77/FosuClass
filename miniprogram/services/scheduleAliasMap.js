const MAJOR_ALIAS_MAP = {
  "动医": "动物医学",
  "动物医": "动物医学",
  "动科": "动物科学",
  "动物科": "动物科学",
};

function normalizeSearchText(value) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/[\u3000\s]+/g, "")
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/。/g, ".")
    .replace(/班$/g, "")
    .toLowerCase();
}

function normalizeClassDisplayName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /班$/.test(text) ? text : `${text}班`;
}

function getItemClassName(item) {
  const source = item || {};
  return String(source.className || source.name || source.displayName || source.title || source.rawName || "").trim();
}

function getClassComparableNames(item) {
  const source = item || {};
  return [
    source.className,
    source.name,
    source.displayName,
    source.title,
    source.rawName,
    source.searchableName,
    source.id,
    source.detailId,
  ].filter((value) => String(value || "").trim());
}

function parseCompactClassName(value) {
  const text = String(value || "").replace(/\s+/g, "").trim();
  const match = text.match(/^(\d{2,4})([\u4e00-\u9fa5]{1,12}?)(\d{1,2})班?$/);
  if (!match) return null;
  return {
    gradePrefix: match[1],
    majorText: match[2],
    classNo: match[3],
  };
}

function expandClassAlias(value) {
  const parsed = parseCompactClassName(value);
  if (!parsed) {
    return {
      rawName: String(value || "").trim(),
      expandedName: normalizeClassDisplayName(value),
      aliasMatched: false,
      knownAlias: false,
    };
  }
  const majorName = MAJOR_ALIAS_MAP[parsed.majorText] || parsed.majorText;
  const knownAlias = Boolean(MAJOR_ALIAS_MAP[parsed.majorText]);
  return {
    rawName: String(value || "").trim(),
    expandedName: normalizeClassDisplayName(`${parsed.gradePrefix}${majorName}${parsed.classNo}`),
    aliasMatched: knownAlias,
    knownAlias,
    majorAlias: parsed.majorText,
    majorName,
  };
}

function findMatchingClassItems(rawName, items) {
  const target = normalizeSearchText(rawName);
  if (!target) return [];
  return (Array.isArray(items) ? items : []).filter((item) => {
    return getClassComparableNames(item).some((name) => {
      const normalized = normalizeSearchText(name);
      return normalized === target || normalized.includes(target) || target.includes(normalized);
    });
  });
}

function resolveClassAlias(rawName, items) {
  const input = String(rawName || "").trim();
  if (!input) {
    return { status: "missing", rawName: input, candidates: [] };
  }

  const directMatches = findMatchingClassItems(input, items);
  if (directMatches.length === 1) {
    const item = directMatches[0];
    return {
      status: "matched",
      rawName: input,
      normalizedName: normalizeClassDisplayName(getItemClassName(item) || input),
      item,
      candidates: directMatches,
      aliasMatched: false,
    };
  }
  if (directMatches.length > 1) {
    return {
      status: "ambiguous",
      rawName: input,
      normalizedName: normalizeClassDisplayName(input),
      candidates: directMatches.slice(0, 6),
      aliasMatched: false,
    };
  }

  const expanded = expandClassAlias(input);
  if (!expanded.knownAlias && parseCompactClassName(input)) {
    return {
      status: "unknown_alias",
      rawName: input,
      normalizedName: expanded.expandedName,
      candidates: [],
      aliasMatched: false,
    };
  }

  if (!expanded.aliasMatched) {
    return {
      status: "not_found",
      rawName: input,
      normalizedName: expanded.expandedName,
      candidates: [],
      aliasMatched: false,
    };
  }

  const expandedMatches = findMatchingClassItems(expanded.expandedName, items);
  if (expandedMatches.length === 1) {
    const item = expandedMatches[0];
    return {
      status: "matched",
      rawName: input,
      normalizedName: normalizeClassDisplayName(getItemClassName(item) || expanded.expandedName),
      item,
      candidates: expandedMatches,
      aliasMatched: true,
      majorAlias: expanded.majorAlias,
      majorName: expanded.majorName,
    };
  }
  if (expandedMatches.length > 1) {
    return {
      status: "ambiguous",
      rawName: input,
      normalizedName: expanded.expandedName,
      candidates: expandedMatches.slice(0, 6),
      aliasMatched: true,
      majorAlias: expanded.majorAlias,
      majorName: expanded.majorName,
    };
  }

  return {
    status: "not_found",
    rawName: input,
    normalizedName: expanded.expandedName,
    candidates: [],
    aliasMatched: true,
    majorAlias: expanded.majorAlias,
    majorName: expanded.majorName,
  };
}

module.exports = {
  MAJOR_ALIAS_MAP,
  expandClassAlias,
  getClassComparableNames,
  getItemClassName,
  normalizeClassDisplayName,
  normalizeSearchText,
  parseCompactClassName,
  resolveClassAlias,
};
