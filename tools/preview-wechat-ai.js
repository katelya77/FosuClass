#!/usr/bin/env node
/** Build, verify and create a WeChat AI development preview QR. Never submit review. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { build } = require('./build-wechat-ai-preview');
const { resolveWechatDevtoolsCli, assertSafeCmdValue } = require('./upload-wechat-trial');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

function quote(value, label) {
  return `"${assertSafeCmdValue(value, label)}"`;
}

function main() {
  const test = spawnSync(process.execPath, [path.join(__dirname, 'test-wechat-ai-preview.js')], {
    cwd: root, stdio: 'inherit', timeout: 120000,
  });
  if (test.error || test.status !== 0) throw test.error || new Error('微信 AI 预览测试失败');

  const project = build({ output: path.join(dist, `wechat-ai-preview-run-${Date.now()}`) });
  const cli = resolveWechatDevtoolsCli();
  if (!cli) throw new Error(`已生成预览工程 ${project}；未找到微信开发者工具 CLI，请设置 WECHAT_DEVTOOLS_CLI 后重试`);

  // DevTools currently writes JPEG bytes even when the output name says .png.
  const qr = path.join(dist, 'wechat-ai-preview-qr.jpg');
  const info = path.join(dist, 'wechat-ai-preview-info.json');
  for (const file of [qr, info]) if (fs.existsSync(file)) fs.unlinkSync(file);
  const command = [
    'call', quote(cli, 'DevTools CLI'), 'preview',
    '--project', quote(project, 'preview project'),
    '--qr-format', 'image', '--qr-output', quote(qr, 'QR output'),
    '--info-output', quote(info, 'info output'),
  ].join(' ');
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
    cwd: root, encoding: 'utf8', shell: false, windowsVerbatimArguments: true,
    timeout: 180000, maxBuffer: 5 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const hasJpeg = fs.existsSync(qr) && fs.readFileSync(qr).subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  if (result.error || result.status !== 0 || !hasJpeg || !fs.existsSync(info)) {
    throw result.error || new Error('微信开发者工具未生成预览二维码；请检查上面的编译或上传错误');
  }
  console.log(`预览工程：${project}\n真机二维码：${qr}\n包体信息：${info}\n未上传体验版，未提交正式审核。`);
}

try { main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
