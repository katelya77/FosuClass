const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = __dirname;
const distDir = path.join(root, "dist");

// 确保 dist 目录存在且清理旧文件
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

console.log("📦 步骤 1：正在使用 esbuild 打包接力端脚本及所有本地依赖...");
const externalArgs = "--external:playwright --external:cheerio --external:axios --external:dotenv --external:readline/promises";

try {
  // 打包主程序
  execSync(`npx -y esbuild "${path.join(root, "relay-agent.js")}" --bundle --platform=node ${externalArgs} --outfile="${path.join(distDir, "relay-agent.js")}"`, { stdio: "inherit" });
  // 打包抓取和登录逻辑
  execSync(`npx -y esbuild "${path.join(root, "../fosu-sync-client/sync.js")}" --bundle --platform=node ${externalArgs} --outfile="${path.join(distDir, "sync.js")}"`, { stdio: "inherit" });
  execSync(`npx -y esbuild "${path.join(root, "../fosu-sync-client/login.js")}" --bundle --platform=node ${externalArgs} --outfile="${path.join(distDir, "login.js")}"`, { stdio: "inherit" });
} catch (e) {
  console.error("❌ esbuild 打包失败：", e.message);
  process.exit(1);
}

console.log("\n📦 步骤 2：生成分发包描述及脚本组件...");

// 1. 生成 package.json
const pkgJson = {
  "name": "fosu-relay-agent",
  "version": "1.0.0",
  "description": "FosuClass Distributable Relay Agent",
  "main": "relay-agent.js",
  "private": true,
  "dependencies": {
    "playwright": "^1.43.0",
    "cheerio": "^1.0.0-rc.12",
    "axios": "^1.6.8",
    "dotenv": "^16.4.5"
  }
};
fs.writeFileSync(path.join(distDir, "package.json"), JSON.stringify(pkgJson, null, 2), "utf-8");

// 2. 生成 start.bat
const batContent = `@echo off
chcp 65001 > nul
title 佛课小表接力采集代理端

echo 检测本地 Node.js 运行环境...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误：未检测到本地 Node.js 环境！
    echo ------------------------------------------------------------------
    echo 接力采集工具需要 Node.js 运行环境才可启动。
    echo 请前往官网下载并安装 Node.js (推荐 LTSC 长期支持版)：
    echo 🔗 https://nodejs.org/zh-cn/download/
    echo ------------------------------------------------------------------
    pause
    exit /b 1
)

if not exist node_modules (
    echo ℹ️ 首次运行，正在为您初始化依赖组件（约需 30 秒，请保持网络畅通）...
    call npm install --no-audit --no-fund --quiet
    if %errorlevel% neq 0 (
        echo ❌ 初始化失败，请检查网络连接并重试。
        pause
        exit /b 1
    )
    echo ✓ 初始化依赖组件完成。
)

echo ⚙️ 正在启动接力采集器...
node relay-agent.js %*
pause
`;
fs.writeFileSync(path.join(distDir, "start.bat"), batContent, "utf-8");

// 3. 生成 README.txt
const readmeContent = `佛课小表（FosuClass）接力采集代理工具包
========================================

【关于本工具】
本工具为佛课小表（FosuClass）的教务课表接力采集代理端，专供持有接力 Token 的在校同学执行课表抓取。

【安全防护说明】
1. 本工具不要求您提供任何 GitHub 账号、SSH 密钥或管理后台密码。
2. 您的教务网登录过程完全在您本地的系统浏览器（Edge / Chrome）中由您手动完成，教务密码绝不会发送到任何服务器，也不会被本工具保存。
3. 抓取到的课程表公开数据会生成在本地 staging 文件夹中（均经过防敏感信息脱敏校验），经您确认无误后，才会上传至管理平台供管理员进行二次审核发布。
4. 本次采集结束后，本地的临时教务登录会话 (session.json) 会自动被本工具安全清理。

【使用步骤】
1. 解压本 zip 压缩包至您的 Windows 电脑任意目录。
2. 双击运行 "start.bat" 脚本（如果提示未安装 Node.js，请先前往 https://nodejs.org/ 下载并安装）。
3. 首次运行会自动从 npm 初始化采集所需的轻量浏览器控制组件。
4. 根据命令窗口中的中文提示，粘贴管理员提供给您的接力 Token。
5. 系统会自动拉取接力任务配置，并自动打开 Edge 或 Chrome 浏览器。
6. 请在弹出的浏览器中手动登录佛山大学教务网。
7. 登录成功后，工具将在后台自动完成全校行政班级、教师、课室维度课表数据的采集（大约需要 8-15 分钟，请勿关闭弹出的浏览器窗口与黑色的脚本命令窗口）。
8. 抓取完毕后，按提示输入 yes 确认即可将脱敏后的课表数据包上传到后台。
9. 提示上传成功后，即可直接关闭窗口，接力任务完成。
`;
fs.writeFileSync(path.join(distDir, "README.txt"), readmeContent, "utf-8");

// 4. 生成 config.example.json
const configExample = {
  "server": "https://class.katelya.eu.org",
  "token": "YOUR_RELAY_TOKEN_HERE"
};
fs.writeFileSync(path.join(distDir, "config.example.json"), JSON.stringify(configExample, null, 2), "utf-8");

console.log("\n📦 步骤 3：正在压缩生成独立的 dist/fosu-relay-agent-win-x64.zip 工具包...");
const zipPath = path.join(distDir, "fosu-relay-agent-win-x64.zip");
const zipTempDir = path.join(distDir, "zip-temp");
fs.mkdirSync(zipTempDir, { recursive: true });

const filesToZip = ["package.json", "relay-agent.js", "sync.js", "login.js", "start.bat", "README.txt", "config.example.json"];
filesToZip.forEach(f => {
  fs.copyFileSync(path.join(distDir, f), path.join(zipTempDir, f));
});

try {
  if (process.platform === "win32") {
    // 强制转为绝对路径且使用反斜杠以符合 PowerShell Command 规范
    const zipTempEscaped = zipTempDir.replace(/\//g, "\\");
    const zipPathEscaped = zipPath.replace(/\//g, "\\");
    execSync(`powershell -Command "Compress-Archive -Path '${zipTempEscaped}\\*' -DestinationPath '${zipPathEscaped}' -Force"`, { stdio: "inherit" });
  } else {
    execSync(`cd "${zipTempDir}" && zip -r "../fosu-relay-agent-win-x64.zip" ./*`, { stdio: "inherit" });
  }
  console.log(`\n🎉 【打包大成功】独立的接力分发包已输出至：\n📂 ${zipPath}`);
} catch (err) {
  console.error("❌ 压缩打包失败：", err.message);
} finally {
  // 清理临时文件目录
  fs.rmSync(zipTempDir, { recursive: true, force: true });
}
