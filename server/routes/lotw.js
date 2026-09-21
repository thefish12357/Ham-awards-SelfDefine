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

export function createLotwRouter({ getDbPool, verifyToken, getConfig }) {
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

    const from = body.from ? String(body.from) : undefined;
    const to = body.to ? String(body.to) : undefined;
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

      const session = sessions.createSession(req.user.id, result);

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
    const session = sessions.getSession(body.sessionId, req.user.id);
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
    const session = sessions.getSession(body.sessionId, req.user.id);
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
      const awardRes = await dbPool.query('SELECT id, name, rules, status FROM awards WHERE id = $1', [awardId]);
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
      await dbPool.query(
        'INSERT INTO user_awards (user_id, award_id, level, score_snapshot, serial_number) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, awardId, levelName, evaluation.current_score, serial],
      );
      res.json({ success: true, serial, level: levelName });
    } catch (e) {
      console.error('LoTW apply failed:', e && e.message);
      res.status(500).json({ error: 'APPLY_FAILED', message: '申请失败，请稍后重试' });
    }
  });

  // ---------------------------------------------------------------
  // 会话状态 / 清除
  // ---------------------------------------------------------------
  router.get('/session', verifyToken, (req, res) => {
    const own = sessions.getSessionForUser(req.user.id);
    res.json({ ...sessions.describeSession(own), serverStats: sessions.sessionStats() });
  });

  /**
   * 清除临时会话。
   * 前端用 `navigator.sendBeacon` 关闭页面时**无法携带 Authorization 头**，
   * 因此允许凭 sessionId 直接清除 —— sessionId 是随机不可猜的，充当一次性能力令牌。
   */
  const clearSession = (req, res) => {
    const sid = String(req.query.id || (req.body && req.body.sessionId) || '');
    if (sid && sessions.getSessionByCapability(sid)) {
      sessions.deleteSession(sid);
      return res.json({ success: true, cleared: true, via: 'capability' });
    }
    // 否则要求登录，并清除该用户的所有会话
    return verifyToken(req, res, () => {
      const removed = sessions.deleteUserSessions(req.user.id);
      res.json({ success: true, cleared: removed > 0, via: 'auth' });
    });
  };
  router.post('/session', clearSession);
  router.delete('/session', clearSession);

  return router;
}

export default createLotwRouter;
