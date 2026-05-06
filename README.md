# TeraBox 网盘助手 (TeraBox Tool) v2.4.0

[中文文档](./README-zh.md)

An automated resource transfer and link replacement tool developed specifically for WordPress sites using TeraBox (formerly BaiduNetdisk Overseas). It eliminates the tedious manual process of migrating large volumes of cloud storage links.

## 🌟 Key Features

- **Automated Crawling**: Deep integration with WordPress REST API to automatically identify and extract TeraBox download links from specified fields (e.g., `xun_post_download`).
- **High-Efficiency Transfer**: Leverages the TeraBox HTTP API to batch transfer shared resources to your own cloud storage directory in seconds.
- **One-Click Sharing**: Automatically generates new public share links for transferred files, with support for custom extraction codes.
- **Back-Write Replacement**: Automatically writes the newly generated share links back to the corresponding WordPress posts, achieving silent link updates.
- **Workflow Automation**: Supports one-click serial execution of the full pipeline: `crawl → sync_filename → transfer → share → replace`.
- **Modern UI Panel**: Built-in management dashboard developed with Vue 3, featuring real-time status monitoring, log viewing, manual editing, and batch task management.
- **Login Authentication**: JWT-based authentication system with bcryptjs password hashing.
- **Settings Dashboard**: Web-based configuration for WordPress and TeraBox credentials, changes take effect immediately.
- **Cron Scheduling**: Support cron expressions for fully automated pipeline execution.
- **Account Verification**: Automatic credential validation before running any task to prevent runtime failures.
- **Encrypted Storage**: Sensitive settings (passwords, tokens) encrypted with AES-256-GCM on disk.
- **Backup & Restore**: One-click export/import of all settings and records via Web UI.
- **Log Rotation**: Automatic daily log file rotation with 7-day retention.
- **Security Hardening**: Non-root Docker execution, restricted CORS, JWT secret persistence, SRI-protected frontend assets.

## 🛠️ Tech Stack

- **Backend**: Node.js + Express + node-cron
- **Frontend**: Vue 3.5 (CDN, SRI locked) + Vanilla CSS (Dark Theme)
- **API**: TeraBox REST API + WordPress REST API
- **Auth**: JWT (jsonwebtoken) + bcryptjs
- **Data**: JSON local storage, automatic backup on save, AES-256-GCM encrypted credentials

## 🚀 Quick Start

### 1. Prerequisites

Ensure [Node.js](https://nodejs.org/) is installed (v16+ recommended), or use Docker.

### 2. Option A — Docker Deployment (Recommended)

```bash
git clone https://github.com/wwvvv/teraboxtool.git
cd teraboxtool
docker compose up -d
```

Visit `http://localhost:3721` to access the management panel.

### 3. Option B — Manual Setup

```bash
npm install
npm run dev
```

Visit `http://localhost:3721` to access the management panel.

### 4. First-Time Setup

On first visit, you will be prompted to set a login password (minimum 4 characters). Use this password for all subsequent logins.

### 5. CLI Commands

- **Full Workflow**: `node src/main.js run`
- **Crawl Only**: `node src/main.js crawl`
- **Sync File Names**: `node src/main.js sync_filename`
- **Transfer Only**: `node src/main.js transfer`
- **Share Only**: `node src/main.js share`
- **Replace Only**: `node src/main.js replace`
- **Import Legacy Data**: `node src/main.js import`

## 🔒 Security

- Passwords hashed with bcryptjs (legacy SHA-256 hashes auto-migrated on verify)
- JWT secrets persisted across restarts (no forced re-login)
- Sensitive credentials encrypted at rest with AES-256-GCM
- API responses mask secret fields (wpPassword, teraboxCookie, etc.)
- CORS restricted to same-origin
- Docker container runs as non-root user
- Port bound to 127.0.0.1 by default in docker-compose
- Frontend assets loaded with SRI integrity verification

## 📝 License

ISC License
