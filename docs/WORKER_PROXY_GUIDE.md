# Cloudflare Worker 泛域名代理配置指南

因 Pages 不支持泛域名自定义域，使用 Worker 将 `*.tyjxnf0skf9h.cc` 代理到 Pages 项目。

---

## 一、前置条件

- 域名 `tyjxnf0skf9h.cc` 已添加到 Cloudflare（DNS 由 CF 管理）
- Pages 项目 `tyjx-landing` 已部署，可访问 `tyjx-landing.pages.dev`

---

## 二、创建 Worker

### 步骤 1：进入 Workers

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧菜单选择 **Workers & Pages**
3. 点击 **Create** → **Create Worker**

### 步骤 2：命名并部署

1. 输入名称：`tyjx-landing-proxy`（可自定义）
2. 点击 **Deploy** 创建

### 步骤 3：编辑代码

1. 进入该 Worker 详情页
2. 点击 **Quick Edit** 或 **Edit code**
3. 删除默认代码，粘贴以下内容：

```javascript
const PAGES_URL = 'https://tyjx-landing.pages.dev';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originalHost = request.headers.get('Host') || url.hostname;

    url.hostname = new URL(PAGES_URL).hostname;
    url.protocol = 'https:';

    const newRequest = new Request(url, {
      method: request.method,
      headers: new Headers({
        ...Object.fromEntries(request.headers),
        'Host': new URL(PAGES_URL).hostname,
        'X-Forwarded-Host': originalHost,
      }),
      body: request.body,
      redirect: 'follow',
    });

    return fetch(newRequest);
  },
};
```

4. 点击 **Save and Deploy**

---

## 三、配置路由

### 步骤 1：添加路由

1. 在 Worker 详情页，点击 **Settings** → **Triggers**
2. 在 **Routes** 区域点击 **Add route**

### 步骤 2：填写路由

| 字段 | 值 |
|------|-----|
| **Route** | `*tyjxnf0skf9h.cc/*` |
| **Zone** | 选择 `tyjxnf0skf9h.cc` 所在站点 |

3. 点击 **Save**

### 多个落地页域名

若有多个落地页根域（如 `tyjxlh2wyxr9.cc`），继续添加：

- `*tyjxlh2wyxr9.cc/*`
- `*tyjxhotpzixm.cc/*`

---

## 四、配置 DNS

1. 进入 **Websites** → 选择 `tyjxnf0skf9h.cc` → **DNS** → **Records**
2. 添加记录：

| 类型 | 名称 | 目标 | 代理状态 |
|------|------|------|----------|
| CNAME | `*` | `tyjxnf0skf9h.cc` | 已代理（橙色云） |

若根域 `tyjxnf0skf9h.cc` 已有记录，`*` 会匹配所有子域。子域请求会先到 CF，再由 Worker 路由处理。

---

## 五、验证

1. 访问 `https://任意子域.tyjxnf0skf9h.cc/`（如 `https://test123.tyjxnf0skf9h.cc/`）
2. 应显示落地页（地址发布页）

---

## 六、注意事项

- **Pages 域名**：若 Pages 项目 URL 不是 `tyjx-landing.pages.dev`，请修改 Worker 代码中的 `PAGES_URL`
- **新增落地页域名**：在 Worker 路由中再添加一条 `*新域名/*` 即可
- **index.js**：项目已支持 `X-Forwarded-Host`，Worker 透传的原始 Host 会被正确识别
