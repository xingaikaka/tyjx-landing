# 架构设计

> 本文沉淀 tyjx-landing 的整体架构、数据模型、API 设计、安全策略,作为后续开发与运维的唯一权威。

> **中转层**:入口/发布页由 VPS 上的 Node 中转层 `packages/relay-server`
> (部署为 `tyjx-portal-server`,VPS:3020)做 SSR / 302。
> 链路:`用户 → cdn666 → VPS:80 → Nginx → relay-server:3020 → 入口/发布 SSR`。
> admin → relay 配置走 `/api/portal/runtime`(AES-CBC iv:cipher)。

---

## 1. 全局定位

| 系统 | 仓库 | 用途 | 用户操作 |
|---|---|---|---|
| **对外链路**(本仓库) | `落地页-唯一/tyjx-landing/`(monorepo,含 `packages/luodiye_video` 真落地页) | app 内分享 / 品牌门户(微信、QQ、APP logo) | 入口页 → 发布页 → **手动复制粘贴** → 落地 |
| **对内链路**(主系统) | `dp/tyjx-landing-page/` + `dp/tyjx-admin/` + `dp/tyjx-relay/` + `dp/tyjx-entry/` | 广告投放(Google/百度/字节...) | 自动 302 跳转,无需用户操作 |

两条链路完全隔离,**没有任何代码 / 数据共享**。

---

## 2. 对外链路全景

```
                            用户记忆/分享渠道
                                    │
                                    ▼
        ┌─────────────────────────────────────────────────────┐
        │         tyjx.app(品牌固定域,1 个)                  │
        │         relay-server:host 命中 → 302                 │
        └────────────────────┬────────────────────────────────┘
                             │ 302 → 随机选 entryPages 池一个
                             ▼
        ┌─────────────────────────────────────────────────────┐
        │  入口页面(图 1)                                    │
        │  relay-server,host ∈ entryPages[]                   │
        │  HTML:logo + "地址发布页" + N 个"最新地址"按钮      │
        │  按钮 onclick = window.location → publishPages       │
        │  ⚠️ 关键:无任何 <a href> 指向落地池                   │
        └────────────────────┬────────────────────────────────┘
                             │ 用户点击"最新地址 X"
                             ▼
        ┌─────────────────────────────────────────────────────┐
        │  发布页面(图 2)                                    │
        │  relay-server,host ∈ publishPages[]                 │
        │  HTML:N 行"<随机>.<finalLanding>.cc [复制网址]"     │
        │  用户复制 → 跳出浏览器粘贴                            │
        │  ⚠️ 关键:落地 URL 仅以字符串存在,扫描器抓不到        │
        └────────────────────┬────────────────────────────────┘
                             │ 用户复制粘贴
                             ▼
        ┌─────────────────────────────────────────────────────┐
        │  真落地页 luodiye_video                             │
        │  43.128.4.201 nginx 静态托管                         │
        │  host ∈ finalLandings[](泛域,通配符 *.X.cc)        │
        │  内容:视频 + Logo + 下载按钮 + Telegram(全可配)    │
        │  对外清白,不含违规内容,过审无压力                    │
        └─────────────────────────────────────────────────────┘
```

---

## 3. 域池层级(4 层,完全可配)

| 层级 | 字段 | 数量 | 部署 |
|---|---|---|---|
| **品牌门户域** | `brandDomains[]` | 1+ | CF DNS → cdn666 → VPS relay-server。`brandDomains[0]` 是主品牌域(用于文案展示),其余作备用。当前只配 1 个 `tyjx.app`,以后可在 admin 后台加备用域 |
| **入口页面泛域** | `entryPages[]` | N(2~10) | CF DNS → cdn666 → VPS relay-server(每个域 + 通配符) |
| **发布页面泛域** | `publishPages[]` | N(3~20) | CF DNS → cdn666 → VPS relay-server(每个域 + 通配符) |
| **真落地页泛域** | `finalLandings[]` | N(3~10) | CF DNS A → VPS + 通配符 SSL(nginx 静态,不经 relay-server) |

### 显示数量(可独立配置)

- `entryButtonsCount`:入口页面"最新地址"按钮数(默认 2)
- `publishLinksCount`:发布页面"复制网址"行数(默认 2)

---

## 4. 数据模型(SQLite,admin-server)

```sql
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER
);
-- key ∈ { 'domains', 'portalUI', 'landing' }

CREATE TABLE media (
  id INTEGER PRIMARY KEY,
  filename TEXT,
  storage_key TEXT,
  url TEXT,
  mime TEXT,
  size INTEGER,
  created_at INTEGER
);

CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE,
  password_hash TEXT,
  created_at INTEGER
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  action TEXT,
  payload TEXT,
  created_at INTEGER
);
```

### `config['domains']` 形态

```json
{
  "brandDomains": ["tyjx.app"],
  "entryPages": ["tyjxn3k8m2p7vc.cc", "tyjxq5r9t2xwz1.cc"],
  "publishPages": ["tyjxbn4w8fgh3.cc", "tyjxnf0skf9h.cc"],
  "finalLandings": ["tyjx7k2m9pqs4.cc", "tyjxlh2wyxr9.cc", "tyjxhotpzixm.cc"],
  "entryButtonsCount": 2,
  "publishLinksCount": 2
}
```

### `config['portalUI']` 形态

```json
{
  "logo": "https://admin-portal.xxx/uploads/logo.png",
  "siteName": "地址发布页",
  "bookmarkTip": "请 Ctrl+D 收藏本页到浏览器收藏夹回家不迷路",
  "clickPrompt": "--点击下方按钮进入网站--",
  "bookmarkBlock": {
    "line1": "收藏本站永久地址: <brandDomain>, 防止失联!",
    "line2": "网站域名经常更新, 防止网站打不开",
    "line3": "请务必收藏此网页, 永久有效!"
  },
  "footerNote": [
    "安卓用户请使用谷歌(Chrome)浏览器访问",
    "iPhone用户请使用手机自带Safari浏览器访问",
    "无广告、体验流畅、速度更快"
  ]
}
```

### `config['landing']` 形态

```json
{
  "logo": "https://admin-portal.xxx/uploads/landing-logo.png",
  "backgroundVideo": "https://admin-portal.xxx/uploads/bg.mp4",
  "telegramLink": "https://t.me/swlr88",
  "openInstallAppKey": "ecedok",
  "downloadButtons": {
    "ios":     { "label": "苹果手机下载", "enabled": true },
    "android": { "label": "安卓手机下载", "enabled": true }
  },
  "vpnSection": {
    "title": "全网首家,自带免费VPN",
    "subtitle": "安全稳定,高速畅享全球网络"
  }
}
```

---

## 5. API 端点

### admin-server 暴露

#### 公开(供 relay-server / luodiye_video 拉,不需登录)

```
GET  /api/portal/runtime              relay-server 拉:domains + portalUI(AES-CBC 加密)
GET  /api/portal/landing/config       luodiye_video 拉:landing 内容(明文 JSON)
```

#### 私有(admin UI 用,JWT 认证)

```
POST   /api/admin/login                登录,返回 JWT

GET    /api/admin/domains              查域池
PUT    /api/admin/domains              改域池

GET    /api/admin/portalUI             查 UI 配置
PUT    /api/admin/portalUI             改 UI 配置

GET    /api/admin/landing              查落地配置
PUT    /api/admin/landing              改落地配置

GET    /api/admin/media                媒体库列表
POST   /api/admin/media                上传(图片/视频)
DELETE /api/admin/media/:id            删除

GET    /api/admin/health               健康检查
POST   /api/admin/republish            (可选)触发 luodiye_video 重新发布
```

### relay-server 暴露

```
GET    *                               host 分发(brandDomain / entryPages / publishPages)
GET    /api/r                          域池 JSON(给前端 fetch)
POST   /api/jump                       发布页"复制网址"列表(随机生成 N 个落地子域)
GET    /__health                       健康检查
```

---

## 6. 加密通信(relay-server ↔ admin-server)

- 共享 secret = `PORTAL_API_SECRET`(两端 `.env` 同值)
- 协议 = AES-256-CBC(`packages/relay-server/src/lib/crypto.js`,兼容前端 CryptoJS)
- relay-server 拉 `/api/portal/runtime` 后本地缓存(内存 + 文件兜底)

luodiye_video ↔ admin-server 走**明文**(浏览器要拿到内容,加密无意义)。

---

## 7. relay-server host 路由策略

```js
// packages/relay-server/src/lib/router.js
const classifyHost = (host, domains) => {
  if (matches(host, domains.brandDomains))   return 'brand';   // → 302 入口子域
  if (matches(host, domains.entryPages))     return 'entry';   // → 渲染入口页
  if (matches(host, domains.publishPages))   return 'publish'; // → 渲染发布页
  return 'unknown';
};

// matches: host === pool[i] || host endsWith "." + pool[i]
// 因为入口/发布页用泛域,实际访问的是 <随机 10 字符>.tyjxn3k8m2p7vc.cc 这种子域
function matches(host, pool) {
  return pool.some((d) => host === d || host.endsWith('.' + d));
}
```

runtime 配置内存缓存 `RUNTIME_CACHE_TTL` 秒,失败时用文件缓存兜底,再失败用 `FALLBACK_POOL` / 默认空池。

---

## 8. 部署拓扑

```
                    Cloudflare(仅 DNS,橙云代理)
        ┌──────────────────────────────────┐
        │  DNS:                             │
        │    tyjx.app                  → 橙云 │
        │    *.<entryPages>.cc         → 橙云 │
        │    *.<publishPages>.cc       → 橙云 │
        │    *.<finalLandings>.cc      → 橙云 / A 记录 │
        └────────────────┬─────────────────┘
                         │ cdn666 → VPS:80/443
                         ▼
                    VPS(tyjx-portal-server 所在机)
        ┌──────────────────────────────────┐
        │  nginx(反代 + 静态托管)          │
        │    server tyjx.app / entryPages   │
        │           / publishPages:         │
        │      → 127.0.0.1:3020(relay-server)│
        │    server *.<finalLandings>.cc:   │
        │      root luodiye_video/out(静态) │
        │    server admin 域:               │
        │      → :3010(server) + 静态(web)  │
        │                                   │
        │  PM2:                             │
        │    tyjx-portal-server   (port 3020)│
        │    tyjxapp-admin        (port 3010)│
        │                                   │
        │  数据(admin-server):             │
        │    data/portal.db (SQLite)        │
        │    data/uploads/ (媒体)           │
        └──────────────────────────────────┘
```

---

## 9. 安全策略

| 层 | 策略 |
|---|---|
| **入口/发布页** | HTML 内**无任何 `<a href>`**,所有跳转走 JS 字符串。扫描器只能看到字符串,无法 follow |
| **真落地 URL** | 子域随机生成(10 字符),用户每次进发布页看到的 URL 不同;扫描器抓到 1 个不能批量推 |
| **relay ↔ admin** | AES-CBC 加密 runtime 配置 |
| **admin UI** | JWT 登录;管理后台域**绑 IP 白名单**(只允许办公网/SSH 跳板) |
| **媒体存储** | 上传走 admin 鉴权;静态服务从 admin server 提供(签了 token URL,可选) |
| **token 直跳** | **不实现**(tyjx.app 永远走完整流程,业务定位是分享/品牌,不需要直跳) |

---

## 10. 上线灰度顺序

详见 [deployment.md](deployment.md)。

```
Phase 0  monorepo 骨架(已完成)
Phase 1  服务器基础(域名 + DNS + SSL)            待用户准备
Phase 2  luodiye_video baseline 部署              待 Phase 1
Phase 3  admin-server + admin-web 开发            可立刻并行(本地)
Phase 4  luodiye_video 接 admin runtime           待 Phase 2 + 3
Phase 5  relay-server(tyjx-portal-server)开发 + 部署   可立刻并行(本地)
Phase 6  老 CF Pages tyjx-landing 下线            待 Phase 5 上线 24h
Phase 7  文档 + 监控页 + 加新域自动化(可选)
```
