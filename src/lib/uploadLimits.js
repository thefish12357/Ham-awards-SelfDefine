/**
 * 图片上传限制（单一事实来源）
 * ------------------------------------------------------------------
 * ⚠️ 这里的数值必须与后端 `server.js` 的 multer limits **保持一致**，
 *    否则会出现「前端说能传、后端拒绝」或反过来的不一致体验：
 *      - 底图：        BG_MAX_MB    ↔ `uploadBg` 的 fileSize
 *      - 元素图片：    ASSET_MAX_MB ↔ `uploadAsset` 的 fileSize
 *    改动时两边一起改。
 *
 * 尺寸（像素）只在**前端**校验：服务端没有图像处理库（sharp 等），
 * 无法可靠读取图片尺寸；超出上限时前端会用 canvas 等比缩小后再上传，
 * 既保证「规定好尺寸」，也不会因为大图把奖状 PDF 撑得很大。
 */
export const BG_MAX_MB = 10;
export const ASSET_MAX_MB = 2;
/** 元素图片最长边上限（px），超出则等比缩小 */
export const ASSET_MAX_DIM = 2000;

export const ACCEPT_IMAGE = 'image/png,image/jpeg,image/webp,image/gif';
export const ACCEPT_IMAGE_TEXT = 'JPG / PNG / WebP / GIF';

/** 人类可读的尺寸描述，供各处提示文案复用，避免写成两样 */
export const ASSET_LIMIT_TEXT = `单张不超过 ${ASSET_MAX_MB} MB，最长边不超过 ${ASSET_MAX_DIM}px（超出会自动等比缩小）`;
export const BG_LIMIT_TEXT = `单张不超过 ${BG_MAX_MB} MB，建议 A4 横版比例（297×210）`;
