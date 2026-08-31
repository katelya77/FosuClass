import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { App } from "./App";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

function goTo(hash: string): void {
  window.location.hash = hash;
  window.dispatchEvent(new Event("hashchange"));
}

describe("App routing", () => {
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
    expect((await screen.findAllByText("能力与角色")).length).toBeGreaterThan(0);
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
