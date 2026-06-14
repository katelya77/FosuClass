# CloudBase Release Pack 发布手册

## 一次性准备

1. 安装 CloudBase CLI：

   ```bash
   npm install -g @cloudbase/cli
   ```

2. 登录：

   ```bash
   tcb login
   ```

3. 在 CloudBase 控制台为环境 `cloud1-d3g17rpe7566d3d5c` 启用静态网站托管。

4. 查询真实 Hosting 域名：

   ```bash
   npm run cloudbase:hosting:detail
   ```

5. 将查询到的 HTTPS 域名填入 `miniprogram/config/cloudbase.js` 的 `CLOUDBASE_HOSTING_BASE_URL`。不要猜测域名。本次已查询到：

   ```text
   https://cloud1-d3g17rpe7566d3d5c-1442900641.tcloudbaseapp.com
   ```

## 发布原则

CloudBase 只发布公开 Release Pack：

- 发布 `releases/{releaseVersion}/...`。
- 最后发布 `runtime/active.json`。
- 不发布 staging、原始大 JSON、上传分片、管理员文件或原始 XLS。
- 不覆盖其他 releaseVersion。
- 默认 dry-run；实际上传必须显式执行。

发布前会执行：

1. 本地 Release Pack 结构验证。
2. quick/deep health 兼容验证。
3. 隐私扫描。
4. 抽样远端校验。
5. 只有全部成功才更新 active pointer。

隐私扫描发现以下内容会阻止发布：

- 学号、手机号、身份证号。
- Cookie、JSESSIONID、Authorization。
- API Key、密码、Token。
- 原始 XLS。
- 学生个人姓名列表。
- 管理员信息。

## Dry-run

```bash
npm run cloudbase:release:dry-run -- --release-version <releaseVersion>
```

不传 `--release-version` 时，工具会读取当前 active release。

## 正式上传

确认 Hosting 域名、合法域名、隐私扫描和 Oracle 回退都通过后，再执行：

```bash
npm run cloudbase:release:deploy -- --release-version <releaseVersion> --execute --hosting-base-url https://your-cloudbase-hosting-domain
```

工具内部使用低并发弱网参数：

```bash
tcb hosting deploy <localPath> <cloudPath> -e cloud1-d3g17rpe7566d3d5c --concurrency 5 --retry-count 3
```

第一阶段上传版本目录：

```text
releases/{releaseVersion}/...
```

第二阶段最后上传：

```text
runtime/active.json
```

如果第一阶段失败，旧 active pointer 不会被覆盖。

## 远端验证

```bash
npm run cloudbase:release:verify -- --release-version <releaseVersion> --hosting-base-url https://your-cloudbase-hosting-domain
```

验证内容包括：

- `manifest.json`
- class / teacher / classroom / course index
- `empty-room/index.json`
- 每类至少一个 detail
- JSON 格式、hash、size、releaseVersion

## 清理旧版本

默认 dry-run：

```bash
npm run cloudbase:release:prune -- --keep 3 --hosting-base-url https://your-cloudbase-hosting-domain
```

实际删除必须加 `--execute`。清理工具不会删除当前 active 和 last-good。

## 回滚 active pointer

回滚只改 `runtime/active.json`，不要覆盖版本目录。

1. 找到要回滚的稳定 releaseVersion。
2. 先验证该版本：

   ```bash
   npm run cloudbase:release:verify -- --release-version <oldReleaseVersion> --hosting-base-url https://your-cloudbase-hosting-domain
   ```

3. 生成并上传指向旧版本的 `runtime/active.json`。建议先在本地临时目录准备 active 文件，再执行：

   ```bash
   tcb hosting deploy ./tmp/active.json runtime/active.json -e cloud1-d3g17rpe7566d3d5c --concurrency 1 --retry-count 3
   ```

4. 小程序端 runtime pointer 有 60 秒 bucket，通常 1 分钟内切回。

## 关闭 CloudBase 主源

将 `miniprogram/config/cloudbase.js` 中：

```js
CLOUDBASE_HOSTING_ENABLED: false
```

或清空 `CLOUDBASE_HOSTING_BASE_URL`。小程序会回到 Oracle 静态源。

## 小程序合法域名

正式版发布前，需在微信公众平台配置：

- request 合法域名：Oracle API 域名 `https://class.katelya.eu.org`。
- request 合法域名：CloudBase Hosting 域名。
- downloadFile 合法域名：如果后续直接用 downloadFile 拉取静态 JSON，也添加 CloudBase Hosting 域名和 Oracle 静态域名。

## 需要人工完成

- 登录 CloudBase CLI。
- 启用静态托管。
- 查询并填写真实 Hosting 域名。
- 在微信公众平台添加合法域名。
- 确认隐私扫描和远端验证通过后，人工批准生产 active pointer 切换。
