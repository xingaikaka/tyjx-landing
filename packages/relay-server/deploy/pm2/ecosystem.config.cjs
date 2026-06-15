/**
 * tyjx-portal-server PM2 配置(tyjx.app 中转层,跑在 VPS)
 *
 * 命名:
 *   - 进程名 tyjx-portal-server,避开已存在的 tyjx-relay-server(tyapp.app 用,在 :3030)
 *   - 端口 3020,与 tyjxapp-admin(:3010) / tyjx-relay-server(:3030)三向不冲突
 *
 * 部署假设:
 *   /opt/tyjx-portal-server/                            代码 checkout(独立目录,不在 monorepo 里)
 *   /opt/tyjx-portal-server/.env                        生产真值(dotenv 自动加载)
 *   /var/log/pm2/                                       PM2 日志
 *
 * 启动:
 *   pm2 start /opt/tyjx-portal-server/deploy/pm2/ecosystem.config.cjs
 *   pm2 save
 *
 * 升级:
 *   rsync 新代码到 /opt/tyjx-portal-server/
 *   pm2 reload tyjx-portal-server
 *
 * 文件名为 *.config.cjs(不是 *.cjs)是有意的:
 *   PM2 v6 看到 *.cjs 会当成脚本直接 node 执行,而不是当作 ecosystem 配置加载;
 *   带 .config 后缀就能正确识别为配置文件。
 */

module.exports = {
  apps: [
    {
      name: 'tyjx-portal-server',
      script: 'src/index.js',
      cwd: '/opt/tyjx-portal-server',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        // 业务真值见 .env(PORT / HOST / ADMIN_BASE_URL / PORTAL_API_SECRET / ...)
      },
      error_file: '/var/log/pm2/tyjx-portal-server.err.log',
      out_file: '/var/log/pm2/tyjx-portal-server.out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
