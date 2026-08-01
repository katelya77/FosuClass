// P4a：Config Publication Kernel 的 coded errors。
// 所有对外失败都必须带稳定 code，禁止裸 Error 穿过 API 边界。

function codedError(code, message, details) {
  const error = new Error(message || code);
  error.code = code;
  if (details && typeof details === "object") {
    Object.keys(details).forEach((key) => {
      if (key === "code" || key === "message") return;
      error[key] = details[key];
    });
  }
  return error;
}

module.exports = Object.freeze({
  codedError,
});
