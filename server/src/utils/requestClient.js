/**
 * HTTP 请求客户端：包装 axios，支持 tough-cookie、自动字符集解码、请求日志及错误拦截与重试机制。
 */

const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const iconv = require("iconv-lite");
const { safeLog } = require("./safeLogger");
const globalConfig = require("../config");

// NOTE: 包装 axios 以支持 tough-cookie
const axiosClient = wrapper(axios.default || axios);

/**
 * 格式化 Axios 错误，生成统一错误结构并隐去敏感信息
 * @param {Error} error Axios 错误对象
 * @returns {Object} 统一的错误结构
 */
function formatError(error) {
  const response = error.response;
  return {
    success: false,
    message: error.message || "请求教务系统失败",
    status: response?.status || 500,
    url: error.config?.url,
    method: error.config?.method?.toUpperCase(),
    // 隐去敏感 headers
    headers: response ? {
      "content-type": response.headers["content-type"],
      "content-length": response.headers["content-length"],
    } : undefined,
  };
}

/**
 * 创建具有特定配置的 HTTP 客户端
 * @param {Object} options 配置项
 * @returns {import("axios").AxiosInstance} Axios 实例
 */
function createClient(options) {
  const config = options || {};
  const jar = config.jar || new CookieJar();
  const timeout = config.timeout || globalConfig.REQUEST_TIMEOUT_MS;

  const instance = axiosClient.create({
    jar,
    timeout,
    withCredentials: true,
    responseType: "arraybuffer", // 统一以 arraybuffer 接收，便于后续 iconv 智能解码
    maxRedirects: 5, // 允许跟随 302 重定向
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });

  // 请求拦截器：记录请求（脱敏）
  instance.interceptors.request.use(
    (req) => {
      const logParams = req.params || {};
      safeLog("fosu-http-request", {
        method: req.method?.toUpperCase(),
        url: req.url,
        params: logParams,
        hasBody: Boolean(req.data),
      });
      return req;
    },
    (error) => Promise.reject(error)
  );

  // 响应拦截器：自动检测字符集并解码，支持自动失败重试最多 1 次
  instance.interceptors.response.use(
    (response) => {
      const contentType = response.headers["content-type"] || "";
      const isGbk = /charset=gbk/i.test(contentType) || /charset=gb2312/i.test(contentType);
      
      let text = "";
      try {
        if (isGbk) {
          text = iconv.decode(response.data, "gbk");
        } else {
          text = iconv.decode(response.data, "utf8");
        }
      } catch (err) {
        safeLog("fosu-decode-error", { error: err.message });
        text = response.data.toString();
      }

      // 将解码后的文本重新赋给 response.data，便于后续处理
      response.data = text;
      return response;
    },
    async (error) => {
      const reqConfig = error.config;
      
      // 如果没有 reqConfig 或已发起过重试，直接抛出统一格式错误
      if (!reqConfig || reqConfig.__hasRetried) {
        const formattedErr = formatError(error);
        safeLog("fosu-http-error", formattedErr);
        return Promise.reject(formattedErr);
      }

      // 标记重试，防止死循环
      reqConfig.__hasRetried = true;
      safeLog("fosu-http-retry-attempt", {
        url: reqConfig.url,
        method: reqConfig.method?.toUpperCase(),
        message: error.message,
      });

      try {
        // 重试该请求
        return await instance(reqConfig);
      } catch (retryError) {
        const formattedRetryErr = formatError(retryError);
        safeLog("fosu-http-retry-failed", formattedRetryErr);
        return Promise.reject(formattedRetryErr);
      }
    }
  );

  return instance;
}

module.exports = {
  createClient,
};
