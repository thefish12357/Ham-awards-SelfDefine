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

/** 进度日志用的格式化助手（只影响展示文案，不参与任何判定） */
const fmtBytes = (n) => {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};
const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');

/**
 * 安全触发进度回调：回调里抛错绝不能影响真正的拉取流程（进度只是观感）。
 */
const emitProgress = (fn, ev) => {
  if (typeof fn !== 'function') return;
  try {
    fn(ev);
  } catch {
    /* 忽略 */
  }
};

/**
 * 从 ADIF 头（`<EOH>` 之前那段）抽取可展示的元数据。
 *
 * ⚠️ 只用于日志展示：**字段不存在就不显示，绝不臆造数值**。
 *    LoTW 报表头里「记录总数」并非所有版本/所有报表都有，因此它只作为
 *    「进度百分比」的可选分母 —— 没有时前端退化为「已解析 N 条 · 已接收 X MB」。
 */
const parseHeaderMeta = (head) => {
  const fields = {};
  const re = /<([A-Za-z0-9_]+):(\d+)(?::[A-Za-z])?>([^<]*)/g;
  let m;
  while ((m = re.exec(head)) !== null) {
    fields[m[1].toUpperCase()] = m[3].substring(0, Number(m[2])).trim();
  }
  let numRec = 0;
  for (const [k, v] of Object.entries(fields)) {
    if (/(NUMREC|NUM_REC|RECORD_COUNT|QSO_COUNT|TOTAL_RECORDS)/.test(k) && /^\d+$/.test(v)) {
      numRec = Number(v);
      break;
    }
  }
  return {
    adifVer: fields.ADIF_VER || '',
    programId: fields.PROGRAMID || fields.PROGRAM_ID || '',
    created: fields.CREATED_TIMESTAMP || '',
    numRec,
  };
};

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
  const reportLabel = opts.report === 'qsl' ? '已确认 QSL' : '全部 QSO';
  const emit = (msg, level = 'info', progress) => emitProgress(opts.onProgress, { msg, level, progress });

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

  const rangeText =
    opts.from || opts.to ? `${opts.from || HISTORY_START} ~ ${opts.to || today()}` : `全部历史（${HISTORY_START} 起）`;
  emit(`请求 LoTW ${reportLabel} 报表（区间 ${rangeText}）`, 'info');

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
      emit(`LoTW 返回 HTTP ${res.status}，无法读取报表`, 'error');
      throw new LotwError(`LoTW 返回 HTTP ${res.status}`, {
        code: 'LOTW_HTTP',
        httpStatus: 502,
        detail: String(res.status),
      });
    }

    emit(`已连接 LoTW（HTTP ${res.status}），开始接收 ${reportLabel} 数据`, 'ok');

    const parser = createAdifStreamParser({
      onRecord: (rec) => collector.records.push(rec),
    });
    const decoder = new TextDecoder('utf-8');
    const reader = res.body.getReader();
    let batchBytes = 0;
    let sawEoh = false;
    let head = '';
    // 进度节流：每 500ms 或每 500 条才推一次，避免几十万条时把事件表刷爆
    const startedAt = Date.now();
    let lastEmitAt = 0;
    let lastEmitCount = 0;
    let batchTotal = 0;

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        batchBytes += value.byteLength;
        collector.bytes += value.byteLength;

        if (batchBytes > opts.maxBytes) {
          await reader.cancel().catch(() => {});
          emit(`本批已超过 ${fmtBytes(opts.maxBytes)} 上限，将按日期二分重试`, 'warn');
          throw new LotwError('这一时间段的日志超过单批大小上限，将自动拆分后重试', {
            code: 'LOTW_RANGE_TOO_LARGE',
            httpStatus: 413,
            detail: String(batchBytes),
          });
        }

        const text = decoder.decode(value, { stream: true });
        if (!sawEoh) {
          if (head.length < 4096) head += text.slice(0, 4096 - head.length);
          if (hasAdifHeaderEnd(head)) {
            sawEoh = true;
            const pos = head.search(/<eoh>/i);
            emit(`找到 ADIF 头结束标记 <EOH>（位置 ${pos} 字节）`, 'ok');
            const meta = parseHeaderMeta(head);
            const bits = [];
            if (meta.adifVer) bits.push(`ADIF_VER=${meta.adifVer}`);
            if (meta.programId) bits.push(`PROGRAMID=${meta.programId}`);
            if (meta.created) bits.push(`创建于 ${meta.created}`);
            if (bits.length) emit(`解析 ADIF 头元数据：${bits.join(' · ')}`);
            if (meta.numRec > 0) {
              batchTotal = meta.numRec;
              emit(`头中记录数：${fmtNum(meta.numRec)} 条`, 'ok');
            }
            emit('头处理完毕，开始解析 QSO 记录…', 'ok');
          }
        }
        parser.push(text);

        const n = parser.recordCount;
        const elapsed = Date.now() - startedAt;
        if (n !== lastEmitCount && (elapsed - lastEmitAt >= 500 || n - lastEmitCount >= 500)) {
          lastEmitAt = elapsed;
          lastEmitCount = n;
          const pct = batchTotal > 0 ? Math.min(100, (n / batchTotal) * 100) : null;
          emit(
            `已解析 ${fmtNum(n)}${batchTotal > 0 ? ` / ${fmtNum(batchTotal)}` : ''} 条` +
              `${pct != null ? `（${pct.toFixed(1)}%）` : ''} · 已接收 ${fmtBytes(batchBytes)}`,
            'progress',
            {
              done: n,
              total: batchTotal || null,
              pct: pct == null ? null : Number(pct.toFixed(1)),
              bytes: collector.bytes,
              label: reportLabel,
            },
          );
        }
      }
      recordCount = parser.finish();
      // 只有真的拿到 ADIF 头才算「本批完成」；否则下面会按凭据错误抛错，
      // 先报一句「完成 0 条」会让人误以为读取成功了。
      if (sawEoh) {
        emit(
          `本批解析完成：${fmtNum(recordCount)} 条 · 用时 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`,
          'ok',
        );
      }
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
      emit(
        looksLikeHtml(head)
          ? 'LoTW 返回的是网页而不是 ADIF —— 通常是用户名/密码不正确，或账号尚未激活'
          : '数据里没有 ADIF 头 <EOH>，LoTW 返回的内容无法识别',
        'error',
      );
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

    emitProgress(opts.onProgress, {
      msg: `区间过大，按日期二分重试（第 ${depth + 1} 层）：${left.from} ~ ${left.to} ｜ ${right.from} ~ ${right.to}`,
      level: 'warn',
    });

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
  onProgress,
}) {
  const range = {
    from: isDate(from) ? from : HISTORY_START,
    to: isDate(to) ? to : today(),
  };
  const base = { login, password, ownCall, timeoutMs, maxBytes, maxDepth, onProgress, ...range };

  emitProgress(onProgress, {
    msg: `开始读取 LoTW 日志（${range.from} ~ ${range.to}${includeAll ? '，含全部 QSO 报表' : ''}）`,
    level: 'info',
  });

  // 1) 已确认 QSL 报表（含 DXCC / STATE / GRID 等，奖状判定主要靠它）
  const qslCollector = { records: [], bytes: 0, batches: [] };
  const qslCount = await fetchBatchWithSplit(qslCollector, { ...base, report: 'qsl' });
  emitProgress(onProgress, { msg: `已确认 QSL 报表读取完成：${fmtNum(qslCount)} 条`, level: 'ok' });

  // 2) 可选：全部已上传 QSO 报表（无 DXCC 等字段，仅用于统计总通联数）
  let qsoCollector = { records: [], bytes: 0, batches: [] };
  let qsoCount = 0;
  if (includeAll) {
    emitProgress(onProgress, { msg: '继续读取「全部 QSO」报表（仅用于统计总通联数）…', level: 'info' });
    qsoCount = await fetchBatchWithSplit(qsoCollector, { ...base, report: 'qso' });
    emitProgress(onProgress, { msg: `全部 QSO 报表读取完成：${fmtNum(qsoCount)} 条`, level: 'ok' });
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

  emitProgress(onProgress, {
    msg:
      `合并去重完成：共 ${fmtNum(merged.length)} 条待判定记录` +
      `（QSL ${fmtNum(qslCount)} 条${includeAll ? `，全量报表补充 ${fmtNum(addedFromAll)} 条` : ''}）`,
    level: 'ok',
  });

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
