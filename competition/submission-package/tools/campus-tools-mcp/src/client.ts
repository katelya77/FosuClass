import { createHmac } from "node:crypto";
import type { CampusToolInputs, CampusToolName, ToolEnvelope } from "./contracts";

export interface CampusToolsClientOptions {
  baseUrl: string;
  token?: string;
  signingSecret?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class CampusToolsClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly signingSecret?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CampusToolsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.signingSecret = options.signingSecret;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call<TName extends CampusToolName>(
    name: TName,
    input: CampusToolInputs[TName],
  ): Promise<ToolEnvelope> {
    const pathname = `/api/${name}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.signingSecret) {
      headers["X-Campus-Timestamp"] = timestamp;
      headers["X-Campus-Signature"] = createHmac("sha256", this.signingSecret)
        .update(`${timestamp}\nPOST\n${pathname}`)
        .digest("hex");
    }

    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const payload = await response.json() as ToolEnvelope;
    if (!payload || typeof payload.success !== "boolean" || !payload.queryId) {
      throw new Error("CampusTools 返回了无效信封");
    }
    return payload;
  }
}
