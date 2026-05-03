# TeraBox 链接替换工具 (TeraBox Tool) v1.3.0

[English Documentation](./README.md)

一款专为 WordPress 站点开发的 TeraBox (原百度网盘海外版) 资源自动化转存与链接替换工具。旨在解决手动迁移海量网盘链接的繁琐流程。

## 🌟 核心功能

- **自动化采集**: 深度对接 WordPress REST API，自动识别并提取文章中指定字段（如 `xun_post_download`）的 TeraBox 下载链接。
- **高效转存**: 利用 TeraBox HTTP API，实现将他人分享的资源秒级批量转存至自己的网盘指定目录。
- **一键分享**: 自动为已转存的文件生成新的公开分享链接，支持自定义提取码（如有）。
- **回写替换**: 将生成的全新分享链接自动回写至对应的 WordPress 文章，实现链接的静默更新。
- **全流程自动化**: 支持 `crawl -> transfer -> share -> replace` 一键全串行运行。
- **现代化 UI 面板**: 内置 Vue 3 开发的管理后台，支持实时状态监控、日志查看、手动编辑及批量任务管理。

## 🛠️ 技术栈

- **后端**: Node.js + Express
- **前端**: Vue 3 (CDN) + Vanilla CSS (Aesthetic Dark Theme)
- **API**: TeraBox REST API + WordPress REST API
- **数据**: JSON 本地持久化存储

## 🚀 快速开始

### 1. 环境准备
确保已安装 [Node.js](https://nodejs.org/) (推荐 v16+)。

### 2. 安装依赖
```bash
npm install
```

### 3. 配置环境变量
在根目录创建 `.env` 文件，并填写以下信息：

```env
# WordPress 配置
WP_BASE_URL=https://your-site.com
WP_USERNAME=your_admin_user
WP_PASSWORD=your_application_password
WP_AUTHOR_ID=5  # 采集的文章作者ID

# TeraBox 配置
TERABOX_NDUS=ndus=your_cookie_here; ...
TERABOX_jsToken=your_jstoken_here
TERABOX_bdstoken=your_bdstoken_here
TERABOX_DEST_PATH=/acgx/  # 转存的目标路径
```

### 4. 运行方式

#### A. Web 管理面板 (推荐)
```bash
npm run dev
```
访问 `http://localhost:3721` 即可进入图形化界面进行任务操作。

#### B. 命令行执行 (CLI)
- **全流程运行**: `node src/main.js run`
- **仅采集**: `node src/main.js crawl`
- **仅转存**: `node src/main.js transfer`
- **仅分享**: `node src/main.js share`
- **仅替换**: `node src/main.js replace`
- **导入旧数据**: `node src/main.js import`

## 📅 版本更新记录 (v1.3.0)

- **强行终止**: 新增“🛑 停止任务”功能，可随时中断任务。
- **手动编辑**: 支持在 UI 界面手动修改记录的链接、提取码及任务状态。
- **选中处理**: 支持勾选特定记录进行针对性的批量操作。
- **状态追踪**: 引入 待处理、已采集、已转存、已分享、已替换、失败等多种状态追踪。

## 📝 许可证

ISC License