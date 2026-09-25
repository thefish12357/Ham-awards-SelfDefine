#!/usr/bin/env node
/**
 * 演示实例种子脚本（由 compose 的 demo-seed 服务执行，跑完即退出）。
 *
 * 目标：让独立的演示实例（demo.wavelog.org 那样）开箱即有内容可玩：
 *   1. 演示账号（DEMO / DEMO_PASS）            —— 访客登录试玩
 *   2. 几张示例奖状（带规则与可视化布局）      —— 看到设计器/证书样式
 *   3. 一批示例 ADIF 通联                        —— 进度匹配/矩阵有真实数据
 *   4. 已申领 + 已签发记录                        —— “我的奖状”“审核”闭环可见
 *
 * 全部走公开 HTTP 接口（与 autoinstall 同思路），不碰 SQL。幂等：
 *   检测到演示账号已存在且已有颁发记录就跳过，可重复 `docker compose up demo-seed`。
 */

const BASE = process.env.DEMO_APP_URL || 'http://demo:9994';
const ADMIN_CALL = process.env.DEMO_ADMIN_CALLSIGN || 'DEMOADMIN';
const ADMIN_PASS = process.env.DEMO_ADMIN_PASSWORD || '';
const DEMO_CALL = process.env.DEMO_USER || 'DEMO';
const DEMO_PASS = process.env.DEMO_USER_PASSWORD || process.env.DEMO_PASS || 'demo123456';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[seed-demo]', ...a);

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function waitForApp(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/system-status`);
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.installed) return d;
      lastErr = new Error(`installed=${d.installed}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(2000);
  }
  throw new Error(`演示实例 ${BASE} 在 ${timeoutMs / 1000}s 内未就绪：${lastErr?.message}`);
}

function login(call, pass) {
  return api('/api/auth/login', { method: 'POST', body: { callsign: call, password: pass } });
}

/* ---------- 示例奖状布局（v2，纯函数内联，避免依赖前端模块）---------- */
function buildLayout() {
  const el = (e) => ({ id: `e_${Math.random().toString(36).slice(2, 8)}`, rotation: 0, opacity: 1, ...e });
  return {
    v: 2,
    canvas: { w: 297, h: 210, bgUrl: '', bgFit: 'cover', bgOpacity: 1 },
    elements: [
      el({ type: 'shape', shape: 'rect', x: 10, y: 10, z: 0, w: 277, h: 190, fill: 'none', stroke: '#c8a45c', strokeWidth: 1.2 }),
      el({ type: 'shape', shape: 'rect', x: 13.5, y: 13.5, z: 0, w: 270, h: 183, fill: 'none', stroke: '#c8a45c', strokeWidth: 0.4 }),
      el({ type: 'text', binding: 'custom', text: '荣 誉 证 书', x: 58.5, y: 26, w: 180, h: 18, font: '"Noto Serif SC","SimSun",serif', color: '#111827', weight: 700, align: 'center', valign: 'middle' }),
      el({ type: 'text', binding: 'awardName', text: '', x: 48.5, y: 58, w: 200, h: 13, font: '"Noto Serif SC","SimSun",serif', color: '#b08a3e', weight: 700, align: 'center', valign: 'middle' }),
      el({ type: 'text', binding: 'callsign', text: '', x: 48.5, y: 82, w: 200, h: 22, font: '"JetBrains Mono","Consolas",monospace', weight: 700, align: 'center', valign: 'middle' }),
      el({ type: 'text', binding: 'level', text: '', x: 48.5, y: 114, w: 200, h: 13, font: '"Noto Serif SC","SimSun",serif', color: '#b08a3e', weight: 700, align: 'center', valign: 'middle' }),
      el({ type: 'text', binding: 'serial', text: '', x: 24, y: 165, w: 80, h: 7, font: '"JetBrains Mono","Consolas",monospace', align: 'left', valign: 'middle' }),
      el({ type: 'qrcode', binding: 'verifyUrl', x: 240, y: 152, w: 34, h: 34 }),
    ],
  };
}

/* ---------- 示例 ADIF：覆盖“呼号收藏”“分区收集”“数字积分”三类规则 ---------- */
const CALLSIGN_TARGETS = ['W1AW', 'K1A', 'JA1ABC', 'DL1XYZ', 'G0ABC', 'F1BC', 'EA3XX', 'IK2YY', 'RA1ZZ', 'VK2MM'];
const DISTRICT_TARGETS = ['BH1AA', 'BG2BB', 'BI3CC', 'BH4DD', 'BG5EE', 'BH6FF', 'BI7GG', 'BH8HH', 'BG9II'];
const EXTRA = ['UA1QQ', 'PY2RR', 'ZL3SS'];

const BANDS = ['20M', '40M', '15M', '10M', '80M'];
const GRIDS = { W1AW: 'FN31AA', K1A: 'EM95aa', JA1ABC: 'PM95aa', DL1XYZ: 'JO50aa', G0ABC: 'IO91aa', F1BC: 'JN18aa', EA3XX: 'JN01aa', IK2YY: 'JN45aa', RA1ZZ: 'KO49aa', VK2MM: 'QF56aa', BH1AA: 'OM89aa', BG2BB: 'PN21aa', BI3CC: 'OM73aa', BH4DD: 'OM62aa', BG5EE: 'PM25aa', BH6FF: 'OM95aa', BI7GG: 'OM86aa', BH8HH: 'ON51aa', BG9II: 'OL51aa', UA1QQ: 'KO85aa', PY2RR: 'GG52aa', ZL3SS: 'RE66aa' };

function adiRecord(call, idx) {
  const band = BANDS[idx % BANDS.length];
  const grid = GRIDS[call] || 'AA00aa';
  const date = `2023${String((idx % 12) + 1).padStart(2, '0')}${String((idx % 27) + 1).padStart(2, '0')}`;
  const time = `${String((idx * 7) % 24).padStart(2, '0')}00`;
  return [
    `<call:${call.length}>${call}`,
    `<qso_date:8>${date}`,
    `<time_on:4>${time}`,
    `<band:${band.length}>${band}`,
    '<mode:3>FT8',
    "<rst_sent:3>599",
    "<rst_rcvd:3>599",
    `<gridsquare:${grid.length}>${grid}`,
    "<qsl_rcvd:1>Y",
    "<lotw_qsl_rcvd:1>Y",
    '<EOR>',
  ].join(' ');
}

function buildAdif() {
  const calls = [...CALLSIGN_TARGETS, ...DISTRICT_TARGETS, ...EXTRA];
  return calls.map((c, i) => adiRecord(c, i)).join('\n') + '\n';
}

/* ---------- 奖状定义 ---------- */
function awards() {
  return [
    {
      name: '呼号收藏家奖 [演示]',
      description: '收集指定呼号的通联，每集齐若干即晋级：铜奖 3 / 银奖 6 / 金奖 10。',
      rules: {
        v2: true,
        logic: 'collection',
        targets: { type: 'callsign', list: CALLSIGN_TARGETS.join(',') },
        thresholds: [{ name: '铜奖', value: 3 }, { name: '银奖', value: 6 }, { name: '金奖', value: 10 }],
      },
    },
    {
      name: '数字模式积分奖 [演示]',
      description: '按模式计分（CW/Phone 各 1 分，Data 2 分），按呼号去重：铜奖 4 / 银奖 10 / 金奖 20。',
      rules: {
        v2: true,
        logic: 'scoring',
        deduplication: 'call',
        scoring: { cw: 1, phone: 1, data: 2 },
        thresholds: [{ name: '铜奖', value: 4 }, { name: '银奖', value: 10 }, { name: '金奖', value: 20 }],
      },
    },
    {
      name: '中国分区奖 [演示]',
      description: '收集中国 B 字头呼号的分区 1~9：铜奖 3 / 银奖 6 / 金奖 9。',
      rules: {
        v2: true,
        logic: 'collection',
        targets: { type: 'district', list: '1,2,3,4,5,6,7,8,9' },
        thresholds: [{ name: '铜奖', value: 3 }, { name: '银奖', value: 6 }, { name: '金奖', value: 9 }],
      },
    },
  ];
}

async function main() {
  const status = await waitForApp();
  log('演示实例就绪，开始播种示例数据。');

  // 1) 管理员登录（建示例奖状用）
  const admin = await login(ADMIN_CALL, ADMIN_PASS);
  if (!admin.data?.token) throw new Error(`演示管理员登录失败：${JSON.stringify(admin.data)}`);
  const aTok = admin.data.token;
  log(`管理员 ${ADMIN_CALL} 登录成功。`);

  // 2) 演示账号（已存在则跳过注册）
  const reg = await api('/api/auth/register', { method: 'POST', body: { callsign: DEMO_CALL, password: DEMO_PASS } });
  if (reg.status === 400 && String(reg.data?.error || '').includes('EXISTS')) {
    log(`演示账号 ${DEMO_CALL} 已存在，跳过注册。`);
  } else if (!reg.data?.success) {
    throw new Error(`演示账号注册失败：${JSON.stringify(reg.data)}`);
  } else {
    log(`演示账号 ${DEMO_CALL} 注册成功。`);
  }
  const demo = await login(DEMO_CALL, DEMO_PASS);
  if (!demo.data?.token) throw new Error(`演示账号登录失败：${JSON.stringify(demo.data)}`);
  const dTok = demo.data.token;

  // 幂等：演示账号已有颁发记录就整段跳过
  const mine = await api('/api/user/my-awards', { token: dTok });
  if (Array.isArray(mine.data) && mine.data.length > 0) {
    log('演示数据已存在（颁发记录 > 0），跳过种子。');
    return;
  }

  // 3) 建示例奖状 + 审核通过
  const created = [];
  for (const a of awards()) {
    const r = await api('/api/awards', {
      method: 'POST',
      token: aTok,
      body: { name: a.name, description: a.description, rules: a.rules, layout: buildLayout(), bg_url: '', status: 'pending' },
    });
    if (!r.data?.id) throw new Error(`建奖状失败：${a.name} -> ${JSON.stringify(r.data)}`);
    const id = r.data.id;
    const au = await api('/api/admin/awards/audit', { method: 'POST', token: aTok, body: { id, action: 'approve' } });
    if (!au.data?.success) throw new Error(`审核奖状失败：${a.name} -> ${JSON.stringify(au.data)}`);
    created.push(id);
    log(`奖状「${a.name}」已创建并审核通过 (id=${id})。`);
  }

  // 4) 导入示例 ADIF（演示账号）
  const form = new FormData();
  form.append('file', new Blob([buildAdif()], { type: 'text/plain' }), 'demo.adi');
  const up = await fetch(`${BASE}/api/logbook/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${dTok}` },
    body: form,
  });
  const upData = await up.json().catch(() => ({}));
  if (!up.ok) throw new Error(`ADIF 导入失败：${JSON.stringify(upData)}`);
  log(`示例日志导入成功：${JSON.stringify(upData.stats || upData)}`);

  // 5) 申领（生成示例颁发记录）
  for (const id of created) {
    const ap = await api(`/api/awards/${id}/apply`, { method: 'POST', token: dTok });
    if (ap.data?.success) {
      log(`演示账号申领奖状 ${id} 成功：等级=${ap.data.level} 序列号=${ap.data.serial}`);
    } else {
      // 不满足申领条件也属正常（取决于规则/日志），仅提示不中断
      log(`演示账号申领奖状 ${id} 未达成：${JSON.stringify(ap.data)}`);
    }
  }

  log('演示数据播种完成。');
}

main().catch((err) => {
  log('播种失败：', err?.message || err);
  process.exit(1);
});
