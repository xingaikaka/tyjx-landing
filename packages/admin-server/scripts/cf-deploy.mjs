#!/usr/bin/env node
/**
 * CLI: 部署 / 同步 tyjx-portal Worker。
 *
 *   node scripts/cf-deploy.mjs              # 全量同步
 *   node scripts/cf-deploy.mjs --dry-run    # 仅打印将要做的事
 *
 * 读取顺序:
 *   1) packages/admin-server/.env         (PORTAL_API_SECRET 等共享配置)
 *   2) 命令行参数 / 环境变量              (CLOUDFLARE_API_TOKEN 等)
 *   3) admin-server SQLite                (domains 域池配置 → 路由源数据)
 */

import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fullDeploy, verifyToken, listAllZones, resolveHostsToZones } from '../src/lib/cf-deploy.js';
import { configRepo } from '../src/lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const flag = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(flag)) return a.slice(flag.length);
    if (a === `--${name}`) return true;
  }
  return fallback;
}

async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN || arg('token');
  const accountId =
    process.env.CLOUDFLARE_ACCOUNT_ID || arg('account-id') || '74dcb623526e1925a35e0991a0940f16';
  const adminBaseUrl =
    process.env.CF_WORKER_ADMIN_BASE_URL || arg('admin-base-url') || 'http://43.128.4.201:8889';
  const workerName = process.env.CF_WORKER_NAME || arg('worker-name') || 'tyjx-portal';
  const dryRun = arg('dry-run', false);

  if (!token) {
    console.error('❌ 缺少 CF API Token。请设置 CLOUDFLARE_API_TOKEN 或加 --token=xxx');
    process.exit(1);
  }
  if (!process.env.PORTAL_API_SECRET) {
    console.error('❌ 缺少 PORTAL_API_SECRET(应在 packages/admin-server/.env 里)');
    process.exit(1);
  }

  // 读 worker bundle
  const distPath = path.resolve(ROOT, '../worker/dist/index.js');
  let script;
  try {
    script = await fs.readFile(distPath, 'utf8');
  } catch (e) {
    console.error(`❌ 读不到 worker bundle: ${distPath}\n   先在 packages/worker 下跑 pnpm exec wrangler deploy --dry-run --outdir=dist 生成 bundle。`);
    process.exit(1);
  }

  // 读域池配置
  const domains = configRepo.get('domains', {}) || {};
  const targetHosts = [
    ...(domains.brandDomains || []),
    ...(domains.entryPages || []),
    ...(domains.publishPages || []),
  ];

  console.log('═════ tyjx-portal Worker 部署 ═════');
  console.log(`worker name      : ${workerName}`);
  console.log(`account id       : ${accountId}`);
  console.log(`bundle           : ${distPath} (${script.length} bytes)`);
  console.log(`adminBaseUrl     : ${adminBaseUrl}`);
  console.log(`target hosts(${targetHosts.length}):`);
  targetHosts.slice(0, 20).forEach((h) => console.log(`  - ${h}`));
  if (targetHosts.length > 20) console.log(`  ...${targetHosts.length - 20} more`);
  console.log('');

  if (dryRun) {
    console.log('━━━━━ DRY RUN: 检查 token + 计算 zone 解析 ━━━━━');
    const verify = await verifyToken(token);
    console.log('token verify:', verify);
    const zones = await listAllZones(token);
    console.log(`account 下 zone 总数: ${zones.length}`);
    const r = resolveHostsToZones(targetHosts, zones);
    console.log('将操作的 zones:', r.zones.map((z) => z.name));
    if (r.unknownHosts.length) {
      console.log('⚠️  以下 host 找不到对应 zone(请先把 zone 加到 CF 账号):');
      r.unknownHosts.forEach((h) => console.log(`  - ${h}`));
    }
    return;
  }

  const result = await fullDeploy({
    token,
    accountId,
    workerName,
    script,
    adminBaseUrl,
    portalApiSecret: process.env.PORTAL_API_SECRET,
    runtimeCacheTtl: Number(process.env.RUNTIME_CACHE_TTL || 30),
    targetHosts,
  });

  console.log('\n━━━━━ 部署结果 ━━━━━');
  console.log(JSON.stringify(result.summary, null, 2));
  if (result.summary.unknownHosts?.length) {
    console.log('\n⚠️  以下 host 没有对应 CF zone,路由未绑定:');
    result.summary.unknownHosts.forEach((h) => console.log(`   ${h}`));
    console.log('   先把这些 zone 加到 CF 账号 + 改 NS,再跑一次同步。');
  }
}

main().catch((e) => {
  console.error('\n❌ 部署失败:', e.message);
  if (e.errors) console.error('detail:', JSON.stringify(e.errors, null, 2));
  process.exit(1);
});
