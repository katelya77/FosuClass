/**
 * User long-term low-risk memory — wraps UserPreferenceService + optional meta.
 */

const { defaultUserPreferenceService, ALLOWED_KEYS, normalizeValue } = require("../conversation/userPreferenceService");
const {
  filterAndMergeCandidates,
  enforceUserMemoryCap,
  isExpired,
  resolveExpiresAt,
  isLowRiskKey,
} = require("./memoryPolicy");

const EXTENDED_KEYS = Object.freeze([
  ...ALLOWED_KEYS,
  "preferredBuilding",
  "answerDetailLevel",
  "preferredClassName",
  "preferPersonalSchedule",
]);

function toMemoryItems(values = {}, meta = {}) {
  return EXTENDED_KEYS
    .filter((key) => Object.prototype.hasOwnProperty.call(values, key) && values[key] != null && values[key] !== "")
    .map((key) => ({
      key,
      value: values[key],
      type: key === "preferredName" || key === "college" || key === "major" || key === "grade" ? "identity"
        : key === "campus" || key === "preferredBuilding" ? "location_pref"
          : key === "defaultReminderLeadMinutes" ? "reminder_pref"
            : key.indexOf("Schedule") >= 0 || key.indexOf("Class") >= 0 ? "schedule_pref"
              : "style_pref",
      scope: "user",
      confidence: Number(meta[key] && meta[key].confidence || 0.9),
      reasonCode: meta[key] && meta[key].reasonCode || "stored",
      correction: Boolean(meta[key] && meta[key].correction),
      updatedAt: meta[key] && meta[key].updatedAt || new Date().toISOString(),
      expiresAt: meta[key] && meta[key].expiresAt || resolveExpiresAt({ key }),
      sensitivity: "low",
      sourceTurnIds: meta[key] && meta[key].sourceTurnIds || [],
    }))
    .filter((item) => !isExpired(item));
}

class UserMemoryStore {
  constructor(options = {}) {
    this.preferenceService = options.preferenceService || defaultUserPreferenceService;
  }

  load(input = {}) {
    const principal = input.principal;
    const memoryMode = input.memoryMode || "local_only";
    if (!principal || principal.authenticated !== true) {
      return { items: [], values: {} };
    }
    // User Memory is cloud_sync only; session_state must not restore cross-conversation prefs.
    if (memoryMode !== "cloud_sync") {
      return { items: [], values: {} };
    }
    try {
      const values = this.preferenceService.getObject({ principal }) || {};
      const items = enforceUserMemoryCap(toMemoryItems(values));
      return { items, values };
    } catch (_) {
      return { items: [], values: {} };
    }
  }

  /**
   * Commit durable candidates under cloud_sync only.
   * session_state keeps thread/working only — no cross-conversation User Memory.
   */
  commit(input = {}) {
    const principal = input.principal;
    const memoryMode = input.memoryMode || "local_only";
    const autoMemoryEnabled = input.autoMemoryEnabled !== false;
    if (!principal || principal.authenticated !== true) {
      return { persisted: false, keys: [], items: [] };
    }
    if (memoryMode !== "cloud_sync" || !autoMemoryEnabled) {
      return { persisted: false, keys: [], items: [], reason: memoryMode === "session_state" ? "session_state_no_user_memory" : "not_authorized" };
    }

    const filtered = filterAndMergeCandidates(input.candidates || [], {
      memoryMode,
      autoMemoryEnabled,
    }).filter((c) => c.durable && isLowRiskKey(c.key));

    if (!filtered.length) {
      return { persisted: false, keys: [], items: [] };
    }

    const values = {};
    filtered.forEach((c) => {
      // Preference service only knows ALLOWED_KEYS; extended keys go via same upsert if supported.
      if (ALLOWED_KEYS.includes(c.key)) {
        const normalized = normalizeValue(c.key, c.value);
        if (normalized !== null) values[c.key] = normalized;
      } else if (EXTENDED_KEYS.includes(c.key)) {
        values[c.key] = c.value;
      }
    });

    if (!Object.keys(values).length) {
      return { persisted: false, keys: [], items: [] };
    }

    try {
      const saved = this.preferenceService.upsert({
        principal,
        memoryMode,
        explicit: true, // functional authorization already applied by policy
        autoMemory: true,
        values,
      });
      return {
        persisted: saved.persisted === true,
        keys: Object.keys(values),
        items: toMemoryItems(values),
        reason: saved.reason || "",
      };
    } catch (_) {
      return { persisted: false, keys: [], items: [] };
    }
  }

  list(input = {}) {
    return this.load(input);
  }

  remove(input = {}) {
    if (!input.principal || !input.key) return { deleted: false };
    try {
      return this.preferenceService.remove({ principal: input.principal, key: input.key });
    } catch (_) {
      return { deleted: false };
    }
  }

  clear(input = {}) {
    if (!input.principal) return { deleted: 0 };
    try {
      return this.preferenceService.clear({ principal: input.principal });
    } catch (_) {
      return { deleted: 0 };
    }
  }
}

const defaultUserMemoryStore = new UserMemoryStore();

module.exports = {
  EXTENDED_KEYS,
  UserMemoryStore,
  defaultUserMemoryStore,
  toMemoryItems,
};
