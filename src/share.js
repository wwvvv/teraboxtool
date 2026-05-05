/**
 * share.js - 分享模块 v2.0.0
 * Step 5: 为已转存的文件创建新的公开分享链接
 * 
 * 逻辑：
 * 1. 按 fileName 精确匹配网盘目录中的文件
 * 2. 创建分享链接
 * 3. 回填 newLink 到所有具有相同 fileName 的记录
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
      (r.status === STATUS.TRANSFERRED || r.status === STATUS.FAILED_SHARE) && r.status !== STATUS.DELETED && r.status !== STATUS.INVALID
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

  // 构建文件名 → 文件对象映射（不含后缀）
  const fileMap = new Map();
  for (const f of fileList) {
    const nameNoExt = f.filename.replace(/\.[^/.]+$/, '');
    fileMap.set(nameNoExt, f);
  }

  // 跟踪已处理的文件名，避免重复分享
  const sharedFileNames = new Map(); // fileName → shareLink

  let successCount = 0, failCount = 0;

  for (let i = 0; i < pending.length; i++) {
    const rec = pending[i];
    log.step(i + 1, pending.length, `分享: ${rec.title}`);
    require('./lib/state').check();

    try {
      const fileName = rec.fileName;

      if (!fileName) {
        log.warn(`  [跳过] 无文件名信息，无法匹配文件`);
        records.update(rec.postId, rec.originalLink, {
          status: STATUS.FAILED_SHARE,
          error: '无文件名信息',
        });
        failCount++;
        continue;
      }

      // 1. 检查是否已有同文件名的分享链接（本轮已处理过）
      if (sharedFileNames.has(fileName)) {
        const existingLink = sharedFileNames.get(fileName);
        log.success(`  [查重] 本轮已分享过相同文件名: ${fileName}`);
        records.update(rec.postId, rec.originalLink, {
          newLink: existingLink,
          status: STATUS.SHARED,
          error: '',
        });
        successCount++;
        continue;
      }

      // 2. 检查记录中是否已有相同文件名的已分享/已替换记录
      const existingShared = records.data.find(r =>
        (r.postId !== rec.postId || r.originalLink !== rec.originalLink) &&
        (r.status === STATUS.SHARED || r.status === STATUS.REPLACED) &&
        r.newLink &&
        r.fileName === fileName
      );

      if (existingShared) {
        log.success(`  [查重] 匹配到已分享的记录: ${existingShared.title || existingShared.postId}`);
        records.update(rec.postId, rec.originalLink, {
          newLink: existingShared.newLink,
          status: STATUS.SHARED,
          error: '',
        });
        sharedFileNames.set(fileName, existingShared.newLink);
        successCount++;
        continue;
      }

      // 3. 按文件名精确匹配网盘中的文件
      const targetFile = fileMap.get(fileName);

      if (!targetFile) {
        log.error(`  [匹配] 网盘目录中未找到文件: ${fileName}`);
        records.update(rec.postId, rec.originalLink, {
          status: STATUS.FAILED_SHARE,
          error: `网盘中未找到文件: ${fileName}`,
        });
        failCount++;
        continue;
      }

      log.info(`  [文件] ${targetFile.filename} (fs_id: ${targetFile.fs_id})`);

      // 4. 创建分享链接
      const shareLink = await terabox.createShare([targetFile.fs_id], [targetFile.path]);

      if (shareLink && shareLink !== 'ALREADY_SHARED') {
        log.success(`  [分享] ${shareLink}`);

        // 5. 回填到当前记录
        records.update(rec.postId, rec.originalLink, {
          newLink: shareLink,
          status: STATUS.SHARED,
          error: '',
        });

        // 6. 回填到所有具有相同 fileName 的记录
        const siblings = records.findAllByFileName(fileName);
        let fillCount = 0;
        for (const sib of siblings) {
          if (sib.postId === rec.postId && sib.originalLink === rec.originalLink) continue;
          if (sib.status === STATUS.REPLACED) continue; // 已替换的不动
          records.update(sib.postId, sib.originalLink, {
            newLink: shareLink,
            status: STATUS.SHARED,
            error: '',
          });
          fillCount++;
        }
        if (fillCount > 0) {
          log.info(`  [回填] 同文件名记录 ${fillCount} 条已更新`);
        }

        sharedFileNames.set(fileName, shareLink);
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
      if (err.message === 'TASK_STOPPED') throw err;
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
