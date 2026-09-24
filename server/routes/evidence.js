/**
 * 实物材料（QSL 卡片照片）API —— M4
 * ------------------------------------------------------------------
 * 需求④：用户上传实物卡片照片 → 管理员审核 → 审核后**立即删图**（省空间 + 隐私）。
 *
 * 隐私与安全设计：
 *   - 照片存**私有桶** `ham-awards-evidence`（不设公开读 policy，与公开桶 `ham-awards` 分开）；
 *   - 管理员查看走**同源鉴权代理** `GET /api/evidence/:id/photo`（内部客户端读私有桶，
 *     前端用 apiFetchBlob 转 blob URL 给 <img>）。**不要改回 presigned 直链**：直链 host 是
 *     MINIO_PUBLIC_ENDPOINT（本部署为 localhost:9000），https 页面下会被混合内容拦掉；
 *   - 上传用 multer **memoryStorage**（不落磁盘），限 5 MB，校验 PNG/JPEG **magic bytes**；
 *   - 审核 approve/reject 后**立即 `removeObject`**，DB 把 `object_key` 置空并记 `purged_at`，
 *     只保留审核结论，不保留图片；
 *   - 兜底：建议给桶配 MinIO ILM 生命周期 `expiry=7 天`，清理「审核中途放弃」的孤儿图。
 *
 * 路由通过工厂函数注入依赖（verifyToken / verifyAdmin / dbPool / minio / config），
 * 避免 `server.js` 与本模块相互 import 形成循环。
 */
import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { notifyUsers } from '../services/notifications.js';
import { lookupDxcc } from '../services/cty.js';
// 日期边界校验（与 src/lib/dateInput.js 同规则）：match_date 会作为日志日期入库
import { validateDate, utcDateOffset } from '../services/dates.js';

const EVIDENCE_BUCKET = 'ham-awards-evidence';
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * 实物材料类型白名单（2026-09-24 扩展，参照 WCSA 的收集要素口径）
 *   qsl_card —— 常规 QSO 的 QSL 卡片；**只有它**参与「实物卡片确认」判定（写 qsl_rcvd='Y'）
 *   eyeball  —— Eyeball QSL（当面交换，不属于 QSO）→ 有对方呼号但没有日志可匹配
 *   swl      —— SWL 收听报告 / 收听证明 → 本站没有收听记录，同样不匹配日志
 * `matchQso` 控制审核通过时是否去匹配 QSO，避免把 Eyeball/SWL 误标成"已确认"。
 * 前端同名清单见 `src/lib/evidenceTypes.js`，两边必须保持一致。
 */
const EVIDENCE_TYPES = {
  qsl_card: { label: 'QSL 卡片（QSO）', matchQso: true },
  eyeball: { label: 'Eyeball 卡（当面交换）', matchQso: false },
  swl: { label: 'SWL 收听报告', matchQso: false },
};
const evidenceTypeMeta = (value) => EVIDENCE_TYPES[value] || EVIDENCE_TYPES.qsl_card;

/**
 * 通联时间匹配容差（分钟）。
 * 卡片上印的时间与日志里的 `time_on` 常有几分钟差异（手抄/取整），
 * 所以填了 UTC 时间时**只用它收窄候选**：容差内没命中就退回按日期匹配，避免"一条都标不上"。
 * 无论用户表单按哪个时区填，入库与匹配用的都是 UTC。
 */
const QSO_TIME_TOLERANCE_MIN = 60;

/** 内存存储 + 5 MB 上限（不落本地磁盘） */
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

/** 校验文件 magic bytes，拒绝伪造扩展名的文件 */
const detectImageType = (buf) => {
  if (!buf || buf.length < 12) return null;
  // PNG：89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  // JPEG：FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
};

export function createEvidenceRouter({ getDbPool, verifyToken, verifyAwardAdmin, getConfig, getMinio, getMinioPublic, logAudit }) {
  const router = express.Router();
  const db = () => getDbPool();
  const minio = () => getMinio();
  // 审计写入由 server.js 注入；未注入时静默跳过（best-effort，不影响主流程）
  const audit = (req, entry) => (typeof logAudit === 'function' ? logAudit(db(), req, entry) : Promise.resolve());
  const bucket = () => (getConfig() && getConfig().evidenceBucket) || EVIDENCE_BUCKET;

  // ---- 上传实物材料 ----
  router.post('/', verifyToken, evidenceUpload.single('photo'), async (req, res) => {
    try {
      if (!minio()) return res.status(503).json({ error: 'MINIO_NOT_CONFIGURED', message: '对象存储未配置' });
      if (!req.file) return res.status(400).json({ error: 'NO_FILE', message: '未收到文件' });

      const mime = detectImageType(req.file.buffer);
      if (!mime) return res.status(400).json({ error: 'BAD_IMAGE', message: '只支持 PNG / JPEG 图片' });

      const awardId = Number(req.body.award_id);
      if (!awardId) return res.status(400).json({ error: 'NO_AWARD', message: '缺少奖状 ID' });
      const note = String(req.body.note || '').slice(0, 500);

      // 材料类型（收集要素）：qsl_card / eyeball / swl，未知值一律回落到 QSL 卡片
      const type = String(req.body.type || 'qsl_card').trim();
      const meta = evidenceTypeMeta(type);
      const typeValue = EVIDENCE_TYPES[type] ? type : 'qsl_card';

      // ★ 判定打通（2026-09-22）：卡片对应的通联信息，审核通过后据此匹配 QSO 打确认标记。
      //   对方呼号必填（Eyeball / SWL 也是"对方/被收听电台呼号"，只是不参与匹配）；
      //   波段/模式/日期可选（用于进一步缩小匹配范围）。
      const matchCallsign = String(req.body.match_callsign || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{2,20}$/.test(matchCallsign)) {
        return res.status(400).json({ error: 'BAD_CALLSIGN', message: '请填写有效的呼号（2-20 位字母数字）' });
      }
      const matchBand = String(req.body.match_band || '').trim().slice(0, 10);
      const matchMode = String(req.body.match_mode || '').trim().slice(0, 10);
      const matchDate = String(req.body.match_date || '').trim().slice(0, 20);
      // ★ 日期边界校验（2026-09-24）：`<input type="date">` 原生允许年份超过 4 位，而 match_date
      //   会被当作**日志日期**入库（匹配不到就自动补建一条），一个荒唐年份就会污染用户日志。
      //   上界留 1 天余量：用户在 UTC-11 等时区提交时，本地日期换算出的 UTC 日期可能「跨到明天」。
      const dateLabel = typeValue === 'eyeball' ? '交换日期' : typeValue === 'swl' ? '收听日期' : '通联日期';
      const dateError = validateDate(matchDate, dateLabel, { max: utcDateOffset(1) });
      if (dateError) return res.status(400).json({ error: 'BAD_DATE', message: dateError });
      // 通联时间：前端已按用户所选时区换算成 **UTC 的 HHMM** 再提交（校验一律 UTC）
      const matchTime = String(req.body.match_time || '').trim();
      if (matchTime && !/^([01]\d|2[0-3])[0-5]\d$/.test(matchTime)) {
        return res.status(400).json({ error: 'BAD_TIME', message: '通联时间格式不正确（应为 UTC 的 HHMM）' });
      }
      const tzRaw = Number(req.body.match_tz_offset);
      const matchTzOffset = Number.isFinite(tzRaw) ? Math.max(-720, Math.min(840, Math.trunc(tzRaw))) : null;

      const aw = await db().query('SELECT id, creator_id, name FROM awards WHERE id=$1', [awardId]);
      if (aw.rows.length === 0) return res.status(404).json({ error: 'AWARD_NOT_FOUND', message: '奖状不存在' });

      const ext = mime === 'image/png' ? 'png' : 'jpg';
      const key = `evidence/${req.user.id}/${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
      const sha = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

      await minio().putObject(bucket(), key, req.file.buffer, req.file.buffer.length, { 'Content-Type': mime });

      const ins = await db().query(
        `INSERT INTO award_evidence (user_id, award_id, type, note, object_key, mime, bytes, sha256, status, match_callsign, match_band, match_mode, match_date, match_time, match_tz_offset)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11, $12, $13, $14)
         RETURNING id, status, created_at`,
        [req.user.id, awardId, typeValue, note, key, mime, req.file.buffer.length, sha, matchCallsign, matchBand || null, matchMode || null, matchDate || null, matchTime || null, matchTzOffset],
      );

      // 站内提醒（M4.1）：通知审核员（所有 admin + 该奖状创建者）有新材料待审
      const admins = await db().query(`SELECT id FROM users WHERE role='admin'`);
      const reviewerIds = admins.rows.map((r) => r.id);
      if (aw.rows[0].creator_id) reviewerIds.push(aw.rows[0].creator_id);
      await notifyUsers(db(), reviewerIds, {
        type: 'evidence_pending',
        title: '有新的实物材料待审核',
        body: `用户 ${req.user.callsign} 为奖状「${aw.rows[0].name}」上传了${meta.label}材料，请及时审核。`,
      });

      await audit(req, {
        action: 'evidence.upload',
        targetType: 'evidence',
        targetId: ins.rows[0].id,
        detail: {
          award_id: awardId,
          award: aw.rows[0].name,
          callsign: req.user.callsign,
          type: typeValue,
          match_callsign: matchCallsign,
          // 统一记 UTC，并附上用户填写时用的时区偏移，便于事后核对
          utc: matchDate ? `${matchDate} ${matchTime || ''}`.trim() : undefined,
          tz_offset: matchTzOffset === null ? undefined : matchTzOffset,
          bytes: req.file.buffer.length,
        },
      });

      res.json({ success: true, id: ins.rows[0].id });
    } catch (e) {
      console.error('evidence upload error:', e);
      res.status(500).json({ error: 'UPLOAD_FAILED', message: e.message });
    }
  });

  // ---- 我的材料（不含图片 URL，只显示状态）----
  router.get('/mine', verifyToken, async (req, res) => {
    try {
      const r = await db().query(
        `SELECT e.id, e.award_id, a.name AS award_name, e.type, e.note, e.status,
                e.reject_reason, e.created_at, e.reviewed_at,
                e.match_callsign, e.match_band, e.match_mode, e.match_date, e.match_time, e.match_tz_offset
         FROM award_evidence e
         JOIN awards a ON a.id = e.award_id
         WHERE e.user_id = $1
         ORDER BY e.created_at DESC`,
        [req.user.id],
      );
      res.json(r.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- 待审材料（admin 看全部 / award_admin 只看自己创建的奖状；只返回 has_photo 标志，
  //      照片本体由前端逐条走 GET /:id/photo 取 blob）----
  router.get('/admin', verifyToken, verifyAwardAdmin, async (req, res) => {
    try {
      if (!minio()) return res.status(503).json({ error: 'MINIO_NOT_CONFIGURED', message: '对象存储未配置' });
      // 归属过滤：admin 看全部；award_admin 只看自己创建的奖状收到的材料
      const isAdmin = req.user.role === 'admin';
      const baseSql = `SELECT e.id, e.award_id, e.user_id, e.type, e.note, e.object_key, e.mime, e.bytes,
               e.status, e.created_at,
               e.match_callsign, e.match_band, e.match_mode, e.match_date, e.match_time, e.match_tz_offset,
                u.callsign AS user_callsign, a.name AS award_name
         FROM award_evidence e
         JOIN users u ON u.id = e.user_id
         JOIN awards a ON a.id = e.award_id
         WHERE e.status = 'pending'`;
      const r = isAdmin
        ? await db().query(`${baseSql} ORDER BY e.created_at ASC`)
        : await db().query(`${baseSql} AND a.creator_id = $1 ORDER BY e.created_at ASC`, [req.user.id]);

      // ⚠️ 不再返回 MinIO 预签名直链：那个直链的 host 是 MINIO_PUBLIC_ENDPOINT（本部署是
      //    localhost:9000），页面走 https（cloudflared 隧道）时会被浏览器按**混合内容**拦掉，
      //    管理员在别的机器上 localhost 更是指向他自己 —— 表现就是审核页明明有待审材料，
      //    照片位置只有一句「图片不可用（可能已删除）」（2026-09-24 用户实测）。
      //    现在只告诉前端「有没有照片」，本体走同源鉴权代理 GET /api/evidence/:id/photo。
      const items = r.rows.map((row) => {
        // 不把 object_key 泄露给前端
        const { object_key, ...rest } = row;
        return { ...rest, has_photo: !!object_key };
      });
      res.json(items);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- 查看材料照片（同源鉴权代理，2026-09-24 新增）----
  // 为什么不让前端直接用预签名直链：那个直链 host 是 MINIO_PUBLIC_ENDPOINT（本部署是
  //   localhost:9000），https 页面下会被**混合内容**拦掉、远程管理员的 localhost 又指向他自己。
  //   而 <img src> 无法带 Authorization，所以只能由服务端代理（内部客户端读私有桶）。
  // 权限与「待审列表」一致：admin 看全部；award_admin 只看自己创建的奖状收到的材料。
  // ⚠️ 已审核的记录 object_key 已被置空（照片按隐私设计即刻删除）→ 返回 404 PHOTO_PURGED。
  router.get('/:id/photo', verifyToken, verifyAwardAdmin, async (req, res) => {
    try {
      if (!minio()) return res.status(503).json({ error: 'MINIO_NOT_CONFIGURED', message: '对象存储未配置' });
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'BAD_ID', message: '参数不正确' });

      const r = await db().query(
        `SELECT e.object_key, e.mime, a.creator_id
           FROM award_evidence e
           LEFT JOIN awards a ON a.id = e.award_id
          WHERE e.id = $1`,
        [id],
      );
      if (r.rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND', message: '材料不存在' });
      const row = r.rows[0];
      if (req.user.role !== 'admin' && row.creator_id !== req.user.id) {
        return res.status(403).json({ error: 'PERMISSION_DENIED', message: '只能查看自己创建的奖状收到的材料' });
      }
      if (!row.object_key) {
        return res.status(404).json({ error: 'PHOTO_PURGED', message: '照片已按审核流程删除' });
      }

      const stat = await minio().statObject(bucket(), row.object_key);
      const contentType = row.mime || (stat.metaData && stat.metaData['content-type']) || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=300'); // 私有材料，禁止共享缓存
      const stream = await minio().getObject(bucket(), row.object_key);
      stream.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
      stream.pipe(res);
    } catch (e) {
      res.status(404).json({ error: 'PHOTO_UNAVAILABLE', message: '照片读取失败或已被清理' });
    }
  });

  // ---- 审核（通过/驳回）→ 立即删除对象 ----
  router.post('/admin/:id/review', verifyToken, verifyAwardAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { action, reason } = req.body || {};
    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: 'BAD_ACTION', message: 'action 必须是 approve 或 reject' });
    }
    if (action === 'reject' && !String(reason || '').trim()) {
      return res.status(400).json({ error: 'NO_REASON', message: '驳回必须填写原因' });
    }

    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const old = await client.query('SELECT * FROM award_evidence WHERE id=$1 FOR UPDATE', [id]);
      if (old.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'NOT_FOUND', message: '材料不存在' });
      }
      if (old.rows[0].status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'ALREADY_REVIEWED', message: '该材料已审核' });
      }

      // 归属校验：award_admin 只能审自己创建的奖状收到的材料
      if (req.user.role !== 'admin') {
        const owner = await client.query('SELECT creator_id FROM awards WHERE id=$1', [old.rows[0].award_id]);
        if (owner.rows.length === 0 || owner.rows[0].creator_id !== req.user.id) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'PERMISSION_DENIED', message: '只能审核自己创建的奖状收到的材料' });
        }
      }

      // ★ 审核后立即删除对象：省空间 + 隐私（照片含地址/印章）
      const key = old.rows[0].object_key;
      if (key && minio()) {
        try {
          await minio().removeObject(bucket(), key);
        } catch (err) {
          console.error('evidence purge error:', err.message);
        }
      }

      // ★ 判定打通：**只有 QSL 卡片（QSO）**审核通过后才匹配该用户的 QSO 并写 qsl_rcvd='Y'。
      //   Eyeball（当面交换）与 SWL（收听报告）是"收集要素"而不是通联凭证，
      //   若也写 qsl_rcvd 会污染 `awardEngine` 的 qslRequired 判定，所以显式跳过。
      const typeMeta = evidenceTypeMeta(old.rows[0].type);
      let matchedQso = 0;
      let timeMatched = false;
      let createdQso = 0; // 审核通过时按卡片信息「新增」的日志条数（没有对应日志时补建）
      if (action === 'approve' && typeMeta.matchQso && old.rows[0].match_callsign) {
        const conds = ['user_id = $1', 'UPPER(callsign) = $2'];
        const params = [old.rows[0].user_id, old.rows[0].match_callsign];
        let n = 2;
        if (old.rows[0].match_band) { n += 1; conds.push(`LOWER(band) = LOWER($${n})`); params.push(old.rows[0].match_band); }
        if (old.rows[0].match_mode) { n += 1; conds.push(`LOWER(mode) = LOWER($${n})`); params.push(old.rows[0].match_mode); }
        if (old.rows[0].match_date) { n += 1; conds.push(`REPLACE(qso_date, '-', '') = REPLACE($${n}, '-', '')`); params.push(old.rows[0].match_date); }

        // 先按 呼号/波段/模式/日期(UTC) 取候选；若填了 UTC 时间，再用 ±容差 收窄。
        // ★ 时间只用来"收窄"，容差内一条都没有时退回日期级匹配（卡片时间常与日志差几分钟，
        //   不该因此一条都不标）。校验口径自始至终是 UTC。
        const cand = await client.query(
          `SELECT id, adif_raw->>'time_on' AS time_on FROM qsos WHERE ${conds.join(' AND ')}`,
          params,
        );
        const toMinutes = (v) => {
          const s = String(v || '').trim();
          if (!/^\d{3,4}$/.test(s)) return null;
          const hhmm = s.padStart(4, '0');
          return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));
        };
        let ids = cand.rows.map((r) => r.id);
        const want = toMinutes(old.rows[0].match_time);
        if (want !== null && ids.length > 0) {
          const near = cand.rows.filter((r) => {
            const t = toMinutes(r.time_on);
            if (t === null) return false;
            const diff = Math.abs(t - want);
            return Math.min(diff, 1440 - diff) <= QSO_TIME_TOLERANCE_MIN;
          });
          if (near.length > 0) {
            ids = near.map((r) => r.id);
            timeMatched = true;
          }
        }
        if (ids.length > 0) {
          const upd = await client.query(
            `UPDATE qsos SET adif_raw = jsonb_set(adif_raw, '{qsl_rcvd}', '"Y"', true) WHERE id = ANY($1::int[])`,
            [ids],
          );
          matchedQso = upd.rowCount;
        }

        // ★ 2026-09-24：一张通过审核的实物卡片本身就是一份通联凭证。
        //   如果日志里**没有**这条记录（用户没上传过 ADIF、或卡片信息对不上），
        //   就按卡片填写的信息补一条 QSO 记录 —— 这样它会出现在「全部日志」，
        //   也能参与**其它奖状**的判定（`qsl_rcvd='Y'`，满足 qslRequired 类规则）。
        //   必备条件是「日期」：没有日期既无法去重也无法判定，宁可不建（只审核通过）。
        if (matchedQso === 0 && old.rows[0].match_date) {
          // 卡片不采集 DXCC 字段（用户填的就是对方呼号），但仍然按呼号做一次 cty.dat 反查，
          // 这样「全部日志」里就能看到实体名 / 编号，不用看着 "—" 以为没存上。
          const dx = lookupDxcc(old.rows[0].match_callsign);
          const dxName = dx?.name || null;
          const dxNum = dx?.dxcc || null;
          const created = await client.query(
            `INSERT INTO qsos (user_id, callsign, band, mode, qso_date, dxcc, country, adif_raw)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
             ON CONFLICT (user_id, callsign, band, mode, qso_date)
             DO UPDATE SET adif_raw = qsos.adif_raw
                       || jsonb_build_object('qsl_rcvd', 'Y', 'source', 'evidence', 'evidence_id', $9::int),
                       -- 已有 ADIF/导入值时**不覆盖**；只在两边都空时才用 cty 反查补上
                       country = COALESCE(NULLIF(qsos.country, ''), EXCLUDED.country),
                       dxcc    = COALESCE(NULLIF(qsos.dxcc,    ''), EXCLUDED.dxcc)
             RETURNING id`,
            [
              old.rows[0].user_id,
              old.rows[0].match_callsign,
              old.rows[0].match_band || null,
              old.rows[0].match_mode || null,
              old.rows[0].match_date,
              dxNum,
              dxName,
              JSON.stringify({
                call: old.rows[0].match_callsign,
                qso_date: String(old.rows[0].match_date).replace(/-/g, ''),
                ...(old.rows[0].match_time ? { time_on: old.rows[0].match_time } : {}),
                ...(old.rows[0].match_band ? { band: old.rows[0].match_band } : {}),
                ...(old.rows[0].match_mode ? { mode: old.rows[0].match_mode } : {}),
                qsl_rcvd: 'Y',
                qsl_via: 'CARD',
                source: 'evidence', // 前端据此显示「卡片」来源标记
                evidence_id: id,
              }),
               id,
            ],
          );
          createdQso = created.rows.length;
        }
      }

      await client.query(
        `UPDATE award_evidence
         SET status=$1, reviewer_id=$2, reviewed_at=NOW(), reject_reason=$3, object_key=NULL, purged_at=NOW()
         WHERE id=$4`,
        [action === 'approve' ? 'approved' : 'rejected', req.user.id, String(reason || '').slice(0, 500) || null, id],
      );
      await client.query('COMMIT');

      // 站内提醒（M4.1）：审核结果通知上传者（按材料类型区分文案）
      if (action === 'approve') {
        await notifyUsers(db(), [old.rows[0].user_id], {
          type: 'evidence_approved',
          title: '实物材料已通过审核',
          body: matchedQso > 0
            ? `你的${typeMeta.label}材料已通过审核，${matchedQso} 条日志已标记为「已确认」。`
            : createdQso > 0
              ? `你的${typeMeta.label}材料已通过审核，并已按卡片信息为你新增 1 条日志（可作为其它奖状的申请依据）。`
              : `你的${typeMeta.label}材料已通过审核。`,
        });
      } else {
        await notifyUsers(db(), [old.rows[0].user_id], {
          type: 'evidence_rejected',
          title: '实物材料被驳回',
          body: `你的${typeMeta.label}材料被驳回${reason ? '：' + reason : ''}。`,
        });
      }

      await audit(req, {
        action: 'evidence.audit',
        targetType: 'evidence',
        targetId: id,
        detail: {
          award_id: old.rows[0].award_id,
          applicant_id: old.rows[0].user_id,
          type: old.rows[0].type,
          op: action,
          matched_qso: matchedQso,
          created_qso: createdQso, // 1 = 按卡片信息补建了一条日志
          matched_by_time: timeMatched, // 是否真的用 UTC 时间收窄成功（否则是按日期匹配的）
          reason: String(reason || '').slice(0, 200),
        },
      });

      res.json({ success: true, matched_qso: matchedQso, created_qso: createdQso });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  return router;
}
