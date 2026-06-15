# tyapp-landing 落地页交接文档

## 基本信息

| 项目 | 说明 |
|------|------|
| 项目名称 | tyapp-landing |
| 项目类型 | 视频落地页（Next.js，静态导出） |
| GitHub | https://github.com/xingaikaka/tyapp-landing.git |
| 部署服务器 | `43.128.4.201` |
| 部署路径 | `/www/tyjx-landing-page` |
| 进程管理 | PM2，进程名：`tyjx-landing`（id: 1） |
| 运行端口 | 8888（Next.js start） |

## 域名配置

### 落地页域名（EdgeOne CDN 回源）

| 域名 | 说明 |
|------|------|
| `luodiye-landing.com` / `*.luodiye-landing.com` | 主落地页域名，EdgeOne 回源用 |
| `luodiye.富油商贸.中国`（国际化：`luodiye.xn--czrr5mo0p1u4a.xn--fiqs8s`） | 备用落地页域名 |
| `luodiye.cniq-trade.asia` | 备用落地页域名 |

### 入口域名

| 域名 | 说明 |
|------|------|
| `tycg1.com` | A 套入口域 |
| `tyapp.app` | A 套入口域 |
| `tyldy.assaoo.asia` | A 套入口域（EdgeOne，替换备案掉的中文域名） |
| `tyrk.moo7818.asia` | B 套入口域（EdgeOne，回源 Host: tyrk-entry.com） |
| `apojwy.app` | 入口域 |

### 中转域名

| 域名 | 说明 |
|------|------|
| `xn--5uss07a.cn`（即 `吃.cn`） | 中转域 |
| `73547.cc` | 中转域 |
| `n1vnhil.asia` | 中转域 |
| `xobagy.app` | 中转域 |

## 架构说明

```
用户 → 入口域（EntryDomain）
     → 中转域（RelayDomain，随机子域名）
     → 落地页域（LandingDomain，发布的具体落地页链接）
```

- 入口/中转/落地域名均由 **tyjx-relay-server**（PM2 id: 5）处理
- 落地页前端静态文件由 **tyjx-landing**（Next.js）提供
- 配置数据由 **tyjx-admin**（PM2 id: 0，端口 8090）管理

## 服务器 PM2 进程

| 进程名 | 说明 | 路径 |
|--------|------|------|
| `tyjx-admin` | 后台管理服务 | `/www/tyjx-admin` |
| `tyjx-landing` | 落地页 Next.js | `/www/tyjx-landing-page` |
| `tyjx-relay-server` | 入口/中转服务 | `/www/tyjx-relay-server` |

## OpenInstall 配置

- AppKey：`ecedok`（构建时通过 `NEXT_PUBLIC_OPENINSTALL_APP_KEY` 注入）
- 逻辑：多 CDN 降级加载 → 点击按钮才显示 loading → SDK 就绪后调用 `wakeupOrInstall()`
- 无超时兜底跳转

## 部署步骤

```bash
# 1. 拉取最新代码
cd /www/tyjx-landing-page
git pull

# 2. 安装依赖（如有变更）
npm install

# 3. 构建
npm run build

# 4. 重启服务
pm2 restart tyjx-landing
```

## Nginx 配置文件

`/etc/nginx/conf.d/tyjx.conf`

## 相关环境变量（`.env.local`）

```
NEXT_PUBLIC_API_AES_KEY=cd35d5733dfe7f9b0ba1affa1a76dd9a4ddb9194ddc3cd38dc8ae08ad6f114b5
NEXT_PUBLIC_OPENINSTALL_APP_KEY=ecedok
NEXT_PUBLIC_SUBDOMAIN_LEN=6
```
