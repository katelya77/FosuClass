import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "experience"; caseKey?: string }
  | { name: "adp-diagnostics" }
  | { name: "capability" }
  | { name: "cases" };

export function routeToHash(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "experience":
      return route.caseKey ? `#/experience/${route.caseKey}` : "#/experience";
    case "adp-diagnostics":
      return "#/adp-diagnostics";
    case "capability":
      return "#/capability";
    case "cases":
      return "#/cases";
  }
}

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#/, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts[0] === "experience") {
    return { name: "experience", caseKey: parts[1] };
  }
  if (parts[0] === "adp-diagnostics") return { name: "adp-diagnostics" };
  if (parts[0] === "capability") return { name: "capability" };
  if (parts[0] === "cases") return { name: "cases" };
  if (parts[0] === "about") return { name: "home" };
  return { name: "home" };
}

export function navigate(route: Route): void {
  window.location.hash = routeToHash(route);
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}

export function useNavigate(): (route: Route) => void {
  return useCallback((route: Route) => navigate(route), []);
}

/**
 * Top-level hash routes are page boundaries, while an Experience caseKey is
 * only a workspace tab. Reset before paint so route transitions never reveal
 * the previous page's scroll position, including browser Back/Forward changes.
 */
export function useRouteScrollReset(route: Route): void {
  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const rootBehavior = root.style.scrollBehavior;
    const bodyBehavior = body.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    body.style.scrollBehavior = "auto";
    try {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    } finally {
      root.style.scrollBehavior = rootBehavior;
      body.style.scrollBehavior = bodyBehavior;
    }
  }, [route.name]);
}
