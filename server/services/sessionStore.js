/**
 * 统一 TTL 键值存储（Redis 优先，内存回退）
 * ------------------------------------------------------------------
 * 用途：OAuth 的 state / 待绑定 / 一次性换码，以及 LoTW 临时会话，原本都存在
 * 进程内存的 Map 里。这样**单实例**没问题，但一旦做**多实例部署**，节点之间
 * 会互相看不到对方的会话，导致用户登录态 / 临时日志在节点间丢失。
 *
 * 本模块提供一个与后端无关的 TTL 存储接口：
 *   set(key, value, ttlMs) / get(key) -> value|undefined / del(key) / scan() -> [{key,value}]
 * - 配置了 REDIS_URL：走 Redis（所有实例共享，天然支持水平扩展）；
 * - 未配置 REDIS_URL（本地开发 / 单实例）：走内存 Map 回退，行为与改造前一致。
 *
 * 所有方法都是 async，调用方统一 await，避免两套 API。
 */

import Redis from 'ioredis';

let redis = null;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    // 连接不上时不要拖垮进程启动；错误由下面的 handler 记录
    lazyConnect: false,
  });
  redis.on('error', (e) => {
    // Redis 抖动时只记录，不中断服务（回退逻辑不在本模块，由调用方决定是否致命）
    console.error('[redis]', e && e.message);
  });
}

export function isRedisEnabled() {
  return !!redis;
}

export function createTtlStore(prefix) {
  const p = prefix.endsWith(':') ? prefix : prefix + ':';

  if (redis) {
    return {
      async set(key, value, ttlMs) {
        await redis.set(p + key, JSON.stringify(value), 'PX', Math.max(1, Math.round(ttlMs)));
      },
      async get(key) {
        const s = await redis.get(p + key);
        if (s == null) return undefined;
        try {
          return JSON.parse(s);
        } catch {
          return undefined;
        }
      },
      async del(key) {
        await redis.del(p + key);
      },
      // 列出全部（含过期也会被 TTL 自然淘汰；这里用于容量统计 / 单会话清理 / 统计）
      async scan() {
        const out = [];
        let cursor = '0';
        do {
          const [c, keys] = await redis.scan(cursor, 'MATCH', p + '*', 'COUNT', 200);
          cursor = c;
          if (keys.length) {
            const vals = await redis.mget(...keys);
            keys.forEach((k, i) => {
              if (vals[i] != null) {
                try {
                  out.push({ key: k.slice(p.length), value: JSON.parse(vals[i]) });
                } catch {
                  /* 损坏值跳过 */
                }
              }
            });
          }
        } while (cursor !== '0');
        return out;
      },
      async clear() {
        let cursor = '0';
        const toDel = [];
        do {
          const [c, keys] = await redis.scan(cursor, 'MATCH', p + '*', 'COUNT', 200);
          cursor = c;
          if (keys.length) toDel.push(...keys);
        } while (cursor !== '0');
        if (toDel.length) await redis.del(...toDel);
      },
    };
  }

  // ---- 内存回退：行为与改造前一致 ----
  const m = new Map();
  return {
    async set(key, value, ttlMs) {
      m.set(key, { v: value, exp: Date.now() + ttlMs });
    },
    async get(key) {
      const e = m.get(key);
      if (!e) return undefined;
      if (e.exp <= Date.now()) {
        m.delete(key);
        return undefined;
      }
      return e.v;
    },
    async del(key) {
      m.delete(key);
    },
    async scan() {
      const now = Date.now();
      const out = [];
      for (const [k, e] of m) {
        if (e.exp <= now) {
          m.delete(k);
          continue;
        }
        out.push({ key: k, value: e.v });
      }
      return out;
    },
    async clear() {
      m.clear();
    },
  };
}
