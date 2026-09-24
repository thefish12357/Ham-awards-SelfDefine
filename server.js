import express from 'express';
import http from 'http';
import pg from 'pg';
const { Pool } = pg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import otplib from 'otplib';
import qrcode from 'qrcode';
import cors from 'cors';
import * as Minio from 'minio';
import multer from 'multer';

// ---- 二次开发新增（M1：LoTW 直连，让用户不必上传日志）----
import { parseAdif } from './server/services/adif.js';
import { lookupDxcc, syncCtyFromWeb, ctyStats } from './server/services/cty.js';
import { evaluateAward as evaluateAwardCore } from './server/services/awardEngine.js';
import { configureLotwSessions } from './server/services/lotwSessions.js';
import { createLotwRouter } from './server/routes/lotw.js';
import { createEvidenceRouter } from './server/routes/evidence.js';
import { createOauthRouter } from './server/routes/oauth.js';
import { createNotificationsRouter, notifyUsers } from './server/services/notifications.js';
// 全站操作审计（仅最高级管理员可查）：敏感操作留痕，写入 best-effort 不阻断业务
import { createAuditRouter, logAudit } from './server/services/audit.js';
// 内测邀请码（门禁只加在"新账号产生"这一步，见 server/services/invites.js）
import { INVITE_TABLE_SQL, consumeInviteCode, genInviteCode, inviteError, isInviteRequired } from './server/services/invites.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

// 配置上传
const upload = multer({ dest: 'uploads/' });

// 允许用环境变量把配置指向容器卷（Docker 部署），默认仍为项目根目录下的 config.json
const CONFIG_FILE = process.env.CONFIG_FILE || path.join(__dirname, 'config.json');

// 2FA 配置
otplib.authenticator.options = { window: 1 };

let dbPool = null;
let minioClient = null;
let minioPublicClient = null; // 对外地址客户端（M4：presigned URL 需浏览器可达的 host）
/**
 * LoTW 直连的默认参数（M1 新增）。
 * 全部可在 config.json 的 lotw 段覆盖，无需改代码。
 */
const DEFAULT_LOTW_CONFIG = {
    enabled: true,               // 总开关；关掉后 /api/lotw/* 一律返回 503
    timeoutMs: 90000,            // 单次上游请求超时
    batchMaxBytes: 12582912,     // 单批 12 MiB，超过自动按日期二分重试
    maxSplitDepth: 6,            // 最多拆 6 层（最多 64 个子窗口）
    cacheTtlMinutes: 30,         // 临时会话存活时间，到期即从内存清除
    maxMemoryMb: 64,             // 所有临时会话合计的下载量上限
};

let appConfig = { 
    installed: false, 
    useHttps: false,
    minio: null,
    minioBucket: 'ham-awards',
    jwtSecret: 'default_secret_change_on_install',
    adminPath: 'admin',
    lotw: { ...DEFAULT_LOTW_CONFIG },
    // 内测门禁：requireInvite=false 时注册/建号完全不看邀请码（默认关闭，不影响存量用户）
    beta: { requireInvite: false }
};

/**
 * ==========================================
 * 1. 工具函数 & MinIO 初始化
 * ==========================================
 */
// ADIF 解析已抽到 server/services/adif.js —— 那里同时提供**流式解析器**，
// LoTW 直连需要边下载边解析，不能把整份日志读进内存。本文件顶部已 import { parseAdif }。

async function initMinioBucket() {
    if (!minioClient || !appConfig.minioBucket) return;
    try {
        const exists = await minioClient.bucketExists(appConfig.minioBucket);
        if (!exists) {
            await minioClient.makeBucket(appConfig.minioBucket, 'us-east-1');
            console.log(`Bucket '${appConfig.minioBucket}' created successfully.`);
            const policy = {
                Version: "2012-10-17",
                Statement: [{
                    Effect: "Allow",
                    Principal: { AWS: ["*"] },
                    Action: ["s3:GetObject"],
                    Resource: [`arn:aws:s3:::${appConfig.minioBucket}/*`]
                }]
            };
            await minioClient.setBucketPolicy(appConfig.minioBucket, JSON.stringify(policy));
        }

        // 私有桶（实物材料照片，M4）：**不设公开读 policy**，管理员用 presigned URL 查看
        const evidenceBucket = appConfig.evidenceBucket || 'ham-awards-evidence';
        const evExists = await minioClient.bucketExists(evidenceBucket);
        if (!evExists) {
            await minioClient.makeBucket(evidenceBucket, 'us-east-1');
            console.log(`Bucket '${evidenceBucket}' created successfully (private).`);
        }

        // ★ 用户明确要求（2026-09-22）：**不自动删除**孤儿图（上传后一直没人审的照片）。
        //   改为「站内提醒」——上传材料时会给审核员发站内通知，催他们来处理。
        //   照片保留，直到管理员手动审核（通过/驳回后仍会立即 removeObject）。
    } catch (err) {
        console.error("MinIO Bucket init error:", err);
    }
}

/**
 * 对外地址客户端（M4）：presigned URL 必须用**浏览器可达的 host** 生成，签名才能对得上。
 * 容器部署时 `minioClient` 的 `endPoint` 是内部服务名（如 `minio:9000`），浏览器解析不了；
 * 用 `publicEndPoint` 另建一个客户端（凭据相同），签出来的 URL host 才是对外地址。
 * 未配置 publicEndPoint 时退化为 `minioClient`（本机 `localhost` 场景等价）。
 */
function initMinioPublicClient() {
    minioPublicClient = null;
    if (!appConfig.minio || !appConfig.minio.endPoint) return;
    const mc = appConfig.minio;
    const host = mc.publicEndPoint || process.env.MINIO_PUBLIC_ENDPOINT || mc.endPoint;
    const port = Number(mc.publicPort || process.env.MINIO_PUBLIC_PORT || mc.port || 9000);
    // 对外地址与内部完全一致 → 直接复用 minioClient，避免重复实例
    if (host === mc.endPoint && port === Number(mc.port || 9000)) {
        minioPublicClient = minioClient;
        return;
    }
    minioPublicClient = new Minio.Client({
        endPoint: host,
        port,
        useSSL: !!mc.useSSL,
        accessKey: mc.accessKey,
        secretKey: mc.secretKey,
    });
    console.log(`MinIO public client initialized (${host}:${port}).`);
}

/**
 * ==========================================
 * 2. 系统初始化
 * ==========================================
 */
/**
 * LoTW 临时会话的运行参数（TTL / 总容量）取自 config.json 的 lotw 段。
 * 安装或加载配置后都要重新套用一次，否则改配置不生效。
 */
function applyLotwConfig() {
  const l = appConfig.lotw || {};
  configureLotwSessions({
    ttlMs: (Number(l.cacheTtlMinutes) || 30) * 60 * 1000,
    maxTotalBytes: (Number(l.maxMemoryMb) || 64) * 1024 * 1024,
  });
}

function loadConfig() {
  applyLotwConfig(); // 先用默认值套一遍，下面读到 config.json 后再覆盖
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      appConfig = { ...appConfig, ...data };
      
      if (appConfig.installed && appConfig.db) {
        dbPool = new Pool(appConfig.db);
        console.log("Database pool initialized.");
        upgradeSchema();
      }
      if (appConfig.minio && appConfig.minio.endPoint) {
        minioClient = new Minio.Client(appConfig.minio);
        console.log("MinIO client initialized.");
        initMinioPublicClient();
        initMinioBucket();
      }
    } catch (e) { 
      console.error("Config load error:", e);
      appConfig.installed = false;
    }
  } else {
    appConfig.installed = false;
  }
}

async function upgradeSchema() {
  if (!dbPool) return;
  const client = await dbPool.connect();
  try {
    // 基础用户表
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, 
        callsign VARCHAR(20) UNIQUE NOT NULL, 
        password_hash TEXT NOT NULL, 
        role VARCHAR(20) DEFAULT 'user', 
        totp_secret TEXT, 
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 修复 last_seen
    const checkCol = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='last_seen'");
    if (checkCol.rows.length === 0) {
        await client.query("ALTER TABLE users ADD COLUMN last_seen TIMESTAMP DEFAULT NOW()");
    }

    // OAuth 登录（M5）：users 加 oauth 字段，password_hash 可空（纯 OAuth 用户无密码）
    const userCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='users'");
    const userColNames = userCols.rows.map(r => r.column_name);
    if (!userColNames.includes('oauth_provider')) await client.query("ALTER TABLE users ADD COLUMN oauth_provider VARCHAR(32)");
    if (!userColNames.includes('oauth_sub')) await client.query("ALTER TABLE users ADD COLUMN oauth_sub VARCHAR(128)");
    if (!userColNames.includes('oauth_raw')) await client.query("ALTER TABLE users ADD COLUMN oauth_raw JSONB");
    await client.query("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_uniq ON users(oauth_provider, oauth_sub) WHERE oauth_provider IS NOT NULL");

    // QSO 表
    await client.query(`
      CREATE TABLE IF NOT EXISTS qsos (
        id SERIAL PRIMARY KEY, 
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        callsign VARCHAR(20),
        band VARCHAR(10),
        mode VARCHAR(10),
        dxcc VARCHAR(10),
        country VARCHAR(100),
        qso_date VARCHAR(20),
        adif_raw JSONB NOT NULL, 
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, callsign, band, mode, qso_date)
      );
    `);

    // Awards 表 - 包含新字段 tracking_id, audit_log, reject_reason
    await client.query(`
      CREATE TABLE IF NOT EXISTS awards (
        id SERIAL PRIMARY KEY, 
        name TEXT NOT NULL, 
        description TEXT, 
        bg_url TEXT,
        rules JSONB DEFAULT '[]', 
        layout JSONB DEFAULT '[]', 
        status VARCHAR(20) DEFAULT 'draft',
        creator_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        tracking_id VARCHAR(50),
        audit_log JSONB DEFAULT '[]',
        reject_reason TEXT
      );
    `);
    
    // 检查并添加新列 (用于旧数据库升级)
    const awardCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='awards'");
    const cols = awardCols.rows.map(r => r.column_name);
    if (!cols.includes('tracking_id')) await client.query("ALTER TABLE awards ADD COLUMN tracking_id VARCHAR(50)");
    if (!cols.includes('audit_log')) await client.query("ALTER TABLE awards ADD COLUMN audit_log JSONB DEFAULT '[]'");
    if (!cols.includes('reject_reason')) await client.query("ALTER TABLE awards ADD COLUMN reject_reason TEXT");

    await client.query(`
        CREATE TABLE IF NOT EXISTS user_awards (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            award_id INTEGER REFERENCES awards(id) ON DELETE CASCADE,
            issued_at TIMESTAMP DEFAULT NOW(),
            serial_number VARCHAR(20),
            level VARCHAR(50),
            score_snapshot INTEGER
        );
    `);
    
    // Check user_awards columns for upgrade
    const uaCols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='user_awards'");
    const uaColNames = uaCols.rows.map(r => r.column_name);
    if (!uaColNames.includes('serial_number')) await client.query("ALTER TABLE user_awards ADD COLUMN serial_number VARCHAR(20)");
    if (!uaColNames.includes('level')) await client.query("ALTER TABLE user_awards ADD COLUMN level VARCHAR(50)");
    if (!uaColNames.includes('score_snapshot')) await client.query("ALTER TABLE user_awards ADD COLUMN score_snapshot INTEGER");

    // 实物材料（M4）：照片存私有桶，审核后立即删图，DB 只留审核结论
    await client.query(`
      CREATE TABLE IF NOT EXISTS award_evidence (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        award_id INTEGER REFERENCES awards(id) ON DELETE CASCADE,
        type VARCHAR(20) DEFAULT 'qsl_card',
        note TEXT,
        object_key TEXT,
        mime VARCHAR(64),
        bytes INTEGER,
        sha256 CHAR(64),
        status VARCHAR(20) DEFAULT 'pending',
        reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP,
        reject_reason TEXT,
        purged_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_award_evidence_status ON award_evidence(status, created_at)`);

    // M4 判定打通（2026-09-22）：上传卡片时填对方呼号/波段/模式/日期，
    // 审核通过后据此匹配该用户的 QSO 记录并打 qsl_rcvd='Y'，使「实物卡片确认」真正参与判定。
    await client.query(`ALTER TABLE award_evidence ADD COLUMN IF NOT EXISTS match_callsign VARCHAR(20)`);
    await client.query(`ALTER TABLE award_evidence ADD COLUMN IF NOT EXISTS match_band VARCHAR(10)`);
    await client.query(`ALTER TABLE award_evidence ADD COLUMN IF NOT EXISTS match_mode VARCHAR(10)`);
    await client.query(`ALTER TABLE award_evidence ADD COLUMN IF NOT EXISTS match_date VARCHAR(20)`);
    // 通联时间（2026-09-24）：表单允许按 UTC / BJT 等时区填写，但**统一换算成 UTC 后入库与匹配**。
    // match_time = UTC 的 HHMM；match_tz_offset = 用户填写时用的时区偏移（仅用于展示，不参与匹配）。
    await client.query(`ALTER TABLE award_evidence ADD COLUMN IF NOT EXISTS match_time VARCHAR(4)`);
    await client.query(`ALTER TABLE award_evidence ADD COLUMN IF NOT EXISTS match_tz_offset INTEGER`);

    // 站内通知（M4.1）：审核员待审提醒 + 申请人审核结果通知
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(32),
        title TEXT,
        body TEXT,
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read)`);

    // 角色升级申请（普通用户 → 奖状管理员，需 admin 审核）
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        requested_role VARCHAR(20) DEFAULT 'award_admin',
        status VARCHAR(20) DEFAULT 'pending',
        reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP,
        reject_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // 升级申请表单字段（用户要求：填写拟创建的奖状名称、理由等）
    await client.query(`ALTER TABLE role_requests ADD COLUMN IF NOT EXISTS award_name VARCHAR(200)`);
    await client.query(`ALTER TABLE role_requests ADD COLUMN IF NOT EXISTS reason TEXT`);
    await client.query(`ALTER TABLE role_requests ADD COLUMN IF NOT EXISTS experience TEXT`);
    await client.query(`ALTER TABLE role_requests ADD COLUMN IF NOT EXISTS contact VARCHAR(200)`);

    // 全站操作审计（2026-09-23）：全站级敏感操作留痕，仅最高级管理员可查。
    // 与 awards.audit_log（单个奖状的业务流水）分工不同，详见 server/services/audit.js。
    // actor_id 用 ON DELETE SET NULL：账号注销后仍保留 actor_callsign，能追溯"当时是谁"。
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        actor_callsign VARCHAR(32),
        actor_role VARCHAR(20),
        action VARCHAR(64) NOT NULL,
        target_type VARCHAR(32),
        target_id VARCHAR(64),
        detail JSONB,
        ip VARCHAR(64),
        ua TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC)`);

    // 内测邀请码（2026-09-23）：门禁只作用于"新账号产生"，存量账号登录不受影响。
    // 总开关是 config.json 的 beta.requireInvite，内测结束在后台一键关掉即可。
    await client.query(INVITE_TABLE_SQL);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code)`);
    // 记住"这个账号是用哪个邀请码进来的"，管理页可直接按码看使用者
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code VARCHAR(32)`);

    // 修复旧表（award_evidence）reviewer_id 外键删除行为：应 ON DELETE SET NULL
    // （否则删除「审核过材料」的管理员账号会报外键约束错误，见 2026-09-22 联调）
    try {
        const fkRows = await client.query(`
            SELECT conname AS constraint_name
            FROM pg_constraint
            WHERE conrelid = 'award_evidence'::regclass
              AND contype = 'f'
              AND confdeltype <> 'n'
              AND conname LIKE '%reviewer_id%'
        `);
        for (const row of fkRows.rows) {
            await client.query(`ALTER TABLE award_evidence DROP CONSTRAINT ${row.constraint_name}`);
            await client.query(`ALTER TABLE award_evidence ADD CONSTRAINT ${row.constraint_name} FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL`);
        }
    } catch (e) {
        console.error('award_evidence reviewer_id FK fix error:', e.message);
    }

    console.log("Database schema checked.");
  } catch (err) {
    console.error("Schema upgrade error:", err.message);
  } finally {
    client.release();
  }
}

/**
 * ==========================================
 * 3. 核心逻辑：奖状判定引擎 (Advanced Award Engine)
 * ==========================================
 */

// 奖状判定引擎的纯函数实现已抽到 server/services/awardEngine.js，
// 这样「数据库里的 QSO」与「LoTW 直连的临时会话记录」可以共用同一套判定逻辑，
// 避免两处实现漂移。这里保留原函数签名，只负责取数据，既有调用方无需改动。
const evaluateAward = async (userId, awardId, includeQsos = false) => {
    const client = await dbPool.connect();
    try {
        const awardRes = await client.query('SELECT * FROM awards WHERE id = $1', [awardId]);
        if (awardRes.rows.length === 0) throw new Error('Award not found');

        // TODO(性能)：目前仍把该用户的全部 QSO 拉进应用内存再过滤，QSO 上万后会变慢。
        // 计划改为 SQL 侧过滤 + 分页，见 ROADMAP §7「奖状规则引擎升级」。
        const qsoRes = await client.query('SELECT * FROM qsos WHERE user_id = $1', [userId]);
        const claimedRes = await client.query(
            'SELECT level FROM user_awards WHERE user_id=$1 AND award_id=$2',
            [userId, awardId]
        );

        return evaluateAwardCore({
            rules: awardRes.rows[0].rules,
            qsos: qsoRes.rows,
            claimedLevels: claimedRes.rows.map(r => r.level),
            includeQsos,
        });
    } finally {
        client.release();
    }
};

/**
 * ==========================================
 * 4. 中间件与权限
 * ==========================================
 */

const verifyToken = async (req, res, next) => {
  if (!appConfig.installed && req.path.startsWith('/api/install')) return next();
  if (req.path === '/api/system-status' || req.path === '/api/auth/login' || req.path === '/api/auth/register') return next(); 
  // 公开路径（M3 新增）：
  //   /api/verify/*  奖状真伪校验 + 二维码，供拿到纸质/PDF 奖状的人扫码查验，必须免登录
  //   /api/media     同源图片代理，供前端 canvas 导出 PDF 时避免跨域污染画布
  if (req.path.startsWith('/api/verify') || req.path.startsWith('/api/media') || req.path.startsWith('/api/auth/oauth')) return next();

  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'TOKEN_MISSING', message: '未提供验证令牌' });
  
  let decoded;
  try {
    decoded = jwt.verify(token.split(' ')[1], appConfig.jwtSecret);
  } catch (err) { 
    return res.status(401).json({ error: 'TOKEN_INVALID', message: '无效或过期的令牌' }); 
  }

  req.user = decoded; 
  if (dbPool && req.user && req.user.id) {
      dbPool.query('UPDATE users SET last_seen = NOW() WHERE id = $1', [req.user.id])
          .catch(err => console.error("Update last_seen failed:", err.message));
  }
  next();
};

const verifyAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'PERMISSION_DENIED', message: '需要系统管理员权限' });
  next();
};

const verifyAwardAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'award_admin') return res.status(403).json({ error: 'PERMISSION_DENIED', message: '需要奖状管理员权限' });
  next();
};

const require2FA = async (req, res, next) => {
    try {
        const result = await dbPool.query('SELECT totp_secret FROM users WHERE id = $1', [req.user.id]);
        const secret = result.rows[0]?.totp_secret;
        if (!secret) return next(); 

        const code = req.headers['x-2fa-code']; 
        if (!code) return res.status(403).json({ error: '2FA_REQUIRED', message: '此操作需要2FA验证' });
        
        if (!otplib.authenticator.check(code, secret)) {
            return res.status(403).json({ error: 'INVALID_2FA', message: '验证码错误' });
        }
        next();
    } catch (e) { res.status(500).json({ error: 'Server Error' }); }
};

const requirePassword = async (req, res, next) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'PASSWORD_REQUIRED', message: '需要密码确认' });
    try {
        const r = await dbPool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
        const match = await bcrypt.compare(password, r.rows[0].password_hash);
        if (!match) return res.status(401).json({ error: 'PASSWORD_INVALID', message: '密码错误' });
        next();
    } catch(e) { res.status(500).json({ error: 'Server Error' }); }
};

/**
 * ==========================================
 * 5. API 路由
 * ==========================================
 */

// --- LoTW 直连（M1 新增）---
// 用工厂函数注入依赖，避免 server.js 与 routes/lotw.js 相互 import 形成循环。
app.use('/api/lotw', createLotwRouter({
    getDbPool: () => dbPool,
    verifyToken,
    getConfig: () => appConfig,
}));

// --- 实物材料（M4 新增）---
app.use('/api/evidence', createEvidenceRouter({
    getDbPool: () => dbPool,
    verifyToken,
    verifyAwardAdmin,
    getConfig: () => appConfig,
    getMinio: () => minioClient,
    getMinioPublic: () => minioPublicClient || minioClient,
    logAudit,
}));

// --- 站内通知（M4.1 新增）---
app.use('/api/notifications', createNotificationsRouter({
    getDbPool: () => dbPool,
    verifyToken,
}));

// --- 全站操作审计（仅 admin 可查）---
app.use('/api/admin/audit-logs', createAuditRouter({
    getDbPool: () => dbPool,
    verifyToken,
    verifyAdmin,
}));

// --- HamCQ OAuth 登录（M5 新增）---
app.use('/api/auth/oauth', createOauthRouter({
    getDbPool: () => dbPool,
    getConfig: () => appConfig,
    logAudit,
}));

// --- 基础 & 认证 ---

app.get('/api/system-status', (req, res) => {
    res.json({ 
        installed: appConfig.installed, 
        useHttps: appConfig.useHttps,
        adminPath: appConfig.adminPath || 'admin',
        minioConfigured: !!appConfig.minio,
        // 内测开关：登录/注册页据此决定是否显示邀请码输入框（公开信息，无敏感内容）
        requireInvite: isInviteRequired(appConfig)
    });
});

app.post('/api/install', async (req, res) => {
  if (appConfig.installed) return res.status(400).json({ error: '系统已安装' });
  const { dbHost, dbPort, dbUser, dbPass, dbName, adminCall, adminPass, adminPath, minio, useHttps, minioBucket } = req.body;
  
  let tempPool = new Pool({ user: dbUser, host: dbHost, database: dbName, password: dbPass, port: dbPort });
  let client;

  try {
    client = await tempPool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, callsign VARCHAR(20) UNIQUE NOT NULL, password_hash TEXT NOT NULL, role VARCHAR(20) DEFAULT 'user', totp_secret TEXT, created_at TIMESTAMP DEFAULT NOW(), last_seen TIMESTAMP DEFAULT NOW());
    `);
    
    const hash = await bcrypt.hash(adminPass, 10);
    await client.query('DELETE FROM users WHERE callsign = $1', [adminCall.toUpperCase()]);
    await client.query(`INSERT INTO users (callsign, password_hash, role) VALUES ($1, $2, 'admin')`, [adminCall.toUpperCase(), hash]);

    const newConfig = { 
        installed: true, 
        jwtSecret: crypto.randomBytes(64).toString('hex'), 
        db: { user: dbUser, host: dbHost, database: dbName, password: dbPass, port: dbPort },
        minio: minio,
        minioBucket: minioBucket || 'ham-awards', 
        useHttps: !!useHttps,
        adminPath: adminPath || 'admin',
        // LoTW 直连参数（M1 新增），写进 config.json 方便直接调整
        lotw: { ...DEFAULT_LOTW_CONFIG }
    };
    
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
    appConfig = newConfig; 
    applyLotwConfig(); // 让 lotw 段的 TTL / 容量立即生效
    dbPool = tempPool;
    
    if (appConfig.minio) {
        minioClient = new Minio.Client(appConfig.minio);
        initMinioPublicClient();
        await initMinioBucket(); 
    }
    
    await upgradeSchema();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); } finally { if (client) client.release(); }
});

app.post('/api/auth/login', async (req, res) => {
    const { callsign, password, code } = req.body;
    try {
        const result = await dbPool.query(`SELECT * FROM users WHERE callsign = $1`, [callsign.toUpperCase()]);
        if (result.rows.length === 0) {
            // 登录失败也留痕（爆破排查用）：只记呼号与原因，不记密码
            await logAudit(dbPool, req, { action: 'auth.login_failed', detail: { callsign: String(callsign || '').slice(0, 32), reason: 'NO_USER' } });
            return res.status(401).json({ error: 'AUTH_FAILED', message: '用户不存在' });
        }
        const user = result.rows[0];

        const passMatch = await bcrypt.compare(password, user.password_hash);
        if (!passMatch) {
            await logAudit(dbPool, req, { action: 'auth.login_failed', targetType: 'user', targetId: user.id, detail: { callsign: user.callsign, reason: 'BAD_PASSWORD' } });
            return res.status(401).json({ error: 'AUTH_FAILED', message: '密码错误' });
        }

        // Removed role guard to allow merged login
        // if (loginType === 'admin' && user.role === 'user') { ... }

        if (user.totp_secret) {
            if (!code) return res.status(403).json({ error: '2FA_REQUIRED', message: '请输入两步验证码' });
            if (!otplib.authenticator.check(code, user.totp_secret)) {
                await logAudit(dbPool, req, { action: 'auth.login_failed', targetType: 'user', targetId: user.id, detail: { callsign: user.callsign, reason: 'BAD_2FA' } });
                return res.status(403).json({ error: 'INVALID_2FA', message: '验证码无效' });
            }
        }

        const token = jwt.sign({ id: user.id, role: user.role, callsign: user.callsign }, appConfig.jwtSecret, { expiresIn: '24h' });
        await logAudit(dbPool, req, { action: 'auth.login', targetType: 'user', targetId: user.id, actor: { id: user.id, callsign: user.callsign, role: user.role } });
        res.json({ token, user: { id: user.id, callsign: user.callsign, role: user.role, has2fa: !!user.totp_secret } });
    } catch (e) { console.error(e); res.status(500).json({ error: 'SERVER_ERROR' }); }
});

app.post('/api/auth/register', async (req, res) => {
    const { callsign, password, invite_code: inviteCode } = req.body;
    const callsignUp = String(callsign || '').toUpperCase();
    try {
        // 先查重再消费邀请码：否则撞呼号时会把码白白用掉一次
        const dup = await dbPool.query('SELECT id FROM users WHERE callsign = $1', [callsignUp]);
        if (dup.rows.length > 0) return res.status(400).json({ error: 'EXISTS', message: '呼号已被注册' });

        // 内测门禁（默认关闭）：只在开启时校验，存量用户登录完全不受影响
        let usedCode = null;
        if (isInviteRequired(appConfig)) {
            const check = await consumeInviteCode(dbPool, inviteCode);
            if (!check.ok) {
                const { status, body } = inviteError(check.reason, 'register');
                return res.status(status).json(body);
            }
            usedCode = check.code;
        }

        const hash = await bcrypt.hash(password, 10);
        const ins = await dbPool.query(
            `INSERT INTO users (callsign, password_hash, role, invite_code) VALUES ($1, $2, 'user', $3) RETURNING id`,
            [callsignUp, hash, usedCode],
        );
        await logAudit(dbPool, req, {
            action: 'auth.register',
            targetType: 'user',
            targetId: ins.rows[0]?.id,
            detail: { callsign: callsignUp.slice(0, 32), role: 'user', invite_code: usedCode || undefined },
        });
        if (usedCode) {
            await logAudit(dbPool, req, {
                action: 'invite.use',
                targetType: 'invite',
                targetId: usedCode,
                detail: { callsign: callsignUp.slice(0, 32), channel: 'register' },
            });
        }
        res.json({ success: true });
    } catch (e) {
        if (e.code === '23505') res.status(400).json({ error: 'EXISTS', message: '呼号已被注册' });
        else res.status(500).json({ error: 'ERROR', message: e.message });
    }
});

// --- 统计概览 ---

app.get('/api/stats/dashboard', verifyToken, async (req, res) => {
    const { role, id } = req.user;
    const client = await dbPool.connect();
    
    try {
        let stats = {};

        if (role === 'user') {
            const qsoCount = await client.query('SELECT count(*) FROM qsos WHERE user_id=$1', [id]);
            const bandCount = await client.query('SELECT count(DISTINCT band) FROM qsos WHERE user_id=$1', [id]);
            const modeCount = await client.query('SELECT count(DISTINCT mode) FROM qsos WHERE user_id=$1', [id]);
            const dxccCount = await client.query('SELECT count(DISTINCT dxcc) FROM qsos WHERE user_id=$1', [id]);
            const awardCount = await client.query('SELECT count(*) FROM user_awards WHERE user_id=$1', [id]);

            stats = {
                qsos: qsoCount.rows[0].count,
                bands: bandCount.rows[0].count,
                modes: modeCount.rows[0].count,
                dxccs: dxccCount.rows[0].count,
                my_awards: awardCount.rows[0].count
            };
        } else if (role === 'award_admin') {
            // 修正：奖状管理员只看自己的数据
            const totalApproved = await client.query("SELECT count(*) FROM awards WHERE creator_id=$1 AND status = 'approved'", [id]);
            const myDrafts = await client.query("SELECT count(*) FROM awards WHERE creator_id=$1 AND status='draft'", [id]);
            const pending = await client.query("SELECT count(*) FROM awards WHERE creator_id=$1 AND status='pending'", [id]);
            const returned = await client.query("SELECT count(*) FROM awards WHERE creator_id=$1 AND status='returned'", [id]);
            
            stats = {
                my_approved: totalApproved.rows[0].count,
                my_drafts: myDrafts.rows[0].count,
                my_pending: pending.rows[0].count,
                my_returned: returned.rows[0].count
            };
        } else if (role === 'admin') {
            const onlineTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            let onlineUsers = { rows: [] };
            try {
                onlineUsers = await client.query(`SELECT role, count(*) as count FROM users WHERE last_seen > $1 GROUP BY role`, [onlineTime]);
            } catch (err) {}

            const totalUsers = await client.query('SELECT role, count(*) as count FROM users GROUP BY role');
            const totalAwards = await client.query("SELECT count(*) FROM awards WHERE status = 'approved'");
            const pendingAwards = await client.query("SELECT count(*) FROM awards WHERE status = 'pending'");
            // 修正：显示当前系统中已经颁发的全部奖状计数
            const totalIssued = await client.query("SELECT count(*) FROM user_awards");

            // ★ admin 现在也能建奖状并发起审核（2026-09-24）：
            //   除了全局统计，也把自己当"奖状制作者"的那份统计给前端（草稿箱红点、我的发布等）
            const myApproved = await client.query("SELECT count(*) FROM awards WHERE creator_id=$1 AND status='approved'", [id]);
            const myDrafts = await client.query("SELECT count(*) FROM awards WHERE creator_id=$1 AND status='draft'", [id]);
            const myPending = await client.query("SELECT count(*) FROM awards WHERE creator_id=$1 AND status='pending'", [id]);
            const myReturned = await client.query("SELECT count(*) FROM awards WHERE creator_id=$1 AND status='returned'", [id]);

            stats = {
                system_status: 'running',
                online_users: onlineUsers.rows,
                total_users: totalUsers.rows,
                awards_approved: totalAwards.rows[0].count,
                awards_pending: pendingAwards.rows[0].count,
                awards_issued: totalIssued.rows[0].count, // Added global total count
                my_approved: myApproved.rows[0].count,
                my_drafts: myDrafts.rows[0].count,
                my_pending: myPending.rows[0].count,
                my_returned: myReturned.rows[0].count
            };
        }
        res.json(stats);
    } catch (e) {
        console.error("Dashboard error:", e);
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});


// --- 用户中心 ---

app.get('/api/user/profile', verifyToken, async (req, res) => {
    const r = await dbPool.query('SELECT id, callsign, role, totp_secret, created_at FROM users WHERE id=$1', [req.user.id]);
    const u = r.rows[0];
    res.json({ ...u, has2fa: !!u.totp_secret, totp_secret: undefined });
});

app.post('/api/user/2fa/setup', verifyToken, async (req, res) => {
    const secret = otplib.authenticator.generateSecret();
    const otpauth = otplib.authenticator.keyuri(req.user.callsign, 'HamAwards', secret);
    const imgData = await qrcode.toDataURL(otpauth);
    res.json({ secret, qr: imgData });
});

app.post('/api/user/2fa/enable', verifyToken, async (req, res) => {
    const { secret, token } = req.body;
    if (otplib.authenticator.check(token, secret)) {
        await dbPool.query('UPDATE users SET totp_secret = $1 WHERE id = $2', [secret, req.user.id]);
        await logAudit(dbPool, req, { action: 'user.2fa_enable', targetType: 'user', targetId: req.user.id });
        res.json({ success: true });
    } else {
        res.status(400).json({ error: '验证码无效' });
    }
});

app.post('/api/user/2fa/disable', verifyToken, async (req, res) => {
    const { password } = req.body;
    const client = await dbPool.connect();
    try {
        const r = await client.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
        const match = await bcrypt.compare(password, r.rows[0].password_hash);
        if(!match) return res.status(401).json({error: '密码错误'});
        await client.query('UPDATE users SET totp_secret=NULL WHERE id=$1', [req.user.id]);
        await logAudit(dbPool, req, { action: 'user.2fa_disable', targetType: 'user', targetId: req.user.id });
        res.json({ success: true });
    } finally { client.release(); }
});

app.post('/api/user/password', verifyToken, require2FA, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const client = await dbPool.connect();
    try {
        const r = await client.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
        const match = await bcrypt.compare(oldPassword, r.rows[0].password_hash);
        if(!match) return res.status(401).json({error: '旧密码错误'});
        const hash = await bcrypt.hash(newPassword, 10);
        await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
        await logAudit(dbPool, req, { action: 'user.password_change', targetType: 'user', targetId: req.user.id });
        res.json({ success: true });
    } finally { client.release(); }
});

app.delete('/api/user/logs', verifyToken, requirePassword, require2FA, async (req, res) => {
    const deleted = await dbPool.query('DELETE FROM qsos WHERE user_id=$1', [req.user.id]);
    await logAudit(dbPool, req, { action: 'user.logs_clear', targetType: 'user', targetId: req.user.id, detail: { deleted: deleted.rowCount } });
    res.json({ success: true });
});

app.delete('/api/user/account', verifyToken, requirePassword, require2FA, async (req, res) => {
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        // 将该用户创建的奖状设置为无主 (避免外键约束错误)
        await client.query('UPDATE awards SET creator_id = NULL WHERE creator_id = $1', [req.user.id]);
        // 审计要在删除前写：audit_logs.actor_id 是 ON DELETE SET NULL，
        // 用户被删后该字段自动置空，但 actor_callsign 仍保留，可追溯。
        await logAudit(dbPool, req, { action: 'user.account_delete', targetType: 'user', targetId: req.user.id });
        // 删除用户 (QSOS 和 user_awards 会自动级联删除)
        await client.query('DELETE FROM users WHERE id=$1', [req.user.id]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

// --- 日志上传 ---

app.post('/api/logbook/upload', verifyToken, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
        const raw = fs.readFileSync(req.file.path, 'utf8');
        const records = parseAdif(raw);
        let imported = 0;
        const client = await dbPool.connect();
        try {
            await client.query('BEGIN');
            for (let r of records) {
                // ADIF 自带 DXCC/COUNTRY 字段时**直接用**；缺一字段时按 cty.dat 反查呼号补全。
                let dxNum = r.dxcc || '';
                let dxName = r.country || '';
                if ((!dxNum || !dxName) && r.call) {
                    const dx = lookupDxcc(r.call);
                    if (dx) {
                        if (!dxNum) dxNum = dx.dxcc || '';
                        if (!dxName) dxName = dx.name || '';
                    }
                }
                await client.query(`
                    INSERT INTO qsos (user_id, callsign, band, mode, qso_date, dxcc, country, adif_raw)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (user_id, callsign, band, mode, qso_date) DO NOTHING
                `, [req.user.id, r.call || '', r.band || '', r.mode || '', r.qso_date || '', dxNum, dxName, JSON.stringify(r)]);
                imported++;
            }
            await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); fs.unlinkSync(req.file.path); }
        res.json({ success: true, count: records.length, imported });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 奖状管理 (核心重构) ---

// 获取我的奖状 (奖状管理员)
app.get('/api/awards/my', verifyToken, verifyAwardAdmin, async (req, res) => {
    const { status } = req.query;
    let query = `SELECT * FROM awards WHERE creator_id = $1`;
    const params = [req.user.id];
    
    if (status) {
        if (status === 'drafts') {
            // drafts: 包含纯草稿
            query += ` AND status = 'draft'`;
        } else if (status === 'returned') {
            query += ` AND status = 'returned'`;
        } else if (status === 'audit_list') {
            // audit_list: 包含历史提交记录 (pending, approved, returned)
            query += ` AND status IN ('pending', 'approved', 'returned')`;
        }
    }
    
    query += ` ORDER BY created_at DESC`;
    const r = await dbPool.query(query, params);
    res.json(r.rows);
});

// 获取所有已发布的奖状 (公共大厅 / 系统总览)
// ★ 权限收口（2026-09-23）：这里是**任何登录用户**都能调的公开大厅接口，
//   因此不再返回 `audit_log` / `reject_reason` —— 单个奖状的审核流水
//   （谁提交、谁打回、原因）只给「该奖状的管理员 + 最高级管理员」看：
//     · 该奖状的管理员 → `/api/awards/my`（只查 creator_id = 自己）
//     · 最高级管理员   → `/api/admin/awards/pending|approved`
//   改成显式列名（而非 `*`）就是为了避免以后加敏感列时又被顺手带出去。
app.get('/api/awards/all_approved', verifyToken, async (req, res) => {
    const r = await dbPool.query(
        `SELECT id, name, description, bg_url, rules, layout, status, creator_id, tracking_id, created_at
           FROM awards WHERE status = 'approved' ORDER BY id DESC`,
    );
    res.json(r.rows);
});

// 系统管理员：获取待审核奖状
app.get('/api/admin/awards/pending', verifyToken, verifyAdmin, async (req, res) => {
    const r = await dbPool.query(`SELECT awards.*, users.callsign as creator_call FROM awards JOIN users ON awards.creator_id = users.id WHERE status = 'pending' ORDER BY created_at ASC`);
    res.json(r.rows);
});

// 系统管理员：获取已发布奖状 (用于抽查)
app.get('/api/admin/awards/approved', verifyToken, verifyAdmin, async (req, res) => {
    const r = await dbPool.query(`SELECT awards.*, users.callsign as creator_call FROM awards JOIN users ON awards.creator_id = users.id WHERE status = 'approved' ORDER BY created_at DESC`);
    res.json(r.rows);
});

// 系统管理员：获取已颁发奖状列表 (New)
app.get('/api/admin/issued-awards', verifyToken, verifyAdmin, async (req, res) => {
    const r = await dbPool.query(`
        SELECT ua.id, ua.serial_number, ua.issued_at, ua.level, 
               u.callsign as applicant_call, 
               a.name as award_name, a.tracking_id
        FROM user_awards ua
        JOIN users u ON ua.user_id = u.id
        JOIN awards a ON ua.award_id = a.id
        ORDER BY ua.issued_at DESC
    `);
    res.json(r.rows);
});

// 系统管理员：删除/撤销已颁发的奖状 (New)
app.delete('/api/admin/issued-awards/:id', verifyToken, verifyAdmin, async (req, res) => {
    // 撤销颁发是最具破坏性的操作之一：先把被删的对象信息抓下来留痕，再删
    const old = await dbPool.query(
        `SELECT ua.serial_number, ua.level, u.callsign AS applicant_call, a.name AS award_name
           FROM user_awards ua
           JOIN users u ON ua.user_id = u.id
           JOIN awards a ON ua.award_id = a.id
          WHERE ua.id = $1`,
        [req.params.id],
    );
    await dbPool.query('DELETE FROM user_awards WHERE id=$1', [req.params.id]);
    await logAudit(dbPool, req, {
        action: 'award.issued_delete',
        targetType: 'award_issued',
        targetId: req.params.id,
        detail: old.rows[0]
            ? { serial: old.rows[0].serial_number, level: old.rows[0].level, applicant: old.rows[0].applicant_call, award: old.rows[0].award_name }
            : null,
    });
    res.json({ success: true });
});

// 系统管理员：审核操作 (通过/打回/撤回)
app.post('/api/admin/awards/audit', verifyToken, verifyAdmin, async (req, res) => {
    const { id, action, reason } = req.body; // action: 'approve', 'reject', 'recall'
    
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        
        const old = await client.query('SELECT status, audit_log, name, creator_id FROM awards WHERE id=$1', [id]);
        if(old.rows.length === 0) throw new Error("Award not found");
        
        let newStatus = '';
        let logEntry = {
            time: new Date().toISOString(),
            actor: req.user.callsign,
            action: action,
            reason: reason || ''
        };
        
        let currentLog = old.rows[0].audit_log || [];
        
        if (action === 'approve') {
            newStatus = 'approved';
        } else if (action === 'reject' || action === 'recall') {
            newStatus = 'returned';
            if (!reason) throw new Error("必须填写打回/撤回原因");
        } else {
            throw new Error("Invalid action");
        }

        currentLog.push(logEntry);

        await client.query(
            `UPDATE awards SET status=$1, audit_log=$2, reject_reason=$3 WHERE id=$4`,
            [newStatus, JSON.stringify(currentLog), reason || null, id]
        );
        
        await client.query('COMMIT');

        await logAudit(dbPool, req, {
            action: 'award.audit',
            targetType: 'award',
            targetId: id,
            detail: { award: old.rows[0].name, creator_id: old.rows[0].creator_id, op: action, result: newStatus, reason: reason || '' },
        });

        // 站内通知（M4.1）：奖状审核通过/退回 → 通知创建者
        if (old.rows[0].creator_id) {
            const approved = action === 'approve';
            await notifyUsers(dbPool, [old.rows[0].creator_id], {
                type: approved ? 'award_approved' : 'award_returned',
                title: approved ? '奖状已通过审核' : '奖状被退回',
                body: approved
                    ? `你提交的奖状「${old.rows[0].name}」已通过审核并发布。`
                    : `你提交的奖状「${old.rows[0].name}」被退回${reason ? '：' + reason : ''}。`,
            });
        }

        res.json({ success: true });
    } catch(e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

// 创建/更新奖状 (奖状管理员)
app.post('/api/awards', verifyToken, verifyAwardAdmin, async (req, res) => {
    const { id, name, description, rules, layout, bg_url, status } = req.body;
    
    // 生成/更新 tracking_id 和日志
    const trackingId = id ? undefined : crypto.randomBytes(4).toString('hex').toUpperCase();
    
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');

        let logEntry = {
            time: new Date().toISOString(),
            actor: req.user.callsign,
            action: status === 'pending' ? 'submitted' : 'saved_draft',
            details: status === 'pending' ? '提交审核' : '保存草稿'
        };

        if (id) {
            // 更新
            const old = await client.query('SELECT audit_log FROM awards WHERE id=$1', [id]);
            let logs = old.rows[0].audit_log || [];
            logs.push(logEntry);
            
            // 如果是重新提交，清空拒绝原因
            const rejectReasonUpdate = status === 'pending' ? null : undefined;
            
            let updateSql = `UPDATE awards SET name=$1, description=$2, rules=$3, layout=$4, bg_url=$5, status=$6, audit_log=$7`;
            let params = [name, description, JSON.stringify(rules), JSON.stringify(layout), bg_url, status, JSON.stringify(logs)];
            
            if (status === 'pending') {
                updateSql += `, reject_reason=NULL`; // 清空原因
            }
            
            updateSql += ` WHERE id=$8`;
            params.push(id);
            
            await client.query(updateSql, params);
            await logAudit(dbPool, req, {
                action: 'award.save',
                targetType: 'award',
                targetId: id,
                detail: { award: name, status, mode: 'update' },
            });
            // ★ 提交审核 → 通知所有最高级管理员。
            //   侧边栏「奖状审核」的红点就来自这条 award_pending 通知（点进去即清），
            //   不再依赖"待审数量"那种点了也消不掉的计数。
            if (status === 'pending') {
                const admins = await dbPool.query(`SELECT id FROM users WHERE role='admin'`);
                await notifyUsers(dbPool, admins.rows.map((r) => r.id), {
                    type: 'award_pending',
                    title: '有新的奖状待审核',
                    body: `${req.user.callsign} 重新提交了奖状「${name}」，请到「奖状审核」处理。`,
                });
            }
            res.json({ success: true, id });
        } else {
            // 新建
            // 修复：必须把新建记录的 id 返回给前端，否则调用方拿不到新对象
            // （既无法继续编辑，也无法在列表中定位刚创建的奖状）
            const inserted = await client.query(
                `INSERT INTO awards (name, description, rules, layout, bg_url, status, creator_id, tracking_id, audit_log) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
                [name, description, JSON.stringify(rules), JSON.stringify(layout), bg_url, status, req.user.id, trackingId, JSON.stringify([logEntry])]
            );
            await logAudit(dbPool, req, {
                action: 'award.save',
                targetType: 'award',
                targetId: inserted.rows[0].id,
                detail: { award: name, status, mode: 'create' },
            });
            // 同上：新建并直接提交审核时通知管理员（侧边栏「奖状审核」红点）
            if (status === 'pending') {
                const admins = await dbPool.query(`SELECT id FROM users WHERE role='admin'`);
                await notifyUsers(dbPool, admins.rows.map((r) => r.id), {
                    type: 'award_pending',
                    title: '有新的奖状待审核',
                    body: `${req.user.callsign} 提交了奖状「${name}」，请到「奖状审核」处理。`,
                });
            }
            res.json({ success: true, id: inserted.rows[0].id });
        }
        await client.query('COMMIT');
    } catch(e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

app.delete('/api/awards/:id', verifyToken, verifyAwardAdmin, async (req, res) => {
    // 只能删除自己的 Draft 或 Returned
    const del = await dbPool.query(`DELETE FROM awards WHERE id=$1 AND creator_id=$2 AND status IN ('draft', 'returned')`, [req.params.id, req.user.id]);
    // 只有真的删掉了才记账（否则是越权/状态不符，空记录反而误导）
    if (del.rowCount > 0) {
        await logAudit(dbPool, req, { action: 'award.delete', targetType: 'award', targetId: req.params.id });
    }
    res.json({ success: true });
});

app.post('/api/awards/upload-bg', verifyToken, verifyAwardAdmin, upload.single('bg'), async (req, res) => {
    if (!req.file || !minioClient) return res.status(400).json({ error: 'Upload failed or MinIO not configured' });
    const meta = { 'Content-Type': req.file.mimetype };
    // ★ 绝不要用 originalname 做对象名：multipart 的 filename 被 multer/busboy 按 latin1 解码，
    //   中文会变成乱码（"QQ截图" → "QQæªå¾"），对象名与 URL 从此永久失配，图片再也加载不出来
    //   （表现为预览/导出 PDF 缺图，甚至因图片加载失败让导出卡住）。
    //   只取扩展名，主体用时间戳 + 随机串，彻底规避编码问题。
    const rawExt = path.extname(req.file.originalname || '').toLowerCase();
    const ext = /^\.[a-z0-9]{1,5}$/.test(rawExt) ? rawExt : '.png';
    const fileName = `awards/bg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`;
    try {
        await minioClient.putObject(appConfig.minioBucket, fileName, fs.createReadStream(req.file.path), meta);
        // 写进数据库的是给浏览器直接访问的绝对地址，需要能解析到 MinIO。
        // 容器里存对象走服务名（minio:9000），但浏览器解析不了服务名，
        // 因此允许配置/环境变量单独指定对外地址。
        const mc = appConfig.minio;
        const publicHost = mc.publicEndPoint || process.env.MINIO_PUBLIC_ENDPOINT || mc.endPoint;
        const publicPort = mc.publicPort || process.env.MINIO_PUBLIC_PORT || mc.port;
        const protocol = mc.useSSL ? 'https://' : 'http://';
        const fullUrl = `${protocol}${publicHost}:${publicPort}/${appConfig.minioBucket}/${fileName}`;
        fs.unlinkSync(req.file.path);
        res.json({ url: fullUrl });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 奖状申请 & 检查 API (New) ---

app.get('/api/awards/:id/check', verifyToken, async (req, res) => {
    try {
        const includeQsos = req.query.include_qsos === 'true';
        const result = await evaluateAward(req.user.id, req.params.id, includeQsos);
        res.json(result);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/awards/:id/apply', verifyToken, async (req, res) => {
    try {
        const { eligible, achieved_level, current_score } = await evaluateAward(req.user.id, req.params.id);
        if (!eligible) return res.status(400).json({ error: 'Conditions not met', message: '未满足申请条件' });

        const levelName = achieved_level.name;

        // Check if already applied for this level
        const exists = await dbPool.query('SELECT id FROM user_awards WHERE user_id=$1 AND award_id=$2 AND level=$3', [req.user.id, req.params.id, levelName]);
        if (exists.rows.length > 0) return res.status(400).json({ error: 'Already applied', message: `您已领取过此等级(${levelName})的奖状` });

        // Generate 16-digit Serial
        // 用 crypto.randomInt 逐位生成（原实现用 Math.random()，非密码学安全）
        let serial = '';
        for (let i = 0; i < 16; i += 1) serial += crypto.randomInt(0, 10);

        await dbPool.query(
            'INSERT INTO user_awards (user_id, award_id, level, score_snapshot, serial_number) VALUES ($1, $2, $3, $4, $5)', 
            [req.user.id, req.params.id, levelName, current_score, serial]
        );
        await logAudit(dbPool, req, {
            action: 'award.apply',
            targetType: 'award',
            targetId: req.params.id,
            detail: { level: levelName, score: current_score, serial },
        });
        res.json({ success: true, serial, level: levelName });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/user/my-awards', verifyToken, async (req, res) => {
    // Join user_awards with awards to get details
    // Added a.rules to fetch badge colors
    // Added a.layout (M3)：导出 PDF 需要奖状的可视化布局
    const result = await dbPool.query(`
        SELECT ua.*, a.name, a.bg_url, a.description, a.tracking_id, a.rules, a.layout
        FROM user_awards ua
        JOIN awards a ON ua.award_id = a.id
        WHERE ua.user_id = $1
        ORDER BY ua.issued_at DESC
    `, [req.user.id]);
    res.json(result.rows);
});

// API for User Logbook (View All) - Verified Logic
app.get('/api/user/qsos', verifyToken, async (req, res) => {
    try {
        // 3. Removed LIMIT to show all logs as requested
        // Explicitly selecting columns to match frontend expectations
        // FIXED: Removed 'state' from SELECT as it is not a column in qsos table
        const r = await dbPool.query('SELECT id, callsign, band, mode, qso_date, dxcc, country, adif_raw FROM qsos WHERE user_id=$1 ORDER BY qso_date DESC, id DESC', [req.user.id]);
        // 实物卡片补建的、或早期 ADIF 没带 DXCC 字段的旧记录——在读取时按 cty.dat 实时反查，
        // 不查 DB（避免 N+1 写）。这里跑一遍已经很快（cty 索引已在进程内存里）。
        for (const row of r.rows) {
            if ((!row.country || !row.dxcc) && row.callsign) {
                const dx = lookupDxcc(row.callsign);
                if (dx) {
                    if (!row.country) row.country = dx.name;
                    if (!row.dxcc) row.dxcc = dx.dxcc;
                }
            }
        }
        res.json(r.rows);
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

// API to find participating awards for a specific QSO
app.get('/api/qsos/:id/awards', verifyToken, async (req, res) => {
    const client = await dbPool.connect();
    try {
        // Get the QSO
        const qsoRes = await client.query('SELECT * FROM qsos WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
        if(qsoRes.rows.length === 0) return res.status(404).json({error: "QSO not found"});
        const qso = qsoRes.rows[0];

        // Get all approved awards
        const awardsRes = await client.query("SELECT id, name, rules FROM awards WHERE status='approved'");
        const matchingAwards = [];

        // Check each award
        // Note: This duplicates the filter logic from evaluateAward. 
        // To save tokens/complexity here, I will implement a quick checker that mimics evaluateAward's Step 1 & 2.
        
        for (const award of awardsRes.rows) {
            const rules = award.rules;
            // Skip legacy
            if (Array.isArray(rules) && !rules.v2) continue;

            // 1. Basic Filter Check
            let match = true;
            const raw = qso.adif_raw;
            
            if (rules.basic?.startDate) {
                const qDate = raw.qso_date || qso.qso_date;
                const qDateFormatted = qDate.length === 8 ? `${qDate.slice(0,4)}-${qDate.slice(4,6)}-${qDate.slice(6,8)}` : qDate;
                if (qDateFormatted < rules.basic.startDate) match = false;
            }
            if (match && rules.basic?.endDate) {
                const qDate = raw.qso_date || qso.qso_date;
                const qDateFormatted = qDate.length === 8 ? `${qDate.slice(0,4)}-${qDate.slice(4,6)}-${qDate.slice(6,8)}` : qDate;
                if (qDateFormatted > rules.basic.endDate) match = false;
            }
            if (match && rules.basic?.qslRequired) {
                const qslR = raw.qsl_rcvd?.toUpperCase() === 'Y';
                const lotwR = raw.lotw_qsl_rcvd?.toUpperCase() === 'Y';
                if (!qslR && !lotwR) match = false;
            }
            if (match && rules.filters) {
                for (const f of rules.filters) {
                    if (!f.field || !f.value || f.value === 'ANY') continue;
                    const val = (raw[f.field.toLowerCase()] || qso[f.field.toLowerCase()] || '').toString().toUpperCase();
                    const targetVal = f.value.toUpperCase();
                    if (f.operator === 'eq' && val !== targetVal) match = false;
                    if (f.operator === 'neq' && val === targetVal) match = false;
                    if (f.operator === 'contains' && !val.includes(targetVal)) match = false;
                }
            }

            // 2. Target Check
            if (match && rules.targets?.list) {
                const targetList = rules.targets.list.split(',').map(s=>s.trim().toUpperCase());
                const targetType = rules.targets.type;
                let val = null;
                if (targetType === 'callsign') val = (qso.callsign || raw.call).toUpperCase();
                else if (targetType === 'dxcc') val = (qso.dxcc || raw.dxcc);
                else if (targetType === 'grid') val = (raw.gridsquare || '').substring(0,4).toUpperCase();
                else if (targetType === 'iota') val = (raw.iota || '').toUpperCase();
                else if (targetType === 'state') val = (raw.state || '').toUpperCase();
                
                if (val && !targetList.includes(val)) match = false;
            }

            if (match) matchingAwards.push({ id: award.id, name: award.name });
        }

        res.json(matchingAwards);
    } finally {
        client.release();
    }
});


// --- 同源媒体代理 & 奖状校验（M3 新增）---

/**
 * 同源图片代理。
 * 为什么需要：前端用 canvas 把奖状渲染成 PDF 时，如果底图来自 MinIO（另一个端口/域名），
 * 画布会被**跨域污染**（tainted canvas），toDataURL/导出直接抛错。
 * 走本站同源代理就没有这个问题，顺便也不需要给 MinIO 桶配 CORS。
 * 安全：只允许读取 ham-awards 桶下 `awards/` 一级前缀，禁止路径穿越。
 */
app.get('/api/media', async (req, res) => {
    const key = String(req.query.key || '');
    const okKey = key.startsWith('awards/') && !key.includes('..') && !key.slice('awards/'.length).includes('/');
    if (!okKey) return res.status(400).json({ error: 'INVALID_KEY', message: '非法的媒体键' });
    if (!minioClient || !appConfig.minio) {
        return res.status(503).json({ error: 'MINIO_NOT_CONFIGURED', message: '对象存储未配置' });
    }
    try {
        const stat = await minioClient.statObject(appConfig.minioBucket, key);
        const contentType = (stat.metaData && stat.metaData['content-type']) || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        const stream = await minioClient.getObject(appConfig.minioBucket, key);
        stream.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
        stream.pipe(res);
    } catch (e) {
        res.status(404).json({ error: 'NOT_FOUND', message: '媒体不存在' });
    }
});

/** 呼号脱敏：BH2VSQ → BH***Q */
const maskCallsign = (callsign) => {
    const s = String(callsign || '');
    if (s.length <= 2) return `${s.slice(0, 1)}*`;
    if (s.length <= 3) return `${s.slice(0, 1)}**`;
    return `${s.slice(0, 2)}${'*'.repeat(s.length - 3)}${s.slice(-1)}`;
};

/**
 * 奖状真伪校验（公开）。
 * 只暴露「验证一条奖状是否存在」所需的最小信息，呼号做脱敏处理。
 */
app.get('/api/verify/:serial', async (req, res) => {
    const serial = String(req.params.serial || '').trim();
    if (!/^\d{6,32}$/.test(serial)) {
        return res.status(400).json({ valid: false, error: 'INVALID_SERIAL', message: '序列号格式不正确' });
    }
    try {
        const r = await dbPool.query(`
            SELECT ua.serial_number, ua.level, ua.issued_at, ua.score_snapshot,
                   a.name AS award_name, a.description, a.tracking_id,
                   u.callsign AS holder_callsign
            FROM user_awards ua
            JOIN awards a ON a.id = ua.award_id
            JOIN users u ON u.id = ua.user_id
            WHERE ua.serial_number = $1
        `, [serial]);
        if (r.rows.length === 0) {
            return res.status(404).json({ valid: false, message: '未找到该序列号对应的奖状' });
        }
        const row = r.rows[0];
        res.json({
            valid: true,
            serial: row.serial_number,
            awardName: row.award_name,
            level: row.level,
            score: row.score_snapshot,
            issueDate: row.issued_at,
            holder: maskCallsign(row.holder_callsign),
            issuer: row.tracking_id,
            description: row.description,
        });
    } catch (e) {
        console.error('verify failed:', e.message);
        res.status(500).json({ valid: false, error: 'VERIFY_FAILED', message: '校验服务异常' });
    }
});

/**
 * 校验二维码（公开 PNG）。
 * 内容 = 本站的校验页地址，扫码即可打开 /#/verify/<serial>。
 */
app.get('/api/verify/:serial/qr', async (req, res) => {
    const serial = String(req.params.serial || '').trim();
    if (!/^\d{6,32}$/.test(serial)) return res.status(400).end();
    const target = `${req.protocol}://${req.get('host')}/#/verify/${serial}`;
    try {
        const buf = await qrcode.toBuffer(target, { type: 'png', width: 600, margin: 1, errorCorrectionLevel: 'M' });
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buf);
    } catch (e) {
        console.error('qr failed:', e.message);
        res.status(500).end();
    }
});

// --- 系统管理 ---

app.get('/api/admin/users', verifyToken, verifyAdmin, async (req, res) => {
    const r = await dbPool.query('SELECT id, callsign, role, created_at, totp_secret IS NOT NULL as has_2fa FROM users ORDER BY id');
    res.json(r.rows);
});

app.post('/api/admin/users', verifyToken, verifyAdmin, require2FA, async (req, res) => {
    const { callsign, password, role } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        const ins = await dbPool.query(`INSERT INTO users (callsign, password_hash, role) VALUES ($1, $2, $3) RETURNING id`, [callsign.toUpperCase(), hash, role || 'user']);
        await logAudit(dbPool, req, {
            action: 'admin.user_create',
            targetType: 'user',
            targetId: ins.rows[0]?.id,
            detail: { callsign: String(callsign || '').toUpperCase().slice(0, 32), role: role || 'user' },
        });
        res.json({ success: true });
    } catch (e) {
        if (e.code === '23505') res.status(400).json({ error: 'EXISTS', message: '呼号已存在' });
        else res.status(500).json({ error: e.message });
    }
});

app.put('/api/admin/users/:id', verifyToken, verifyAdmin, require2FA, async (req, res) => {
    const { role, password } = req.body;
    // 记下改前的角色，审计里能看到"从什么角色改成了什么角色"
    const before = await dbPool.query('SELECT callsign, role FROM users WHERE id=$1', [req.params.id]);
    const updates = [];
    const values = [];
    let idx = 1;
    if (role) { updates.push(`role=$${idx++}`); values.push(role); }
    if (password) { const hash = await bcrypt.hash(password, 10); updates.push(`password_hash=$${idx++}`); values.push(hash); }
    values.push(req.params.id);
    await dbPool.query(`UPDATE users SET ${updates.join(',')} WHERE id=$${idx}`, values);
    await logAudit(dbPool, req, {
        action: 'admin.user_update',
        targetType: 'user',
        targetId: req.params.id,
        detail: {
            callsign: before.rows[0]?.callsign,
            role_from: before.rows[0]?.role,
            role_to: role || undefined,
            password_reset: !!password, // 只记"重置过"，绝不记密码内容
        },
    });
    res.json({ success: true });
});

app.delete('/api/admin/users/:id', verifyToken, verifyAdmin, require2FA, async (req, res) => {
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        // 存档呼号供审计用（删掉就查不到了）
        const victim = await client.query('SELECT callsign, role FROM users WHERE id=$1', [req.params.id]);
        // 将该用户创建的奖状设置为无主 (避免外键约束错误)
        await client.query('UPDATE awards SET creator_id = NULL WHERE creator_id = $1', [req.params.id]);
        // 删除用户 (QSOS 和 user_awards 会自动级联删除)
        await client.query('DELETE FROM users WHERE id=$1', [req.params.id]);
        await client.query('COMMIT');
        await logAudit(dbPool, req, {
            action: 'admin.user_delete',
            targetType: 'user',
            targetId: req.params.id,
            detail: { callsign: victim.rows[0]?.callsign, role: victim.rows[0]?.role },
        });
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

// --- 角色升级申请（普通用户 → 奖状管理员，需 admin 审核）---
app.get('/api/user/role-request', verifyToken, async (req, res) => {
    try {
        const r = await dbPool.query(
            `SELECT id, requested_role, status, reject_reason, created_at FROM role_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
            [req.user.id],
        );
        res.json(r.rows[0] || null);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/user/role-request', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'user') return res.status(400).json({ error: 'ALREADY_PRIVILEGED', message: '当前账号已具备奖状管理员或更高权限' });
        const dup = await dbPool.query(`SELECT id FROM role_requests WHERE user_id=$1 AND status='pending'`, [req.user.id]);
        if (dup.rows.length > 0) return res.status(400).json({ error: 'ALREADY_PENDING', message: '你已提交过申请，请等待管理员审核' });

        const awardName = String((req.body || {}).award_name || '').trim().slice(0, 200);
        const reason = String((req.body || {}).reason || '').trim().slice(0, 2000);
        const experience = String((req.body || {}).experience || '').trim().slice(0, 1000);
        const contact = String((req.body || {}).contact || '').trim().slice(0, 200);
        if (!awardName) return res.status(400).json({ error: 'NO_AWARD_NAME', message: '请填写拟创建的奖状名称' });
        if (!reason) return res.status(400).json({ error: 'NO_REASON', message: '请填写申请理由' });

        const ins = await dbPool.query(
            `INSERT INTO role_requests (user_id, requested_role, award_name, reason, experience, contact)
             VALUES ($1, 'award_admin', $2, $3, $4, $5) RETURNING id`,
            [req.user.id, awardName, reason, experience || null, contact || null],
        );
        const admins = await dbPool.query(`SELECT id FROM users WHERE role='admin'`);
        await notifyUsers(dbPool, admins.rows.map((r) => r.id), {
            type: 'role_request',
            title: '有新的角色升级申请',
            body: `用户 ${req.user.callsign} 申请成为奖状管理员（拟创建奖状「${awardName}」），请到「用户管理」审核。`,
        });
        await logAudit(dbPool, req, {
            action: 'role.request',
            targetType: 'role_request',
            targetId: ins.rows[0].id,
            detail: { award_name: awardName },
        });
        res.json({ success: true, id: ins.rows[0].id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/role-requests', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const r = await dbPool.query(
            `SELECT rr.id, rr.requested_role, rr.status, rr.created_at, rr.reject_reason,
                    rr.award_name, rr.reason, rr.experience, rr.contact,
                    u.id AS user_id, u.callsign
             FROM role_requests rr JOIN users u ON u.id = rr.user_id
             WHERE rr.status = 'pending'
             ORDER BY rr.created_at ASC`,
        );
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/role-requests/:id/review', verifyToken, verifyAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { action, reason } = req.body || {};
    if (action !== 'approve' && action !== 'reject') return res.status(400).json({ error: 'BAD_ACTION', message: 'action 必须是 approve 或 reject' });
    if (action === 'reject' && !String(reason || '').trim()) return res.status(400).json({ error: 'NO_REASON', message: '驳回必须填写原因' });

    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        const old = await client.query(`SELECT * FROM role_requests WHERE id=$1 FOR UPDATE`, [id]);
        if (old.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'NOT_FOUND', message: '申请不存在' }); }
        if (old.rows[0].status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'ALREADY_REVIEWED', message: '该申请已处理' }); }

        const approved = action === 'approve';
        if (approved) {
            await client.query(`UPDATE users SET role = 'award_admin' WHERE id = $1`, [old.rows[0].user_id]);
        }
        await client.query(
            `UPDATE role_requests SET status=$1, reviewer_id=$2, reviewed_at=NOW(), reject_reason=$3 WHERE id=$4`,
            [approved ? 'approved' : 'rejected', req.user.id, approved ? null : String(reason || '').slice(0, 500), id],
        );
        await client.query('COMMIT');

        await logAudit(dbPool, req, {
            action: 'role.review',
            targetType: 'role_request',
            targetId: id,
            detail: { user_id: old.rows[0].user_id, op: approved ? 'approve' : 'reject', role_to: approved ? 'award_admin' : undefined, reason: reason || '' },
        });

        await notifyUsers(dbPool, [old.rows[0].user_id], {
            type: approved ? 'role_approved' : 'role_rejected',
            title: approved ? '升级申请已通过' : '升级申请被驳回',
            body: approved
                ? '恭喜！你的「奖状管理员」申请已通过，重新登录后即可创建和管理奖状。'
                : `你的「奖状管理员」申请被驳回${reason ? '：' + reason : ''}。`,
        });
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

// --- 内测邀请码管理（仅 admin）---
// 生成 / 停用 / 删除邀请码 + 总开关。门禁只作用于"新账号产生"，
// 详情见 server/services/invites.js。
app.get('/api/admin/invite-codes', verifyToken, verifyAdmin, async (req, res) => {
    try {
        // 顺便把"这个码被谁用了"聚合出来，省得管理员再翻审计
        const r = await dbPool.query(
            `SELECT c.id, c.code, c.max_uses, c.used_count, c.note, c.expires_at, c.disabled, c.created_at,
                    COALESCE(array_agg(u.callsign ORDER BY u.id) FILTER (WHERE u.id IS NOT NULL), '{}') AS used_by
               FROM invite_codes c
               LEFT JOIN users u ON u.invite_code = c.code
              GROUP BY c.id
              ORDER BY c.created_at DESC, c.id DESC`,
        );
        res.json({ requireInvite: isInviteRequired(appConfig), list: r.rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/invite-codes', verifyToken, verifyAdmin, async (req, res) => {
    const { max_uses: maxUses, note, expires_in_days: expiresInDays } = req.body || {};
    const uses = Math.min(999, Math.max(1, Number(maxUses) || 1));
    const days = Number(expiresInDays) || 0; // 0 / 空 = 不过期
    try {
        // 极小概率撞码：撞了就换一个再试（唯一索引兜底）
        let row = null;
        for (let i = 0; i < 5 && !row; i += 1) {
            const code = genInviteCode();
            const ins = await dbPool.query(
                `INSERT INTO invite_codes (code, max_uses, note, expires_at, created_by)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (code) DO NOTHING
                 RETURNING id, code, max_uses, used_count, note, expires_at, disabled, created_at`,
                [
                    code,
                    uses,
                    String(note || '').slice(0, 200) || null,
                    days > 0 ? new Date(Date.now() + days * 86400000) : null,
                    req.user.id,
                ],
            );
            row = ins.rows[0] || null;
        }
        if (!row) throw new Error('生成邀请码失败，请重试');
        await logAudit(dbPool, req, { action: 'invite.create', targetType: 'invite', targetId: row.code, detail: { max_uses: uses, days: days || undefined, note: row.note || undefined } });
        res.json({ success: true, code: row });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/invite-codes/:id/toggle', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const r = await dbPool.query(
            `UPDATE invite_codes SET disabled = NOT disabled WHERE id=$1 RETURNING code, disabled`,
            [req.params.id],
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND', message: '邀请码不存在' });
        await logAudit(dbPool, req, { action: 'invite.toggle', targetType: 'invite', targetId: r.rows[0].code, detail: { disabled: r.rows[0].disabled } });
        res.json({ success: true, disabled: r.rows[0].disabled });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/admin/invite-codes/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const r = await dbPool.query(`DELETE FROM invite_codes WHERE id=$1 RETURNING code, used_count`, [req.params.id]);
        if (r.rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND', message: '邀请码不存在' });
        await logAudit(dbPool, req, { action: 'invite.delete', targetType: 'invite', targetId: r.rows[0].code, detail: { used_count: r.rows[0].used_count } });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 内测总开关：写进 config.json，重启也保留；关闭后注册不再要求邀请码
app.post('/api/admin/invite-settings', verifyToken, verifyAdmin, async (req, res) => {
    const enabled = !!(req.body || {}).requireInvite;
    appConfig.beta = { ...(appConfig.beta || {}), requireInvite: enabled };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(appConfig, null, 2));
    await logAudit(dbPool, req, { action: 'invite.settings', detail: { requireInvite: enabled } });
    res.json({ success: true, requireInvite: enabled });
});

app.post('/api/admin/settings', verifyToken, verifyAdmin, require2FA, async (req, res) => {
    const { useHttps, adminPath } = req.body;
    appConfig.useHttps = useHttps;
    appConfig.adminPath = adminPath;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(appConfig, null, 2));
    await logAudit(dbPool, req, { action: 'admin.settings_update', detail: { useHttps, adminPath } });
    res.json({ success: true });
});

// 从 country-files.com 同步最新 cty.dat（DXCC 前缀库）。同步后模块自动重新解析，无需重启。
app.post('/api/admin/cty/refresh', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const result = await syncCtyFromWeb({ force: !!req.body?.force });
        await logAudit(dbPool, req, {
            action: 'admin.cty_refresh',
            detail: { updated: result.updated, reason: result.reason, stats: result.stats },
        });
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 当前 cty 解析统计（实体数 / 前缀数 / 已映射 DXCC 数），供后台展示与自检。
app.get('/api/admin/cty/stats', verifyToken, verifyAdmin, async (req, res) => {
    try {
        res.json({ success: true, ...ctyStats() });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 启动
loadConfig();
const PORT = Number(process.env.PORT) || 9993;
http.createServer(app).listen(PORT, () => console.log(`Server running on port ${PORT}`));