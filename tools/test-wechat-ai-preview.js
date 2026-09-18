const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { build } = require('./build-wechat-ai-preview');

const root = path.resolve(__dirname, '..');
const productionAppPath = path.join(root, 'miniprogram/app.json');
const productionBefore = fs.readFileSync(productionAppPath);
const knowledgeFile = path.join(root, 'experiments/wechat-ai/knowledge/fosu-xiaoxu-public-faq.md');
assert(fs.statSync(knowledgeFile).size < 10 * 1024 * 1024, 'single knowledge file must stay under the WeChat 10 MB limit');
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
assert.strictEqual(schema.apis.length, 9);
const capabilityManifest = JSON.parse(fs.readFileSync(path.join(root, 'server/config/agent-capability-manifest.json'), 'utf8'));
for (const [apiName, toolId] of Object.entries({
  searchCampusSchedule: 'search_school_index',
  findEmptyClassrooms: 'search_empty_rooms',
  getTeachingWeek: 'get_teaching_week',
  getTermCalendar: 'get_term_calendar',
  getDataStatus: 'diagnose_data_status',
  getCampusWeather: 'get_campus_weather',
  searchCampusPlace: 'search_campus_place',
})) {
  assert(schema.apis.some((api) => api.name === apiName));
  assert(capabilityManifest.tools[toolId], `missing authoritative Xiaoxu Tool ${toolId}`);
}
assert(schema.apis.filter((item) => item.name !== 'getCampusWeather')
  .every((item) => item._meta && item._meta.ui && item._meta.ui.pagePath));
assert(pageMeta.pages.some((item) => item.path === 'packageXiaofu/pages/ai-assistant/ai-assistant'));
assert(!pageMeta.pages.some((item) => item.path === 'pages/today/today'));
assert(pageMeta.pages.every((item) => !item.path.startsWith('/')),
  'page metadata paths must follow the relative path convention in the WeChat guide');
assert(Buffer.byteLength(JSON.stringify(pageMeta), 'utf8') <= 8000,
  'WeChat page metadata must stay below the documented 8000-byte limit');
const declaredPages = new Set([
  ...previewApp.pages,
  ...previewApp.subPackages.flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`)),
]);
for (const page of pageMeta.pages) {
  assert(declaredPages.has(page.path.split('?')[0]), `undeclared AI destination: ${page.path}`);
  assert(!page.path.includes('pages/today/today'), 'AI card must not land on the Today tab');
}

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
      options.success({ statusCode: response.statusCode || 200, data: response });
    } catch (error) { options.fail(error); }
  },
};
require(path.join(previewRoot, 'skills/fosu-campus/index.js'));
assert.deepStrictEqual(Object.keys(handlers).sort(), schema.apis.map((item) => item.name).sort());
const skillClient = require(path.join(previewRoot, 'skills/fosu-campus/client.js'));

async function run() {
  const beforePersonal = requests.length;
  for (const task of ['tomorrow', 'next', 'today', 'week', 'reminder']) {
    const personal = await handlers.openPersonalTask({ task });
    assert.strictEqual(personal.isError, false);
    assert.strictEqual(personal.handoff().path, '/packageXiaofu/pages/ai-assistant/ai-assistant');
    assert.strictEqual(personal.handoff().query, personal.structuredContent.pagePath.split('?')[1]);
    assert(pageMeta.pages.some((page) => `/${page.path}` === personal.structuredContent.pagePath),
      `${task} account-card route must match its Tool handoff exactly`);
    assert(!JSON.stringify(personal).includes('MOCK_SESSION_TOKEN'));
  }
  const tomorrow = await handlers.openPersonalTask({ task: 'tomorrow' });
  assert.strictEqual(new URLSearchParams(tomorrow.handoff().query).get('q'), '明天有什么课');
  const next = await handlers.openPersonalTask({ task: 'next' });
  assert.strictEqual(new URLSearchParams(next.handoff().query).get('q'), '我的下一节课');
  const importing = await handlers.openPersonalTask({ task: 'import' });
  assert.deepStrictEqual(importing.handoff(), { path: '/pages/personal-sync/personal-sync', query: '' });
  assert.strictEqual((await handlers.openPersonalTask({ task: 'unknown' })).isError, true);
  assert.strictEqual(requests.length, beforePersonal, 'personal handoff must not read private data');

  const broader = await handlers.openXiaoxuTask({ question: '检查我的课表冲突' });
  assert.strictEqual(broader.isError, false);
  assert.strictEqual(new URLSearchParams(broader.handoff().query).get('q'), '检查我的课表冲突');
  assert.strictEqual((await handlers.openXiaoxuTask({ question: '学号 123456789012 的课程' })).isError, true);
  assert.strictEqual(requests.length, beforePersonal, 'broader Xiaoxu handoff must not read private data');
  await assert.rejects(skillClient.get('/api/fosu/admin'), /INVALID_PUBLIC_ENDPOINT/);
  assert.strictEqual(requests.length, beforePersonal, 'unlisted endpoint must be rejected before network');

  responder = (url) => {
    if (url.pathname === '/api/fosu/teaching-calendar') return {
      success: true, term: '2026-2027-1', releaseVersion: 'release-1',
      weeks: [{ weekNo: 2, startDate: '2026-09-14', endDate: '2026-09-20', title: '正常教学周', note: '公开周历标注', privateToken: 'DO_NOT_EXPOSE' }],
    };
    if (url.pathname === '/api/fosu/app-config') return {
      success: true, data: { term: '2026-2027-1', releaseVersion: 'release-1', publishedAt: '2026-09-17T00:00:00Z', adminToken: 'DO_NOT_EXPOSE' },
    };
    if (url.pathname === '/api/ai/weather') return {
      success: true, weather: { success: true, campus: '仙溪校区', weatherText: '多云', temperatureC: 28,
        updatedAt: '2026-09-17T10:00:00Z', sourceId: 'weather-test', rawForecast: 'DO_NOT_EXPOSE' },
    };
    if (url.pathname === '/api/ai/campus-map/published') return {
      success: true, data: { version: 'map-1', places: [
        { name: '图书馆', campus: '江湾校区', area: '江湾校区', aliases: ['江湾图书馆'], verified: true, description: '已核验地点', internalNote: 'DO_NOT_EXPOSE' },
        { name: '图书馆旧址', campus: '江湾校区', verified: false, description: '不可见' },
      ] },
    };
    throw new Error(`unexpected read endpoint ${url.pathname}`);
  };
  const termCalendar = await handlers.getTermCalendar({});
  assert.strictEqual(termCalendar.structuredContent.weeks[0].weekNo, 2);
  assert(!JSON.stringify(termCalendar).includes('DO_NOT_EXPOSE'));
  const dataStatus = await handlers.getDataStatus({});
  assert.strictEqual(dataStatus.structuredContent.releaseVersion, 'release-1');
  assert(!JSON.stringify(dataStatus).includes('DO_NOT_EXPOSE'));
  const weather = await handlers.getCampusWeather({ campus: '仙溪校区', dateHint: 'tomorrow' });
  assert.strictEqual(weather.structuredContent.weatherText, '多云');
  assert.strictEqual(weather.structuredContent.dateLabel, '明天');
  assert(!JSON.stringify(weather).includes('DO_NOT_EXPOSE'));
  assert.strictEqual((await handlers.getCampusWeather({ campus: '未知校区' })).isError, true);
  const place = await handlers.searchCampusPlace({ keyword: '图书馆' });
  assert.strictEqual(place.structuredContent.matches.length, 1, 'unverified places stay outside model results');
  assert.strictEqual(place.handoff().path, '/packageMaps/pages/campus-map/campus-map');
  assert(!JSON.stringify(place).includes('DO_NOT_EXPOSE'));
  assert.strictEqual((await handlers.searchCampusPlace({ keyword: '学号 123456789012' })).isError, true);

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
  const allowedReadPaths = new Set([
    '/api/fosu/teaching-calendar', '/api/fosu/release-pack/search',
    '/api/fosu/empty-classrooms', '/api/fosu/app-config',
    '/api/ai/weather', '/api/ai/campus-map/published',
  ]);
  assert(publicRequests.every((item) => allowedReadPaths.has(new URL(item.url).pathname)));
  assert(publicRequests.every((item) => item.header['X-Fosu-Session'] === 'MOCK_SESSION_TOKEN'));
  console.log(`test-wechat-ai-preview passed (${publicRequests.length} read-only requests, 1 session bootstrap)`);
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { fs.rmSync(output, { recursive: true, force: true }); });
