export const GIF_MAX_EDGE = 499;
export const GIF_MAX_BYTES = 10_000_000;

export class GifConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GifConversionError";
  }
}

export type GifInputKind = "gif" | "apng" | "png";
export type GifConversionProgress = {
  completed: number;
  total: number;
  attempt?: number;
  stage?: string;
};

export function convertInWorker(
  blob: Blob,
  kind: GifInputKind,
  options: {
    signal?: AbortSignal;
    onConversionProgress?: (progress: GifConversionProgress) => void;
  } = {},
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const abortError = () => new DOMException("操作已取消", "AbortError");
    if (options.signal?.aborted) return reject(abortError());
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
      return reject(new GifConversionError("当前浏览器暂不支持生成 GIF，请更新浏览器后重试"));
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./gifConversion.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return reject(new GifConversionError("无法启动 GIF 处理，请刷新页面后重试"));
    }
    let settled = false;
    const cleanup = () => {
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      if (settled) return;
      cleanup();
      reject(abortError());
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (settled) return;
      if (data.type === "progress") {
        options.onConversionProgress?.(data.progress);
      } else if (data.type === "done") {
        cleanup();
        if (!(data.blob instanceof Blob) || data.blob.size >= GIF_MAX_BYTES) {
          reject(new GifConversionError("GIF 超过 10 MB，无法复制"));
        } else resolve(data.blob);
      } else if (data.type === "error") {
        cleanup();
        reject(new GifConversionError(data.message));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (settled) return;
      cleanup();
      reject(new GifConversionError("GIF 处理失败，请重新选择表情后重试"));
    };
    worker.onmessageerror = () => {
      if (settled) return;
      cleanup();
      reject(new GifConversionError("GIF 数据读取失败，请重试"));
    };
    try {
      worker.postMessage({ blob, kind });
    } catch {
      cleanup();
      reject(new GifConversionError("GIF 数据读取失败，请重试"));
    }
  });
}
