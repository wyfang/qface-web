import * as gifencModule from "gifenc";

// gifenc exposes ESM to Vite and a CommonJS object to Node's test runner.
const { applyPalette, GIFEncoder, quantize } = "GIFEncoder" in gifencModule
  ? gifencModule
  : (gifencModule as unknown as { default: typeof gifencModule }).default;

export const GIF_MAX_EDGE = 499;
export const GIF_MAX_BYTES = 10_000_000;
export const MAX_INPUT_PIXELS = 4_194_304;
export const MAX_INPUT_FRAMES = 2_000;

export function gifDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_INPUT_PIXELS) {
    throw new Error("表情原图尺寸过大，暂时无法在浏览器中处理");
  }
  const ratio = GIF_MAX_EDGE / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

export type GifFrameGroup = { first: number; last: number; delay: number };

// Round cumulative time, not each frame: 24 frames at 24 fps remain 1 second.
export function gifFrameGroups(delays: number[], stride = 1): GifFrameGroup[] {
  const groups: GifFrameGroup[] = [];
  let groupStart = 0;
  let elapsed = 0;
  let emittedCs = 0;
  for (let index = 0; index < delays.length; index++) {
    const delay = delays[index];
    elapsed += Number.isFinite(delay) && delay > 0 ? delay : 100;
    const endCs = Math.round(elapsed / 10);
    if (index + 1 - groupStart >= stride && endCs - emittedCs >= 2) {
      groups.push({ first: groupStart, last: index, delay: (endCs - emittedCs) * 10 });
      emittedCs = endCs;
      groupStart = index + 1;
    }
  }
  if (groupStart < delays.length) {
    const remainder = Math.round(elapsed / 10) - emittedCs;
    if (groups.length) {
      groups[groups.length - 1].last = delays.length - 1;
      groups[groups.length - 1].delay += remainder * 10;
    } else groups.push({ first: 0, last: delays.length - 1, delay: Math.max(20, Math.round(elapsed / 10) * 10) });
  }
  if (groups.some((group) => group.delay > 655_350)) {
    throw new Error("表情动画的停留时间过长，暂时无法转换为 GIF");
  }
  return groups;
}

// GIF has one-bit transparency. Reserve a dedicated slot; visible pixels never
// accidentally become transparent simply because quantization chose index zero.
export function gifFramePalette(rgba: Uint8ClampedArray, maxColors: number) {
  let opaqueCount = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] >= 128) opaqueCount++;
  const hasTransparentPixels = opaqueCount < rgba.length / 4;
  const opaque = hasTransparentPixels ? new Uint8ClampedArray(opaqueCount * 4) : rgba;
  if (hasTransparentPixels) {
    let offset = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] < 128) continue;
      opaque.set(rgba.subarray(i, i + 4), offset);
      opaque[offset + 3] = 255;
      offset += 4;
    }
  }
  const opaquePalette = opaqueCount ? quantize(opaque, maxColors - 1, { format: "rgb565" }) : [[0, 0, 0]];
  const index = applyPalette(rgba, opaquePalette, "rgb565");
  // Keep the same transparent background slot on every frame, including fully
  // opaque frames. dispose:2 must clear to transparent before the next frame.
  const palette = [[0, 0, 0], ...opaquePalette];
  for (let i = 0; i < index.length; i++) index[i] = rgba[i * 4 + 3] < 128 ? 0 : index[i] + 1;
  return { palette, index, transparent: true, transparentIndex: 0 };
}

export type GifFrameSource = {
  width: number;
  height: number;
  delays: number[];
  repeat: number;
  // New decoder per attempt, retaining only the current composited frame.
  open(): {
    drawFrame(index: number): Promise<CanvasImageSource>;
    close(): void;
  };
};

export async function encodeGifSource(
  source: GifFrameSource,
  onProgress: (progress: { completed: number; total: number; attempt: number; stage: string }) => void,
  maxBytes = GIF_MAX_BYTES,
): Promise<Blob> {
  const size = gifDimensions(source.width, source.height);
  if (!source.delays.length || source.delays.length > MAX_INPUT_FRAMES || source.width * source.height * source.delays.length > 600_000_000) {
    throw new Error("表情动画过长，暂时无法在浏览器中处理");
  }
  const attempts = [
    { colors: 256, stride: 1 }, { colors: 128, stride: 1 }, { colors: 64, stride: 1 },
    { colors: 64, stride: 2 }, { colors: 64, stride: 4 }, { colors: 32, stride: 8 },
    { colors: 32, stride: 16 }, { colors: 16, stride: 32 },
  ];
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器无法生成 GIF 图片");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  try {
    for (let attempt = 0; attempt < attempts.length; attempt++) {
      const settings = attempts[attempt];
      const groups = gifFrameGroups(source.delays, settings.stride);
      const encoder = GIFEncoder();
      const decoder = source.open();
      let groupIndex = 0;
      let exceeded = false;
      const stage = attempt ? "正在压缩 GIF" : "正在生成 GIF";
      onProgress({ completed: 0, total: source.delays.length, attempt, stage });
      try {
        for (let index = 0; index < source.delays.length; index++) {
          const current = await decoder.drawFrame(index);
          if (groups[groupIndex]?.first === index) {
            context.clearRect(0, 0, size.width, size.height);
            context.drawImage(current, 0, 0, size.width, size.height);
            const pixels = context.getImageData(0, 0, size.width, size.height).data;
            const palette = gifFramePalette(pixels, settings.colors);
            encoder.writeFrame(palette.index, size.width, size.height, {
              ...palette,
              delay: groups[groupIndex].delay,
              dispose: 2,
              repeat: source.repeat,
            });
            groupIndex++;
            // bytesView does not copy the growing buffer; stop an oversized
            // attempt as soon as possible instead of encoding the whole clip.
            if (encoder.bytesView().byteLength + 1 >= maxBytes) {
              exceeded = true;
              break;
            }
          }
          onProgress({ completed: index + 1, total: source.delays.length, attempt, stage });
        }
        if (!exceeded) {
          encoder.finish();
          const bytes = encoder.bytes();
          if (bytes.byteLength < maxBytes) {
            return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/gif" });
          }
        }
      } finally {
        decoder.close();
      }
    }
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
  throw new Error("表情过于复杂，压缩后仍超过 10 MB，暂时无法复制");
}
