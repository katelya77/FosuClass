import { describe, expect, it } from "vitest";

import { consumeSseBuffer, INITIAL_ADP_EXECUTION, parseAdpEvent, reduceAdpExecution } from "./adp-stream";

describe("ADP SSE protocol parser", () => {
  it("extracts only supported execution metadata and Widget.View", () => {
    const event = {
      Type: "message.done",
      Message: {
        Name: "reply",
        ExtraInfo: {
          AgentName: "小序-校园洞察",
          IsSubAgent: true,
          ToolName: "校园智序-CampusTools/campus_teacher_load_query",
        },
        Contents: [
          { Type: "text", Text: "教师025 为 Top1。" },
          { Type: "widget", Widget: { WidgetId: "w", WidgetRunId: "r", View: "{\"type\":\"Card\"}" } },
        ],
      },
    };
    const facts = parseAdpEvent(event);
    expect(facts.agentNames).toEqual(["小序-校园洞察"]);
    expect(facts.subAgentFlags).toEqual([true]);
    expect(facts.toolNames).toContain("校园智序-CampusTools/campus_teacher_load_query");
    expect(facts.replyText).toBe("教师025 为 Top1。");
    expect(facts.widget).toMatchObject({ widgetId: "w", widgetRunId: "r" });
  });

  it("handles fragmented SSE frames", () => {
    const events: unknown[] = [];
    let buffer = 'data: {"Type":"response.';
    buffer = consumeSseBuffer(buffer, (event) => events.push(event));
    expect(events).toHaveLength(0);
    buffer += 'completed"}\n\n';
    buffer = consumeSseBuffer(buffer, (event) => events.push(event));
    expect(buffer).toBe("");
    const state = reduceAdpExecution(INITIAL_ADP_EXECUTION, parseAdpEvent(events[0]));
    expect(state.status).toBe("completed");
  });
});
