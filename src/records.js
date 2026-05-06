/**
 * records.js - 记录表管理模块 v2.0.0
 * 
 * JSON 格式记录表，支持增删改查和查重
 * 记录结构: { postId, title, postUrl, originalLink, fileName, downloadUrl, newLink, status }
 */
const fs = require('fs');
const path = require('path');
const log = require('./lib/logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');
const RECORDS_BAK = path.join(DATA_DIR, 'records.json.bak');

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
  DELETED: '已删除',
  INVALID: '资源失效',
};

class Records {
  constructor() {
    this.data = [];
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  /**
   * 加载记录并自动迁移旧格式（fileNames[] → fileName）
   */
  load() {
    if (fs.existsSync(RECORDS_FILE)) {
      this.data = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8'));
      // 自动迁移旧格式
      let migrated = false;
      for (const r of this.data) {
        // fileNames[] → fileName
        if (r.fileNames && Array.isArray(r.fileNames) && r.fileNames.length > 0 && !r.fileName) {
          r.fileName = r.fileNames[0];
          migrated = true;
        }
        // 确保新字段存在
        if (r.fileName === undefined) r.fileName = '';
        if (r.downloadUrl === undefined) r.downloadUrl = '';
        // 清理旧字段
        if (r.fileNames !== undefined) {
          delete r.fileNames;
          migrated = true;
        }
      }
      if (migrated) {
        this.save();
      }
    } else {
      this.data = [];
    }
    return this.data;
  }

  save() {
    this._ensureDir();
    if (fs.existsSync(RECORDS_FILE)) {
      fs.copyFileSync(RECORDS_FILE, RECORDS_BAK);
    }
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(this.data, null, 2), 'utf8');
  }

  /**
   * 查重：以 postId 为唯一键（同一文章ID不重复采集）
   */
  existsByPostId(postId) {
    return this.data.some(r => String(r.postId) === String(postId));
  }

  /**
   * 查重：以 postId + originalLink 为唯一键（兼容旧逻辑）
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
   * 按文件名查找已有记录（用于转存/分享查重）
   */
  findByFileName(fileName) {
    if (!fileName) return null;
    return this.data.find(r =>
      r.fileName === fileName &&
      (r.status === STATUS.TRANSFERRED || r.status === STATUS.SHARED || r.status === STATUS.REPLACED)
    );
  }

  /**
   * 按文件名查找所有匹配记录
   */
  findAllByFileName(fileName) {
    if (!fileName) return [];
    return this.data.filter(r => r.fileName === fileName);
  }

  /**
   * 添加记录（以 postId 查重）
   */
  add(record) {
    const pid = String(record.postId);
    if (this.exists(pid, record.originalLink)) return false;
    this.data.push({
      postId: pid,
      title: record.title || '',
      postUrl: record.postUrl || '',
      originalLink: record.originalLink || '',
      fileName: record.fileName || '',
      downloadUrl: record.downloadUrl || '',
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
    
    // 已采集数: 统计采集的ID (去重的 postId)
    const crawledIds = new Set(this.data.map(r => r.postId)).size;
    
    // 已转存: 统计成功转存的资源 (去重的 fileName，状态>=已转存)
    const transferredResources = new Set(
      this.data.filter(r => ['已转存', '已分享', '已替换'].includes(r.status) && r.fileName).map(r => r.fileName)
    ).size;
    
    // 已分享: 统计新链接数 (去重的 newLink)
    const sharedLinks = new Set(
      this.data.filter(r => r.newLink).map(r => r.newLink)
    ).size;
    
    // 已替换: 成功替换并更新的文章数 (去重的 postId，状态为已替换)
    const replacedPosts = new Set(
      this.data.filter(r => r.status === '已替换').map(r => r.postId)
    ).size;
    
    // 失败: 统计 "error" 值 (只要 error 有值即算失败)
    const failedCount = this.data.filter(r => !!r.error).length;

    // 保留原始的状态统计，以便其他可能的地方用到
    const grouped = {};
    this.data.forEach(r => {
      grouped[r.status] = (grouped[r.status] || 0) + 1;
    });

    return { 
      total, 
      ...grouped,
      '已采集': crawledIds,
      '已转存': transferredResources,
      '已分享': sharedLinks,
      '已替换': replacedPosts,
      '失败': failedCount
    };
  }

  /**
   * 批量重置状态
   * @param {string} targetStatus - 目标状态（已采集 or 已转存）
   * @param {Array} ids - 可选，指定要重置的记录 [{postId, originalLink}]
   */
  resetStatus(targetStatus = STATUS.CRAWLED, ids = null) {
    let count = 0;
    for (const r of this.data) {
      // 如果指定了 ids，只重置匹配的记录
      if (ids && !ids.some(id => String(id.postId) === String(r.postId) && id.originalLink === r.originalLink)) {
        continue;
      }
      if (targetStatus === STATUS.CRAWLED) {
        r.status = STATUS.CRAWLED;
        r.newLink = '';
        r.error = '';
        // 保留 fileName
      } else if (targetStatus === STATUS.TRANSFERRED) {
        r.status = STATUS.TRANSFERRED;
        r.newLink = '';
        r.error = '';
      } else if (targetStatus === STATUS.SHARED) {
        // 重置到已分享：通常用于重新执行替换任务
        r.status = STATUS.SHARED;
        r.error = '';
        // 如果是从已替换重置回来，需要还原 downloadUrl 以便重新触发替换
        if (r.downloadUrl && r.downloadUrl === r.newLink) {
          r.downloadUrl = r.originalLink;
        }
      }
      r.updatedAt = new Date().toISOString();
      count++;
    }
    return count;
  }

  /**
   * 导出为 CSV
   */
  exportCsv(filePath) {
    const header = '文章ID,标题,文章URL,原网盘链接,文件名,下载地址,新网盘链接,状态';
    const rows = this.data.map(r =>
      `${r.postId},"${(r.title || '').replace(/"/g, '""')}",${r.postUrl},${r.originalLink},"${(r.fileName || '').replace(/"/g, '""')}",${r.downloadUrl || ''},${r.newLink},${r.status}`
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
        fileName: item.fileName || (item.fileNames && item.fileNames[0]) || '',
        downloadUrl: item.downloadUrl || '',
        status: item.newLink ? STATUS.SHARED : STATUS.CRAWLED,
      });
      if (added) count++;
    }
    return count;
  }
}

Records.STATUS = STATUS;
module.exports = Records;
