/**
 * 微信小程序 wx.request 网络请求封装
 */

const { API_BASE_URL } = require("../config/api");

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
          showError("暂时无法连接教务数据服务");
          reject(new Error(`HTTP status error: ${res.statusCode}`));
          return;
        }

        const payload = res.data;
        
        // 统一处理接口内部的 success: false 逻辑
        if (payload && payload.success === false) {
          const errMsg = payload.message || "请求教务数据服务失败";
          showError(errMsg);
          reject(new Error(errMsg));
          return;
        }

        resolve(payload);
      },
      fail: (err) => {
        if (opt.showLoading) {
          wx.hideLoading();
        }
        showError("暂时无法连接教务数据服务");
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
