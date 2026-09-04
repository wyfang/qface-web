import {
  Button,
  Card,
  Chip,
  SearchField,
  Spinner,
} from "@heroui/react";
import {
  Clipboard,
  Download,
  ExternalLink,
  FileJson,
  Image as ImageIcon,
  Images,
  MousePointer2,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LottiePreview } from "./LottiePreview";
import {
  assetUrl,
  convertApngToGif,
  copyAssetLink,
  copyImage,
  downloadAsset,
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

type PreviewMode = "animated" | "static" | "lottie";

function cleanName(value: string | undefined, fallback: string): string {
  return value?.replace(/^\//, "").trim() || fallback;
}

function assetOf(emoji: QqEmoji, type: number): QqAsset | undefined {
  return emoji.assets.find((asset) => asset.type === type);
}

function normalizeQq(items: QqEmoji[]): DisplayEmoji[] {
  return items
    .sort((a, b) => Number(a.emojiId) - Number(b.emojiId))
    .map((item) => {
      const png = assetOf(item, QQ_ASSET_TYPE.PNG);
      const gif = assetOf(item, QQ_ASSET_TYPE.GIF);
      const apng = assetOf(item, QQ_ASSET_TYPE.APNG);
      const name = cleanName(item.describe, `表情 ${item.emojiId}`);
      const staticPath = png?.path || gif?.path || apng?.path || "assets/default.png";

      return {
        key: `qq-${item.emojiId}`,
        id: item.emojiId,
        name,
        collection: "qq",
        staticPath,
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
      const path = item.path || "assets/default.png";
      const name = cleanName(
        item.cnValue || item.twValue || item.enValue,
        `微信表情 ${item.eggIndex}`,
      );
      const asset: QqAsset = {
        type: QQ_ASSET_TYPE.PNG,
        name: item.fileName,
        path,
      };

      return {
        key: `wechat-${item.key}`,
        id: String(item.eggIndex),
        name,
        collection: "wechat",
        staticPath: path,
        associateWords: [],
        assets: [asset],
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
  if (asset.type === QQ_ASSET_TYPE.LOTTIE) return "Lottie JSON";
  return "PNG";
}

export default function App() {
  const [qqItems, setQqItems] = useState<QqEmoji[]>([]);
  const [wechatItems, setWechatItems] = useState<WechatEmoji[]>([]);
  const [collection, setCollection] = useState<CollectionName>("qq");
  const [query, setQuery] = useState("");
  const [lockedKey, setLockedKey] = useState("");
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("animated");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("悬停或点按一个表情以预览");
  const [isConverting, setIsConverting] = useState(false);

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

  const qqEmoji = useMemo(() => normalizeQq(qqItems), [qqItems]);
  const wechatEmoji = useMemo(() => normalizeWechat(wechatItems), [wechatItems]);
  const items = collection === "qq" ? qqEmoji : wechatEmoji;
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return items;
    return items.filter((item) => item.searchText.includes(normalizedQuery));
  }, [items, query]);

  useEffect(() => {
    if (!items.length) return;
    if (!items.some((item) => item.key === lockedKey)) {
      setLockedKey(items[0].key);
    }
  }, [items, lockedKey]);

  const activeKey =
    hoverKey ||
    (filteredItems.some((item) => item.key === lockedKey)
      ? lockedKey
      : filteredItems[0]?.key);
  const activeEmoji = items.find((item) => item.key === activeKey);

  useEffect(() => {
    setPreviewMode("animated");
  }, [activeKey]);

  const pngAsset = activeEmoji?.assets.find(
    (asset) => asset.type === QQ_ASSET_TYPE.PNG,
  );
  const gifAsset = activeEmoji?.assets.find(
    (asset) => asset.type === QQ_ASSET_TYPE.GIF,
  );
  const apngAsset = activeEmoji?.assets.find(
    (asset) => asset.type === QQ_ASSET_TYPE.APNG,
  );
  const lottieAssets =
    activeEmoji?.assets.filter(
      (asset) => asset.type === QQ_ASSET_TYPE.LOTTIE,
    ) || [];
  const activeImagePath =
    previewMode === "static"
      ? activeEmoji?.staticPath
      : activeEmoji?.animatedPath || activeEmoji?.staticPath;

  function selectCollection(nextCollection: CollectionName) {
    setCollection(nextCollection);
    setQuery("");
    setHoverKey(null);
    setLockedKey("");
    setStatus(nextCollection === "qq" ? "已切换到 QQ 表情" : "已切换到微信表情");
  }

  function selectEmoji(item: DisplayEmoji) {
    setLockedKey(item.key);
    setHoverKey(null);
    setStatus(`已选择：${item.name}`);
  }

  async function runAction(action: () => Promise<void>, successMessage: string) {
    try {
      await action();
      setStatus(successMessage);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "操作失败，请稍后重试");
    }
  }

  async function handleConvertGif() {
    if (!activeEmoji || !apngAsset || isConverting) return;
    setIsConverting(true);
    setStatus("正在把 APNG 转换为 GIF…");
    try {
      await convertApngToGif(apngAsset, `${activeEmoji.id}.gif`);
      setStatus("GIF 已生成并开始下载");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "APNG 转 GIF 失败");
    } finally {
      setIsConverting(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
        </div>
        <div>
          <p className="eyebrow">QFace Web</p>
          <h1>表情预览</h1>
          <p className="subtitle">小尺寸浏览，悬停查看动画，点按锁定操作。</p>
        </div>
        <div className="header-stats" aria-label="表情资源统计">
          <Chip color="accent" variant="soft">
            <Chip.Label>{qqEmoji.length} 个 QQ 表情</Chip.Label>
          </Chip>
          <Chip variant="soft">
            <Chip.Label>{wechatEmoji.length} 个微信表情</Chip.Label>
          </Chip>
        </div>
      </header>

      <main>
        {loading ? (
          <Card className="state-card">
            <Card.Content className="state-content">
              <Spinner size="lg" />
              <p>正在载入表情资源…</p>
            </Card.Content>
          </Card>
        ) : error ? (
          <Card className="state-card">
            <Card.Content className="state-content">
              <p>{error}</p>
              <Button variant="secondary" onPress={() => window.location.reload()}>
                <RotateCcw size={16} />
                重新载入
              </Button>
            </Card.Content>
          </Card>
        ) : (
          <>
            <Card className="preview-card" variant="secondary">
              <Card.Content className="preview-card-content">
                <section className="preview-column" aria-label="当前表情预览">
                  <div className="preview-canvas">
                    {activeEmoji && previewMode === "lottie" && lottieAssets[0] ? (
                      <LottiePreview
                        label={`${activeEmoji.name} Lottie 动画`}
                        src={assetUrl(lottieAssets[0].path)}
                      />
                    ) : activeEmoji && activeImagePath ? (
                      <img
                        key={`${activeEmoji.key}-${previewMode}`}
                        src={assetUrl(activeImagePath)}
                        alt={activeEmoji.name}
                      />
                    ) : (
                      <Images aria-hidden="true" size={48} />
                    )}
                  </div>

                  {activeEmoji ? (
                    <div className="quick-actions" aria-label="当前表情快捷操作">
                      {pngAsset ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => {
                            downloadAsset(pngAsset);
                            setStatus("PNG 已开始下载");
                          }}
                        >
                          <Download size={15} />
                          PNG
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() =>
                          runAction(
                            () => copyImage(activeEmoji.staticPath),
                            "静态 PNG 已复制",
                          )
                        }
                      >
                        <Clipboard size={15} />
                        复制图片
                      </Button>
                      {apngAsset ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => {
                            downloadAsset(apngAsset);
                            setStatus("APNG 已开始下载");
                          }}
                        >
                          <Download size={15} />
                          APNG
                        </Button>
                      ) : null}
                      {gifAsset ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => {
                            downloadAsset(gifAsset);
                            setStatus("GIF 已开始下载");
                          }}
                        >
                          <Download size={15} />
                          GIF
                        </Button>
                      ) : apngAsset ? (
                        <Button
                          isPending={isConverting}
                          size="sm"
                          variant="secondary"
                          onPress={handleConvertGif}
                        >
                          <Sparkles size={15} />
                          {isConverting ? "转换中" : "转 GIF"}
                        </Button>
                      ) : null}
                      {apngAsset ? (
                        <Button
                          size="sm"
                          variant="tertiary"
                          onPress={() =>
                            runAction(
                              () => copyAssetLink(apngAsset.path),
                              "APNG 链接已复制",
                            )
                          }
                        >
                          <Clipboard size={15} />
                          APNG 链接
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                <section className="preview-details" aria-live="polite">
                  {activeEmoji ? (
                    <>
                      <div className="preview-heading">
                        <div>
                          <p className="preview-kicker">
                            {activeEmoji.collection === "qq" ? "QQ" : "微信"} · #{activeEmoji.id}
                          </p>
                          <h2>{activeEmoji.name}</h2>
                        </div>
                        <div className="mode-switcher" aria-label="预览格式">
                          <Button
                            isIconOnly
                            aria-label="显示动态预览"
                            size="sm"
                            variant={previewMode === "animated" ? "primary" : "tertiary"}
                            onPress={() => setPreviewMode("animated")}
                          >
                            <Play size={15} />
                          </Button>
                          <Button
                            isIconOnly
                            aria-label="显示静态预览"
                            size="sm"
                            variant={previewMode === "static" ? "primary" : "tertiary"}
                            onPress={() => setPreviewMode("static")}
                          >
                            <ImageIcon size={15} />
                          </Button>
                          {lottieAssets.length ? (
                            <Button
                              isIconOnly
                              aria-label="显示 Lottie 预览"
                              size="sm"
                              variant={previewMode === "lottie" ? "primary" : "tertiary"}
                              onPress={() => setPreviewMode("lottie")}
                            >
                              <FileJson size={15} />
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      <p className="interaction-hint">
                        <MousePointer2 size={15} />
                        网格悬停为临时预览，点按后锁定当前表情。
                      </p>

                      {activeEmoji.associateWords.length ? (
                        <div className="keyword-list" aria-label="关联关键词">
                          {activeEmoji.associateWords.map((word) => (
                            <button key={word} type="button" onClick={() => setQuery(word)}>
                              {word}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <div className="resource-list" aria-label="全部源资源">
                        {activeEmoji.assets.map((asset, index) => (
                          <div className="resource-row" key={`${asset.path}-${index}`}>
                            <span className="resource-type">{assetLabel(asset)}</span>
                            <span className="resource-name">{asset.name}</span>
                            <Button
                              isIconOnly
                              aria-label={`下载 ${asset.name}`}
                              size="sm"
                              variant="tertiary"
                              onPress={() => {
                                downloadAsset(asset);
                                setStatus(`${asset.name} 已开始下载`);
                              }}
                            >
                              <Download size={14} />
                            </Button>
                            <Button
                              isIconOnly
                              aria-label={`打开 ${asset.name}`}
                              size="sm"
                              variant="tertiary"
                              onPress={() => openAsset(asset.path)}
                            >
                              <ExternalLink size={14} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="empty-preview">
                      <h2>没有匹配的表情</h2>
                      <p>请尝试其他关键词。</p>
                    </div>
                  )}
                </section>
              </Card.Content>
            </Card>

            <section className="library-section" aria-labelledby="library-title">
              <div className="library-toolbar">
                <div className="collection-switcher" aria-label="表情来源">
                  <Button
                    size="sm"
                    variant={collection === "qq" ? "primary" : "tertiary"}
                    onPress={() => selectCollection("qq")}
                  >
                    QQ 表情
                  </Button>
                  <Button
                    size="sm"
                    variant={collection === "wechat" ? "primary" : "tertiary"}
                    onPress={() => selectCollection("wechat")}
                  >
                    微信表情
                  </Button>
                </div>

                <SearchField
                  fullWidth
                  aria-label="搜索表情"
                  name="emoji-search"
                  value={query}
                  variant="secondary"
                  onChange={setQuery}
                >
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input placeholder="搜索名称、ID 或关键词" />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
              </div>

              <div className="library-heading">
                <div>
                  <p className="eyebrow">Emoji library</p>
                  <h2 id="library-title">
                    {collection === "qq" ? "QQ 表情" : "微信表情"}
                  </h2>
                </div>
                <span>{filteredItems.length} 个结果</span>
              </div>

              <div className="emoji-grid">
                {filteredItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="emoji-button"
                    data-active={item.key === activeKey || undefined}
                    data-locked={item.key === lockedKey || undefined}
                    title={`${item.name} · #${item.id}`}
                    aria-label={`预览 ${item.name}，编号 ${item.id}`}
                    onClick={() => selectEmoji(item)}
                    onFocus={() => setHoverKey(item.key)}
                    onBlur={() => setHoverKey(null)}
                    onPointerEnter={() => setHoverKey(item.key)}
                    onPointerLeave={() => setHoverKey(null)}
                  >
                    <img
                      src={assetUrl(item.staticPath)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      <div className="status-bar" role="status" aria-live="polite">
        {status}
      </div>

      <footer>
        <p>基于 QFace 二次开发，仅供非商业学习与交流。</p>
        <a href="https://github.com/koishijs/QFace" target="_blank" rel="noreferrer">
          上游项目
          <ExternalLink size={13} />
        </a>
      </footer>
    </div>
  );
}
