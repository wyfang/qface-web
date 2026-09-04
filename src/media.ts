import type { QqAsset } from "./types";

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

export async function copyImage(path: string): Promise<void> {
  const response = await fetch(assetUrl(path));
  if (!response.ok) {
    throw new Error(`图片读取失败：${response.status}`);
  }

  const blob = await response.blob();
  if (blob.type !== "image/png") {
    throw new Error(`浏览器不能复制此图片格式：${blob.type || "未知"}`);
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": blob,
    }),
  ]);
}

export async function copyAssetLink(path: string): Promise<void> {
  const absoluteUrl = new URL(assetUrl(path), window.location.href).href;
  await navigator.clipboard.writeText(absoluteUrl);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function convertApngToGif(
  asset: QqAsset,
  fileName: string,
): Promise<void> {
  const [apngModule, { GIFEncoder, quantize, applyPalette }] =
    await Promise.all([import("apng-js"), import("gifenc")]);
  const defaultExport = apngModule.default as unknown;
  const parseAPNG =
    typeof defaultExport === "function"
      ? defaultExport
      : (defaultExport as { default?: unknown })?.default;
  if (typeof parseAPNG !== "function") {
    throw new Error("无法加载 APNG 解析器");
  }
  const response = await fetch(assetUrl(asset.path));
  if (!response.ok) {
    throw new Error(`APNG 读取失败：${response.status}`);
  }

  const apng = parseAPNG(await response.arrayBuffer()) as ReturnType<
    typeof apngModule.default
  >;
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
  const gif = GIFEncoder();

  for (let index = 0; index < apng.frames.length; index += 1) {
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
  }

  gif.finish();
  const gifBytes = gif.bytes();
  const gifBuffer = gifBytes.buffer.slice(
    gifBytes.byteOffset,
    gifBytes.byteOffset + gifBytes.byteLength,
  ) as ArrayBuffer;
  downloadBlob(new Blob([gifBuffer], { type: "image/gif" }), fileName);
}
