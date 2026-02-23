# Cloudflare 操作步骤指南

按顺序在 Cloudflare Dashboard 中完成以下操作。

---

## 一、连接 GitHub 并创建项目

### 1. 进入 Workers & Pages

1. 打开 https://dash.cloudflare.com
2. 左侧菜单点击 **Workers & Pages**
3. 点击 **Create** 按钮
4. 选择 **Pages**
5. 选择 **Connect to Git**

### 2. 连接 GitHub 仓库

1. 点击 **Connect GitHub**
2. 若未授权，按提示完成 GitHub 授权
3. 选择账号 **xingaikaka**
4. 选择仓库 **tyjx-landing**
5. 点击 **Begin setup**

### 3. 配置构建

| 配置项 | 填写内容 |
|--------|----------|
| **Project name** | `tyjx-landing`（可保持默认） |
| **Production branch** | `master` |
| **Build command** | 留空 |
| **Build output directory** | `public` |

点击 **Save and Deploy**，等待首次部署完成（约 1–2 分钟）。

---

## 二、配置环境变量

> 说明：此项目使用 wrangler.toml 管理明文变量，**仅 Secret（API_SECRET）可在 Dashboard 添加**。

### 1. Dashboard 添加 API_SECRET（Secret）

1. 项目页 → **Settings** → **Variables and Secrets**
2. 点击 **+添加**（配置 API 令牌和运行时变量）
3. **类型** 选择 **密钥**（Secret）
4. **变量名称** 填 `API_SECRET`
5. **值** 填你的 32 字节密钥，如 `your-32-byte-secret-key!!`
6. 点击 **保存**

> 该值必须与 `public/index.html` 中的 `API_SECRET` 一致。

### 2. wrangler.toml 配置明文变量

编辑项目根目录的 `wrangler.toml`，在 `[vars]` 下配置：

```toml
[vars]
JUMP_DOMAINS = "tyjxnf0skf9h.cc,tyjxlh2wyxr9.cc,tyjxhotpzixm.cc"
# 可选：
# ENTRY_JUMP_URL = "https://xxx.tyjxnf0skf9h.cc"
# ALLOWED_ORIGINS = "https://tyjxnf0skf9h.cc"
```

修改后提交并推送到 GitHub 触发重新部署。

### 3. 使环境变量生效

环境变量修改后需重新部署：

1. 点击顶部 **Deployments**
2. 找到最新部署，点击右侧 **⋯**（三个点）
3. 选择 **Retry deployment**

或推送一次新提交到 GitHub 触发自动部署。

---

## 三、绑定自定义域名

### 1. 进入域名设置

1. 项目页点击 **Custom domains**
2. 点击 **Set up a custom domain**

### 2. 绑定主入口（tyjx.app）

1. 输入 `tyjx.app`，点击 **Continue**
2. 若域名在 Cloudflare：
   - 通常会自动添加 CNAME 记录
   - 等待 SSL 证书签发（约 1–5 分钟）
3. 若域名不在 Cloudflare：
   - 按提示在域名注册商处添加 CNAME
   - 名称：`@`（根域）或 `tyjx`
   - 目标：`tyjx-landing.pages.dev`（以实际显示为准）

### 3. 绑定备用入口（tycg.app）

重复上述步骤，输入 `tycg.app`。

### 4. 绑定泛域名（*.tyjxnf0skf9h.cc）

1. **Set up a custom domain** → 输入 `tyjxnf0skf9h.cc`（先绑定根域）
2. 再添加 `*.tyjxnf0skf9h.cc`（泛域名）
3. 在域名 DNS 中添加：
   - `tyjxnf0skf9h.cc` → CNAME → `tyjx-landing.pages.dev`
   - `*` → CNAME → `tyjxnf0skf9h.cc` 或 `tyjx-landing.pages.dev`

---

## 四、修改前端密钥（重要）

部署前需确保 `public/index.html` 中的 `API_SECRET` 与 CF 环境变量一致：

1. 编辑 `public/index.html`
2. 找到 `const API_SECRET = '...'`
3. 改为与 Dashboard 中 `API_SECRET` 相同的值
4. 提交并推送到 GitHub，触发重新部署

---

## 五、操作流程速览

```
1. Workers & Pages → Create → Pages → Connect to Git
2. 选择 tyjx-landing 仓库
3. Build command 留空，Build output directory 填 public
4. Save and Deploy
5. Settings → Environment variables → 添加 API_SECRET、JUMP_DOMAINS
6. Deployments → Retry deployment
7. Custom domains → 绑定 tyjx.app、tycg.app、*.xxx.cc
8. 修改 index.html 中的 API_SECRET 并推送
```

---

## 六、访问地址

- 默认：`https://tyjx-landing.pages.dev`
- 自定义域名：`https://tyjx.app`、`https://tycg.app`
- 入口跳转：`https://tyjx.app/entry`
