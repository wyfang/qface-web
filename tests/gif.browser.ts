// 在 Vite 本地页面执行：
// await (await import('/qface-web/tests/gif.browser.ts')).runGifBrowserChecks()
import { GifReader } from "omggif";
import { convertInWorker } from "../src/gifWorkerClient";
import { encodeGifSource, type GifFrameSource } from "../src/gifEncoding";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runGifBrowserChecks() {
  const fixtures = [
    { path: "gif/s14.gif", format: "gif", frames: 2, duration: 1240, height: 499 },
    { path: "assets/qq_emoji/14/apng/14.png", format: "apng", frames: 51, duration: 2125, height: 499 },
    { path: "assets/qq_emoji/383/apng/383.png", format: "apng", frames: 72, duration: 3000, height: 499 },
    { path: "assets/qq_emoji/420/png/420_0.png", format: "png", frames: 1, height: 239 },
  ] as const;
  const rows = [];
  for (const fixture of fixtures) {
    const response = await fetch(`/qface-web/${fixture.path}`);
    assert(response.ok, `${fixture.path}: 素材无法读取`);
    const input = await response.blob();
    let progressCount = 0;
    const started = performance.now();
    const output = await convertInWorker(input, fixture.format, {
      onConversionProgress: () => { progressCount += 1; },
    });
    const reader = new GifReader(new Uint8Array(await output.arrayBuffer()));
    const delays = Array.from({ length: reader.numFrames() }, (_, i) => reader.frameInfo(i).delay * 10);
    const duration = delays.reduce((sum, delay) => sum + delay, 0);
    assert(reader.width === 499 && reader.height === fixture.height, `${fixture.path}: 尺寸不符`);
    assert(reader.numFrames() === fixture.frames, `${fixture.path}: 动画帧丢失`);
    assert(output.size < 10_000_000, `${fixture.path}: 超过容量上限`);
    if ("duration" in fixture) {
      assert(Math.abs(duration - fixture.duration) <= 5, `${fixture.path}: 播放时长发生漂移`);
    }
    const pixels = new Uint8Array(reader.width * reader.height * 4);
    reader.decodeAndBlitFrameRGBA(0, pixels);
    let opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) opaque += 1;
    assert(opaque > 0 && opaque < reader.width * reader.height, `${fixture.path}: 透明度异常`);
    assert(progressCount > 0, `${fixture.path}: 缺少进度`);
    rows.push({ path: fixture.path, width: reader.width, height: reader.height, bytes: output.size,
      frames: reader.numFrames(), durationMs: duration, elapsedMs: Math.round(performance.now() - started) });
  }

  const source = await (await fetch('/qface-web/assets/qq_emoji/383/apng/383.png')).blob();
  const controller = new AbortController();
  const started = performance.now();
  const timer = setTimeout(() => controller.abort(), 50);
  let cancelled = false;
  try {
    await convertInWorker(source, "apng", { signal: controller.signal });
  } catch (error) {
    cancelled = error instanceof DOMException && error.name === "AbortError";
  } finally {
    clearTimeout(timer);
  }
  assert(cancelled, "取消后转换仍然返回了 GIF");
  assert(performance.now() - started < 1500, "取消没有及时停止 Worker");
  return { rows, cancelled: true };
}

// 验证真实 Canvas 编码在容量受限时重新压缩，而不是缩小画布。
export async function runGifBudgetBrowserChecks() {
  const source: GifFrameSource = {
    width: 24, height: 24, delays: Array(8).fill(100), repeat: 0,
    open() {
      const canvas = new OffscreenCanvas(24, 24);
      const context = canvas.getContext("2d")!;
      return {
        async drawFrame(frame) {
          const pixels = context.createImageData(24, 24);
          let seed = frame + 1;
          for (let i = 0; i < pixels.data.length; i += 4) {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            pixels.data.set([seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255], i);
          }
          context.putImageData(pixels, 0, 0);
          return canvas;
        },
        close() { canvas.width = 1; canvas.height = 1; },
      };
    },
  };
  const original = await encodeGifSource(source, () => {});
  const budget = Math.floor(original.size * 0.7);
  let attempts = 0;
  const compressed = await encodeGifSource(source, (p) => { attempts = p.attempt + 1; }, budget);
  const reader = new GifReader(new Uint8Array(await compressed.arrayBuffer()));
  assert(compressed.size < budget && attempts > 1, "未进行真实压缩重试");
  assert(reader.width === 499 && reader.height === 499, "压缩不应缩小尺寸");
  const duration = Array.from({ length: reader.numFrames() }, (_, i) => reader.frameInfo(i).delay * 10)
    .reduce((a, b) => a + b, 0);
  assert(duration === 800, "压缩不应改变播放时长");
  return { originalBytes: original.size, budget, bytes: compressed.size, attempts, duration };
}
