import {
  Button,
  Popover,
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
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
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
  openAsset,
} from "./media";
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
type PendingViewportAnchor = {
  key: string;
  top: number;
  fallbackLeft: number;
  fallbackTop: number;
};
type PreparedGif = {
  blob: Blob;
  generated: boolean;
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
const TOAST_EXIT_DURATION = 200;
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

async function prepareGif(item: DisplayEmoji): Promise<PreparedGif> {
  let lastConversionError: unknown;
  const gifPaths = [
    ...item.assets
      .filter((asset) => asset.type === QQ_ASSET_TYPE.GIF)
      .map((asset) => asset.path),
    ...(item.collection === "qq" && /^\d+$/.test(item.id)
      ? [`gif/s${item.id}.gif`]
      : []),
  ];

  for (const path of new Set(gifPaths)) {
    const blob = await fetchGifBlob(path);
    if (blob) return { blob, generated: false };
  }

  const apngAssets = item.assets.filter(
    (asset) => asset.type === QQ_ASSET_TYPE.APNG,
  );
  for (const asset of new Map(
    apngAssets.map((candidate) => [candidate.path, candidate]),
  ).values()) {
    if (!(await fetchApngBlob(asset.path))) continue;
    try {
      return {
        blob: await convertApngToGifBlob(asset),
        generated: true,
      };
    } catch (reason) {
      lastConversionError = reason;
    }
  }

  for (const path of new Set(pngPathsFor(item))) {
    const blob = await fetchPngBlob(path);
    if (!blob) continue;
    try {
      return {
        blob: await convertPngToGifBlob(path, blob),
        generated: true,
      };
    } catch (reason) {
      lastConversionError = reason;
    }
  }

  if (item.fallbackText) {
    try {
      return {
        blob: await convertTextToGifBlob(item.key, item.fallbackText),
        generated: true,
      };
    } catch (reason) {
      lastConversionError = reason;
    }
  }

  if (lastConversionError) throw lastConversionError;
  throw new Error("当前表情没有可生成 GIF 的内容");
}

function EmojiThumbnail({ item }: { item: DisplayEmoji }) {
  return item.staticPath ? (
    <img
      src={assetUrl(item.staticPath)}
      alt=""
      loading="lazy"
      decoding="async"
    />
  ) : (
    <span className="emoji-glyph" aria-hidden="true">
      {item.fallbackText}
    </span>
  );
}

const EmojiButton = memo(function EmojiButton({
  item,
  entryKey,
  isRecent,
  isActive,
  isMenuOpen,
  onOpen,
  onMove,
  onClose,
  onCopy,
  onContextMenu,
  triggerRef,
}: {
  item: DisplayEmoji;
  entryKey: string;
  isRecent: boolean;
  isActive: boolean;
  isMenuOpen: boolean;
  onOpen: (item: DisplayEmoji, entryKey: string) => void;
  onMove: (item: DisplayEmoji, entryKey: string) => void;
  onClose: (key: string) => void;
  onCopy: (item: DisplayEmoji) => void;
  onContextMenu: (
    item: DisplayEmoji,
    event: ReactMouseEvent<HTMLDivElement>,
    entryKey: string,
  ) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div
      className="emoji-cell"
      data-emoji-key={item.key}
      data-entry-key={entryKey}
      data-recent={isRecent ? "true" : undefined}
      onMouseEnter={() => onOpen(item, entryKey)}
      onMouseMove={() => onMove(item, entryKey)}
      onMouseLeave={() => onClose(entryKey)}
      onContextMenu={(event) => onContextMenu(item, event, entryKey)}
    >
      <Button
        ref={isActive ? triggerRef : undefined}
        className="emoji-button"
        isIconOnly
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        aria-label={`复制 ${item.name}，编号 ${item.id}`}
        variant="ghost"
        onPress={() => onCopy(item)}
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
  const closeTimer = useRef<number | null>(null);
  const suppressHoverRef = useRef(false);
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const emojiGridRef = useRef<HTMLDivElement | null>(null);
  const pendingViewportAnchorRef = useRef<PendingViewportAnchor | null>(null);

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
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
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
    const pending = pendingViewportAnchorRef.current;
    if (!pending) return;

    pendingViewportAnchorRef.current = null;
    const grid = emojiGridRef.current;
    const anchor = grid
      ? Array.from(
          grid.querySelectorAll<HTMLElement>(
            '.emoji-cell[data-emoji-key]:not([data-recent="true"])',
          ),
        ).find((element) => element.dataset.emojiKey === pending.key)
      : null;

    if (!anchor) {
      window.scrollTo(pending.fallbackLeft, pending.fallbackTop);
      return;
    }

    const offset = anchor.getBoundingClientRect().top - pending.top;
    if (Math.abs(offset) > 0.5) window.scrollBy(0, offset);
  }, [recentKeys]);

  useEffect(() => {
    const grid = emojiGridRef.current;
    if (!grid) return;

    let fadeFrame = 0;

    const updateRecentLimit = () => {
      const columnCount = getComputedStyle(grid).gridTemplateColumns
        .split(" ")
        .filter(Boolean).length;
      setRecentLimit(Math.max(2, columnCount * 2));
    };

    const updateFadeMask = () => {
      const gridTop = grid.getBoundingClientRect().top;
      const fadeStart = Math.max(0, window.innerHeight - 138 - gridTop);
      const fadeEnd = Math.max(fadeStart, window.innerHeight - 24 - gridTop);
      grid.style.setProperty("--emoji-fade-start", `${Math.round(fadeStart)}px`);
      grid.style.setProperty("--emoji-fade-end", `${Math.round(fadeEnd)}px`);
    };

    const scheduleFadeMaskUpdate = () => {
      if (fadeFrame) return;
      fadeFrame = window.requestAnimationFrame(() => {
        fadeFrame = 0;
        updateFadeMask();
      });
    };

    const observer = new ResizeObserver(() => {
      updateRecentLimit();
      scheduleFadeMaskUpdate();
    });
    updateRecentLimit();
    updateFadeMask();
    observer.observe(grid);
    window.addEventListener("scroll", scheduleFadeMaskUpdate, { passive: true });
    window.addEventListener("resize", scheduleFadeMaskUpdate);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", scheduleFadeMaskUpdate);
      window.removeEventListener("resize", scheduleFadeMaskUpdate);
      if (fadeFrame) window.cancelAnimationFrame(fadeFrame);
    };
  }, [error, loading]);

  useEffect(() => {
    const hasVisibleEntry = (key: string) =>
      gridEntries.some(
        (entry) => typeof entry !== "string" && entry.renderKey === key,
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

  const openPreview = useCallback((item: DisplayEmoji, entryKey: string) => {
    if (suppressHoverRef.current) return;
    cancelClose();
    if (menuKey) return;
    setOpenKey((current) => {
      if (current !== entryKey) {
        setPreviewMode(hasAnimatedPreview(item) ? "animated" : "static");
      }
      return entryKey;
    });
  }, [cancelClose, menuKey]);

  const resumePreviewOnMove = useCallback(
    (item: DisplayEmoji, entryKey: string) => {
      if (!suppressHoverRef.current) return;
      suppressHoverRef.current = false;
      openPreview(item, entryKey);
    },
    [openPreview],
  );

  const closePreviewSoon = useCallback((key: string) => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      const pointerStillInside = document.querySelector(
        ".emoji-cell:hover",
      );
      if (pointerStillInside) {
        closeTimer.current = null;
        return;
      }
      setOpenKey((current) => (current === key ? "" : current));
      closeTimer.current = null;
    }, 80);
  }, [cancelClose]);

  const openContextMenu = useCallback(
    (
      item: DisplayEmoji,
      event: ReactMouseEvent<HTMLDivElement>,
      entryKey: string,
    ) => {
      event.preventDefault();
      cancelClose();
      setOpenKey("");
      setPreviewMode(hasAnimatedPreview(item) ? "animated" : "static");
      setMenuKey(entryKey);
    },
    [cancelClose],
  );

  function selectCollection(nextCollection: CollectionName) {
    setCollection(nextCollection);
    setQuery("");
    setOpenKey("");
    setMenuKey("");
  }

  async function runAction(action: () => Promise<void>, successMessage: string) {
    try {
      await action();
      showAppToast(successMessage, "success", 2200);
    } catch (reason) {
      showAppToast(
        reason instanceof Error ? reason.message : "操作失败",
        "danger",
        2800,
      );
    }
  }

  const copyEmoji = useCallback(async (item: DisplayEmoji): Promise<string> => {
    let lastCopyError: unknown;
    try {
      const preparedGif = await prepareGif(item);
      await copyGifBlob(preparedGif.blob, item.name);
      return preparedGif.generated ? "GIF 已生成并复制" : "GIF 复制成功";
    } catch (reason) {
      lastCopyError = reason;
    }

    const fallbackPngPaths = [
      ...pngPathsFor(item),
      ...item.assets
        .filter((asset) => asset.type === QQ_ASSET_TYPE.APNG)
        .map((asset) => asset.path),
    ];
    for (const path of new Set(fallbackPngPaths)) {
      const fallbackPngBlob = await fetchPngBlob(path);
      if (!fallbackPngBlob) continue;
      try {
        await copyPngBlob(fallbackPngBlob);
        return "GIF 无法复制，已改为静态 PNG";
      } catch (reason) {
        lastCopyError = reason;
      }
    }

    if (item.fallbackText) {
      await navigator.clipboard.writeText(item.fallbackText);
      return "文本已复制";
    }
    if (lastCopyError) throw lastCopyError;
    throw new Error("当前表情没有可复制的内容");
  }, []);

  const rememberRecent = useCallback((item: DisplayEmoji) => {
    setRecentKeys((current) => [
      item.key,
      ...current.filter((key) => key !== item.key),
    ].slice(0, MAX_STORED_RECENT));
  }, []);

  const captureViewportAnchor = useCallback(() => {
    const fallbackLeft = window.scrollX;
    const fallbackTop = window.scrollY;
    const grid = emojiGridRef.current;

    if (!grid || fallbackTop <= 1) {
      pendingViewportAnchorRef.current = {
        key: "",
        top: 0,
        fallbackLeft,
        fallbackTop,
      };
      return;
    }

    const anchor = Array.from(
      grid.querySelectorAll<HTMLElement>(
        '.emoji-cell[data-emoji-key]:not([data-recent="true"])',
      ),
    )
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(
        ({ rect }) => rect.bottom > 0 && rect.top < window.innerHeight,
      )
      .sort(
        (a, b) => Math.abs(a.rect.top - 16) - Math.abs(b.rect.top - 16),
      )[0];

    pendingViewportAnchorRef.current = {
      key: anchor?.element.dataset.emojiKey || "",
      top: anchor?.rect.top || 0,
      fallbackLeft,
      fallbackTop,
    };
  }, []);

  const handleQuickCopy = useCallback(
    (item: DisplayEmoji) => {
      void copyEmoji(item)
        .then((message) => {
          suppressHoverRef.current = true;
          captureViewportAnchor();
          setOpenKey("");
          setMenuKey("");
          rememberRecent(item);
          showAppToast(message, "success", 2200);
        })
        .catch((reason: unknown) => {
          showAppToast(
            reason instanceof Error ? reason.message : "复制失败",
            "danger",
            2800,
          );
        });
    },
    [captureViewportAnchor, copyEmoji, rememberRecent],
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
        width="min(260px, calc(100vw - 32px))"
      />
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

              if (!isActive) {
                return (
                  <Fragment key={renderKey}>
                    <EmojiButton
                      item={item}
                      entryKey={renderKey}
                      isRecent={isRecent}
                      isActive={false}
                      isMenuOpen={false}
                      onClose={closePreviewSoon}
                      onContextMenu={openContextMenu}
                      onCopy={handleQuickCopy}
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
                    onClose={closePreviewSoon}
                    onContextMenu={openContextMenu}
                    onCopy={handleQuickCopy}
                    onMove={resumePreviewOnMove}
                    onOpen={openPreview}
                    triggerRef={activeTriggerRef}
                  />

                  {isActive ? (
                    <Popover.Content
                      className={`emoji-popover ${
                        isMenuOpen
                          ? "emoji-popover--expanded emoji-popover--menu"
                          : "emoji-popover--preview"
                      }`}
                      isOpen
                      isNonModal
                      placement="top"
                      offset={7}
                      shouldFlip
                      triggerRef={activeTriggerRef}
                      onOpenChange={(nextOpen) => {
                        if (!nextOpen && isMenuOpen) setMenuKey("");
                      }}
                    >
                      <Popover.Dialog aria-label={`${item.name} 预览`}>
                        <Popover.Arrow>
                          <svg
                            aria-hidden="true"
                            height="12"
                            viewBox="0 0 12 12"
                            width="12"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path d="M0 0C5.48483 8 6.5 8 12 0Z" />
                            <path
                              className="popover-arrow-outline"
                              d="M0 0C5.48483 8 6.5 8 12 0"
                            />
                          </svg>
                        </Popover.Arrow>
                        <div className="preview-media">
                          {lottiePreviewAsset ? (
                            <LottiePreview
                              label={`${item.name} Lottie 动画`}
                              src={assetUrl(lottiePreviewAsset.path)}
                            />
                          ) : previewPath ? (
                            <img
                              key={`${item.key}-${previewMode}`}
                              src={assetUrl(previewPath)}
                              alt={item.name}
                            />
                          ) : (
                            <span
                              className="emoji-glyph emoji-glyph--preview"
                              aria-label={item.name}
                            >
                              {item.fallbackText}
                            </span>
                          )}

                        </div>

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
                                  size="sm"
                                  variant="secondary"
                                  onPress={() => handleQuickCopy(item)}
                                >
                                  <Clipboard size={13} />
                                  复制
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
                                      runAction(
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
                              <details className="source-assets">
                                <summary>
                                  原始文件 · {sourceAssets.length}
                                </summary>
                                <div className="source-list">
                                  {sourceAssets.map((asset, index) => (
                                    <div
                                      className="source-row"
                                      key={`${asset.path}-${index}`}
                                    >
                                      <span>{assetLabel(asset)}</span>
                                      <span title={asset.name}>{asset.name}</span>
                                      <Button
                                        isIconOnly
                                        aria-label={`下载 ${asset.name}`}
                                        size="sm"
                                        variant="tertiary"
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
                                        variant="tertiary"
                                        onPress={() => openAsset(asset.path)}
                                      >
                                        <ExternalLink size={12} />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              </details>
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
      </section>
    </main>
  );
}
