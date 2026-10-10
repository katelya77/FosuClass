"use strict";
function failure(code) { return Object.assign(new Error(code), { code }); }
function readHidden(prompt, options = {}) {
  const input = options.input || process.stdin, output = options.output || process.stderr;
  const signal = options.signal;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") return Promise.reject(failure("SCHOOL_AUTH_INTERACTIVE_TTY_REQUIRED"));
  if (signal && signal.aborted) return Promise.reject(failure("COLLECTOR_STOPPED"));
  return new Promise((resolve, reject) => {
    let value = "", done = false;
    const wasRaw = Boolean(input.isRaw), wasPaused = input.isPaused();
    function finish(error) {
      if (done) return;
      done = true;
      input.removeListener("data", onData); input.removeListener("end", onEnd); input.removeListener("error", onError);
      if (signal) signal.removeEventListener("abort", onAbort);
      try { input.setRawMode(wasRaw); if (wasPaused) input.pause(); output.write("\n"); } catch (_) { error = error || failure("SCHOOL_AUTH_INTERACTIVE_TTY_REQUIRED"); }
      const result = value; value = "";
      error ? reject(error) : resolve(result);
    }
    function onEnd() { finish(failure("SCHOOL_AUTH_INPUT_REQUIRED")); }
    function onError() { finish(failure("SCHOOL_AUTH_INTERACTIVE_TTY_REQUIRED")); }
    function onAbort() { finish(failure("COLLECTOR_STOPPED")); }
    function onData(chunk) {
      const text = String(chunk);
      // Reject escape sequences/bracketed paste and multiline pastes; never echo input.
      if (/[\x00-\x02\x05-\x07\x0b\x0c\x0e-\x1f]/.test(text)) return finish(failure("SCHOOL_AUTH_INPUT_REJECTED"));
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === "\x03") return finish(failure("COLLECTOR_STOPPED"));
        if (char === "\x04") return finish(failure("SCHOOL_AUTH_INPUT_REQUIRED"));
        if (char === "\r" || char === "\n") {
          if (text.slice(i + 1).replace(/^\n/, "")) return finish(failure("SCHOOL_AUTH_INPUT_REJECTED"));
          return finish(value ? null : failure("SCHOOL_AUTH_INPUT_REQUIRED"));
        }
        if (char === "\x7f" || char === "\b") value = Array.from(value).slice(0, -1).join("");
        else value += char;
        if (value.length > (options.maxLength || 1024)) return finish(failure("SCHOOL_AUTH_INPUT_REJECTED"));
      }
    }
    try {
      output.write(prompt); input.setRawMode(true);
      input.on("data", onData); input.once("end", onEnd); input.once("error", onError);
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      input.resume();
    } catch (_) { finish(failure("SCHOOL_AUTH_INTERACTIVE_TTY_REQUIRED")); }
  });
}
async function credentials(options = {}) {
  const account = (await readHidden("学校账号（隐藏输入）: ", { ...options, maxLength: 256 })).trim();
  const password = await readHidden("学校密码（隐藏输入，仅本次使用）: ", options);
  if (!account) throw failure("SCHOOL_AUTH_INPUT_REQUIRED");
  return { account, password };
}
module.exports = { readHidden, credentials };
