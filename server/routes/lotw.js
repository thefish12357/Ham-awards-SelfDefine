/**
 * LoTW 直连 API
 * ------------------------------------------------------------------
 * 让用户**不必上传自己的日志**，直接把 LoTW 里的记录读到内存里做奖状判定。
 *
 * 数据留存边界（需求①的硬要求）：
 *   - 凭据只在本次请求体内出现，**不写 config、不写 DB、不进日志**；
 *   - ADIF 原文边下边解析，**解析完即丢弃**，只保留精简字段对象；
 *   - 精简记录只存在进程内存的临时会话里（TTL 30 分钟），
 *     `DELETE/POST /api/lotw/session` 或前端 `sendBeacon` 会立即清除；
 *   - 申请奖状时**只把「申请记录 + 分数快照」落库，QSO 一条都不落库**。
 *
 * 路由通过工厂函数注入依赖（verifyToken / dbPool / config），
 * 避免 `server.js` 与本模块相互 import 形成循环。
 */

import express from 'express';
import crypto from 'crypto';
import * as sessions from '../services/lotwSessions.js';
import { fetchLotwReports, LotwError, validateLotwLogin } from '../services/lotwClient.js';
import { evaluateAward } from '../services/awardEngine.js';

/** 把 LoTW 精简记录包装成判定引擎认识的 QSO 行形状 */
const toQsoRow = (raw) => ({
  id: null,
  callsign: raw.call || '',
  band: raw.band || '',
  mode: raw.mode || '',
  qso_date: raw.qso_date || '',
  dxcc: raw.dxcc || '',
  country: raw.country || '',
  state: raw.state || '',
  adif_raw: raw,
});

/** 生成 16 位数字序列号（用 crypto.randomInt，避免 Math.random 的非密码学问题） */
const generateSerial = () => {
  let serial = '';
  for (let i = 0; i < 16; i += 1) serial += crypto.randomInt(0, 10);
  return serial;
};

/**
 * 报表可选日期区间的下界。
 * 与 `lotwClient` 的 `HISTORY_START`、前端 `src/lib/dateInput.js` 的 `DATE_MIN`、
 * 以及 `server/services/dates.js` 的 `DATE_MIN` 保持一致（取值相同，改的时候四处对齐）。
 */
const REPORT_MIN_DATE = '1900-01-01';

/** 严格 YYYY-MM-DD：**年份必须正好 4 位**（原生 date 控件允许 5~6 位年份，必须挡住） */
const isStrictIsoDate = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/**
 * 校验可选的日期区间参数。
 *
 * ⚠️ 为什么必须**显式报错**而不能放过：`fetchLotwReports()` 里对不合法日期是
 *    **静默回退**到 `1900-01-01 → 今天`（全量历史）。用户以为自己只缩小了一小段，
 *    实际拉的是全部日志 —— 表现就是「读取很慢/超时」，而且完全看不出原因。
 *    浏览器的 `<input type="date">` 年份段允许超过 4 位（Chrome 上限 275760），
 *    所以「111111-11-11」这种值真的能从界面传上来（2026-09-24 用户实测）。
 *
 * @returns {string|null} 错误信息；null 表示通过
 */
const validateReportRange = (from, to) => {
  const today = new Date().toISOString().slice(0, 10);
  for (const [label, v] of [['起始日期', from], ['结束日期', to]]) {
    if (!v) continue; // 留空 = 全部历史，是允许的
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return `${label}格式不正确：年份必须是 4 位数字（如 2020-01-01），请用日历选择器或快捷按钮重填`;
    }
    if (!isStrictIsoDate(v)) return `${label}不是一个真实存在的日期`;
    if (v < REPORT_MIN_DATE) return `${label}不能早于 ${REPORT_MIN_DATE}`;
    if (v > today) return `${label}不能晚于今天（${today}）`;
  }
  if (from && to && from > to) return '起始日期不能晚于结束日期';
  return null;
};

export function createLotwRouter({ getDbPool, verifyToken, getConfig, lookupDxcc }) {
  const router = express.Router();

  const lotwConfig = () => {
    const cfg = getConfig().lotw || {};
    return {
      enabled: cfg.enabled !== false,
      timeoutMs: Number(cfg.timeoutMs) || 90_000,
      batchMaxBytes: Number(cfg.batchMaxBytes) || 12 * 1024 * 1024,
      maxSplitDepth: Number(cfg.maxSplitDepth) || 6,
      cacheTtlMinutes: Number(cfg.cacheTtlMinutes) || 30,
    };
  };

  // ---------------------------------------------------------------
  // 连接 LoTW：拉取报表 → 解析 → 只放进内存会话
  // ---------------------------------------------------------------
  router.post('/connect', verifyToken, async (req, res) => {
    const cfg = lotwConfig();
    if (!cfg.enabled) {
      return res.status(503).json({ error: 'LOTW_DISABLED', message: 'LoTW 直连功能当前已关闭' });
    }

    const body = req.body || {};
    const login = String(body.login || '').trim();
    const password = body.password == null ? '' : String(body.password);

    if (!validateLotwLogin(login)) {
      return res.status(400).json({ error: 'INVALID_LOGIN', message: '请输入有效的 LoTW 用户名（3–20 位字母数字）' });
    }
    if (!password || password.length > 256) {
      return res.status(400).json({ error: 'INVALID_PASSWORD', message: '请输入有效的 LoTW 密码' });
    }

    const fromRaw = body.from ? String(body.from).trim() : '';
    const toRaw = body.to ? String(body.to).trim() : '';
    const rangeError = validateReportRange(fromRaw, toRaw);
    if (rangeError) {
      return res.status(400).json({ error: 'INVALID_RANGE', message: rangeError });
    }
    const from = fromRaw || undefined;
    const to = toRaw || undefined;
    const ownCall = body.ownCall ? String(body.ownCall).trim() : undefined;
    const includeAll = !!body.includeAll;

    try {
      const result = await fetchLotwReports({
        login,
        password,
        ownCall,
        from,
        to,
        includeAll,
        timeoutMs: cfg.timeoutMs,
        maxBytes: cfg.batchMaxBytes,
        maxDepth: cfg.maxSplitDepth,
      });

      const session = await sessions.createSession(req.user.id, result);

      // 注意：这里刻意不记录任何请求体内容，避免凭据进入日志
      res.json({
        success: true,
        session: sessions.describeSession(session),
        stats: {
          recordCount: result.recordCount,
          qslCount: result.qslCount,
          qsoCount: result.qsoCount,
          addedFromAll: result.addedFromAll,
          bytes: result.bytes,
          batches: result.batches.length,
        },
        range: result.range,
      });
    } catch (e) {
      if (e instanceof LotwError) {
        return res.status(e.httpStatus || 502).json({
          error: e.code,
          message: e.message,
          rangeTooLarge: e.code === 'LOTW_RANGE_TOO_LARGE',
          detail: e.detail,
        });
      }
      if (e && e.code === 'LOTW_CAPACITY') {
        return res.status(507).json({ error: e.code, message: e.message });
      }
      console.error('LoTW connect failed:', e && (e.code || e.message));
      res.status(500).json({ error: 'LOTW_ERROR', message: '读取 LoTW 日志失败，请稍后重试' });
    }
  });

  // ---------------------------------------------------------------
  // 用临时会话里的记录判定奖状进度（不写库）
  // ---------------------------------------------------------------
  router.post('/evaluate', verifyToken, async (req, res) => {
    const body = req.body || {};
    const session = await sessions.getSession(body.sessionId, req.user.id);
    if (!session) {
      return res
        .status(410)
        .json({ error: 'SESSION_GONE', message: '临时日志会话已过期或不存在，请重新连接 LoTW' });
    }

    const awardId = Number(body.awardId);
    if (!Number.isInteger(awardId) || awardId <= 0) {
      return res.status(400).json({ error: 'INVALID_AWARD', message: '请选择要检查的奖状' });
    }

    try {
      const dbPool = getDbPool();
      const awardRes = await dbPool.query('SELECT id, name, rules, status FROM awards WHERE id = $1', [awardId]);
      if (awardRes.rows.length === 0) {
        return res.status(404).json({ error: 'NOT_FOUND', message: '奖状不存在' });
      }
      const claimedRes = await dbPool.query(
        'SELECT level FROM user_awards WHERE user_id=$1 AND award_id=$2',
        [req.user.id, awardId],
      );

      const evaluation = evaluateAward({
        rules: awardRes.rows[0].rules,
        qsos: session.records.map(toQsoRow),
        claimedLevels: claimedRes.rows.map((r) => r.level),
        includeQsos: body.includeQsos !== false,
      });

      res.json({
        ...evaluation,
        source: 'lotw_session',
        award: { id: awardRes.rows[0].id, name: awardRes.rows[0].name, status: awardRes.rows[0].status },
        session: sessions.describeSession(session),
      });
    } catch (e) {
      console.error('LoTW evaluate failed:', e && e.message);
      res.status(500).json({ error: 'EVALUATE_FAILED', message: '奖状判定失败' });
    }
  });

  // ---------------------------------------------------------------
  // 用临时会话申请奖状：**只落申请记录，不落 QSO**
  // ---------------------------------------------------------------
  router.post('/apply', verifyToken, async (req, res) => {
    const body = req.body || {};
    const session = await sessions.getSession(body.sessionId, req.user.id);
    if (!session) {
      return res
        .status(410)
        .json({ error: 'SESSION_GONE', message: '临时日志会话已过期或不存在，请重新连接 LoTW' });
    }

    const awardId = Number(body.awardId);
    if (!Number.isInteger(awardId) || awardId <= 0) {
      return res.status(400).json({ error: 'INVALID_AWARD', message: '请选择要申请的奖状' });
    }

    try {
      const dbPool = getDbPool();
      const awardRes = await dbPool.query('SELECT id, name, rules, status, tracking_id FROM awards WHERE id = $1', [awardId]);
      if (awardRes.rows.length === 0) {
        return res.status(404).json({ error: 'NOT_FOUND', message: '奖状不存在' });
      }
      const award = awardRes.rows[0];
      if (award.status !== 'approved') {
        return res.status(400).json({ error: 'NOT_APPROVED', message: '该奖状尚未发布，暂不能申请' });
      }

      const claimedRes = await dbPool.query(
        'SELECT level FROM user_awards WHERE user_id=$1 AND award_id=$2',
        [req.user.id, awardId],
      );

      const evaluation = evaluateAward({
        rules: award.rules,
        qsos: session.records.map(toQsoRow),
        claimedLevels: claimedRes.rows.map((r) => r.level),
      });

      if (!evaluation.eligible) {
        return res.status(400).json({ error: 'NOT_ELIGIBLE', message: '未满足申请条件' });
      }

      const levelName = evaluation.achieved_level.name;
      const exists = await dbPool.query(
        'SELECT id FROM user_awards WHERE user_id=$1 AND award_id=$2 AND level=$3',
        [req.user.id, awardId, levelName],
      );
      if (exists.rows.length > 0) {
        return res
          .status(400)
          .json({ error: 'ALREADY_APPLIED', message: `您已领取过此等级(${levelName})的奖状` });
      }

      const serial = generateSerial();
      // 快照奖状名称/编号，便于奖状日后被删除时仍能在颁发台账里显示是哪个奖状
      await dbPool.query(
        `INSERT INTO user_awards (user_id, award_id, level, score_snapshot, serial_number, award_name, award_tracking_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.user.id, awardId, levelName, evaluation.current_score, serial, award.name || null, award.tracking_id || null],
      );
      res.json({ success: true, serial, level: levelName });
    } catch (e) {
      console.error('LoTW apply failed:', e && e.message);
      res.status(500).json({ error: 'APPLY_FAILED', message: '申请失败，请稍后重试' });
    }
  });

  // ---------------------------------------------------------------
  // 把临时会话里的 QSO 显式写入用户日志库（可选，用户主动触发）
  // ---------------------------------------------------------------
  // ⚠️ 与「需求①硬要求」（QSO 不落库）的关系：默认仍**不**落库；这里只在用户
  //    点了「导入到我日志库」后落库，让详情页 / 日志库 / 进度与明细能与 LoTW 直连
  //    判定结果保持一致。落库逻辑与 ADIF 上传完全等价（同样的 UNIQUE 键 + 同样的
  //    DXCC 反查），保证「直连判定通过 → 导入 → 详情页也通过」不会翻车。
  router.post('/import', verifyToken, async (req, res) => {
    const body = req.body || {};
    const session = await sessions.getSession(body.sessionId, req.user.id);
    if (!session) {
      return res
        .status(410)
        .json({ error: 'SESSION_GONE', message: '临时日志会话已过期或不存在，请重新连接 LoTW' });
    }
    try {
      const dbPool = getDbPool();
      const client = await dbPool.connect();
      let imported = 0;
      try {
        await client.query('BEGIN');
        for (const r of session.records) {
          // ADIF 自带 DXCC/COUNTRY 时直接用；缺一字段时按 cty.dat 反查呼号补全（与 ADIF 上传一致）
          let dxNum = r.dxcc || '';
          let dxName = r.country || '';
          if ((!dxNum || !dxName) && r.call) {
            const dx = lookupDxcc(r.call);
            if (dx) {
              if (!dxNum) dxNum = dx.dxcc || '';
              if (!dxName) dxName = dx.name || '';
            }
          }
          const ins = await client.query(
            `INSERT INTO qsos (user_id, callsign, band, mode, qso_date, dxcc, country, adif_raw)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (user_id, callsign, band, mode, qso_date) DO NOTHING`,
            [req.user.id, r.call || '', r.band || '', r.mode || '', r.qso_date || '', dxNum, dxName, JSON.stringify(r)],
          );
          if (ins.rowCount) imported += 1;
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      res.json({ success: true, count: session.records.length, imported });
    } catch (e) {
      console.error('LoTW import failed:', e && e.message);
      res.status(500).json({ error: 'IMPORT_FAILED', message: '导入日志库失败，请稍后重试' });
    }
  });

  // ---------------------------------------------------------------
  // 会话状态 / 清除
  // ---------------------------------------------------------------
  router.get('/session', verifyToken, async (req, res) => {
    const own = await sessions.getSessionForUser(req.user.id);
    res.json({ ...sessions.describeSession(own), serverStats: await sessions.sessionStats() });
  });

  /**
   * 清除临时会话。
   * 前端用 `navigator.sendBeacon` 关闭页面时**无法携带 Authorization 头**，
   * 因此允许凭 sessionId 直接清除 —— sessionId 是随机不可猜的，充当一次性能力令牌。
   */
  const clearSession = async (req, res) => {
    const sid = String(req.query.id || (req.body && req.body.sessionId) || '');
    if (sid && (await sessions.getSessionByCapability(sid))) {
      await sessions.deleteSession(sid);
      return res.json({ success: true, cleared: true, via: 'capability' });
    }
    // 否则要求登录，并清除该用户的所有会话
    return verifyToken(req, res, async () => {
      const removed = await sessions.deleteUserSessions(req.user.id);
      res.json({ success: true, cleared: removed > 0, via: 'auth' });
    });
  };
  router.post('/session', clearSession);
  router.delete('/session', clearSession);

  return router;
}

export default createLotwRouter;
