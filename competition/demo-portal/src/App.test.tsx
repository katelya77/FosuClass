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

  it("opens the story cases page", async () => {
    window.location.hash = "#/";
    render(<App />);
    goTo("#/cases");
    expect(await screen.findByText("四个问题，四次完整决策")).toBeTruthy();
    expect(screen.getByText("多人协同")).toBeTruthy();
  });

  it("opens the capability map page", async () => {
    window.location.hash = "#/";
    render(<App />);
    goTo("#/capability");
    expect((await screen.findAllByText("能力地图")).length).toBeGreaterThan(0);
  });

  it("opens the about page", async () => {
    window.location.hash = "#/";
    render(<App />);
    goTo("#/about");
    expect((await screen.findAllByText("关于作品")).length).toBeGreaterThan(0);
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
    expect(screen.getByText("4 Agent")).toBeTruthy();
    expect(screen.getByText("13 CampusTools")).toBeTruthy();

    const roomQuestion = screen.getByRole("button", { name: "A1-201第1周什么时候有课？" });
    fireEvent.click(roomQuestion);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("A1-201第1周什么时候有课？");

    fireEvent.click(screen.getByRole("button", { name: "查课表" }));
    await waitFor(() => {
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("查看教师025第1周课表，并检查他的跨校区赶场风险。");
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
    expect(await screen.findByText("真实 ADP 运行")).toBeTruthy();
    expect(screen.getAllByText("用户问题").length).toBeGreaterThan(0);
    expect(screen.getByText("主协调")).toBeTruthy();
    expect(screen.getByText("专业 Agent")).toBeTruthy();
    expect(screen.getByText("CampusTools")).toBeTruthy();
    expect(screen.getByText("Widget")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("Verified Replay")).toBeNull();
    expect(screen.queryByText("诊断")).toBeNull();
    expect(screen.queryByText(/Native ADP API/)).toBeNull();
  });
});
