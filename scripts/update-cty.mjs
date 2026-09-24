/**
 * 同步最新 cty.dat（DXCC 前缀库）到 data/cty.dat
 * ------------------------------------------------------------------
 * 官方源：https://www.country-files.com/cty/cty.dat
 *   （Jim Reisert AD1C / N9JIM 维护，被 FLDigi/WSJT-X/JTDX/N1MM/DXKeeper 共用，
 *     DXCC 实体变更时上游会更新）
 *
 * 用法：
 *   node scripts/update-cty.mjs            # 仅当内容变化时更新
 *   node scripts/update-cty.mjs --force    # 忽略 hash 差异，强制覆盖
 *   node scripts/update-cty.mjs --check    # 只报告是否需要更新，不写盘
 *
 * 注意：
 *   - 仅在内容 sha256 真正变化时才写盘（避免无意义改动 + git 噪声）。
 *   - 写盘后**已运行的后端不会自动生效**：要么重启 `node server.js`，
 *     要么调用后台接口 `POST /api/admin/cty/refresh`（该接口会重新解析并热加载）。
 *   - 本项目是 Node，用本脚本即可，无需 article 里的 .bat。
 */
import { syncCtyFromWeb, CTY_URL } from '../server/services/cty.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const checkOnly = args.includes('--check');

async function main() {
  console.log(`来源: ${CTY_URL}`);
  if (checkOnly) {
    const res = await fetch(CTY_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const { createHash } = await import('node:crypto');
    const remoteSha = createHash('sha256').update(buf).digest('hex').slice(0, 12);
    console.log(`远程版本 sha256(截前12): ${remoteSha}`);
    console.log('如需更新，运行：node scripts/update-cty.mjs');
    return;
  }

  const result = await syncCtyFromWeb({ force });
  if (result.updated) {
    console.log(`✅ 已更新 data/cty.dat — 实体 ${result.stats.entities} / 前缀 ${result.stats.prefixes} / 已映射 DXCC ${result.stats.dxccMapped}`);
    console.log('若后端已在运行：重启或调用 POST /api/admin/cty/refresh 以热加载。');
  } else {
    console.log(`ℹ️  已是最新（${result.reason}），无需更新。实体 ${result.stats.entities} / 前缀 ${result.stats.prefixes}`);
  }
}

main().catch((e) => {
  console.error('❌ 同步失败:', e.message);
  process.exit(1);
});
