/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 本地优先的录屏展示系统：无 SSR / 无 SEO / 无后端路由需求
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, host: "127.0.0.1" },
  preview: { port: 4173, strictPort: true, host: "127.0.0.1" },
  test: {
    environment: "jsdom",
    globals: false,
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
