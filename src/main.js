/**
 * main.js - CLI 入口 v2.0.0
 * Usage: node src/main.js [crawl|transfer|share|replace|run|status|import]
 */
const fs = require('fs');
const path = require('path');
const log = require('./lib/logger');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');
const ENV_MAP = {
  wpBaseUrl: 'WP_BASE_URL',
  wpUsername: 'WP_USERNAME',
  wpPassword: 'WP_PASSWORD',
  wpAuthorId: 'WP_AUTHOR_ID',
  teraboxCookie: 'TERABOX_COOKIE',
  teraboxJsToken: 'TERABOX_jsToken',
  teraboxBdstoken: 'TERABOX_bdstoken',
  teraboxDestPath: 'TERABOX_DEST_PATH',
};
const ALT_ENV_MAP = { teraboxCookie: 'TERABOX_NDUS' };

function loadSettingsToEnv() {
  if (!fs.existsSync(SETTINGS_FILE)) return;
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    for (const [key, envKey] of Object.entries(ENV_MAP)) {
      if (settings[key] && !process.env[envKey]) {
        process.env[envKey] = settings[key];
      }
    }
    for (const [key, altKey] of Object.entries(ALT_ENV_MAP)) {
      if (settings[key] && !process.env[altKey]) {
        process.env[altKey] = settings[key];
      }
    }
  } catch {}
}

loadSettingsToEnv();

const VERSION = '2.3.0';

async function main() {
  const cmd = process.argv[2];

  console.log(`\n🔧 TeraBox 网盘助手 v${VERSION}\n`);

  switch (cmd) {
    case 'crawl': {
      const crawl = require('./crawl');
      await crawl();
      break;
    }
    case 'transfer': {
      const transfer = require('./transfer');
      await transfer();
      break;
    }
    case 'share': {
      const share = require('./share');
      await share();
      break;
    }
    case 'replace': {
      const replace = require('./replace');
      await replace();
      break;
    }
    case 'run': {
      log.divider('全流程执行开始');
      const crawl = require('./crawl');
      const syncFilename = require('./sync_filename');
      const transfer = require('./transfer');
      const share = require('./share');
      const replace = require('./replace');

      await crawl();
      await syncFilename();
      await transfer();
      await share();
      await replace();

      log.divider('全流程执行完毕');
      break;
    }
    case 'status': {
      const Records = require('./records');
      const records = new Records();
      records.load();
      const stats = records.stats();
      console.log('\n📊 记录表状态:\n');
      console.log(`  总计: ${stats.total} 条`);
      Object.keys(stats).forEach(k => {
        if (k !== 'total') console.log(`  ${k}: ${stats[k]}`);
      });
      console.log('');
      break;
    }
    case 'import': {
      const Records = require('./records');
      const oldFile = process.argv[3] || path.join(__dirname, '..', '..', 'box', 'all_links_table.json');
      const records = new Records();
      records.load();
      const count = records.importFromOld(oldFile);
      records.save();
      log.success(`从旧数据导入了 ${count} 条记录 (总计 ${records.data.length} 条)`);
      break;
    }
    default:
      console.log('Usage: node src/main.js [command]\n');
      console.log('Commands:');
      console.log('  crawl      采集文章中的 TeraBox 链接');
      console.log('  transfer   批量转存到自己的 TeraBox 账号');
      console.log('  share      为转存的文件创建分享链接');
      console.log('  replace    替换 WordPress 文章中的旧链接');
      console.log('  run        全流程一键执行 (crawl → sync → transfer → share → replace)');
      console.log('  status     查看记录表状态');
      console.log('  import     导入旧数据 (可选参数: JSON文件路径)');
      console.log('');
  }
}

main().catch(err => {
  log.error(`致命错误: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});