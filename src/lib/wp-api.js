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

  async updateDownloadLink(postId, oldUrl, newUrl) {
    // 方式1: REST API meta更新
    try {
      const resp = await axios.post(`${BASE_URL}/wp-json/wp/v2/posts/${postId}`, { meta: { xun_post_download: newUrl } }, { auth: AUTH, timeout: 15000 });
      if (resp.status === 200) return true;
    } catch (err) {
      log.warn(`[WP] REST meta更新失败(${postId}), 尝试AJAX: ${err.message}`);
    }
    // 方式2: admin-ajax
    try {
      const editResp = await axios.get(`${BASE_URL}/wp-admin/post.php?post=${postId}&action=edit`, { headers: { 'Cookie': COOKIE }, timeout: 15000 });
      const nm = editResp.data.match(/name="_wpnonce"\s+value="([^"]+)"/);
      if (!nm) return false;
      const fd = new URLSearchParams();
      fd.append('action', 'editpost'); fd.append('post_ID', postId); fd.append('_wpnonce', nm[1]); fd.append('xun_post_download', newUrl);
      await axios.post(`${BASE_URL}/wp-admin/post.php`, fd, { headers: { 'Cookie': COOKIE, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, maxRedirects: 0, validateStatus: s => s < 400 });
      return true;
    } catch (err) {
      log.error(`[WP] AJAX更新失败(${postId}): ${err.message}`);
      return false;
    }
  }
}

module.exports = new WpApi();
