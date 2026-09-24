/**
 * 奖状判定引擎（纯函数，不碰数据库）
 * ------------------------------------------------------------------
 * 从 `server.js` 的 `evaluateAward` 中抽出「计算」部分，目的有两个：
 *   1. 数据源可插拔 —— 既支持数据库里的 QSO，也支持 LoTW 直连的内存会话；
 *   2. 便于单测。
 *
 * 调用方负责提供：
 *   - rules          awards.rules（JSONB）
 *   - qsos           QSO 行数组，每行至少含 { adif_raw, callsign?, band?, mode?, qso_date?, dxcc? }
 *   - claimedLevels  该用户在该奖状上已领取的等级名数组
 *
 * ⚠️ 逻辑与上游 `server.js` 保持逐行一致（仅补了 adif_raw / qso_date 缺失时的空值防护），
 *    改动前请先确认不会影响既有奖状。
 */
// 目标类型规格（校验清单格式 / 产出 warnings）：与前端 src/lib/awardTargets.js 保持同步
import { TARGET_SPECS, TARGET_FIELD_HINTS } from './awardTargets.js';

/**
 * 取呼号的「分区号」——中国 B 字头呼号里紧跟前缀的那一位数字。
 *   BY1AA→1、BG5UWQ→5、BH7CSA→7、BV3AB→3、B1Z→1
 * 便携写法 `BY1AA/5` 只看主体（正则锚在开头），后缀不影响。
 *
 * ⚠️ **只认 B 字头**：JA1ABC 的 "1" 是日本自己的分区、K1ABC 的 "1" 也不是中国区号，
 *    把它们算进来会让「收集 0~9 区」这类奖状失真（随便通联几个日本台就集满了）。
 * @returns {string} 单字符数字；非中国呼号返回空串
 */
const CALL_DISTRICT_RE = /^B[A-Z]{0,2}(\d)/;
export const districtOfCallsign = (call) => {
  const m = String(call || '')
    .toUpperCase()
    .trim()
    .match(CALL_DISTRICT_RE);
  return m ? m[1] : '';
};

export const categorizeMode = (mode) => {
  const m = (mode || '').toUpperCase();
  if (['CW'].includes(m)) return 'cw';
  if (['SSB', 'AM', 'FM', 'USB', 'LSB'].includes(m)) return 'phone';
  if (['FT8', 'FT4', 'RTTY', 'PSK31', 'JT65', 'JS8'].includes(m)) return 'data';
  return 'data'; // 未知模式一律算 data（与上游一致）
};

/**
 * @returns {{eligible:boolean,current_score:number,target_score:number,
 *            achieved_level?:object,next_level?:object,claimed_levels:string[],
 *            thresholds?:Array,breakdown?:object|null,matching_qsos?:Array,
 *            warnings:string[],stats:object,details:object}}
 */
export function evaluateAward({ rules, qsos = [], claimedLevels = [], includeQsos = false }) {
  // Legacy compatibility for simple V1 rules
  if (!rules || (Array.isArray(rules) && !rules.v2)) {
    return {
      eligible: false,
      current_score: 0,
      target_score: 1,
      warnings: ['该奖状用的是旧版规则，无法自动判定进度，请联系奖状管理员升级规则。'],
      stats: { total_qsos: qsos.length, basic_filtered: 0, target_matched: 0 },
      details: { msg: '旧版规则不兼容自动检查' },
    };
  }

  const basic = rules.basic || {};

  // --- Step 1: Filter ---
  let filteredQsos = qsos.filter((q) => {
    const raw = q.adif_raw || {};

    // Date Filter（ADIF 日期通常是 YYYYMMDD，需转成 YYYY-MM-DD 再比较）
    const fmt = (v) => {
      const s = String(v || '');
      return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
    };

    if (basic.startDate && fmt(raw.qso_date || q.qso_date) < basic.startDate) return false;
    if (basic.endDate && fmt(raw.qso_date || q.qso_date) > basic.endDate) return false;

    // QSL Required：LoTW 已确认 或 实物卡片已确认
    if (basic.qslRequired) {
      const qslR = String(raw.qsl_rcvd || '').toUpperCase() === 'Y';
      const lotwR = String(raw.lotw_qsl_rcvd || '').toUpperCase() === 'Y';
      if (!qslR && !lotwR) return false;
    }

    // Custom Filters
    // 顺序说明：**先按筛选条件过滤（Step 1），再按目标对象收集（Step 2）** ——
    // 两者是"与"的关系，所以可以这样组合：「DXCC ID = 318（只算中国台）」+
    // 「目标对象类型 = 呼号分区 0~9」= 收集中国的 0~9 区。
    if (Array.isArray(rules.filters)) {
      for (const f of rules.filters) {
        if (!f.field || !f.value || f.value === 'ANY') continue;
        const fieldKey = String(f.field).toLowerCase();
        // 「呼号分区」不是 ADIF 字段，得现算 —— 与目标类型 district 共用同一套抽取规则，
        // 否则会出现"目标按分区算、筛选按 undefined 比"的错位。
        const rawVal =
          fieldKey === 'district'
            ? districtOfCallsign(q.callsign || raw.call)
            : (raw[fieldKey] ?? q[fieldKey] ?? '');
        const val = String(rawVal).toUpperCase();
        const targetVal = String(f.value).toUpperCase();
        if (f.operator === 'eq' && val !== targetVal) return false;
        if (f.operator === 'neq' && val === targetVal) return false;
        if (f.operator === 'contains' && !val.includes(targetVal)) return false;
        // 大于/小于：以前下拉里有「大于」但引擎**完全没实现** → 选了等于没选（静默失效）。
        // 两端都能转成数字时按数值比（如频率 14.2 > 14），否则按字符串比。
        if (f.operator === 'gt' || f.operator === 'lt') {
          const na = Number(val);
          const nb = Number(targetVal);
          const numeric = val !== '' && targetVal !== '' && !Number.isNaN(na) && !Number.isNaN(nb);
          const cmp = numeric
            ? na < nb ? -1 : na > nb ? 1 : 0
            : val < targetVal ? -1 : val > targetVal ? 1 : 0;
          if (f.operator === 'gt' && cmp <= 0) return false;
          if (f.operator === 'lt' && cmp >= 0) return false;
        }
      }
    }
    return true;
  });

  // --- Step 2: Target Matching & Scoring ---
  const logic = rules.logic || 'collection';
  const targetType = rules.targets?.type || 'any';
  const rawTargetList = rules.targets?.list
    ? String(rules.targets.list)
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s)
    : [];
  const targetSet = new Set(rawTargetList);

  const getTargetValue = (qso) => {
    const raw = qso.adif_raw || {};
    if (targetType === 'any') return `${raw.call}-${raw.qso_date}-${raw.time_on}`;
    if (targetType === 'callsign') return String(qso.callsign || raw.call || '').toUpperCase();
    if (targetType === 'dxcc') return qso.dxcc || raw.dxcc || '';
    if (targetType === 'grid') return String(raw.gridsquare || '').substring(0, 4).toUpperCase();
    if (targetType === 'iota') return String(raw.iota || '').toUpperCase();
    if (targetType === 'state') return String(raw.state || '').toUpperCase();
    // 呼号分区：从呼号里抽区号数字（只认中国 B 字头，见 districtOfCallsign）
    if (targetType === 'district') return districtOfCallsign(qso.callsign || raw.call);
    return null;
  };

  // 统计口径（用来把「进度为什么是 0」讲清楚）：
  //   basicFilteredCount    = 通过 Step 1 基础筛选的条数
  //   emptyTargetValueCount = 其中「目标字段为空」的条数（根本没法参与比较）
  //   targetMatchedCount    = 命中目标清单的条数
  const basicFilteredCount = filteredQsos.length;
  let emptyTargetValueCount = 0;
  if (targetSet.size > 0) {
    filteredQsos = filteredQsos.filter((q) => {
      const val = getTargetValue(q);
      if (!val) emptyTargetValueCount += 1;
      return val && targetSet.has(val);
    });
  }
  const targetMatchedCount = filteredQsos.length;

  let score = 0;
  const uniqueSet = new Set();
  const qsoMap = new Map();

  // --- Step 3: Calculation ---
  if (logic === 'collection') {
    filteredQsos.forEach((q) => {
      const key = getTargetValue(q);
      if (key) {
        uniqueSet.add(key);
        if (!qsoMap.has(key)) qsoMap.set(key, q);
      }
    });
    score = uniqueSet.size;
  } else {
    const deduplication = rules.deduplication || 'none';
    const scoring = rules.scoring || { cw: 1, phone: 1, data: 1 };

    for (const q of filteredQsos) {
      const raw = q.adif_raw || {};
      const call = String(q.callsign || raw.call || '').toUpperCase();
      const band = String(q.band || raw.band || '').toUpperCase();
      const modeCat = categorizeMode(q.mode || raw.mode);

      let dedupKey = null;
      if (deduplication === 'call') dedupKey = call;
      else if (deduplication === 'call_band') dedupKey = `${call}-${band}`;
      else if (deduplication === 'slot') dedupKey = `${call}-${band}-${String(q.mode || raw.mode || '').toUpperCase()}`;
      else if (deduplication === 'state') dedupKey = String(q.state || raw.state || '').toUpperCase();
      else if (deduplication === 'custom') {
        const field = rules.deduplicationCustomField || 'call';
        dedupKey = String(q[field] ?? raw[field] ?? '').toUpperCase();
      }

      if (dedupKey) {
        if (uniqueSet.has(dedupKey)) continue;
        uniqueSet.add(dedupKey);
      }
      score += scoring[modeCat] || 0;
    }
  }

  // --- Breakdown for specific targets ---
  let breakdown = null;
  if (targetSet.size > 0) {
    const missing = [];
    const achieved_list = [];
    rawTargetList.forEach((t) => {
      if (uniqueSet.has(t)) achieved_list.push({ target: t, qso: qsoMap.get(t) });
      else missing.push(t);
    });
    breakdown = {
      total_required: targetSet.size,
      achieved: achieved_list,
      achieved_keys: Array.from(uniqueSet),
      missing,
    };
  }

  // --- 规则自检（2026-09-24）---
  // 目的：让「进度一直是 0」有明确解释。此前设计器的目标清单**不管选哪种类型都提示
  // 「例如: BA1AA, BA4AA…」**，于是有人在「特定 DXCC 实体」下填了呼号（BG5UWQ…），
  // 引擎比较的是 `qso.dxcc`（实体编号，如 318），永远不可能相等 →
  // 进度恒为 0、明细全红、**零报错**，用户只能得出"进度与明细未知"。
  const warnings = [];
  if (targetSet.size > 0) {
    const spec = TARGET_SPECS[targetType];
    if (spec) {
      const badItems = rawTargetList.filter((t) => !spec.re.test(t));
      if (badItems.length > 0) {
        warnings.push(
          `目标类型是「${spec.label}」，但清单里有 ${badItems.length} 项不符合格式（如「${badItems[0]}」）：${spec.hint}。${spec.fixHint}。`
        );
      }
    }
    if (score === 0) {
      if (qsos.length === 0) {
        warnings.push('你还没有日志，先上传 ADIF 或使用「LoTW 直连」导入后再看进度。');
      } else if (basicFilteredCount === 0) {
        warnings.push(
          `你的 ${qsos.length} 条日志都没有通过基础筛选（时间范围 / QSL 确认要求 / 自定义筛选条件），因此不可能命中目标。`
        );
      } else if (emptyTargetValueCount === basicFilteredCount) {
        warnings.push(
          `通过基础筛选的 ${basicFilteredCount} 条日志缺少「${TARGET_FIELD_HINTS[targetType] || spec?.label || '目标'}」字段，无法与目标清单比较（重新上传日志或直连 LoTW 可补全）。`
        );
      } else {
        warnings.push(
          `${basicFilteredCount} 条日志通过了基础筛选，但没有一条命中目标清单（共 ${targetSet.size} 项）。`
        );
      }
    }
  }

  // --- Step 4: Multi-level Thresholds ---
  let thresholds = rules.thresholds || [{ name: 'Award', value: 1 }];
  if (!Array.isArray(thresholds)) thresholds = [thresholds];
  thresholds = thresholds.slice().sort((a, b) => b.value - a.value);

  /**
   * 阈值对应的「分数门槛」。
   * ★ 收集型 + 勾了「全收集」时，真正的门槛是**目标清单的条数**（例如 10 个区），而不是 value。
   *   否则进度会显示成 "0 / 1"（看着像通联 1 个就够），与实际判定（必须集齐）不符 ——
   *   用户新建"收集 0~9 区"奖状时阈值就默认是 1，正是这个坑（2026-09-25 修）。
   *   计分型 + 全收集时 value 仍是分数门槛，另外还要集齐清单。
   */
  const scoreTargetOf = (t) =>
    logic === 'collection' && t.fullCollection && breakdown ? breakdown.total_required : t.value;

  const achieved = thresholds.find((t) => {
    const scoreMet = score >= scoreTargetOf(t);
    // 全收集独立于分数，与分数并列为判定条件
    const collectionMet = !t.fullCollection || (breakdown && breakdown.missing.length === 0);
    return scoreMet && collectionMet;
  });

  const next_target = thresholds.slice().reverse().find((t) => score < scoreTargetOf(t)) || thresholds[0];

  return {
    eligible: !!achieved,
    current_score: score,
    // 收集型 + 全收集 → 门槛是清单条数（如 10 个区），见 scoreTargetOf
    target_score: scoreTargetOf(next_target),
    achieved_level: achieved || null,
    next_level: next_target,
    claimed_levels: claimedLevels,
    thresholds,
    breakdown,
    warnings,
    stats: {
      total_qsos: qsos.length,
      basic_filtered: basicFilteredCount,
      target_matched: targetMatchedCount,
    },
    matching_qsos: includeQsos
      ? filteredQsos.map((q) => ({
          id: q.id ?? null,
          call: q.callsign || q.adif_raw?.call,
          band: q.band || q.adif_raw?.band,
          mode: q.mode || q.adif_raw?.mode,
          date: q.qso_date,
          grid: q.adif_raw?.gridsquare,
          ...(q.adif_raw || {}),
        }))
      : undefined,
    details: {
      msg: achieved
        ? `已达成: ${achieved.name} (${score}${achieved.fullCollection ? ' + 已集齐' : ''})`
        : `当前 ${score}，下一目标 ${scoreTargetOf(next_target)} (${next_target.name})`,
    },
  };
}
