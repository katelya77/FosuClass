const securitySessionService = require("./securitySessionService");

const STORAGE_KEY = "FOSU_PERSONAL_SYNC_CREDENTIAL_V1";
const SCHEMA_VERSION = 1;

function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, records: {} };
}

function readStore() {
  if (typeof wx === "undefined" || !wx.getStorageSync) return emptyStore();
  try {
    const stored = wx.getStorageSync(STORAGE_KEY);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return emptyStore();
    return {
      schemaVersion: SCHEMA_VERSION,
      records: stored.records && typeof stored.records === "object" ? stored.records : {},
    };
  } catch (error) {
    return emptyStore();
  }
}

function writeStore(store) {
  if (typeof wx === "undefined" || !wx.setStorageSync) return;
  try {
    wx.setStorageSync(STORAGE_KEY, {
      schemaVersion: SCHEMA_VERSION,
      records: store && store.records || {},
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    // Local sandbox only. Failure must not echo the credential.
  }
}

function currentOwnerKey() {
  return securitySessionService.getCurrentSessionOwnerKey() || "";
}

function publicView(record) {
  if (!record) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    ownerKey: record.ownerKey,
    studentId: record.studentId || "",
    password: record.password || "",
    confirmedStudentName: record.confirmedStudentName || "",
    identityConfirmed: Boolean(record.identityConfirmed),
    updatedAt: record.updatedAt || "",
  };
}

function read() {
  const ownerKey = currentOwnerKey();
  if (!ownerKey) return null;
  const record = readStore().records[ownerKey];
  if (!record || record.ownerKey !== ownerKey || Number(record.schemaVersion || 0) !== SCHEMA_VERSION) return null;
  if (!record.studentId) return null;
  return publicView(record);
}

function saveSuccessfulLogin(credential) {
  const ownerKey = currentOwnerKey();
  const studentId = String(credential && credential.studentId || "").trim();
  const password = String(credential && credential.password || "");
  if (!ownerKey || !/^\d{6,20}$/.test(studentId) || !password) return null;
  const store = readStore();
  const previous = store.records[ownerKey] && store.records[ownerKey].studentId === studentId
    ? store.records[ownerKey]
    : {};
  store.records[ownerKey] = {
    schemaVersion: SCHEMA_VERSION,
    ownerKey,
    studentId,
    password,
    confirmedStudentName: previous.confirmedStudentName || "",
    identityConfirmed: Boolean(previous.identityConfirmed),
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
  return publicView(store.records[ownerKey]);
}

function confirmIdentity(identity) {
  const ownerKey = currentOwnerKey();
  if (!ownerKey) return null;
  const store = readStore();
  const current = store.records[ownerKey];
  if (!current || current.studentId !== String(identity && identity.studentId || "").trim()) return null;
  current.confirmedStudentName = String(identity && identity.confirmedStudentName || "").trim();
  current.identityConfirmed = true;
  current.updatedAt = new Date().toISOString();
  store.records[ownerKey] = current;
  writeStore(store);
  return publicView(current);
}

function sameConfirmedIdentity(saved, studentId, studentName) {
  if (!saved || !saved.identityConfirmed) return false;
  if (String(saved.studentId || "") !== String(studentId || "")) return false;
  return String(saved.confirmedStudentName || "") === String(studentName || "").trim();
}

function clearPassword() {
  const ownerKey = currentOwnerKey();
  if (!ownerKey) return null;
  const store = readStore();
  const current = store.records[ownerKey];
  if (!current) return null;
  current.password = "";
  current.updatedAt = new Date().toISOString();
  store.records[ownerKey] = current;
  writeStore(store);
  return publicView(current);
}

function remove() {
  const ownerKey = currentOwnerKey();
  if (!ownerKey) return;
  const store = readStore();
  delete store.records[ownerKey];
  writeStore(store);
}

module.exports = {
  STORAGE_KEY,
  SCHEMA_VERSION,
  read,
  saveSuccessfulLogin,
  confirmIdentity,
  sameConfirmedIdentity,
  clearPassword,
  remove,
};
