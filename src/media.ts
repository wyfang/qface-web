import type { QqAsset } from "./types";

const generatedGifCache = new Map<string, Blob>();

export type DownloadProgress = {
  loaded: number;
  total?: number;
};

export type ConversionProgress = {
  completed: number;
  total: number;
};

export type MediaTaskOptions = {
  signal?: AbortSignal;
  onDownloadProgress?: (progress: DownloadProgress) => void;
  onConversionProgress?: (progress: ConversionProgress) => void;
};

function abortError(): DOMException {
  return new DOMException("操作已取消", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function cacheGeneratedGif(
  key: string,
  factory: () => Promise<Blob>,
): Promise<Blob> {
  const cached = generatedGifCache.get(key);
  if (cached) return cached;

  const blob = await factory();
  generatedGifCache.set(key, blob);
  return blob;
}

export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\.?\//, "")}`;
}

export function downloadAsset(asset: Pick<QqAsset, "name" | "path">): void {
  const link = document.createElement("a");
  link.href = assetUrl(asset.path);
  link.download = asset.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function openAsset(path: string): void {
  window.open(assetUrl(path), "_blank", "noopener,noreferrer");
}

async function fetchAssetBlob(
  path: string,
  options: MediaTaskOptions = {},
): Promise<Blob | null> {
  const { onDownloadProgress, signal } = options;
  try {
    throwIfAborted(signal);
    const response = await fetch(assetUrl(path), { signal });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    const contentLength = Number(response.headers.get("content-length"));
    const total = Number.isFinite(contentLength) && contentLength > 0
      ? contentLength
      : undefined;

    if (!response.body) {
      const blob = await response.blob();
      throwIfAborted(signal);
      onDownloadProgress?.({ loaded: blob.size, total: total || blob.size });
      return blob;
    }

    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let loaded = 0;
    onDownloadProgress?.({ loaded, total });

    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onDownloadProgress?.({ loaded, total });
    }

    throwIfAborted(signal);
    return new Blob(chunks, { type: contentType });
  } catch (reason) {
    if (
      signal?.aborted ||
      (reason instanceof DOMException && reason.name === "AbortError")
    ) {
      throw abortError();
    }
    return null;
  }
}

async function hasPngSignature(blob: Blob): Promise<boolean> {
  const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return signature.every((byte, index) => header[index] === byte);
}

async function hasPngChunk(blob: Blob, expectedType: string): Promise<boolean> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 20) return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) return false;

    const chunkType = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (chunkType === expectedType) return true;
    if (chunkType === "IEND") return false;
    offset = chunkEnd;
  }
  return false;
}

export async function fetchPngBlob(
  path: string,
  options: MediaTaskOptions = {},
): Promise<Blob | null> {
  const blob = await fetchAssetBlob(path, options);
  throwIfAborted(options.signal);
  if (!blob || !(await hasPngSignature(blob))) return null;
  return blob.type === "image/png"
    ? blob
    : new Blob([blob], { type: "image/png" });
}

export async function fetchApngBlob(
  path: string,
  options: MediaTaskOptions = {},
): Promise<Blob | null> {
  const blob = await fetchPngBlob(path, options);
  throwIfAborted(options.signal);
  if (!blob || !(await hasPngChunk(blob, "acTL"))) return null;
  return blob;
}

export async function copyPngBlob(
  blob: Blob,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("当前浏览器不支持复制图片");
  }
  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": blob,
    }),
  ]);
  throwIfAborted(signal);
}

export async function copyImage(path: string): Promise<void> {
  const blob = await fetchPngBlob(path);
  if (!blob) throw new Error("PNG 图片无效或无法读取");
  await copyPngBlob(blob);
}

export type GifClipboardMode = "native" | "rich-text";

async function isGif(blob: Blob): Promise<boolean> {
  const header = new Uint8Array(await blob.slice(0, 6).arrayBuffer());
  const signature = String.fromCharCode(...header);
  return signature === "GIF87a" || signature === "GIF89a";
}

export async function fetchGifBlob(
  path: string,
  options: MediaTaskOptions = {},
): Promise<Blob | null> {
  const blob = await fetchAssetBlob(path, options);
  throwIfAborted(options.signal);
  if (!blob || !(await isGif(blob))) return null;
  return blob.type === "image/gif"
    ? blob
    : new Blob([blob], { type: "image/gif" });
}

function blobToDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const reader = new FileReader();
    const handleAbort = () => reader.abort();
    signal?.addEventListener("abort", handleAbort, { once: true });
    reader.addEventListener("load", () => {
      signal?.removeEventListener("abort", handleAbort);
      resolve(String(reader.result));
    });
    reader.addEventListener("error", () => {
      signal?.removeEventListener("abort", handleAbort);
      reject(reader.error);
    });
    reader.addEventListener("abort", () => {
      signal?.removeEventListener("abort", handleAbort);
      reject(abortError());
    });
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function copyGifBlob(
  blob: Blob,
  alt: string,
  signal?: AbortSignal,
): Promise<GifClipboardMode> {
  throwIfAborted(signal);
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("当前浏览器不支持复制图片");
  }

  const supportsNativeGif =
    typeof ClipboardItem.supports !== "function" ||
    ClipboardItem.supports("image/gif");

  if (supportsNativeGif) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/gif": blob,
        }),
      ]);
      throwIfAborted(signal);
      return "native";
    } catch (reason) {
      if (
        !(reason instanceof DOMException) ||
        !["DataError", "NotSupportedError"].includes(reason.name)
      ) {
        throw reason;
      }
    }
  }

  if (
    typeof ClipboardItem.supports === "function" &&
    !ClipboardItem.supports("text/html")
  ) {
    throw new Error("当前浏览器不能复制 GIF");
  }

  const dataUrl = await blobToDataUrl(blob, signal);
  throwIfAborted(signal);
  const html = `<img src="${dataUrl}" alt="${escapeHtml(alt)}">`;
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
    }),
  ]);
  throwIfAborted(signal);
  return "rich-text";
}

export async function copyAssetLink(path: string): Promise<void> {
  const absoluteUrl = new URL(assetUrl(path), window.location.href).href;
  await navigator.clipboard.writeText(absoluteUrl);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function gifBytesToBlob(gifBytes: Uint8Array): Blob {
  const gifBuffer = gifBytes.buffer.slice(
    gifBytes.byteOffset,
    gifBytes.byteOffset + gifBytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([gifBuffer], { type: "image/gif" });
}

async function yieldToBrowser(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function encodeApngToGifBlob(
  asset: QqAsset,
  sourceBlob: Blob | undefined,
  options: MediaTaskOptions,
): Promise<Blob> {
  const { onConversionProgress, signal } = options;
  throwIfAborted(signal);
  const [apngModule, { GIFEncoder, quantize, applyPalette }] =
    await Promise.all([import("apng-js"), import("gifenc")]);
  throwIfAborted(signal);
  const defaultExport = apngModule.default as unknown;
  const parseAPNG =
    typeof defaultExport === "function"
      ? defaultExport
      : (defaultExport as { default?: unknown })?.default;
  if (typeof parseAPNG !== "function") {
    throw new Error("无法加载 APNG 解析器");
  }
  let apngBlob = sourceBlob;
  if (!apngBlob) {
    apngBlob = await fetchApngBlob(asset.path, options) || undefined;
  }
  if (!apngBlob) {
    throw new Error("APNG 读取失败");
  }

  const apng = parseAPNG(await apngBlob.arrayBuffer()) as ReturnType<
    typeof apngModule.default
  >;
  throwIfAborted(signal);
  if (apng instanceof Error) {
    throw apng;
  }

  const canvas = document.createElement("canvas");
  canvas.width = apng.width;
  canvas.height = apng.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("无法初始化 Canvas");
  }

  const player = await apng.getPlayer(context, false);
  throwIfAborted(signal);
  const gif = GIFEncoder();
  onConversionProgress?.({ completed: 0, total: apng.frames.length });

  for (let index = 0; index < apng.frames.length; index += 1) {
    throwIfAborted(signal);
    if (index > 0) {
      player.renderNextFrame();
    }

    const frame = apng.frames[index];
    const imageData = context.getImageData(0, 0, apng.width, apng.height);
    const rgba = new Uint8Array(imageData.data);
    const palette = quantize(rgba, 256, {
      format: "rgba4444",
      oneBitAlpha: true,
    });
    const indexedFrame = applyPalette(rgba, palette, "rgba4444");

    gif.writeFrame(indexedFrame, apng.width, apng.height, {
      palette,
      delay: Math.max(20, Math.round(frame?.delay || 100)),
      transparent: true,
      transparentIndex: 0,
      ...(index === 0 ? { repeat: 0 } : {}),
    });
    onConversionProgress?.({
      completed: index + 1,
      total: apng.frames.length,
    });
    await yieldToBrowser();
  }

  throwIfAborted(signal);
  gif.finish();
  return gifBytesToBlob(gif.bytes());
}

export function convertApngToGifBlob(
  asset: QqAsset,
  sourceBlob?: Blob,
  options: MediaTaskOptions = {},
): Promise<Blob> {
  return cacheGeneratedGif(`apng:${asset.path}`, () =>
    encodeApngToGifBlob(asset, sourceBlob, options),
  );
}

async function encodeCanvasAsGif(
  canvas: HTMLCanvasElement,
  options: MediaTaskOptions = {},
): Promise<Blob> {
  const { onConversionProgress, signal } = options;
  throwIfAborted(signal);
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  throwIfAborted(signal);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法初始化 Canvas");

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  onConversionProgress?.({ completed: 0, total: 1 });
  const rgba = new Uint8Array(imageData.data);
  const palette = quantize(rgba, 256, {
    format: "rgba4444",
    oneBitAlpha: true,
  });
  const indexedFrame = applyPalette(rgba, palette, "rgba4444");
  const gif = GIFEncoder();
  gif.writeFrame(indexedFrame, canvas.width, canvas.height, {
    palette,
    delay: 1000,
    repeat: 0,
    transparent: true,
    transparentIndex: 0,
  });
  gif.finish();
  onConversionProgress?.({ completed: 1, total: 1 });
  throwIfAborted(signal);
  return gifBytesToBlob(gif.bytes());
}

export function convertPngToGifBlob(
  path: string,
  blob: Blob,
  options: MediaTaskOptions = {},
): Promise<Blob> {
  return cacheGeneratedGif(`png:${path}`, async () => {
    throwIfAborted(options.signal);
    const bitmap = await createImageBitmap(blob);
    try {
      throwIfAborted(options.signal);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法初始化 Canvas");
      context.drawImage(bitmap, 0, 0);
      return await encodeCanvasAsGif(canvas, options);
    } finally {
      bitmap.close();
    }
  });
}

export function convertTextToGifBlob(
  key: string,
  text: string,
  options: MediaTaskOptions = {},
): Promise<Blob> {
  return cacheGeneratedGif(`text:${key}`, async () => {
    throwIfAborted(options.signal);
    await document.fonts.ready;
    throwIfAborted(options.signal);
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法初始化 Canvas");

    const fontFamily =
      '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    let fontSize = 80;
    context.font = `${fontSize}px ${fontFamily}`;
    const measuredWidth = context.measureText(text).width;
    if (measuredWidth > 112) {
      fontSize = Math.max(24, Math.floor((fontSize * 112) / measuredWidth));
      context.font = `${fontSize}px ${fontFamily}`;
    }
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 64, 68);
    return encodeCanvasAsGif(canvas, options);
  });
}

export async function convertApngToGif(
  asset: QqAsset,
  fileName: string,
): Promise<void> {
  downloadBlob(await convertApngToGifBlob(asset), fileName);
}
