/**
 * Seed 脚本:首次启动 / 手动调用,确保数据库里有:
 *  - 默认管理员账号(从 env ADMIN_DEFAULT_USER/PASSWORD 读)
 *  - 默认 config 配置(domains / portalUI / landing 三条)
 *
 * 已存在的不会被覆盖,可以重复跑。
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import config from '../lib/config.js';
import logger from '../lib/logger.js';
import { configRepo, userRepo } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function seedAdminUser() {
  const exist = userRepo.findByUsername(config.adminDefault.user);
  if (exist) {
    logger.info(`admin user already exists: ${config.adminDefault.user}`);
    return;
  }
  const id = userRepo.create(
    config.adminDefault.user,
    hashPassword(config.adminDefault.password)
  );
  logger.info(
    `admin user created: id=${id} username=${config.adminDefault.user} (default password from env)`
  );
}

function seedConfig() {
  const initialPath = path.resolve(__dirname, 'initial-config.json');
  const initial = JSON.parse(fs.readFileSync(initialPath, 'utf8'));
  for (const key of ['domains', 'portalUI', 'landing']) {
    const exist = configRepo.get(key);
    if (exist) {
      logger.info(`config[${key}] already exists, skip`);
      continue;
    }
    configRepo.set(key, initial[key]);
    logger.info(`config[${key}] seeded`);
  }
}

export function runSeed() {
  seedAdminUser();
  seedConfig();
}

// 命令行直接调用时
if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed();
  logger.info('Seed done.');
  process.exit(0);
}
