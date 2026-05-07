/**
 * terabox-api.js - TeraBox API 封装 v2.2.0
 *
 * 接口分类：
 * - 公开接口（share/list）：不需要 jsToken/bdstoken/Cookie，不带认证反而更稳定
 * - 私有接口（share/transfer, api/list, share/pset）：需要 Cookie 认证
 * - 验证码接口（vcode/v2）：转存前需通过滑块验证获取 verify_v2 token
 */
const axios = require('axios');
const crypto = require('crypto');
const log = require('./logger');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const VC_AES_KEY = 'm1seqrumas@3#awq';
const VC_AES_IV = '1234567890123456';

function encryptVcodeData(jsonStr) {
  const cipher = crypto.createCipheriv('aes-128-cbc', VC_AES_KEY, VC_AES_IV);
  let encrypted = cipher.update(jsonStr, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

function extractNdus(raw) {
  const m = raw.match(/ndus=([^;]+)/);
  return m ? m[1] : raw;
}

function extractCsrf(raw) {
  const m = raw.match(/csrfToken=([^;]+)/);
  return m ? m[1] : '';
}

class TeraBoxApi {
  constructor() {
    this.appId = '250528';
    this.pcftoken = '';
    this.refreshConfig();
  }

  refreshConfig() {
    const cookieStr = process.env.TERABOX_COOKIE || process.env.TERABOX_NDUS || '';
    this.jsToken = process.env.TERABOX_jsToken || '';
    this.bdstoken = process.env.TERABOX_bdstoken || '';
    this.destPath = process.env.TERABOX_DEST_PATH || '/acgx/';
    this.ndus = extractNdus(cookieStr);
    this.csrf = extractCsrf(cookieStr);
    this.headers = {
      'Cookie': cookieStr + '; PANWEB=1',
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
    };
  }

  async fetchPcftoken() {
    if (this.pcftoken) return this.pcftoken;
    try {
      const resp = await axios.get('https://www.terabox.app/', {
        headers: { 'User-Agent': UA },
        timeout: 10000,
      });
      const match = resp.data.match(/"pcftoken":"([^"]+)"/);
      if (match) {
        this.pcftoken = match[1];
        log.info(`[API] 获取 pcftoken: ${this.pcftoken.substring(0, 16)}...`);
      }
    } catch (e) {
      log.warn(`[API] 获取 pcftoken 失败: ${e.message}`);
    }
    return this.pcftoken;
  }

  getBaseQuery() {
    return `app_id=${this.appId}&web=1&channel=dubox&clienttype=0&jsToken=${encodeURIComponent(this.jsToken)}&bdstoken=${encodeURIComponent(this.bdstoken)}`;
  }

  getCommonParams() {
    return {
      client: 'web',
      clientfrom: 'h5',
      lang: 'en',
      pass_version: '2.8',
      pcftoken: this.pcftoken || '',
    };
  }

  extractSurl(shareUrl) {
    const m1 = shareUrl.match(/\/s\/1([a-zA-Z0-9_-]+)/);
    if (m1) return '1' + m1[1];
    const m2 = shareUrl.match(/surl=([a-zA-Z0-9_-]+)/);
    if (m2) return m2[1];
    return null;
  }

  async getSliderCaptcha() {
    await this.fetchPcftoken();
    const t = Math.floor(Date.now() / 1000);
    const domains = ['www.terabox.app', 'www.terabox.com', 'www.1024terabox.com'];
    const commonParams = this.getCommonParams();

    for (const domain of domains) {
      try {
        const params = new URLSearchParams({
          app_id: this.appId,
          web: '1',
          channel: 'dubox',
          clienttype: '0',
          ak: '9241',
          t: t.toString(),
          type: '1',
          jsToken: this.jsToken,
          bdstoken: this.bdstoken,
          ...commonParams,
        });
        const url = `https://${domain}/api/vcode/v2/get?${params.toString()}`;
        const resp = await axios.get(url, {
          headers: { ...this.headers, 'Referer': `https://${domain}/` },
          timeout: 15000,
        });

        if (resp.data && resp.data.v) {
          log.info(`[API] 滑块验证码获取成功 (${domain}), token=${(resp.data.token || '').substring(0, 16)}...`);
          return {
            token: resp.data.token || '',
            v: resp.data.v,
            sp: resp.data.sp || '',
            bgimg: resp.data.bgimg || '',
            domain,
          };
        }
        log.warn(`[API] 获取滑块验证码 ${domain} 失败: errno=${resp.data.errno}, data=${JSON.stringify(resp.data).substring(0, 200)}`);
      } catch (e) {
        log.warn(`[API] 获取滑块验证码 ${domain} 请求失败: ${e.message}`);
      }
    }
    return null;
  }

  async solveSlider(captchaData) {
    if (!captchaData || !captchaData.sp) {
      log.error('[API] 滑块验证码数据无效，缺少 sp 参数');
      return null;
    }

    const spParts = captchaData.sp.split(',');
    let targetX = 150;
    if (spParts.length >= 2) {
      targetX = parseInt(spParts[0], 10) || 150;
    }
    const trackWidth = spParts.length >= 2 ? parseInt(spParts[1], 10) || 300 : 300;

    const ps = [];
    let currentX = 0;
    const now = Math.floor(Date.now() / 1000);
    const totalSteps = Math.floor(Math.random() * 8) + 14;

    for (let i = 0; i < totalSteps; i++) {
      const progress = (i + 1) / totalSteps;
      const eased = 1 - Math.pow(1 - progress, 3);
      currentX = Math.round(targetX * eased);
      const y = Math.floor(Math.random() * 3) - 1;
      ps.push({ x: currentX, y: Math.abs(y), t: now + i });
    }
    ps.push({ x: targetX, y: 0, t: now + totalSteps });

    const payload = JSON.stringify({ ps, w: trackWidth, h: 160 });
    const encryptedData = encryptVcodeData(payload);

    const t = Math.floor(Date.now() / 1000);
    const commonParams = this.getCommonParams();
    const domains = [captchaData.domain];
    if (!domains[0]) domains.push('www.terabox.app', 'www.terabox.com', 'www.1024terabox.com');

    for (const domain of domains) {
      try {
        const url = `https://${domain}/api/vcode/v2/verify?app_id=${this.appId}&web=1&channel=dubox&clienttype=0&jsToken=${encodeURIComponent(this.jsToken)}&bdstoken=${encodeURIComponent(this.bdstoken)}`;
        const params = new URLSearchParams({
          v: captchaData.v,
          ak: '9241',
          t: t.toString(),
          type: '1',
          data: encryptedData,
          token: captchaData.token,
          ...commonParams,
        });

        const resp = await axios.post(url, params, {
          headers: {
            ...this.headers,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': `https://${domain}/`,
          },
          timeout: 15000,
        });

        if (resp.data && resp.data.result === true) {
          log.success(`[API] 滑块验证通过, verify_v2 token=${(resp.data.token || '').substring(0, 16)}...`);
          return resp.data.token;
        }
        log.warn(`[API] 滑块验证失败 ${domain}: ${JSON.stringify(resp.data).substring(0, 200)}`);
      } catch (e) {
        log.warn(`[API] 滑块验证请求失败 ${domain}: ${e.message}`);
      }
    }
    return null;
  }

  async getVerifyV2(retries = 3) {
    for (let i = 0; i < retries; i++) {
      log.info(`[API] 获取 verify_v2 token (尝试 ${i + 1}/${retries})`);
      const captchaData = await this.getSliderCaptcha();
      if (!captchaData) {
        log.warn('[API] 获取滑块验证码失败，等待 5 秒后重试...');
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      const token = await this.solveSlider(captchaData);
      if (token) return token;
      log.warn('[API] 滑块验证未通过，等待 3 秒后重试...');
      await new Promise(r => setTimeout(r, 3000));
    }
    log.error('[API] 所有 verify_v2 获取尝试失败');
    return null;
  }

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
            const verifyUrl = `https://${domain}/share/verify?app_id=${this.appId}&web=1&channel=dubox&clienttype=0&shorturl=${shorturl}&shareid=${resp.data.shareid || resp.data.share_id || ''}&uk=${resp.data.uk || ''}&jsToken=${encodeURIComponent(this.jsToken)}&bdstoken=${encodeURIComponent(this.bdstoken)}`;
            const verifyParams = new URLSearchParams();
            verifyParams.append('pwd', password);
            verifyParams.append('vcode', '');
            verifyParams.append('vcode_str', '');
            await axios.post(verifyUrl, verifyParams, {
              headers: {
                ...this.headers,
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
                'Cookie': this.headers.Cookie,
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

  async transfer(shareInfo, password = '') {
    const { shareid, uk, files, domain } = shareInfo;
    if (!files || files.length === 0) throw new Error('没有可转存的文件');

    const fsIds = files.map(f => f.fs_id);
    const transferDomains = ['www.terabox.app', 'www.terabox.com', 'www.1024terabox.com'];
    let lastErr = null;

    let verifyV2 = await this.getVerifyV2(1);
    if (verifyV2) {
      log.info(`[API] 使用 verify_v2 token 进行转存`);
    } else {
      log.warn(`[API] 未能获取 verify_v2 token，将尝试不带验证码转存`);
    }

    for (const td of transferDomains) {
      let url = `https://${td}/share/transfer?${this.getBaseQuery()}&shareid=${shareid}&from=${uk}&ondup=newcopy`;
      if (verifyV2) {
        url += `&verify_v2=${encodeURIComponent(verifyV2)}`;
      }

      const params = new URLSearchParams();
      params.append('fsidlist', JSON.stringify(fsIds));
      params.append('path', this.destPath);

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
          verifyV2 = null;
          return {
            success: true,
            errno: resp.data.errno,
            transferred: info.map(f => ({ from: f.from, to: f.to, fs_id: f.fs_id })),
            destPath: this.destPath,
          };
        }

        if (resp.data.errno === 400810 && !verifyV2) {
          log.info(`[API] transfer ${td} 需要验证码 (errno=400810)，重新获取 verify_v2`);
          verifyV2 = await this.getVerifyV2(3);
          if (verifyV2) {
            const retryUrl = `https://${td}/share/transfer?${this.getBaseQuery()}&shareid=${shareid}&from=${uk}&ondup=newcopy&verify_v2=${encodeURIComponent(verifyV2)}`;
            const retryParams = new URLSearchParams();
            retryParams.append('fsidlist', JSON.stringify(fsIds));
            retryParams.append('path', this.destPath);

            try {
              const retryResp = await axios.post(retryUrl, retryParams, {
                headers: {
                  ...this.headers,
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Referer': `https://${td}/`,
                },
                timeout: 30000,
              });

              if (retryResp.data.errno === 0 || retryResp.data.errno === 4 || retryResp.data.errno === 12) {
                const extra = retryResp.data.extra || {};
                const info = extra.list || [];
                log.info(`[API] transfer ${td} 重试成功, errno=${retryResp.data.errno}`);
                return {
                  success: true,
                  errno: retryResp.data.errno,
                  transferred: info.map(f => ({ from: f.from, to: f.to, fs_id: f.fs_id })),
                  destPath: this.destPath,
                };
              }
              lastErr = `errno=${retryResp.data.errno} (${retryResp.data.errmsg || ''})`;
              log.warn(`[API] transfer ${td} 重试失败: ${lastErr}`);
            } catch (err) {
              lastErr = err.message;
              log.warn(`[API] transfer ${td} 重试请求失败: ${err.message}`);
            }
          } else {
            lastErr = `errno=400810 (verify_v2 获取失败)`;
            log.warn(`[API] transfer ${td} 失败: ${lastErr}`);
          }
          continue;
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

  async listDir(dirPath) {
    if (!dirPath) dirPath = this.destPath;
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

  async findFile(filename, dirPath) {
    if (!dirPath) dirPath = this.destPath;
    const files = await this.listDir(dirPath);
    return files.find(f => f.filename === filename) || null;
  }

  async checkAccount() {
    this.refreshConfig();
    const cookie = process.env.TERABOX_COOKIE || process.env.TERABOX_NDUS || '';
    const jsToken = process.env.TERABOX_jsToken || '';
    const bdstoken = process.env.TERABOX_bdstoken || '';

    if (!cookie) return { ok: false, error: '缺少 TeraBox Cookie' };
    if (!jsToken) return { ok: false, error: '缺少 jsToken' };
    if (!bdstoken) return { ok: false, error: '缺少 bdstoken' };

    const domains = ['www.terabox.com', 'www.1024terabox.com', 'www.terabox.app'];
    for (const domain of domains) {
      try {
        const url = `https://${domain}/api/list?${this.getBaseQuery()}&dir=${encodeURIComponent(this.destPath)}&order=time&desc=1&page=1&num=1`;
        const resp = await axios.get(url, {
          headers: { ...this.headers, 'Referer': `https://${domain}/` },
          timeout: 10000,
        });

        if (resp.data.errno === 0) {
          const fileCount = (resp.data.list || []).length;
          return { ok: true, message: `账号正常 (目录下 ${fileCount} 个文件)` };
        }

        if (resp.data.errno === -6) {
          return { ok: false, error: '账号未登录 (Cookie 可能已过期)' };
        }
        if (resp.data.errno === 400810) {
          return { ok: false, error: '账号认证需要验证码 (转存时将自动处理)' };
        }
        if (resp.data.errno === 2 || resp.data.errno === -9) {
          return { ok: true, message: '账号正常 (目标目录不存在)' };
        }

        log.warn(`[API] checkAccount ${domain} errno=${resp.data.errno}`);
      } catch (e) {
        log.warn(`[API] checkAccount ${domain} 请求失败: ${e.message}`);
      }
    }

    return { ok: false, error: '账号检查失败：无法连接 TeraBox' };
  }
}

module.exports = new TeraBoxApi();