/**
 * 实物材料类型（收集要素）
 * ------------------------------------------------------------------
 * 2026-09-24 扩展。参照「通联中国学校业余电台奖状（WCSA, wcsa.ac.cn）」的收集要素口径，
 * 除了常规 **QSL 卡片**，还要能提交两类"非 QSO"凭证：
 *
 *   qsl_card —— 常规 QSO 的 QSL 卡片。**只有这一种**参与「实物卡片确认」判定：
 *               管理员审核通过后，会按填写的呼号/波段/模式/日期匹配该用户的 QSO
 *               并写 `qsl_rcvd='Y'`（`awardEngine` 的 `qslRequired` 读的就是它）。
 *   eyeball  —— Eyeball QSL（Hamfest / 见面时当面交换的卡片）。**不是 QSO**，
 *               因此没有日志可匹配，只作为收集要素留档（WCSA 的「Eyeball QSL 特别奖」要 3 张）。
 *   swl      —— SWL 收听报告 / 收听证明（收听台收听到某次通联的凭证）。本站没有收听记录，
 *               同样不参与 QSO 匹配，只作收集要素留档（WCSA 的「SWL 特别奖」要 5 次收听）。
 *
 * 前后端必须保持一致：后端白名单见 `server/routes/evidence.js` 的 `EVIDENCE_TYPES`。
 */

export const EVIDENCE_TYPES = [
  {
    value: 'qsl_card',
    label: 'QSL 卡片（QSO）',
    short: 'QSO 卡',
    hint: '常规通联后交换的卡片。审核通过会自动把匹配的日志标记为「已确认」。',
  },
  {
    value: 'eyeball',
    label: 'Eyeball 卡（当面交换）',
    short: 'Eyeball',
    hint: '当面交换（眼球/火腿节）拿到的卡片，不属于通联，因此不会匹配日志，只作为收集凭证。',
  },
  {
    value: 'swl',
    label: 'SWL 收听报告',
    short: 'SWL',
    hint: '收听台（SWL）收听到某次通联的收听报告 / 收听证明，同样不匹配日志，只作为收集凭证。',
  },
];

/**
 * 时区选项（2026-09-24 新增）
 * ------------------------------------------------------------------
 * 表单里"日期 + 时间"按**所选时区**填写（卡片上印的一般是 UTC，但国内爱好者
 * 常按北京时间抄），提交时统一换算成 **UTC** 再入库：
 *   · 入库字段 `match_date`（UTC 日期）+ `match_time`（UTC HHMM）+ `match_tz_offset`（填写时用的偏移，仅用于展示）；
 *   · **日志匹配与校验一律用 UTC**，不受用户选择影响。
 */
export const TZ_OPTIONS = [
  { value: '0', label: 'UTC（默认）', offset: 0 },
  { value: '480', label: 'BJT 北京时间（UTC+8）', offset: 480 },
  { value: '540', label: 'JST 日本（UTC+9）', offset: 540 },
  { value: '600', label: 'AEST 澳洲东部（UTC+10）', offset: 600 },
  { value: '-300', label: '美东（UTC-5）', offset: -300 },
  { value: '-480', label: '美西（UTC-8）', offset: -480 },
];

export const tzOffsetOf = (value) => {
  const hit = TZ_OPTIONS.find((t) => t.value === String(value));
  return hit ? hit.offset : 0;
};

const pad = (n) => String(n).padStart(2, '0');

/**
 * 把「某时区下的日期 + 时间」换算成 UTC。
 * @param {string} date   YYYY-MM-DD（用户所在时区的日期）
 * @param {string} time   HH:MM（可空，空按 00:00 算）
 * @param {number} offsetMinutes 该时区相对 UTC 的偏移（BJT = +480）
 * @returns {{date:string, time:string, ok:boolean}} UTC 的 YYYY-MM-DD 与 HHMM（4 位）
 */
export const toUtcDateTime = (date, time, offsetMinutes = 0) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return { date: '', time: '', ok: false };
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = /^\d{2}:\d{2}$/.test(String(time || '')) ? time.split(':').map(Number) : [0, 0];
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - Number(offsetMinutes || 0) * 60000;
  const dt = new Date(utcMs);
  if (Number.isNaN(dt.getTime())) return { date: '', time: '', ok: false };
  return {
    date: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
    time: `${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}`,
    ok: true,
  };
};

const BY_VALUE = Object.fromEntries(EVIDENCE_TYPES.map((t) => [t.value, t]));

/** 取类型元信息（未知类型回落到 QSO 卡片，避免老数据渲染报错） */
export const evidenceType = (value) => BY_VALUE[value] || BY_VALUE.qsl_card;

/** 类型中文名 */
export const evidenceTypeLabel = (value) => evidenceType(value).label;
