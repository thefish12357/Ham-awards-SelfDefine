/**
 * LoTW（ARRL Logbook of The World）报表拉取
 * ------------------------------------------------------------------
 * 官方接口：GET https://lotw.arrl.org/lotwuser/lotwreport.adi
 * 参数要点（详见 ROADMAP §1.1）：
 *   - login / password / qso_query=1                      必需
 *   - qso_qsl=yes + qso_qslsince=1900-01-01 + qso_qsldetail=yes
 *        只返回**已确认 QSL**，且带 DXCC / COUNTRY / GRID / STATE 等详情
 *   - qso_qsl=no  + qso_qsorxsince=1900-01-01
 *        返回**全部已上传 QSO**，但**不含**上面那些字段
 *   - 日期切分只能用 qso_startdate / qso_enddate
 *   - 失败时返回 HTML 说明页而非 ADIF → 用「缺少 <EOH>」判定
 *
 * 本模块的设计约束：
 *   1. **浏览器不能直连**（LoTW 不返回 CORS 头），必须由服务端代理；
 *   2. **不落盘、不落库**：边下载边解析，只把精简记录交给上层的内存会话；
 *   3. 单批超过 maxBytes 时**自动按日期二分重试**（参考 BetterLoTW 的 12 MiB 经验值），
 *      最多拆 maxDepth 层，且**串行**请求，避免给 ARRL 造成压力。
 */

import { createAdifStreamParser, hasAdifHeaderEnd, looksLikeHtml } from './adif.js';

const LOTW_REPORT_URL = 'https://lotw.arrl.org/lotwuser/lotwreport.adi';
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_START = '1900-01-01';

export class LotwError extends Error {
  constructor(message, { code = 'LOTW_ERROR', httpStatus = 502, detail } = {}) {
    super(message);
    this.name = 'LotwError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = detail;
  }
}

export const validateLotwLogin = (v) => /^[A-Z0-9/]{3,20}$/i.test(String(v || '').trim());

const isDate = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const toMs = (v) => new Date(`${v}T00:00:00Z`).getTime();
const toDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

/** 单条 QSO 的身份键，用于合并 QSL 报表与全量 QSO 报表 */
function qsoKey(rec) {
  if (rec.app_lotw_qso_timestamp) return `ts:${rec.app_lotw_qso_timestamp}`;
  return `k:${rec.call || ''}|${rec.qso_date || ''}|${rec.time_on || ''}|${rec.band || ''}|${rec.mode || ''}`;
}

/**
 * 拉取**单个日期窗口**的报表，解析结果直接推进 collector.records。
 * @returns {Promise<number>} 本批解析出的记录数
 */
async function fetchSingleBatch(collector, opts) {
  const params = new URLSearchParams();
  params.set('login', opts.login);
  params.set('password', opts.password);
  params.set('qso_query', '1');

  if (opts.report === 'qsl') {
    params.set('qso_qsl', 'yes');
    params.set('qso_qslsince', HISTORY_START);
    params.set('qso_qsldetail', 'yes');
  } else {
    params.set('qso_qsl', 'no');
    params.set('qso_qsorxsince', HISTORY_START);
  }
  if (opts.from) params.set('qso_startdate', opts.from);
  if (opts.to) params.set('qso_enddate', opts.to);
  if (opts.ownCall) params.set('qso_owncall', opts.ownCall);
  params.set('qso_withown', 'yes');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  let res;
  let recordCount = 0;
  try {
    try {
      res = await fetch(`${LOTW_REPORT_URL}?${params.toString()}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'HamAwards/2.2 (self-hosted)',
          Accept: 'application/x-arrl-adif, text/plain;q=0.9',
        },
        signal: controller.signal,
      });
    } catch (e) {
      if (e?.name === 'AbortError') {
        throw new LotwError('连接 LoTW 超时，请稍后重试或缩小日期范围', {
          code: 'LOTW_TIMEOUT',
          httpStatus: 504,
        });
      }
      throw new LotwError('无法连接 LoTW，请检查服务器网络', {
        code: 'LOTW_NETWORK',
        httpStatus: 502,
        detail: e?.message,
      });
    }

    if (!res.ok) {
      throw new LotwError(`LoTW 返回 HTTP ${res.status}`, {
        code: 'LOTW_HTTP',
        httpStatus: 502,
        detail: String(res.status),
      });
    }

    const parser = createAdifStreamParser({
      onRecord: (rec) => collector.records.push(rec),
    });
    const decoder = new TextDecoder('utf-8');
    const reader = res.body.getReader();
    let batchBytes = 0;
    let sawEoh = false;
    let head = '';

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        batchBytes += value.byteLength;
        collector.bytes += value.byteLength;

        if (batchBytes > opts.maxBytes) {
          await reader.cancel().catch(() => {});
          throw new LotwError('这一时间段的日志超过单批大小上限，将自动拆分后重试', {
            code: 'LOTW_RANGE_TOO_LARGE',
            httpStatus: 413,
            detail: String(batchBytes),
          });
        }

        const text = decoder.decode(value, { stream: true });
        if (!sawEoh) {
          if (head.length < 4096) head += text.slice(0, 4096 - head.length);
          if (hasAdifHeaderEnd(head)) sawEoh = true;
        }
        parser.push(text);
      }
      recordCount = parser.finish();
    } catch (e) {
      if (e instanceof LotwError) throw e;
      if (e?.name === 'AbortError') {
        throw new LotwError('读取 LoTW 数据超时，请缩小日期范围后重试', {
          code: 'LOTW_TIMEOUT',
          httpStatus: 504,
        });
      }
      throw new LotwError('解析 LoTW 数据失败', {
        code: 'LOTW_PARSE',
        httpStatus: 502,
        detail: e?.message,
      });
    }

    // 没有 ADIF 头结束标记 ⇒ LoTW 返回的是错误说明页（用户名/密码错、账号未激活等）
    // ⚠️ 这里刻意用 400 而不是 401：前端 apiFetch 会把 401 当作「本站登录态失效」并自动登出，
    //    而这里是**上游 LoTW 的凭据不对**，不能把用户踢出本站。
    if (!sawEoh) {
      throw new LotwError('LoTW 没有返回 ADIF 数据，请检查用户名与密码是否正确', {
        code: 'LOTW_AUTH',
        httpStatus: 400,
        detail: looksLikeHtml(head) ? 'html-error-page' : 'missing-eoh',
      });
    }
  } finally {
    clearTimeout(timer);
  }

  return recordCount;
}

/**
 * 带自动二分重试的批次拉取。
 * 单批超过 maxBytes 时把 [from,to] 一分为二，串行重试，最多 maxDepth 层。
 */
async function fetchBatchWithSplit(collector, opts, depth = 0) {
  try {
    const count = await fetchSingleBatch(collector, opts);
    collector.batches.push({
      report: opts.report,
      from: opts.from,
      to: opts.to,
      count,
    });
    return count;
  } catch (e) {
    if (e?.code !== 'LOTW_RANGE_TOO_LARGE' || depth >= opts.maxDepth) throw e;
    if (!isDate(opts.from) || !isDate(opts.to)) throw e;

    const fromMs = toMs(opts.from);
    const toMsVal = toMs(opts.to);
    const days = Math.floor((toMsVal - fromMs) / DAY_MS);
    if (days < 1) throw e; // 已经缩到单日，无法再拆

    const midMs = fromMs + Math.floor(days / 2) * DAY_MS;
    const left = { ...opts, from: toDate(fromMs), to: toDate(midMs) };
    const right = { ...opts, from: toDate(midMs + DAY_MS), to: toDate(toMsVal) };

    // 串行，避免给 LoTW 造成突发压力
    let count = await fetchBatchWithSplit(collector, left, depth + 1);
    count += await fetchBatchWithSplit(collector, right, depth + 1);
    return count;
  }
}

/**
 * 拉取 LoTW 报表并合并去重。
 *
 * @param {object} opts
 * @param {string} opts.login        LoTW 用户名（通常是主呼号）
 * @param {string} opts.password     LoTW 密码（仅在本进程内存中使用，绝不落盘）
 * @param {string} [opts.ownCall]    多呼号账号时筛选本站呼号
 * @param {string} [opts.from]       起始 QSO 日期 YYYY-MM-DD
 * @param {string} [opts.to]         结束 QSO 日期 YYYY-MM-DD
 * @param {boolean} [opts.includeAll] 是否同时拉取「全部 QSO」报表（用来统计总通联数）
 * @param {number} [opts.timeoutMs]  单次上游请求超时
 * @param {number} [opts.maxBytes]   单批字节上限，超了自动二分
 * @param {number} [opts.maxDepth]   最大拆分层数
 */
export async function fetchLotwReports({
  login,
  password,
  ownCall,
  from,
  to,
  includeAll = false,
  timeoutMs = 90_000,
  maxBytes = 12 * 1024 * 1024,
  maxDepth = 6,
}) {
  const range = {
    from: isDate(from) ? from : HISTORY_START,
    to: isDate(to) ? to : today(),
  };
  const base = { login, password, ownCall, timeoutMs, maxBytes, maxDepth, ...range };

  // 1) 已确认 QSL 报表（含 DXCC / STATE / GRID 等，奖状判定主要靠它）
  const qslCollector = { records: [], bytes: 0, batches: [] };
  const qslCount = await fetchBatchWithSplit(qslCollector, { ...base, report: 'qsl' });

  // 2) 可选：全部已上传 QSO 报表（无 DXCC 等字段，仅用于统计总通联数）
  let qsoCollector = { records: [], bytes: 0, batches: [] };
  let qsoCount = 0;
  if (includeAll) {
    qsoCount = await fetchBatchWithSplit(qsoCollector, { ...base, report: 'qso' });
  }

  // 3) 合并：以 QSL 记录为准（字段更全），把未出现在其中的全量 QSO 补进来
  const merged = qslCollector.records.slice();
  const seen = new Set(merged.map(qsoKey));
  let addedFromAll = 0;
  for (const rec of qsoCollector.records) {
    const key = qsoKey(rec);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(rec);
    addedFromAll += 1;
  }

  return {
    records: merged,
    recordCount: merged.length,
    qslCount,
    qsoCount,
    addedFromAll,
    bytes: qslCollector.bytes + qsoCollector.bytes,
    batches: [...qslCollector.batches, ...qsoCollector.batches],
    range,
  };
}

export const LOTW_ENDPOINT = LOTW_REPORT_URL;
