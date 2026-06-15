# tyjx-landing 落地页交接文档

## 基本信息

| 项目 | 说明 |
|------|------|
| 项目名称 | tyjx-landing（发布页形式项目） |
| 项目类型 | 视频落地页（Next.js，静态导出）+ 发布页入口 + 中转 |
| GitHub | https://github.com/xingaikaka/tyjx-landing.git |
| 部署服务器 | `47.239.139.208` |
| 部署路径 | `/opt/tyjxapp` |
| 进程管理 | PM2 |

## 域名配置

### 品牌域 / 入口域

| 域名 | 类型 | 说明 |
|------|------|------|
| `tyjx.app` | 品牌域 | 发布页主入口 |
| `tyjxn3k8m2p7vc.cc` | 入口域（Entry Page） | 备用入口 |
| `tyjxq5r9t2xwz1.cc` | 入口域（Entry Page） | 备用入口 |

### 发布页域（Publish Page）

| 域名 | 说明 |
|------|------|
| `tyjxbn4w8fgh3.cc` / `*.tyjxbn4w8fgh3.cc` | 发布页域，含泛子域名 |
| `tyjxnf0skf9h.cc` / `*.tyjxnf0skf9h.cc` | 发布页域，含泛子域名 |

### 落地页域（Final Landing）

| 域名 | 说明 |
|------|------|
| `tyjx7k2m9pqs4.cc` / `*.tyjx7k2m9pqs4.cc` | 落地页域，由 Nginx 直接服务静态文件 |
| `tyjxlh2wyxr9.cc` / `*.tyjxlh2wyxr9.cc` | 落地页域，由 Nginx 直接服务静态文件 |

> 所有以上域名的 DNS 均托管在 **Cloudflare**，A 记录指向 `47.239.139.208`，开启代理（橙色云）

## 架构说明

```
用户 → tyjx.app（品牌域/入口）
     → tyjx-portal-server（端口 3020）处理跳转逻辑
     → 发布页链接（publishPage 子域名）→ 落地页链接（finalLanding 子域名）
     → luodiye_video 静态落地页（Nginx 直接服务 /opt/tyjxapp/packages/luodiye_video/out）
```

## 服务器 PM2 进程

| 进程名 | 说明 | 路径 | 端口 |
|--------|------|------|------|
| `tyjxapp-admin` | 后台管理服务 | `/opt/tyjxapp/packages/admin-server` | 3010 |
| `tyjx-portal-server` | 入口/发布页中转服务 | `/opt/tyjxapp/packages/relay-server` | 3020 |

> 落地页（`luodiye_video`）为纯静态导出，由 Nginx 直接服务，**无需 PM2 进程**

## Nginx 配置文件

| 配置文件 | 负责内容 |
|----------|----------|
| `/etc/nginx/conf.d/tyjxapp-portal.conf` | 品牌域、入口域、发布页域 → 代理至 port 3020 |
| `/etc/nginx/conf.d/tyjxapp-landing.conf` | 落地页域 → 服务静态文件 + 代理 /api/ 至 port 3010 |

## 落地页静态文件

- 源码路径：`/opt/tyjxapp/packages/luodiye_video`
- 构建产物：`/opt/tyjxapp/packages/luodiye_video/out`
- 构建命令：`cd /opt/tyjxapp/packages/luodiye_video && npm run build`
- 配置文件：`next.config.js` 中 `output: 'export'`

## OpenInstall 配置

- AppKey：`ecedok`
- 逻辑：多 CDN 降级加载 → 点击按钮才显示 loading → SDK 就绪后调用 `wakeupOrInstall()`
- 无超时兜底跳转

## 数据目录

| 路径 | 说明 |
|------|------|
| `/opt/tyjxapp/data/portal.db` | SQLite 数据库（发布页配置、落地页配置等） |
| `/opt/tyjxapp/data/uploads` | 上传资源文件 |

> 数据与 `8.210.115.247` 服务器共用同一份初始数据（复制自 247）

## 部署步骤

```bash
# 落地页代码变更后重新构建
cd /opt/tyjxapp/packages/luodiye_video
npm run build
# 无需重启进程，Nginx 直接读取 out/ 目录

# relay-server / admin-server 代码变更后
pm2 restart tyjxapp-admin
pm2 restart tyjx-portal-server
```

## 相关环境变量

**admin-server** (`/opt/tyjxapp/packages/admin-server/.env`)：
```
PORT=3010
DB_PATH=/opt/tyjxapp/data/portal.db
PUBLIC_URL=http://47.239.139.208:3010
```

**relay-server** (`/opt/tyjxapp/packages/relay-server/.env`)：
```
PORT=3020
ADMIN_BASE_URL=http://127.0.0.1:3010
```
