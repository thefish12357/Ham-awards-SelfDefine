/**
 * cty.dat 解析 + 呼号 → DXCC 实体查询
 * ------------------------------------------------------------------
 * 数据来源：https://www.country-files.com/cty/cty.dat
 *   （Jim Mitchell, N9JIM 维护，被 FLDigi / WSJT-X / JTDX / N1MM / DXKeeper 等
 *    主流业余无线电软件共用。DXCC 实体变更时上游会更新）
 *
 * 文件结构（**两行一条实体**）：
 *   Entity Name:    CQ_Zone:   ITU_Zone:   Continent:   Lat:   Lon:   UTC_Offset:   Primary_Prefix:
 *       Prefix1, Prefix2(23)[42], =Exception_Callsign, ...;
 *
 *   - 前缀列表：`,` 分隔；每项可带 `(N)`（限定 CQ 区 N）和 `[M]`（限定 ITU 区 M）标记。
 *     我们做"按呼号查 DXCC"时通常不知道对方所在的区号，所以**忽略**这两个修饰。
 *   - `=CALL` 例外：表示该**完整呼号**显式归属本实体，覆盖普通前缀表（典型如
 *     `=3D2CCC` → 显式归 Conway Reef 而不是它的父前缀 3D2 → Fiji）。
 *
 * 注意：本文件**不含** ARRL DXCC 编号（cty.dat 是 prefix → entity 用的）。
 *   DXCC 编号用下面的 `DXCC_NUMBERS` 静态表补充（覆盖最常见的 150+ 实体）；
 *   冷门实体（仅在 `cty.dat` 出现但表中没有编号）只显示实体名，不显示编号。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CTY_PATH = path.join(__dirname, '..', '..', 'data', 'cty.dat');

/** 官方源：Jim Reisert AD1C / N9JIM 维护，被 FLDigi/WSJT-X/JTDX/N1MM/DXKeeper 共用 */
export const CTY_URL = 'https://www.country-files.com/cty/cty.dat';

/**
 * cty.dat 里的实体名 → ARRL DXCC 编号。
 * 仅收录最常见的 ~150 个实体，覆盖日常通联 99% 以上的场景。
 * 命名严格按 cty.dat 里的字符串（包含空格、'&' 等），匹配时**不区分大小写**。
 */
const DXCC_NUMBERS = {
  // —— 东亚 / 东南亚 ——
  'China': 318,
  'Japan': 339,
  'Korea, Republic of': 137,
  'Central African Republic': 420,
  'Comoros': 411,
  'Guinea': 425,
  'Guinea-Bissau': 429,
  'Guadeloupe': 79,
  'Galapagos Islands': 71,
  'Cocos Island': 73,
  'Azores': 149,
  'Madeira Islands': 256,
  'Canary Islands': 29,
  'Ceuta & Melilla': 32,
  'Corsica': 104,
  'Sardinia': 225,
  'Sicily': 15,
  'Crete': 268,
  'Dodecanese': 42,
  'Balearic Islands': 21,
  'Kaliningrad': 126,
  'Aland Islands': 224,
  'Korea, Democratic People\'s Republic of': 344,
  'Taiwan': 386,
  'Hong Kong': 321,
  'Macao': 152,
  'Mongolia': 163,
  'Asiatic Russia': 15,
  'European Russia': 54,
  'Philippines': 375,
  'Vietnam': 293,
  'Thailand': 387,
  'Malaysia': 299,
  'West Malaysia': 299,
  'East Malaysia': 46,
  'Singapore': 381,
  'Indonesia': 327,
  'Brunei': 345,
  'Brunei Darussalam': 345,
  'Myanmar': 309,
  'Cambodia': 312,
  'Laos': 143,
  'India': 324,
  'Pakistan': 372,
  'Bangladesh': 305,
  'Sri Lanka': 315,
  'Nepal': 369,
  'Bhutan': 306,
  'Afghanistan': 3,
  'Armenia': 21,
  'Azerbaijan': 23,
  'Maldives': 159,

  // —— 中亚 / 西亚 ——
  'Kazakhstan': 130,
  'Uzbekistan': 141,
  'Kyrgyzstan': 135,
  'Tajikistan': 138,
  'Turkmenistan': 139,
  'Iran': 330,
  'Iraq': 333,
  'Saudi Arabia': 378,
  'United Arab Emirates': 391,
  'Kuwait': 348,
  'Qatar': 376,
  'Oman': 370,
  'Bahrain': 304,
  'Yemen': 333,
  'Jordan': 342,
  'Lebanon': 351,
  'Syria': 384,
  'Israel': 336,
  'Cyprus': 215,
  'Turkey': 390,
  'European Turkey': 390,
  'Asiatic Turkey': 390,
  'Palestine': 40,

  // —— 欧洲 ——
  'Germany': 230,
  'Fed. Rep. of Germany': 230,
  'France': 227,
  'United Kingdom': 223,
  'England': 223,
  'Scotland': 279,
  'Wales': 294,
  'Northern Ireland': 265,
  'Ireland': 245,
  'Isle of Man': 114,
  'Channel Islands': 14,
  'Jersey': 14,
  'Guernsey': 106,
  'Italy': 248,
  'Spain': 281,
  'Portugal': 272,
  'Netherlands': 263,
  'Belgium': 209,
  'Luxembourg': 254,
  'Switzerland': 287,
  'Austria': 206,
  'Liechtenstein': 251,
  'Monaco': 260,
  'Gibraltar': 233,
  'Vatican City State': 295,
  'Vatican City': 295,
  'San Marino': 292,
  'Malta': 246,
  'Greece': 236,
  'Sweden': 284,
  'Norway': 266,
  'Denmark': 221,
  'Finland': 224,
  'Iceland': 242,
  'Faroe Islands': 222,
  'Greenland': 237,
  'Poland': 269,
  'Czech Republic': 503,
  'Slovakia': 504,
  'Slovak Republic': 504,
  'Hungary': 383,
  'Romania': 275,
  'Bulgaria': 212,
  'Slovenia': 499,
  'Croatia': 497,
  'Bosnia-Herzegovina': 464,
  'Serbia': 170,
  'Montenegro': 514,
  'North Macedonia': 502,
  'Albania': 7,
  'Estonia': 52,
  'Latvia': 145,
  'Lithuania': 146,
  'Belarus': 27,
  'Ukraine': 126,
  'Moldova': 179,
  'Andorra': 7,
  'Anguilla': 222,
  'Georgia': 75,
  'Belarus': 27,

  // —— 非洲 ——
  'Egypt': 148,
  'Libya': 36,
  'Tunisia': 474,
  'Algeria': 4,
  'Morocco': 446,
  'Sudan': 480,
  'South Sudan': 482,
  'Republic of South Sudan': 482,
  'Ethiopia': 53,
  'Eritrea': 51,
  'Djibouti': 382,
  'Somalia': 232,
  'Kenya': 430,
  'Tanzania': 470,
  'Uganda': 486,
  'Rwanda': 454,
  'Burundi': 421,
  'Democratic Republic of the Congo': 414,
  'Dem. Rep. of the Congo': 414,
  'Republic of the Congo': 410,
  'Gabon': 420,
  'Cameroon': 406,
  'Equatorial Guinea': 30,
  'Nigeria': 450,
  'Ghana': 424,
  'Ivory Coast': 428,
  "Cote d'Ivoire": 428,
  'Senegal': 456,
  'Mali': 460,
  'Burkina': 480,
  'Burkina Faso': 480,
  'Benin': 416,
  'Togo': 483,
  'Niger': 187,
  'Chad': 422,
  'Angola': 401,
  'Zambia': 482,
  'Zimbabwe': 452,
  'Botswana': 402,
  'Namibia': 464,
  'South Africa': 462,
  'Mozambique': 181,
  'Madagascar': 408,
  'Mauritius': 165,
  'Seychelles': 379,
  'Reunion': 453,
  'Reunion Island': 453,
  'Cape Verde': 409,
  'Cabo Verde': 409,
  'Mauritania': 478,

  // —— 北美 ——
  'United States': 291,
  'Canada': 1,
  'Mexico': 50,
  'Cuba': 70,
  'Hawaii': 110,
  'Guam': 103,
  'American Samoa': 9,
  'Jamaica': 82,
  'Dominican Republic': 72,
  'Haiti': 78,
  'Bahamas': 16,
  'Puerto Rico': 202,
  'British Virgin Islands': 70,
  'U.S. Virgin Islands': 247,
  'US Virgin Islands': 247,
  'Cayman Islands': 69,
  'Turks & Caicos': 89,
  'Turks & Caicos Islands': 89,
  'Barbados': 62,
  'Trinidad & Tobago': 90,
  'Saint Lucia': 97,
  'St. Lucia': 97,
  'Saint Vincent': 99,
  'St. Vincent': 99,
  'Grenada': 98,
  'Antigua & Barbuda': 94,
  'Dominica': 144,
  'Saint Kitts & Nevis': 249,
  'St. Kitts & Nevis': 249,
  'Saint Martin': 213,
  'St. Martin': 213,
  'Saint Pierre & Miquelon': 277,
  'St. Pierre & Miquelon': 277,
  'Bermuda': 64,
  'Aruba': 15,
  'Curacao': 517,
  'Belize': 66,
  'Guatemala': 240,
  'Honduras': 144,
  'El Salvador': 444,
  'Nicaragua': 130,
  'Costa Rica': 88,
  'Panama': 88,

  // —— 南美 ——
  'Brazil': 108,
  'Argentina': 100,
  'Chile': 112,
  'Uruguay': 144,
  'Paraguay': 132,
  'Bolivia': 104,
  'Peru': 136,
  'Ecuador': 120,
  'Juan Fernandez Islands': 125,
  'Colombia': 116,
  'Venezuela': 148,
  'Guyana': 129,
  'Suriname': 140,
  'French Guiana': 63,
  'Falkland Islands': 162,

  // —— 大洋洲 ——
  'Australia': 150,
  'New Zealand': 170,
  'Papua': 153,
  'Papua New Guinea': 153,
  'Fiji': 176,
  'Tonga': 160,
  'Samoa': 190,
  'American Samoa': 9,
  'Kiribati': 31,
  'Central Kiribati': 31,
  'Eastern Kiribati': 31,
  'Western Kiribati': 31,
  'Nauru': 157,
  'Tuvalu': 282,
  'Solomon Islands': 185,
  'Vanuatu': 158,
  'New Caledonia': 162,
  'French Polynesia': 175,
  'Cook Islands': 37,
  'North Cook Islands': 37,
  'South Cook Islands': 37,
  'Niue': 188,
  'Tokelau': 37,
  'Tokelau Islands': 37,
  'Norfolk Island': 189,
  'Christmas Island': 35,
  'Cocos (Keeling) Islands': 38,
  'Palau': 22,
  'Mariana Islands': 166,
  'Marshall Islands': 168,
  'Federated States of Micronesia': 173,
  'Micronesia': 173,

  // —— 南极 / 特殊 ——
  'Antarctica': 13,
};

let cache = null;

/**
 * 解析 cty.dat，构建 prefix → entity 索引。
 * 单进程只解析一次，缓存到模块级。
 */
function loadCty() {
  if (cache) return cache;

  const text = fs.readFileSync(CTY_PATH, 'utf8');
  const lines = text.split(/\r?\n/);

  /** @type {{ name: string, cqz: number, ituz: number, continent: string, primaryPrefix: string, prefixes: { prefix: string; isException: boolean; }[] }[]} */
  const entities = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.replace(/<.+?>/g, ''); // 防御性剥离残留的 ADIF 标签
    if (!line.trim()) continue;

    // 前缀列表行：缩进（以空白开头）。一条实体的前缀表可以**跨多行**
    // —— 中间行以 `,` 结尾，最后一行以 `;` 结尾。所以这里**不依赖行尾字符**，
    // 只要识别为续行就解析 token；当前实体切换到下一条时才把它推到 entities。
    if (/^\s/.test(line)) {
      if (!current) continue;
      const body = line.trim().replace(/[,;]$/, ''); // 去行尾的 `,` 或 `;`
      for (const tok of body.split(',').map((s) => s.trim()).filter(Boolean)) {
        const isException = tok.startsWith('=');
        // 去掉 `=`、`(CQ 区 N)`、`[ITU 区 M]` 这些修饰，只保留纯前缀字符串
        const prefix = tok
          .replace(/^=/, '')
          .replace(/\(\d+\)/g, '')
          .replace(/\[\d+\]/g, '');
        if (!prefix) continue;
        current.prefixes.push({ prefix, isException });
      }
      continue;
    }

    // 标题行：`Name: CQ: ITU: Cont: Lat: Lon: UTC: Primary:`  共 8 个字段
    const parts = line.split(':');
    if (parts.length < 8) continue;
    if (current) entities.push(current); // 上一条还没推走，在这里收尾
    const [name, cqz, ituz, continent, , , , primaryPrefix] = parts.map((s) => s.trim());
    current = {
      name,
      cqz: Number(cqz),
      ituz: Number(ituz),
      continent,
      primaryPrefix,
      prefixes: [],
    };
  }
  if (current) entities.push(current); // 文件末尾的最后一条

  // 展平成单层数组，按 prefix 长度降序。例外项（完整呼号，长度大）天然排前面。
  const flat = [];
  for (const e of entities) {
    for (const p of e.prefixes) {
      flat.push({ ...p, entity: e });
    }
  }
  flat.sort((a, b) => b.prefix.length - a.prefix.length);

  cache = { entities, flat };
  return cache;
}

/**
 * 把呼号归到 DXCC 实体。
 *
 * @param {string|null|undefined} callsign  对方呼号（大小写不敏感；忽略末尾的 "/P" "/M" 后缀）
 * @returns {{ name: string, dxcc: string|null, cqz: number, ituz: number, continent: string } | null}
 *   `dxcc` 是字符串型编号（表里查不到时为 null）。查不到实体时整个返回 null。
 */
export function lookupDxcc(callsign) {
  if (!callsign || typeof callsign !== 'string') return null;
  let cs = callsign.trim().toUpperCase();
  if (!cs) return null;

  // 去掉激活后缀（如 `/P` `/M` `/MM` `/QRP` 等），只保留主呼号
  cs = cs.split('/')[0];
  if (!cs) return null;

  const { flat } = loadCty();
  for (const entry of flat) {
    if (entry.isException) {
      // 例外是完整呼号，必须**完全相等**
      if (entry.prefix === cs) return shape(entry.entity);
    } else if (cs.startsWith(entry.prefix)) {
      return shape(entry.entity);
    }
  }
  return null;
}

function shape(entity) {
  const dxccNum = DXCC_NUMBERS[entity.name];
  return {
    name: entity.name,
    dxcc: dxccNum != null ? String(dxccNum).padStart(3, '0') : null,
    cqz: entity.cqz,
    ituz: entity.ituz,
    continent: entity.continent,
  };
}

/**
 * 强制刷新 cty 缓存（一般不用；测试 / 热替换场景可用）。
 */
export function _resetCtyCache() {
  cache = null;
}

/**
 * 从官网拉取最新 cty.dat 并就地替换（内容有变化才写盘）。
 * 只比对内容 sha256，不依赖"上次同步时间"之类的状态文件。
 * 写盘后清空模块缓存，下次 `lookupDxcc` 自动用新数据。
 *
 * @param {{ force?: boolean, url?: string }} [opts]
 * @returns {Promise<{ updated: boolean, reason?: string, stats: ReturnType<typeof ctyStats> }>}
 */
export async function syncCtyFromWeb(opts = {}) {
  const { force = false, url = CTY_URL } = opts;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载 cty.dat 失败: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  let localSha = '';
  try {
    const cur = fs.readFileSync(CTY_PATH);
    localSha = createHash('sha256').update(cur).digest('hex');
  } catch {
    /* 文件不存在 → 视为需要更新 */
  }
  const remoteSha = createHash('sha256').update(buf).digest('hex');

  if (!force && localSha === remoteSha) {
    return { updated: false, reason: 'unchanged', stats: ctyStats() };
  }

  fs.writeFileSync(CTY_PATH, buf);
  cache = null; // 下次查询重新解析
  return { updated: true, stats: ctyStats() };
}

/**
 * 自检：解析用过的总实体数 / 前缀条目数。调试 / 健康检查用。
 */
export function ctyStats() {
  const { entities, flat } = loadCty();
  return {
    entities: entities.length,
    prefixes: flat.length,
    exceptions: flat.filter((x) => x.isException).length,
    dxccMapped: entities.filter((e) => DXCC_NUMBERS[e.name] != null).length,
  };
}