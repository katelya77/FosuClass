import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GUIDED_DEMO_STEP_DURATION, GuidedDemo } from "./GuidedDemo";

describe("GuidedDemo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.style.overflow = "";
  });

  it("locks background scrolling and advances instead of resetting to step one", () => {
    render(<GuidedDemo open onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByText("从真实课表里快速找到教师025的未来四周安排")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(GUIDED_DEMO_STEP_DURATION);
    });
    expect(screen.getByRole("button", { name: "跳到算" }).getAttribute("aria-current")).toBe("step");

    fireEvent.click(screen.getByRole("button", { name: "跳到验" }));
    expect(screen.getByRole("button", { name: "跳到验" }).getAttribute("aria-current")).toBe("step");
  });

  it("restores the previous background overflow when closed", () => {
    const { rerender } = render(<GuidedDemo open onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<GuidedDemo open={false} onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe("");
  });
});
