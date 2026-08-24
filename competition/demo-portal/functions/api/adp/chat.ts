import { connect } from "cloudflare:sockets";

const ADP_HOST = "101.42.184.216";
const ADP_FETCH_HOST = `${ADP_HOST}.nip.io`;
const ADP_PORT = 80;
const ADP_CHAT_PATH = "/adp/v2/chat";
const ADP_CHAT_URL = `http://${ADP_FETCH_HOST}${ADP_CHAT_PATH}?language=zh-CN`;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGE_CHARS = 2_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface Env {
  ADP_APP_KEY?: string;
}

interface WidgetActionInput {
  widgetId: string;
  widgetRunId: string;
  actionType: string;
  payload?: unknown;
  widgetSnapshot?: string;
}

interface ChatInput {
  conversationId?: string;
  message?: string;
  widgetAction?: WidgetActionInput;
}

interface PagesContext {
  request: Request;
  env: Env;
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { ok: false, code, message },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function containsCredentialField(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 8) return false;
  if (Array.isArray(value)) return value.some((item) => containsCredentialField(item, depth + 1));
  return Object.entries(value).some(([key, item]) => {
    if (/app.?key|authorization|secret|token/i.test(key)) return true;
    return containsCredentialField(item, depth + 1);
  });
}

function normalizeWidgetAction(value: unknown): WidgetActionInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const widgetId = typeof item.widgetId === "string" ? item.widgetId.trim() : "";
  const widgetRunId = typeof item.widgetRunId === "string" ? item.widgetRunId.trim() : "";
  const actionType = typeof item.actionType === "string" ? item.actionType.trim() : "";
  const widgetSnapshot = typeof item.widgetSnapshot === "string" ? item.widgetSnapshot : undefined;
  if (!widgetId || !widgetRunId || !actionType) return null;
  if (widgetId.length > 160 || widgetRunId.length > 160 || actionType.length > 160) return null;
  return { widgetId, widgetRunId, actionType, payload: item.payload, widgetSnapshot };
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left);
  merged.set(right, left.length);
  return merged;
}

function findSequence(bytes: Uint8Array, sequence: Uint8Array): number {
  outer: for (let index = 0; index <= bytes.length - sequence.length; index += 1) {
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (bytes[index + offset] !== sequence[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

async function readResponseHead(reader: ReadableStreamDefaultReader<Uint8Array>) {
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
    if (chunk.done) throw new Error("ADP closed before response headers");
    buffer = concatBytes(buffer, chunk.value);
  }
  throw new Error("ADP response headers exceeded limit");
}

async function* socketChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  initialBody: Uint8Array,
) {
  if (initialBody.length) yield initialBody;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return;
    yield chunk.value;
  }
}

async function* decodeChunked(source: AsyncGenerator<Uint8Array>) {
  const crlf = new Uint8Array([13, 10]);
  let buffer = new Uint8Array();
  let expected: number | null = null;
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

function createResponseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  initialBody: Uint8Array,
  socket: { close(): Promise<void> },
  chunked: boolean,
): ReadableStream<Uint8Array> {
  const base = socketChunks(reader, initialBody);
  const iterator = (chunked ? decodeChunked(base) : base)[Symbol.asyncIterator]();
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

async function streamAdp(body: Uint8Array, requestId: string): Promise<Response> {
  const socket = connect(
    { hostname: ADP_FETCH_HOST, port: ADP_PORT },
    { allowHalfOpen: true, secureTransport: "off" },
  );
  await socket.opened;

  const writer = socket.writable.getWriter();
  const requestHead = [
    `POST ${ADP_CHAT_PATH}?language=zh-CN HTTP/1.1`,
    `Host: ${ADP_FETCH_HOST}`,
    "Accept: text/event-stream",
    "Content-Type: application/json",
    "Accept-Language: zh-CN,zh;q=0.9",
    "Origin: http://101.42.184.216",
    "Referer: http://101.42.184.216/webim/",
    "User-Agent: CampusFlow-Judge-Portal/3.1",
    `Content-Length: ${body.length}`,
    "Accept-Encoding: identity",
    "Connection: close",
    "",
    "",
  ].join("\r\n");
  await writer.write(new TextEncoder().encode(requestHead));
  await writer.write(body);
  await writer.close();

  const reader = socket.readable.getReader();
  const { head, initialBody } = await readResponseHead(reader);
  const [statusLine, ...headerLines] = head.split("\r\n");
  const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s+(.*))?$/.exec(statusLine);
  if (!statusMatch) throw new Error("Invalid ADP status line");

  const status = Number.parseInt(statusMatch[1], 10);
  const statusText = statusMatch[2] || "";
  const upstreamHeaders = new Headers();
  for (const line of headerLines) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    if (["set-cookie", "connection", "keep-alive"].includes(name)) continue;
    upstreamHeaders.append(name, line.slice(separator + 1).trim());
  }
  const chunked = /\bchunked\b/i.test(upstreamHeaders.get("transfer-encoding") || "");
  upstreamHeaders.delete("transfer-encoding");
  if (chunked) upstreamHeaders.delete("content-length");
  upstreamHeaders.set("content-type", "text/event-stream; charset=utf-8");
  upstreamHeaders.set("cache-control", "no-store, no-cache, must-revalidate");
  upstreamHeaders.set("x-accel-buffering", "no");
  upstreamHeaders.set("x-content-type-options", "nosniff");
  upstreamHeaders.set("x-adp-request-id", requestId);
  upstreamHeaders.set("x-adp-transport", "competition-adp-sse");

  return new Response(createResponseStream(reader, initialBody, socket, chunked), {
    status,
    statusText,
    headers: upstreamHeaders,
  });
}

async function fetchAdp(body: Uint8Array, requestId: string): Promise<Response> {
  const upstream = await fetch(ADP_CHAT_URL, {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "accept-language": "zh-CN,zh;q=0.9",
      "content-type": "application/json",
      origin: "http://101.42.184.216",
      referer: "http://101.42.184.216/webim/",
    },
    body,
  });
  const headers = new Headers(upstream.headers);
  headers.delete("set-cookie");
  headers.delete("content-length");
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-store, no-cache, must-revalidate");
  headers.set("x-accel-buffering", "no");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-adp-request-id", requestId);
  headers.set("x-adp-transport", "competition-adp-sse");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export async function onRequest({ request, env }: PagesContext): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") {
    return jsonError(405, "method_not_allowed", "仅支持 POST。");
  }
  if (!sameOrigin(request)) return jsonError(403, "origin_denied", "仅接受当前体验页请求。");
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonError(415, "content_type", "请求必须使用 JSON。");
  }
  const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_BODY_BYTES) return jsonError(413, "body_too_large", "请求体过大。");

  const appKey = env.ADP_APP_KEY?.trim();
  if (!appKey) return jsonError(503, "adp_not_configured", "ADP 服务尚未配置。");

  let input: ChatInput;
  try {
    input = (await request.json()) as ChatInput;
  } catch {
    return jsonError(400, "invalid_json", "请求 JSON 无效。");
  }
  if (containsCredentialField(input)) {
    return jsonError(400, "credential_field_denied", "客户端请求不得包含凭据字段。");
  }

  const conversationId = input.conversationId?.trim();
  if (!conversationId || !UUID_PATTERN.test(conversationId)) {
    return jsonError(400, "conversation_id", "ConversationId 必须是 UUID。");
  }

  const message = input.message?.trim() || "";
  const widgetAction = normalizeWidgetAction(input.widgetAction);
  if ((!message && !widgetAction) || (message && widgetAction)) {
    return jsonError(400, "content", "每次请求只能提交文本或 WidgetAction。");
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return jsonError(400, "message_too_long", `问题不能超过 ${MAX_MESSAGE_CHARS} 字。`);
  }
  if (input.widgetAction && !widgetAction) {
    return jsonError(400, "widget_action", "WidgetAction 字段不完整。");
  }

  const requestId = crypto.randomUUID();
  const contents = message
    ? [{ Type: "text", Text: message }]
    : [
        {
          Type: "widget_action",
          WidgetAction: {
            WidgetId: widgetAction!.widgetId,
            WidgetRunId: widgetAction!.widgetRunId,
            ActionType: widgetAction!.actionType,
            Payload:
              typeof widgetAction!.payload === "string"
                ? widgetAction!.payload
                : JSON.stringify(widgetAction!.payload ?? {}),
            WidgetSnapshot: widgetAction!.widgetSnapshot || "",
          },
        },
      ];

  const upstreamBody = new TextEncoder().encode(
    JSON.stringify({
      RequestId: requestId,
      ConversationId: conversationId,
      AppKey: appKey,
      VisitorId: "competition-judge-portal",
      Contents: contents,
      Incremental: true,
      EnableMultiIntent: true,
      Stream: "enable",
    }),
  );

  try {
    const fetchResponse = await fetchAdp(upstreamBody, requestId);
    const cloudflareGeneratedFailure =
      (fetchResponse.status === 403 || fetchResponse.status >= 500) &&
      (fetchResponse.headers.has("cf-ray") ||
        fetchResponse.headers.get("server")?.toLowerCase() === "cloudflare");
    if (!cloudflareGeneratedFailure) return fetchResponse;

    await fetchResponse.body?.cancel();
    return await streamAdp(upstreamBody, requestId);
  } catch (fetchError) {
    try {
      return await streamAdp(upstreamBody, requestId);
    } catch (socketError) {
    console.error(
      "Native ADP upstream failed",
        fetchError instanceof Error ? fetchError.message : "unknown fetch error",
        socketError instanceof Error ? socketError.message : "unknown socket error",
    );
    return jsonError(502, "adp_upstream", "大赛 ADP 实时服务暂未响应。");
    }
  }
}
