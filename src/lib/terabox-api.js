/**
 * terabox-api.js - TeraBox API 封装 v1.0.0
 * 
 * 纯 API 方式实现转存与分享
 * 使用 bdstoken / jsToken / cookie 认证
 */
const axios = require('axios');
const log = require('./logger');
require('dotenv').config();

const COOKIE_STR = process.env.TERABOX_NDUS || '';
const JSTOKEN = process.env.TERABOX_jsToken || '';
const BDSTOKEN = process.env.TERABOX_bdstoken || '';
const DEST_PATH = process.env.TERABOX_DEST_PATH || '/acgx/';

// 从完整 cookie 字符串中提取 ndus 值
function extractNdus(raw) {
  const m = raw.match(/ndus=([^;]+)/);
  return m ? m[1] : raw;
}

// 从完整 cookie 中提取 csrfToken
function extractCsrf(raw) {
  const m = raw.match(/csrfToken=([^;]+)/);
  return m ? m[1] : '';
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

class TeraBoxApi {
  constructor() {
    this.ndus = extractNdus(COOKIE_STR);
    this.csrf = extractCsrf(COOKIE_STR);
    this.headers = {
      'Cookie': COOKIE_STR,
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
    };
    this.appId = '250528';
  }

  /**
   * 从分享链接提取 surl
   * 例如 https://1024terabox.com/s/1HdCcRDS5H2u5UbuX3uVYZw → 1HdCcRDS5H2u5UbuX3uVYZw
   */
  extractSurl(shareUrl) {
    // /s/1xxxx 格式
    const m1 = shareUrl.match(/\/s\/1([a-zA-Z0-9_-]+)/);
    if (m1) return '1' + m1[1];
    // surl=xxxx 格式
    const m2 = shareUrl.match(/surl=([a-zA-Z0-9_-]+)/);
    if (m2) return m2[1];
    return null;
  }

  /**
   * 获取分享信息（shareid, uk, file列表）
   */
  async getShareInfo(shareUrl) {
    const surl = this.extractSurl(shareUrl);
    if (!surl) throw new Error(`无法解析surl: ${shareUrl}`);

    const shorturl = surl.startsWith('1') ? surl.substring(1) : surl;

    try {
      // 尝试多个域名
      const domains = ['www.terabox.com', 'www.1024terabox.com', 'www.terabox.app'];
      let lastErr = null;

      for (const domain of domains) {
        try {
          const url = `https://${domain}/api/shorturlinfo?app_id=${this.appId}&shorturl=${shorturl}&root=1`;
          const resp = await axios.get(url, {
            headers: { ...this.headers, 'Referer': `https://${domain}/` },
            timeout: 15000,
          });

          if (resp.data.errno === 0) {
            const list = resp.data.list || [];
            return {
              shareid: resp.data.shareid,
              uk: resp.data.uk,
              sign: resp.data.sign || '',
              timestamp: resp.data.timestamp || 0,
              files: list.map(f => ({
                fs_id: f.fs_id,
                filename: f.server_filename,
                path: f.path,
                size: f.size,
                isdir: f.isdir,
              })),
              domain,
            };
          }
          lastErr = `errno=${resp.data.errno}`;
        } catch (e) {
          lastErr = e.message;
        }
      }
      throw new Error(`获取分享信息失败: ${lastErr}`);
    } catch (err) {
      throw new Error(`getShareInfo失败(${shareUrl}): ${err.message}`);
    }
  }

  /**
   * 转存文件到自己网盘
   */
  async transfer(shareInfo, password = '') {
    const { shareid, uk, files, domain } = shareInfo;
    if (!files || files.length === 0) throw new Error('没有可转存的文件');

    const fsIds = files.map(f => f.fs_id);
    const filenames = files.map(f => '/' + f.filename);

    const url = `https://${domain}/share/transfer?shareid=${shareid}&from=${uk}&app_id=${this.appId}&channel=dubox&clienttype=0&web=1`;

    const params = new URLSearchParams();
    params.append('fsidlist', JSON.stringify(fsIds));
    params.append('path', DEST_PATH);

    if (password) {
      params.append('sekey', password);
    }

    try {
      const resp = await axios.post(url, params, {
        headers: {
          ...this.headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `https://${domain}/`,
        },
        timeout: 30000,
      });

      // errno=0 成功, errno=12 已存在
      if (resp.data.errno === 0 || resp.data.errno === 12) {
        const extra = resp.data.extra || {};
        const info = extra.list || [];
        return {
          success: true,
          errno: resp.data.errno,
          transferred: info.map(f => ({ from: f.from, to: f.to, fs_id: f.fs_id })),
          destPath: DEST_PATH,
        };
      }

      throw new Error(`转存失败 errno=${resp.data.errno}: ${JSON.stringify(resp.data)}`);
    } catch (err) {
      if (err.message.includes('转存失败')) throw err;
      throw new Error(`transfer请求失败: ${err.message}`);
    }
  }

  /**
   * 列出网盘目录文件
   */
  async listDir(dirPath = DEST_PATH) {
    const domains = ['www.terabox.com', 'www.1024terabox.com'];
    let lastErr = null;

    for (const domain of domains) {
      try {
        const url = `https://${domain}/api/list?app_id=${this.appId}&dir=${encodeURIComponent(dirPath)}&order=time&desc=1&web=1&page=1&num=1000&channel=dubox&clienttype=0`;
        const resp = await axios.get(url, {
          headers: { ...this.headers, 'Referer': `https://${domain}/` },
          timeout: 15000,
        });

        if (resp.data.errno === 0) {
          return (resp.data.list || []).map(f => ({
            fs_id: f.fs_id,
            filename: f.server_filename,
            path: f.path,
            size: f.size,
            isdir: f.isdir,
            mtime: f.server_mtime,
          }));
        }
        lastErr = `errno=${resp.data.errno}`;
      } catch (e) {
        lastErr = e.message;
      }
    }
    throw new Error(`listDir失败: ${lastErr}`);
  }

  /**
   * 创建公开分享链接
   */
  async createShare(fsIds) {
    if (!Array.isArray(fsIds)) fsIds = [fsIds];
    const domains = ['www.terabox.com', 'www.1024terabox.com'];
    let lastErr = null;

    for (const domain of domains) {
      try {
        const url = `https://${domain}/share/pset?app_id=${this.appId}&web=1&channel=dubox&clienttype=0`;
        const params = new URLSearchParams();
        params.append('fid_list', JSON.stringify(fsIds));
        params.append('schannel', '0');
        params.append('channel_list', '[0]');
        params.append('period', '0');
        params.append('pwd', '');
        params.append('public', '1');

        const resp = await axios.post(url, params, {
          headers: {
            ...this.headers,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': `https://${domain}/main`,
          },
          timeout: 15000,
        });

        // errno=0 成功, errno=110 已分享
        if (resp.data.errno === 0 || resp.data.errno === 110) {
          const link = resp.data.link || resp.data.shorturl || '';
          if (link) return link;
          if (resp.data.errno === 110) return 'ALREADY_SHARED';
        }
        lastErr = `errno=${resp.data.errno}: ${JSON.stringify(resp.data)}`;
      } catch (e) {
        lastErr = e.message;
      }
    }
    throw new Error(`createShare失败: ${lastErr}`);
  }

  /**
   * 查找文件的 fs_id（在网盘目录中按文件名匹配）
   */
  async findFile(filename, dirPath = DEST_PATH) {
    const files = await this.listDir(dirPath);
    return files.find(f => f.filename === filename) || null;
  }
}

module.exports = new TeraBoxApi();
