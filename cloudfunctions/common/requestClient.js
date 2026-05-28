const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const iconv = require("iconv-lite");
const { safeLog } = require("./safeLogger");

// NOTE: 包装 axios 以支持 tough-cookie
const axiosClient = wrapper(axios.default || axios);

/**
 * 创建具有特定配置的 HTTP 客户端
 * @param {Object} options 配置项
 * @returns {import("axios").AxiosInstance} Axios 实例
 */
function createClient(options) {
  const config = options || {};
  const jar = config.jar || new CookieJar();
  const timeout = config.timeout || 12000;

  const instance = axiosClient.create({
    jar,
    timeout,
    withCredentials: true,
    responseType: "arraybuffer", // 统一以 arraybuffer 接收，便于后续 iconv 解码
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

  // 响应拦截器：自动检测字符集并解码
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
    (error) => {
      // 提取错误信息
      const errLog = {
        message: error.message,
        url: error.config?.url,
        method: error.config?.method,
        status: error.response?.status,
      };
      safeLog("fosu-http-error", errLog);
      return Promise.reject(error);
    }
  );

  return instance;
}

module.exports = {
  createClient,
};
