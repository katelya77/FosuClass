# OpenResty 静态 Release Pack 配置

目标：`/static/releases/*` 由 OpenResty 直接读取 `server/storage/public/releases`，Node 只负责发布控制和兼容 API。

## 1Panel OpenResty 示例

将路径替换为服务器上的项目绝对路径：

```nginx
server {
    listen 80;
    server_name class.katelya.eu.org;

    location /static/releases/ {
        alias /opt/FosuClass/server/storage/public/releases/;
        gzip_static on;
        brotli_static on; # 环境未安装 brotli 模块时删除这一行
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }

    location /admin/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

## Cloudflare 缓存策略

给 `/static/releases/*` 配 Cache Rule：Cache Everything，Edge TTL 使用长缓存。Release Pack URL 带 `releaseVersion`，可安全使用 immutable。

不要强缓存这些动态入口：

- `/api/fosu/app-config`
- `/api/fosu/bootstrap`
- `/api/fosu/release-pack/manifest`

它们必须保持 `no-store`，用于发现最新 `releaseVersion/cacheEpoch/forceRefreshToken`。

## 国内 CDN 准备

未来可将 `static-class.katelya.top` 接入腾讯云 COS/CDN 或其他国内对象存储/CDN，只同步 `server/storage/public/releases/*`。API 仍可留在 VPS：

```env
FOSU_API_BASE_URL=https://class.katelya.eu.org
FOSU_STATIC_RELEASE_BASE_URL=https://static-class.katelya.top/static/releases
```

后台发布新 release 后，把对应版本目录上传到国内 CDN，再确认 manifest 的 `staticBaseUrl/indexUrls/emptyRoomUrl/detailUrlPattern` 指向静态域名。

长任务不要通过同步 HTTP 等待结果；后台使用 job polling。

## Runtime active pointer

`/static/runtime/active.json` is not a release artifact. It is the mutable runtime pointer for the current active term/release, so it must live outside `/static/releases/<releaseVersion>/`.

Docker compose now mounts:

```text
/opt/1panel/www/sites/class.katelya.eu.org/index/static/runtime -> /openresty-static/runtime
```

and sets:

```env
OPENRESTY_HOST_RUNTIME_DIR=/opt/1panel/www/sites/class.katelya.eu.org/index/static/runtime
OPENRESTY_STATIC_RUNTIME_DIR=/openresty-static/runtime
```

If 1Panel manages container volumes outside this compose file, add the same writable mount once in the 1Panel container UI. Keep the existing releases mount unchanged. The repair job copies `/app/storage/public/runtime/active.json` atomically to `/openresty-static/runtime/active.json` after activation. If this mount is missing, readiness should show only a warning and must not block release construction or miniprogram runtime.
