import { connect } from "cloudflare:sockets";
import { onRequest as handleNativeAdpChat } from "./api/adp/chat.ts";

const ADP_PUBLIC_ORIGIN = "http://101.42.184.216";
const ADP_HOST = "101.42.184.216";
const ADP_PORT = 80;
const MAX_REQUEST_BODY_BYTES = 12 * 1024 * 1024;

const DIRECT_API_PREFIXES = [
  "/account/",
  "/application/",
  "/chat/",
  "/dev/",
  "/feedback/",
  "/file/",
  "/helper/",
  "/reference/",
  "/share/",
  "/system/",
];

const BLOCKED_ORIGIN_PREFIXES = [
  "/adp",
  "/admin",
  "/api/admin",
  "/openapi",
  "/swagger",
  "/.git",
];

function isSameOriginRequest(request, requestUrl) {
  const origin = request.headers.get("origin");
  return !origin || origin === requestUrl.origin;
}

function resolveUpstreamPath(pathname) {
  if (pathname.startsWith("/adp-chat-client/")) return pathname;
  if (pathname === "/adp-chat-client") return "/adp-chat-client/";
  if (pathname.startsWith("/webim/")) return pathname;
  if (pathname === "/webim") return "/webim/";

  if (pathname.startsWith("/adp-origin/")) {
    const upstreamPath = pathname.slice("/adp-origin".length) || "/";
    const lower = upstreamPath.toLowerCase();
    if (BLOCKED_ORIGIN_PREFIXES.some((prefix) => lower.startsWith(prefix))) return null;
    return upstreamPath;
  }

  if (DIRECT_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return pathname;
  return null;
}

function upstreamRequestHeaders(request) {
  const headers = new Headers();
  for (const name of [
    "accept",
    "accept-language",
    "content-type",
    "if-modified-since",
    "if-none-match",
    "range",
    "user-agent",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("host", ADP_HOST);
  headers.set("connection", "close");
  headers.set("accept-encoding", "identity");
  headers.set("origin", ADP_PUBLIC_ORIGIN);
  return headers;
}

function concatBytes(left, right) {
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left);
  merged.set(right, left.length);
  return merged;
}

function findSequence(bytes, sequence) {
  outer: for (let index = 0; index <= bytes.length - sequence.length; index += 1) {
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (bytes[index + offset] !== sequence[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

async function readResponseHead(reader) {
  const headerEnd = new Uint8Array([13, 10, 13, 10]);
  let buffer = new Uint8Array();
  while (buffer.length <= 64 * 1024) {
    const end = findSequence(buffer, headerEnd);
    if (end >= 0) {
      return {
        head: new TextDecoder().decode(buffer.slice(0, end)),
        initialBody: buffer.slice(end + headerEnd.length),
      };
    }
    const chunk = await reader.read();
    if (chunk.done) throw new Error("ADP closed before sending response headers");
    buffer = concatBytes(buffer, chunk.value);
  }
  throw new Error("ADP response headers exceeded 64 KiB");
}

async function* socketChunks(reader, initialBody) {
  if (initialBody.length) yield initialBody;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return;
    yield chunk.value;
  }
}

async function* decodeChunked(source) {
  const crlf = new Uint8Array([13, 10]);
  let buffer = new Uint8Array();
  let expected = null;

  for await (const chunk of source) {
    buffer = concatBytes(buffer, chunk);
    while (true) {
      if (expected === null) {
        const lineEnd = findSequence(buffer, crlf);
        if (lineEnd < 0) break;
        const sizeLine = new TextDecoder().decode(buffer.slice(0, lineEnd)).split(";", 1)[0].trim();
        expected = Number.parseInt(sizeLine, 16);
        if (!Number.isFinite(expected) || expected < 0) throw new Error("Invalid chunk size");
        buffer = buffer.slice(lineEnd + 2);
        if (expected === 0) return;
      }
      if (buffer.length < expected + 2) break;
      yield buffer.slice(0, expected);
      buffer = buffer.slice(expected + 2);
      expected = null;
    }
  }
}

function responseBodyStream(reader, initialBody, socket, chunked) {
  const source = socketChunks(reader, initialBody);
  const iterator = (chunked ? decodeChunked(source) : source)[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          reader.releaseLock();
          await socket.close();
          return;
        }
        controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
        await socket.close();
      }
    },
    async cancel() {
      await reader.cancel();
      await socket.close();
    },
  });
}

async function requestAdp(request, upstreamPath, search = "") {
  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? new Uint8Array(await request.arrayBuffer()) : new Uint8Array();
  if (body.length > MAX_REQUEST_BODY_BYTES) throw new Error("Request body exceeds relay limit");

  const headers = upstreamRequestHeaders(request);
  if (hasBody) headers.set("content-length", String(body.length));

  const socket = connect(
    { hostname: ADP_HOST, port: ADP_PORT },
    { allowHalfOpen: true, secureTransport: "off" },
  );
  await socket.opened;

  const writer = socket.writable.getWriter();
  const headerLines = [];
  headers.forEach((value, name) => headerLines.push(`${name}: ${value}`));
  const requestHead = `${method} ${upstreamPath}${search} HTTP/1.1\r\n${headerLines.join("\r\n")}\r\n\r\n`;
  await writer.write(new TextEncoder().encode(requestHead));
  if (body.length) await writer.write(body);
  await writer.close();

  const reader = socket.readable.getReader();
  const { head, initialBody } = await readResponseHead(reader);
  const [statusLine, ...headerLinesIn] = head.split("\r\n");
  const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s+(.*))?$/.exec(statusLine);
  if (!statusMatch) {
    await socket.close();
    throw new Error("Invalid ADP HTTP status line");
  }

  const status = Number.parseInt(statusMatch[1], 10);
  const statusText = statusMatch[2] || "";
  const responseHeaders = new Headers();
  for (const line of headerLinesIn) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    if (name === "set-cookie") continue;
    responseHeaders.append(name, line.slice(separator + 1).trim());
  }
  const chunked = /\bchunked\b/i.test(responseHeaders.get("transfer-encoding") || "");
  responseHeaders.delete("connection");
  responseHeaders.delete("keep-alive");
  responseHeaders.delete("transfer-encoding");
  if (chunked) responseHeaders.delete("content-length");

  const noBody = method === "HEAD" || status === 204 || status === 205 || status === 304;
  if (noBody) {
    await reader.cancel();
    await socket.close();
    return new Response(null, { status, statusText, headers: responseHeaders });
  }

  return new Response(responseBodyStream(reader, initialBody, socket, chunked), {
    status,
    statusText,
    headers: responseHeaders,
  });
}

function rewriteLocation(value, publicOrigin) {
  if (!value) return value;
  if (value.startsWith(`${ADP_PUBLIC_ORIGIN}/adp-chat-client`)) {
    return value.replace(ADP_PUBLIC_ORIGIN, publicOrigin);
  }
  if (value.startsWith(`${ADP_PUBLIC_ORIGIN}/webim`)) {
    return value.replace(ADP_PUBLIC_ORIGIN, publicOrigin);
  }
  if (value.startsWith(ADP_PUBLIC_ORIGIN)) {
    return `${publicOrigin}/adp-origin${value.slice(ADP_PUBLIC_ORIGIN.length)}`;
  }
  return value;
}

function relayError(status, message) {
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff8f4;color:#332724;font:15px/1.7 system-ui,-apple-system,"Microsoft YaHei",sans-serif}.card{max-width:34rem;margin:2rem;padding:2rem;border:1px solid #f0d8d1;border-radius:26px;background:#fffdfb;box-shadow:0 24px 70px rgba(132,62,47,.12);text-align:center}strong{display:block;margin-bottom:.5rem;color:#b94535;font-size:1.25rem}</style></head><body><div class="card"><strong>小序安全连接暂不可用</strong>${message}</div></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

async function healthCheck() {
  try {
    const response = await requestAdp(new Request(`${ADP_PUBLIC_ORIGIN}/`), "/adp-chat-client/");
    if (response.body) await response.body.cancel();
    return new Response(null, {
      status: response.ok ? 204 : 503,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return new Response(null, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}

/**
 * Cloudflare Pages HTTPS relay for the two public, anonymous ADP experiences.
 * The upstream host is fixed, admin routes are denied, credentials are stripped,
 * and response bodies remain streamed except for the tiny WebIM runtime config.
 */
export async function onRequest({ request, env }) {
  const requestUrl = new URL(request.url);

  if (requestUrl.pathname === "/api/adp/chat") return handleNativeAdpChat({ request, env });

  if (requestUrl.pathname === "/adp-relay-health") return healthCheck();

  if (!isSameOriginRequest(request, requestUrl)) {
    return relayError(403, "此连接只接受当前体验页发起的请求。");
  }

  const upstreamPath = resolveUpstreamPath(requestUrl.pathname);
  if (!upstreamPath) return relayError(404, "该路径不属于公开真机体验范围。");

  let upstreamResponse;
  try {
    upstreamResponse = await requestAdp(request, upstreamPath, requestUrl.search);
  } catch {
    return relayError(502, "上游真机暂时没有响应，请返回案例引导并使用外开入口。");
  }

  const headers = new Headers(upstreamResponse.headers);
  headers.delete("set-cookie");
  headers.set("x-content-type-options", "nosniff");
  const location = rewriteLocation(headers.get("location"), requestUrl.origin);
  if (location) headers.set("location", location);

  const isWebimConfig = requestUrl.pathname === "/webim/config.js";
  if (isWebimConfig) {
    const source = await upstreamResponse.text();
    const rewritten = source.replace(
      /domain\s*:\s*['"]http:\/\/101\.42\.184\.216\/['"]/,
      "domain: window.location.origin + '/adp-origin/'",
    );
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.set("cache-control", "no-store");
    headers.set("content-type", "application/javascript; charset=utf-8");
    return new Response(rewritten, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}
