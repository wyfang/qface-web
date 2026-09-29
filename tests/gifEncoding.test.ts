import assert from "node:assert/strict";
import { test } from "node:test";
import { GifReader } from "omggif";
import gifenc from "gifenc";
import { encodeGifSource, gifDimensions, gifFrameGroups, gifFramePalette } from "../src/gifEncoding";

test("长边统一 499 px，矩形保持比例，小图允许放大", () => {
  assert.deepEqual(gifDimensions(56, 56), { width: 499, height: 499 });
  assert.deepEqual(gifDimensions(512, 245), { width: 499, height: 239 });
  assert.deepEqual(gifDimensions(100, 500), { width: 100, height: 499 });
  assert.throws(() => gifDimensions(10_000, 10_000));
});

test("24 fps 使用累积取整，避免总时长变为 960ms", () => {
  const groups = gifFrameGroups(Array(24).fill(1000 / 24));
  assert.equal(groups.length, 24);
  assert.equal(groups.reduce((total, frame) => total + frame.delay, 0), 1000);
  assert.deepEqual([...new Set(groups.map((frame) => frame.delay))].sort(), [40, 50]);
});

test("压缩合帧和小于 20ms 的帧合并后，保持原始总时长", () => {
  for (const stride of [1, 2, 4, 8, 16, 32]) {
    const groups = gifFrameGroups(Array(61).fill(1000 / 60), stride);
    assert.equal(groups.reduce((total, frame) => total + frame.delay, 0), 1020);
    assert.ok(groups.every((group) => group.delay >= 20));
    assert.equal(groups[groups.length - 1].last, 60);
  }
});

test("独立透明槽，不把可见的 index 0 误认为透明", () => {
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 255]);
  const frame = gifFramePalette(rgba, 256);
  assert.equal(frame.transparent, true);
  assert.notEqual(frame.index[0], frame.transparentIndex);
  assert.equal(frame.index[1], frame.transparentIndex);
  assert.notEqual(frame.index[2], frame.transparentIndex);
  const encoder = (gifenc as unknown as { GIFEncoder: () => import("gifenc").GifEncoder }).GIFEncoder();
  encoder.writeFrame(frame.index, 3, 1, { ...frame, delay: 40, dispose: 2 });
  encoder.finish();
  const reader = new GifReader(encoder.bytes());
  const decoded = new Uint8ClampedArray(12);
  reader.decodeAndBlitFrameRGBA(0, decoded);
  assert.deepEqual([decoded[3], decoded[7], decoded[11]], [255, 0, 255]);
});

test("完全不透明与完全透明的单色帧均可编码", () => {
  const opaque = gifFramePalette(new Uint8ClampedArray([0, 0, 0, 255]), 256);
  assert.equal(opaque.transparent, true);
  assert.notEqual(opaque.index[0], opaque.transparentIndex);
  const transparent = gifFramePalette(new Uint8ClampedArray([0, 0, 0, 0]), 256);
  assert.equal(transparent.transparent, true);
  assert.equal(transparent.index[0], transparent.transparentIndex);
});

test("容量检查严格小于上限；有限重试超限时拒绝返回文件", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "OffscreenCanvas");
  class TestCanvas {
    constructor(public width: number, public height: number) {}
    getContext() {
      return {
        imageSmoothingEnabled: false, imageSmoothingQuality: "high",
        clearRect() {}, drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }),
      };
    }
  }
  Object.defineProperty(globalThis, "OffscreenCanvas", { configurable: true, value: TestCanvas });
  let closes = 0;
  const source = {
    width: 56, height: 56, delays: [40, 50], repeat: 0,
    open: () => ({ drawFrame: async () => ({} as CanvasImageSource), close: () => { closes++; } }),
  };
  try {
    const success = await encodeGifSource(source, () => {}, 10_000);
    assert.ok(success.size < 10_000);
    const reader = new GifReader(new Uint8Array(await success.arrayBuffer()));
    assert.equal(reader.width, 499);
    assert.equal(reader.height, 499);
    assert.equal(reader.frameInfo(0).delay + reader.frameInfo(1).delay, 9);
    assert.equal(closes, 1);
    closes = 0;
    await assert.rejects(encodeGifSource(source, () => {}, 100), /仍超过/);
    assert.equal(closes, 8);
  } finally {
    if (previous) Object.defineProperty(globalThis, "OffscreenCanvas", previous);
    else delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
  }
});
