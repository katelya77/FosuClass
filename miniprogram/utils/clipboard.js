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

function copyToClipboard(text, options = {}) {
  const wxRef = options.wx || (typeof wx !== "undefined" ? wx : null);
  const data = normalizeCopyText(text);
  const successTitle = options.successTitle || "已复制";
  const emptyTitle = options.emptyTitle || "暂无可复制内容";
  const failTitle = options.failTitle || "复制失败，可长按文本手动复制";

  if (!data) {
    showToast(wxRef, emptyTitle);
    return Promise.resolve({ ok: false, empty: true, data: "" });
  }

  if (!wxRef || typeof wxRef.setClipboardData !== "function") {
    const error = new Error("wx.setClipboardData unavailable");
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[clipboard] wx.setClipboardData failed", error);
    }
    showToast(wxRef, failTitle);
    return Promise.resolve({ ok: false, empty: false, data, error });
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };
    try {
      wxRef.setClipboardData({
        data,
        success(res) {
          showToast(wxRef, successTitle);
          if (typeof options.success === "function") options.success(res);
          finish({ ok: true, empty: false, data, res });
        },
        fail(error) {
          if (typeof console !== "undefined" && console.warn) {
            console.warn("[clipboard] wx.setClipboardData failed", error);
          }
          showToast(wxRef, failTitle);
          if (typeof options.fail === "function") options.fail(error);
          finish({ ok: false, empty: false, data, error });
        },
        complete(res) {
          if (typeof options.complete === "function") options.complete(res);
        },
      });
    } catch (error) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[clipboard] wx.setClipboardData failed", error);
      }
      showToast(wxRef, failTitle);
      if (typeof options.fail === "function") options.fail(error);
      if (typeof options.complete === "function") options.complete(error);
      finish({ ok: false, empty: false, data, error });
    }
  });
}

module.exports = {
  copyToClipboard,
  normalizeCopyText,
};
