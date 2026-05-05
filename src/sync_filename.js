/**
 * sync_filename.js - 同步文件名模块 v2.0.0
 * 针对"已采集"状态且没有文件名的记录，单独调用分享信息接口获取文件名并回填
 */
const terabox = require('./lib/terabox-api');
const log = require('./lib/logger');
const Records = require('./records');
const axios = require('axios');
const cheerio = require('cheerio');
const { STATUS } = Records;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeLink(url) {
  const m = url.match(/\/s\/1([a-zA-Z0-9_-]+)/);
  if (m) {
    return `https://www.terabox.app/chinese/sharing/link?surl=${m[1]}`;
  }
  return url;
}

async function syncFilename(targetList = null) {
  log.divider('额外任务: 同步文件名');

  const records = new Records();
  records.load();

  // 筛选待同步的记录：状态为"已采集"或"待处理"且文件名为空
  let pending = [];
  if (targetList) {
    pending = records.data.filter(r =>
      targetList.some(t => String(t.postId) === String(r.postId) && t.originalLink === r.originalLink)
    );
  } else {
    pending = records.data.filter(r =>
      (r.status === STATUS.CRAWLED || r.status === STATUS.PENDING) && !r.fileName && r.status !== STATUS.DELETED && r.status !== STATUS.INVALID
    );
  }

  log.info(`待同步文件名的记录: ${pending.length} 条`);
  if (pending.length === 0) {
    log.success('没有需要同步文件名的记录');
    return records;
  }

  let successCount = 0, failCount = 0;

  for (let i = 0; i < pending.length; i++) {
    const rec = pending[i];
    log.step(i + 1, pending.length, `同步: ${rec.title}`);
    require('./lib/state').check();

    let retries = 2;
    while (retries > 0) {
      try {
        const shareUrl = normalizeLink(rec.originalLink);
        
        let fName = '';
        
        // 方法1：直接获取 HTML 提取 title
        try {
          const htmlRes = await axios.get(shareUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
            },
            timeout: 15000
          });
          const $ = cheerio.load(htmlRes.data);
          let titleStr = $('title').text() || '';
          // 格式通常是 "文件名 - Share Files Online & Send Larges Files with TeraBox"
          const match = titleStr.match(/^(.*?)\s+-\s+Share Files Online/);
          if (match && match[1]) {
             fName = match[1].replace(/\.[^/.]+$/, ''); // 去除后缀
          }
        } catch (e) {
          log.warn(`  [HTML解析] 获取HTML失败: ${e.message}`);
        }

        // 方法2：如果 HTML 方法失败，使用 API 获取
        if (!fName) {
          const shareInfo = await terabox.getShareInfo(shareUrl, rec.password);
          fName = shareInfo.files.length > 0
            ? shareInfo.files[0].filename.replace(/\.[^/.]+$/, '')
            : '';
        }

        if (fName) {
          log.success(`  [成功] 提取到文件名: ${fName}`);
          records.update(rec.postId, rec.originalLink, {
            fileName: fName,
          });
          successCount++;
        } else {
          log.warn(`  [警告] 未能提取到文件名`);
          failCount++;
        }
        break;
      } catch (err) {
        if (err.message === 'TASK_STOPPED') throw err;
        
        if (err.message.includes('4000020')) {
          log.error(`  [失败] 链接失效或无法访问 (errno=4000020)，标记为已删除`);
          records.update(rec.postId, rec.originalLink, {
            status: STATUS.DELETED,
            error: '链接失效 (4000020)',
          });
          failCount++;
          break; // 不再重试
        }

        retries--;
        log.error(`  [失败] ${err.message} (剩余重试: ${retries})`);
        if (retries > 0) {
          await sleep(5000);
        } else {
          failCount++;
        }
      }
    }

    records.save();
    
    // 限速：随机 3-5 秒间隔
    const delay = Math.floor(Math.random() * 2000) + 3000;
    await sleep(delay);
  }

  log.divider('同步完成');
  log.success(`成功获取: ${successCount}, 失败: ${failCount}`);
  records.exportCsv();
  return records;
}

module.exports = syncFilename;
