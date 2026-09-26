const { API_BASE_URL } = require("../config/api");
const platform = require("./platform");

const MINI_PROGRAM_ORIGINAL_ID = "gh_dd273373210c";
const MINI_PROGRAM_TYPES = Object.freeze({ release: 0, develop: 1, trial: 2 });
const DOCUMENT_EXTENSIONS = ["xls", "xlsx", "html", "htm", "txt", "csv"];

function getRuntime(wxLike) {
  if (wxLike) return wxLike;
  return typeof wx !== "undefined" ? wx : null;
}

function invoke(api, options, errorCode) {
  return new Promise((resolve, reject) => {
    if (typeof api !== "function") {
      reject(Object.assign(new Error(`${errorCode}_UNSUPPORTED`), { code: `${errorCode}_UNSUPPORTED` }));
      return;
    }
    api(Object.assign({}, options || {}, {
      success: (result) => resolve(result || {}),
      fail: (originalError) => reject(Object.assign(new Error(errorCode), {
        code: errorCode,
        originalError,
      })),
    }));
  });
}

async function getMiniProgramCode(wxLike) {
  const runtime = getRuntime(wxLike);
  if (!runtime) {
    throw Object.assign(new Error("WX_RUNTIME_UNAVAILABLE"), { code: "WX_RUNTIME_UNAVAILABLE" });
  }
  const useMultiEndLogin = platform.isMultiEndApp(runtime);
  const loginApi = useMultiEndLogin ? runtime.getMiniProgramCode : runtime.login;
  const result = await invoke(
    loginApi && loginApi.bind(runtime),
    {},
    useMultiEndLogin ? "WX_MINI_PROGRAM_CODE_FAILED" : "WX_LOGIN_FAILED"
  );
  if (result && result.code) return result.code;
  throw Object.assign(new Error("WX_LOGIN_CODE_MISSING"), { code: "WX_LOGIN_CODE_MISSING" });
}

function normalizeChosenFiles(result) {
  return Object.assign({}, result || {}, {
    tempFiles: Array.isArray(result && result.tempFiles) ? result.tempFiles.map((file) => ({
      name: String(file && file.name || ""),
      path: String(file && (file.path || file.tempFilePath) || ""),
      size: Number(file && file.size || 0),
    })) : [],
  });
}

async function chooseDocument(options, wxLike) {
  const runtime = getRuntime(wxLike);
  const input = options || {};
  if (!runtime) {
    throw Object.assign(new Error("WX_RUNTIME_UNAVAILABLE"), { code: "WX_RUNTIME_UNAVAILABLE" });
  }
  if (platform.isMultiEndApp(runtime)) {
    const chooseFile = runtime.miniapp && runtime.miniapp.chooseFile;
    const result = await invoke(
      chooseFile && chooseFile.bind(runtime.miniapp),
      { allowsMultipleSelection: Number(input.count || 1) > 1 },
      "WX_CHOOSE_FILE_FAILED"
    );
    return normalizeChosenFiles(result);
  }
  const result = await invoke(
    runtime.chooseMessageFile && runtime.chooseMessageFile.bind(runtime),
    input,
    "WX_CHOOSE_FILE_FAILED"
  );
  return normalizeChosenFiles(result);
}

function isSupportedDocument(file) {
  const name = String(file && file.name || "").toLowerCase();
  const extension = name.indexOf(".") >= 0 ? name.split(".").pop() : "";
  return DOCUMENT_EXTENSIONS.indexOf(extension) >= 0;
}

function getMiniProgramType(envVersion) {
  const normalized = String(envVersion || "release").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MINI_PROGRAM_TYPES, normalized)
    ? MINI_PROGRAM_TYPES[normalized]
    : MINI_PROGRAM_TYPES.release;
}

function shareMiniProgram(options, wxLike) {
  const runtime = getRuntime(wxLike);
  const share = runtime && runtime.miniapp && runtime.miniapp.shareMiniProgramMessage;
  const input = options || {};
  return invoke(share && share.bind(runtime.miniapp), {
    userName: MINI_PROGRAM_ORIGINAL_ID,
    path: input.path || "pages/index/index",
    title: input.title || "佛课小表｜查看课程安排",
    imagePath: input.imagePath || "/assets/logo/favicon.png",
    webpageUrl: input.webpageUrl || API_BASE_URL,
    withShareTicket: true,
    miniprogramType: Number.isInteger(input.miniprogramType) ? input.miniprogramType : 0,
    scene: Number.isInteger(input.scene) ? input.scene : 0,
  }, "WX_SHARE_MINI_PROGRAM_FAILED");
}

module.exports = {
  DOCUMENT_EXTENSIONS,
  MINI_PROGRAM_ORIGINAL_ID,
  MINI_PROGRAM_TYPES,
  chooseDocument,
  getMiniProgramCode,
  getMiniProgramType,
  isSupportedDocument,
  normalizeChosenFiles,
  shareMiniProgram,
};
