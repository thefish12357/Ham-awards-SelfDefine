/**
 * LoTW 连接进度任务（**仅进程内存**）
 * ------------------------------------------------------------------
 * 需求：读 LoTW 日志是「长时间阻塞」的操作（几十万条时能跑几分钟），
 *      旧实现前端只能干等着，用户不知道卡在哪一步。
 *      这里把「拉取 → 解析 → 建会话」变成一个可观察的后台任务：
 *      进度事件逐条累积，前端轮询拿增量，渲染成终端日志。
 *
 * 为什么不用 SSE：凭据（LoTW 用户名/密码）必须放在 POST 请求体里，
 *   `EventSource` 只能发 GET、参数只能进 URL —— 账号密码会进服务器 access log。
 *   所以选择「POST 建任务 + 轮询进度」，凭据始终不进 URL/日志。
 *
 * 为什么不用 Redis：进度是**高频写入 + 秒级过期**的纯展示数据，
 *   写 Redis 既浪费又拖慢解析循环。它是「这一个进程正在干这件事」的镜像，
 *   跨实例无意义（多实例时轮询落到别的节点会显示"没有进行中的任务"，
 *   前端会退化成"等待中"，不会出错）。
 *
 * 数据留存边界：事件里**只有过程描述**（字节数、条数、区间），
 *   不含 QSO 内容、不含凭据；任务结果里的会话信息与 /api/lotw/session 一致。
 */

import crypto from 'crypto';

const TTL_MS = 10 * 60 * 1000; // 任务（含日志与结果）保留 10 分钟，够用户回看
const MAX_EVENTS = 800; // 单任务事件上限，超出丢最旧的
const MAX_JOBS = 50; // 同时存在的任务上限，防被刷爆内存

/** jobId -> job */
const jobs = new Map();

const now = () => Date.now();

function sweep() {
  const t = now();
  for (const [id, job] of jobs) {
    if (job.expiresAt <= t) jobs.delete(id);
  }
}

// 每分钟清理过期任务
setInterval(sweep, 60 * 1000).unref();

/** 新建任务（同一用户只保留最新一个） */
export function createJob(userId) {
  sweep();
  for (const [id, job] of jobs) {
    if (job.userId === userId) jobs.delete(id);
  }
  if (jobs.size >= MAX_JOBS) {
    // 淘汰最旧的：优先已完成/失败的，其次按创建时间
    const sorted = [...jobs.values()].sort((a, b) => {
      const aDone = a.status !== 'running' ? 0 : 1;
      const bDone = b.status !== 'running' ? 0 : 1;
      if (aDone !== bDone) return aDone - bDone;
      return a.createdAt - b.createdAt;
    });
    for (const victim of sorted) {
      if (jobs.size < MAX_JOBS) break;
      jobs.delete(victim.jobId);
    }
  }
  const job = {
    jobId: crypto.randomBytes(16).toString('hex'),
    userId,
    status: 'running', // running | done | error
    seq: 0,
    events: [],
    progress: null, // { done, total, pct, bytes, label }
    result: null,
    error: null,
    createdAt: now(),
    expiresAt: now() + TTL_MS,
  };
  jobs.set(job.jobId, job);
  return job;
}

/**
 * 追加一条进度事件。
 * @param {object} job
 * @param {{msg:string, level?:'info'|'ok'|'warn'|'error'|'progress', progress?:object}} ev
 */
export function appendEvent(job, ev) {
  if (!job || job.status !== 'running' || !ev || !ev.msg) return;
  job.seq += 1;
  job.events.push({
    seq: job.seq,
    at: now(),
    level: ev.level || 'info',
    msg: String(ev.msg),
  });
  if (ev.progress) job.progress = ev.progress;
  if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS);
  job.expiresAt = now() + TTL_MS;
}

/** 任务成功完成，保存前端需要的最终结果 */
export function finishJob(job, result) {
  if (!job) return;
  job.status = 'done';
  job.result = result || null;
  job.expiresAt = now() + TTL_MS;
}

/** 任务失败 */
export function failJob(job, error) {
  if (!job) return;
  job.status = 'error';
  job.error = error || { message: '读取 LoTW 日志失败' };
  job.expiresAt = now() + TTL_MS;
}

/** 按 id 取任务并校验归属 */
export function getJob(jobId, userId) {
  if (!jobId) return null;
  const job = jobs.get(String(jobId));
  if (!job) return null;
  if (job.expiresAt <= now()) {
    jobs.delete(job.jobId);
    return null;
  }
  if (userId != null && job.userId !== userId) return null;
  return job;
}

/**
 * 取该用户最近的任务（含已完成）。
 * 用途：前端刷新页面后 jobId 丢了，可据此把终端日志接回来。
 */
export function getLatestJob(userId) {
  let found = null;
  for (const job of jobs.values()) {
    if (job.userId !== userId) continue;
    if (job.expiresAt <= now()) continue;
    if (!found || job.createdAt > found.createdAt) found = job;
  }
  return found;
}

/**
 * 序列化成给前端的形状。
 * @param {object} job
 * @param {number} since 只返回 seq > since 的事件（增量轮询）
 */
export function describeJob(job, since = 0) {
  if (!job) return { status: 'none' };
  const from = Number(since) || 0;
  return {
    status: job.status,
    jobId: job.jobId,
    seq: job.seq,
    // 前端按 seq 去重，丢过最旧事件也不影响
    events: job.events.filter((e) => e.seq > from),
    progress: job.progress,
    result: job.status === 'done' ? job.result : null,
    error: job.status === 'error' ? job.error : null,
  };
}

/** 仅供测试/自检 */
export const __jobCount = () => jobs.size;
export const __clearAll = () => jobs.clear();
