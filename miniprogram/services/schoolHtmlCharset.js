function toUint8(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(data)) return new Uint8Array(data);
  return new Uint8Array(0);
}

function latin1(bytes) {
  let text = "";
  const sample = bytes.subarray(0, 1200);
  for (let index = 0; index < sample.length; index += 1) text += String.fromCharCode(sample[index]);
  return text;
}

function detectCharset(contentType, data) {
  const header = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(String(contentType || ""));
  if (header) return header[1].toLowerCase();
  const meta = /charset\s*=\s*["']?\s*([a-zA-Z0-9_-]+)/i.exec(latin1(toUint8(data)));
  return meta ? meta[1].toLowerCase() : "utf-8";
}

function utf8Text(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("utf8");
  return new TextDecoder("utf-8").decode(bytes);
}

function decodeSchoolHtml(data, contentType, iconv) {
  const bytes = toUint8(data);
  const charset = detectCharset(contentType, bytes);
  const encoding = /gb2312|gbk|gb18030/.test(charset) ? "gbk" : "utf8";
  if (encoding === "utf8") return { html: utf8Text(bytes), charset: "utf8" };
  if (iconv && typeof iconv.decode === "function") {
    const buffer = typeof Buffer !== "undefined" ? Buffer.from(bytes) : bytes;
    return { html: iconv.decode(buffer, "gbk"), charset: "gbk" };
  }
  try {
    return { html: new TextDecoder("gbk").decode(bytes), charset: "gbk" };
  } catch (error) {
    return { html: "", charset: "gbk" };
  }
}

module.exports = {
  detectCharset,
  decodeSchoolHtml,
};
