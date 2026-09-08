# QFace Web

An emoji preview website derived from QFace, with a compact static grid and animated previews on hover.

[Open app](https://play.wangyifang.com/qface-web/) · [Upstream project](https://github.com/koishijs/QFace) · [简体中文](./README.md)

## Features

- Browse small static PNG thumbnails to reduce distracting animation and resource use.
- Show an animated preview above the grid on hover or keyboard focus; click or tap to pin an emoji.
- Search QQ emoji by name, number, or related terms, and switch to the WeChat collection.
- Download PNG, APNG, GIF, and Lottie JSON files, or open individual source files.
- Copy static PNG images or APNG links, and convert APNG to GIF in the browser before downloading.

## Usage

Requires Node.js 22.12 or later and pnpm 10.16.1.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Build and preview:

```bash
pnpm build
pnpm preview
```

Build output is written to `dist/`, with the deployment base path `/qface-web/`.

## Notes

### Deployment

This repository maintains the production source. Compiled static files are synchronized to the adjacent `play.wangyifang.com/qface-web/` directory. Pushing the `main` branch of the `play.wangyifang.com` repository triggers deployment through Cloudflare Workers Builds.

### Resources and runtime

Emoji update scripts read local QQ or WeChat installation directories and only work in their corresponding local environments. The website itself needs no backend, account, or database. Emoji files are served directly by Cloudflare Static Assets.

## License

This project is derived from [koishijs/QFace](https://github.com/koishijs/QFace) and retains the upstream MIT license and copyright notice. The code license does not cover QQ or WeChat names or emoji assets. Emoji assets belong to Tencent; this project is intended only for non-commercial learning and communication.

This branch starts from upstream revision `f835d447fb5eb4aa9ae733f31d90cdd6d5589093`. It replaces the Vue documentation interface with React and HeroUI and adds static thumbnails, hover previews, and a consolidated resource action panel.

The copyright notice for upstream author Shigma is preserved in [LICENSE](./LICENSE). See [NOTICE](./NOTICE) for modifications and attribution, and [LICENSE_SCOPE.md](./LICENSE_SCOPE.md) for detailed boundaries.
