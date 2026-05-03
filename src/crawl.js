/**
 * crawl.js - 采集模块 v1.0.0
 * Step 1&2: 通过 WP REST API 获取文章，提取 TeraBox 链接到记录表
 */
const wp = require('./lib/wp-api');
const log = require('./lib/logger');
const Records = require('./records');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function crawl() {
  log.divider('Step 1&2: 采集文章 TeraBox 链接');

  const records = new Records();
  records.load();
  const beforeCount = records.data.length;

  // 获取所有文章
  const posts = await wp.fetchAllPosts();
  log.info(`共获取 ${posts.length} 篇文章`);

  let newCount = 0;
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const postId = String(post.id);
    const title = post.title.rendered;
    const postUrl = post.link;

    log.step(i + 1, posts.length, `${title} (ID:${postId})`);
    const state = require('./lib/state');
    state.check();

    let teraLinks = [];

    // 方法1: AJAX nonce 方式获取 xun_post_download 字段
    const nonce = await wp.getNonce(postUrl);
    if (nonce) {
      const result = await wp.getDownloadLink(post.id, nonce, postUrl);
      if (result && result.url && wp.isTerabox(result.url)) {
        teraLinks.push(result);
      }
    }

    // 方法2: 从文章正文中提取
    if (teraLinks.length === 0 && post.content && post.content.rendered) {
      teraLinks = wp.extractFromContent(post.content.rendered);
    }

    if (teraLinks.length === 0) continue;

    for (const link of teraLinks) {
      // 查重：如果该文章的这个链接已经在记录中（无论是作为原链接还是新链接），则跳过
      if (records.exists(postId, link.url)) {
        continue;
      }
      
      const added = records.add({
        postId, title, postUrl,
        originalLink: link.url,
        password: link.password || '',
      });
      if (added) newCount++;
    }

    // 限速
    if ((i + 1) % 10 === 0) {
      await sleep(2000);
    } else {
      await sleep(500);
    }
  }

  records.save();
  records.exportCsv();

  const stats = records.stats();
  log.divider('采集完成');
  log.success(`新增 ${newCount} 条记录 (总计 ${records.data.length} 条)`);
  log.info(`状态统计: ${JSON.stringify(stats)}`);

  return records;
}

module.exports = crawl;
