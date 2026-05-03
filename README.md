# TeraBox Link Replacer Tool (TeraBox Tool) v1.3.0

[中文文档](./README-zh.md)

An automated resource transfer and link replacement tool developed specifically for WordPress sites using TeraBox (formerly BaiduNetdisk Overseas). It aims to eliminate the tedious manual process of migrating large volumes of cloud storage links.

## 🌟 Key Features

- **Automated Crawling**: Deep integration with WordPress REST API to automatically identify and extract TeraBox download links from specified fields (e.g., `xun_post_download`).
- **High-Efficiency Transfer**: Leverages the TeraBox HTTP API to batch transfer shared resources to your own cloud storage directory in seconds.
- **One-Click Sharing**: Automatically generates new public share links for transferred files, with support for custom extraction codes.
- **Back-Write Replacement**: Automatically writes the newly generated share links back to the corresponding WordPress posts, achieving silent link updates.
- **Workflow Automation**: Supports one-click serial execution of the full pipeline: `crawl -> transfer -> share -> replace`.
- **Modern UI Panel**: Built-in management dashboard developed with Vue 3, featuring real-time status monitoring, log viewing, manual editing, and batch task management.

## 🛠️ Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vue 3 (CDN) + Vanilla CSS (Aesthetic Dark Theme)
- **API**: TeraBox REST API + WordPress REST API
- **Data**: Local JSON persistence

## 🚀 Quick Start

### 1. Prerequisites
Ensure [Node.js](https://nodejs.org/) is installed (v16+ recommended).

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create a `.env` file in the root directory and fill in the following information:

```env
# WordPress Configuration
WP_BASE_URL=https://your-site.com
WP_USERNAME=your_admin_user
WP_PASSWORD=your_application_password
WP_AUTHOR_ID=5  # Author ID for crawling posts

# TeraBox Configuration
TERABOX_NDUS=ndus=your_cookie_here; ...
TERABOX_jsToken=your_jstoken_here
TERABOX_bdstoken=your_bdstoken_here
TERABOX_DEST_PATH=/acgx/  # Destination path for transfers
```

### 4. Running the Tool

#### A. Web Management Panel (Recommended)
```bash
npm run dev
```
Visit `http://localhost:3721` to access the graphical interface for task operations.

#### B. Command Line Interface (CLI)
- **Full Workflow**: `node src/main.js run`
- **Crawl Only**: `node src/main.js crawl`
- **Transfer Only**: `node src/main.js transfer`
- **Share Only**: `node src/main.js share`
- **Replace Only**: `node src/main.js replace`
- **Import Legacy Data**: `node src/main.js import`

## 📅 Change Log (v1.3.0)

- **Force Stop**: Added a "🛑 Stop Task" button to interrupt ongoing tasks at any time.
- **Manual Edit**: Supports manual modification of links, passwords, and statuses via the UI.
- **Selection Support**: Choose specific records for targeted batch operations.
- **Status Tracking**: Multi-state tracking (Pending, Crawled, Transferred, Shared, Replaced, Failed).

## 📝 License

ISC License