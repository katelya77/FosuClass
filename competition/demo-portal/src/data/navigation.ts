import {
  Home,
  Sparkles,
  Map,
  BookOpen,
  Info,
  type LucideIcon,
} from "lucide-react";

import { type Route } from "../lib/router";

export interface NavItem {
  label: string;
  route: Route;
  icon: LucideIcon;
  activeRoutes: Route["name"][];
}

export const NAV_ITEMS: NavItem[] = [
  { label: "首页", route: { name: "home" }, icon: Home, activeRoutes: ["home"] },
  { label: "开始体验", route: { name: "experience" }, icon: Sparkles, activeRoutes: ["experience"] },
  { label: "能力地图", route: { name: "capability" }, icon: Map, activeRoutes: ["capability"] },
  { label: "演示案例", route: { name: "cases" }, icon: BookOpen, activeRoutes: ["cases"] },
  { label: "关于作品", route: { name: "about" }, icon: Info, activeRoutes: ["about"] },
];

export const VERIFIED_COPY = {
  package: "competition-demo-v3",
  mark: "已核验 CampusTools",
  badge: "Verified",
};
