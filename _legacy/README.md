# Legacy 代码(已废弃)

本目录是 **tyjx-landing v1**(基于 Cloudflare Pages + Pages Functions)的代码归档。

**v2** 已重构为多包 monorepo:

- `packages/worker/`     — 替代 `_legacy/functions/`(改用 CF Worker)
- `packages/admin-server/` — 新增,管理后台
- `packages/admin-web/`   — 新增,管理前端
- `../luodiye_video/`     — 真落地页(独立项目)

## 此目录内容

| 文件/目录 | 原作用 | v2 替代方案 |
|---|---|---|
| `functions/` | CF Pages Functions(`/Web/GetDomainList` `/Web/GetJumpURL2` `entry.js` `index.js`)| `packages/worker/src/handlers/` |
| `public/` | CF Pages 静态资源 + `index.html`(发布页 UI) | `packages/worker/src/templates/`(HTML 模板字符串) |
| `wrangler.toml` | Pages 配置 | `packages/worker/wrangler.toml`(Worker 配置) |
| `deploy.sh` | Pages 部署脚本 | `pnpm deploy:worker` |
| `scripts/` | 域池生成等小脚本 | 迁移到 `admin-server` 或废弃 |
| `CF_DEPLOY_GUIDE.md` | Pages 部署指南 | `docs/deployment.md` |
| `WORKER_PROXY_GUIDE.md` | Worker 代理指南 | 整合到架构文档 |
| `README-old.md` | v1 README | 保留作历史参考 |

## 上线后处置

- v2 部署稳定 1 个月后,本目录可删除
- 在删除前如果 v2 出现重大问题,可参考此处快速回滚到 v1
