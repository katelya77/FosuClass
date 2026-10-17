"use strict";

// These are existing adapter contracts, not newly guessed school aliases.
const CONTRACTS = {
  teacher: { fields: ["js", "skjs", "teacher", "jzg", "jzgid", "gh", "jsid"], scopes: ["skyx", "kkyx", "jszc"] },
  classroom: { fields: ["jsid", "js", "room", "roomid", "classroom", "classroomid"], scopes: ["xqid", "jzwid"] },
  course: { fields: ["kc", "kcid", "course", "courseid"], scopes: ["skyx", "kkyx", "zzdKcSX"] },
};
function permissionDenied(body) {
  return /没有(?:访问)?权限|无权访问|无访问权限|权限不足|未授权访问|访问被拒绝|您无权限|access denied|permission denied|not authorized/i.test(body);
}

// Runs inside the browser. Values/labels are for the local request adapter only;
// diagnostic is a separate allowlisted projection containing no option content.
function inspectDirectory(spec) {
  const clean = value => String(value || "").replace(/\s+/g, " ").trim();
  const usable = option => option.value && clean(option.textContent) && !/^(?:请选择|全部|不限|所有|--)/.test(clean(option.textContent));
  const selects = Array.from(document.querySelectorAll("select[name]"));
  const matches = selects.filter(select => spec.fields.includes(select.name.toLowerCase()));
  const term = document.querySelector('select[name="xnxqh"]');
  const controls = {};
  const allowed = ["xnxqh", "skyx", "kkyx", "jszc", "xqid", "jzwid", "zc1", "zc2", "jc1", "jc2", "zzdKcSX"];
  for (const input of document.querySelectorAll("input[name],select[name]")) {
    if (allowed.includes(input.name)) controls[input.name] = input.value || "";
  }
  const scopeIncomplete = selects.some(select => spec.scopes.includes(select.name) && select.value &&
    !/^(?:全部|不限|所有|请选择|--)/.test(clean(select.selectedOptions[0]?.textContent)));
  const match = matches.length === 1 ? matches[0] : null;
  const targets = match ? Array.from(match.options || []).filter(usable).map(option => ({ key: clean(option.value), name: clean(option.textContent), field: match.name })) : [];
  const recognized = new Set([...allowed.map(name => name.toLowerCase()), ...spec.fields]);
  const diagnostic = {
    source: spec.source, termMatches: Boolean(term && term.value === spec.term), termAvailable: Boolean(term && Array.from(term.options).some(o => o.value === spec.term)),
    targetControlCount: matches.length, targetOptionCount: targets.length, targetDisabled: Boolean(match?.disabled),
    filteredScope: scopeIncomplete, loading: Boolean(document.querySelector('[aria-busy="true"]')),
    unrecognizedSelectCount: selects.filter(select => !recognized.has(select.name.toLowerCase())).length,
    controls: selects.filter(select => recognized.has(select.name.toLowerCase())).slice(0, 32).map(select => ({
      name: select.name.toLowerCase(), optionCount: select.options.length, disabled: Boolean(select.disabled),
    })),
  };
  return { controls, targets, scopeIncomplete, diagnostic };
}

function directoryFailure(snapshot, allowScopedSample) {
  const d = snapshot.diagnostic;
  if (!d.termMatches) return "DIRECT_TERM_PARAMETER_MISMATCH";
  if (d.termRebound === false) return "SCHOOL_DIRECTORY_TERM_REBIND_UNVERIFIED";
  if (d.loading) return "SCHOOL_DIRECTORY_NOT_READY";
  if (!d.targetControlCount) return "SCHOOL_DIRECTORY_CONTROL_MISSING";
  if (d.targetControlCount !== 1) return "DIRECT_DIRECTORY_AMBIGUOUS";
  if (d.targetDisabled) return "SCHOOL_DIRECTORY_NOT_READY";
  if (!d.targetOptionCount) return "SCHOOL_DIRECTORY_EMPTY";
  if (snapshot.scopeIncomplete && !allowScopedSample) return "DIRECT_" + d.source.toUpperCase() + "_DIRECTORY_INCOMPLETE";
  return null;
}

module.exports = { CONTRACTS, inspectDirectory, directoryFailure, permissionDenied };
