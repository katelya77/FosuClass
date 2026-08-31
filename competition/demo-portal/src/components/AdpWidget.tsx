import { createElement, useEffect, useMemo, useRef } from "react";

import type { AdpWidgetPayload } from "../lib/adp-stream";

export interface AdpWidgetAction {
  widgetId: string;
  widgetRunId: string;
  actionType: string;
  payload?: unknown;
}

interface AdpWidgetProps {
  widget: AdpWidgetPayload;
  disabled?: boolean;
  onAction: (action: AdpWidgetAction) => void;
  onRendered?: () => void;
}

interface WidgetActionDetail {
  action?: {
    type?: string;
    payload?: unknown;
  };
}

/**
 * The bundled ADP renderer predates the current console typography behavior and
 * still gives Title an unconditional `white-space: nowrap`. The live ADP View is
 * authoritative; this host-only compatibility pass restores the wrapping that
 * the current console applies without rewriting the View or its data contract.
 */
export function synchronizeAdpWidgetUi(host: HTMLElement): number {
  const root = host.shadowRoot;
  if (!root) return 0;

  let synchronized = 0;
  const visited = new Set<ShadowRoot>();
  const visit = (scope: ShadowRoot) => {
    if (visited.has(scope)) return;
    visited.add(scope);

    for (const titleHost of scope.querySelectorAll<HTMLElement>("title-widget")) {
      titleHost.style.setProperty("display", "block", "important");
      titleHost.style.setProperty("width", "100%", "important");
      titleHost.style.setProperty("min-width", "0", "important");
      titleHost.style.setProperty("max-width", "100%", "important");
      titleHost.dataset.portalWrap = "true";

      const title = titleHost.shadowRoot?.querySelector<HTMLElement>(".title-widget");
      if (title) {
        title.style.setProperty("white-space", "normal", "important");
        title.style.setProperty("overflow-wrap", "anywhere", "important");
        title.style.setProperty("word-break", "break-word", "important");
        title.style.setProperty("max-width", "100%", "important");
        synchronized += 1;
      }
    }

    for (const element of scope.querySelectorAll<HTMLElement>("*")) {
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };

  visit(root);
  return synchronized;
}

export function AdpWidget({
  widget,
  disabled = false,
  onAction,
  onRendered,
}: AdpWidgetProps): React.ReactElement {
  const ref = useRef<HTMLElement | null>(null);
  const widgetJson = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(widget.view));
    } catch {
      return "";
    }
  }, [widget.view]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const synchronizeUi = () => synchronizeAdpWidgetUi(element);
    const handleAction = (event: Event) => {
      const detail = (event as CustomEvent<WidgetActionDetail>).detail;
      const actionType = detail?.action?.type?.trim();
      if (!actionType) return;
      onAction({
        widgetId: widget.widgetId,
        widgetRunId: widget.widgetRunId,
        actionType,
        payload: detail.action?.payload,
      });
    };
    const handleRendered = () => {
      synchronizeUi();
      onRendered?.();
    };
    element.addEventListener("widget-action", handleAction);
    element.addEventListener("widget-rendered", handleRendered);
    const frame = window.requestAnimationFrame(synchronizeUi);
    return () => {
      window.cancelAnimationFrame(frame);
      element.removeEventListener("widget-action", handleAction);
      element.removeEventListener("widget-rendered", handleRendered);
    };
  }, [onAction, onRendered, widget.widgetId, widget.widgetRunId]);

  if (!widgetJson) {
    return (
      <div className="rounded-2xl border border-brand/15 bg-white/48 p-4 text-sm text-body">
        结果卡数据无法安全渲染；已停止展示，请稍后重试。
      </div>
    );
  }

  return createElement("adp-widget", {
    ref: (node: HTMLElement | null) => {
      ref.current = node;
    },
    "widget-json": widgetJson,
    "data-widget-id": widget.widgetId,
    "data-widget-ui-source": "live-adp-view",
    locale: "zh-CN",
    ...(disabled ? { disable: "" } : {}),
  });
}
