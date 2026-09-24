/**
 * 奖状布局 schema（v2）与工具函数
 * ------------------------------------------------------------------
 * 布局统一用**毫米（mm）**为坐标单位，画布默认 A4 横版 297×210 mm。
 * 好处：预览（HTML）与 PDF（后续 M3）用同一份数据，只需各自做 mm→px / mm→pt 换算，
 * 不会因为 DPI 不同产生三处实现漂移。
 *
 * 元素类型：
 *   - text   文字（可绑定字段或写死文字）
 *   - image  图片（当前用 URL 引用）
 *   - qrcode 校验二维码（编辑器里先画占位，M3 再渲染真二维码）
 *   - shape  形状/边框（rect 或 line）
 */

export const CANVAS_MM = { w: 297, h: 210 };

/**
 * 内置默认底图（`public/default-award-bg.svg`）。
 * 不想找图又希望奖状有个像样的纸面底色时，设计器里一键套用。
 * ⚠️ 必须保持**同源相对路径**：导出 PDF 走 html-to-image 栅格化，
 *    跨域图片会污染 canvas；放在 public/ 下天然同源。
 */
export const DEFAULT_BG_URL = '/default-award-bg.svg';

/** 可绑定到文字/二维码的动态字段 */
export const FIELD_BINDINGS = [
  { value: 'callsign', label: '呼号' },
  { value: 'awardName', label: '奖状名称' },
  { value: 'level', label: '等级' },
  { value: 'serial', label: '序列号' },
  { value: 'issueDate', label: '签发日期' },
  { value: 'score', label: '得分' },
  { value: 'issuer', label: '颁发机构' },
  { value: 'verifyUrl', label: '校验链接' },
  { value: 'description', label: '描述' },
  { value: 'custom', label: '固定文字' },
];

/**
 * 可选字体（v2 布局用）
 * ------------------------------------------------------------------
 * ★ 版权红线：这里**只允许**开源可商用授权（SIL OFL / Apache-2.0 / 官方明确免费商用）
 *   与操作系统自带字体。**严禁**加入方正、汉仪、造字工房、华文、长城等商业字体
 *   —— 商业字体用于生成对外发布的奖状，会收到律师函。
 *
 * 为什么系统自带字体可以写进来：
 *   - CSS 里写 `font-family: "Microsoft YaHei"` 只是**告诉浏览器去用本机装的那个字体**，
 *     属于常规引用，不涉及复制/再分发，与"把字体文件打包进产品"是两回事；
 *   - 本平台导出 PDF 走的是**栅格化**（渲染成位图再放进 PDF），**不是嵌入字体文件**，
 *     因此不受字体 EULA 里"嵌入分发"条款的约束。
 *   即便如此，仍优先推荐开源字体，系统字体只作兜底。
 *
 * `value` 是完整的 CSS font-family 栈：前面写开源字体，后面跟同风格的系统字体兜底，
 * 这样"装了就用开源字体，没装也有相近观感"，不会出现方框或突兀回退。
 *
 * ★ 已自托管（2026-09-21）：思源黑体（Noto Sans SC）与思源宋体（Noto Serif SC）
 *   的 400 / 700 字重已放进 `public/fonts`，并在 `src/styles/fonts.css` 声明 @font-face
 *   （中文按 unicode-range 切成 101 片，浏览器只下载实际用到的那几片）。
 *   **这两款在任何设备上都能一致渲染**；其余字体仍取决于本机是否安装，会按栈顺序回退。
 *   更新字体：`npm install && node scripts/build-fonts.mjs`（见 AGENTS.md §7 第 12 条）。
 *
 * ⚠️ 导出 PDF 前必须 `await document.fonts.ready`：@font-face 用的是 `font-display: swap`，
 *    字体没加载完就栅格化会拿到回退字体，导致 PDF 与设计不一致。
 */
export const FONTS = [
  // ---- 开源可商用：中文（★ = 已自托管，所有设备渲染一致）----
  { group: '开源·中文', value: '"Noto Sans SC","Source Han Sans SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif', label: '思源黑体 · OFL ★已内置' },
  { group: '开源·中文', value: '"Noto Serif SC","Source Han Serif SC","Noto Serif CJK SC","SimSun",serif', label: '思源宋体 · OFL ★已内置' },
  { group: '开源·中文', value: '"LXGW WenKai","LXGW WenKai Screen","KaiTi","STKaiti",serif', label: '霞鹜文楷 · OFL' },
  { group: '开源·中文', value: '"Smiley Sans","Smiley Sans Oblique","Microsoft YaHei",sans-serif', label: '得意黑 · OFL' },
  { group: '开源·中文', value: '"Alibaba PuHuiTi","Alibaba PuHuiTi 3.0","Microsoft YaHei",sans-serif', label: '阿里巴巴普惠体 · 官方免费商用' },
  { group: '开源·中文', value: '"HarmonyOS Sans SC","HarmonyOS Sans","Microsoft YaHei",sans-serif', label: '鸿蒙黑体 · 官方免费商用' },
  { group: '开源·中文', value: '"OPPO Sans","OPPO Sans 4.0","Microsoft YaHei",sans-serif', label: 'OPPO Sans · 官方免费商用' },
  { group: '开源·中文', value: '"Sarasa Gothic SC","Sarasa SC","Sarasa Mono SC","Microsoft YaHei",sans-serif', label: '更纱黑体 · OFL' },
  { group: '开源·中文', value: '"ZCOOL QingKe HuangYou","Microsoft YaHei",sans-serif', label: '站酷庆科黄油体 · 站酷免费商用' },
  { group: '开源·中文', value: '"ZCOOL KuaiLe","Microsoft YaHei",cursive', label: '站酷快乐体 · 站酷免费商用' },

  // ---- 开源可商用：西文 / 装饰（中文会回退到栈尾的中文字体）----
  { group: '开源·西文', value: '"JetBrains Mono","Fira Code","Cascadia Code","Consolas",monospace', label: 'JetBrains Mono · OFL（等宽）' },
  { group: '开源·西文', value: '"Cinzel","Trajan Pro",serif', label: 'Cinzel · OFL（古典衬线）' },
  { group: '开源·西文', value: '"Playfair Display",serif', label: 'Playfair Display · OFL（优雅衬线）' },
  { group: '开源·西文', value: '"Montserrat","HarmonyOS Sans SC","Microsoft YaHei",sans-serif', label: 'Montserrat · OFL（现代无衬线）' },
  { group: '开源·西文', value: '"Oswald","HarmonyOS Sans SC","Microsoft YaHei",sans-serif', label: 'Oswald · OFL（窄体标题）' },
  { group: '开源·西文', value: '"Pacifico","KaiTi",cursive', label: 'Pacifico · OFL（手写）' },

  // ---- 系统自带（常规引用，不分发字体文件）----
  { group: '系统·中文', value: '"Microsoft YaHei","微软雅黑","PingFang SC",sans-serif', label: '微软雅黑 / 苹方（系统黑体）' },
  { group: '系统·中文', value: '"SimSun","宋体","Songti SC",serif', label: '宋体（系统衬线）' },
  { group: '系统·中文', value: '"KaiTi","楷体","STKaiti",serif', label: '楷体（系统楷书）' },
  { group: '系统·中文', value: '"FangSong","仿宋","STFangsong",serif', label: '仿宋（系统仿宋）' },
  { group: '系统·中文', value: '"SimHei","黑体",sans-serif', label: '黑体（系统粗黑）' },
  { group: '系统·中文', value: '"LiSu","隶书","STLiti",serif', label: '隶书（系统隶书）' },
  { group: '系统·中文', value: '"YouYuan","幼圆",sans-serif', label: '幼圆（系统圆体）' },
  { group: '系统·中文', value: '"Consolas","Monaco","Courier New",monospace', label: '系统等宽' },

  // ---- 通用族（最终兜底）----
  { group: '通用', value: 'sans-serif', label: '默认无衬线' },
  { group: '通用', value: 'serif', label: '默认衬线' },
  { group: '通用', value: 'monospace', label: '默认等宽' },
];

/** 字体分组顺序（用于下拉框的 optgroup） */
export const FONT_GROUPS = ['开源·中文', '开源·西文', '系统·中文', '通用'];

export const ALIGN = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
];

export const VALIGN = [
  { value: 'top', label: '顶部' },
  { value: 'middle', label: '垂直居中' },
  { value: 'bottom', label: '底部' },
];

/* ==================================================================
 * 形状（shape）几何
 * ------------------------------------------------------------------
 * 参考 Word「插入 → 形状」，内置一组常用图形。
 * 所有图形都在**元素框内**用 0..1 归一化坐标描述，再按元素实际宽高
 * （px）缩放，因此任意拉伸都不走样；描边宽度单独以 px 传入，不随拉伸变形。
 *
 * ★ 统一用 SVG path 表达（含矩形/椭圆），渲染端只需一个 <path> 分支，
 *   以后加新形状只改这里 + SHAPES 列表即可。
 * ================================================================== */

/** 可插入的形状（value 会被写进 elements[].shape，改动务必保持向后兼容） */
export const SHAPES = [
  { value: 'rect', label: '矩形' },
  { value: 'roundRect', label: '圆角矩形' },
  { value: 'ellipse', label: '椭圆' },
  { value: 'triangle', label: '等腰三角形' },
  { value: 'rightTriangle', label: '直角三角形' },
  { value: 'diamond', label: '菱形' },
  { value: 'pentagon', label: '五边形' },
  { value: 'hexagon', label: '六边形' },
  { value: 'octagon', label: '八边形' },
  { value: 'star5', label: '五角星' },
  { value: 'star6', label: '六角星' },
  { value: 'parallelogram', label: '平行四边形' },
  { value: 'trapezoid', label: '梯形' },
  { value: 'arrowRight', label: '右箭头' },
  { value: 'arrowLeft', label: '左箭头' },
  { value: 'arrowUp', label: '上箭头' },
  { value: 'arrowDown', label: '下箭头' },
  { value: 'chevron', label: '燕尾形' },
  { value: 'cross', label: '十字形' },
  { value: 'heart', label: '心形' },
  { value: 'cloud', label: '云形' },
  { value: 'line', label: '直线' },
];

export const shapeLabel = (v) => (SHAPES.find((s) => s.value === v) || {}).label || '形状';

const n3 = (n) => Math.round(n * 1000) / 1000;

/** 归一化点集 → path d */
const polyPath = (pts, W, H) => `M${pts.map(([u, v]) => `${n3(u * W)},${n3(v * H)}`).join(' L')} Z`;

/** 正 n 边形点集（rot：起始角，弧度） */
const regularPts = (n, rot) => {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = rot + (i * 2 * Math.PI) / n;
    pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
  }
  return pts;
};

/** 星形点集（spikes：角数；innerRatio：内半径比例） */
const starPts = (spikes, innerRatio, rot) => {
  const pts = [];
  const step = Math.PI / spikes;
  for (let i = 0; i < spikes * 2; i += 1) {
    const rad = i % 2 === 0 ? 1 : innerRatio;
    const a = rot + i * step;
    pts.push([0.5 + 0.5 * rad * Math.cos(a), 0.5 + 0.5 * rad * Math.sin(a)]);
  }
  return pts;
};

/** 块状箭头（朝右）的归一化轮廓，其余方向由它旋转得到 */
const ARROW_RIGHT = [
  [0, 0.35],
  [0.6, 0.35],
  [0.6, 0.05],
  [1, 0.5],
  [0.6, 0.95],
  [0.6, 0.65],
  [0, 0.65],
];

/**
 * 生成形状的 SVG path d。
 * @param {string} shape SHAPES 里的 value（未知值退化成矩形）
 * @param {number} W 元素渲染宽度（px）
 * @param {number} H 元素渲染高度（px）
 * @param {number} [radiusPx] 圆角半径（px，仅 roundRect 用；<=0 时取短边的 12%）
 */
export function shapePath(shape, W, H, radiusPx = 0) {
  const w = Math.max(W, 1);
  const h = Math.max(H, 1);
  switch (shape) {
    case 'line':
      // 画在元素框的垂直中线：用户拉伸高度时线始终居中
      return `M0,${n3(h / 2)} L${n3(w)},${n3(h / 2)}`;
    case 'roundRect': {
      const rr = Math.min(radiusPx > 0 ? radiusPx : Math.min(w, h) * 0.12, Math.min(w, h) / 2);
      return (
        `M${n3(rr)},0 L${n3(w - rr)},0 A${n3(rr)},${n3(rr)} 0 0 1 ${n3(w)},${n3(rr)}` +
        ` L${n3(w)},${n3(h - rr)} A${n3(rr)},${n3(rr)} 0 0 1 ${n3(w - rr)},${n3(h)}` +
        ` L${n3(rr)},${n3(h)} A${n3(rr)},${n3(rr)} 0 0 1 0,${n3(h - rr)}` +
        ` L0,${n3(rr)} A${n3(rr)},${n3(rr)} 0 0 1 ${n3(rr)},0 Z`
      );
    }
    case 'ellipse': {
      const rx = w / 2;
      const ry = h / 2;
      return `M0,${n3(ry)} A${n3(rx)},${n3(ry)} 0 0 1 ${n3(w)},${n3(ry)} A${n3(rx)},${n3(ry)} 0 0 1 0,${n3(ry)} Z`;
    }
    case 'triangle':
      return polyPath([[0.5, 0], [1, 1], [0, 1]], w, h);
    case 'rightTriangle':
      return polyPath([[0, 0], [0, 1], [1, 1]], w, h);
    case 'diamond':
      return polyPath([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]], w, h);
    case 'pentagon':
      return polyPath(regularPts(5, -Math.PI / 2), w, h);
    case 'hexagon':
      return polyPath(regularPts(6, 0), w, h);
    case 'octagon':
      return polyPath(regularPts(8, Math.PI / 8), w, h);
    case 'star5':
      return polyPath(starPts(5, 0.382, -Math.PI / 2), w, h);
    case 'star6':
      return polyPath(starPts(6, 0.577, -Math.PI / 2), w, h);
    case 'parallelogram':
      return polyPath([[0.25, 0], [1, 0], [0.75, 1], [0, 1]], w, h);
    case 'trapezoid':
      return polyPath([[0.22, 0], [0.78, 0], [1, 1], [0, 1]], w, h);
    case 'arrowRight':
      return polyPath(ARROW_RIGHT, w, h);
    case 'arrowLeft':
      return polyPath(ARROW_RIGHT.map(([u, v]) => [1 - u, 1 - v]), w, h);
    case 'arrowUp':
      return polyPath(ARROW_RIGHT.map(([u, v]) => [v, 1 - u]), w, h);
    case 'arrowDown':
      return polyPath(ARROW_RIGHT.map(([u, v]) => [1 - v, u]), w, h);
    case 'chevron':
      return polyPath([[0, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0, 1], [0.25, 0.5]], w, h);
    case 'cross':
      return polyPath(
        [[0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65], [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35]],
        w,
        h,
      );
    case 'heart':
      return (
        `M${n3(0.5 * w)},${n3(h)} C${n3(0.12 * w)},${n3(0.72 * h)} 0,${n3(0.5 * h)} 0,${n3(0.3 * h)}` +
        ` C0,${n3(0.1 * h)} ${n3(0.16 * w)},0 ${n3(0.31 * w)},0` +
        ` C${n3(0.41 * w)},0 ${n3(0.48 * w)},${n3(0.06 * h)} ${n3(0.5 * w)},${n3(0.14 * h)}` +
        ` C${n3(0.52 * w)},${n3(0.06 * h)} ${n3(0.59 * w)},0 ${n3(0.69 * w)},0` +
        ` C${n3(0.84 * w)},0 ${n3(w)},${n3(0.1 * h)} ${n3(w)},${n3(0.3 * h)}` +
        ` C${n3(w)},${n3(0.5 * h)} ${n3(0.88 * w)},${n3(0.72 * h)} ${n3(0.5 * w)},${n3(h)} Z`
      );
    case 'cloud':
      // 三个圆弧拼出的云朵轮廓（左半圆 → 顶部大圆弧 → 右半圆 → 底边闭合）
      return (
        `M${n3(0.2 * w)},${n3(0.88 * h)} A${n3(0.2 * w)},${n3(0.2 * h)} 0 0 1 ${n3(0.2 * w)},${n3(0.48 * h)}` +
        ` A${n3(0.3 * w)},${n3(0.3 * h)} 0 0 1 ${n3(0.8 * w)},${n3(0.48 * h)}` +
        ` A${n3(0.2 * w)},${n3(0.2 * h)} 0 0 1 ${n3(0.8 * w)},${n3(0.88 * h)} Z`
      );
    case 'rect':
    default:
      return polyPath([[0, 0], [1, 0], [1, 1], [0, 1]], w, h);
  }
}

let idCounter = 0;
export const uid = () => `el_${Date.now().toString(36)}_${(idCounter += 1).toString(36)}`;

export function defaultLayout(bgUrl = '') {
  return {
    v: 2,
    canvas: { w: CANVAS_MM.w, h: CANVAS_MM.h, bgUrl: bgUrl || '', bgFit: 'cover', bgOpacity: 1 },
    elements: [],
  };
}

/**
 * 归一化旧数据。上游旧版 `layout` 恒为 `[]`（或 null/旧结构），
 * 这里统一迁移成 v2 空布局，避免渲染端到处判空。
 */
export function normalizeLayout(layout, bgUrl = '') {
  if (layout && layout.v === 2 && layout.canvas) {
    return {
      ...layout,
      canvas: {
        w: CANVAS_MM.w,
        h: CANVAS_MM.h,
        ...layout.canvas,
        bgUrl: layout.canvas.bgUrl || bgUrl || '',
      },
      elements: Array.isArray(layout.elements) ? layout.elements : [],
    };
  }
  return defaultLayout(bgUrl);
}

function base(x, y, z) {
  return { id: uid(), x, y, opacity: 1, rotation: 0, z };
}

export function newTextElement(x, y) {
  return {
    ...base(x, y, 1),
    type: 'text',
    binding: 'callsign',
    text: '',
    w: 100,
    h: 12,
    font: '',
    color: '#111827',
    weight: 700,
    align: 'center',
    valign: 'middle',
  };
}

export function newShapeElement(x, y) {
  return {
    ...base(x, y, 1),
    type: 'shape',
    shape: 'rect',
    w: 120,
    h: 80,
    fill: 'none',
    stroke: '#c8a45c',
    // ⚠️ 默认线宽不要低于 1mm：编辑器画布约 560px 宽，0.5mm 换算下来不足 1 个物理像素，
    //    形状会「加了却看不见」（2026-09-24 用户反馈）。
    strokeWidth: 1,
  };
}

export function newImageElement(x, y) {
  return {
    ...base(x, y, 1),
    type: 'image',
    src: '',
    w: 60,
    h: 60,
  };
}

export function newQrElement(x, y) {
  return {
    ...base(x, y, 1),
    type: 'qrcode',
    binding: 'verifyUrl',
    w: 30,
    h: 30,
  };
}

/**
 * 解析元素最终显示的内容。
 *  - binding === 'custom' 或无 binding → 用 el.text（写死的文字）
 *  - 其余 → 从 data 里取对应字段
 */
export function resolveElementValue(el, data = {}) {
  if (!el) return '';
  if (el.binding && el.binding !== 'custom') {
    const v = data?.[el.binding];
    return v == null ? '' : String(v);
  }
  return el.text || '';
}

/**
 * 多等级差异（levelOverrides）
 * ------------------------------------------------------------------
 * 一张奖状可以有多个等级（rules.thresholds，如 Bronze / Silver / Gold）。
 * 元素上可挂 `levelOverrides: { 'Gold': { color:'#eab308' } }`，
 * 渲染时按当前等级把差异合并到元素上——**所有消费方（编辑器 / 我的奖状 /
 * 审核预览 / PDF 导出）都走这个函数**，所以只要渲染器改一处即可全部生效。
 */
export function resolveElementForLevel(el, level) {
  if (!el || !level) return el;
  const patch = el.levelOverrides && el.levelOverrides[level];
  return patch ? { ...el, ...patch } : el;
}

export const hasLevelOverride = (el, level) => !!(el && level && el.levelOverrides && el.levelOverrides[level]);

/** 元素是否对任何等级做过覆盖（用于编辑器里的标记） */
export const hasAnyLevelOverride = (el) => !!(el && el.levelOverrides && Object.keys(el.levelOverrides).length > 0);

/* ==================================================================
 * 预设模板
 * ------------------------------------------------------------------
 * 「新建奖状」时用它初始化布局，使用者不必从白纸开始：已经排好
 * 标题 / 呼号 / 等级 / 编号 / 签发日期 / 颁发机构 / 校验二维码 / 双线边框。
 *
 * ⚠️ 只用于**新建**（或布局为空时）的初始化，绝不要塞进 `normalizeLayout`：
 *    否则所有历史空布局奖状都会在渲染时凭空多出一套元素，属于数据事故。
 * ================================================================== */

// 与 FONTS 中的条目保持一致（这里只取常用的三种，避免引用整个列表）
const FONT_SONG = '"Noto Serif SC","Source Han Serif SC","Noto Serif CJK SC","SimSun",serif';
const FONT_HEI = '"Noto Sans SC","Source Han Sans SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif';
const FONT_MONO = '"JetBrains Mono","Fira Code","Cascadia Code","Consolas",monospace';

const textEl = (x, y, w, h, patch) => ({
  ...base(x, y, 1),
  type: 'text',
  binding: 'custom',
  text: '',
  font: FONT_HEI,
  color: '#111827',
  weight: 400,
  align: 'center',
  valign: 'middle',
  w,
  h,
  ...patch,
});

/**
 * 生成 A4 横版（297×210mm）预设模板。
 * @param {string} bgUrl 已有底图地址（可空，之后在编辑器里上传）
 */
export function presetAwardLayout(bgUrl = '') {
  return {
    ...defaultLayout(bgUrl),
    elements: [
      // ---- 边框（z=0，永远在最底层）----
      { ...base(10, 10, 0), type: 'shape', shape: 'rect', w: 277, h: 190, fill: 'none', stroke: '#c8a45c', strokeWidth: 1.2 },
      { ...base(13.5, 13.5, 0), type: 'shape', shape: 'rect', w: 270, h: 183, fill: 'none', stroke: '#c8a45c', strokeWidth: 0.4 },

      // ---- 标题区 ----
      textEl(58.5, 26, 180, 18, { text: '荣 誉 证 书', font: FONT_SONG, weight: 700 }),
      textEl(58.5, 47, 180, 6, { text: 'HONORARY CERTIFICATE', font: FONT_MONO, color: '#b08a3e', weight: 400 }),

      // ---- 奖状名称（动态字段）----
      textEl(48.5, 58, 200, 13, { binding: 'awardName', text: '', font: FONT_SONG, color: '#b08a3e', weight: 700 }),

      // ---- 获奖人呼号（动态字段）+ 下划线 ----
      textEl(48.5, 82, 200, 22, { binding: 'callsign', text: '', font: FONT_MONO, weight: 700 }),
      { ...base(98.5, 108, 1), type: 'shape', shape: 'line', w: 100, h: 1, fill: 'none', stroke: '#c8a45c', strokeWidth: 0.8 },

      // ---- 等级 / 描述 ----
      textEl(48.5, 114, 200, 13, { binding: 'level', text: '', font: FONT_SONG, color: '#b08a3e', weight: 700 }),
      textEl(58.5, 134, 180, 8, { binding: 'description', text: '', color: '#6b7280', weight: 400 }),

      // ---- 左下：编号 / 签发日期 ----
      textEl(24, 158, 50, 6, { text: '证书编号', align: 'left', color: '#6b7280' }),
      textEl(24, 165, 80, 7, { binding: 'serial', text: '', font: FONT_MONO, align: 'left' }),
      textEl(24, 178, 50, 6, { text: '签发日期', align: 'left', color: '#6b7280' }),
      textEl(24, 185, 60, 7, { binding: 'issueDate', text: '', font: FONT_MONO, align: 'left' }),

      // ---- 右下：颁发机构 + 校验二维码 ----
      textEl(150, 178, 60, 6, { text: '颁发机构', align: 'right', color: '#6b7280' }),
      textEl(150, 185, 60, 7, { binding: 'issuer', text: '', align: 'right' }),
      { ...base(240, 152, 1), type: 'qrcode', binding: 'verifyUrl', w: 34, h: 34 },
    ],
  };
}
