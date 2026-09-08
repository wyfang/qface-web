# QFace Web

基于 QFace 二次开发的轻量表情预览网页，使用小尺寸静态表情网格与悬停动态预览。

[在线使用](https://play.wangyifang.com/qface-web/) · [上游项目](https://github.com/koishijs/QFace) · [English](./README.en.md)

## 功能

- 默认使用静态 PNG 小图浏览，减少动画干扰和资源消耗。
- 鼠标悬停或键盘聚焦时在上方显示动态预览，点按可锁定当前表情。
- 支持按名称、编号和关联词搜索 QQ 表情，并可切换微信表情集合。
- 支持下载 PNG、APNG、GIF 和 Lottie JSON，打开单个源文件。
- 支持复制静态 PNG、复制 APNG 链接，以及在浏览器中将 APNG 转换为 GIF 后下载。

## 使用

需要 Node.js 22.12 或更高版本和 pnpm 10.16.1。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

生产构建：

```bash
pnpm build
pnpm preview
```

构建产物位于 `dist/`，站点部署路径为 `/qface-web/`。

## 说明

### 部署

生产源码保存在本仓库；编译后的静态文件同步到相邻的 `play.wangyifang.com/qface-web/` 目录。
`play.wangyifang.com` 仓库的 `main` 分支推送后，由 Cloudflare Workers Builds 自动部署。

### 资源与运行

表情资源更新脚本会读取本机 QQ 或微信安装目录，仅适用于对应的本机环境。站点本身不需要
后端、账号或数据库，表情文件由 Cloudflare Static Assets 直接提供。

## 版权说明

本项目基于 [koishijs/QFace](https://github.com/koishijs/QFace) 二次开发，保留上游 MIT
许可证与版权声明。代码许可证不覆盖 QQ、微信名称及表情资源；表情资源版权归腾讯公司所有，
本项目仅供非商业学习与交流。本分支从上游提交 `f835d447fb5eb4aa9ae733f31d90cdd6d5589093` 开始，将原有 Vue 文档界面替换为 React 与 HeroUI，并加入静态缩略图、悬停预览与统一资源操作面板。

上游作者 Shigma 的版权声明保留在 [LICENSE](./LICENSE)；修改归属见 [NOTICE](./NOTICE)，详细边界见 [LICENSE_SCOPE.md](./LICENSE_SCOPE.md)。
