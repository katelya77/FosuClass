const { API_BASE_URL, SESSION_STORAGE_KEY } = require('./runtime-config');

const ORIGIN = String(API_BASE_URL || '').replace(/\/+$/, '');
const READ_ENDPOINTS = new Set([
  '/api/fosu/teaching-calendar',
  '/api/fosu/release-pack/search',
  '/api/fosu/empty-classrooms',
  '/api/fosu/app-config',
  '/api/ai/weather',
  '/api/ai/campus-map/published',
]);
let sessionInflight = null;

function text(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max || 120);
}

function resultError(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function resultOk(message, structuredContent, handoff) {
  const result = {
    isError: false,
    content: [{ type: 'text', text: message }],
    structuredContent,
  };
  if (handoff) result.handoff = handoff;
  return result;
}

function pageHandoff(pagePath) {
  const value = String(pagePath || '');
  const match = value.match(/^(\/(?:pages|packageXiaofu|packageMaps)\/[a-zA-Z0-9/-]+)(?:\?([^#]*))?$/);
  if (!match) return null;
  const path = match[1];
  const query = match[2] || '';
  return () => ({ path, query });
}

function isSensitive(value) {
  const input = String(value || '');
  return /(?:密码|学号|身份证|cookie|token|authorization|api.?key|base64|bearer)/i.test(input)
    || /\b\d{10,18}\b/.test(input);
}

function queryString(values) {
  return Object.keys(values).filter((key) => values[key] !== undefined && values[key] !== '').map((key) =>
    `${encodeURIComponent(key)}=${encodeURIComponent(String(values[key]))}`
  ).join('&');
}

function usableSession(session) {
  return session && typeof session.sessionToken === 'string' && session.sessionToken
    && Date.parse(session.expiresAt || '') - Date.now() > 5 * 60 * 1000;
}

function readSession() {
  try { return wx.getStorageSync(SESSION_STORAGE_KEY) || null; }
  catch (error) { return null; }
}

function loginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(response) {
        if (response && response.code) resolve(response.code);
        else reject(new Error('SESSION_UNAVAILABLE'));
      },
      fail() { reject(new Error('SESSION_UNAVAILABLE')); },
    });
  });
}

function requestSession(code) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${ORIGIN}/api/fosu/session/bootstrap`,
      method: 'POST',
      data: { code },
      header: { 'content-type': 'application/json' },
      timeout: 15000,
      success(response) {
        const data = response && response.data;
        if (!response || response.statusCode !== 200 || !data || data.success === false || !data.sessionToken) {
          reject(new Error('SESSION_UNAVAILABLE'));
          return;
        }
        const session = {
          sessionToken: data.sessionToken,
          expiresAt: data.expiresAt || new Date(Date.now() + Number(data.expiresIn || 0) * 1000).toISOString(),
        };
        if (!usableSession(session)) {
          reject(new Error('SESSION_UNAVAILABLE'));
          return;
        }
        try { wx.setStorageSync(SESSION_STORAGE_KEY, session); }
        catch (error) { /* request can still use this session */ }
        resolve(session);
      },
      fail() { reject(new Error('SESSION_UNAVAILABLE')); },
    });
  });
}

function ensureSession(forceRefresh) {
  const existing = forceRefresh ? null : readSession();
  if (usableSession(existing)) return Promise.resolve(existing);
  if (sessionInflight) return sessionInflight;
  sessionInflight = loginCode().then(requestSession).then(
    (session) => { sessionInflight = null; return session; },
    (error) => { sessionInflight = null; throw error; }
  );
  return sessionInflight;
}

function requestPublic(path, params, session, retry) {
  const query = queryString(params || {});
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${ORIGIN}${path}${query ? `?${query}` : ''}`,
      method: 'GET',
      header: { 'X-Fosu-Session': session.sessionToken },
      timeout: 10000,
      success(response) {
        const data = response && response.data;
        const code = data && (data.code || data.reasonCode);
        if (retry && (code === 'FOSU_SESSION_REQUIRED' || code === 'FOSU_SESSION_INVALID' || code === 'FOSU_SESSION_EXPIRED')) {
          ensureSession(true).then((fresh) => requestPublic(path, params, fresh, false)).then(resolve, reject);
          return;
        }
        if (!response || response.statusCode !== 200 || !data || typeof data !== 'object' || data.success === false) {
          reject(new Error('PUBLIC_DATA_UNAVAILABLE'));
          return;
        }
        resolve(data);
      },
      fail() { reject(new Error('PUBLIC_DATA_UNAVAILABLE')); },
    });
  });
}

function get(path, params) {
  if (!ORIGIN || !/^https:\/\//.test(ORIGIN) || !READ_ENDPOINTS.has(path)) {
    return Promise.reject(new Error('INVALID_PUBLIC_ENDPOINT'));
  }
  return ensureSession(false).then((session) => requestPublic(path, params, session, true));
}

function isoDate(value) {
  const date = value || new Date();
  if (date instanceof Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const input = text(date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return '';
  const parsed = new Date(`${input}T12:00:00`);
  return Number.isNaN(parsed.getTime()) || isoDate(parsed) !== input ? '' : input;
}

async function getCalendar(date) {
  const day = isoDate(date);
  if (!day) throw new Error('INVALID_DATE');
  const calendar = await get('/api/fosu/teaching-calendar');
  const weeks = Array.isArray(calendar.weeks) ? calendar.weeks : [];
  const week = weeks.find((item) =>
    item && /^\d{4}-\d{2}-\d{2}$/.test(item.startDate || '')
      && /^\d{4}-\d{2}-\d{2}$/.test(item.endDate || '')
      && item.startDate <= day && day <= item.endDate
  );
  return { day, calendar, week };
}

module.exports = { text, isSensitive, resultError, resultOk, pageHandoff, queryString, get, isoDate, getCalendar };
