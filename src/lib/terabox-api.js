/**
 * terabox-api.js - TeraBox API 封装 v2.0.0
 *
 * 接口分类：
 * - 公开接口（share/list）：不需要 jsToken/bdstoken/Cookie，不带认证反而更稳定
 * - 私有接口（share/transfer, api/list, share/pset）：需要 Cookie 认证
 */
const axios = require('axios');
const log = require('./logger');
require('dotenv').config();

const COOKIE_STR = process.env.TERABOX_COOKIE || process.env.TERABOX_NDUS || '';
const JSTOKEN = process.env.TERABOX_jsToken || '';
const BDSTOKEN = process.env.TERABOX_bdstoken || '';
const DEST_PATH = process.env.TERABOX_DEST_PATH || '/acgx/';

function extractNdus(raw) {
  const m = raw.match(/ndus=([^;]+)/);
  return m ? m[1] : raw;
}

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
      'Cookie': COOKIE_STR + '; PANWEB=1',
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
    };
    this.appId = '250528';
  }

  getBaseQuery() {
    return `app_id=${this.appId}&web=1&channel=dubox&clienttype=0&jsToken=${encodeURIComponent(JSTOKEN)}&bdstoken=${encodeURIComponent(BDSTOKEN)}`;
  }

  extractSurl(shareUrl) {
    const m1 = shareUrl.match(/\/s\/1([a-zA-Z0-9_-]+)/);
    if (m1) return '1' + m1[1];
    const m2 = shareUrl.match(/surl=([a-zA-Z0-9_-]+)/);
    if (m2) return m2[1];
    return null;
  }

  /**
   * 获取分享信息（shareid, uk, file列表）
   * 公开接口：不带 jsToken/bdstoken/Cookie，避免触发验证
   */
  async getShareInfo(shareUrl, password = '') {
    const surl = this.extractSurl(shareUrl);
    if (!surl) throw new Error(`无法解析surl: ${shareUrl}`);

    let shorturl = surl;
    if (shorturl.startsWith('1')) {
      shorturl = shorturl.substring(1);
    }

    try {
      const domains = ['www.terabox.app', 'www.terabox.com', 'www.1024terabox.com'];
      let lastErr = null;

      for (const domain of domains) {
        try {
          const url = `https://${domain}/share/list?app_id=${this.appId}&web=1&channel=dubox&clienttype=0&shorturl=${shorturl}&root=1&page=1`;
          let resp = await axios.get(url, {
            headers: {
              'User-Agent': UA,
              'Accept': 'application/json, text/plain, */*',
              'Referer': `https://${domain}/`,
            },
            timeout: 15000,
          });

          if ([ -9, -18, 400141 ].includes(resp.data.errno) && password) {
            const verifyUrl = `https://${domain}/share/verify?app_id=${this.appId}&web=1&channel=dubox&clienttype=0&shorturl=${shorturl}&shareid=${resp.data.shareid || resp.data.share_id || ''}&uk=${resp.data.uk || ''}`;
            const verifyParams = new URLSearchParams();
            verifyParams.append('pwd', password);
            verifyParams.append('vcode', '');
            verifyParams.append('vcode_str', '');
            await axios.post(verifyUrl, verifyParams, {
              headers: {
                'User-Agent': UA,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': `https://${domain}/`,
              },
              timeout: 15000,
            });
            resp = await axios.get(url, {
              headers: {
                'User-Agent': UA,
                'Accept': 'application/json, text/plain, */*',
                'Referer': `https://${domain}/`,
              },
              timeout: 15000,
            });
          }

          if (resp.data.errno === 0) {
            const list = resp.data.list || [];
            log.info(`[API] getShareInfo ${domain} 成功, ${list.length} 个文件`);
            return {
              shareid: resp.data.shareid || resp.data.share_id,
              uk: resp.data.uk,
              sign: resp.data.sign || '',
              timestamp: resp.data.timestamp || resp.data.server_time || 0,
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
          log.warn(`[API] getShareInfo ${domain} errno=${resp.data.errno} (${resp.data.errmsg || ''})`);
          lastErr = `errno=${resp.data.errno}`;
        } catch (e) {
          log.warn(`[API] getShareInfo ${domain} 请求失败: ${e.message}`);
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
   * 需要认证：尝试所有域名 + 带/不带认证参数
   */
  async transfer(shareInfo, password = '') {
    const { shareid, uk, files, domain } = shareInfo;
    if (!files || files.length === 0) throw new Error('没有可转存的文件');

    const fsIds = files.map(f => f.fs_id);

    const transferDomains = ['www.terabox.app', 'www.terabox.com', 'www.1024terabox.com'];
    let lastErr = null;

    for (const td of transferDomains) {
      const url = `https://${td}/share/transfer?${this.getBaseQuery()}&shareid=${shareid}&from=${uk}&ondup=newcopy`;
      const params = new URLSearchParams();
      params.append('fsidlist', JSON.stringify(fsIds));
      params.append('path', DEST_PATH);

      try {
        const resp = await axios.post(url, params, {
          headers: {
            ...this.headers,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': `https://${td}/`,
          },
          timeout: 30000,
        });

        if (resp.data.errno === 0 || resp.data.errno === 4 || resp.data.errno === 12) {
          const extra = resp.data.extra || {};
          const info = extra.list || [];
          log.info(`[API] transfer ${td} 成功, errno=${resp.data.errno}`);
          return {
            success: true,
            errno: resp.data.errno,
            transferred: info.map(f => ({ from: f.from, to: f.to, fs_id: f.fs_id })),
            destPath: DEST_PATH,
          };
        }

        lastErr = `errno=${resp.data.errno} (${resp.data.errmsg || ''})`;
        log.warn(`[API] transfer ${td} 失败: ${lastErr}`);

        if (resp.data.errno !== 400810) {
          throw new Error(`转存失败 errno=${resp.data.errno}: ${JSON.stringify(resp.data)}`);
        }
      } catch (err) {
        if (err.message.includes('转存失败')) throw err;
        lastErr = err.message;
        log.warn(`[API] transfer ${td} 请求失败: ${err.message}`);
      }
    }

    throw new Error(`transfer请求失败(所有域名): ${lastErr}`);
  }

  /**
   * 列出网盘目录文件
   */
  async listDir(dirPath = DEST_PATH) {
    const domains = ['www.terabox.com', 'www.1024terabox.com', 'www.terabox.app'];
    let lastErr = null;

    for (const domain of domains) {
      try {
        const url = `https://${domain}/api/list?${this.getBaseQuery()}&dir=${encodeURIComponent(dirPath)}&order=time&desc=1&page=1&num=1000`;
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
        log.warn(`[API] listDir ${domain} errno=${resp.data.errno}`);
        lastErr = `errno=${resp.data.errno}`;
      } catch (e) {
        log.warn(`[API] listDir ${domain} 失败: ${e.message}`);
        lastErr = e.message;
      }
    }
    throw new Error(`listDir失败: ${lastErr}`);
  }

  /**
   * 创建公开分享链接
   */
  async createShare(fsIds, filePaths = []) {
    if (!Array.isArray(fsIds)) fsIds = [fsIds];
    if (!Array.isArray(filePaths)) filePaths = [filePaths];

    const url = `https://www.terabox.app/share/pset?app_id=${this.appId}&web=1&channel=dubox&clienttype=0`;
    const params = new URLSearchParams();
    params.append('fid_list', JSON.stringify(fsIds));
    if (filePaths.length > 0) {
      params.append('path_list', JSON.stringify(filePaths));
    }
    params.append('schannel', '0');
    params.append('channel_list', '[0]');
    params.append('period', '0');
    params.append('pwd', '');
    params.append('public', '1');

    try {
      const resp = await axios.post(url, params, {
        headers: {
          ...this.headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://www.terabox.app/main',
        },
        timeout: 15000,
      });

      if (resp.data.errno === 0 || resp.data.errno === 110) {
        const link = resp.data.link || resp.data.shorturl || '';
        if (link) return link;
        if (resp.data.errno === 110) return 'ALREADY_SHARED';
      }
      throw new Error(`errno=${resp.data.errno}: ${JSON.stringify(resp.data)}`);
    } catch (e) {
      if (e.message.includes('errno=')) throw new Error(`createShare失败: ${e.message}`);
      throw new Error(`createShare失败: ${e.message}`);
    }
  }

  async findFile(filename, dirPath = DEST_PATH) {
    const files = await this.listDir(dirPath);
    return files.find(f => f.filename === filename) || null;
  }
}

module.exports = new TeraBoxApi();