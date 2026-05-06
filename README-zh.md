# TeraBox 网盘助手 (TeraBox Tool) v2.4.0

[English Documentation](./README.md)

一款专为 WordPress 站点开发的 TeraBox (原百度网盘海外版) 资源自动化转存与链接替换工具。旨在解决手动迁移海量网盘链接的繁琐流程。

## 🌟 核心功能

- **自动化采集**: 深度对接 WordPress REST API，自动识别并提取文章中指定字段（如 `xun_post_download`）的 TeraBox 下载链接。
- **高效转存**: 利用 TeraBox HTTP API，实现将他人分享的资源秒级批量转存至自己的网盘指定目录。
- **一键分享**: 自动为已转存的文件生成新的公开分享链接，支持自定义提取码（如有）。
- **回写替换**: 将生成的全新分享链接自动回写至对应的 WordPress 文章，实现链接的静默更新。
- **全流程自动化**: 支持 `crawl → sync_filename → transfer → share → replace` 一键全串行运行。
- **现代化 UI 面板**: 内置 Vue 3 开发的管理后台，支持实时状态监控、日志查看、手动编辑及批量任务管理。
- **登录认证系统**: JWT 登录认证 + bcryptjs 密码哈希，首次访问需设置密码，保障管理面板安全。
- **Web 设置面板**: 支持图形化修改 WordPress 和 TeraBox 认证配置，修改即时生效，无需重启。
- **Cron 定时任务**: 支持标准 cron 表达式，自定义全流程定时自动执行。
- **账号前置检查**: 所有任务执行前自动验证 TeraBox 账号有效性，异常时自动阻止并告警。
- **凭据加密存储**: 敏感配置（密码、Cookie、Token）使用 AES-256-GCM 加密存储，磁盘数据安全。
- **数据备份恢复**: Web 面板一键导出/导入全部配置与记录数据。
- **日志轮转**: 按日期自动分割日志文件，保留 7 天自动清理。
- **Docker 容器化**: 非 root 用户运行，端口默认绑定 127.0.0.1，安全加固。

## 🛠️ 技术栈

- **后端**: Node.js + Express + node-cron
- **前端**: Vue 3.5 (CDN, SRI 锁定) + Vanilla CSS (暗色主题)
- **API**: TeraBox REST API + WordPress REST API
- **认证**: JWT (jsonwebtoken) + bcryptjs
- **数据**: JSON 本地持久化存储，自动备份，AES-256-GCM 凭据加密

## 🚀 快速开始

### 1. 环境准备

确保已安装 [Node.js](https://nodejs.org/) (推荐 v16+)，或使用 Docker。

### 2. 方式 A — Docker 部署 (推荐)

```bash
git clone https://github.com/wwvvv/teraboxtool.git
cd teraboxtool
docker compose up -d
```

访问 `http://localhost:3721` 即可进入管理面板。

### 3. 方式 B — 手动部署

```bash
npm install
npm run dev
```

访问 `http://localhost:3721` 即可进入管理面板。

### 4. 首次使用

首次访问时会提示设置登录密码（至少 4 位），后续使用该密码登录。

### 5. 命令行执行 (CLI)

- **全流程运行**: `node src/main.js run`
- **仅采集**: `node src/main.js crawl`
- **同步文件名**: `node src/main.js sync_filename`
- **仅转存**: `node src/main.js transfer`
- **仅分享**: `node src/main.js share`
- **仅替换**: `node src/main.js replace`
- **导入旧数据**: `node src/main.js import`

## 🔒 安全说明

- 密码使用 bcryptjs 哈希存储（旧 SHA-256 哈希在验证时自动迁移）
- JWT 密钥持久化保存，重启服务不强制重新登录
- 敏感凭据使用 AES-256-GCM 加密存储
- API 响应中敏感字段自动脱敏
- CORS 限制为同源请求
- Docker 以非 root 用户运行
- docker-compose 默认绑定 127.0.0.1
- 前端资源启用 SRI 完整性校验

## 📝 许可证

ISC License
