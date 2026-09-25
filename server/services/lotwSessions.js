/**
 * LoTW 临时会话（**绝不落盘 / 落库**，多实例安全）
 * ------------------------------------------------------------------
 * 需求：用户可以不上传日志，直接把 LoTW 的日志读进来申请奖状，但
 *      「读取的日志在用户关闭界面后就删除，也不能保存在服务器上」。
 *
 * 落实手段：
 *   1. 只存在 TTL 存储里（配 REDIS_URL 走 Redis，否则内存回退），进程重启即全清；
 *   2. 每条会话带 TTL（默认 30 分钟），到期由存储自动淘汰；
 *   3. 单用户同时只保留一个会话，新会话覆盖旧会话；
 *   4. 前端关闭/切走页面时用 sendBeacon 主动通知删除；
 *   5. 整个存储有总容量上限，超限拒绝新建，避免被刷爆内存。
 *
 * ⚠️ 这里存的是**精简后的 ADIF 字段对象**，不存原始 ADIF 文本。
 *
 * 与旧版区别：原本用进程内存 Map，多实例部署时节点间互不可见（用户登录态 /
 * 临时日志在节点间丢失）。现统一走 server/services/sessionStore.js，配了
 * REDIS_URL 即多实例共享，未配则内存回退（单实例 / 本地开发行为不变）。
 */

import crypto from 'crypto';
import { createTtlStore } from './sessionStore.js';

const store = createTtlStore('lotw:session');

const defaults = {
  ttlMs: 30 * 60 * 1000, // 30 分钟
  maxTotalBytes: 64 * 1024 * 1024, // 所有会话合计的「已下载 ADIF 字节数」上限
};

let config = { ...defaults };

export function configureLotwSessions(next = {}) {
  if (Number.isFinite(next.ttlMs) && next.ttlMs > 0) config.ttlMs = next.ttlMs;
  if (Number.isFinite(next.maxTotalBytes) && next.maxTotalBytes > 0) {
    config.maxTotalBytes = next.maxTotalBytes;
  }
}

export const getLotwSessionConfig = () => ({ ...config });

// 每分钟扫描一次：内存回退时顺手清掉过期项释放内存；Redis 后端 TTL 自动淘汰（扫描即为 no-op）。
setInterval(async () => {
  try {
    await store.scan();
  } catch {
    /* 忽略 */
  }
}, 60 * 1000).unref();

/**
 * 建立会话。同一 userId 的旧会话会被删除（单会话策略）。
 * @throws 容量超限时抛错，由上层转成 507 / 413
 */
export async function createSession(userId, data) {
  const now = Date.now();
  const all = await store.scan();

  let usedBytes = 0;
  let oldKey = null;
  for (const { key, value } of all) {
    usedBytes += value.bytes || 0;
    if (value.userId === userId) oldKey = key;
  }
  if (oldKey) await store.del(oldKey);

  if (usedBytes + (data.bytes || 0) > config.maxTotalBytes) {
    const err = new Error('服务端临时日志容量已满，请稍后重试或先清除其他会话');
    err.code = 'LOTW_CAPACITY';
    throw err;
  }

  const sessionId = crypto.randomBytes(32).toString('hex');
  const session = {
    sessionId,
    userId,
    records: data.records || [],
    recordCount: (data.records || []).length,
    qslCount: data.qslCount || 0,
    qsoCount: data.qsoCount || 0,
    bytes: data.bytes || 0,
    range: data.range || null,
    includeAll: !!data.includeAll,
    createdAt: now,
    expiresAt: now + config.ttlMs,
  };
  await store.set(sessionId, session, config.ttlMs);
  return session;
}

/** 取会话，并校验归属。过期/不存在返回 null。 */
export async function getSession(sessionId, userId) {
  if (!sessionId) return null;
  const s = await store.get(sessionId);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    await store.del(sessionId);
    return null;
  }
  if (userId != null && s.userId !== userId) return null;
  return s;
}

/**
 * 取该用户当前的会话（单会话策略下最多一个）。
 * 用途：前端刷新页面后 sessionId 丢失，可用它把会话状态捞回来。
 */
export async function getSessionForUser(userId) {
  const all = await store.scan();
  const now = Date.now();
  let found = null;
  for (const { value } of all) {
    if (value.userId === userId && value.expiresAt > now) found = value;
  }
  return found;
}

/**
 * 按 sessionId 直接取（不校验归属）。
 * 仅供「携凭据清除」用：sessionId 本身是随机不可猜的，作为 capability token 使用。
 */
export async function getSessionByCapability(sessionId) {
  return getSession(sessionId, null);
}

export async function deleteSession(sessionId) {
  return store.del(sessionId);
}

export async function deleteUserSessions(userId) {
  const all = await store.scan();
  let n = 0;
  for (const { key, value } of all) {
    if (value.userId === userId) {
      await store.del(key);
      n += 1;
    }
  }
  return n;
}

/** 给接口回给前端的公开信息（绝不包含 records） */
export function describeSession(session) {
  if (!session) return { active: false };
  return {
    active: true,
    sessionId: session.sessionId,
    recordCount: session.recordCount,
    qslCount: session.qslCount,
    qsoCount: session.qsoCount,
    bytes: session.bytes,
    includeAll: session.includeAll,
    range: session.range,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    remainingMs: Math.max(0, session.expiresAt - Date.now()),
  };
}

export async function sessionStats() {
  const all = await store.scan();
  let bytes = 0;
  for (const { value } of all) bytes += value.bytes || 0;
  return {
    sessionCount: all.length,
    bytes,
    maxTotalBytes: config.maxTotalBytes,
    ttlMs: config.ttlMs,
  };
}

/** 仅供测试/自检使用 */
export const __pruneForTest = async () => {
  await store.scan();
};
