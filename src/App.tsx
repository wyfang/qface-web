import {
  Button,
  Disclosure,
  Popover,
  ProgressBar,
  SearchField,
  Spinner,
  Toast,
  ToastQueue,
} from "@heroui/react";
import {
  Clipboard,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  Monitor,
  Moon,
  Play,
  RotateCcw,
  Smile,
  Sun,
} from "lucide-react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { LottiePreview } from "./LottiePreview";
import {
  assetUrl,
  convertApngToGifBlob,
  convertPngToGifBlob,
  convertTextToGifBlob,
  copyAssetLink,
  copyGifBlob,
  copyPngBlob,
  downloadAsset,
  downloadBlob,
  fetchApngBlob,
  fetchGifBlob,
  fetchPngBlob,
  normalizeGifBlob,
  openAsset,
} from "./media";
import type { ConversionProgress, DownloadProgress } from "./media";
import {
  QQ_ASSET_TYPE,
  type CollectionName,
  type DisplayEmoji,
  type QqAsset,
  type QqEmoji,
  type WechatEmoji,
} from "./types";

type PreviewMode = "animated" | "static";
type ThemeMode = "auto" | "light" | "dark";
type EmojiGridItemEntry = {
  item: DisplayEmoji;
  isRecent: boolean;
  renderKey: string;
};
type EmojiGridEntry =
  | EmojiGridItemEntry
  | "recent-label"
  | "recent-divider"
  | "lottie-label"
  | "lottie-divider";
type PreparedGif = {
  blob: Blob;
  generated: boolean;
};
type MediaLoadState = "loading" | "loaded" | "error";
type PrepareProgress =
  | {
      phase: "preparing" | "clipboard";
      label: string;
    }
  | {
      phase: "download";
      label: string;
      progress: DownloadProgress;
    }
  | {
      phase: "convert";
      label: string;
      progress: ConversionProgress;
    };
type CopyTaskState = {
  entryKey: string;
  title: string;
  detail: string;
  progress?: number;
  status: "active" | "success" | "danger" | "cancelled";
  showCancel: boolean;
  exiting: boolean;
};

const SKIP_UNDERSCORE_PNG_IDS = new Set(["342", "466", "468", "469"]);
const STATIC_PREVIEW_OVERRIDE_IDS = new Set(["466", "468", "469"]);
const LOTTIE_ANIMATION_ONLY_IDS = new Set([
  "74",
  "75",
  "137",
  "333",
  "358",
  "359",
  "392",
  "393",
  "394",
  "415",
  "416",
  "417",
  "419",
  "420",
  "421",
  "422",
  "423",
  "429",
  "430",
  "431",
  "432",
]);
const RECENT_STORAGE_KEY = "qface-recent-emojis";
const MAX_STORED_RECENT = 40;
const MOBILE_LONG_PRESS_DELAY = 520;
const MOBILE_LONG_PRESS_MOVE_TOLERANCE = 10;
const MOBILE_LONG_PRESS_RELEASE_GUARD = 600;
const HOVER_PREVIEW_DELAY = 180;
const MENU_CLOSE_DELAY = 1000;
const TOAST_EXIT_DURATION = 200;
const COPY_CANCEL_DELAY = 3000;
const loadedThumbnailUrls = new Set<string>();
const appToastQueue = new ToastQueue({
  maxVisibleToasts: 1,
  wrapUpdate: (update) => update(),
});
let activeToastKey = "";
let toastExitTimer: number | null = null;
let toastRemoveTimer: number | null = null;

function clearToastTimers() {
  if (toastExitTimer !== null) window.clearTimeout(toastExitTimer);
  if (toastRemoveTimer !== null) window.clearTimeout(toastRemoveTimer);
  toastExitTimer = null;
  toastRemoveTimer = null;
}

function removeAppToast(key: string) {
  appToastQueue.close(key);
  if (activeToastKey === key) activeToastKey = "";
  toastRemoveTimer = null;
}

function dismissAppToast(key = activeToastKey) {
  if (!key || key !== activeToastKey) return;
  if (toastExitTimer !== null) window.clearTimeout(toastExitTimer);
  toastExitTimer = null;

  const element = document.querySelector<HTMLElement>(
    '.app-toast-region .toast[data-frontmost="true"]',
  );
  if (!element) {
    removeAppToast(key);
    return;
  }

  element.dataset.exiting = "true";
  toastRemoveTimer = window.setTimeout(
    () => removeAppToast(key),
    TOAST_EXIT_DURATION,
  );
}

function showAppToast(
  message: string,
  variant: "success" | "danger",
  timeout: number,
) {
  clearToastTimers();
  if (activeToastKey) appToastQueue.close(activeToastKey);

  const key = appToastQueue.add(
    { title: message, variant },
    { timeout: 0 },
  );
  activeToastKey = key;
  toastExitTimer = window.setTimeout(() => dismissAppToast(key), timeout);
}

function readRecentKeys(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(RECENT_STORAGE_KEY) || "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((key): key is string => typeof key === "string")
      .slice(0, MAX_STORED_RECENT);
  } catch {
    return [];
  }
}

function cleanName(value: string | undefined, fallback: string): string {
  return value?.replace(/^\//, "").trim() || fallback;
}

function assetOf(emoji: QqEmoji, type: number): QqAsset | undefined {
  return emoji.assets.find((asset) => asset.type === type);
}

function preferredPngAsset(
  assets: QqAsset[],
  skipUnderscoreVariant = false,
): QqAsset | undefined {
  const pngAssets = assets.filter((asset) => asset.type === QQ_ASSET_TYPE.PNG);
  return (
    (skipUnderscoreVariant
      ? pngAssets.find((asset) => !/_0\.png$/i.test(asset.name))
      : undefined) || pngAssets[0]
  );
}

function normalizeQq(items: QqEmoji[]): DisplayEmoji[] {
  return [...items]
    .sort((a, b) => Number(a.emojiId) - Number(b.emojiId))
    .map((item) => {
      const hasStaticPreviewOverride = STATIC_PREVIEW_OVERRIDE_IDS.has(
        item.emojiId,
      );
      const png = preferredPngAsset(
        item.assets,
        SKIP_UNDERSCORE_PNG_IDS.has(item.emojiId),
      );
      const gif = assetOf(item, QQ_ASSET_TYPE.GIF);
      const apng = assetOf(item, QQ_ASSET_TYPE.APNG);
      const name = cleanName(item.describe, `表情 ${item.emojiId}`);
      const legacyStaticPath =
        item.assets.length === 0 && /^\d+$/.test(item.emojiId)
          ? `static/s${item.emojiId}.png`
          : undefined;
      const staticPreviewOverridePath = hasStaticPreviewOverride
        ? `static/s${item.emojiId}.png`
        : undefined;
      const staticPath = staticPreviewOverridePath || png?.path || legacyStaticPath;

      return {
        key: `qq-${item.emojiId}`,
        id: item.emojiId,
        name,
        collection: "qq",
        staticPath,
        fallbackText: staticPath ? undefined : item.emojiId,
        animatedPath: apng?.path || gif?.path,
        associateWords: item.associateWords || [],
        assets: item.assets,
        width: item.animationWidth || undefined,
        height: item.animationHeigh || undefined,
        searchText: [name, item.emojiId, ...(item.associateWords || [])]
          .join(" ")
          .toLowerCase(),
      };
    });
}

function normalizeWechat(items: WechatEmoji[]): DisplayEmoji[] {
  return [...items]
    .sort((a, b) => a.eggIndex - b.eggIndex)
    .map((item) => {
      const path = item.path || undefined;
      const name = cleanName(
        item.cnValue || item.twValue || item.enValue,
        `微信表情 ${item.eggIndex}`,
      );
      const assets: QqAsset[] = path
        ? [
            {
              type: QQ_ASSET_TYPE.PNG,
              name: item.fileName,
              path,
            },
          ]
        : [];

      return {
        key: `wechat-${item.key}`,
        id: String(item.eggIndex),
        name,
        collection: "wechat",
        staticPath: path,
        fallbackText: path ? undefined : item.key,
        associateWords: [],
        assets,
        searchText: [
          name,
          item.key,
          item.qqValue,
          item.enValue,
          item.twValue,
          item.thValue,
          item.fileName,
          item.eggIndex,
        ]
          .join(" ")
          .toLowerCase(),
      };
    });
}

function assetLabel(asset: QqAsset): string {
  if (asset.type === QQ_ASSET_TYPE.APNG) return "APNG";
  if (asset.type === QQ_ASSET_TYPE.GIF) return "GIF";
  if (asset.type === QQ_ASSET_TYPE.LOTTIE) return "JSON";
  return "PNG";
}

function hasAnimatedPreview(item: DisplayEmoji): boolean {
  return Boolean(
    item.animatedPath ||
      item.assets.some((asset) => asset.type === QQ_ASSET_TYPE.LOTTIE),
  );
}

function pngPathsFor(item: DisplayEmoji): string[] {
  return [
    ...(item.staticPath ? [item.staticPath] : []),
    ...item.assets
      .filter((asset) => asset.type === QQ_ASSET_TYPE.PNG)
      .map((asset) => asset.path),
  ];
}

async function prepareGif(
  item: DisplayEmoji,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: PrepareProgress) => void;
  } = {},
): Promise<PreparedGif> {
  const { onProgress, signal } = options;
  let lastConversionError: unknown;
  const gifPaths = [
    ...item.assets
      .filter((asset) => asset.type === QQ_ASSET_TYPE.GIF)
      .map((asset) => asset.path),
    ...(item.collection === "qq" && /^\d+$/.test(item.id)
      ? [`gif/s${item.id}.gif`]
      : []),
  ];

  // The APNG collection contains higher-resolution, fuller animations than
  // the legacy 56px GIFs. Prefer it before normalizing a legacy GIF.
  const apngAssets = item.assets.filter(
    (asset) => asset.type === QQ_ASSET_TYPE.APNG,
  );
  for (const asset of new Map(
    apngAssets.map((candidate) => [candidate.path, candidate]),
  ).values()) {
    onProgress?.({ phase: "preparing", label: "正在查找 APNG" });
    const apngBlob = await fetchApngBlob(asset.path, {
      signal,
      onDownloadProgress: (progress) =>
        onProgress?.({ phase: "download", label: "下载 APNG", progress }),
    });
    if (!apngBlob) continue;
    // A valid animation must not silently become static after an encoding error.
    onProgress?.({ phase: "preparing", label: "正在解析动画" });
    return {
      blob: await convertApngToGifBlob(asset, apngBlob, {
        signal,
        onConversionProgress: (progress) =>
          onProgress?.({ phase: "convert", label: "生成 GIF", progress }),
      }),
      generated: true,
    };
  }

  for (const path of new Set(gifPaths)) {
    onProgress?.({ phase: "preparing", label: "正在查找 GIF" });
    const blob = await fetchGifBlob(path, {
      signal,
      onDownloadProgress: (progress) =>
        onProgress?.({ phase: "download", label: "下载 GIF", progress }),
    });
    if (!blob) continue;
    return {
      blob: await normalizeGifBlob(path, blob, {
        signal,
        onConversionProgress: (progress) =>
          onProgress?.({ phase: "convert", label: "调整 GIF 规格", progress }),
      }),
      generated: false,
    };
  }

  for (const path of new Set(pngPathsFor(item))) {
    onProgress?.({ phase: "preparing", label: "正在查找 PNG" });
    const blob = await fetchPngBlob(path, {
      signal,
      onDownloadProgress: (progress) =>
        onProgress?.({ phase: "download", label: "下载 PNG", progress }),
    });
    if (!blob) continue;
    try {
      return {
        blob: await convertPngToGifBlob(path, blob, {
          signal,
          onConversionProgress: (progress) =>
            onProgress?.({ phase: "convert", label: "生成 GIF", progress }),
        }),
        generated: true,
      };
    } catch (reason) {
      if (isAbortError(reason)) throw reason;
      lastConversionError = reason;
    }
  }

  if (item.fallbackText) {
    try {
      return {
        blob: await convertTextToGifBlob(item.key, item.fallbackText, {
          signal,
          onConversionProgress: (progress) =>
            onProgress?.({ phase: "convert", label: "生成 GIF", progress }),
        }),
        generated: true,
      };
    } catch (reason) {
      if (isAbortError(reason)) throw reason;
      lastConversionError = reason;
    }
  }

  if (lastConversionError) throw lastConversionError;
  throw new Error("当前表情没有可生成 GIF 的内容");
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function throwIfCopyAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("操作已取消", "AbortError");
  }
}

function EmojiThumbnail({ item }: { item: DisplayEmoji }) {
  const src = item.staticPath ? assetUrl(item.staticPath) : "";
  const [loadRecord, setLoadRecord] = useState<{
    src: string;
    state: MediaLoadState;
  }>(() => ({
    src,
    state: src && !loadedThumbnailUrls.has(src) ? "loading" : "loaded",
  }));
  const loadState =
    loadRecord.src === src
      ? loadRecord.state
      : src
        ? loadedThumbnailUrls.has(src)
          ? "loaded"
          : "loading"
        : "loaded";

  if (!src) {
    return (
      <span className="emoji-glyph" aria-hidden="true">
        {item.fallbackText}
      </span>
    );
  }

  return (
    <span className="emoji-thumbnail" data-load-state={loadState}>
      <span className="emoji-image-placeholder" aria-hidden="true">
        <Smile size={32} strokeWidth={1.7} />
      </span>
      <img
        alt=""
        decoding="async"
        draggable={false}
        loading="lazy"
        src={src}
        onError={() => setLoadRecord({ src, state: "error" })}
        onLoad={() => {
          loadedThumbnailUrls.add(src);
          setLoadRecord({ src, state: "loaded" });
        }}
      />
    </span>
  );
}

function isTouchFirstDevice(): boolean {
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

function copyFailureMessage(reason: unknown): string {
  const errorName = reason instanceof Error ? reason.name : "";
  const errorMessage = reason instanceof Error ? reason.message : "";
  const isClipboardLimitation =
    errorName === "NotAllowedError" ||
    /clipboard|not allowed|permission|剪贴板|不支持复制|不能复制/i.test(
      errorMessage,
    );

  if (isClipboardLimitation) {
    return isTouchFirstDevice()
      ? "当前浏览器无法直接复制，请长按表情后下载"
      : "浏览器未允许复制，请开启剪贴板权限后重试";
  }

  if (errorMessage === "当前表情没有可复制的内容") return errorMessage;
  if (errorName === "GifConversionError") return errorMessage;
  return "复制失败，请稍后重试";
}

function PreviewMedia({
  item,
  lottieSrc,
  previewPath,
  previewMode,
}: {
  item: DisplayEmoji;
  lottieSrc?: string;
  previewPath?: string;
  previewMode: PreviewMode;
}) {
  const imageSrc = previewPath ? assetUrl(previewPath) : "";
  const hasRemoteMedia = Boolean(lottieSrc || imageSrc);
  const mediaKey = lottieSrc || imageSrc || item.fallbackText || item.key;
  const [loadRecord, setLoadRecord] = useState<{
    key: string;
    state: MediaLoadState;
  }>(() => ({
    key: mediaKey,
    state: hasRemoteMedia ? "loading" : "loaded",
  }));
  const loadState =
    loadRecord.key === mediaKey
      ? loadRecord.state
      : hasRemoteMedia
        ? "loading"
        : "loaded";

  return (
    <div
      className="preview-media"
      data-load-state={loadState}
      aria-busy={loadState === "loading"}
    >
      {hasRemoteMedia ? (
        <span className="preview-image-placeholder" aria-hidden="true">
          <Smile size={38} strokeWidth={1.35} />
        </span>
      ) : null}

      {lottieSrc ? (
        <LottiePreview
          key={mediaKey}
          label={`${item.name} Lottie 动画`}
          src={lottieSrc}
          onError={() => setLoadRecord({ key: mediaKey, state: "error" })}
          onLoad={() => setLoadRecord({ key: mediaKey, state: "loaded" })}
        />
      ) : imageSrc ? (
        <img
          key={`${item.key}-${previewMode}`}
          alt={item.name}
          decoding="async"
          draggable={false}
          src={imageSrc}
          onError={() => setLoadRecord({ key: mediaKey, state: "error" })}
          onLoad={() => setLoadRecord({ key: mediaKey, state: "loaded" })}
        />
      ) : (
        <span
          className="emoji-glyph emoji-glyph--preview"
          aria-label={item.name}
        >
          {item.fallbackText}
        </span>
      )}

      {hasRemoteMedia ? (
        <span className="preview-loading-spinner" aria-label="正在加载表情预览">
          <Spinner size="md" />
        </span>
      ) : null}
    </div>
  );
}

const EmojiButton = memo(function EmojiButton({
  item,
  entryKey,
  isRecent,
  isActive,
  isMenuOpen,
  isCopySelected,
  onOpen,
  onMove,
  onClose,
  onCopy,
  onOpenMenu,
  onMenuEnter,
  onMenuLeave,
  onLongPressRelease,
  triggerRef,
}: {
  item: DisplayEmoji;
  entryKey: string;
  isRecent: boolean;
  isActive: boolean;
  isMenuOpen: boolean;
  isCopySelected: boolean;
  onOpen: (item: DisplayEmoji, entryKey: string) => void;
  onMove: (item: DisplayEmoji, entryKey: string) => void;
  onClose: (key: string) => void;
  onCopy: (item: DisplayEmoji, entryKey: string) => void;
  onOpenMenu: (
    item: DisplayEmoji,
    entryKey: string,
    guardRelease?: boolean,
  ) => void;
  onMenuEnter: () => void;
  onMenuLeave: () => void;
  onLongPressRelease: (entryKey: string) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerStartRef.current = null;
  }, []);

  useEffect(() => cancelLongPressTimer, [cancelLongPressTimer]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      longPressTriggeredRef.current = false;
      return;
    }
    if (event.button !== 0) return;
    cancelLongPressTimer();
    longPressTriggeredRef.current = false;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      pointerStartRef.current = null;
      longPressTriggeredRef.current = true;
      navigator.vibrate?.(10);
      onOpenMenu(item, entryKey, true);
    }, MOBILE_LONG_PRESS_DELAY);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      onMove(item, entryKey);
      return;
    }

    const start = pointerStartRef.current;
    if (
      start &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) >
        MOBILE_LONG_PRESS_MOVE_TOLERANCE
    ) {
      cancelLongPressTimer();
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
      return;
    }
    event.preventDefault();
    onOpenMenu(item, entryKey);
  };

  return (
    <div
      className="emoji-cell"
      data-emoji-key={item.key}
      data-entry-key={entryKey}
      data-recent={isRecent ? "true" : undefined}
      onContextMenu={(event) => {
        event.preventDefault();
        cancelLongPressTimer();
        onOpenMenu(item, entryKey, true);
        onLongPressRelease(entryKey);
      }}
      onKeyDown={handleKeyDown}
      onPointerCancelCapture={() => {
        cancelLongPressTimer();
        if (longPressTriggeredRef.current) onLongPressRelease(entryKey);
      }}
      onPointerDownCapture={handlePointerDown}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        if (isMenuOpen) onMenuEnter();
        else onOpen(item, entryKey);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") {
          if (isMenuOpen) onMenuLeave();
          else onClose(entryKey);
        } else cancelLongPressTimer();
      }}
      onPointerMoveCapture={handlePointerMove}
      onPointerUpCapture={() => {
        cancelLongPressTimer();
        if (longPressTriggeredRef.current) onLongPressRelease(entryKey);
      }}
    >
      <Button
        ref={isActive ? triggerRef : undefined}
        className="emoji-button"
        data-copy-selected={isCopySelected ? "true" : undefined}
        isIconOnly
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        aria-label={`复制 ${item.name}，编号 ${item.id}；长按打开更多操作`}
        variant="ghost"
        onPress={() => {
          if (longPressTriggeredRef.current) {
            longPressTriggeredRef.current = false;
            return;
          }
          onCopy(item, entryKey);
        }}
      >
        <EmojiThumbnail item={item} />
      </Button>
    </div>
  );
});

export default function App() {
  const [qqItems, setQqItems] = useState<QqEmoji[]>([]);
  const [wechatItems, setWechatItems] = useState<WechatEmoji[]>([]);
  const [collection, setCollection] = useState<CollectionName>("qq");
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState("");
  const [menuKey, setMenuKey] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("animated");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const savedMode = window.localStorage.getItem("qface-theme");
    return savedMode === "light" || savedMode === "dark" ? savedMode : "auto";
  });
  const [recentKeys, setRecentKeys] = useState<string[]>(readRecentKeys);
  const [recentLimit, setRecentLimit] = useState(16);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [gifDownloadKey, setGifDownloadKey] = useState("");
  const [copyingKey, setCopyingKey] = useState("");
  const [lastCopiedKey, setLastCopiedKey] = useState("");
  const [copyTask, setCopyTask] = useState<CopyTaskState | null>(null);
  const previewOpenTimerRef = useRef<number | null>(null);
  const pendingPreviewKeyRef = useRef("");
  const closeTimer = useRef<number | null>(null);
  const copyingKeyRef = useRef("");
  const copyControllerRef = useRef<AbortController | null>(null);
  const copyCancelTimerRef = useRef<number | null>(null);
  const copyDismissTimerRef = useRef<number | null>(null);
  const copyExitTimerRef = useRef<number | null>(null);
  const menuPressGuardRef = useRef("");
  const menuPressGuardTimerRef = useRef<number | null>(null);
  const menuCloseTimerRef = useRef<number | null>(null);
  const suppressHoverRef = useRef(false);
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const emojiScrollRef = useRef<HTMLDivElement | null>(null);
  const emojiGridRef = useRef<HTMLDivElement | null>(null);
  const recentScrollAnchorRef = useRef<{
    entryKey: string;
    contentTop: number;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      fetch(assetUrl("assets/qq_emoji/_index.json"), {
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) throw new Error(`QQ 表情数据读取失败：${response.status}`);
        return response.json() as Promise<QqEmoji[]>;
      }),
      fetch(assetUrl("assets/wechat_emoji/_index.json"), {
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) throw new Error(`微信表情数据读取失败：${response.status}`);
        return response.json() as Promise<WechatEmoji[]>;
      }),
    ])
      .then(([qq, wechat]) => {
        setQqItems(qq);
        setWechatItems(wechat);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "表情数据读取失败");
        setLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const isDark = themeMode === "dark" || (themeMode === "auto" && media.matches);
      document.documentElement.classList.toggle("dark", isDark);
      document.documentElement.dataset.theme = isDark ? "dark" : "light";
      document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    };

    applyTheme();
    window.localStorage.setItem("qface-theme", themeMode);
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themeMode]);

  useEffect(
    () => () => {
      if (previewOpenTimerRef.current !== null) {
        window.clearTimeout(previewOpenTimerRef.current);
      }
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      if (copyCancelTimerRef.current !== null) {
        window.clearTimeout(copyCancelTimerRef.current);
      }
      if (copyDismissTimerRef.current !== null) {
        window.clearTimeout(copyDismissTimerRef.current);
      }
      if (copyExitTimerRef.current !== null) {
        window.clearTimeout(copyExitTimerRef.current);
      }
      if (menuPressGuardTimerRef.current !== null) {
        window.clearTimeout(menuPressGuardTimerRef.current);
      }
      if (menuCloseTimerRef.current !== null) {
        window.clearTimeout(menuCloseTimerRef.current);
      }
      copyControllerRef.current?.abort();
    },
    [],
  );

  const qqEmoji = useMemo(() => normalizeQq(qqItems), [qqItems]);
  const wechatEmoji = useMemo(() => normalizeWechat(wechatItems), [wechatItems]);
  const allEmojiByKey = useMemo(
    () => new Map([...qqEmoji, ...wechatEmoji].map((item) => [item.key, item])),
    [qqEmoji, wechatEmoji],
  );
  const items = collection === "qq" ? qqEmoji : wechatEmoji;
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return items;
    return items.filter((item) => item.searchText.includes(normalizedQuery));
  }, [items, query]);
  const recentItems = useMemo(
    () =>
      recentKeys
        .map((key) => allEmojiByKey.get(key))
        .filter((item): item is DisplayEmoji => Boolean(item)),
    [allEmojiByKey, recentKeys],
  );
  const visibleRecentItems = useMemo(
    () => (query.trim() ? [] : recentItems.slice(0, recentLimit)),
    [query, recentItems, recentLimit],
  );
  const regularItems = useMemo(
    () =>
      collection === "qq"
        ? filteredItems.filter((item) => !LOTTIE_ANIMATION_ONLY_IDS.has(item.id))
        : filteredItems,
    [collection, filteredItems],
  );
  const lottieOnlyItems = useMemo(
    () =>
      collection === "qq"
        ? filteredItems.filter((item) => LOTTIE_ANIMATION_ONLY_IDS.has(item.id))
        : [],
    [collection, filteredItems],
  );
  const listEntries = useMemo<EmojiGridItemEntry[]>(
    () =>
      regularItems.map((item) => ({
        item,
        isRecent: false,
        renderKey: `list-${item.key}`,
      })),
    [regularItems],
  );
  const lottieEntries = useMemo<EmojiGridItemEntry[]>(
    () =>
      lottieOnlyItems.map((item) => ({
        item,
        isRecent: false,
        renderKey: `list-${item.key}`,
      })),
    [lottieOnlyItems],
  );
  const gridEntries = useMemo<EmojiGridEntry[]>(
    () => {
      const entries: EmojiGridEntry[] = [];
      if (visibleRecentItems.length) {
        entries.push(
          "recent-label",
          ...visibleRecentItems.map((item) => ({
            item,
            isRecent: true,
            renderKey: `recent-${item.key}`,
          })),
          "recent-divider",
        );
      }
      entries.push(...listEntries);
      if (lottieEntries.length) {
        if (listEntries.length) entries.push("lottie-divider");
        entries.push("lottie-label", ...lottieEntries);
      }
      return entries;
    },
    [listEntries, lottieEntries, visibleRecentItems],
  );

  useEffect(() => {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recentKeys));
  }, [recentKeys]);

  useLayoutEffect(() => {
    recentScrollAnchorRef.current = null;
    emojiScrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [collection, query]);

  useLayoutEffect(() => {
    const anchor = recentScrollAnchorRef.current;
    recentScrollAnchorRef.current = null;
    const scroll = emojiScrollRef.current;
    const firstItem = scroll?.querySelector<HTMLElement>(
      '[data-entry-key^="list-"]',
    );
    if (!anchor || !scroll || firstItem?.dataset.entryKey !== anchor.entryKey) {
      return;
    }

    // Keep the ordinary list still when recent rows are inserted above it.
    // Use content coordinates so scrolling during an async copy is preserved.
    const contentTop =
      firstItem.getBoundingClientRect().top - scroll.getBoundingClientRect().top
      + scroll.scrollTop;
    const delta = contentTop - anchor.contentTop;
    if (Math.abs(delta) > 0.5) scroll.scrollTop += delta;
  }, [recentKeys]);

  useLayoutEffect(() => {
    const grid = emojiGridRef.current;
    if (!grid) return;

    let previousWidth = 0;
    const updateRecentLimit = () => {
      const columnCount = getComputedStyle(grid).gridTemplateColumns
        .split(" ")
        .filter(Boolean).length;
      setRecentLimit(Math.max(2, columnCount * 2));
    };

    const observer = new ResizeObserver(([entry]) => {
      if (!entry || !grid.classList.contains("emoji-grid")) return;
      if (entry.contentRect.width === previousWidth) return;
      previousWidth = entry.contentRect.width;
      updateRecentLimit();
    });
    updateRecentLimit();
    observer.observe(grid);
    return () => observer.disconnect();
  }, [error, loading]);

  useEffect(() => {
    const hasVisibleEntry = (key: string) =>
      gridEntries.some(
        (entry) =>
          typeof entry !== "string" &&
          "item" in entry &&
          entry.renderKey === key,
      );
    if (openKey && !hasVisibleEntry(openKey)) {
      setOpenKey("");
    }
    if (menuKey && !hasVisibleEntry(menuKey)) {
      setMenuKey("");
    }
  }, [gridEntries, menuKey, openKey]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const cancelPreviewOpen = useCallback((entryKey?: string) => {
    if (entryKey && pendingPreviewKeyRef.current !== entryKey) return;
    if (previewOpenTimerRef.current !== null) {
      window.clearTimeout(previewOpenTimerRef.current);
      previewOpenTimerRef.current = null;
    }
    pendingPreviewKeyRef.current = "";
  }, []);

  const openPreview = useCallback(
    (item: DisplayEmoji, entryKey: string) => {
      if (suppressHoverRef.current || menuKey) return;
      cancelClose();
      cancelPreviewOpen();
      pendingPreviewKeyRef.current = entryKey;
      previewOpenTimerRef.current = window.setTimeout(() => {
        previewOpenTimerRef.current = null;
        if (pendingPreviewKeyRef.current !== entryKey) return;
        pendingPreviewKeyRef.current = "";
        setOpenKey((current) => {
          if (current !== entryKey) {
            setPreviewMode(hasAnimatedPreview(item) ? "animated" : "static");
          }
          return entryKey;
        });
      }, HOVER_PREVIEW_DELAY);
    },
    [cancelClose, cancelPreviewOpen, menuKey],
  );

  const resumePreviewOnMove = useCallback(
    (item: DisplayEmoji, entryKey: string) => {
      if (!suppressHoverRef.current) return;
      suppressHoverRef.current = false;
      openPreview(item, entryKey);
    },
    [openPreview],
  );

  const closePreviewSoon = useCallback((key: string) => {
    cancelPreviewOpen(key);
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      const pointerStillInside = document.querySelector(
        ".emoji-cell:hover",
      );
      if (pointerStillInside) {
        closeTimer.current = null;
        return;
      }
      setOpenKey("");
      closeTimer.current = null;
    }, 80);
  }, [cancelClose, cancelPreviewOpen]);

  const releaseLongPressGuard = useCallback((entryKey: string) => {
    if (menuPressGuardTimerRef.current !== null) {
      window.clearTimeout(menuPressGuardTimerRef.current);
    }
    menuPressGuardTimerRef.current = window.setTimeout(() => {
      if (menuPressGuardRef.current === entryKey) {
        menuPressGuardRef.current = "";
      }
      menuPressGuardTimerRef.current = null;
    }, MOBILE_LONG_PRESS_RELEASE_GUARD);
  }, []);

  const cancelMenuClose = useCallback(() => {
    if (menuCloseTimerRef.current !== null) {
      window.clearTimeout(menuCloseTimerRef.current);
      menuCloseTimerRef.current = null;
    }
  }, []);

  const closeMenuSoon = useCallback(() => {
    cancelMenuClose();
    menuCloseTimerRef.current = window.setTimeout(() => {
      setMenuKey("");
      menuCloseTimerRef.current = null;
    }, MENU_CLOSE_DELAY);
  }, [cancelMenuClose]);

  const openMoreMenu = useCallback(
    (item: DisplayEmoji, entryKey: string, guardRelease = false) => {
      cancelPreviewOpen();
      cancelClose();
      cancelMenuClose();
      if (guardRelease) {
        menuPressGuardRef.current = entryKey;
      }
      setOpenKey("");
      setPreviewMode(hasAnimatedPreview(item) ? "animated" : "static");
      setMenuKey(entryKey);
    },
    [cancelClose, cancelMenuClose, cancelPreviewOpen],
  );

  useEffect(() => {
    if (!menuKey) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const menu = document.querySelector(".emoji-popover--menu");
      if (menu?.contains(event.target as Node)) return;
      cancelMenuClose();
      setMenuKey("");
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    };
  }, [cancelMenuClose, menuKey]);

  function selectCollection(nextCollection: CollectionName) {
    cancelPreviewOpen();
    cancelMenuClose();
    setCollection(nextCollection);
    setQuery("");
    setOpenKey("");
    setMenuKey("");
  }

  async function runClipboardAction(
    action: () => Promise<void>,
    successMessage: string,
  ) {
    try {
      await action();
      showAppToast(successMessage, "success", 2200);
    } catch (reason) {
      showAppToast(copyFailureMessage(reason), "danger", 3200);
    }
  }

  const clearCopyTaskTimers = useCallback(() => {
    if (copyCancelTimerRef.current !== null) {
      window.clearTimeout(copyCancelTimerRef.current);
      copyCancelTimerRef.current = null;
    }
    if (copyDismissTimerRef.current !== null) {
      window.clearTimeout(copyDismissTimerRef.current);
      copyDismissTimerRef.current = null;
    }
    if (copyExitTimerRef.current !== null) {
      window.clearTimeout(copyExitTimerRef.current);
      copyExitTimerRef.current = null;
    }
  }, []);

  const settleCopyTask = useCallback(
    (
      entryKey: string,
      status: CopyTaskState["status"],
      title: string,
      timeout: number,
    ) => {
      if (copyCancelTimerRef.current !== null) {
        window.clearTimeout(copyCancelTimerRef.current);
        copyCancelTimerRef.current = null;
      }
      setCopyTask((current) =>
        current?.entryKey === entryKey
          ? {
              ...current,
              title,
              detail: "",
              progress: undefined,
              status,
              showCancel: false,
            }
          : current,
      );
      copyDismissTimerRef.current = window.setTimeout(() => {
        setCopyTask((current) =>
          current?.entryKey === entryKey
            ? { ...current, exiting: true }
            : current,
        );
        copyExitTimerRef.current = window.setTimeout(() => {
          setCopyTask((current) =>
            current?.entryKey === entryKey ? null : current,
          );
          copyExitTimerRef.current = null;
        }, TOAST_EXIT_DURATION);
        copyDismissTimerRef.current = null;
      }, timeout);
    },
    [],
  );

  const cancelCopyTask = useCallback(() => {
    const controller = copyControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    if (copyCancelTimerRef.current !== null) {
      window.clearTimeout(copyCancelTimerRef.current);
      copyCancelTimerRef.current = null;
    }
    setCopyTask((current) =>
      current?.status === "active"
        ? {
            ...current,
            detail: "正在取消…",
            progress: undefined,
            showCancel: false,
          }
        : current,
    );
    controller.abort();
  }, []);

  const copyEmoji = useCallback(
    async (
      item: DisplayEmoji,
      options: {
        signal?: AbortSignal;
        onProgress?: (progress: PrepareProgress) => void;
      } = {},
    ): Promise<string> => {
      const { onProgress, signal } = options;
      let lastCopyError: unknown;
      // PNG fallback is only for clipboard limitations, not failed conversion.
      const preparedGif = await prepareGif(item, options);
      try {
        throwIfCopyAborted(signal);
        onProgress?.({ phase: "clipboard", label: "正在写入剪贴板" });
        await copyGifBlob(preparedGif.blob, item.name, signal);
        return preparedGif.generated ? "GIF 已生成并复制" : "GIF 复制成功";
      } catch (reason) {
        if (isAbortError(reason)) throw reason;
        lastCopyError = reason;
      }

      const fallbackPngPaths = [
        ...pngPathsFor(item),
        ...item.assets
          .filter((asset) => asset.type === QQ_ASSET_TYPE.APNG)
          .map((asset) => asset.path),
      ];
      for (const path of new Set(fallbackPngPaths)) {
        onProgress?.({ phase: "preparing", label: "正在准备静态图片" });
        const fallbackPngBlob = await fetchPngBlob(path, {
          signal,
          onDownloadProgress: (progress) =>
            onProgress?.({ phase: "download", label: "下载 PNG", progress }),
        });
        if (!fallbackPngBlob) continue;
        try {
          throwIfCopyAborted(signal);
          onProgress?.({ phase: "clipboard", label: "正在写入剪贴板" });
          await copyPngBlob(fallbackPngBlob, signal);
          return "GIF 无法复制，已改为静态 PNG";
        } catch (reason) {
          if (isAbortError(reason)) throw reason;
          lastCopyError = reason;
        }
      }

      if (item.fallbackText) {
        throwIfCopyAborted(signal);
        onProgress?.({ phase: "clipboard", label: "正在写入剪贴板" });
        await navigator.clipboard.writeText(item.fallbackText);
        throwIfCopyAborted(signal);
        return "文本已复制";
      }
      if (lastCopyError) throw lastCopyError;
      throw new Error("当前表情没有可复制的内容");
    },
    [],
  );

  const rememberRecent = useCallback((item: DisplayEmoji) => {
    const scroll = emojiScrollRef.current;
    const firstItem = scroll?.querySelector<HTMLElement>(
      '[data-entry-key^="list-"]',
    );
    // Capture only immediately before the successful copy updates the list,
    // never at pointer-down (the user may scroll while assets are downloading).
    recentScrollAnchorRef.current =
      scroll && firstItem?.dataset.entryKey
        ? {
            entryKey: firstItem.dataset.entryKey,
            contentTop:
              firstItem.getBoundingClientRect().top
              - scroll.getBoundingClientRect().top + scroll.scrollTop,
          }
        : null;
    setRecentKeys((current) => [
      item.key,
      ...current.filter((key) => key !== item.key),
    ].slice(0, MAX_STORED_RECENT));
  }, []);

  const handleQuickCopy = useCallback(
    (item: DisplayEmoji, entryKey: string) => {
      if (copyingKeyRef.current) return;
      clearCopyTaskTimers();
      const controller = new AbortController();
      copyControllerRef.current = controller;
      copyingKeyRef.current = entryKey;
      setCopyingKey(entryKey);
      setCopyTask({
        entryKey,
        title: `正在复制「${item.name}」`,
        detail: "正在查找可复制资源",
        status: "active",
        showCancel: false,
        exiting: false,
      });
      copyCancelTimerRef.current = window.setTimeout(() => {
        setCopyTask((current) =>
          current?.entryKey === entryKey && current.status === "active"
            ? { ...current, showCancel: true }
            : current,
        );
        copyCancelTimerRef.current = null;
      }, COPY_CANCEL_DELAY);

      const updateProgress = (nextProgress: PrepareProgress) => {
        if (
          copyControllerRef.current !== controller ||
          controller.signal.aborted
        ) {
          return;
        }
        if (
          nextProgress.phase === "clipboard" &&
          copyCancelTimerRef.current !== null
        ) {
          window.clearTimeout(copyCancelTimerRef.current);
          copyCancelTimerRef.current = null;
        }
        setCopyTask((current) => {
          if (current?.entryKey !== entryKey || current.status !== "active") {
            return current;
          }
          if (nextProgress.phase === "download") {
            const { loaded, total } = nextProgress.progress;
            return {
              ...current,
              detail: total
                ? `${nextProgress.label} · ${formatBytes(loaded)} / ${formatBytes(total)}`
                : `${nextProgress.label} · 已下载 ${formatBytes(loaded)}`,
              progress: total
                ? Math.min(100, Math.max(0, (loaded / total) * 100))
                : undefined,
            };
          }
          if (nextProgress.phase === "convert") {
            const { completed, total, stage } = nextProgress.progress;
            return {
              ...current,
              detail: `${stage || nextProgress.label} · ${completed} / ${total} 帧`,
              progress: total
                ? Math.min(100, Math.max(0, (completed / total) * 100))
                : undefined,
            };
          }
          return {
            ...current,
            detail: nextProgress.label,
            progress: undefined,
            showCancel:
              nextProgress.phase === "clipboard" ? false : current.showCancel,
          };
        });
      };

      void copyEmoji(item, {
        signal: controller.signal,
        onProgress: updateProgress,
      })
        .then((message) => {
          suppressHoverRef.current = true;
          setOpenKey("");
          setMenuKey("");
          setLastCopiedKey(entryKey);
          rememberRecent(item);
          settleCopyTask(entryKey, "success", message, 1800);
        })
        .catch((reason: unknown) => {
          if (isAbortError(reason)) {
            settleCopyTask(entryKey, "cancelled", "已取消复制", 1200);
            return;
          }
          settleCopyTask(
            entryKey,
            "danger",
            copyFailureMessage(reason),
            2800,
          );
        })
        .finally(() => {
          if (copyControllerRef.current === controller) {
            copyControllerRef.current = null;
          }
          copyingKeyRef.current = "";
          setCopyingKey("");
        });
    },
    [clearCopyTaskTimers, copyEmoji, rememberRecent, settleCopyTask],
  );

  const handleGridCopy = useCallback(
    (item: DisplayEmoji, entryKey: string) => {
      if (menuPressGuardRef.current === entryKey) return;
      handleQuickCopy(item, entryKey);
    },
    [handleQuickCopy],
  );

  async function handleDownloadGif(item: DisplayEmoji) {
    if (gifDownloadKey) return;
    setGifDownloadKey(item.key);
    try {
      const preparedGif = await prepareGif(item);
      downloadBlob(preparedGif.blob, `${item.id}.gif`);
      showAppToast(
        preparedGif.generated ? "GIF 已生成并下载" : "GIF 已下载",
        "success",
        2200,
      );
    } catch (reason) {
      showAppToast(
        reason instanceof Error ? reason.message : "GIF 下载失败",
        "danger",
        2800,
      );
    } finally {
      setGifDownloadKey("");
    }
  }

  return (
    <main className="app-shell">
      <Toast.Provider
        className="app-toast-region"
        maxVisibleToasts={1}
        placement="bottom"
        queue={appToastQueue}
        width={264}
      />
      {copyTask ? (
        <aside
          aria-live="polite"
          className="copy-task-toast"
          data-exiting={copyTask.exiting ? "true" : undefined}
          data-status={copyTask.status}
          role="status"
        >
          <div className="copy-task-toast__row">
            {copyTask.status === "active" ? (
              <Spinner color="current" size="sm" />
            ) : (
              <span className="copy-task-toast__mark" aria-hidden="true">
                {copyTask.status === "success"
                  ? "✓"
                  : copyTask.status === "danger"
                    ? "!"
                    : "×"}
              </span>
            )}
            <div className="copy-task-toast__content">
              <strong>{copyTask.title}</strong>
              {copyTask.detail ? <span>{copyTask.detail}</span> : null}
            </div>
            {copyTask.status === "active" && copyTask.showCancel ? (
              <Button
                className="copy-task-toast__cancel"
                size="sm"
                variant="tertiary"
                onPress={cancelCopyTask}
              >
                取消
              </Button>
            ) : null}
          </div>
          {copyTask.status === "active" && copyTask.progress !== undefined ? (
            <ProgressBar
              aria-label="复制进度"
              className="copy-task-toast__progress"
              size="sm"
              value={copyTask.progress}
            >
              <ProgressBar.Track>
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
          ) : null}
        </aside>
      ) : null}
      <section className="emoji-panel" aria-label="表情选择器">
        <nav className="toolbar" aria-label="表情浏览">
          <div className="collection-switcher" aria-label="表情来源">
            <Button
              aria-pressed={collection === "qq"}
              size="sm"
              variant="tertiary"
              onPress={() => selectCollection("qq")}
            >
              QQ
            </Button>
            <Button
              aria-pressed={collection === "wechat"}
              size="sm"
              variant="tertiary"
              onPress={() => selectCollection("wechat")}
            >
              微信
            </Button>
          </div>

          <SearchField
            aria-label="搜索表情"
            name="emoji-search"
            value={query}
            variant="secondary"
            onChange={setQuery}
            onClear={() => setQuery("")}
          >
            <SearchField.Group>
              <SearchField.SearchIcon className="toolbar-search-icon" />
              <SearchField.Input
                className="toolbar-search-input"
                placeholder="搜索表情"
              />
              <SearchField.ClearButton
                aria-label="清空搜索"
                className="toolbar-search-clear"
              />
            </SearchField.Group>
          </SearchField>

          <div className="theme-switcher" aria-label="显示模式">
            <Button
              isIconOnly
              aria-label="跟随系统"
              aria-pressed={themeMode === "auto"}
              size="sm"
              variant="tertiary"
              onPress={() => setThemeMode("auto")}
            >
              <Monitor size={14} />
            </Button>
            <Button
              isIconOnly
              aria-label="亮色模式"
              aria-pressed={themeMode === "light"}
              size="sm"
              variant="tertiary"
              onPress={() => setThemeMode("light")}
            >
              <Sun size={14} />
            </Button>
            <Button
              isIconOnly
              aria-label="暗色模式"
              aria-pressed={themeMode === "dark"}
              size="sm"
              variant="tertiary"
              onPress={() => setThemeMode("dark")}
            >
              <Moon size={14} />
            </Button>
          </div>
        </nav>

        <div className="emoji-viewport">
        <div
          className="emoji-scroll"
          ref={emojiScrollRef}
          role="region"
          aria-label="表情列表"
          tabIndex={0}
        >
        {loading ? (
          <div className="state-view" aria-label="正在载入表情">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <div className="state-view">
            <span>{error}</span>
            <Button variant="secondary" onPress={() => window.location.reload()}>
              <RotateCcw size={15} />
              重试
            </Button>
          </div>
        ) : gridEntries.length ? (
          <div className="emoji-grid" ref={emojiGridRef}>
            {gridEntries.map((entry) => {
              if (entry === "recent-label") {
                return (
                  <div className="recent-label" key={entry}>
                    最近表情
                  </div>
                );
              }
              if (entry === "recent-divider") {
                return <div className="recent-divider" key={entry} />;
              }
              if (entry === "lottie-label") {
                return (
                  <div className="lottie-label" key={entry}>
                    Lottie 表情
                  </div>
                );
              }
              if (entry === "lottie-divider") {
                return <div className="lottie-divider" key={entry} />;
              }
              const { item, isRecent, renderKey } = entry;
              const isPreviewOpen = openKey === renderKey;
              const isMenuOpen = menuKey === renderKey;
              const isActive = isPreviewOpen || isMenuOpen;
              const isCopySelected = copyingKey
                ? copyingKey === renderKey
                : lastCopiedKey === renderKey;

              if (!isActive) {
                return (
                  <Fragment key={renderKey}>
                    <EmojiButton
                      item={item}
                      entryKey={renderKey}
                      isRecent={isRecent}
                      isActive={false}
                      isMenuOpen={false}
                      isCopySelected={isCopySelected}
                      onClose={closePreviewSoon}
                      onLongPressRelease={releaseLongPressGuard}
                      onMenuEnter={cancelMenuClose}
                      onMenuLeave={closeMenuSoon}
                      onOpenMenu={openMoreMenu}
                      onCopy={handleGridCopy}
                      onMove={resumePreviewOnMove}
                      onOpen={openPreview}
                      triggerRef={activeTriggerRef}
                    />
                  </Fragment>
                );
              }

              const pngAsset = preferredPngAsset(
                item.assets,
                SKIP_UNDERSCORE_PNG_IDS.has(item.id),
              );
              const gifAsset = item.assets.find(
                (asset) => asset.type === QQ_ASSET_TYPE.GIF,
              );
              const apngAsset = item.assets.find(
                (asset) => asset.type === QQ_ASSET_TYPE.APNG,
              );
              const lottieAssets = item.assets.filter(
                (asset) => asset.type === QQ_ASSET_TYPE.LOTTIE,
              );
              const downloadablePng =
                pngAsset ||
                (item.staticPath
                  ? {
                      type: QQ_ASSET_TYPE.PNG,
                      name: `${item.id}.png`,
                      path: item.staticPath,
                    }
                  : undefined);
              const isLottieAnimationOnly =
                item.collection === "qq" &&
                LOTTIE_ANIMATION_ONLY_IDS.has(item.id);
              const lottiePreviewAsset =
                previewMode === "animated" && isLottieAnimationOnly
                  ? lottieAssets[0]
                  : undefined;
              const preferredLinkAsset = isLottieAnimationOnly
                ? lottieAssets[0] || downloadablePng
                : gifAsset || apngAsset || downloadablePng || lottieAssets[0];
              const sourceAssets = item.assets.length
                ? item.assets
                : downloadablePng
                  ? [downloadablePng]
                  : [];
              const previewPath =
                previewMode === "animated" && item.animatedPath
                  ? item.animatedPath
                  : item.staticPath;
              return (
                <Fragment key={renderKey}>
                  <EmojiButton
                    item={item}
                    entryKey={renderKey}
                    isRecent={isRecent}
                    isActive
                    isMenuOpen={isMenuOpen}
                    isCopySelected={isCopySelected}
                    onClose={closePreviewSoon}
                    onLongPressRelease={releaseLongPressGuard}
                    onMenuEnter={cancelMenuClose}
                    onMenuLeave={closeMenuSoon}
                    onOpenMenu={openMoreMenu}
                    onCopy={handleGridCopy}
                    onMove={resumePreviewOnMove}
                    onOpen={openPreview}
                    triggerRef={activeTriggerRef}
                  />

                  {isActive ? (
                    <Popover.Content
                      key={`${renderKey}-${isMenuOpen ? "menu" : "preview"}`}
                      className={`emoji-popover ${
                        isMenuOpen
                          ? "emoji-popover--expanded emoji-popover--menu"
                          : "emoji-popover--preview"
                      }`}
                      isOpen
                      isNonModal
                      placement="top"
                      offset={5}
                      shouldFlip
                      triggerRef={activeTriggerRef}
                      onPointerEnter={(event) => {
                        if (isMenuOpen && event.pointerType === "mouse") {
                          cancelMenuClose();
                        }
                      }}
                      onPointerLeave={(event) => {
                        if (isMenuOpen && event.pointerType === "mouse") {
                          closeMenuSoon();
                        }
                      }}
                      onOpenChange={(nextOpen) => {
                        if (
                          !nextOpen &&
                          isMenuOpen &&
                          menuPressGuardRef.current !== renderKey
                        ) {
                          cancelMenuClose();
                          setMenuKey("");
                        }
                      }}
                    >
                      <Popover.Dialog aria-label={`${item.name} 预览`}>
                        <PreviewMedia
                          item={item}
                          lottieSrc={
                            lottiePreviewAsset
                              ? assetUrl(lottiePreviewAsset.path)
                              : undefined
                          }
                          previewMode={previewMode}
                          previewPath={
                            lottiePreviewAsset ? undefined : previewPath
                          }
                        />

                        {isMenuOpen ? (
                          <div className="preview-details">
                            <div className="preview-title">
                              <Popover.Heading>{item.name}</Popover.Heading>
                              <span>
                                {item.collection === "qq" ? "QQ" : "微信"} #{item.id}
                              </span>
                            </div>

                            {hasAnimatedPreview(item) ? (
                              <div className="preview-section">
                              <div
                                className="preview-modes"
                                aria-label="预览方式"
                                role="tablist"
                              >
                                <Button
                                  aria-label="动画预览"
                                  render={(props) => (
                                    <button
                                      {...props}
                                      aria-selected={previewMode === "animated"}
                                      role="tab"
                                    />
                                  )}
                                  size="sm"
                                  variant="tertiary"
                                  onPress={() => setPreviewMode("animated")}
                                >
                                  <Play size={13} />
                                  动画
                                </Button>
                                <Button
                                  aria-label="静态预览"
                                  render={(props) => (
                                    <button
                                      {...props}
                                      aria-selected={previewMode === "static"}
                                      role="tab"
                                    />
                                  )}
                                  size="sm"
                                  variant="tertiary"
                                  onPress={() => setPreviewMode("static")}
                                >
                                  <ImageIcon size={13} />
                                  静态
                                </Button>
                              </div>
                              </div>
                            ) : null}

                            <div className="preview-section">
                              <div
                                className="preview-actions"
                                aria-label="表情操作"
                              >
                                <Button
                                  aria-label="复制 GIF"
                                  className="preview-action"
                                  isPending={copyingKey === renderKey}
                                  size="sm"
                                  variant="secondary"
                                  onPress={() => handleQuickCopy(item, renderKey)}
                                >
                                  {copyingKey === renderKey ? (
                                    <Spinner color="current" size="sm" />
                                  ) : (
                                    <Clipboard size={13} />
                                  )}
                                  {copyingKey === renderKey ? "复制中" : "复制"}
                                </Button>
                                <Button
                                  aria-label="下载 GIF"
                                  className="preview-action"
                                  isPending={gifDownloadKey === item.key}
                                  size="sm"
                                  variant="tertiary"
                                  onPress={() => handleDownloadGif(item)}
                                >
                                  <Download size={13} />
                                  下载
                                </Button>
                                {preferredLinkAsset ? (
                                  <Button
                                    aria-label="复制资源链接"
                                    className="preview-action"
                                    size="sm"
                                    variant="tertiary"
                                    onPress={() =>
                                      runClipboardAction(
                                        () =>
                                          copyAssetLink(preferredLinkAsset.path),
                                        "资源链接已复制",
                                      )
                                    }
                                  >
                                    <Link2 size={13} />
                                    链接
                                  </Button>
                                ) : null}
                              </div>
                            </div>

                            {sourceAssets.length ? (
                              <Disclosure className="source-assets">
                                <Disclosure.Heading className="source-assets__heading">
                                  <Disclosure.Trigger className="source-assets__trigger">
                                    <span>原始文件 · {sourceAssets.length}</span>
                                    <Disclosure.Indicator />
                                  </Disclosure.Trigger>
                                </Disclosure.Heading>
                                <Disclosure.Content className="source-assets__content">
                                  <Disclosure.Body className="source-assets__body">
                                    <div className="source-list">
                                      {sourceAssets.map((asset, index) => (
                                        <div
                                          className="source-row"
                                          key={`${asset.path}-${index}`}
                                        >
                                          <span>{assetLabel(asset)}</span>
                                          <span title={asset.name}>
                                            {asset.name}
                                          </span>
                                          <Button
                                            isIconOnly
                                            aria-label={`下载 ${asset.name}`}
                                            size="sm"
                                            variant="ghost"
                                            onPress={() => {
                                              downloadAsset(asset);
                                              showAppToast(
                                                `${asset.name} 已下载`,
                                                "success",
                                                2200,
                                              );
                                            }}
                                          >
                                            <Download size={12} />
                                          </Button>
                                          <Button
                                            isIconOnly
                                            aria-label={`打开 ${asset.name}`}
                                            size="sm"
                                            variant="ghost"
                                            onPress={() => openAsset(asset.path)}
                                          >
                                            <ExternalLink size={12} />
                                          </Button>
                                        </div>
                                      ))}
                                    </div>
                                  </Disclosure.Body>
                                </Disclosure.Content>
                              </Disclosure>
                            ) : null}
                          </div>
                        ) : null}
                      </Popover.Dialog>
                    </Popover.Content>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        ) : (
          <div className="empty-view">没有匹配的表情</div>
        )}
        </div>
        </div>
      </section>
    </main>
  );
}
