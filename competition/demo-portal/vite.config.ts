/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 公网静态体验站：hash 路由，无需服务端 rewrite；构建产物直接可静态部署。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174, strictPort: true, host: "127.0.0.1" },
  preview: { port: 4174, strictPort: true, host: "127.0.0.1" },
  test: {
    environment: "jsdom",
    globals: false,
    css: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
