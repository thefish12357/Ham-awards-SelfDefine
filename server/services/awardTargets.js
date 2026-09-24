/**
 * 奖状「目标对象」类型规格与清单校验（2026-09-24）
 * ------------------------------------------------------------------
 * 起因：规则设计器的目标清单输入框**不管选哪种类型都提示「例如: BA1AA, BA4AA…」**，
 * 于是有人在「特定 DXCC 实体」下填了呼号（BG5UWQ/BI3WW/BH7CSA）。引擎比较的是
 * `qso.dxcc`（实体**编号**，如 318），跟呼号永远不可能相等：
 *   进度恒为 0 / N、明细全红，而且**没有任何报错** —— 用户只能得出"进度与明细未知"。
 *
 * 所以这里把「每种目标类型到底该填什么」写成唯一规格，供三处使用：
 *   1. `awardEngine.js` 产出 `warnings`（解释"为什么是 0"）；
 *   2. `POST /api/awards` 保存前校验，格式不符直接 400；
 *   3. 前端 `src/lib/awardTargets.js` 有等价实现（placeholder / 即时提示 / 保存前拦截）。
 * ⚠️ 改这里必须同步改前端那份，否则会出现"前端能存、后端拒绝"的错位。
 */

const parseList = (list) =>
  String(list || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s);

/**
 * 各目标类型的规格。
 *  - `label`    中文名（错误提示与表头用）
 *  - `re`       合法条目格式（**必须**与 `awardEngine.getTargetValue` 的取值方式一致）
 *  - `hint`     该填什么
 *  - `fixHint`  填错时最可能的纠正方式（用于引导改类型）
 *  - `example`  示例（前端 placeholder 兜底）
 */
export const TARGET_SPECS = {
  callsign: {
    label: '呼号',
    re: /^[A-Z0-9/]{3,}$/,
    hint: '填对方呼号，如 BA1AA、BG5UWQ（与日志里的「对方呼号」等值比较）',
    fixHint: '如果想按 DXCC 实体收集，请把「目标对象类型」改成「特定 DXCC 实体」',
    example: 'BA1AA, BG5UWQ',
  },
  dxcc: {
    label: 'DXCC 实体编号',
    re: /^\d{1,3}$/,
    hint: 'DXCC 是实体编号（318=中国、291=美国、339=日本…），不是呼号',
    fixHint: '如果你是想按呼号收集，请把「目标对象类型」改成「特定呼号列表」',
    example: '318, 291, 339',
  },
  grid: {
    label: '网格',
    re: /^[A-Z]{2}\d{2}$/,
    hint: '网格取前 4 位，如 PM95、QN10',
    fixHint: '如果日志里的网格字段为空，可重新上传日志或直连 LoTW 补全',
    example: 'PM95, QN10',
  },
  iota: {
    label: 'IOTA 编号',
    re: /^[A-Z]{2}-\d{3}$/,
    hint: 'IOTA 编号形如 AS-007',
    fixHint: '请核对 IOTA 编号写法（两位地区码 + 短横线 + 三位数字）',
    example: 'AS-007',
  },
  state: {
    label: '州/省代码',
    re: /^[A-Z]{1,3}$/,
    hint: '州/省代码形如 CA、TX',
    fixHint: '请填 ADIF 里的州/省代码（1~3 位字母）',
    example: 'CA, TX',
  },
  district: {
    label: '呼号分区',
    re: /^[0-9]$/,
    hint: '取中国 B 字头呼号里紧跟前缀的那一位数字：BY1AA→1、BG5UWQ→5、BH7CSA→7',
    fixHint: '国外呼号（JA1ABC / K1ABC）里的数字不是中国区号、不会计入；想按整呼号收集请选「特定呼号列表」',
    example: '0,1,2,3,4,5,6,7,8,9',
  },
};

/** 引擎里的目标值是从日志的哪个字段取的（用于"日志缺该字段"的提示） */
export const TARGET_FIELD_HINTS = {
  callsign: '对方呼号 callsign',
  dxcc: 'DXCC 编号 dxcc',
  grid: '网格格网 gridsquare',
  iota: 'IOTA 编号 iota',
  state: '州/省 state',
  district: '中国呼号（B 字头）里的区号数字',
};

export const parseTargetList = parseList;

/**
 * 校验目标清单格式。
 * @param {string} type `rules.targets.type`
 * @param {string} listText `rules.targets.list`（逗号分隔）
 * @returns {string|null} 错误信息；null = 通过（空清单 = 不限制，与引擎行为一致）
 */
export const validateTargetList = (type, listText) => {
  const spec = TARGET_SPECS[type];
  if (!spec) return null; // any 或未知类型：引擎不会按目标过滤，无需校验
  const items = parseList(listText);
  if (items.length === 0) return null;
  const bad = items.filter((t) => !spec.re.test(t));
  if (bad.length === 0) return null;
  return `目标类型是「${spec.label}」，但清单里有 ${bad.length} 项不符合格式（如「${bad[0]}」）：${spec.hint}。${spec.fixHint}。这类目标永远无法匹配，进度会一直是 0。`;
};

/** 直接接受 `rules` 对象，便于路由里一行调用 */
export const validateRulesTargets = (rules) => {
  const targets = (rules && rules.targets) || {};
  return validateTargetList(targets.type, targets.list);
};
