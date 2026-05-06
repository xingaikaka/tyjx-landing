# 媒体存储:R2 + 腾讯 EdgeOne CDN

> admin-server 上传图片/视频/APK 时,可选两种后端:
>
> - `local`(默认): 写本机磁盘,nginx `/uploads/` 反代
> - `r2`: 写 Cloudflare R2,落地页/Worker 通过腾讯 EdgeOne CDN 访问(回源 R2 公网域)
>
> 本文说明 r2 后端的搭建步骤。

---

## 与 tyapp.app(dp/) **共用同一个 R2 桶**

为了减少基建复杂度,**tyjx.app 系统沿用 dp/tyjx-admin 已经在用的 R2 桶 + 腾讯 EdgeOne CDN**,
通过对象 key 前缀区分目录,互不影响:

| 系统 | R2 桶 | 腾讯 CDN | R2 内 key 前缀 |
| --- | --- | --- | --- |
| tyapp.app (dp/) | `luodiye` | `https://cdn.calculus.xin` | `encrypted-assets/`<br>`downloads/`<br>`video-assets/`<br>`favicon/`<br>`m3u8/` |
| tyjx.app (本系统) | `luodiye` | `https://tyjx.calculus.xin` | `tyjx/uploads/`<br>`tyjx/downloads/`<br>`tyjx/video-assets/` |

→ admin-server 设置 `STORAGE_KEY_PREFIX=tyjx`,所有上传内部自动 prepend 该前缀,
与 dp 的对象目录天然隔离;**dp 的所有桶 / CDN / DNS / 帐号信息不需要改动**。

凭据沿用:
- `R2_BUCKET=luodiye`
- `CDN_BASE=https://tyjx.calculus.xin` (默认值;后台「系统设置」可覆盖为 `system.mediaCdnBase`)
- `R2_PUBLIC_BASE=https://pub-388a2bdee6d148dda9bd7ae0b8fe7d79.r2.dev`(回源兜底)
- `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` 与 dp 同一组(从 dp 部署机
  `dp/tyjx-admin/server/.env` 拷贝即可)

---

## 链路

```
[luodiye_video / tyjx-portal Worker]
   │  <img src="https://tyjx.calculus.xin/tyjx/uploads/abc.png">
   ▼
[腾讯云 EdgeOne CDN]    tyjx.calculus.xin (与 tyapp.app 的 cdn.calculus.xin 区分,同账号同桶)
   │  miss → 回源
   ▼
[CF R2 公网域]  pub-388a2bdee6d148dda9bd7ae0b8fe7d79.r2.dev (或自定义域)
   │
   ▼
[R2 bucket]    luodiye
   ├─ encrypted-assets/...    ← dp 写入
   ├─ downloads/...           ← dp 写入
   ├─ video-assets/...        ← dp 写入
   └─ tyjx/...                ← 本系统(tyjx-landing)写入
   ▲
   │  S3 PUT (admin-server 上传时)
[admin-server (tyjx-landing)]
```

设计要点:
- **浏览器只看到腾讯 CDN 域**,Cloudflare/R2 不直接面向用户
- **共用 R2 桶 + 共用 CDN 加速**,免去再申请域名/再签 SSL/再配回源的成本
- **STORAGE_KEY_PREFIX 隔离目录**,两个系统互不污染
- 腾讯 CDN 命中率高时,几乎所有请求都不打 R2,Egress 成本接近 0

---

## 一、CF R2 准备

### 1.1 创建 bucket

Cloudflare Dashboard → R2 → Create bucket:

- 名称: `tyjx-portal-media`(或别的)
- Location: `Auto` 即可(R2 的 Auto 在国内访问 Asia 节点会自动优先)

### 1.2 创建 R2 API Token

R2 → Manage API tokens → Create API token:

- 权限: `Object Read & Write`
- 资源: `Apply to specific buckets only` → 选刚才的 bucket

记录:
- `Access Key ID`
- `Secret Access Key`
- `S3 endpoint`(形如 `https://<accountid>.r2.cloudflarestorage.com`)

### 1.3 配置 R2 公网访问

两种方式选一个,推荐 (a)。

**(a) 自定义域(推荐)**

R2 bucket → Settings → Custom domains → Connect domain:

- 域: `tyjx-r2.example.com`(随便取个不用宣传的)
- CF 自动加 CNAME 到 R2,自动签 SSL
- 默认 **public** 访问;如果想限制,可以在 bucket 设置里加 CORS / Access policy

> 这个域**不要**直接给用户使用,只给腾讯 CDN 当回源域。

**(b) `r2.dev` 公开桶**

R2 bucket → Settings → Public access → Allow public access:

- 开启后会得到 `https://pub-xxx.r2.dev` 形式的域
- 缺点: 国内访问 r2.dev 速度有点不稳

---

## 二、腾讯 CDN 准备

### 2.1 添加加速域名

腾讯云控制台 → 内容分发网络 CDN → 域名管理 → 添加域名:

- 加速域名: `static.tyjx.app`(用户实际看到的)
- 业务类型: `静态加速`
- 源站类型: `源站域名`,填 R2 自定义域 `tyjx-r2.example.com`
- 回源 host: `tyjx-r2.example.com`(和源站域名一致)
- 回源协议: `HTTPS`

### 2.2 配置缓存规则

CDN → 缓存规则:

| 路径 | 缓存时间 |
|---|---|
| `*.png *.jpg *.jpeg *.webp *.gif *.svg *.ico` | 30 天 |
| `*.mp4 *.webm *.mov` | 30 天 |
| `/uploads/*` | 30 天 |
| 其他 | 1 小时 (默认) |

可选:开启 `Range 回源`(分片回源,适合大视频)。

### 2.3 加 CNAME

域名解析(用 CF DNS 或腾讯云 DNS 都行):

```
CNAME static.tyjx.app  static.tyjx.app.dnsv1.com   (腾讯 CDN 给的 CNAME)
```

> 注意:`static.tyjx.app` 这个域不要在 CF 走橙色云,因为我们要走腾讯 CDN。
> 如果它在 tyjx.app 这个 CF Zone 下,把它设成 "DNS only"(灰色云朵)。

### 2.4 申请 SSL 证书

CDN → HTTPS 配置 → 上传证书 / 让腾讯免费签。开启 `强制 HTTPS`。

---

## 三、admin-server 配置

### 3.1 .env

```bash
STORAGE_BACKEND=r2

R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_BUCKET=tyjx-portal-media
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...

CDN_BASE=https://static.tyjx.app
```

### 3.2 重启 admin-server

```bash
pm2 reload tyjx-admin-server
```

### 3.3 验证

后台上传一张图,媒体库应该显示 `https://static.tyjx.app/uploads/<key>.png` 的 URL。
直接打开该 URL,看是否 200。

---

## 四、本机磁盘 → R2 迁移(可选,有存量数据再做)

切到 R2 后,**老数据(backend=local)依然可用**,只要 admin-server 同主机的 nginx `/uploads/` 反代还在。

要把存量迁过去,跑一次性脚本:

```js
// scripts/migrate-local-to-r2.mjs(可以新增,本仓库暂未提供模板)
import db from '../packages/admin-server/src/lib/db.js';
import { put as storagePut } from '../packages/admin-server/src/lib/storage.js';
import fs from 'node:fs';
import path from 'node:path';

const rows = db.prepare("SELECT * FROM media WHERE backend = 'local'").all();
for (const r of rows) {
  const local = path.join(/* uploadDir */, r.storage_key);
  if (!fs.existsSync(local)) continue;
  const buf = fs.readFileSync(local);
  const { url, backend } = await storagePut(r.storage_key, buf, r.mime);
  db.prepare("UPDATE media SET url=?, backend=? WHERE id=?").run(url, backend, r.id);
  console.log('migrated', r.id);
}
```

---

## 五、回滚

把 `.env` 改回 `STORAGE_BACKEND=local` 后重启。
之前在 R2 上传的记录(backend=r2)的 URL 仍然能访问(因为指向腾讯 CDN),不影响落地页显示;
新上传的会重新写本机磁盘。

---

## FAQ

**Q: 要不要把 admin-portal 后台访问也走 R2?**

A: 不要。admin 后台是高频写、低频读、需要鉴权。直接同源 `/uploads/` 反代(就算本地存)最简单。

**Q: 想看 R2 用了多少流量?**

A: CF R2 dashboard → Metrics 看 Class A/B operations 和 Egress。如果 CDN 命中率正常,Egress 应该非常低。

**Q: R2 公网域被人扫到了怎么办?**

A: R2 bucket → CORS 策略限制 origin 为 `https://static.tyjx.app`,
   或者配 Cloudflare WAF 只允许腾讯 CDN 回源 IP 段访问。
