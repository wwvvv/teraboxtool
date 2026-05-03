/**
 * share.js - 分享模块 v1.0.0
 * Step 5: 为已转存的文件创建新的公开分享链接
 */
const terabox = require('./lib/terabox-api');
const log = require('./lib/logger');
const Records = require('./records');
const { STATUS } = Records;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function share(targetList = null) {
  log.divider('Step 5: 批量创建分享链接');

  const records = new Records();
  records.load();

  let pending = [];
  if (targetList) {
    pending = records.data.filter(r => 
      targetList.some(t => String(t.postId) === String(r.postId) && t.originalLink === r.originalLink)
    );
  } else {
    pending = records.data.filter(r =>
      r.status === STATUS.TRANSFERRED || r.status === STATUS.FAILED_SHARE
    );
  }

  log.info(`待分享: ${pending.length} 条`);
  if (pending.length === 0) {
    log.success('没有需要创建分享链接的记录');
    return records;
  }

  // 获取目录文件列表（一次获取，减少API调用）
  let fileList = [];
  try {
    fileList = await terabox.listDir();
    log.info(`[网盘] 目录中共 ${fileList.length} 个文件`);
  } catch (err) {
    log.error(`[网盘] 获取目录失败: ${err.message}`);
    return records;
  }

  let successCount = 0, failCount = 0;

  for (let i = 0; i < pending.length; i++) {
    const rec = pending[i];
    log.step(i + 1, pending.length, `分享: ${rec.title}`);
    require('./lib/state').check();

    try {
      // 尝试在网盘目录中找到对应文件
      // 按文件名部分匹配（可能有 Coser@ 前缀等）
      let targetFile = null;

      // 如果转存信息中有文件路径/名，优先使用
      // 否则遍历目录查找最近添加的文件
      for (const f of fileList) {
        // 按标题关键词匹配
        const titleWords = rec.title.split(/\s+/).filter(w => w.length > 1);
        const matchScore = titleWords.filter(w => f.filename.includes(w)).length;
        if (matchScore >= 1) {
          targetFile = f;
          break;
        }
      }

      if (!targetFile) {
        // 兜底：取最近的文件
        log.warn(`  [匹配] 未能精确匹配文件，将尝试用整个目录文件创建分享`);
        // 按时间倒序，取最近的
        const sorted = [...fileList].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
        if (sorted.length > 0) {
          targetFile = sorted[0];
        }
      }

      if (!targetFile) {
        throw new Error('网盘目录中没有找到文件');
      }

      log.info(`  [文件] ${targetFile.filename} (fs_id: ${targetFile.fs_id})`);

      // 创建分享链接
      const shareLink = await terabox.createShare([targetFile.fs_id]);

      if (shareLink && shareLink !== 'ALREADY_SHARED') {
        log.success(`  [分享] ${shareLink}`);
        records.update(rec.postId, rec.originalLink, {
          newLink: shareLink,
          status: STATUS.SHARED,
          error: '',
        });
        successCount++;
      } else if (shareLink === 'ALREADY_SHARED') {
        log.warn(`  [分享] 文件已分享，需要查找已有链接`);
        records.update(rec.postId, rec.originalLink, {
          status: STATUS.FAILED_SHARE,
          error: '文件已分享，需手动获取链接',
        });
        failCount++;
      }
    } catch (err) {
      log.error(`  [失败] ${err.message}`);
      records.update(rec.postId, rec.originalLink, {
        status: STATUS.FAILED_SHARE,
        error: err.message,
      });
      failCount++;
    }

    records.save();

    // 限速
    const delay = Math.floor(Math.random() * 5000) + 3000;
    await sleep(delay);
  }

  log.divider('分享完成');
  log.success(`成功: ${successCount}, 失败: ${failCount}`);
  return records;
}

module.exports = share;
