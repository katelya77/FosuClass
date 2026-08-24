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
    const handleRendered = () => onRendered?.();
    element.addEventListener("widget-action", handleAction);
    element.addEventListener("widget-rendered", handleRendered);
    return () => {
      element.removeEventListener("widget-action", handleAction);
      element.removeEventListener("widget-rendered", handleRendered);
    };
  }, [onAction, onRendered, widget.widgetId, widget.widgetRunId]);

  if (!widgetJson) {
    return (
      <div className="rounded-2xl border border-brand/15 bg-white/48 p-4 text-sm text-body">
        Widget.View 不是可渲染的 JSON；已安全停止渲染。
      </div>
    );
  }

  return createElement("adp-widget", {
    ref: (node: HTMLElement | null) => {
      ref.current = node;
    },
    "widget-json": widgetJson,
    locale: "zh-CN",
    ...(disabled ? { disable: "" } : {}),
  });
}
