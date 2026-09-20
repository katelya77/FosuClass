import { fetchAdp } from "./upstream";

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
    return await fetchAdp(upstreamBody, requestId);
  } catch (error) {
    console.error(
      "Native ADP upstream failed",
      error instanceof Error ? error.message : "unknown upstream error",
    );
    return jsonError(502, "adp_upstream", "大赛 ADP 实时服务暂未响应。");
  }
}
