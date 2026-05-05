/**
 * transfer.js - 转存模块 v2.1.0
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

  let diskFiles = [];
  try {
    diskFiles = await terabox.listDir();
    log.info(`[网盘] 目录中共 ${diskFiles.length} 个文件`);
  } catch (err) {
    log.warn(`[网盘] 获取目录文件列表失败: ${err.message}，将跳过文件名查重`);
  }

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
        const shareUrl = normalizeLink(rec.originalLink);
        if (shareUrl !== rec.originalLink) {
          log.info(`  [转换] ${rec.originalLink}`);
          log.info(`      → ${shareUrl}`);
        }

        log.info(`  [解析] ${shareUrl}`);
        let fName = rec.fileName || '';
        let shareInfo = null;

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
            const htmlName = match[1].replace(/\.[^/.]+$/, '');
            if (htmlName) fName = htmlName;
          }
        } catch (e) {
          log.warn(`  [HTML解析] 获取HTML失败: ${e.message}`);
        }

        try {
          shareInfo = await terabox.getShareInfo(shareUrl, rec.password);
          log.info(`  [分享] shareid=${shareInfo.shareid}, 文件数=${shareInfo.files.length}`);

          if (!fName && shareInfo.files.length > 0) {
            fName = shareInfo.files[0].filename.replace(/\.[^/.]+$/, '');
          }

          if (shareInfo.files.length > 0 && shareInfo.files[0].fs_id) {
            const apiName = shareInfo.files[0].filename.replace(/\.[^/.]+$/, '');
            if (apiName && (!fName || fName !== apiName)) {
              fName = apiName;
            }
          }
        } catch (err) {
          log.warn(`  [API] getShareInfo失败: ${err.message}`);

          if (!fName) {
            log.error(`  [失败] 无法获取文件名（API和HTML均失败），跳过`);
            records.update(rec.postId, rec.originalLink, {
              status: STATUS.INVALID,
              error: `无法获取分享信息: ${err.message}`,
            });
            failCount++;
            break;
          }

          if (fName && diskFileNames.has(fName)) {
            log.success(`  [查重] 网盘中已有同名文件: ${fName}（API失败但HTML提取到文件名），跳过转存`);
            records.update(rec.postId, rec.originalLink, {
              fileName: fName,
              status: STATUS.TRANSFERRED,
              error: '',
            });
            skipCount++;
            successCount++;
            break;
          }

          if (fName) {
            const existing = records.findByFileName(fName);
            if (existing && (existing.postId !== rec.postId || existing.originalLink !== rec.originalLink)) {
              log.success(`  [查重] 匹配到同名记录: ${existing.title || existing.postId}（API失败但HTML提取到文件名）`);
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

          log.error(`  [失败] API失败且无法匹配文件名，标记为资源失效`);
          records.update(rec.postId, rec.originalLink, {
            status: STATUS.INVALID,
            error: `API失败: ${err.message}，文件名: ${fName}`,
          });
          failCount++;
          break;
        }

        if (fName && diskFileNames.has(fName)) {
          log.success(`  [查重] 网盘中已有同名文件: ${fName}，跳过转存`);
          records.update(rec.postId, rec.originalLink, {
            fileName: fName,
            status: STATUS.TRANSFERRED,
            error: '',
          });
          skipCount++;
          successCount++;
          break;
        }

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

        const result = await terabox.transfer(shareInfo, rec.password);
        if (result.success) {
          log.success(`  [转存成功] errno=${result.errno}`);
          records.update(rec.postId, rec.originalLink, {
            status: STATUS.TRANSFERRED,
            fileName: fName,
            error: '',
          });
          if (fName) diskFileNames.add(fName);
          successCount++;
          break;
        }
      } catch (err) {
        if (err.message === 'TASK_STOPPED') throw err;

        if (err.message.includes('4000020')) {
          log.error(`  [失败] 链接已失效 (errno=4000020)，标记为资源失效`);
          records.update(rec.postId, rec.originalLink, {
            status: STATUS.INVALID,
            error: '链接已失效 (4000020)',
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

    const delay = Math.floor(Math.random() * 5000) + 5000;
    log.info(`  等待 ${Math.round(delay / 1000)} 秒...`);
    await sleep(delay);
  }

  log.divider('转存完成');
  log.success(`成功: ${successCount} (其中跳过: ${skipCount}), 失败: ${failCount}`);
  return records;
}

module.exports = transfer;