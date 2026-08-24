import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AdpExperience } from "./AdpExperience";

afterEach(() => cleanup());

describe("AdpExperience", () => {
  it("shows loading and then degrades to blocked when the frame never loads", async () => {
    render(<AdpExperience timeoutMs={60} />);
    expect(screen.getByText("正在连接小序真机…")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("内嵌被浏览器策略阻止")).toBeTruthy());
  });

  it("renders the external fallback when forced", () => {
    render(<AdpExperience forceExternal />);
    expect(screen.getAllByText("外部窗口模式").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /打开小序完整体验/ })).toBeTruthy();
  });

  it("switches to embedded once the iframe reports a load", async () => {
    const { container } = render(<AdpExperience timeoutMs={5000} />);
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    fireEvent.load(iframe!);
    await waitFor(() => expect(screen.getByText("实时运行 · 可交互")).toBeTruthy());
  });
});
