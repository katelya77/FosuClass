const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 导入开发环境所需的依赖和 env，以防 require(adminPages) 报错
process.env.NODE_ENV = 'development';
process.env.ADMIN_API_TOKEN = 'test-admin-token';
process.env.ADMIN_PASSWORD = 'test-admin-password';

const adminPagesPath = path.join(__dirname, '../server/src/routes/adminPages.js');
const tmpDir = path.join(__dirname, '../.tmp');
const tmpJsPath = path.join(tmpDir, 'admin-inline.js');

if (!fs.existsSync(adminPagesPath)) {
  console.error(`Error: ${adminPagesPath} not found`);
  process.exit(1);
}

if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

// 通过 Node.js 加载，得到解析转义字符后的真实模板字符串
let router;
try {
  router = require(adminPagesPath);
} catch (e) {
  console.error('❌ Failed to require adminPages.js:', e);
  process.exit(1);
}

const html = router.adminConsoleHtml;
if (!html) {
  console.error('❌ adminConsoleHtml not exported or empty');
  process.exit(1);
}

const htmlLines = html.split(/\r?\n/);
const originalLines = fs.readFileSync(adminPagesPath, 'utf-8').split(/\r?\n/);

// 定位 const adminConsoleHtml = ` 在 adminPages.js 中的第几行
let offset = 0;
for (let i = 0; i < originalLines.length; i++) {
  if (originalLines[i].includes('const adminConsoleHtml = `')) {
    offset = i + 1; // 模板字符串的第一行在 i + 1 处
    break;
  }
}

let inScript = false;
const outputLines = Array(offset).fill(''); // 填充前导空行以对齐 adminPages.js

for (let i = 0; i < htmlLines.length; i++) {
  const line = htmlLines[i];
  if (line.includes('<script>') || line.includes('<script ')) {
    inScript = true;
    outputLines.push('');
    continue;
  }
  if (line.includes('</script>')) {
    inScript = false;
    outputLines.push('');
    continue;
  }
  
  if (inScript) {
    outputLines.push(line);
  } else {
    outputLines.push('');
  }
}

fs.writeFileSync(tmpJsPath, outputLines.join('\n'), 'utf-8');

try {
  execSync(`node --check "${tmpJsPath}"`, { stdio: 'pipe' });
  console.log('✅ Admin Console inline script syntax check passed.');
  try { fs.unlinkSync(tmpJsPath); } catch (e) {}
  process.exit(0);
} catch (error) {
  console.error('❌ Admin Console inline script syntax check failed!\n');
  const stderr = error.stderr ? error.stderr.toString() : error.message;
  console.error(stderr);
  
  const match = stderr.match(/admin-inline\.js:(\d+)/);
  if (match) {
    const errorLineNum = parseInt(match[1], 10);
    console.error(`\nError location in server/src/routes/adminPages.js around line ${errorLineNum}:\n`);
    
    const start = Math.max(1, errorLineNum - 5);
    const end = Math.min(originalLines.length, errorLineNum + 5);
    for (let idx = start; idx <= end; idx++) {
      const marker = idx === errorLineNum ? '>> ' : '   ';
      console.error(`${marker}${String(idx).padStart(4, ' ')}: ${originalLines[idx - 1]}`);
    }
  }
  process.exit(1);
}
