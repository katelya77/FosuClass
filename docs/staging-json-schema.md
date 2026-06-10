# Staging JSON 数据结构

Staging JSON 是本机校园网同步和接力上传的唯一数据交付格式。上传到 VPS 后只进入暂存区，不直接发布线上 release。

## 必填字段

```json
{
  "schemaVersion": "1.0",
  "releaseVersion": "202620271-20260901-090000",
  "term": "2026-2027-1",
  "termStartDate": "2026-09-01",
  "generatedAt": "2026-09-01T01:00:00.000Z",
  "source": "local-sync-client",
  "catalog": {
    "colleges": [],
    "semesters": [],
    "grades": [],
    "weeks": [],
    "sections": []
  },
  "majors": [],
  "classSchedules": [],
  "resources": {
    "teacherSchedules": [],
    "classroomSchedules": [],
    "courseSchedules": [],
    "classrooms": [],
    "teachers": [],
    "courses": []
  }
}
```

`classSchedules` 必须是非空数组。`resources` 内的数组允许为空，但会在后台显示校验警告。

## 班级课表 `classSchedules`

每个班级课表建议包含：

- `className`
- `semester`
- `collegeName`
- `majorName`
- `grade`
- `courses`

课程项至少应包含课程名称、周次、星期、起止节次、教师和教室。字段名可由同步客户端归一化，但发布前必须通过 `npm run test:course-normalizer`。

## 资源数据 `resources`

`resources` 用于教师课表、教室课表、课程维度查询和教室占用热力图：

- `teacherSchedules`
- `classroomSchedules`
- `courseSchedules`
- `classrooms`
- `teachers`
- `courses`

缺少资源不会立刻阻断上传，但会降低后台资源中心和小程序辅助查询能力。

## 敏感字段禁止

Staging JSON 不得包含：

- 学号密码
- Cookie / JSESSIONID
- ticket / execution
- session
- token / Authorization
- 验证码相关字段

本机同步客户端和 Relay Agent 都会在上传前做敏感字段扫描。

## 生成方式

```powershell
npm run sync:local-campus -- --term=2026-2027-1 --start=2026-09-01 --output=./staging/2026-2027-1-full.json
```

## 上传方式

```powershell
npm run sync:local-upload -- --file=./staging/2026-2027-1-full.json --server=https://class.katelya.eu.org
```

上传命令会自动 gzip 并按默认 8MB 分片调用：

- `POST /api/admin/staging/upload/init`
- `POST /api/admin/staging/upload/chunk`
- `POST /api/admin/staging/upload/finalize`
- `GET /api/admin/staging/upload/:uploadId/status`

后台会校验分片数量、压缩后 SHA-256、解压后大小、原始 JSON SHA-256 和 Staging schema。上传后在后台检查 diff，再发布正式 release。
