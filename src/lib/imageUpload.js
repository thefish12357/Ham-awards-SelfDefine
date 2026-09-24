/**
 * 图片上传前置处理：类型 / 尺寸 / 体积三项校验，必要时等比缩小。
 * ------------------------------------------------------------------
 * 为什么放在前端做：
 *   服务端没有图像处理库（sharp 等），无法可靠读取图片尺寸，也没法压缩。
 *   一次性在这里做完「校验 + 缩小 + 再校验体积」，后端只需兜住体积上限即可。
 *
 * 抛出的 Error.message 都是**直接给用户看的中文原因**，调用方无需再翻译。
 */
import { ASSET_MAX_MB, ASSET_MAX_DIM, ACCEPT_IMAGE_TEXT, BG_MAX_MB } from './uploadLimits.js';

/** 底图允许的最长边（px）。A4 300DPI 约 3508px，4000 足够覆盖，又能挡住离谱的巨图 */
export const BG_MAX_DIM = 4000;

/** 读取图片的自然尺寸；无法解码时抛错 */
const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片无法解码，可能已损坏，请换一张'));
    };
    img.src = url;
  });

const extFor = (type) => (type === 'image/jpeg' ? '.jpg' : type === 'image/webp' ? '.webp' : '.png');

/**
 * 校验并（必要时）等比缩小图片。
 * @param {File} file 用户选择的文件
 * @param {{maxMB?:number, maxDim?:number, label?:string}} [opts]
 * @returns {Promise<{file:File, width:number, height:number, scaled:boolean}>}
 *   width/height 是**最终上传文件**的像素尺寸（缩小后即为缩小后的值），
 *   调用方可用它按真实宽高比设置元素尺寸，避免图片被拉伸变形。
 */
export async function prepareImageForUpload(file, opts = {}) {
  const { maxMB = ASSET_MAX_MB, maxDim = ASSET_MAX_DIM, label = '图片' } = opts;

  if (file.type && !/^image\//.test(file.type)) {
    throw new Error(`「${file.name}」不是图片文件，请选择 ${ACCEPT_IMAGE_TEXT} 格式`);
  }

  const { img, url } = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const longest = Math.max(w, h);

  let out = file;
  let outW = w;
  let outH = h;
  let scaled = false;
  if (maxDim && longest > maxDim) {
    // 等比缩小到最长边 = maxDim，避免超大图拖慢渲染、撑爆 PDF
    const scale = maxDim / longest;
    outW = Math.max(1, Math.round(w * scale));
    outH = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, outW, outH);
    // JPEG 保留 JPEG（有损、体积小），其余统一转 PNG（保透明通道）
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise((r) => canvas.toBlob(r, type, 0.92));
    if (blob) {
      const base = file.name.replace(/\.[^.]+$/, '') || 'image';
      out = new File([blob], `${base}${extFor(type)}`, { type });
      scaled = true;
    }
  }
  URL.revokeObjectURL(url);

  // 体积校验放在缩小之后：一张超尺寸但可压缩的图应当被放行，而不是直接拒绝
  if (out.size > maxMB * 1024 * 1024) {
    throw new Error(`${label}约 ${(out.size / 1024 / 1024).toFixed(1)} MB，超过 ${maxMB} MB 上限，请压缩后再上传`);
  }
  return { file: out, width: outW, height: outH, scaled };
}

export const BG_UPLOAD_PRESET = { maxMB: BG_MAX_MB, maxDim: BG_MAX_DIM, label: '底图' };
