import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";

import { synchronizeAdpWidgetUi } from "./AdpWidget";

afterEach(cleanup);

describe("AdpWidget UI synchronization", () => {
  it("restores multiline wrapping inside the official Title shadow root", () => {
    const widget = document.createElement("div");
    const widgetRoot = widget.attachShadow({ mode: "open" });
    const titleHost = document.createElement("title-widget");
    const titleRoot = titleHost.attachShadow({ mode: "open" });
    const title = document.createElement("h3");
    title.className = "title-widget";
    title.textContent = "教师025（负载Top1）未来四周跨校区赶场风险";
    title.style.whiteSpace = "nowrap";
    titleRoot.append(title);
    widgetRoot.append(titleHost);

    expect(synchronizeAdpWidgetUi(widget)).toBe(1);
    expect(titleHost.dataset.portalWrap).toBe("true");
    expect(titleHost.style.width).toBe("100%");
    expect(title.style.whiteSpace).toBe("normal");
    expect(title.style.overflowWrap).toBe("anywhere");
    expect(title.style.wordBreak).toBe("break-word");
  });

  it("is safe before the SDK creates an open shadow root", () => {
    expect(synchronizeAdpWidgetUi(document.createElement("adp-widget"))).toBe(0);
  });
});
