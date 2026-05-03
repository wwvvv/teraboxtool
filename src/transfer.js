/**
 * transfer.js - 转存模块 v1.0.0
 * Step 4: 通过 TeraBox API 批量转存原网盘链接到自己账号
 */
const terabox = require('./lib/terabox-api');
const log = require('./lib/logger');
const Records = require('./records');
const { STATUS } = Records;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function transfer(targetList = null) {
  log.divider('Step 4: 批量转存 TeraBox 链接');

  const records = new Records();
  records.load();

  // 筛选待转存的记录
  let pending = [];
  if (targetList) {
    // 如果指定了列表，则只处理列表中的（只要不是已替换状态）
    pending = records.data.filter(r => 
      targetList.some(t => String(t.postId) === String(r.postId) && t.originalLink === r.originalLink)
    );
  } else {
    // 否则按默认逻辑筛选
    pending = records.data.filter(r =>
      r.status === STATUS.CRAWLED || r.status === STATUS.FAILED_TRANSFER
    );
  }

  log.info(`待转存: ${pending.length} 条`);
  if (pending.length === 0) {
    log.success('没有需要转存的记录');
    return records;
  }

  let successCount = 0, failCount = 0;

  for (let i = 0; i < pending.length; i++) {
    const rec = pending[i];
    log.step(i + 1, pending.length, `转存: ${rec.title}`);
    require('./lib/state').check();

    let retries = 3;
    while (retries > 0) {
      try {
        // 1. 获取分享信息
        log.info(`  [解析] ${rec.originalLink}`);
        const shareInfo = await terabox.getShareInfo(rec.originalLink);
        log.info(`  [分享] shareid=${shareInfo.shareid}, 文件数=${shareInfo.files.length}`);

        // 2. 转存到自己网盘
        const result = await terabox.transfer(shareInfo, rec.password);
        if (result.success) {
          log.success(`  [转存成功] errno=${result.errno}`);
          records.update(rec.postId, rec.originalLink, {
            status: STATUS.TRANSFERRED,
            error: '',
          });
          successCount++;
          break;
        }
      } catch (err) {
        retries--;
        log.error(`  [转存失败] ${err.message} (剩余重试: ${retries})`);
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

    // 限速：随机 5-15 秒间隔
    const delay = Math.floor(Math.random() * 10000) + 5000;
    log.info(`  等待 ${Math.round(delay / 1000)} 秒...`);
    await sleep(delay);
  }

  log.divider('转存完成');
  log.success(`成功: ${successCount}, 失败: ${failCount}`);
  return records;
}

module.exports = transfer;
