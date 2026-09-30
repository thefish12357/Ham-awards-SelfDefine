/**
 * 邮件通知设置（2026-09-30）
 * ------------------------------------------------------------------
 * 背景：站内通知（`notifications` 表）本来只写库、只在铃铛/侧栏红点里体现。
 *       用户要求把「**哪些环节发邮件**」交给**系统管理员**配置 —— 于是有了本模块。
 *
 * 存哪儿：`config.json` 的 `mail` 段（重启保留；容器里落在 /data 卷内）
 *
 *   "mail": { "notifyEnabled": true, "notifyTypes": ["award_pending", "role_request"] }
 *
 * ★ 两层开关，缺一不可（这是产品规则，勿合并成一层）：
 *   ① 管理员（本模块）：`notifyEnabled` 总开关 + `notifyTypes` 勾选哪些事件；
 *   ② 用户（`users.email_notify`，**默认 false**）：用户自己是否愿意收邮件。
 *   所以「管理员勾了就一定会发」是不成立的 —— 只有**在用户中心主动开启、
 *   且邮箱已验证**的账号才会收到，避免上线即打扰全站用户。
 *
 * ⚠️ `type` 必须与各处 `notifyUsers(pool, ids, { type })` 的取值逐字一致，
 *    新增事件时**两个地方都要加**（本目录 + 调用处），否则界面上勾了也不会发。
 */

/** 事件目录（前端直接渲染这个列表；顺序即界面顺序） */
export const MAIL_NOTIFY_CATALOG = [
  {
    type: 'award_pending',
    label: '有奖状待审核',
    audience: 'admin',
    desc: '奖状管理员提交 / 重新提交奖状时，通知系统管理员去「奖状审核」处理。',
  },
  {
    type: 'award_returned',
    label: '奖状被打回',
    audience: 'author',
    desc: '系统管理员审核不通过并打回时，通知奖状的创建者修改后重新提交。',
  },
  {
    type: 'award_approved',
    label: '奖状通过审核',
    audience: 'author',
    desc: '奖状审核通过（上架到奖状大厅）时，通知创建者。',
  },
  {
    type: 'evidence_pending',
    label: '有实物材料待审核',
    audience: 'admin',
    desc: '用户上传 QSL 卡 / Eyeball / SWL 材料时，通知审核员。',
  },
  {
    type: 'evidence_approved',
    label: '实物材料通过',
    audience: 'user',
    desc: '材料审核通过（含自动匹配到的日志条数）时，通知上传者本人。',
  },
  {
    type: 'evidence_rejected',
    label: '实物材料被驳回',
    audience: 'user',
    desc: '材料被驳回（含驳回原因）时，通知上传者本人。',
  },
  {
    type: 'role_request',
    label: '有角色升级申请',
    audience: 'admin',
    desc: '普通用户申请成为「奖状管理员」时，通知系统管理员。',
  },
  {
    type: 'role_approved',
    label: '角色申请已通过',
    audience: 'user',
    desc: '升级申请通过（含管理员可选留言）时，通知申请人。',
  },
  {
    type: 'role_rejected',
    label: '角色申请被驳回',
    audience: 'user',
    desc: '升级申请被驳回时，通知申请人。',
  },
  {
    type: 'award_withdrawn',
    label: '用户撤回奖状',
    audience: 'admin',
    desc: '用户撤回自己已领取的奖状（属重要动作）时，通知系统管理员知情。',
  },
  {
    type: 'email_unbound',
    label: '提醒绑定邮箱',
    audience: 'user',
    desc: '管理员一键「提醒未绑邮箱用户」时发送。⚠️ 属批量推送，默认不勾选。',
  },
];

const CATALOG_TYPES = MAIL_NOTIFY_CATALOG.map((c) => c.type);

/** 默认勾选：管理侧高优先级事件（用户侧默认不发，避免上线即打扰；由管理员按需勾） */
export const DEFAULT_NOTIFY_TYPES = ['award_pending', 'award_returned', 'evidence_pending', 'role_request'];

/** 内存快照（通知层每来一条通知都会读它，不能每次去读文件） */
let settings = { enabled: false, types: [...DEFAULT_NOTIFY_TYPES] };

/** 把非法/陌生的 type 过滤掉，防止 config.json 手改后带上无效值 */
const sanitizeTypes = (types) => {
  const arr = Array.isArray(types) ? types : [];
  return CATALOG_TYPES.filter((t) => arr.includes(t));
};

/**
 * 用 config.json 的内容刷新内存快照。
 * 由 `loadConfig()` 在启动时调用一次，管理员保存后再调一次（无需重启）。
 */
export function applyMailSettings(cfg) {
  const mail = (cfg && cfg.mail) || {};
  settings = {
    enabled: mail.notifyEnabled === true,
    types: sanitizeTypes(mail.notifyTypes).length
      ? sanitizeTypes(mail.notifyTypes)
      : sanitizeTypes(DEFAULT_NOTIFY_TYPES),
  };
  return getMailSettings();
}

/** 只读快照（返回副本，避免调用方误改内存态） */
export function getMailSettings() {
  return { enabled: settings.enabled, types: [...settings.types] };
}

/** 某类事件当前是否应当转发邮件（总开关 + 勾选都满足） */
export function isNotifyTypeEnabled(type) {
  return settings.enabled && settings.types.includes(type);
}

/** 校验并规范化来自界面的入参 → 可安全写进 config.json 的 mail 段 */
export function normalizeMailSettingsInput({ enabled, types } = {}) {
  return { notifyEnabled: enabled === true, notifyTypes: sanitizeTypes(types) };
}

/** 供管理界面展示：目录 + 每个事件「谁会收到」的中文说明 */
export const MAIL_AUDIENCE_LABELS = {
  admin: '系统管理员',
  author: '奖状创建者',
  user: '用户本人',
};
