/**
 * 实物材料（QSL 卡片照片）API —— M4
 * ------------------------------------------------------------------
 * 需求④：用户上传实物卡片照片 → 管理员审核 → 审核后**立即删图**（省空间 + 隐私）。
 *
 * 隐私与安全设计：
 *   - 照片存**私有桶** `ham-awards-evidence`（不设公开读 policy，与公开桶 `ham-awards` 分开）；
 *   - 管理员查看走 **presigned GET**（15 分钟有效期），URL 不落库、不返回给申请人；
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

const EVIDENCE_BUCKET = 'ham-awards-evidence';
const PRESIGN_TTL_SECONDS = 15 * 60;
const MAX_BYTES = 5 * 1024 * 1024;

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
  // presigned URL 用对外客户端（浏览器可达的 host），未配置时退回内部客户端
  const minioPublic = () => (getMinioPublic ? getMinioPublic() : getMinio());
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

      // ★ 判定打通（2026-09-22）：卡片对应的通联信息，审核通过后据此匹配 QSO 打确认标记。
      //   对方呼号必填；波段/模式/日期可选（用于进一步缩小匹配范围）。
      const matchCallsign = String(req.body.match_callsign || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{2,20}$/.test(matchCallsign)) {
        return res.status(400).json({ error: 'BAD_CALLSIGN', message: '请填写有效的对方呼号（2-20 位字母数字）' });
      }
      const matchBand = String(req.body.match_band || '').trim().slice(0, 10);
      const matchMode = String(req.body.match_mode || '').trim().slice(0, 10);
      const matchDate = String(req.body.match_date || '').trim().slice(0, 20);

      const aw = await db().query('SELECT id, creator_id, name FROM awards WHERE id=$1', [awardId]);
      if (aw.rows.length === 0) return res.status(404).json({ error: 'AWARD_NOT_FOUND', message: '奖状不存在' });

      const ext = mime === 'image/png' ? 'png' : 'jpg';
      const key = `evidence/${req.user.id}/${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
      const sha = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

      await minio().putObject(bucket(), key, req.file.buffer, req.file.buffer.length, { 'Content-Type': mime });

      const ins = await db().query(
        `INSERT INTO award_evidence (user_id, award_id, type, note, object_key, mime, bytes, sha256, status, match_callsign, match_band, match_mode, match_date)
         VALUES ($1, $2, 'qsl_card', $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11)
         RETURNING id, status, created_at`,
        [req.user.id, awardId, note, key, mime, req.file.buffer.length, sha, matchCallsign, matchBand || null, matchMode || null, matchDate || null],
      );

      // 站内提醒（M4.1）：通知审核员（所有 admin + 该奖状创建者）有新材料待审
      const admins = await db().query(`SELECT id FROM users WHERE role='admin'`);
      const reviewerIds = admins.rows.map((r) => r.id);
      if (aw.rows[0].creator_id) reviewerIds.push(aw.rows[0].creator_id);
      await notifyUsers(db(), reviewerIds, {
        type: 'evidence_pending',
        title: '有新的实物材料待审核',
        body: `用户 ${req.user.callsign} 为奖状「${aw.rows[0].name}」上传了 QSL 卡片材料，请及时审核。`,
      });

      await audit(req, {
        action: 'evidence.upload',
        targetType: 'evidence',
        targetId: ins.rows[0].id,
        detail: { award_id: awardId, award: aw.rows[0].name, callsign: req.user.callsign, match_callsign: matchCallsign, bytes: req.file.buffer.length },
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
                e.match_callsign, e.match_band, e.match_mode, e.match_date
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

  // ---- 待审材料（admin 看全部 / award_admin 只看自己创建的奖状，附 presigned 图片地址）----
  router.get('/admin', verifyToken, verifyAwardAdmin, async (req, res) => {
    try {
      if (!minio()) return res.status(503).json({ error: 'MINIO_NOT_CONFIGURED', message: '对象存储未配置' });
      // 归属过滤：admin 看全部；award_admin 只看自己创建的奖状收到的材料
      const isAdmin = req.user.role === 'admin';
      const baseSql = `SELECT e.id, e.award_id, e.user_id, e.type, e.note, e.object_key, e.mime, e.bytes,
                e.status, e.created_at,
                e.match_callsign, e.match_band, e.match_mode, e.match_date,
                u.callsign AS user_callsign, a.name AS award_name
         FROM award_evidence e
         JOIN users u ON u.id = e.user_id
         JOIN awards a ON a.id = e.award_id
         WHERE e.status = 'pending'`;
      const r = isAdmin
        ? await db().query(`${baseSql} ORDER BY e.created_at ASC`)
        : await db().query(`${baseSql} AND a.creator_id = $1 ORDER BY e.created_at ASC`, [req.user.id]);

      const items = await Promise.all(r.rows.map(async (row) => {
        let photo_url = null;
        if (row.object_key) {
          try {
            photo_url = await minioPublic().presignedGetObject(bucket(), row.object_key, PRESIGN_TTL_SECONDS);
          } catch (err) {
            console.error('evidence presign error:', err.message);
          }
        }
        // 不把 object_key 泄露给前端
        const { object_key, ...rest } = row;
        return { ...rest, photo_url };
      }));
      res.json(items);
    } catch (e) {
      res.status(500).json({ error: e.message });
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

      // ★ 判定打通：审核通过后，按卡片填写的通联信息匹配该用户的 QSO，
      //   把对应记录的 qsl_rcvd 置 'Y'，使「实物卡片确认」真正参与奖状判定。
      let matchedQso = 0;
      if (action === 'approve' && old.rows[0].match_callsign) {
        const conds = ['user_id = $1', 'UPPER(callsign) = $2'];
        const params = [old.rows[0].user_id, old.rows[0].match_callsign];
        let n = 2;
        if (old.rows[0].match_band) { n += 1; conds.push(`LOWER(band) = LOWER($${n})`); params.push(old.rows[0].match_band); }
        if (old.rows[0].match_mode) { n += 1; conds.push(`LOWER(mode) = LOWER($${n})`); params.push(old.rows[0].match_mode); }
        if (old.rows[0].match_date) { n += 1; conds.push(`REPLACE(qso_date, '-', '') = REPLACE($${n}, '-', '')`); params.push(old.rows[0].match_date); }
        const upd = await client.query(
          `UPDATE qsos SET adif_raw = jsonb_set(adif_raw, '{qsl_rcvd}', '"Y"', true) WHERE ${conds.join(' AND ')}`,
          params,
        );
        matchedQso = upd.rowCount;
      }

      await client.query(
        `UPDATE award_evidence
         SET status=$1, reviewer_id=$2, reviewed_at=NOW(), reject_reason=$3, object_key=NULL, purged_at=NOW()
         WHERE id=$4`,
        [action === 'approve' ? 'approved' : 'rejected', req.user.id, String(reason || '').slice(0, 500) || null, id],
      );
      await client.query('COMMIT');

      // 站内提醒（M4.1）：审核结果通知上传者
      if (action === 'approve') {
        await notifyUsers(db(), [old.rows[0].user_id], {
          type: 'evidence_approved',
          title: '实物材料已通过审核',
          body: matchedQso > 0
            ? `你的实物卡片材料已通过审核，${matchedQso} 条日志已标记为「已确认」。`
            : '你的实物卡片材料已通过审核。',
        });
      } else {
        await notifyUsers(db(), [old.rows[0].user_id], {
          type: 'evidence_rejected',
          title: '实物材料被驳回',
          body: `你的实物卡片材料被驳回${reason ? '：' + reason : ''}。`,
        });
      }

      await audit(req, {
        action: 'evidence.audit',
        targetType: 'evidence',
        targetId: id,
        detail: {
          award_id: old.rows[0].award_id,
          applicant_id: old.rows[0].user_id,
          op: action,
          matched_qso: matchedQso,
          reason: String(reason || '').slice(0, 200),
        },
      });

      res.json({ success: true, matched_qso: matchedQso });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  return router;
}
