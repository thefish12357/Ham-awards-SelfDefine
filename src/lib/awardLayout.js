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
    strokeWidth: 0.5,
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
