const { performance } = require("perf_hooks");

const WARNINGS = {
  manifest: 2000,
  index: 8000,
  detail: 5000,
  emptyRoom: 8000,
};

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const eq = item.indexOf("=");
    if (eq >= 0) {
      args[item.slice(2, eq)] = item.slice(eq + 1);
    } else {
      args[item.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : "1";
    }
  }
  return args;
}

function joinUrl(server, path) {
  return `${String(server || "").replace(/\/+$/, "")}${path}`;
}

function byteLength(payload) {
  return Buffer.byteLength(JSON.stringify(payload || {}), "utf8");
}

async function requestJson(server, path, kind) {
  const url = joinUrl(server, path);
  const started = performance.now();
  const response = await fetch(url);
  const text = await response.text();
  const elapsedMs = Math.round(performance.now() - started);
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = { success: false, code: "INVALID_JSON", raw: text.slice(0, 200) };
  }
  const warningLimit = WARNINGS[kind] || 0;
  return {
    path,
    status: response.status,
    ok: response.ok,
    elapsedMs,
    cacheControl: response.headers.get("cache-control") || "",
    releaseVersion: data && (data.releaseVersion || data.version || data.activeReleaseVersion || (data.manifest && data.manifest.releaseVersion)) || "",
    counts: data && (data.counts || (data.manifest && data.manifest.counts) || {}) || {},
    bytes: Buffer.byteLength(text || "", "utf8"),
    schemaOk: Boolean(data && data.success !== false),
    warning: warningLimit && elapsedMs > warningLimit ? `${kind} > ${warningLimit}ms` : "",
    data,
  };
}

function firstId(indexPayload) {
  const item = indexPayload && Array.isArray(indexPayload.items) ? indexPayload.items[0] : null;
  return item && (item.id || item.detailId || item.classId || item.name || item.className || item.teacherName || item.roomName || item.courseName) || "";
}

function appendQuery(path, query) {
  const params = Object.keys(query || {})
    .filter((key) => query[key])
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
    .join("&");
  return params ? `${path}${path.includes("?") ? "&" : "?"}${params}` : path;
}

async function runVerify(options = {}) {
  const server = options.server;
  if (!server) {
    throw new Error("Missing --server");
  }
  const term = options.term || "";
  const releaseVersion = options.releaseVersion || options.version || "";
  const baseQuery = { term, releaseVersion };
  const results = [];

  results.push(await requestJson(server, "/api/health", "health"));
  results.push(await requestJson(server, "/api/fosu/app-config", "manifest"));
  results.push(await requestJson(server, appendQuery("/api/fosu/bootstrap", { semester: term }), "manifest"));

  const manifest = await requestJson(server, appendQuery("/api/fosu/release-pack/manifest", baseQuery), "manifest");
  results.push(manifest);
  const effectiveVersion = releaseVersion || manifest.releaseVersion;
  const versionQuery = { term, releaseVersion: effectiveVersion };
  const indexes = {};

  for (const kind of ["class", "teacher", "classroom", "course"]) {
    const result = await requestJson(server, appendQuery(`/api/fosu/release-pack/index/${kind}`, versionQuery), "index");
    indexes[kind] = result;
    results.push(result);
  }
  results.push(await requestJson(server, appendQuery("/api/fosu/release-pack/empty-room", versionQuery), "emptyRoom"));

  for (const kind of ["class", "teacher", "classroom", "course"]) {
    const id = firstId(indexes[kind] && indexes[kind].data);
    if (!id) {
      results.push({
        path: `/api/fosu/release-pack/detail/${kind}/<sample>`,
        status: 0,
        ok: false,
        elapsedMs: 0,
        cacheControl: "",
        releaseVersion: effectiveVersion,
        counts: {},
        bytes: 0,
        schemaOk: false,
        warning: "no sample id",
        data: null,
      });
      continue;
    }
    results.push(await requestJson(
      server,
      appendQuery(`/api/fosu/release-pack/detail/${kind}/${encodeURIComponent(id)}`, versionQuery),
      "detail"
    ));
  }

  const summary = results.map((item) => ({
    path: item.path,
    status: item.status,
    elapsedMs: item.elapsedMs,
    cacheControl: item.cacheControl,
    releaseVersion: item.releaseVersion,
    counts: item.counts,
    bytes: item.bytes || byteLength(item.data),
    schemaOk: item.schemaOk,
    warning: item.warning,
  }));
  const failed = summary.filter((item) => item.status < 200 || item.status >= 400 || !item.schemaOk);
  return {
    success: failed.length === 0,
    server,
    term,
    releaseVersion: effectiveVersion,
    summary,
    failed,
  };
}

if (require.main === module) {
  runVerify(parseArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error(error.message || error);
      process.exit(1);
    });
}

module.exports = {
  runVerify,
};
