/**
 * 日期输入的**统一约束与校验**（2026-09-24）
 * ------------------------------------------------------------------
 * 为什么单独抽一个模块：`<input type="date">` 是浏览器原生控件，**年份段允许超过 4 位**
 * （Chrome 上限 275760），用户在实物材料、奖状规则里都能输成「111111-11-11」。
 * 而这两处的下游后果都很隐蔽：
 *   - 实物材料：`toUtcDateTime()` 对非 4 位年份返回 `ok:false`，调用点会**静默丢掉日期**
 *     不提交 → 审核端显示「没填通联日期」，用户以为功能坏了；
 *   - 奖状规则：`awardEngine` 用**字符串比较**过滤日期，填错年份会让所有 QSO 判不过
 *     （或者反过来全部放行），没有任何报错。
 * 所以所有日期输入必须：
 *   1. 带 `min`/`max`（浏览器会直接把年份卡在 4 位，日历选择器也会禁用越界日期）；
 *   2. 提交前再校验一次并给出中文原因（粘贴 / 脚本赋值 / 老数据回填都绕不过）。
 * 组件封装见 `src/components/DateInput.jsx`；后端在 `server.js` / `server/routes/evidence.js`
 * 各有一份等价的边界校验（服务端不能 import 本文件）。
 */

/** 可选日期的下界：业余无线电与 LoTW 的历史起点，早于此必是误输入 */
export const DATE_MIN = '1900-01-01';

/**
 * 可选日期的上界（仅用于**允许计划未来**的场景，如奖状规则的有效期）。
 * 实物材料 / QSO / LoTW 日志是「已经发生的事」，上界应取**今天**。
 */
export const DATE_FAR_MAX = '2100-12-31';

/** 今天（本地日期的 YYYY-MM-DD，与 `<input type="date">` 的取值格式一致） */
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 严格 YYYY-MM-DD：年份**正好 4 位**，且是真实存在的日期（如 2023-02-30 不算） */
export const isStrictDate = (v) => {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * 校验单个日期输入。
 * @param {string} v 输入值（空串/undefined 视为「未填」）
 * @param {string} label 用于提示的中文名，如「通联日期」
 * @param {{min?:string,max?:string,required?:boolean}} [opts]
 * @returns {string|null} 错误信息；null = 通过
 */
export const validateDateInput = (v, label = '日期', opts = {}) => {
  const { min = DATE_MIN, max = todayStr(), required = false } = opts;
  const s = String(v ?? '').trim();
  if (!s) return required ? `请填写${label}` : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${label}的年份必须是 4 位数字（如 2026-09-24），请用输入框里的日历图标选择`;
  }
  if (!isStrictDate(s)) return `${label}不是一个真实存在的日期`;
  if (min && s < min) return `${label}不能早于 ${min}`;
  if (max && s > max) return `${label}不能晚于 ${max}`;
  return null;
};

/**
 * 校验一段日期区间（顺带检查起止顺序）。比较用字符串即可：ISO 日期天然按字典序排序。
 * @returns {string|null} 错误信息；null = 通过
 */
export const validateDateRangeInput = (from, to, opts = {}) => {
  const {
    fromLabel = '起始日期',
    toLabel = '结束日期',
    ...rest
  } = opts;
  const a = validateDateInput(from, fromLabel, rest);
  if (a) return a;
  const b = validateDateInput(to, toLabel, rest);
  if (b) return b;
  if (from && to && String(from) > String(to)) return `${fromLabel}不能晚于${toLabel}`;
  return null;
};
