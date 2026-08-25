import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AdpExperience } from "./AdpExperience";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("AdpExperience native API mode", () => {
  it("starts with a real same-origin composer instead of an iframe", () => {
    const { container } = render(<AdpExperience />);
    expect(screen.getByText("Native ADP API · 真实对话")).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("does not prefetch and exposes a clearly labelled verified replay", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AdpExperience />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Verified Replay" }));
    expect(screen.getAllByText("已核验实录回放").length).toBeGreaterThan(0);
    expect(screen.getByText(/非实时请求/)).toBeTruthy();
    expect(screen.getByAltText(/真实成功会话中由官方 ADP Widget SDK/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses AgentName, tool_call, reply and official Widget from SSE", async () => {
    const widgetView = JSON.stringify({ type: "Card", children: [{ type: "Text", value: "Verified" }] });
    const events = [
      { Type: "message.done", Message: { Name: "thought", ExtraInfo: { AgentName: "小序-主协调" }, Contents: [{ Type: "text", Text: "" }] } },
      { Type: "message.done", Message: { Name: "tool_call", ExtraInfo: { AgentName: "小序-校园洞察", ToolName: "校园智序-CampusTools/campus_teacher_load_query" }, Contents: [{ Type: "json_text", Text: "" }] } },
      { Type: "message.done", Message: { Name: "reply", ExtraInfo: { AgentName: "小序-校园洞察" }, Contents: [{ Type: "text", Text: "Top1 为教师025。" }, { Type: "widget", Widget: { WidgetId: "wid", WidgetRunId: "run", View: widgetView } }] } },
      { Type: "response.completed" },
    ];
    const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(payload, {
      status: 200,
      headers: { "content-type": "text/event-stream", "x-adp-request-id": "request-test" },
    })));

    render(<AdpExperience />);
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(screen.getByText("Top1 为教师025。")).toBeTruthy());
    expect(screen.getAllByText("小序-校园洞察").length).toBeGreaterThan(0);
    expect(screen.getByText("campus_teacher_load_query")).toBeTruthy();
    expect(document.querySelector("adp-widget")).not.toBeNull();
  });

  it("keeps the question and shows a concise retry message when ADP is rate limited", async () => {
    const payload = [
      { Type: "error", Error: { Code: 400429, Message: "RateLimit-请求速率超限" } },
      { Type: "response.completed" },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(payload, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })));

    render(<AdpExperience />);
    const originalQuestion = (screen.getByRole("textbox") as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(screen.getByText(/ADP 已返回限流/)).toBeTruthy());
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(originalQuestion);
    expect(screen.getByText(/不会自动重试/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /一键查看已核验演示/ })).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /一键查看已核验演示/ }));
    expect(screen.getAllByText("已核验实录回放").length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("enforces single-flight when two sends happen in the same turn", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdpExperience />);
    const send = screen.getByRole("button", { name: "发送" });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
