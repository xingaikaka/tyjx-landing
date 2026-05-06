/**
 * 视频处理:MP4 → AES-128 加密 HLS(m3u8 + ts) + 首帧 poster
 *
 * 与 dp/tyjx-admin/server/src/lib/video-store.js 完全对齐:
 *   1. ffmpeg 用 -hls_key_info_file 输出 AES-128-CBC 加密的 .ts 分片
 *   2. m3u8 内 #EXT-X-KEY URI 写假地址 https://key.noaccess.invalid/video-key/<id>
 *      → 上传到 R2/CDN 的 m3u8 看着是合法的,但 CDN 拿不到真 key 解不了 ts
 *   3. 真 16B raw key 用 lib/video-key-store.js 加密落本地(永远不上 R2)
 *   4. 客户端通过 admin /api/portal/m3u8/:id 代理拉真 m3u8(KEY URI 改写为同源真接口)
 *      hls.js 默认 keyloader 拿到 key → 解密 ts → 播放
 *   5. 统一走 lib/storage.js (R2 + STORAGE_KEY_PREFIX 自动隔离)
 *
 * ffmpeg 关键参数(与 dp 一致):
 *   - libx264 / profile=high / level=4.0 / pix_fmt=yuv420p
 *     ↳ 解决 Android WebView (含 Telegram) 黑屏:不指定时 10-bit 源会输出 high10,
 *       Android MediaCodec 大多数硬解器不支持
 *   - format=yuv420p 滤镜 + 显式 -profile / -pix_fmt 双保险
 *   - movflags +faststart 让 mp4 元数据前置(HLS 用不到,留作 fallback)
 *
 * 使用:
 *   const { id, playbackUrl, posterUrl, duration, segmentCount, prefix }
 *     = await processMp4ToHls(mp4Buffer)
 *
 * playbackUrl 是 R2/CDN 的 m3u8 URL(里面是假 KEY URI),
 * 客户端**不要直接喂给 hls.js**,要先走代理:
 *   /api/portal/m3u8/<id>
 */

import { mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import logger from './logger.js';
import { putMany, put } from './storage.js';
import { saveKey as saveVideoKey } from './video-key-store.js';
import { encryptAsset } from './asset-crypto.js';

/** m3u8 内 #EXT-X-KEY URI 的假主机(必须和 dp 一致,否则前端 xhrSetup 替换不到) */
export const FAKE_KEY_HOST = 'https://key.noaccess.invalid';

const execFileAsync = promisify(execFile);

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const candidates = [
    '/opt/homebrew/bin/ffmpeg',     // macOS Apple Silicon
    '/usr/local/bin/ffmpeg',        // Linux & macOS Intel
    '/usr/bin/ffmpeg',              // Linux 系统包
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return 'ffmpeg'; // 看 $PATH
}

const FFMPEG = resolveFfmpeg();

/**
 * @param {Buffer} mp4Buffer
 * @returns {Promise<{
 *   id: string,             // 32-hex video id
 *   playbackUrl: string,    // R2/CDN 上的 m3u8 URL(含假 KEY URI,客户端别直连)
 *   posterUrl: string,      // 首帧 jpg URL
 *   duration: number,       // 秒(整数)
 *   segmentCount: number,
 *   prefix: string,         // 存储前缀(已含 STORAGE_KEY_PREFIX)
 *   posterKey: string,
 *   backend: 'local'|'r2',
 * }>}
 */
export async function processMp4ToHls(mp4Buffer) {
  const id = randomUUID().replace(/-/g, '');
  const workDir = join(tmpdir(), `tyjx-video-${id}`);
  await mkdir(workDir, { recursive: true });

  try {
    const inputFile = join(workDir, 'input.mp4');
    const outputM3u8 = join(workDir, 'index.m3u8');
    const segPattern = join(workDir, 'seg_%03d.ts');
    const thumbFile = join(workDir, 'poster.jpg');

    await writeFile(inputFile, mp4Buffer);

    // 1. 生成 16 字节 AES-128 raw key + ffmpeg keyinfo
    //
    //   keyinfo 格式(三行,最后一行可空):
    //     <m3u8 内要写的假 URI>     ← 上传 R2 后这一行写入 m3u8 的 #EXT-X-KEY
    //     <ffmpeg 读真 key 的本地文件路径>
    //     <可选 IV hex,缺省 ffmpeg 自动生成>
    //
    //   ffmpeg 用第二行的本地文件加密 ts;m3u8 里只会写第一行的 URI(假地址)。
    const rawKey = randomBytes(16);
    const localKeyFile = join(workDir, 'aes.key');
    const keyInfoFile = join(workDir, 'keyinfo');
    const fakeKeyUri = `${FAKE_KEY_HOST}/video-key/${id}`;
    await writeFile(localKeyFile, rawKey);
    await writeFile(keyInfoFile, `${fakeKeyUri}\n${localKeyFile}\n`);

    // 2. 转 HLS(AES-128 加密)
    logger.info(`[video] ffmpeg HLS start id=${id} (AES-128)`);
    await execFileAsync(FFMPEG, [
      '-i', inputFile,
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level', '4.0',
      '-pix_fmt', 'yuv420p',
      '-crf', '26',
      '-preset', 'fast',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-ar', '44100',
      '-ac', '2',
      '-movflags', '+faststart',
      '-hls_time', '6',
      '-hls_key_info_file', keyInfoFile,
      '-hls_segment_filename', segPattern,
      '-hls_playlist_type', 'vod',
      '-hls_list_size', '0',
      outputM3u8,
    ]);

    // 3. 截首帧
    let posterBuf = null;
    try {
      await execFileAsync(FFMPEG, [
        '-i', inputFile,
        '-ss', '00:00:00.1',
        '-vframes', '1',
        '-q:v', '2',
        '-f', 'image2',
        thumbFile,
      ]);
      posterBuf = await readFile(thumbFile);
    } catch (e) {
      logger.warn('[video] poster extraction failed:', e?.message ?? e);
    }

    // 4. 收集所有产物(只要 m3u8 + ts,不要 keyinfo / aes.key / poster.jpg)
    const files = (await readdir(workDir)).filter(
      (f) => f === 'index.m3u8' || f.endsWith('.ts')
    );
    if (!files.includes('index.m3u8')) {
      throw new Error('ffmpeg did not produce index.m3u8');
    }

    const m3u8Content = await readFile(outputM3u8, 'utf-8');

    // 校验:m3u8 应包含假 KEY URI,如果没看到说明 ffmpeg 没启用加密(参数错误)
    if (!m3u8Content.includes(FAKE_KEY_HOST)) {
      throw new Error(
        '[video] ffmpeg did not write #EXT-X-KEY (encryption may be disabled)'
      );
    }

    // 4. 上传 ts → 上传 m3u8(顺序很重要,m3u8 最后,避免播放器拉到不完整索引)
    //
    // 注意:put() 会自动加 STORAGE_KEY_PREFIX(例 'tyjx/'),
    // 所以传入相对 key 'video-assets/<id>/seg_001.ts',返回值里的 key 才是
    // 真正的落地 key 'tyjx/video-assets/<id>/seg_001.ts'。
    // 删除时要按返回 key(或 prefix)来定位,否则会找不到。
    const relPrefix = `video-assets/${id}/`;
    const tsItems = await Promise.all(
      files
        .filter((f) => f.endsWith('.ts'))
        .map(async (f) => ({
          key: `${relPrefix}${f}`,
          buffer: await readFile(join(workDir, f)),
          mime: 'video/mp2t',
          cacheControl: 'public, max-age=31536000, immutable',
        }))
    );

    const tsResults = await putMany(tsItems);

    // m3u8 文件单独传(最后),Cache-Control 短一点(便于以后改字幕等)
    const m3u8Result = await put(
      `${relPrefix}index.m3u8`,
      Buffer.from(m3u8Content, 'utf-8'),
      'application/vnd.apple.mpegurl',
      { cacheControl: 'public, max-age=300' }
    );

    // 实际落地的 prefix(可能含 KEY_PREFIX,例 'tyjx/video-assets/<id>/')
    const prefix = m3u8Result.key.replace(/index\.m3u8$/, '');

    // 5. 保存真实 raw key(本地加密落盘,不上 R2)
    //    ffmpeg 已经用过 localKeyFile 加密完 ts,这步只是把 16B 转储到 video-keys/<id>.enckey
    await saveVideoKey(id, rawKey);

    // 6. 上传 poster(同图片一样走加密上传)
    let posterUrl = '';
    let posterKey = '';
    if (posterBuf) {
      const pName = `poster-${id}.jpg.enc`;
      const encPoster = encryptAsset(posterBuf);
      const r = await put(`uploads/${pName}`, encPoster, 'application/octet-stream', {
        cacheControl: 'public, max-age=31536000, immutable',
      });
      posterUrl = r.url;
      posterKey = r.key;
    }

    // 7. 统计
    const segmentCount = tsItems.length;
    const durations = [...m3u8Content.matchAll(/#EXTINF:([\d.]+)/g)].map((m) =>
      parseFloat(m[1])
    );
    const duration = Math.round(durations.reduce((a, b) => a + b, 0));

    logger.info(
      `[video] HLS done id=${id} segs=${segmentCount} dur=${duration}s poster=${posterUrl ? 'ok' : 'no'} (encrypted)`
    );

    return {
      id,
      playbackUrl: m3u8Result.url,
      posterUrl,
      posterKey,
      duration,
      segmentCount,
      prefix,
      backend: m3u8Result.backend,
      tsKeys: tsResults.map((r) => r.key),
    };
  } finally {
    // 清临时目录(包含 keyinfo + aes.key 这种敏感文件,务必删干净)
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
