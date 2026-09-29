export const QQ_ASSET_TYPE = {
  PNG: 0,
  GIF: 1,
  APNG: 2,
  LOTTIE: 3,
} as const;

export type QqAssetType = (typeof QQ_ASSET_TYPE)[keyof typeof QQ_ASSET_TYPE];

export interface QqAsset {
  type: QqAssetType;
  name: string;
  path: string;
}

export interface QqEmoji {
  emojiId: string;
  describe: string;
  associateWords: string[];
  isHide: boolean;
  animationWidth: number;
  animationHeigh: number;
  assets: QqAsset[];
}

export interface WechatEmoji {
  key: string;
  cnValue: string;
  qqValue: string;
  enValue: string;
  twValue: string;
  thValue: string;
  fileName: string;
  eggIndex: number;
  path?: string;
}

export type CollectionName = "qq" | "wechat";

export interface DisplayEmoji {
  key: string;
  id: string;
  name: string;
  collection: CollectionName;
  staticPath?: string;
  fallbackText?: string;
  animatedPath?: string;
  associateWords: string[];
  assets: QqAsset[];
  width?: number;
  height?: number;
  searchText: string;
}
