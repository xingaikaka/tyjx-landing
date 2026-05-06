# tyjx-landing

天涯精选 **对外链路**(tyjx.app)的全套实现。覆盖:

- 品牌门户域跳转(`tyjx.app`)
- 入口页面(图 1:"最新地址"按钮列表)
- 发布页面(图 2:"复制网址" 按钮列表)
- admin 后台(管域池、入口/发布页 UI、真落地页内容)
- 真落地页本体(Next.js,见 `packages/luodiye_video/`)

---

## 业务定位

| 域 | 用途 | 落地链路 |
|---|---|---|
| `tyjx.app` | **app 内分享 + 品牌门户**(微信分享、APP logo) | tyjx.app → 入口页 → 发布页 → 用户复制 → `luodiye_video` |
| `tyapp.app`(在 `dp/` 仓库) | **广告投放渠道** | 自动直跳,走主系统 `dp/tyjx-landing-page` |

两条链路完全独立,共用资源 EdgeOne(`tyjx.calculus.xin`)。

详见 [`docs/architecture.md`](docs/architecture.md)。

---

## 目录结构

```
tyjx-landing/
├── packages/
│   ├── relay-server/    tyjx-portal-server(VPS Node 中转层,替代 CF Worker)
│   ├── admin-server/    admin 后端(Express + SQLite + JWT + R2 + HLS 转码)
│   ├── admin-web/       admin 前端(React + Vite + 横向 4tab)
│   └── luodiye_video/   真落地页(Next.js, host ∈ finalLandings)
├── deploy/              nginx / pm2 / acme.sh 脚本
├── docs/                架构 + 部署 + 运维文档
└── _legacy/             旧 CF Pages / Worker 代码(归档,不再维护)
```

> **架构变更(2026-05)**:已从 Cloudflare Worker 迁移到 VPS Node 中转层
> (`packages/relay-server` → 部署为 `tyjx-portal-server`,见 [`packages/relay-server/README.md`](packages/relay-server/README.md))。
> 所有 5 个 zone(brand + entry×2 + publish×2)的请求由 cdn666 → VPS:80 → Node:3020 处理,
> 不再走 Cloudflare Worker / KV。

---

## 开发

```bash
pnpm install                # 装依赖(monorepo)

pnpm dev:relay-server       # 中转层(3020)
pnpm dev:admin-server       # admin 后端(3010)
pnpm dev:admin-web          # admin 前端(3011)
pnpm dev:landing            # 真落地页(Next.js,3008)
```

---

## 部署

服务器:`43.128.4.201`

| 端口 | 进程 |
|---|---|
| 3010 | admin-server(PM2:`tyjxapp-admin`) |
| 3020 | relay-server(PM2:`tyjx-portal-server`,**5 个 zone 中转**) |
| 3011 | admin-web(nginx 静态) |
| —    | luodiye_video(nginx 直接服务 `out/`,finalLandings) |

入口流量:cdn666 → VPS:80 → Nginx → `127.0.0.1:3020`(relay-server)

详见 [`docs/deployment.md`](docs/deployment.md)。

媒体存储:支持 `local`(本机磁盘) / `r2`(R2 + 腾讯 CDN 回源) 二选一,见 [`docs/storage-r2.md`](docs/storage-r2.md)。

---

## 域池层级(完全可配,admin 后台动态管理)

```
brandDomains[]   tyjx.app                               ← 品牌域(用户记忆)
entryPages[]     tyjxn3k8m2p7vc.cc, tyjxq5r9t2xwz1.cc   ← 入口页面泛域池(N 可配)
publishPages[]   tyjxbn4w8fgh3.cc, tyjxnf0skf9h.cc      ← 发布页面泛域池(N 可配)
finalLandings[]  tyjx7k2m9pqs4.cc, tyjxlh2wyxr9.cc,
                 tyjxhotpzixm.cc                        ← 真落地页泛域池(N 可配)

合计:8 个域,4 层结构
```

> 默认值已经填充到 `packages/admin-server/src/seed/initial-config.json`,首次启动 admin-server 时自动入库。

加新域 → admin 后台一键(可选自动化:CF API + acme.sh + nginx reload)。

---

## 链路示意

```
[ 用户 ] tyjx.app                    ─┐
   │ 302                              │
   ▼                                  │
[ entryPages 池随机 1 ]  *.cc          │
   │ 显示入口 HTML(图 1)             │  cdn666 → VPS:80 → Nginx
   │ JS 跳转(无 a href)              │  → relay-server :3020
   ▼                                  │  (从 admin :3010 拉 runtime,
[ publishPages 池随机 1 ]  *.cc        │   AES-CBC iv:cipher 解密)
   │ 显示发布 HTML(图 2)             │
   │ N 个"复制网址",用户复制粘贴   ─┘
   ▼
[ finalLandings 池随机 1 ]  <随机子域>.*.cc
   │ nginx 静态服务 luodiye_video/out  ← 此层独立,不经过 relay-server
   │ 视频背景 + Logo + 下载按钮
   └ 真落地页(对外清白版)
```

---

## License

Private.
