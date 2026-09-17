const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { build } = require('./build-wechat-ai-preview');

const root = path.resolve(__dirname, '..');
const productionAppPath = path.join(root, 'miniprogram/app.json');
const productionBefore = fs.readFileSync(productionAppPath);
const output = build({ output: path.join(root, 'dist', `wechat-ai-preview-test-${process.pid}`) });
assert(fs.readFileSync(productionAppPath).equals(productionBefore), 'production app.json must remain unchanged');
assert(!JSON.parse(productionBefore.toString()).agent, 'production app must not include beta agent');

const previewRoot = path.join(output, 'miniprogram');
const previewApp = JSON.parse(fs.readFileSync(path.join(previewRoot, 'app.json'), 'utf8'));
const previewProject = JSON.parse(fs.readFileSync(path.join(output, 'project.config.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(previewRoot, 'skills/fosu-campus/mcp.json'), 'utf8'));
const pageMeta = JSON.parse(fs.readFileSync(path.join(previewRoot, 'page-meta.json'), 'utf8'));
assert(previewApp.subPackages.some((item) => item.root === 'skills' && item.independent === true));
assert.strictEqual(previewApp.agent.skills[0].path, 'skills/fosu-campus');
assert.strictEqual(previewProject.libVersion, '3.16.2');
assert(!previewProject.packOptions.ignore.some((item) => item.type === 'suffix' && item.value === '.md'));
assert(fs.existsSync(path.join(previewRoot, previewApp.agent.instruction)));
assert(fs.existsSync(path.join(previewRoot, previewApp.agent.skills[0].path, 'SKILL.md')));
assert.strictEqual(schema.apis.length, 3);
assert(schema.apis.every((item) => item._meta && item._meta.ui && item._meta.ui.pagePath));
assert(pageMeta.pages.some((item) => item.path.includes('ai-assistant')));
assert(pageMeta.pages.some((item) => item.path === '/pages/schedule-view/schedule-view'));

const requests = [];
let responder = () => ({ success: false });
const handlers = {};
const storage = {};
global.wx = {
  modelContext: {
    createSkill(name) {
      assert.strictEqual(name, previewApp.agent.skills[0].path);
      return { registerAPI(apiName, handler) { handlers[apiName] = handler; } };
    },
  },
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = value; },
  login(options) { options.success({ code: 'MOCK_LOGIN_CODE' }); },
  request(options) {
    requests.push(options);
    try {
      const url = new URL(options.url);
      const response = url.pathname === '/api/fosu/session/bootstrap'
        ? { success: true, sessionToken: 'MOCK_SESSION_TOKEN', expiresAt: new Date(Date.now() + 3600000).toISOString() }
        : responder(url);
      options.success({ statusCode: response.statusCode || 200, data: response.data || response });
    } catch (error) { options.fail(error); }
  },
};
require(path.join(previewRoot, 'skills/fosu-campus/index.js'));
assert.deepStrictEqual(Object.keys(handlers).sort(), schema.apis.map((item) => item.name).sort());

async function run() {
  const beforeSensitive = requests.length;
  const sensitive = await handlers.searchCampusSchedule({ type: 'teacher', keyword: '学号 123456789012' });
  assert.strictEqual(sensitive.isError, true);
  assert.strictEqual(requests.length, beforeSensitive, 'sensitive input must not reach API');

  responder = (url) => {
    assert.strictEqual(url.pathname, '/api/fosu/release-pack/search');
    assert.strictEqual(url.searchParams.get('type'), 'teacher');
    assert.strictEqual(url.searchParams.get('q'), '陈芳');
    return {
      success: true, term: '2026-2027-1', releaseVersion: 'release-1', total: 1,
      decision: {
        kind: 'unique', item: { teacherName: '陈芳', privateToken: 'DO_NOT_EXPOSE' },
        navigation: { name: '陈芳', canOpen: true, url: '/pages/schedule-view/schedule-view?type=teacher&id=verified-id&releaseVersion=release-1' },
      },
    };
  };
  const search = await handlers.searchCampusSchedule({ type: 'teacher', keyword: '陈芳' });
  assert.strictEqual(search.isError, false);
  assert.strictEqual(search.structuredContent.results[0].name, '陈芳');
  assert(search.structuredContent.results[0].pagePath.includes('verified-id'));
  assert.deepStrictEqual(search.handoff(), {
    path: '/pages/schedule-view/schedule-view',
    query: 'type=teacher&id=verified-id&releaseVersion=release-1',
  });
  assert(!JSON.stringify(search).includes('DO_NOT_EXPOSE'), 'raw search item must stay outside model context');
  assert(!JSON.stringify(search).includes('MOCK_SESSION_TOKEN'), 'session token must stay outside model context');

  responder = (url) => {
    if (url.pathname === '/api/fosu/teaching-calendar') return {
      success: true, term: '2026-2027-1', releaseVersion: 'release-1',
      weeks: [{ weekNo: 2, startDate: '2026-09-14', endDate: '2026-09-20', title: '正常教学周', note: '' }],
    };
    assert.strictEqual(url.pathname, '/api/fosu/empty-classrooms');
    assert.strictEqual(url.searchParams.get('week'), '2');
    assert.strictEqual(url.searchParams.get('sections'), '3-4');
    return {
      success: true, term: '2026-2027-1', releaseVersion: 'release-1', total: 1,
      rooms: [{ roomName: 'C7-102', building: 'C7', campus: '仙溪', todayCourses: [{ studentId: 'DO_NOT_EXPOSE' }] }],
    };
  };
  const empty = await handlers.findEmptyClassrooms({ date: '2026-09-17', sections: '3-4' });
  assert.strictEqual(empty.isError, false);
  assert.strictEqual(empty.structuredContent.rooms[0].roomName, 'C7-102');
  assert(!JSON.stringify(empty).includes('DO_NOT_EXPOSE'), 'raw occupancy details must stay outside model context');
  assert(empty.structuredContent.pagePath.startsWith('/pages/empty-room/empty-room?'));
  assert.strictEqual(empty.handoff().path, '/pages/empty-room/empty-room');

  const week = await handlers.getTeachingWeek({ date: '2026-09-17' });
  assert.strictEqual(week.structuredContent.weekNo, 2);
  assert.deepStrictEqual(week.handoff(), { path: '/pages/calendar/calendar', query: '' });
  const outside = await handlers.getTeachingWeek({ date: '2026-10-01' });
  assert.strictEqual(outside.structuredContent.inTerm, false);
  assert(!JSON.stringify(outside).includes('第 2 教学周'));

  responder = (url) => url.pathname === '/api/fosu/teaching-calendar'
    ? { success: true, term: '2026-2027-1', releaseVersion: 'release-1', weeks: [{ weekNo: 2, startDate: '2026-09-14', endDate: '2026-09-20' }] }
    : { success: true, term: '2026-2027-1', releaseVersion: 'release-2', total: 1, rooms: [{ roomName: 'C7-102' }] };
  const mismatch = await handlers.findEmptyClassrooms({ date: '2026-09-17', sections: '3-4' });
  assert.strictEqual(mismatch.isError, true, 'cross-version empty-room result must be rejected');

  const publicRequests = requests.filter((item) => item.method === 'GET');
  assert.strictEqual(requests.filter((item) => item.method === 'POST').length, 1, 'only session bootstrap may write');
  assert(requests.every((item) => new URL(item.url).pathname.startsWith('/api/fosu/')));
  assert(publicRequests.every((item) => item.header['X-Fosu-Session'] === 'MOCK_SESSION_TOKEN'));
  console.log(`test-wechat-ai-preview passed (${publicRequests.length} read-only requests, 1 session bootstrap)`);
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { fs.rmSync(output, { recursive: true, force: true }); });
