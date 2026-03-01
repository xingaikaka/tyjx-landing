/**
 * 获取图2 页面域名列表 API - GET /Web/GetDomainList
 * 返回 STEP2_DOMAINS（最新地址）、fallbackDomain、entryDomains，全部从环境变量获取
 */

import { parseDomains, shuffle } from '../_shared/utils.js';

export async function onRequestGet(context) {
  const { env } = context;
  const step2List = parseDomains(env.STEP2_DOMAINS, 20);
  const domains = shuffle(step2List);
  const fallbackDomain = step2List[0] || '';
  const entryList = parseDomains(env.ENTRY_DOMAINS, 10);

  return new Response(
    JSON.stringify({
      code: 0,
      data: {
        domains,
        fallbackDomain,
        entryDomains: entryList,
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
}
