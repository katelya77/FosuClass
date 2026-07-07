const INVALID_COPY_TEXT = new Set(["[object Object]", "undefined", "null", "NaN"]);

function isPrimitive(value) {
  return ["string", "number", "boolean"].indexOf(typeof value) >= 0;
}

function primitiveToString(value) {
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function normalizeCopyText(value) {
  if (!isPrimitive(value)) return "";
  const text = primitiveToString(value).trim();
  if (!text || INVALID_COPY_TEXT.has(text)) return "";
  return text;
}

function showToast(wxRef, title) {
  if (!wxRef || typeof wxRef.showToast !== "function") return;
  wxRef.showToast({ title, icon: "none" });
}

function isClipboardOk(res) {
  const errMsg = res && typeof res.errMsg === "string" ? res.errMsg : "";
  return /setClipboardData:ok|clipboardData:ok|\bok\b/i.test(errMsg);
}

function warnClipboardFailure(error) {
  if (typeof console !== "undefined" && console.warn) {
    console.warn("[clipboard] wx.setClipboardData failed", error);
  }
}

function copyToClipboard(text, options = {}) {
  const wxRef = options.wx || (typeof wx !== "undefined" ? wx : null);
  const data = normalizeCopyText(text);
  const successTitle = options.successTitle || "已复制";
  const emptyTitle = options.emptyTitle || "暂无可复制内容";
  const failTitle = options.failTitle || "复制失败，可长按文本手动复制";
  const maxAttempts = options.retry === false ? 1 : 2;

  if (!data) {
    showToast(wxRef, emptyTitle);
    return Promise.resolve({ ok: false, empty: true, data: "" });
  }

  if (!wxRef || typeof wxRef.setClipboardData !== "function") {
    const error = new Error("wx.setClipboardData unavailable");
    warnClipboardFailure(error);
    showToast(wxRef, failTitle);
    return Promise.resolve({ ok: false, empty: false, data, error });
  }

  return new Promise((resolve) => {
    let resolved = false;
    let completeCalled = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      if (typeof options.complete === "function" && !completeCalled) {
        completeCalled = true;
        options.complete(result.res || result.error || result);
      }
      resolve(result);
    };

    const reportSuccess = (res) => {
      showToast(wxRef, successTitle);
      if (typeof options.success === "function") options.success(res);
      finish({ ok: true, empty: false, data, res });
    };

    const reportFailure = (error) => {
      warnClipboardFailure(error);
      showToast(wxRef, failTitle);
      if (typeof options.fail === "function") options.fail(error);
      finish({ ok: false, empty: false, data, error });
    };

    const attemptCopy = (attemptIndex, previousError) => {
      const attemptState = { settled: false };
      const maybeRetry = (error) => {
        if (attemptIndex + 1 < maxAttempts) {
          setTimeout(() => attemptCopy(attemptIndex + 1, error), 24);
          return;
        }
        reportFailure(error || previousError);
      };
      try {
        wxRef.setClipboardData({
          data,
          success(res) {
            if (attemptState.settled) return;
            attemptState.settled = true;
            reportSuccess(res);
          },
          fail(error) {
            if (attemptState.settled) return;
            attemptState.settled = true;
            if (isClipboardOk(error)) {
              reportSuccess(error);
              return;
            }
            maybeRetry(error);
          },
          complete(res) {
            if (typeof options.complete === "function" && resolved && !completeCalled) {
              completeCalled = true;
              options.complete(res);
            }
            if (attemptState.settled || !isClipboardOk(res)) return;
            attemptState.settled = true;
            reportSuccess(res);
          },
        });
      } catch (error) {
        maybeRetry(error);
      }
    };

    attemptCopy(0, null);
  });
}

module.exports = {
  copyToClipboard,
  normalizeCopyText,
};
