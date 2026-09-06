import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { App } from "./App";

afterEach(() => {
  cleanup();
  window.location.hash = "";
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function goTo(hash: string): void {
  window.location.hash = hash;
  window.dispatchEvent(new Event("hashchange"));
}

function completedSse(answer = "Top1 为教师025。"): Response {
  const payload = [
    { Type: "message.done", Message: { Name: "reply", ExtraInfo: { AgentName: "小序-校园洞察" }, Contents: [{ Type: "text", Text: answer }] } },
    { Type: "response.completed" },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("App routing", () => {
  it("resets scroll immediately when the top-level hash route changes", async () => {
    let scrollY = 720;
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
    const scrollTo = vi.fn((options: ScrollToOptions | number, y?: number) => {
      scrollY = typeof options === "number" ? (y ?? 0) : (options.top ?? 0);
    });
    vi.stubGlobal("scrollTo", scrollTo);

    window.location.hash = "#/";
    render(<App />);
    scrollTo.mockClear();

    goTo("#/capability");
    await screen.findByText("小序的每一步");
    expect(scrollY).toBe(0);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: "instant" });

    scrollY = 540;
    goTo("#/cases");
    await screen.findByText("四个案例，四次已核验的完整决策");
    expect(scrollY).toBe(0);
  });

  it("uses the same scroll-restoring navigation for desktop and mobile nav", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    window.location.hash = "#/";
    const { container } = render(<App />);
    scrollTo.mockClear();

    const desktopNav = container.querySelector("aside nav");
    expect(desktopNav).not.toBeNull();
    fireEvent.click(within(desktopNav as HTMLElement).getByRole("button", { name: "角色与能力" }));
    await waitFor(() => expect(window.location.hash).toBe("#/capability"));
    expect(scrollTo).toHaveBeenCalled();

    scrollTo.mockClear();
    fireEvent.click(within(screen.getByRole("navigation", { name: "移动端主导航" })).getByRole("button", { name: "已核验案例" }));
    await waitFor(() => expect(window.location.hash).toBe("#/cases"));
    expect(scrollTo).toHaveBeenCalled();
  });

  it("does not reset page scroll for an Experience scenario tab change", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    window.location.hash = "#/experience";
    render(<App />);
    await screen.findByText("真实智能体对话");
    scrollTo.mockClear();

    goTo("#/experience/query");
    await screen.findByText("这次想解决什么");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("renders the homepage hero without technical jargon", () => {
    window.location.hash = "#/";
    render(<App />);
    expect(screen.getByText(/说一句话/)).toBeTruthy();
    expect(screen.getAllByText(/校园智序/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("问问小序").length).toBeGreaterThan(0);
  });

  it("opens the verified cases page", async () => {
    window.location.hash = "#/";
    render(<App />);
    goTo("#/cases");
    expect(await screen.findByText("四个案例，四次已核验的完整决策")).toBeTruthy();
    expect(screen.getByText("多人协同")).toBeTruthy();
  });

  it("plays a clearly labelled non-live case replay", async () => {
    window.location.hash = "#/cases";
    render(<App />);
    fireEvent.click(await screen.findByText("学生的一天"));
    expect(await screen.findByRole("dialog", { name: "学生的一天已核验演示回放" })).toBeTruthy();
    expect(screen.getAllByText("已核验演示回放 · 非实时").length).toBeGreaterThan(0);
    expect(screen.getByText(/不伪装成实时请求/)).toBeTruthy();
  });

  it("opens the roles and abilities page", async () => {
    window.location.hash = "#/";
    render(<App />);
    goTo("#/capability");
    expect((await screen.findAllByText("角色与能力")).length).toBeGreaterThan(0);
  });

  it("redirects the retired about route back to the homepage", async () => {
    window.location.hash = "#/";
    render(<App />);
    goTo("#/about");
    expect((await screen.findAllByText("问问小序")).length).toBeGreaterThan(0);
  });

  it("opens an experience workspace directly from a case", async () => {
    window.location.hash = "#/";
    render(<App />);
    goTo("#/experience/query");
    expect(await screen.findByText("这次想解决什么")).toBeTruthy();
    expect(screen.getAllByText("查课表").length).toBeGreaterThan(0);
  });

  it("keeps internal ADP addresses out of the judge-facing page", async () => {
    window.location.hash = "#/experience";
    const { container } = render(<App />);
    expect(await screen.findByText("真实智能体对话")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quick Start · 学生" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quick Start · 教师" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quick Start · 教学管理" })).toBeTruthy();
    for (const anchor of container.querySelectorAll("a")) {
      expect(anchor.getAttribute("href") || "").not.toMatch(/^http:\/\//i);
    }
  });

  it("opens the all-capabilities library and sends a selected question to the composer", async () => {
    window.location.hash = "#/experience";
    render(<App />);

    expect(await screen.findByText("从常用查询到跨域决策")).toBeTruthy();
    expect(screen.getAllByText("全部能力").length).toBeGreaterThan(0);
    expect(screen.getByText(/教师 \/ 班级 \/ 课程 \/ 教室课表/)).toBeTruthy();
    expect(screen.getByText("4 个智能体")).toBeTruthy();
    expect(screen.getByText("13 项 CampusTools")).toBeTruthy();

    const roomQuestion = screen.getByRole("button", { name: "A1-201第1周什么时候有课？" });
    fireEvent.click(roomQuestion);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("A1-201第1周什么时候有课？");

    fireEvent.click(screen.getByRole("button", { name: "查课表" }));
    await waitFor(() => {
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("查看2025级计算机类01班第1周课表。");
    });
  });

  it("does not overwrite a manually edited composer when the scenario changes", async () => {
    window.location.hash = "#/experience";
    render(<App />);
    const composer = await screen.findByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "我正在编辑的追问" } });

    goTo("#/experience/query");
    await screen.findByText("这次想解决什么");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("我正在编辑的追问");
  });

  it("keeps an in-flight SSE request alive across experience scenario changes", async () => {
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let requestSignal: AbortSignal | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.location.hash = "#/experience";
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "发送" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const question = screen.getByText("未来四周谁的教学负载最高？");

    goTo("#/experience/query");
    await screen.findByText("这次想解决什么");
    expect(requestSignal?.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(question.isConnected).toBe(true);

    await act(async () => {
      const events = [
        { Type: "message.done", Message: { Name: "reply", ExtraInfo: { AgentName: "小序-校园洞察" }, Contents: [{ Type: "text", Text: "切换能力入口后任务仍已完成。" }] } },
        { Type: "response.completed" },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
      streamController?.enqueue(encoder.encode(events));
      streamController?.close();
    });
    expect(await screen.findByText("切换能力入口后任务仍已完成。")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit Stop as the only navigation-independent abort control", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal as AbortSignal;
      requestSignal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    window.location.hash = "#/experience";
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "发送" }));
    fireEvent.click(await screen.findByRole("button", { name: "停止生成" }));
    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
  });

  it("keeps completed chat state when leaving and returning to Experience", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completedSse("跨页面返回后仍然可见。")));
    window.location.hash = "#/experience";
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "发送" }));
    expect(await screen.findByText("跨页面返回后仍然可见。")).toBeTruthy();

    goTo("#/capability");
    await screen.findByText("小序的每一步");
    goTo("#/experience/insight");
    expect(await screen.findByText("跨页面返回后仍然可见。")).toBeTruthy();
  });

  it("keeps an in-flight SSE request alive while visiting another top-level page", async () => {
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let requestSignal: AbortSignal | undefined;
    const stream = new ReadableStream<Uint8Array>({ start: (controller) => { streamController = controller; } });
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }));
    window.location.hash = "#/experience";
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "发送" }));
    await screen.findByRole("button", { name: "停止生成" });

    goTo("#/capability");
    await screen.findByText("小序的每一步");
    expect(requestSignal?.aborted).toBe(false);
    await act(async () => {
      const events = [
        { Type: "message.done", Message: { Name: "reply", Contents: [{ Type: "text", Text: "离开工作区期间仍然完成。" }] } },
        { Type: "response.completed" },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
      streamController?.enqueue(encoder.encode(events));
      streamController?.close();
    });

    goTo("#/experience");
    expect(await screen.findByText("离开工作区期间仍然完成。")).toBeTruthy();
  });

  it("keeps one conversationId across scenario and top-level page navigation", async () => {
    const requestBodies: Array<{ conversationId: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as { conversationId: string });
      return completedSse();
    }));
    window.location.hash = "#/experience";
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "发送" }));
    await waitFor(() => expect(requestBodies).toHaveLength(1));
    await screen.findByText("Top1 为教师025。");

    goTo("#/experience/query");
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("2025级计算机类01班"));
    goTo("#/capability");
    await screen.findByText("小序的每一步");
    goTo("#/experience/query");
    fireEvent.click(await screen.findByRole("button", { name: "发送" }));
    await waitFor(() => expect(requestBodies).toHaveLength(2));
    expect(requestBodies[1].conversationId).toBe(requestBodies[0].conversationId);
  });

  it("restores a completed chat snapshot after the Experience UI is rebuilt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completedSse("刷新后恢复的已完成回答。")));
    window.location.hash = "#/experience";
    const first = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "发送" }));
    expect(await screen.findByText("刷新后恢复的已完成回答。")).toBeTruthy();
    first.unmount();

    render(<App />);
    expect(await screen.findByText("刷新后恢复的已完成回答。")).toBeTruthy();
  });

  it("restores an interrupted refresh as retryable instead of pretending it is streaming", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({ start: (controller) => { streamController = controller; } });
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      signal.addEventListener("abort", () => streamController?.error(new DOMException("Reloaded", "AbortError")), { once: true });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }));
    window.location.hash = "#/experience";
    const first = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "发送" }));
    await waitFor(() => {
      const snapshot = JSON.parse(window.sessionStorage.getItem("campusflow.adp.experience.v1") || "{}") as { execution?: { status?: string } };
      expect(["connecting", "streaming"]).toContain(snapshot.execution?.status);
    });
    first.unmount();

    render(<App />);
    expect(await screen.findByText(/页面刷新中断了上一项实时任务/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "停止生成" })).toBeNull();
    expect(screen.getByRole("button", { name: "发送" })).toBeTruthy();
  });

  it("fails open when the session snapshot contains damaged JSON", async () => {
    window.sessionStorage.setItem("campusflow.adp.experience.v1", "{damaged");
    window.location.hash = "#/experience";
    render(<App />);
    expect(await screen.findByText("真实智能体对话")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("opens the guided competition demo without replacing the current route", async () => {
    window.location.hash = "#/cases";
    render(<App />);
    const routeBefore = window.location.hash;

    fireEvent.click(await screen.findByRole("button", { name: "比赛演示模式" }));
    expect(await screen.findByRole("dialog", { name: "比赛演示模式" })).toBeTruthy();
    expect(screen.getByText("从真实课表里快速找到教师025的未来四周安排")).toBeTruthy();
    expect(window.location.hash).toBe(routeBefore);
  });

  it("record mode keeps only the clean live experience", async () => {
    window.location.hash = "#/experience/query";
    render(<App search="?mode=record" />);
    expect(await screen.findByText("真实智能体运行")).toBeTruthy();
    expect(screen.getAllByText("用户问题").length).toBeGreaterThan(0);
    expect(screen.getByText("主协调")).toBeTruthy();
    expect(screen.getByText("专业智能体")).toBeTruthy();
    expect(screen.getByText("CampusTools")).toBeTruthy();
    expect(screen.getByText("结果卡")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("已核验回放")).toBeNull();
    expect(screen.queryByText("诊断")).toBeNull();
    expect(screen.queryByText(/Native ADP API/)).toBeNull();
  });
});
