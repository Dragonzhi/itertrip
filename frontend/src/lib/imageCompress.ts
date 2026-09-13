/**
 * M15 截图压缩（零依赖）：
 * createImageBitmap 解码 → canvas 重采样（长边 ≤2400px，绝不放大）→ JPEG q0.82 data URL。
 * 目标：控制多模态请求体积（每张数百 KB 级），同时保住 OCR 可读性。
 */

const MAX_SIDE = 2400;
const QUALITY = 0.82;

/** 压缩为 JPEG data URL；解码失败（HEIC 等浏览器不支持的格式）抛出中文错误。 */
export async function compressImage(file: File | Blob): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("图片格式无法解析（建议 JPG / PNG 截图）");
  }
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器不支持 Canvas，无法处理截图");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", QUALITY);
  } finally {
    bitmap.close();
  }
}
