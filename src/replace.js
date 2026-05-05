/**
 * replace.js - 替换模块 v2.0.0
 * Step 6&7: 通过 WP REST API 替换原链接，并更新记录表状态
 * 
 * 记录逻辑：
 * - downloadUrl 保留采集时记录的原下载地址
 * - 替换成功后只更新状态标签，不覆盖 downloadUrl
 */
const wp = require('./lib/wp-api');
const log = require('./lib/logger');
const Records = require('./records');
const { STATUS } = Records;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function replace(targetList = null) {
  log.divider('Step 6&7: 替换链接并更新状态');

  const records = new Records();
  records.load();

  let pending = [];
  if (targetList) {
    pending = records.data.filter(r =>
      targetList.some(t => String(t.postId) === String(r.postId) && t.originalLink === r.originalLink)
    );
  } else {
    pending = records.data.filter(r =>
      (r.status === STATUS.SHARED || r.status === STATUS.FAILED_REPLACE) && r.status !== STATUS.DELETED && r.status !== STATUS.INVALID
    );
  }

  log.info(`待替换: ${pending.length} 条`);
  if (pending.length === 0) {
    log.success('没有需要替换的记录');
    return records;
  }

  let successCount = 0, failCount = 0, skipCount = 0;

  for (let i = 0; i < pending.length; i++) {
    const rec = pending[i];
    log.step(i + 1, pending.length, `替换: ${rec.title} (ID:${rec.postId})`);
    require('./lib/state').check();

    if (!rec.newLink) {
      log.warn(`  [跳过] 无新链接`);
      failCount++;
      continue;
    }

    // 查重：如果 downloadUrl 已经是新地址，跳过不替换
    if (rec.downloadUrl && rec.downloadUrl === rec.newLink) {
      log.info(`  [跳过] 下载地址已是新链接，无需替换`);
      records.update(rec.postId, rec.originalLink, {
        status: STATUS.REPLACED,
        error: '',
      });
      skipCount++;
      successCount++;
      records.save();
      continue;
    }

    // 额外检查：如果 newLink 与 originalLink 相同，也跳过
    if (rec.originalLink === rec.newLink) {
      log.info(`  [跳过] 新旧链接相同，无需替换`);
      records.update(rec.postId, rec.originalLink, {
        status: STATUS.REPLACED,
        error: '',
      });
      skipCount++;
      successCount++;
      records.save();
      continue;
    }

    try {
      const ok = await wp.updateDownloadLink(rec.postId, rec.originalLink, rec.newLink);
      if (ok) {
        log.success(`  [替换成功] ${rec.originalLink} → ${rec.newLink}`);
        records.update(rec.postId, rec.originalLink, {
          status: STATUS.REPLACED,
          error: '',
        });
        successCount++;
      } else {
        throw new Error('更新返回失败');
      }
    } catch (err) {
      if (err.message === 'TASK_STOPPED') throw err;
      log.error(`  [替换失败] ${err.message}`);
      records.update(rec.postId, rec.originalLink, {
        status: STATUS.FAILED_REPLACE,
        error: err.message,
      });
      failCount++;
    }

    records.save();
    await sleep(1000);
  }

  log.divider('替换完成');
  log.success(`成功: ${successCount} (其中跳过: ${skipCount}), 失败: ${failCount}`);

  // 导出最终 CSV
  records.exportCsv();
  log.info('已导出 records.csv');

  return records;
}

module.exports = replace;
