/**
 * PM2 启动配置(放在 43.128.4.201 上跑)
 *
 * 目录约定:
 *   /opt/tyjx-landing/                       monorepo checkout
 *   /opt/tyjx-landing/packages/admin-server  本服务对应位置
 *   /var/log/pm2/                            pm2 日志输出
 *   /opt/tyjx-data/admin/                    SQLite + 上传媒体(在 .env 里指)
 *
 * 启动:
 *   pm2 start /opt/tyjx-landing/deploy/pm2/ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup systemd     # 一次性,跟着输出的命令执行
 */

module.exports = {
  apps: [
    {
      name: 'tyjx-admin-server',
      script: 'src/index.js',
      cwd: '/opt/tyjx-landing/packages/admin-server',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        // .env 由 admin-server 自己读 dotenv 加载,不在这里写敏感信息
      },
      error_file: '/var/log/pm2/tyjx-admin-server.err.log',
      out_file: '/var/log/pm2/tyjx-admin-server.out.log',
      merge_logs: true,
      time: true,
    },
  ],
}
