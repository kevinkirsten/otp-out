// Abre a imagem com o decodificador do próprio navegador (PNG, JPG, WEBP, e HEIC
// onde o navegador souber) e devolve os pixels para o leitor de QR.

export class ImageDecodeError extends Error {
  readonly heic: boolean;
  constructor(heic: boolean) {
    super(heic ? "heic_unsupported" : "image_unreadable");
    this.name = "ImageDecodeError";
    this.heic = heic;
  }
}

export function looksLikeHeic(file: Blob & { name?: string }): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name ?? "");
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i.test(file.name);
}

async function decodeWithImageElement(blob: Blob): Promise<HTMLImageElement> {
  // Plano B para formatos que o createImageBitmap não abre mas o <img> abre
  // (HEIC no Safari, por exemplo). A URL blob: é local e liberada logo depois.
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Tamanho máximo do lado maior. Prints de celular passam de 3000px; acima disso o ganho é nenhum. */
const MAX_SIDE = 4096;

export async function fileToImageData(file: Blob & { name?: string }): Promise<ImageData[]> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(file);
  } catch {
    try {
      source = await decodeWithImageElement(file);
    } catch {
      throw new ImageDecodeError(looksLikeHeic(file));
    }
  }
  const width = "naturalWidth" in source ? source.naturalWidth : source.width;
  const height = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (!width || !height) throw new ImageDecodeError(looksLikeHeic(file));

  // Primeiro no tamanho original (limitado), depois reduzido: QR pequeno num
  // print grande lê melhor no original, foto borrada lê melhor reduzida.
  const scales = [Math.min(1, MAX_SIDE / Math.max(width, height))];
  if (Math.max(width, height) > 1600) scales.push(1200 / Math.max(width, height));
  const frames: ImageData[] = [];
  for (const scale of scales) {
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new ImageDecodeError(false);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, w, h);
    context.drawImage(source, 0, 0, w, h);
    frames.push(context.getImageData(0, 0, w, h));
  }
  if ("close" in source) source.close();
  return frames;
}
