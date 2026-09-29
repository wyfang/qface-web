import parseAPNGModule from "apng-js";
import { GifReader, type GifFrameInfo } from "omggif";
import { encodeGifSource, gifDimensions, MAX_INPUT_FRAMES, type GifFrameSource } from "./gifEncoding";
import type { GifConversionProgress, GifInputKind } from "./gifWorkerClient";

const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const parseAPNG = typeof parseAPNGModule === "function"
  ? parseAPNGModule
  : (parseAPNGModule as unknown as { default: typeof parseAPNGModule }).default;

function canvasContext(canvas: OffscreenCanvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器无法处理表情图片");
  return context;
}

function checkRect(width: number, height: number, x: number, y: number, w: number, h: number) {
  if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > width || y + h > height) {
    throw new Error("表情的动画帧数据不完整，请重试");
  }
}

function pngMetadata(bytes: Uint8Array) {
  if (bytes.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) {
    throw new Error("表情图片格式不正确，请重试");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  gifDimensions(width, height);
  const delays: number[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (offset + 12 + length > bytes.length) throw new Error("表情图片数据不完整，请重试");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "fcTL" && length === 26) {
      const numerator = view.getUint16(offset + 28);
      const denominator = view.getUint16(offset + 30) || 100;
      delays.push(numerator ? numerator / denominator * 1000 : 100);
      if (delays.length > MAX_INPUT_FRAMES) throw new Error("表情动画过长，暂时无法在浏览器中处理");
    }
    offset += length + 12;
    if (type === "IEND") break;
  }
  return { width, height, delays };
}

// Bound frame metadata before constructing the decoder, not just before RGBA
// allocation. A tiny compressed input can otherwise declare millions of frames.
function checkGifInput(bytes: Uint8Array) {
  if (bytes.length < 13 || !/^GIF8[79]a$/.test(String.fromCharCode(...bytes.subarray(0, 6)))) {
    throw new Error("表情 GIF 格式不正确，请重试");
  }
  gifDimensions(bytes[6] | bytes[7] << 8, bytes[8] | bytes[9] << 8);
  let offset = 13 + ((bytes[10] & 0x80) ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
  let frames = 0;
  const skipBlocks = () => {
    while (offset < bytes.length) {
      const length = bytes[offset++];
      if (!length) return;
      offset += length;
      if (offset > bytes.length) break;
    }
    throw new Error("表情 GIF 数据不完整，请重试");
  };
  while (offset < bytes.length) {
    const block = bytes[offset++];
    if (block === 0x3b) return;
    if (block === 0x21) {
      offset++; // extension label, followed by length-prefixed subblocks
      skipBlocks();
    } else if (block === 0x2c) {
      if (offset + 9 > bytes.length) break;
      const flags = bytes[offset + 8];
      offset += 9 + ((flags & 0x80) ? 3 * (1 << ((flags & 7) + 1)) : 0);
      offset++; // LZW minimum code size
      skipBlocks();
      if (++frames > MAX_INPUT_FRAMES) throw new Error("表情动画过长，暂时无法在浏览器中处理");
    } else break;
  }
  throw new Error("表情 GIF 数据不完整，请重试");
}

function pngSource(blob: Blob, width: number, height: number): GifFrameSource {
  return {
    width, height, delays: [100], repeat: -1,
    open() {
      let bitmap: ImageBitmap | null = null;
      return {
        async drawFrame() {
          bitmap = await createImageBitmap(blob);
          return bitmap;
        },
        close() { bitmap?.close(); },
      };
    },
  };
}

function apngSource(bytes: Uint8Array): GifFrameSource {
  const metadata = pngMetadata(bytes);
  const parsed = parseAPNG(bytes.buffer as ArrayBuffer);
  if (parsed instanceof Error || !parsed.frames.length) {
    // A PNG stored under an APNG path is still a valid single-frame source.
    if (!metadata.delays.length) return pngSource(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }), metadata.width, metadata.height);
    throw new Error("表情动画无法读取，请重试");
  }
  for (const frame of parsed.frames) checkRect(parsed.width, parsed.height, frame.left, frame.top, frame.width, frame.height);
  if (metadata.delays.length !== parsed.frames.length) throw new Error("表情动画数据不完整，请重试");
  return {
    width: parsed.width,
    height: parsed.height,
    // apng-js replaces delays <= 10ms with 100ms; use the original fcTL values.
    delays: metadata.delays,
    repeat: parsed.numPlays === 0 ? 0 : parsed.numPlays === 1 ? -1 : parsed.numPlays - 1,
    open() {
      const canvas = new OffscreenCanvas(parsed.width, parsed.height);
      const context = canvasContext(canvas);
      let previousIndex = -1;
      let restore: ImageData | null = null;
      return {
        async drawFrame(index) {
          const previous = parsed.frames[previousIndex];
          if (previous?.disposeOp === 1) context.clearRect(previous.left, previous.top, previous.width, previous.height);
          else if (previous?.disposeOp === 2 && restore) context.putImageData(restore, previous.left, previous.top);
          restore = null;
          const frame = parsed.frames[index];
          if (!frame.imageData) throw new Error("表情动画帧缺失，请重试");
          if (frame.disposeOp === 2) restore = context.getImageData(frame.left, frame.top, frame.width, frame.height);
          if (frame.blendOp === 0) context.clearRect(frame.left, frame.top, frame.width, frame.height);
          const bitmap = await createImageBitmap(frame.imageData);
          try { context.drawImage(bitmap, frame.left, frame.top); }
          finally { bitmap.close(); }
          previousIndex = index;
          return canvas;
        },
        close() { restore = null; canvas.width = 1; canvas.height = 1; },
      };
    },
  };
}

function gifSource(bytes: Uint8Array): GifFrameSource {
  checkGifInput(bytes);
  const reader = new GifReader(bytes);
  gifDimensions(reader.width, reader.height);
  const frames = Array.from({ length: reader.numFrames() }, (_, index) => reader.frameInfo(index));
  for (const frame of frames) checkRect(reader.width, reader.height, frame.x, frame.y, frame.width, frame.height);
  const backgroundIndex = bytes[11];
  const hasGlobalPalette = (bytes[10] & 0x80) !== 0;
  const background = hasGlobalPalette ? Array.from(bytes.subarray(13 + backgroundIndex * 3, 16 + backgroundIndex * 3)) : [0, 0, 0];
  return {
    width: reader.width,
    height: reader.height,
    delays: frames.map((frame) => frame.delay ? frame.delay * 10 : 100),
    repeat: reader.loopCount() ?? -1,
    open() {
      const canvas = new OffscreenCanvas(reader.width, reader.height);
      const context = canvasContext(canvas);
      const pixels = new Uint8ClampedArray(reader.width * reader.height * 4);
      const image = new ImageData(pixels, reader.width, reader.height);
      let previous: GifFrameInfo | undefined;
      let restore: Uint8ClampedArray | null = null;
      const clear = (frame: Pick<GifFrameInfo, "x" | "y" | "width" | "height" | "transparent_index">) => {
        const alpha = frame.transparent_index === null && hasGlobalPalette ? 255 : 0;
        for (let y = frame.y; y < frame.y + frame.height; y++) {
          for (let x = frame.x; x < frame.x + frame.width; x++) {
            const offset = (y * reader.width + x) * 4;
            pixels[offset] = alpha ? background[0] : 0;
            pixels[offset + 1] = alpha ? background[1] : 0;
            pixels[offset + 2] = alpha ? background[2] : 0;
            pixels[offset + 3] = alpha;
          }
        }
      };
      if (frames[0]) clear({ x: 0, y: 0, width: reader.width, height: reader.height, transparent_index: frames[0].transparent_index });
      return {
        async drawFrame(index) {
          if (previous?.disposal === 2) clear(previous);
          else if (previous?.disposal === 3 && restore) pixels.set(restore);
          const frame = frames[index];
          restore = frame.disposal === 3 ? pixels.slice() : null;
          reader.decodeAndBlitFrameRGBA(index, pixels);
          context.putImageData(image, 0, 0);
          previous = frame;
          return canvas;
        },
        close() { restore = null; canvas.width = 1; canvas.height = 1; },
      };
    },
  };
}

self.onmessage = async ({ data }: MessageEvent<{ blob: Blob; kind: GifInputKind }>) => {
  let lastProgressAt = -Infinity;
  let lastAttempt = -1;
  const progress = (value: GifConversionProgress) => {
    const now = performance.now();
    if (value.completed === value.total || value.attempt !== lastAttempt || now - lastProgressAt >= 100) {
      self.postMessage({ type: "progress", progress: value });
      lastProgressAt = now;
      lastAttempt = value.attempt ?? -1;
    }
  };
  try {
    if (data.blob.size > MAX_INPUT_BYTES) throw new Error("表情原文件过大，暂时无法在浏览器中处理");
    const bytes = new Uint8Array(await data.blob.arrayBuffer());
    let source: GifFrameSource;
    if (data.kind === "gif") source = gifSource(bytes);
    else if (data.kind === "apng") source = apngSource(bytes);
    else {
      const metadata = pngMetadata(bytes);
      source = pngSource(data.blob, metadata.width, metadata.height);
    }
    const blob = await encodeGifSource(source, progress);
    self.postMessage({ type: "done", blob });
  } catch (reason) {
    const message = reason instanceof Error && /[\u4e00-\u9fff]/.test(reason.message)
      ? reason.message : "表情文件无法处理，请重新选择或刷新页面后重试";
    self.postMessage({ type: "error", message });
  }
};
