/**
 * 奖状「目标对象」类型规格 —— 前端侧（2026-09-24）
 * ------------------------------------------------------------------
 * ⚠️ 是 `server/services/awardTargets.js` 的**镜像**，两份必须保持一致
 *    （服务端那份用同一套 regex 做 400 兜底；前端这份负责 placeholder、即时提示与保存前拦截）。
 *
 * 起因（用户实测）：设计器的目标清单输入框不管选哪种类型，placeholder 都写着
 * 「例如: BA1AA, BA4AA, BY1CRA...」，于是有人在「特定 DXCC 实体」下填了呼号。
 * 引擎比较的是 `qso.dxcc`（实体**编号**，如 318），跟呼号永远不可能相等 →
 * **进度恒为 0 / N、明细全红、零报错** —— 用户只能得出"进度与明细未知"。
 * 所以：placeholder / 提示 / 校验三处都必须随类型变化。
 */

export const TARGET_SPECS = {
  callsign: {
    label: '呼号',
    re: /^[A-Z0-9/]{3,}$/,
    hint: '填对方呼号，与日志里的「对方呼号」等值比较',
    fixHint: '如果想按 DXCC 实体收集，请把「目标对象类型」改成「特定 DXCC 实体」',
    placeholder: '例如: BA1AA, BG5UWQ（对方呼号，逗号分隔）',
  },
  dxcc: {
    label: 'DXCC 实体编号',
    re: /^\d{1,3}$/,
    hint: 'DXCC 是实体编号（318=中国、291=美国、339=日本…），不是呼号',
    fixHint: '如果你是想按呼号收集，请把「目标对象类型」改成「特定呼号列表」',
    placeholder: '例如: 318, 291, 339（DXCC 实体编号，逗号分隔）',
  },
  grid: {
    label: '网格',
    re: /^[A-Z]{2}\d{2}$/,
    hint: '网格取前 4 位（与日志里的 gridsquare 前 4 位比较）',
    fixHint: '若日志里没有网格字段，可重新上传日志或直连 LoTW 补全',
    placeholder: '例如: PM95, QN10（4 位网格，逗号分隔）',
  },
  iota: {
    label: 'IOTA 编号',
    re: /^[A-Z]{2}-\d{3}$/,
    hint: 'IOTA 编号形如 AS-007',
    fixHint: '请核对写法：两位地区码 + 短横线 + 三位数字',
    placeholder: '例如: AS-007, EU-005（IOTA 编号，逗号分隔）',
  },
  state: {
    label: '州/省代码',
    re: /^[A-Z]{1,3}$/,
    hint: '州/省代码形如 CA、TX（ADIF 的 state 字段）',
    fixHint: '请填 1~3 位字母的州/省代码',
    placeholder: '例如: CA, TX（州/省代码，逗号分隔）',
  },
  district: {
    label: '呼号分区',
    re: /^[0-9]$/,
    hint: '取中国 B 字头呼号里紧跟前缀的那一位数字：BY1AA→1、BG5UWQ→5、BH7CSA→7（国外呼号的数字不计入）',
    fixHint: '想按整呼号收集请选「特定呼号列表」；想按国家收集请选「特定 DXCC 实体」',
    placeholder: '例如: 0,1,2,3,4,5,6,7,8,9（区号数字，逗号分隔）',
  },
};

export const parseTargetList = (list) =>
  String(list || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s);

/**
 * 校验目标清单格式（空清单 = 不限制，返回 null）。
 * @returns {string|null} 错误信息；null = 通过
 */
export const validateTargetList = (type, listText) => {
  const spec = TARGET_SPECS[type];
  if (!spec) return null; // any 或未知类型：不按目标过滤，无需校验
  const items = parseTargetList(listText);
  if (items.length === 0) return null;
  const bad = items.filter((t) => !spec.re.test(t));
  if (bad.length === 0) return null;
  return `清单里有 ${bad.length} 项不符合「${spec.label}」格式（如「${bad[0]}」）：${spec.hint}。${spec.fixHint}。这类目标永远无法匹配，进度会一直是 0。`;
};

/** 接受整个 rules 对象，便于保存前一行调用 */
export const validateRulesTargets = (rules) => {
  const targets = (rules && rules.targets) || {};
  return validateTargetList(targets.type, targets.list);
};
