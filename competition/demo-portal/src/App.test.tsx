import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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
});
