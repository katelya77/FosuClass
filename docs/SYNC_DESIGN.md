# V4 教务课表同步设计

## 架构边界

小程序端不直接请求 `100.fosu.edu.cn`。所有真实教务请求只允许在云函数或后端服务中完成，小程序只读取我们自己的缓存数据。

全校课表不是让每个用户实时访问学校教务系统，而是由云函数或管理员任务低频同步教务数据，再把归一化后的课表缓存到云数据库。这样首页、全校页、教师页读取速度更快，也不会给学校教务系统造成压力。

## 同步节奏

- 学期初由管理员手动触发全量同步：学院、年级、专业、班级、教师、教室、课程筛选项，以及常用班级课表。
- 平时每天或每周做低频增量同步，优先更新已被用户访问过的班级和教师课表。
- 用户点击未缓存班级时，可以提交一次低频同步请求，但必须限流；同步失败时提示“该班级课表暂未缓存”。
- V4 不做高频自动爬取，也不在小程序端循环请求学校接口。

## 数据来源

- 个人课表：`/xskb/xskb_list.do`
- 行政班级课表：`/kbcx/kbxx_xzb_ifr`
- 教师课表：`/kbcx/kbxx_teacher_ifr`
- 教室课表：`/kbcx/kbxx_classroom_ifr`
- 课程课表：`/kbcx/kbxx_kc_ifr`
- 专业联动：`/kbcx/getZyByAjax?skyx={学院代码}&sknj={年级}`
- 节次初始化：`/kbxx/initJc?xnxq={学期}`

## 云函数分层

- `cloudfunctions/common/fosuQiangzhiAdapter.js`：封装强智接口路径、GET/POST 参数和网络请求；默认关闭真实网络请求。
- `cloudfunctions/common/parser.js`：解析 `table#kbtable`、学校筛选项和专业联动响应。
- `cloudfunctions/common/scheduleNormalizer.js`：把解析结果归一化为 `CourseItem`。
- `cloudfunctions/common/cache.js`：V4 先提供本地缓存接口，后续替换为 CloudBase 数据库。
- `syncSchoolOptions`：同步学院、年级、专业和缓存班级元数据。
- `syncClassSchedule`：同步行政班级课表并按班级分组缓存。
- `syncTeacherSchedule`：同步教师课表并按教师分组缓存。
- `getSchoolOptions` / `getCachedSchedule`：小程序端读取缓存。

## 权限与合规

- 如果接口需要登录态，必须使用授权账号或用户主动登录产生的一次性登录态。
- 不做越权访问，不公开个人隐私数据。
- 不存明文密码，不把密码写入本地 Storage、云数据库、日志或 Git。
- Cookie、Token、JSESSIONID、CAS ticket、Authorization 等只允许在服务端请求周期内短暂存在，日志必须脱敏。
- 原始 HAR 不提交仓库；只保留脱敏报告、脱敏后的解析结果和接口结构说明。
