/**
 * LoTW 临时会话（**纯内存，绝不落盘 / 落库**）
 * ------------------------------------------------------------------
 * 需求：用户可以不上传日志，直接把 LoTW 的日志读进来申请奖状，但
 *      「读取的日志在用户关闭界面后就删除，也不能保存在服务器上」。
 *
 * 落实手段：
 *   1. 只存在进程内存里，进程重启即全清；
 *   2. 每条会话带 TTL（默认 30 分钟），到期由定时器清除；
 *   3. 单用户同时只保留一个会话，新会话覆盖旧会话；
 *   4. 前端关闭/切走页面时用 sendBeacon 主动通知删除；
 *   5. 整个 Map 有总容量上限，超限拒绝新建，避免被刷爆内存。
 *
 * ⚠️ 这里存的是**精简后的 ADIF 字段对象**，不存原始 ADIF 文本。
 */

import crypto from 'crypto';

const sessions = new Map(); // sessionId -> session

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

/** 当前所有会话占用的字节数（按下载到的 ADIF 原文长度计） */
function totalBytes() {
  let sum = 0;
  for (const s of sessions.values()) sum += s.bytes;
  return sum;
}

function prune(now = Date.now()) {
  let removed = 0;
  for (const [id, s] of sessions) {
    if (s.expiresAt <= now) {
      sessions.delete(id);
      removed += 1;
    }
  }
  return removed;
}

// 每分钟清理一次；unref 避免定时器拖住进程退出
setInterval(() => prune(), 60 * 1000).unref();

/**
 * 建立会话。同一 userId 的旧会话会被删除（单会话策略）。
 * @throws 容量超限时抛错，由上层转成 507 / 413
 */
export function createSession(userId, data) {
  const now = Date.now();
  prune(now);

  for (const [id, s] of sessions) {
    if (s.userId === userId) sessions.delete(id);
  }

  if (totalBytes() + data.bytes > config.maxTotalBytes) {
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
    lastAccess: now,
    expiresAt: now + config.ttlMs,
  };
  sessions.set(sessionId, session);
  return session;
}

/** 取会话，并校验归属。过期/不存在返回 null。 */
export function getSession(sessionId, userId) {
  if (!sessionId) return null;
  const s = sessions.get(sessionId);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  if (userId != null && s.userId !== userId) return null;
  s.lastAccess = Date.now();
  return s;
}

/**
 * 取该用户当前的会话（单会话策略下最多一个）。
 * 用途：前端刷新页面后 sessionId 丢失，可用它把会话状态捞回来。
 */
export function getSessionForUser(userId) {
  const now = Date.now();
  prune(now);
  let found = null;
  for (const s of sessions.values()) {
    if (s.userId === userId) found = s;
  }
  if (found) found.lastAccess = now;
  return found;
}

/**
 * 按 sessionId 直接取（不校验归属）。
 * 仅供「携凭据清除」用：sessionId 本身是随机不可猜的，作为 capability token 使用。
 */
export function getSessionByCapability(sessionId) {
  const s = getSession(sessionId, null);
  return s;
}

export function deleteSession(sessionId) {
  return sessions.delete(sessionId);
}

export function deleteUserSessions(userId) {
  let n = 0;
  for (const [id, s] of sessions) {
    if (s.userId === userId) {
      sessions.delete(id);
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

export function sessionStats() {
  prune();
  return {
    sessionCount: sessions.size,
    bytes: totalBytes(),
    maxTotalBytes: config.maxTotalBytes,
    ttlMs: config.ttlMs,
  };
}

/** 仅供测试/自检使用 */
export const __pruneForTest = prune;
