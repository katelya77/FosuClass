/**
 * Settings domain service — typed form over appConfigService.
 * Shared by Legacy + Vue; secrets never returned.
 */
const crypto = require("crypto");
const appConfigService = require("../../services/appConfigService");
const { SETTINGS_FIELDS, getByPath, setByPath, validateField } = require("./schema");

function makeVersion(config) {
  const basis = JSON.stringify({
    appName: config.appName,
    currentSemester: config.currentSemester,
    publishStatus: config.publishStatus,
    appConfig: config.appConfig,
    dataVersion: config.dataVersion,
    disclaimer: config.disclaimer,
    updatedAt: config.updatedAt,
  });
  return `cfg_${crypto.createHash("sha256").update(basis).digest("hex").slice(0, 16)}`;
}

function getTypedSettings() {
  const config = appConfigService.getAdminConfig();
  const version = makeVersion(config);
  const fields = SETTINGS_FIELDS.map((field) => {
    const currentValue = getByPath(config, field.key);
    return {
      ...field,
      currentValue: currentValue === undefined ? field.default : currentValue,
      // sensitive fields would mask here; none in this set return secrets
    };
  });
  return {
    version,
    etag: version,
    updatedAt: config.updatedAt || null,
    groups: {
      app: fields.filter((f) => f.scope === "app"),
      term: fields.filter((f) => f.scope === "term"),
      import: fields.filter((f) => f.scope === "import"),
      data: fields.filter((f) => f.scope === "data"),
    },
    fields,
    rawSafe: {
      appName: config.appName,
      currentSemester: config.currentSemester,
      publishStatus: config.publishStatus,
      appConfig: config.appConfig,
      dataVersion: config.dataVersion,
      disclaimer: config.disclaimer,
      updatedAt: config.updatedAt,
    },
  };
}

function previewDiff(patch) {
  const current = getTypedSettings();
  const changes = [];
  for (const field of SETTINGS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field.key) && getByPath(patch, field.key) === undefined) {
      // also allow nested object patch
      continue;
    }
    const nextVal =
      getByPath(patch, field.key) !== undefined ? getByPath(patch, field.key) : patch[field.key];
    if (nextVal === undefined) continue;
    const cur = getByPath(current.rawSafe, field.key);
    if (JSON.stringify(cur) !== JSON.stringify(nextVal)) {
      changes.push({
        key: field.key,
        label: field.label,
        from: cur,
        to: nextVal,
        requiresRestart: field.requiresRestart,
      });
    }
  }
  // nested path support for appConfig / dataVersion patches
  if (patch.appConfig || patch.dataVersion || patch.appName !== undefined) {
    for (const field of SETTINGS_FIELDS) {
      const nextVal = getByPath(patch, field.key);
      if (nextVal === undefined) continue;
      const cur = getByPath(current.rawSafe, field.key);
      if (JSON.stringify(cur) !== JSON.stringify(nextVal)) {
        if (!changes.some((c) => c.key === field.key)) {
          changes.push({
            key: field.key,
            label: field.label,
            from: cur,
            to: nextVal,
            requiresRestart: field.requiresRestart,
          });
        }
      }
    }
  }
  return { version: current.version, changes };
}

function saveTypedSettings(patch, options = {}) {
  const current = getTypedSettings();
  const expected = options.expectedVersion || options.ifMatch || options.version;
  if (options.requireIfMatch && !expected) {
    const err = new Error("If-Match or expectedVersion is required");
    err.statusCode = 428;
    err.code = "PRECONDITION_REQUIRED";
    err.currentVersion = current.version;
    throw err;
  }
  if (expected && expected !== current.version) {
    const err = new Error("settings were modified by another request");
    err.statusCode = 409;
    err.code = "CONFLICT";
    err.currentVersion = current.version;
    throw err;
  }

  const nextPatch = {};
  // Accept either dotted keys or nested objects
  for (const field of SETTINGS_FIELDS) {
    let value = getByPath(patch, field.key);
    if (value === undefined && Object.prototype.hasOwnProperty.call(patch, field.key)) {
      value = patch[field.key];
    }
    if (value === undefined) continue;
    const errMsg = validateField(field, value);
    if (errMsg) {
      const err = new Error(errMsg);
      err.statusCode = 400;
      err.code = "VALIDATION_ERROR";
      throw err;
    }
    setByPath(nextPatch, field.key, value);
  }

  if (!Object.keys(nextPatch).length) {
    const err = new Error("no valid settings fields to save");
    err.statusCode = 400;
    throw err;
  }

  const saved = appConfigService.saveAdminConfig(nextPatch);
  const after = getTypedSettings();
  return {
    data: saved,
    version: after.version,
    etag: after.etag,
    settings: after,
  };
}

module.exports = {
  SETTINGS_FIELDS,
  getTypedSettings,
  previewDiff,
  saveTypedSettings,
  makeVersion,
};
