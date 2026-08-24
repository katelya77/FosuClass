import { useCallback, useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "experience"; caseKey?: string }
  | { name: "capability" }
  | { name: "cases" }
  | { name: "about" };

export function routeToHash(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "experience":
      return route.caseKey ? `#/experience/${route.caseKey}` : "#/experience";
    case "capability":
      return "#/capability";
    case "cases":
      return "#/cases";
    case "about":
      return "#/about";
  }
}

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#/, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts[0] === "experience") {
    return { name: "experience", caseKey: parts[1] };
  }
  if (parts[0] === "capability") return { name: "capability" };
  if (parts[0] === "cases") return { name: "cases" };
  if (parts[0] === "about") return { name: "about" };
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
