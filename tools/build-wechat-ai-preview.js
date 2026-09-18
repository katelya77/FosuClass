/**
 * Build an isolated WeChat AI development-mode project. The production app.json
 * stays free of beta agent configuration until WeChat opens formal review.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const defaultOutput = path.resolve(root, 'dist/wechat-ai-preview');
const miniSource = path.join(root, 'miniprogram');
const skillSource = path.join(root, 'experiments/wechat-ai');
function assertSafeOutput(output) {
  const dist = path.resolve(root, 'dist');
  const name = path.basename(output);
  if (path.dirname(output) !== dist || !/^wechat-ai-preview(?:-(?:test|run)-[a-zA-Z0-9-]+)?$/.test(name)) {
    throw new Error('Unsafe preview output path');
  }
  if (fs.existsSync(dist) && fs.realpathSync(dist) !== path.resolve(root, 'dist')) {
    throw new Error('Preview output parent is not the workspace dist directory');
  }
  if (fs.existsSync(output) && !fs.existsSync(path.join(output, '.generated-wechat-ai-preview'))) {
    throw new Error('Preview output exists without generator marker; refusing to overwrite it');
  }
}

function build(options = {}) {
  const output = options.output ? path.resolve(options.output) : defaultOutput;
  assertSafeOutput(output);
  const appPath = path.join(miniSource, 'app.json');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  if (app.agent || app.subPackages.some((item) => item.root === 'skills')) {
    throw new Error('Source app.json already contains WeChat AI configuration');
  }
  if (app.lazyCodeLoading !== 'requiredComponents') {
    throw new Error('WeChat AI requires lazyCodeLoading=requiredComponents');
  }
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  const { API_BASE_URL } = require('../miniprogram/config/api');
  const { STORAGE_KEY: SESSION_STORAGE_KEY } = require('../miniprogram/services/securitySessionService');
  if (!/^https:\/\/[^/?#]+$/.test(API_BASE_URL)) throw new Error('Public API origin must be HTTPS');
  if (fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });

  const miniOutput = path.join(output, 'miniprogram');
  fs.mkdirSync(miniOutput, { recursive: true });
  fs.cpSync(miniSource, miniOutput, {
    recursive: true,
    filter(source) {
      return !source.split(path.sep).some((part) => part === 'node_modules' || part === 'miniprogram_npm');
    },
  });
  fs.cpSync(path.join(skillSource, 'skills'), path.join(miniOutput, 'skills'), { recursive: true });
  fs.copyFileSync(path.join(skillSource, 'AI-INSTRUCTION.md'), path.join(miniOutput, 'AI-INSTRUCTION.md'));
  fs.copyFileSync(path.join(skillSource, 'page-meta.json'), path.join(miniOutput, 'page-meta.json'));
  fs.writeFileSync(path.join(miniOutput, 'skills/fosu-campus/runtime-config.js'),
    `module.exports = { API_BASE_URL: ${JSON.stringify(API_BASE_URL)}, SESSION_STORAGE_KEY: ${JSON.stringify(SESSION_STORAGE_KEY)} };\n`);

  app.subPackages.push({ root: 'skills', pages: [], independent: true });
  app.agent = {
    skills: [{
      name: 'fosuCampus',
      description: '查询佛山大学已发布的课表索引、空教室、校历、数据版本、校区天气和校园地点；个人课表、提醒、记忆及写操作转到佛课小表内的小序处理。',
      path: 'skills/fosu-campus',
    }],
    instruction: 'AI-INSTRUCTION.md',
    pageMetadata: 'page-meta.json',
  };
  fs.writeFileSync(path.join(miniOutput, 'app.json'), `${JSON.stringify(app, null, 2)}\n`);
  config.projectname = 'FosuClass-WeChat-AI-Preview';
  // Page handoff support in the beta guide starts at base library 3.16.2.
  config.libVersion = '3.16.2';
  // The production project excludes Markdown. WeChat AI reads its instruction
  // and Skill documents from the uploaded package, so only this generated
  // project's upload rules may include them.
  config.packOptions.ignore = config.packOptions.ignore.filter((item) =>
    !(item.type === 'suffix' && item.value === '.md')
  );
  fs.writeFileSync(path.join(output, 'project.config.json'), `${JSON.stringify(config, null, 2)}\n`);
  fs.writeFileSync(path.join(output, '.generated-wechat-ai-preview'), 'Generated preview. Do not upload as a formal version.\n');
  return output;
}

if (require.main === module) {
  try { console.log(build()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { build };
