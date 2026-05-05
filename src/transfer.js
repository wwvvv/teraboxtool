/**
 * transfer.js - 转存模块 v2.0.0
 * Step 4: 通过 TeraBox API 批量转存原网盘链接到自己账号
 * 
 * 查重逻辑：获取网盘目录文件列表，按文件名查重，目录中有同名文件不转存
 * 仅做转存，不创建分享链接（分享由 share.js 负责）
 */
const terabox = require('./lib/terabox-api');
const log = require('./lib/logger');
const Records = require('./records');
const axios = require('axios');
const cheerio = require('cheerio');
const { STATUS } = Records;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 统一链接格式：将各种 TeraBox 域名链接转换为 terabox.app 标准格式
 */
function normalizeLink(url) {
  const m = url.match(/\/s\/1([a-zA-Z0-9_-]+)/);
  if (m) {
    return `https://www.terabox.app/chinese/sharing/link?surl=${m[1]}`;
  }
  return url;
}

async function transfer(targetList = null) {
  log.divider('Step 4: 批量转存 TeraBox 链接');

  const records = new Records();
  records.load();

  // 筛选待转存的记录
  let pending = [];
  if (targetList) {
    pending = records.data.filter(r =>
      targetList.some(t => String(t.postId) === String(r.postId) && t.originalLink === r.originalLink)
    );
  } else {
    pending = records.data.filter(r =>
      (r.status === STATUS.CRAWLED || r.status === STATUS.FAILED_TRANSFER) && r.status !== STATUS.DELETED && r.status !== STATUS.INVALID
    );
  }

  log.info(`待转存: ${pending.length} 条`);
  if (pending.length === 0) {
    log.success('没有需要转存的记录');
    return records;
  }

  // 预先获取网盘目录文件列表（用于文件名查重）
  let diskFiles = [];
  try {
    diskFiles = await terabox.listDir();
    log.info(`[网盘] 目录中共 ${diskFiles.length} 个文件`);
  } catch (err) {
    log.warn(`[网盘] 获取目录文件列表失败: ${err.message}，将跳过文件名查重`);
  }

  // 构建文件名集合（不含后缀）
  const diskFileNames = new Set(
    diskFiles.map(f => f.filename.replace(/\.[^/.]+$/, ''))
  );

  let successCount = 0, failCount = 0, skipCount = 0;

  for (let i = 0; i < pending.length; i++) {
    const rec = pending[i];
    log.step(i + 1, pending.length, `转存: ${rec.title}`);
    require('./lib/state').check();

    let retries = 2;
    while (retries > 0) {
      try {
        // 1. 统一链接格式
        const shareUrl = normalizeLink(rec.originalLink);
        if (shareUrl !== rec.originalLink) {
          log.info(`  [转换] ${rec.originalLink}`);
          log.info(`      → ${shareUrl}`);
        }

        // 2. 获取分享信息并提取文件名
        log.info(`  [解析] ${shareUrl}`);
        let fName = '';
        let shareInfo = null;

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
          const match = titleStr.match(/^(.*?)\s+-\s+Share Files Online/);
          if (match && match[1]) {
             fName = match[1].replace(/\.[^/.]+$/, ''); // 去除后缀
          }
        } catch (e) {
          log.warn(`  [HTML解析] 获取HTML失败: ${e.message}`);
        }

        // 依然需要 API 获取转存用的 info
        shareInfo = await terabox.getShareInfo(shareUrl, rec.password);
        log.info(`  [分享] shareid=${shareInfo.shareid}, 文件数=${shareInfo.files.length}`);

        if (!fName) {
          fName = shareInfo.files.length > 0
            ? shareInfo.files[0].filename.replace(/\.[^/.]+$/, '')
            : '';
        }

        // 3. 文件名查重：网盘目录中已有同名文件则跳过转存
        if (fName && diskFileNames.has(fName)) {
          log.success(`  [查重] 网盘中已有同名文件: ${fName}，跳过转存`);
          records.update(rec.postId, rec.originalLink, {
            fileName: fName,
            status: STATUS.TRANSFERRED,
            error: '',
          });
          skipCount++;
          successCount++;
          break; // 跳过实际转存
        }

        // 4. 检查记录中是否有已转存/已分享/已替换的同名文件
        if (fName) {
          const existing = records.findByFileName(fName);
          if (existing && (existing.postId !== rec.postId || existing.originalLink !== rec.originalLink)) {
            log.success(`  [查重] 匹配到同名记录: ${existing.title || existing.postId}`);
            records.update(rec.postId, rec.originalLink, {
              fileName: fName,
              status: existing.newLink ? STATUS.SHARED : STATUS.TRANSFERRED,
              newLink: existing.newLink || '',
              error: '',
            });
            skipCount++;
            successCount++;
            break;
          }
        }

        // 5. 执行转存
        const result = await terabox.transfer(shareInfo, rec.password);
        if (result.success) {
          log.success(`  [转存成功] errno=${result.errno}`);
          records.update(rec.postId, rec.originalLink, {
            status: STATUS.TRANSFERRED,
            fileName: fName,
            error: '',
          });
          // 更新本地文件名集合
          if (fName) diskFileNames.add(fName);
          successCount++;
          break;
        }
      } catch (err) {
        if (err.message === 'TASK_STOPPED') throw err;

        if (err.message.includes('4000020')) {
          log.error(`  [失败] 链接失效或无法访问 (errno=4000020)，标记为已删除`);
          records.update(rec.postId, rec.originalLink, {
            status: STATUS.DELETED,
            error: '链接失效 (4000020)',
          });
          failCount++;
          break;
        }

        retries--;
        log.error(`  [失败] ${err.message} (剩余重试: ${retries})`);
        if (retries > 0) {
          log.info('  等待 10 秒后重试...');
          await sleep(10000);
        } else {
          records.update(rec.postId, rec.originalLink, {
            status: STATUS.FAILED_TRANSFER,
            error: err.message,
          });
          failCount++;
        }
      }
    }

    records.save();

    // 限速：随机 5-10 秒间隔
    const delay = Math.floor(Math.random() * 5000) + 5000;
    log.info(`  等待 ${Math.round(delay / 1000)} 秒...`);
    await sleep(delay);
  }

  log.divider('转存完成');
  log.success(`成功: ${successCount} (其中跳过: ${skipCount}), 失败: ${failCount}`);
  return records;
}

module.exports = transfer;
