# Oracle Sample 候选与独立回滚

本目录只准备部署；本轮没有部署、学校请求、正式发布、timer 或 active 操作。

候选从已点名的 Oracle 生产祖先 `a3dfd1989705f51c921f13883bcde1cce4502883` 构建。Git 已确认其为 PR #89 `6fe02a552e7511bc27a2f4751db302ebb7a8e001` 的祖先，且包含 PR #79 `ac2d480a`、PR #81 `50f8916b` 功能提交。两 PR 仍 OPEN，本轮不改变它们。当前服务器版本采用用户提供的验收及已有记录；部署前必须重新从受保护本机 API 与容器镜像标签同时核对，不能把 Git 祖先证明当成在线部署证明。

## 构建与门禁

```powershell
python tools/oracle-sample/build_candidate.py --require-commit
node --test tools/test-oracle-sample-backend.js tools/test-oracle-sample-preflight.js tools/test-oracle-sample-queue.js
python tools/oracle-sample/test_build_candidate.py
```

构建器只用 `git archive a3dfd198` 的 Docker build context 加严格名单中的 Sample 补丁。依赖锁、Dockerfile、Compose、公开页面、个人 Agent 路由、Windows 采集及发布入口均取原生产祖先；未知 runtime 改动会阻断。包不含 live `.env`、storage、凭据或 node_modules。旧 `oracle-sample-332b9f0b7546bb73.tar.gz` 仅是未提交源码候选，不可部署。正式构建须使用 `--require-commit`：runtime、预检和任务工具必须来自清洁的已提交源码；manifest `gitCommit`、文件名中的完整提交、CI checkout 与镜像 OCI revision 必须相同。源码包文件名包含完整提交，保留旧候选而不覆盖。CI 的 Linux/原生 ARM 镜像及实际 API/Agent smoke 提供独立构建证据，镜像不推送注册表、不部署。

本机没有运行 Docker daemon，因此尚未完成 Docker/ARM 镜像构建验收。本地通过的是源码与 loopback worker 回归。PR #89 已有 CI 不能替代新候选 CI。

## PAM 部署前只读检查

以下只读命令在批准的 Oracle PAM 会话执行。`APP_DIR`、`RUNTIME_DIR` 使用该主机既有配置，`CANDIDATE_DIR` 是审核后解包的独立候选目录；不输出这些部署路径或 `.env` 内容。`MANIFEST` 指向候选 receipt JSON。

```bash
set -euo pipefail
umask 077
: "${APP_DIR:?使用既有应用目录}"
: "${RUNTIME_DIR:?使用既有外部 runtime 目录}"
: "${CANDIDATE_DIR:?审核后的独立候选目录}"
: "${MANIFEST:?候选 receipt JSON}"
sudo node "$CANDIDATE_DIR/deploy/oracle-sample/preflight.js" \
  --app-dir="$APP_DIR" --runtime-dir="$RUNTIME_DIR" --manifest="$MANIFEST"
```

必须 PASS：在线 SHA 与镜像标签均为 a3dfd198、容器 healthy、原镜像仍在、既有个人 Broker 签名 GET health 成功、没有任何运行/排队作业和 Collector 租约、旧 JSON 可读兼容、备份空间足够、内外 active 一致。检查复用 Oracle 本机现有个人 Agent 凭据，只调用固定 `/api/campus-agent/v1/health`，不领取任务、不发 heartbeat、不改凭据；缺失或与 Collector 凭据混用直接 BLOCKED。输出仅版本、受保护文件 hash、原镜像身份、状态。状态损坏不得清除/重置；有在途任务则等待，不中断个人 Agent。

## 经单独部署批准后的操作顺序

这里是审核清单，当前候选仍 BLOCKED。部署批准须锁定目标 Oracle、候选完整 Git SHA、runtime 内容 hash、镜像 digest 与本次仅 Sample 范围。继续使用仓库现有 Dockerfile/Compose；不要运行 main 的泛化部署去覆盖现网，也不要重新生成 Collector/个人 Agent 凭据。

1. 在正式提交的隔离候选 build context 上构建与验证 ARM 镜像；锁定 OCI revision=候选 SHA、镜像 digest，完成适用 CI/安全/基线业务门禁。构建候选不覆盖当前 checkout。
2. 前述 preflight 再次 PASS；记录只读结果为 root-only `deploy-before.json`。确认从记录到切换没有新作业/租约和其他部署；重新执行检查。
3. 使用现有备份模型，对 `server/storage` 和 `.env` 做一致性备份，记录当前镜像及当前 Compose override。必须 `umask 077`、目录0700、文件0600；短暂 pause API 后 tar，EXIT trap 保证 unpause；`tar -tzf` 验证可读并记录 SHA256。不要调用会轮转删除历史备份的旧 guard retention。学校 Session 不在 Oracle；这里没有密码输入。
4. 使用原 `server/docker-compose.yml` 加仅 image/digest、`pull_policy:never`、`FOSU_DEPLOY_COMMIT_SHA` 的本次 override。保存旧 override；`.env` 不改。通过 `docker compose ... up -d --no-build --pull never --no-deps fosu-api` 切换 API，不执行数据迁移、静态 reconcile、发布、个人 Agent 安装或 WYZ 服务操作。
5. 等待容器 healthy 及 `/api/health`、`/api/health/ready` 终态，执行下面的部署后校验。不能只根据 Compose 返回值判成功。签名 Sample readiness、个人 Broker 既有签名 GET health、课表索引和公告只读探针必须通过；旧状态与权限须保留。任何失败停止写入并执行独立代码回滚。

```bash
: "${CANDIDATE_SHA:?必须是已批准且CI通过的完整Git SHA}"
sudo node "$CANDIDATE_DIR/deploy/oracle-sample/preflight.js" \
  --app-dir="$APP_DIR" --runtime-dir="$RUNTIME_DIR" --manifest="$MANIFEST" \
  --verify-after="$CANDIDATE_SHA" --before=deploy-before.json
```

该检查同时核对 API/镜像 SHA、原 `.env`、正式 Staging、active/manifest/四索引、公告/表情、个人控制面 hash。若真实正常业务在部署窗口改变公告/表情，也应停止验收并先审查差异，不覆盖新数据恢复旧 hash。PASS 后记录部署审计与镜像/备份定位；确认新版本终态后再单独申请 Sample 运行批准。

## Sample PAM 命令

**本次任务尚未执行以下生产操作。** 部署通过与学校范围批准后，只需要选择 class/four 和稳定幂等键。命令读取 Oracle 既有 root-only `.env`，通过后台鉴权/Origin/scope/审计，不把管理员凭据传给 WYZ。

```bash
sudo node "$CANDIDATE_DIR/tools/oracle-sample/queue.js" \
  --app-dir="$APP_DIR" --approve-sample=class \
  --idempotency-key=sample-20261010-class
```

相同键及请求只返回原任务，冲突返回409；过期或失败任务必须单独审阅并新批准，不复用学校采集断点。class 是一个专业/年级请求组，可能包含多个行政班，不能宣称只有一个班。class 审核通过后，four 使用新键，仍每种来源一个目标、网络直采、预算40、并发1、现有学校低频限制。WYZ `manual-sync` 继续复用已有 CLI 和一次交互确认；正式 Staging/Release/active 不变。

Sample 前后分别保存安全快照；此时两次均在部署后同一候选 SHA：

```bash
sudo node "$CANDIDATE_DIR/deploy/oracle-sample/preflight.js" \
  --app-dir="$APP_DIR" --runtime-dir="$RUNTIME_DIR" --manifest="$MANIFEST" \
  --expected-sha="$CANDIDATE_SHA" > sample-before.json
# 执行已单独批准的一个 Sample，等终态、租约释放后再运行同一命令：
sudo node "$CANDIDATE_DIR/deploy/oracle-sample/preflight.js" \
  --app-dir="$APP_DIR" --runtime-dir="$RUNTIME_DIR" --manifest="$MANIFEST" \
  --expected-sha="$CANDIDATE_SHA" > sample-after.json
```

没有真实前后快照、WYZ 结果及 Oracle 签名私有 review 时，验收必须 BLOCKED。样本永远不能证明全校覆盖率。

## Oracle 独立回滚

优先只回滚代码：停止新的 Sample 创建，等待/明确取消本次 Sample 租约，经管理员批准后使用保存的**原 Compose 配置与原镜像 digest**，仅重建 `fosu-api`。保留 `.env`、全部当前 storage 和私有 Sample 历史；新字段是增量字段，无数据库迁移，旧程序不会自动领取 Sample（显式 selector 才能领取）。不能让旧程序继续处理本次 Sample，应确认状态无在途作业/租约再回滚。

随后检查 `/api/health`、受保护 deployment SHA=a3dfd198、OCI image revision=a3dfd198、个人 Broker 与正式 active/四索引、公告/表情、Windows入口。只有确认状态损坏且获得单独恢复批准时，才停 API 并按既有备份恢复机制恢复 storage；不得自动把快照覆盖正常更新。保留失败现场和新 Sample 历史，备份/历史不删除。

CAS 候选的 WYZ 回滚独立：使用既有 `rollback-schedule-collector.sh` 回到安装前的 `6fe02a55`，保留本地 Session 与认证预算，保持 execute=0/timer disabled/个人 Agent active；无需回滚 Oracle Sample 服务。详见另一候选的 CAS 手册。


## 审批后可复制的备份与代码回滚

以下为另行 Oracle 部署批准后的操作，当前不执行。先取得同一 Git 提交的 source receipt、ARM image 及 `SHA256SUMS`，在 PAM 校验两个 archive；使用原 Compose 配置，不能拿旧未提交包或 main 整树代替。`APP_DIR`/`RUNTIME_DIR` 延续上述主机配置。已通过的 preflight 写入 `deploy-before.json`，其中 `rollbackImage` 是原镜像实际 image ID；现在没有生产主机读取，不能预先虚构此值或备份成功。

代码和一致性状态备份（root TTY；输出不含 env 内容）：

```bash
set -Eeuo pipefail
umask 077
BACKUP=/root/fosu-oracle-sample-backup/$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p -m 700 /root/fosu-oracle-sample-backup
mkdir -m 700 "$BACKUP"
OLD_IMAGE=$(docker inspect --format '{{.Image}}' fosuclass-api)
docker image inspect "$OLD_IMAGE" >/dev/null
docker image save "$OLD_IMAGE" | gzip -n > "$BACKUP/previous-image.tar.gz"
printf '%s
' "$OLD_IMAGE" > "$BACKUP/previous-image-id.txt"
docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' fosuclass-api > "$BACKUP/compose-config-files.txt"
IFS=',' read -r -a ORIG_COMPOSE_FILES < "$BACKUP/compose-config-files.txt"
(( ${#ORIG_COMPOSE_FILES[@]} > 0 ))
for i in "${!ORIG_COMPOSE_FILES[@]}"; do
  [[ ${ORIG_COMPOSE_FILES[$i]} == /* && -f ${ORIG_COMPOSE_FILES[$i]} && ! -L ${ORIG_COMPOSE_FILES[$i]} ]] || exit 1
  cp -- "${ORIG_COMPOSE_FILES[$i]}" "$BACKUP/compose-$i.yml"
done
cp -- "$APP_DIR/server/.env" "$BACKUP/previous.env"
cp -- deploy-before.json "$BACKUP/deploy-before.json"
trap 'docker unpause fosuclass-api >/dev/null 2>&1 || true' EXIT
# preflight 已证明无任务/租约；暂停 API 只为获得一致性快照，不停止个人 Agent。
docker pause fosuclass-api >/dev/null
tar -czf "$BACKUP/state.tar.gz" -C "$APP_DIR/server" storage .env
docker unpause fosuclass-api >/dev/null
trap - EXIT
tar -tzf "$BACKUP/state.tar.gz" >/dev/null
sha256sum "$BACKUP/previous-image.tar.gz" "$BACKUP/state.tar.gz" > "$BACKUP/SHA256SUMS"
chmod 600 "$BACKUP"/*
printf 'ORACLE_BACKUP_CREATED_VERIFY_BEFORE_DEPLOY
'
```

这段不删除旧备份、不轮转历史。需要核对现网 Compose override 已保存、镜像与快照校验成功后，才允许实际切换。新镜像先校验 CI archive hash 再 `docker load`；本次 override 只设 `image: fosu-oracle-sample:<候选完整SHA>`、`pull_policy: never`、`environment.FOSU_DEPLOY_COMMIT_SHA: <同一SHA>`。镜像 tag 的 OCI revision 必须匹配，禁止 pull main/latest。继续使用原 Compose 加原现网 override，再加本次受审阅 override，仅重建 `fosu-api`。

独立代码回滚时，先停止新 Sample 创建、确认无在途任务/租约，不自动恢复状态快照：

```bash
set -Eeuo pipefail
: "${BACKUP:?选择本次已校验备份}"
: "${APP_DIR:?原应用目录}"
sha256sum -c "$BACKUP/SHA256SUMS"
OLD_IMAGE=$(cat "$BACKUP/previous-image-id.txt")
docker image inspect "$OLD_IMAGE" >/dev/null || docker load -i "$BACKUP/previous-image.tar.gz"
ROLLBACK_COMPOSE_ARGS=()
IFS=',' read -r -a ORIG_COMPOSE_FILES < "$BACKUP/compose-config-files.txt"
for i in "${!ORIG_COMPOSE_FILES[@]}"; do
  [[ -f $BACKUP/compose-$i.yml ]] || exit 1
  ROLLBACK_COMPOSE_ARGS+=(-f "$BACKUP/compose-$i.yml")
done
printf 'services:\n  fosu-api:\n    image: "%s"\n    pull_policy: never\n    environment:\n      FOSU_DEPLOY_COMMIT_SHA: a3dfd1989705f51c921f13883bcde1cce4502883\n' "$OLD_IMAGE" > "$BACKUP/rollback-image.yml"
# 原配置与额外 override 全部保留；只锁定旧 API image/旧指纹。
# 不复制旧 env 或 state.tar.gz 覆盖当前数据，不删除 Sample/private review。
docker compose --project-directory "$APP_DIR/server" "${ROLLBACK_COMPOSE_ARGS[@]}" -f "$BACKUP/rollback-image.yml" up -d --no-build --pull never --no-deps fosu-api
```

备份从现有容器 Compose label 保存完整原配置文件列表，包括原 override；回滚使用其私有副本及原 project-directory，额外只锁定 `OLD_IMAGE`，不引用本次 Sample override，也不凭 tag 猜测。等待 healthy 后运行本目录 preflight 默认 a3 模式，比较 `deploy-before.json` 受保护文件与 env hash；检查个人 Broker、旧 routine/full 的只读 status/paused/timer 门禁、正式 active/四索引、公告与 Windows入口。无法一致验证则 BLOCKED，保留现场；状态恢复需要单独审批。
