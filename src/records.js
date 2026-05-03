/**
 * records.js - 记录表管理模块 v1.0.0
 * 
 * JSON 格式记录表，支持增删改查和查重
 * 记录结构: { postId, title, postUrl, originalLink, newLink, status }
 */
const fs = require('fs');
const path = require('path');
const log = require('./lib/logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');

// 状态常量
const STATUS = {
  PENDING: '待处理',
  CRAWLED: '已采集',
  TRANSFERRED: '已转存',
  SHARED: '已分享',
  REPLACED: '已替换',
  FAILED_TRANSFER: '转存失败',
  FAILED_SHARE: '分享失败',
  FAILED_REPLACE: '替换失败',
  SKIPPED: '跳过',
};

class Records {
  constructor() {
    this.data = [];
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  load() {
    if (fs.existsSync(RECORDS_FILE)) {
      this.data = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8'));
    } else {
      this.data = [];
    }
    return this.data;
  }

  save() {
    this._ensureDir();
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(this.data, null, 2), 'utf8');
  }

  /**
   * 查重：以 postId + originalLink 为唯一键
   */
  exists(postId, originalLink) {
    return this.data.some(r => String(r.postId) === String(postId) && (r.originalLink === originalLink || r.newLink === originalLink));
  }

  /**
   * 检查新链接是否已存在（防止采集到已经替换过的链接）
   */
  existsAsNew(newLink) {
    return this.data.some(r => r.newLink === newLink);
  }

  /**
   * 添加记录（自动查重）
   */
  add(record) {
    const pid = String(record.postId);
    if (this.exists(pid, record.originalLink)) return false;
    this.data.push({
      postId: pid,
      title: record.title || '',
      postUrl: record.postUrl || '',
      originalLink: record.originalLink || '',
      newLink: record.newLink || '',
      status: record.status || STATUS.CRAWLED,
      password: record.password || '',
      error: '',
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  /**
   * 更新记录字段
   */
  update(postId, originalLink, fields) {
    const idx = this.data.findIndex(r => String(r.postId) === String(postId) && r.originalLink === originalLink);
    if (idx === -1) return false;
    Object.assign(this.data[idx], fields, { updatedAt: new Date().toISOString() });
    return true;
  }

  /**
   * 删除记录
   */
  remove(postId, originalLink) {
    const idx = this.data.findIndex(r => String(r.postId) === String(postId) && r.originalLink === originalLink);
    if (idx === -1) return false;
    this.data.splice(idx, 1);
    return true;
  }


  /**
   * 按状态筛选
   */
  filterByStatus(status) {
    return this.data.filter(r => r.status === status);
  }

  /**
   * 获取统计信息
   */
  stats() {
    const total = this.data.length;
    const grouped = {};
    this.data.forEach(r => {
      grouped[r.status] = (grouped[r.status] || 0) + 1;
    });
    return { total, ...grouped };
  }

  /**
   * 导出为 CSV
   */
  exportCsv(filePath) {
    const header = '文章ID,标题,文章URL,原网盘链接,新网盘链接,状态';
    const rows = this.data.map(r =>
      `${r.postId},"${(r.title || '').replace(/"/g, '""')}",${r.postUrl},${r.originalLink},${r.newLink},${r.status}`
    );
    fs.writeFileSync(filePath || path.join(DATA_DIR, 'records.csv'), '\ufeff' + header + '\n' + rows.join('\n'), 'utf8');
  }

  /**
   * 从旧版 all_links_table.json 导入
   */
  importFromOld(jsonPath) {
    if (!fs.existsSync(jsonPath)) {
      log.warn(`旧数据文件不存在: ${jsonPath}`);
      return 0;
    }
    const old = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    let count = 0;
    for (const item of old) {
      const added = this.add({
        postId: item.postId,
        title: item.title,
        postUrl: item.postUrl,
        originalLink: item.originalLink,
        newLink: item.newLink || '',
        password: item.password || '',
        status: item.newLink ? STATUS.SHARED : STATUS.CRAWLED,
      });
      if (added) count++;
    }
    return count;
  }
}

Records.STATUS = STATUS;
module.exports = Records;
