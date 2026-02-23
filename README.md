# 天涯精选 - 落地页

基于 Cloudflare Pages + Functions 的域名发布落地页，使用 Web Crypto API 加密通信。

---

## 一、整体逻辑

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户访问流程                                     │
└─────────────────────────────────────────────────────────────────────────────┘

  主入口 (tyjx.app / tycg.app)              泛域名落地页 (*.xxx.cc)
           │                                        │
           │  ① GET /entry                          │
           │  ────────────────────────────────────►│
           │                                        │
           │  ② 返回跳转 HTML                        │
           │  (meta refresh + window.location)      │
           │  ◄────────────────────────────────────│
           │                                        │
           │  ③ 浏览器跳转                           │
           │  ────────────────────────────────────►│
           │                                        │
           │                                        │  ④ 加载 index.html
           │                                        │  ⑤ POST /Web/GetJumpURL2
           │                                        │     Body: 加密 { Domain }
           │                                        │  ◄──────────────────────
           │                                        │  ⑥ 返回加密 { jumpDomains }
           │                                        │  ──────────────────────►
           │                                        │
           │                                        │  ⑦ 前端解密 → 展示地址
           │                                        │  ⑧ 用户复制 → 访问主站
           │                                        │
```

### 三个核心路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 静态页 index.html，地址发布页 |
| `/entry` | GET | 入口跳转页，返回 meta+JS 跳转 |
| `/Web/GetJumpURL2` | POST | 加密 API，返回可复制地址 |

### 加解密流程

```
请求: { Domain: "a1b2c3d4.cc" }
  → 前端 CryptoJS 加密
  → POST 密文
  → Functions Web Crypto 解密
  → 生成随机子域 URL
  → 加密响应
  → 前端解密 → 填充按钮
```

---

## 二、项目结构

```
tyjx-landing/
├── functions/
│   ├── _shared/
│   │   ├── crypto.js      # Web Crypto 加解密
│   │   └── utils.js       # generateSubdomain, parseDomains
│   ├── Web/
│   │   └── GetJumpURL2.js # API
│   └── entry.js           # 入口跳转
├── public/
│   ├── _routes.json       # 仅上述路由走 Function，其余走静态
│   ├── index.html
│   └── assets/js/
│       └── crypto-util.js # 前端加密（CryptoJS）
├── package.json
├── wrangler.toml
└── .dev.vars.example
```

---

## 三、Cloudflare Pages 部署详解

### 3.1 前置要求

- [Cloudflare 账号](https://dash.cloudflare.com/sign-up)
- [Node.js](https://nodejs.org)（用于运行 Wrangler）

### 3.2 方式一：Wrangler 命令行部署（推荐）

本项目包含 Pages Functions，**推荐使用 Wrangler**，可完整部署静态页 + API + 入口跳转。

**快速命令**：

```bash
wrangler login
wrangler pages project create tyjx-landing   # 首次
wrangler pages deploy public --project-name=tyjx-landing
```

#### 步骤 1：安装 Wrangler

```bash
npm install -g wrangler
```

或使用 npx（无需全局安装）：

```bash
npx wrangler --version
```

#### 步骤 2：登录 Cloudflare

```bash
wrangler login
```

浏览器会打开，按提示完成授权。

#### 步骤 3：创建项目（首次）

```bash
cd /path/to/app-landing-page
wrangler pages project create tyjx-landing
```

按提示输入项目名（如 `tyjx-landing`）和 Production branch（如 `main`）。

#### 步骤 4：部署

在项目根目录执行：

```bash
npm run deploy
# 或使用部署脚本（含检查与提示）
./deploy.sh
```

首次部署可使用脚本自动创建项目：

```bash
./deploy.sh --create
```

**注意**：必须在项目根目录执行，Wrangler 会自动识别同级的 `functions/` 目录并一并部署。

#### 步骤 5：配置环境变量

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages**
2. 选择项目 `tyjx-landing`
3. **Settings** → **Environment variables**
4. 添加变量（见下方「环境变量」章节）

#### 步骤 6：重新部署使环境变量生效

修改环境变量后，需重新部署：

```bash
wrangler pages deploy public --project-name=tyjx-landing
```

---

### 3.3 方式二：Dashboard 手动复制/拖拽上传

通过 Cloudflare Dashboard 拖拽上传文件，无需安装 Wrangler。

#### 步骤 1：创建项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. **Workers & Pages** → **Create** → **Pages**
3. 选择 **Direct Upload**（直接上传）
4. 输入项目名 `tyjx-landing`，点击 **Create project**

#### 步骤 2：准备上传文件

将 `public` 目录下的**所有文件**打成 zip，或直接拖拽整个 `public` 文件夹。

需包含：
- `index.html`
- `_routes.json`
- `assets/` 目录（含 `js/crypto-util.js`）

#### 步骤 3：上传并部署

1. 在项目页点击 **Create deployment**
2. 选择 **Production**
3. 将 `public` 文件夹或 zip 拖入上传区域
4. 点击 **Save and Deploy**

#### ⚠️ 重要限制

**Dashboard 拖拽上传不支持 Pages Functions**。使用此方式部署后：

- ✅ 静态页 `index.html` 可访问
- ❌ `/Web/GetJumpURL2` API 不可用，页面会显示「获取失败」
- ❌ `/entry` 入口跳转不可用

若需要完整的 API 和入口跳转功能，请使用 **方式一（Wrangler）** 部署。

---

### 3.4 方式三：通过 Git 连接部署（可选）

若使用 GitHub，可配置推送后自动部署：

1. Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 选择仓库，配置 **Build command** 留空，**Build output directory** 填 `public`
3. 点击 **Save and Deploy**
4. **Settings** → **Environment variables** 添加变量（见 3.7 节）

### 3.5 绑定自定义域名

#### 主入口域名（tyjx.app、tycg.app）

1. 项目 → **Custom domains** → **Set up a custom domain**
2. 输入 `tyjx.app`，按提示在域名注册商处添加 CNAME：
   - 类型：`CNAME`
   - 名称：`@` 或 `tyjx`
   - 目标：`<project>.pages.dev`（如 `tyjx-landing.pages.dev`）
3. 若域名在 Cloudflare 解析，通常会自动添加记录
4. 等待 SSL 证书签发（约 1–5 分钟）

#### 泛域名（*.tyjxnf0skf9h.cc 等）

1. **Custom domains** → **Set up a custom domain**
2. 输入 `tyjxnf0skf9h.cc`（先绑定根域）
3. 再添加 `*.tyjxnf0skf9h.cc`（泛域名）
4. 在域名 DNS 中添加：
   - `tyjxnf0skf9h.cc` → CNAME → `<project>.pages.dev`
   - `*` → CNAME → `<project>.pages.dev` 或 `tyjxnf0skf9h.cc`

**Cloudflare DNS 泛解析**：名称填 `*`，目标填 `tyjxnf0skf9h.cc` 或 Pages 提供的 CNAME。

### 3.6 关键文件说明

| 文件 | 作用 |
|------|------|
| `public/_routes.json` | 指定哪些路径由 Functions 处理，其余走静态资源 |
| `functions/` | Pages Functions 代码，自动识别并部署 |
| `wrangler.toml` | Wrangler 配置，`pages_build_output_dir` 指向 `public` |

**`_routes.json` 示例**：

```json
{
  "version": 1,
  "include": ["/Web/GetJumpURL2", "/entry", "/entry/"],
  "exclude": []
}
```

仅 `include` 中的路径会触发 Functions，其他请求返回静态文件。

### 3.7 环境变量配置（Dashboard）

无论用哪种方式部署，环境变量均在 Dashboard 配置：

1. 项目 → **Settings** → **Environment variables**
2. 选择 **Production**，点击 **Add variable**
3. 按需添加：

| 变量名 | 类型 | 值 | 必填 |
|--------|------|-----|------|
| `API_SECRET` | **Secret** | 32 字节密钥，如 `your-32-byte-secret-key!!` | 是 |
| `JUMP_DOMAINS` | Plain text | 泛域名，逗号分隔，如 `tyjxnf0skf9h.cc,tyjxlh2wyxr9.cc,tyjxhotpzixm.cc` | 是 |
| `ENTRY_JUMP_URL` | Plain text | 入口固定跳转地址（可选） | 否 |
| `ALLOWED_ORIGINS` | Plain text | 允许的 Origin，逗号分隔（可选） | 否 |

**注意**：`API_SECRET` 必须与 `public/index.html` 中的 `API_SECRET` 完全一致。

4. 添加后点击 **Save**，修改后需重新部署一次

### 3.8 域名规划示例

| 域名 | 用途 |
|------|------|
| tyjx.app | 主入口，用户访问 `/entry` 跳转 |
| tycg.app | 备用入口 |
| *.tyjxnf0skf9h.cc | 泛域名落地页 1 |
| *.tyjxlh2wyxr9.cc | 泛域名落地页 2 |
| *.tyjxhotpzixm.cc | 泛域名落地页 3 |

### 3.9 常见问题

| 问题 | 排查 |
|------|------|
| 页面显示「获取失败」 | 检查 API_SECRET 是否与 index.html 一致；检查 JUMP_DOMAINS 是否配置 |
| 环境变量不生效 | 添加变量后需重新部署（Retry deployment 或推送新提交） |
| 泛域名无法访问 | 确认 DNS 已添加 `*` 的 CNAME 记录；CF 中已添加 `*.xxx.cc` 自定义域名 |
| 本地 8788 端口被占用 | 使用 `wrangler pages dev public --port=8888` 指定其他端口 |

### 3.10 其他说明

**主入口与落地页分离**：主入口（tyjx.app）可在 DNS 配置 302 重定向到泛域名（如 `https://xxx.tyjxnf0skf9h.cc`），落地页单独部署本仓库到 CF Pages。

---

## 四、本地开发

### 4.1 配置环境变量

```bash
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`，填入与生产一致的值：

```
API_SECRET=your-32-byte-secret-key!!
JUMP_DOMAINS=tyjxnf0skf9h.cc,tyjxlh2wyxr9.cc,tyjxhotpzixm.cc
```

**注意**：`API_SECRET` 必须与 `public/index.html` 中的 `API_SECRET` 一致。

### 4.2 启动本地服务

```bash
npm run dev
```

访问 http://localhost:8788

### 4.3 修改前端密钥

部署前需同步修改 `public/index.html` 中的 `API_SECRET`，与 `.dev.vars` 及 CF 环境变量保持一致。

---

## 五、环境变量详解

| 变量 | 必填 | 类型 | 说明 |
|------|------|------|------|
| API_SECRET | 是 | Secret | 32 字节密钥，前后端必须一致，用于 AES 加解密 |
| JUMP_DOMAINS | 是 | Plain text | 泛域名列表，逗号分隔，如 `a.cc,b.cc,c.cc` |
| ENTRY_JUMP_URL | 否 | Plain text | 入口页固定跳转地址，不设则随机生成 |
| ALLOWED_ORIGINS | 否 | Plain text | 允许的 Origin，逗号分隔，空则不校验 |

---

## 六、技术栈

- **运行时**：Cloudflare Workers (V8)
- **加密**：Web Crypto API (AES-256-CBC)
- **前端**：原生 JS + CryptoJS CDN
