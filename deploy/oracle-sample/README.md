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

必须 PASS：在线 SHA 与容器及实际镜像标签均为 a3dfd198、容器 healthy、原镜像仍在、既有个人 Broker 签名 GET health 成功、受保护 `/api/admin/campus-sync/snapshot` 的真实 queued/processing/active 均为0、没有 Collector 租约、旧 JSON 可读兼容、备份空间足够、内外 active/四索引一致。签名 health 只证明鉴权可用，不能代替空闲证明。缺失快照字段或任何在途任务直接 BLOCKED；等待终态，不中断 WYZ 个人 Agent。

预检还锁定容器实际 Compose project/working_dir/config_files/env-file、解析后的环境/端口/挂载/网络与运行配置。`APP_DIR/server/storage` 和 `RUNTIME_DIR` 必须对应实际 bind mount；不会因为传入目录可读就猜测它是生产数据。实际 `FOSU_DATA_DIR` 必须落在现有持久 mount 内，且由本次 storage 备份覆盖。原 Dockerfile 默认 `/app/data`、原 Compose 没有该 data mount：若现网没有已有 override 或 env 将其安全持久化，结果为 `RUNTIME_DATA_NOT_PERSISTENT` / `UNBACKED_DATA_DIR`，需单独状态保留方案审批；本候选不加 mount、不迁移数据。输出只有版本、hash、原镜像身份与布尔状态，不打印私有目录、配置或凭据。

只读空闲快照不能阻止检查后出现新任务。实际切换另需批准短维护窗口，包含既有受保护后台 `/api/admin/campus-sync/actions/pause` / `resume` 的个人任务入站门禁、保存及恢复原 pause 状态。操作员通过现有后台确认/Origin/CSRF/scope/审计入口执行，不用无鉴权 curl 代替；先记录原 `personalAdmissionPaused`，仅当原状态为 false 才在窗口开始暂停新请求，等待 active=0。WYZ 个人 Agent 服务保持 active。未批准入站门禁则实际部署仍 BLOCKED，不能以连续两次空闲检查替代。

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


## 审批后可复制的备份、部署与代码回滚

以下命令只在另行批准的 Oracle 部署及短维护窗口执行，本轮不执行。source receipt、source archive、ARM image archive 必须属于同一已批准且 CI 通过的完整提交；旧未提交包不可使用。`APP_DIR`/`RUNTIME_DIR` 延续主机既有配置，`IMAGE_DIR` 是 CI ARM artifact 目录，包含 image archive、`image-inspect.json`、`commit.txt`、`SHA256SUMS`。旧镜像、实际挂载及备份现在未知，不能预填成功证据。

先保存窗口前只读结果的原 `personalAdmissionPaused`。经单独批准，由操作员通过既有受保护后台 pause/resume 入口建立入站门禁，保留 Origin/CSRF/scope/审计，等待个人队列和 Collector 租约归零；不改 WYZ 个人 Agent 服务。`deploy-before.json` 在门禁建立后生成，贯穿备份、切换、验收及回滚。恢复原 pause 设置会改变 control 时间戳及审计，属于窗口结束的显式动作；恢复后另存健康结果，不能把新 control hash 冒充为暂停前字节相等。

一致性备份（root TTY，Node >=20）：

```bash
set -Eeuo pipefail
umask 077
: "${APP_DIR:?原应用目录}" "${RUNTIME_DIR:?原runtime目录}" "${CANDIDATE_DIR:?已审核候选}" "${MANIFEST:?同提交receipt}"
BACKUP=/root/fosu-oracle-sample-backup/$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p -m 700 /root/fosu-oracle-sample-backup
mkdir -m 700 "$BACKUP"
node "$CANDIDATE_DIR/deploy/oracle-sample/preflight.js" --app-dir="$APP_DIR" --runtime-dir="$RUNTIME_DIR" --manifest="$MANIFEST" > "$BACKUP/deploy-before.json"
node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1])); if(p.status!=="PASS"||p.personalAdmissionPaused!==true) process.exit(2)' "$BACKUP/deploy-before.json"
OLD_IMAGE=$(docker inspect --format '{{.Image}}' fosuclass-api)
docker image inspect "$OLD_IMAGE" >/dev/null
docker image save "$OLD_IMAGE" | gzip -n > "$BACKUP/previous-image.tar.gz"
printf '%s\n' "$OLD_IMAGE" > "$BACKUP/previous-image-id.txt"
docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' fosuclass-api > "$BACKUP/compose-project.txt"
docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' fosuclass-api > "$BACKUP/compose-working-dir.txt"
docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' fosuclass-api > "$BACKUP/compose-config-files.txt"
docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.environment_file" }}' fosuclass-api > "$BACKUP/compose-env-files.txt"
PROJECT_DIR=$(cat "$BACKUP/compose-working-dir.txt")
ENV_FILES=$(cat "$BACKUP/compose-env-files.txt")
if [[ -z $ENV_FILES || $ENV_FILES == '<no value>' ]]; then printf '%s\n' "$PROJECT_DIR/.env" > "$BACKUP/compose-env-files.txt"; fi
IFS=',' read -r -a ORIG_COMPOSE_FILES < "$BACKUP/compose-config-files.txt"
for i in "${!ORIG_COMPOSE_FILES[@]}"; do
  [[ ${ORIG_COMPOSE_FILES[$i]} == /* && -f ${ORIG_COMPOSE_FILES[$i]} && ! -L ${ORIG_COMPOSE_FILES[$i]} ]] || exit 1
  cp -- "${ORIG_COMPOSE_FILES[$i]}" "$BACKUP/compose-$i.yml"
done
IFS=',' read -r -a ORIG_ENV_FILES < "$BACKUP/compose-env-files.txt"
for i in "${!ORIG_ENV_FILES[@]}"; do
  [[ ${ORIG_ENV_FILES[$i]} == /* && -f ${ORIG_ENV_FILES[$i]} && ! -L ${ORIG_ENV_FILES[$i]} ]] || exit 1
  cp -- "${ORIG_ENV_FILES[$i]}" "$BACKUP/compose-env-$i.env"
done
cp -- "$APP_DIR/server/.env" "$BACKUP/previous.env"
trap 'docker unpause fosuclass-api >/dev/null 2>&1 || true' EXIT INT TERM HUP
docker pause fosuclass-api >/dev/null
tar -czf "$BACKUP/state.tar.gz" -C "$APP_DIR/server" storage .env
docker unpause fosuclass-api >/dev/null
trap - EXIT INT TERM HUP
tar -tzf "$BACKUP/state.tar.gz" >/dev/null
(cd "$BACKUP"; sha256sum previous-image.tar.gz state.tar.gz previous-image-id.txt previous.env deploy-before.json compose-*.txt compose-*.yml compose-env-*.env > SHA256SUMS)
chmod 600 "$BACKUP"/*
printf 'ORACLE_BACKUP_CREATED_VERIFY_BEFORE_DEPLOY\n'
```

这段不删除备份或历史。实际 data dir 只有由 storage 持久挂载覆盖才会通过预检；若位于可写镜像层或另一个尚未纳入备份的 data mount，先 BLOCKED 并准备单独状态保留方案，不复制空目录掩盖风险。

同一维护窗口内加载已验证 ARM 镜像，只重建 `fosu-api`。CI checksum 可能包含构建时目录前缀，下面按唯一 archive basename 核对实际文件；仍须与审核的 CI run/交付 SHA256 对照。Compose project/working_dir/env-file 从实际容器记录读取，全部原配置使用私有备份副本；新 override 只设置 image ID、pull policy 与同一 SHA。

```bash
set -Eeuo pipefail
: "${BACKUP:?本次已校验备份}" "${IMAGE_DIR:?同提交的CI ARM artifact}" "${CANDIDATE_SHA:?已批准且CI通过的完整SHA}"
[[ $CANDIDATE_SHA =~ ^[a-f0-9]{40}$ ]]
(cd "$BACKUP"; sha256sum -c SHA256SUMS)
[[ $(cat "$IMAGE_DIR/commit.txt") == "$CANDIDATE_SHA" ]]
IMAGE_ARCHIVE="$IMAGE_DIR/fosu-oracle-sample-$CANDIDATE_SHA-arm64.image.tar.gz"
IMAGE_SHA=$(awk -v wanted="$(basename "$IMAGE_ARCHIVE")" '{ name=$2; sub(/^.*\//,"",name); if(name==wanted) print $1 }' "$IMAGE_DIR/SHA256SUMS")
[[ $IMAGE_SHA =~ ^[a-f0-9]{64}$ ]]
printf '%s  %s\n' "$IMAGE_SHA" "$IMAGE_ARCHIVE" | sha256sum -c -
docker load -i "$IMAGE_ARCHIVE" > "$BACKUP/candidate-image-load.txt"
IMAGE_REF="fosu-oracle-sample:$CANDIDATE_SHA"
[[ $(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE_REF") == "$CANDIDATE_SHA" ]]
[[ $(docker image inspect --format '{{.Architecture}}' "$IMAGE_REF") == arm64 ]]
IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$IMAGE_REF")
[[ $IMAGE_ID == $(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1]))[0].Id' "$IMAGE_DIR/image-inspect.json") ]]
PROJECT=$(cat "$BACKUP/compose-project.txt")
PROJECT_DIR=$(cat "$BACKUP/compose-working-dir.txt")
[[ $PROJECT =~ ^[a-z0-9][a-z0-9_-]*$ && $PROJECT_DIR == /* && -d $PROJECT_DIR ]]
COMPOSE_ARGS=(--project-directory "$PROJECT_DIR" -p "$PROJECT")
IFS=',' read -r -a ORIG_ENV_FILES < "$BACKUP/compose-env-files.txt"
for file in "${ORIG_ENV_FILES[@]}"; do COMPOSE_ARGS+=(--env-file "$file"); done
IFS=',' read -r -a ORIG_COMPOSE_FILES < "$BACKUP/compose-config-files.txt"
for i in "${!ORIG_COMPOSE_FILES[@]}"; do COMPOSE_ARGS+=(-f "$BACKUP/compose-$i.yml"); done
OLD_IMAGE=$(cat "$BACKUP/previous-image-id.txt")
printf 'services:\n  fosu-api:\n    image: "%s"\n    pull_policy: never\n    environment:\n      FOSU_DEPLOY_COMMIT_SHA: "%s"\n' "$IMAGE_ID" "$CANDIDATE_SHA" > "$BACKUP/sample-image.yml"
printf 'services:\n  fosu-api:\n    image: "%s"\n    pull_policy: never\n    environment:\n      FOSU_DEPLOY_COMMIT_SHA: a3dfd1989705f51c921f13883bcde1cce4502883\n' "$OLD_IMAGE" > "$BACKUP/rollback-image.yml"
wait_api_healthy() {
  for (( attempt=0; attempt<60; attempt++ )); do
    [[ $(docker inspect --format '{{.State.Health.Status}}' fosuclass-api 2>/dev/null) == healthy ]] && return 0
    sleep 2
  done
  return 1
}
rollback_code() {
  docker image inspect "$OLD_IMAGE" >/dev/null 2>&1 || docker load -i "$BACKUP/previous-image.tar.gz" >/dev/null || return 1
  docker compose "${COMPOSE_ARGS[@]}" -f "$BACKUP/rollback-image.yml" up -d --no-build --pull never --no-deps fosu-api > "$BACKUP/rollback-compose.log" 2>&1 || return 1
  wait_api_healthy || return 1
  node "$CANDIDATE_DIR/deploy/oracle-sample/preflight.js" --app-dir="$APP_DIR" --runtime-dir="$RUNTIME_DIR" --manifest="$MANIFEST" --compare-before="$BACKUP/deploy-before.json" > "$BACKUP/rollback-after.json" || return 1
}
# 再次核对门禁下的真实状态与备份基线；BLOCKED禁止进入up。
node "$CANDIDATE_DIR/deploy/oracle-sample/preflight.js" --app-dir="$APP_DIR" --runtime-dir="$RUNTIME_DIR" --manifest="$MANIFEST" --compare-before="$BACKUP/deploy-before.json" > "$BACKUP/deploy-recheck.json"
if ! docker compose "${COMPOSE_ARGS[@]}" -f "$BACKUP/sample-image.yml" up -d --no-build --pull never --no-deps fosu-api > "$BACKUP/deploy-compose.log" 2>&1 \
  || ! wait_api_healthy \
  || ! node "$CANDIDATE_DIR/deploy/oracle-sample/preflight.js" --app-dir="$APP_DIR" --runtime-dir="$RUNTIME_DIR" --manifest="$MANIFEST" --verify-after="$CANDIDATE_SHA" --before="$BACKUP/deploy-before.json" > "$BACKUP/deploy-after.json"; then
  rollback_code || { printf 'ORACLE_ROLLBACK_FAILED_KEEP_MAINTENANCE_AND_EVIDENCE\n'; exit 2; }
  printf 'ORACLE_CODE_ROLLBACK_PASS_REVIEW_BEFORE_RESTORING_ADMISSION\n'
  exit 1
fi
printf 'ORACLE_SAMPLE_DEPLOY_VERIFIED_PUBLICATION_NOT_APPROVED\n'
```

失败自动回滚只限本次尚未运行 Sample 的部署窗口，入站门禁保持，状态与私有历史不恢复、不删除。成功部署/回滚后，由操作员通过既有后台显式恢复原 pause 状态并保存审计，再用对应 SHA 的 preflight 另存只读健康结果；这个有意 control 改动不参与旧字节 hash 比较。

独立代码回滚入口在同一已批准会话中为 `rollback_code`。换会话时，重新指定原 APP_DIR/RUNTIME_DIR/CANDIDATE_DIR/MANIFEST/BACKUP，复用上面读取原 Compose 参数及函数定义的部分，不执行新镜像切换；先单独批准入站门禁、停止新 Sample 创建并确认真实队列/租约为空，再调用该入口。无法确认则 BLOCKED，不中断运行中的采集；不粘贴脱离原 project/env/mount 的单独 `docker compose up`。默认 a3 `--compare-before` 验证旧代码/实际镜像、个人签名协议、env、active/四索引/公告/表情和稳定容器契约。WYZ 个人 Agent、timer、routine/full、Windows 入口不执行写操作；任何数据快照恢复仍需单独审批。

Compose 路径和项目名检查遵循 Docker 的 [project name precedence](https://docs.docker.com/compose/how-tos/project-name/)、[合并路径规则](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/) 和 [环境插值规则](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)。本手册准备的是审批后的操作，不构成生产验收证据。
