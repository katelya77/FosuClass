/**
 * 微信小程序 wx.request 网络请求封装
 */

const { API_BASE_URL } = require("../config/api");

function translateErrorMessage(payload, defaultMsg) {
  const reasonCode = payload ? payload.reasonCode : "";
  const msg = (payload ? payload.message : defaultMsg) || "请求服务发生网络异常";
  const msgLower = msg.toLowerCase();
  
  if (reasonCode === "NO_SYNC_DATA" || reasonCode === "NO_SCHEDULE_SYNCED") {
    return "暂未同步该专业课表，可稍后再试或联系维护者补充同步。";
  }

  if (reasonCode === "NO_MATCHED_CLASS") {
    return "已同步该专业课表，但没有匹配到指定班级。";
  }

  if (reasonCode === "INVALID_FILTER") {
    return "请选择学院、年级和专业后再查询课表。";
  }
  
  if (
    reasonCode === "FOSU_INTRANET_ONLY" ||
    msgLower.includes("enotfound") ||
    msgLower.includes("node_tls_handshake_failed") ||
    msgLower.includes("tls") ||
    msgLower.includes("handshake") ||
    msgLower.includes("disconnected") ||
    msgLower.includes("timeout") ||
    msgLower.includes("fail")
  ) {
    return "该数据需要维护者在校园网/VPN环境下同步后才能查看。\n\n你也可以导入自己的课表，帮助完善班级课表数据。";
  }
  
  const hasTechnicalKey = 
    msgLower.includes("captcha") ||
    msgLower.includes("login") ||
    msgLower.includes("fallback") ||
    msgLower.includes("mock") ||
    msgLower.includes("har") ||
    msgLower.includes("bnsk") ||
    msgLower.includes("debug");
    
  if (hasTechnicalKey) {
    return "该数据需要维护者在校园网/VPN环境下同步后才能查看。\n\n你也可以导入自己的课表，帮助完善班级课表数据。";
  }
  
  return msg;
}

/**
 * 基础请求封装
 * @param {string} url 相对路径，例如 '/api/fosu/catalog'
 * @param {string} method 请求方法，GET 或 POST
 * @param {Object} data 请求数据
 * @param {Object} options 附加配置项 (如 showLoading, title)
 * @returns {Promise<Object>} 请求成功的响应数据 payload
 */
function request(url, method = "GET", data = {}, options = {}) {
  const opt = Object.assign({ showLoading: true, loadingTitle: "正在加载..." }, options);

  if (opt.showLoading) {
    wx.showLoading({
      title: opt.loadingTitle,
      mask: true,
    });
  }

  // 拼接完整 URL，如果在小程序端动态注释切换了本地 IP，可直接支持
  const requestUrl = url.startsWith("http") ? url : `${API_BASE_URL}${url}`;

  return new Promise((resolve, reject) => {
    wx.request({
      url: requestUrl,
      method: method.toUpperCase(),
      data: data,
      header: {
        "content-type": method.toUpperCase() === "POST" ? "application/json" : "application/x-www-form-urlencoded",
      },
      timeout: 15000, // 默认超时时间 15 秒
      success: (res) => {
        if (opt.showLoading) {
          wx.hideLoading();
        }

        // 统一处理 HTTP 状态码非 200 的情况
        if (res.statusCode !== 200) {
          if (!opt.silentError) {
            showError("暂时无法连接教务数据服务");
          }
          reject(new Error(`HTTP status error: ${res.statusCode}`));
          return;
        }

        const payload = res.data;
        
        // 统一处理接口内部的 success: false 逻辑
        if (payload && payload.success === false) {
          const errMsg = translateErrorMessage(payload, payload.message);
          if (!opt.silentError) {
            showError(errMsg);
          }
          const err = new Error(errMsg);
          err.payload = payload;
          reject(err);
          return;
        }

        resolve(payload);
      },
      fail: (err) => {
        if (opt.showLoading) {
          wx.hideLoading();
        }
        const errMsg = translateErrorMessage(null, err.errMsg || "");
        if (!opt.silentError) {
          showError(errMsg);
        }
        console.error("wx.request failed", err);
        reject(err);
      },
    });
  });
}

/**
 * 弹出错误提示弹窗
 * @param {string} msg 错误信息
 */
function showError(msg) {
  wx.showModal({
    title: "提示",
    content: msg,
    showCancel: false,
    confirmText: "知道了",
  });
}

module.exports = {
  request,
  get: (url, data = {}, options = {}) => request(url, "GET", data, options),
  post: (url, data = {}, options = {}) => request(url, "POST", data, options),
};
