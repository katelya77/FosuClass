import {
  BookOpenCheck,
  Home,
  Sparkles,
  Users,
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
  { label: "角色与能力", route: { name: "capability" }, icon: Users, activeRoutes: ["capability"] },
  { label: "已核验案例", route: { name: "cases" }, icon: BookOpenCheck, activeRoutes: ["cases"] },
  { label: "真实体验", route: { name: "experience" }, icon: Sparkles, activeRoutes: ["experience"] },
];

export const VERIFIED_COPY = {
  package: "匿名演示数据",
  mark: "结果已核验",
  badge: "已核验",
};
