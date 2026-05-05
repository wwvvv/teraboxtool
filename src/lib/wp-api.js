/**
 * wp-api.js - WordPress REST API 封装 v1.0.0
 */
const axios = require('axios');
const cheerio = require('cheerio');
const log = require('./logger');
require('dotenv').config();

const BASE_URL = (process.env.WP_BASE_URL || '').replace(/\/$/, '');
const AUTH = { username: process.env.WP_USERNAME, password: process.env.WP_PASSWORD };
const COOKIE = process.env.WP_COOKIE || '';
const AUTHOR_ID = process.env.WP_AUTHOR_ID || 5;
const TERABOX_REGEX = /https?:\/\/(www\.)?(terabox(app|)?\.com|1024tera\.com|terashare\.net|1024terabox\.com)\/(s\/|chinese\/sharing\/link\?surl=)[a-zA-Z0-9_-]+/g;

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function htmlEscapeUrl(url) {
  return String(url).replace(/&/g, '&amp;');
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnescape(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function replaceAllUrlVariants(text, oldUrl, newUrl) {
  if (typeof text !== 'string' || !oldUrl || !newUrl) return { text, count: 0 };
  let count = 0;
  let next = text;
  const replacements = [
    [oldUrl, newUrl],
    [htmlEscapeUrl(oldUrl), htmlEscapeUrl(newUrl)],
    [oldUrl.replace(/\//g, '\\/'), newUrl.replace(/\//g, '\\/')],
    [encodeURI(oldUrl), encodeURI(newUrl)],
  ];

  for (const [from, to] of replacements) {
    if (!from || from === to) continue;
    const matches = next.match(new RegExp(escapeRegExp(from), 'g'));
    if (!matches) continue;
    count += matches.length;
    next = next.replace(new RegExp(escapeRegExp(from), 'g'), to);
  }
  return { text: next, count };
}

function fixPhpSerializedStringLengths(value) {
  if (typeof value !== 'string' || !/s:\d+:/.test(value)) return value;
  return value.replace(/s:\d+:"((?:[^"\\]|\\.)*)";/g, (match, content) => {
    return `s:${Buffer.byteLength(content, 'utf8')}:"${content}";`;
  });
}

function unwrapSerializedString(value) {
  const match = String(value).match(/^s:\d+:"([\s\S]*)";$/);
  return match ? match[1] : value;
}

function parseXunDownloadValue(value, oldUrl, newUrl) {
  const raw = unwrapSerializedString(value);
  const permission = (raw.match(/s:19:"download_permission";s:\d+:"([^"]*)"/) || [])[1] || 'free';
  const links = [];
  const linkRegex = /s:8:"link_url";s:\d+:"([^"]*)";s:9:"link_name";s:\d+:"([^"]*)"/g;
  let match;
  while ((match = linkRegex.exec(raw))) {
    links.push({
      url: match[1] === oldUrl ? newUrl : match[1],
      name: match[2] || '网盘下载',
    });
  }
  if (links.length === 0) links.push({ url: newUrl, name: '网盘下载' });
  return { permission, links };
}

function xunDownloadXmlValue(value, oldUrl, newUrl) {
  const data = parseXunDownloadValue(value, oldUrl, newUrl);
  const linksXml = data.links.map(link => (
    `<value><struct><member><name>link_url</name><value><string>${xmlEscape(link.url)}</string></value></member><member><name>link_name</name><value><string>${xmlEscape(link.name)}</string></value></member></struct></value>`
  )).join('');
  return `<struct><member><name>download_permission</name><value><string>${xmlEscape(data.permission)}</string></value></member><member><name>download_links</name><value><array><data>${linksXml}</data></array></value></member></struct>`;
}

function deepContains(value, needle) {
  if (!needle || value == null) return false;
  if (typeof value === 'string') return value.includes(needle);
  if (Array.isArray(value)) return value.some(v => deepContains(v, needle));
  if (typeof value === 'object') return Object.values(value).some(v => deepContains(v, needle));
  return false;
}

class WpApi {
  async fetchAllPosts(authorId = AUTHOR_ID) {
    let allPosts = [], page = 1;
    while (true) {
      log.info(`[WP] 获取文章 第${page}页...`);
      try {
        const resp = await axios.get(`${BASE_URL}/wp-json/wp/v2/posts`, {
          params: { per_page: 100, page, author: authorId, _fields: 'id,title,link,content', orderby: 'id', order: 'asc' },
          auth: AUTH, timeout: 30000,
        });
        const posts = resp.data;
        if (!posts || posts.length === 0) break;
        allPosts = allPosts.concat(posts);
        log.info(`[WP]   第${page}页: ${posts.length}篇 (累计${allPosts.length})`);
        const totalPages = parseInt(resp.headers['x-wp-totalpages'] || '1');
        if (page >= totalPages) break;
        page++;
      } catch (err) {
        if (err.response && err.response.status === 400) break;
        log.error(`[WP] 获取第${page}页失败: ${err.message}`);
        break;
      }
    }
    return allPosts;
  }

  async getNonce(postUrl) {
    try {
      const resp = await axios.get(postUrl, { headers: { 'Cookie': COOKIE }, timeout: 15000 });
      const $ = cheerio.load(resp.data);
      const scripts = $('script').map((i, el) => $(el).html()).get().join('\n');
      const match = scripts.match(/\"nonce\":\"([^\"]+)\"/);
      return match ? match[1] : null;
    } catch { return null; }
  }

  async getDownloadLink(postId, nonce, postUrl) {
    try {
      const params = new URLSearchParams();
      params.append('action', 'xun_get_download_links');
      params.append('post_id', postId);
      params.append('nonce', nonce);
      params.append('link_index', '0');
      const resp = await axios.post(`${BASE_URL}/wp-admin/admin-ajax.php`, params, {
        headers: { 'Referer': postUrl, 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': COOKIE },
        timeout: 15000,
      });
      const data = resp.data.data || {};
      const isOk = [true, 'true', 1, '1'].includes(resp.data.success);
      const linkField = data.link || data.encrypted_url;
      if (isOk && linkField) {
        let cur = linkField;
        for (let i = 0; i < 5; i++) {
          if (typeof cur === 'string' && cur.startsWith('http')) return { url: cur, password: data.password || '' };
          if (typeof cur === 'object' && cur !== null) { cur = cur.u || cur.url || ''; continue; }
          if (typeof cur === 'string' && cur.startsWith('{')) { try { cur = JSON.parse(cur); continue; } catch { break; } }
          if (typeof cur === 'string' && /^[a-zA-Z0-9+/=]+$/.test(cur)) {
            try { const d = Buffer.from(cur, 'base64').toString('utf-8'); if (d.startsWith('http') || d.startsWith('{')) { cur = d; continue; } else break; } catch { break; }
          }
          break;
        }
        if (typeof cur === 'string' && cur.startsWith('http')) return { url: cur, password: data.password || '' };
      }
      return null;
    } catch { return null; }
  }

  extractFromContent(html) {
    const $ = cheerio.load(html);
    const links = [];
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.match(TERABOX_REGEX)) {
        const text = $(el).parent().text() || '';
        const pwdMatch = text.match(/(提取码|密码|pwd)[:：]\s*([a-zA-Z0-9]{4})/i);
        links.push({ url: href, password: pwdMatch ? pwdMatch[2] : '' });
      }
    });
    if (links.length === 0) {
      const m = html.match(TERABOX_REGEX);
      if (m) m.forEach(u => links.push({ url: u, password: '' }));
    }
    return links.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);
  }

  isTerabox(url) {
    if (!url) return false;
    TERABOX_REGEX.lastIndex = 0;
    return TERABOX_REGEX.test(url);
  }

  async fetchEditablePost(postId) {
    const resp = await axios.get(`${BASE_URL}/wp-json/wp/v2/posts/${postId}`, {
      params: { context: 'edit', _fields: 'id,link,content,meta' },
      auth: AUTH,
      timeout: 15000,
    });
    return resp.data;
  }

  async verifyDownloadLink(postId, newUrl, oldUrl, postUrl = '') {
    try {
      if (postUrl) {
        const nonce = await this.getNonce(postUrl);
        if (nonce) {
          const current = await this.getDownloadLink(postId, nonce, postUrl);
          if (current && current.url) return current.url === newUrl;
        }
      }
    } catch (err) {
      log.warn(`[WP] AJAX验证失败(${postId}): ${err.message}`);
    }

    try {
      const post = await this.fetchEditablePost(postId);
      const raw = (post.content && (post.content.raw || post.content.rendered)) || '';
      if (raw.includes(newUrl) && (!oldUrl || !raw.includes(oldUrl))) return true;
      if (deepContains(post.meta, newUrl) && (!oldUrl || !deepContains(post.meta, oldUrl))) return true;
      return false;
    } catch (err) {
      log.warn(`[WP] REST验证失败(${postId}): ${err.message}`);
      return false;
    }
  }

  async xmlRpcCall(methodName, paramsXml) {
    const body = `<?xml version="1.0"?><methodCall><methodName>${methodName}</methodName><params>${paramsXml}</params></methodCall>`;
    const resp = await axios.post(`${BASE_URL}/xmlrpc.php`, body, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 20000,
    });
    if (/<fault>/.test(resp.data)) {
      const fault = (resp.data.match(/<name>faultString<\/name>\s*<value><string>([\s\S]*?)<\/string>/) || [])[1] || 'XML-RPC fault';
      throw new Error(xmlUnescape(fault));
    }
    return resp.data;
  }

  xmlRpcAuthParams() {
    return [
      '<param><value><int>0</int></value></param>',
      `<param><value><string>${xmlEscape(AUTH.username || '')}</string></value></param>`,
      `<param><value><string>${xmlEscape(AUTH.password || '')}</string></value></param>`,
    ].join('');
  }

  parseXmlRpcCustomFields(xml) {
    const fields = [];
    const structs = xml.match(/<struct>[\s\S]*?<\/struct>/g) || [];
    for (const struct of structs) {
      const id = (struct.match(/<name>id<\/name><value><string>([\s\S]*?)<\/string><\/value>/) || [])[1];
      const key = (struct.match(/<name>key<\/name><value><string>([\s\S]*?)<\/string><\/value>/) || [])[1];
      const value = (struct.match(/<name>value<\/name><value><string>([\s\S]*?)<\/string><\/value>/) || [])[1];
      if (key) fields.push({ id: xmlUnescape(id || ''), key: xmlUnescape(key), value: xmlUnescape(value || '') });
    }
    return fields;
  }

  async updateDownloadLinkViaXmlRpc(postId, oldUrl, newUrl, postUrl = '') {
    const getParams = [
      this.xmlRpcAuthParams(),
      `<param><value><int>${parseInt(postId, 10)}</int></value></param>`,
      '<param><value><array><data><value><string>custom_fields</string></value></data></array></value></param>',
    ].join('');
    const xml = await this.xmlRpcCall('wp.getPost', getParams);
    const fields = this.parseXmlRpcCustomFields(xml);
    const field = fields.find(f => f.key === 'xun_post_download') || fields.find(f => f.value.includes(oldUrl));
    if (!field) {
      log.warn(`[WP] XML-RPC未找到下载字段(${postId})`);
      return false;
    }

    const replaced = replaceAllUrlVariants(field.value, oldUrl, newUrl);
    if (replaced.count === 0 && !field.value.includes(newUrl)) {
      log.warn(`[WP] XML-RPC下载字段未包含旧链接(${postId})`);
      return false;
    }
    const nextValue = fixPhpSerializedStringLengths(replaced.text);
    const valueXml = field.key === 'xun_post_download'
      ? xunDownloadXmlValue(field.value, oldUrl, newUrl)
      : `<string>${xmlEscape(nextValue)}</string>`;
    const idMember = field.id ? `<member><name>id</name><value><string>${xmlEscape(field.id)}</string></value></member>` : '';
    const editParams = [
      this.xmlRpcAuthParams(),
      `<param><value><int>${parseInt(postId, 10)}</int></value></param>`,
      `<param><value><struct><member><name>custom_fields</name><value><array><data><value><struct>${idMember}<member><name>key</name><value><string>${xmlEscape(field.key)}</string></value></member><member><name>value</name><value>${valueXml}</value></member></struct></value></data></array></value></member></struct></value></param>`,
    ].join('');
    await this.xmlRpcCall('wp.editPost', editParams);
    return await this.verifyDownloadLink(postId, newUrl, oldUrl, postUrl);
  }

  async updateDownloadLink(postId, oldUrl, newUrl) {
    let postUrl = '';

    try {
      const post = await this.fetchEditablePost(postId);
      postUrl = post.link || '';
    } catch (err) {
      log.warn(`[WP] 获取文章链接失败(${postId}): ${err.message}`);
    }

    // 直接使用 XML-RPC 更新 custom_fields。xun_post_download 未注册到 REST meta，
    // REST 可能返回 200 但前台下载接口仍读取旧值。
    try {
      const ok = await this.updateDownloadLinkViaXmlRpc(postId, oldUrl, newUrl, postUrl);
      if (ok) return true;
      log.warn(`[WP] XML-RPC更新未通过验证(${postId})`);
      return false;
    } catch (err) {
      log.error(`[WP] XML-RPC更新失败(${postId}): ${err.message}`);
      return false;
    }
  }
}

module.exports = new WpApi();
