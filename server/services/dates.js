/**
 * 服务端日期边界校验（2026-09-24）
 * ------------------------------------------------------------------
 * 背景：前端 `<input type="date">` 是浏览器原生控件，**年份段允许超过 4 位**
 * （Chrome 上限 275760），用户能输成「111111-11-11」。而这两处的下游都很隐蔽：
 *   - 奖状规则的 `startDate` / `endDate` → `awardEngine` 拿 QSO 日期与它们做
 *     **字符串比较**，年份错位会让所有日志判不过（或反过来全部放行），且毫无报错；
 *   - 实物材料的 `match_date` → 会被当作日志日期入库（匹配不到就自动补建一条），
 *     一个荒唐的年份就会在用户日志里留下垃圾记录。
 * 因此服务端必须**显式校验并返回 400**，不能只信任前端。
 *
 * ⚠️ 规则与前端 `src/lib/dateInput.js` 保持一致：那边先拦一道是为了即时反馈，
 *    这边是兜底（旧客户端、直接调接口都绕不过）。改规则记得两处同步。
 */

/** 可选日期下界：业余无线电与 LoTW 的历史起点，早于此必是误输入 */
export const DATE_MIN = '1900-01-01';

/** 仅用于「允许计划到未来」的场景（奖状规则的有效期） */
export const DATE_FAR_MAX = '2100-12-31';

/** 今天的 YYYY-MM-DD（UTC 口径，服务端统一用 UTC 比较字符串） */
export const todayUtc = () => new Date().toISOString().slice(0, 10);

/**
 * 今天偏移若干天的 UTC 日期。
 * 用途：给「已经发生的事」算上界时留 1 天余量 —— 用户在 UTC-11 等时区提交，
 * 本地日期换算成 UTC 后可能「跨到明天」，卡死成今天会误伤。
 */
export const utcDateOffset = (days = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** 严格 YYYY-MM-DD：年份**正好 4 位**，且是真实存在的日期（2023-02-30 不算） */
export const isStrictDate = (v) => {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * 校验单个日期字段（空值默认放行，除非 required）。
 * @returns {string|null} 错误信息；null = 通过
 */
export const validateDate = (v, label, { min = DATE_MIN, max = DATE_FAR_MAX, required = false } = {}) => {
  const s = String(v ?? '').trim();
  if (!s) return required ? `请填写${label}` : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${label}的年份必须是 4 位数字（如 2026-09-24）`;
  if (!isStrictDate(s)) return `${label}不是一个真实存在的日期`;
  if (min && s < min) return `${label}不能早于 ${min}`;
  if (max && s > max) return `${label}不能晚于 ${max}`;
  return null;
};

/**
 * 校验奖状规则里的有效期（`rules.basic.startDate` / `endDate`，均可不填）。
 * 允许计划到未来，所以上界用 DATE_FAR_MAX 而不是今天。
 * @returns {string|null} 错误信息；null = 通过
 */
export const validateRulesDateRange = (rules) => {
  const basic = (rules && rules.basic) || {};
  const a = validateDate(basic.startDate, '开始日期');
  if (a) return a;
  const b = validateDate(basic.endDate, '结束日期');
  if (b) return b;
  if (basic.startDate && basic.endDate && String(basic.startDate) > String(basic.endDate)) {
    return '开始日期不能晚于结束日期';
  }
  return null;
};
