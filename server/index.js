/**
 * server/index.js - Express 后端 API 服务 v4.0.0
 * 统一 settings.json 为唯一配置源，凭据加密存储，日志轮转，数据备份
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Records = require('../src/records');
const log = require('../src/lib/logger');
const state = require('../src/lib/state');
const { hashPassword, verifyPassword, generateToken, authMiddleware } = require('../src/lib/auth');
const { encrypt, decrypt, encryptSettings, decryptSettings, ENCRYPTED_KEYS } = require('../src/lib/crypto');
const teraboxApi = require('../src/lib/terabox-api');

const app = express();
const PORT = process.env.PORT || 3721;

const DATA_DIR = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SETTINGS_VERSION = 2;

app.use(cors());
app.use(express.json());

const SETTINGS_KEYS = [
  { key: 'loginPassword', label: '登录密码', type: 'password', group: 'system' },
  { key: 'wpBaseUrl', label: 'WordPress 站点地址', envKey: 'WP_BASE_URL', type: 'text', group: 'wordpress' },
  { key: 'wpUsername', label: 'WordPress 用户名', envKey: 'WP_USERNAME', type: 'text', group: 'wordpress' },
  { key: 'wpPassword', label: 'WordPress 应用密码', envKey: 'WP_PASSWORD', type: 'password', group: 'wordpress', secret: true },
  { key: 'wpAuthorId', label: 'WordPress 作者ID', envKey: 'WP_AUTHOR_ID', type: 'text', group: 'wordpress' },
  { key: 'teraboxCookie', label: 'TeraBox Cookie', envKey: 'TERABOX_COOKIE', altEnvKey: 'TERABOX_NDUS', type: 'textarea', group: 'terabox', secret: true },
  { key: 'teraboxJsToken', label: 'TeraBox jsToken', envKey: 'TERABOX_jsToken', type: 'text', group: 'terabox', secret: true },
  { key: 'teraboxBdstoken', label: 'TeraBox bdstoken', envKey: 'TERABOX_bdstoken', type: 'text', group: 'terabox', secret: true },
  { key: 'teraboxDestPath', label: 'TeraBox 目标目录', envKey: 'TERABOX_DEST_PATH', type: 'text', group: 'terabox' },
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadSettings() {
  ensureDataDir();
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return decryptSettings(raw);
    } catch { return {}; }
  }
  return {};
}

function saveSettings(settings) {
  ensureDataDir();
  const encrypted = encryptSettings(settings);
  encrypted._version = SETTINGS_VERSION;
  if (fs.existsSync(SETTINGS_FILE)) {
    fs.copyFileSync(SETTINGS_FILE, SETTINGS_FILE + '.bak');
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(encrypted, null, 2), 'utf8');
}

function applySettingsToEnv(settings) {
  for (const s of SETTINGS_KEYS) {
    if (s.envKey && settings[s.key] !== undefined && settings[s.key] !== '') {
      process.env[s.envKey] = settings[s.key];
    }
    if (s.altEnvKey && settings[s.key] !== undefined && settings[s.key] !== '') {
      process.env[s.altEnvKey] = settings[s.key];
    }
  }
}

// P1: 统一 settings.json 为唯一配置源，启动时直接读取（不从 .env 导入）
const initialSettings = loadSettings();
applySettingsToEnv(initialSettings);

app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

// ===== 公开路由（无需认证）=====

app.get('/api/init', (req, res) => {
  const settings = loadSettings();
  res.json({ initialized: !!settings.loginPassword });
});

app.post('/api/init', (req, res) => {
  const settings = loadSettings();
  if (settings.loginPassword) {
    return res.status(400).json({ error: '密码已设置' });
  }
  const { password } = req.body;
  if (!password || password.length < 4) {
    return res.status(400).json({ error: '密码至少4位' });
  }
  settings.loginPassword = hashPassword(password);
  saveSettings(settings);
  applySettingsToEnv(settings);
  const token = generateToken({ role: 'admin' });
  res.json({ token });
});

app.post('/api/login', (req, res) => {
  const settings = loadSettings();
  if (!settings.loginPassword) {
    return res.status(400).json({ error: '请先设置密码' });
  }
  const { password } = req.body;
  if (!password || !verifyPassword(password, settings.loginPassword)) {
    return res.status(401).json({ error: '密码错误' });
  }
  const token = generateToken({ role: 'admin' });
  res.json({ token });
});

app.post('/api/settings/password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const settings = loadSettings();
  if (!oldPassword || !verifyPassword(oldPassword, settings.loginPassword)) {
    return res.status(401).json({ error: '原密码错误' });
  }
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: '新密码至少4位' });
  }
  settings.loginPassword = hashPassword(newPassword);
  saveSettings(settings);
  const token = generateToken({ role: 'admin' });
  res.json({ message: '密码修改成功', token });
});

// ===== 认证路由 =====

app.get('/api/settings', authMiddleware, (req, res) => {
  const settings = loadSettings();
  const result = {};
  for (const s of SETTINGS_KEYS) {
    if (s.type === 'password') {
      result[s.key] = '';
    } else {
      result[s.key] = settings[s.key] || '';
    }
  }
  res.json({ settings: result, schema: SETTINGS_KEYS });
});

app.post('/api/settings', authMiddleware, (req, res) => {
  const settings = loadSettings();
  const body = req.body.settings || req.body;
  for (const s of SETTINGS_KEYS) {
    if (s.key === 'loginPassword') continue;
    if (body[s.key] !== undefined) {
      settings[s.key] = body[s.key];
    }
  }
  saveSettings(settings);
  applySettingsToEnv(settings);
  res.json({ message: '设置已保存' });
});

// 运行状态
let runningTask = null;
let taskLogs = [];

log.onLog(entry => {
  taskLogs.push(entry);
  if (taskLogs.length > 500) taskLogs = taskLogs.slice(-300);
});

app.get('/api/records', authMiddleware, (req, res) => {
  const records = new Records();
  records.load();
  res.json({ data: records.data, stats: records.stats() });
});

app.get('/api/stats', authMiddleware, (req, res) => {
  const records = new Records();
  records.load();
  res.json(records.stats());
});

app.get('/api/logs', authMiddleware, (req, res) => {
  const since = parseInt(req.query.since || '0');
  const filtered = taskLogs.filter(l => l.time > since);
  res.json({ logs: filtered, running: !!runningTask });
});

app.get('/api/check-account', authMiddleware, async (req, res) => {
  try {
    const result = await teraboxApi.checkAccount();
    res.json(result);
  } catch (e) {
    res.json({ ok: false, error: `检查失败: ${e.message}` });
  }
});

// API: 执行任务
app.post('/api/run/:task', authMiddleware, async (req, res) => {
  const taskName = req.params.task;
  const validTasks = ['crawl', 'sync_filename', 'transfer', 'share', 'replace', 'run'];
  if (!validTasks.includes(taskName)) {
    return res.status(400).json({ error: `无效任务: ${taskName}` });
  }
  const targetList = req.body.ids;
  if (runningTask) {
    return res.status(409).json({ error: `任务 ${runningTask} 正在运行中` });
  }

  teraboxApi.refreshConfig();
  const accountCheck = await teraboxApi.checkAccount();
  if (!accountCheck.ok) {
    return res.status(403).json({ error: `账号异常: ${accountCheck.error}` });
  }

  runningTask = taskName;
  taskLogs = [];
  state.reset();
  res.json({ message: `任务 ${taskName} 已启动` });

  try {
    if (taskName === 'run') {
      const crawl = require('../src/crawl');
      const syncFilename = require('../src/sync_filename');
      const transfer = require('../src/transfer');
      const share = require('../src/share');
      const replace = require('../src/replace');
      await crawl();
      await syncFilename();
      await transfer(targetList);
      await share(targetList);
      await replace(targetList);
    } else {
      const taskFn = require(`../src/${taskName}`);
      await taskFn(targetList);
    }
  } catch (err) {
    if (err.message === 'TASK_STOPPED') {
      log.warn('任务已被用户强行终止');
    } else {
      log.error(`任务执行失败: ${err.message}`);
    }
  } finally {
    runningTask = null;
  }
});

app.post('/api/records/update', authMiddleware, (req, res) => {
  const { postId, originalLink, fields } = req.body;
  if (!postId || !originalLink || !fields) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  const records = new Records();
  records.load();
  const ok = records.update(postId, originalLink, fields);
  if (ok) {
    records.save();
    res.json({ message: '更新成功' });
  } else {
    res.status(404).json({ error: '未找到记录' });
  }
});

app.post('/api/stop', authMiddleware, (req, res) => {
  if (!runningTask) {
    return res.status(400).json({ error: '没有正在运行的任务' });
  }
  state.stop();
  res.json({ message: '已发送终止信号' });
});

app.post('/api/reset', authMiddleware, (req, res) => {
  const { targetStatus, ids } = req.body;
  const validTargets = ['已采集', '已转存', '已分享'];
  if (!targetStatus || !validTargets.includes(targetStatus)) {
    return res.status(400).json({ error: `无效目标状态: ${targetStatus}，仅支持: ${validTargets.join(', ')}` });
  }
  const records = new Records();
  records.load();
  const count = records.resetStatus(targetStatus, ids || null);
  records.save();
  records.exportCsv();
  res.json({ message: `已重置 ${count} 条记录到 ${targetStatus}`, count });
});

app.post('/api/import', authMiddleware, (req, res) => {
  const oldFile = path.join(__dirname, '..', '..', 'box', 'all_links_table.json');
  const records = new Records();
  records.load();
  const count = records.importFromOld(oldFile);
  records.save();
  res.json({ imported: count, total: records.data.length });
});

app.post('/api/delete', authMiddleware, (req, res) => {
  const ids = req.body.ids;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: '无效请求' });
  const records = new Records();
  records.load();
  let count = 0;
  for (const id of ids) {
    if (records.remove(id.postId, id.originalLink)) count++;
  }
  records.save();
  res.json({ deleted: count });
});

app.get('/api/export', authMiddleware, (req, res) => {
  const records = new Records();
  records.load();
  const csvPath = path.join(__dirname, '..', 'data', 'records.csv');
  records.exportCsv(csvPath);
  res.download(csvPath, 'records.csv');
});

// P3: 数据备份 - 导出
app.get('/api/backup', authMiddleware, (req, res) => {
  ensureDataDir();
  const settings = loadSettings();
  const records = new Records();
  records.load();
  res.json({
    version: SETTINGS_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    records: records.data,
  });
});

// P3: 数据备份 - 导入
app.post('/api/backup', authMiddleware, (req, res) => {
  const { settings: backupSettings, records: backupRecords } = req.body;
  let imported = 0;
  if (backupSettings && typeof backupSettings === 'object') {
    const current = loadSettings();
    for (const s of SETTINGS_KEYS) {
      if (s.key === 'loginPassword') continue;
      if (backupSettings[s.key] !== undefined && backupSettings[s.key] !== '') {
        current[s.key] = backupSettings[s.key];
      }
    }
    saveSettings(current);
    applySettingsToEnv(current);
    imported++;
  }
  if (Array.isArray(backupRecords)) {
    const records = new Records();
    records.load();
    for (const r of backupRecords) {
      if (!records.exists(r.postId, r.originalLink)) {
        records.add(r);
        imported++;
      }
    }
    records.save();
  }
  res.json({ message: `导入完成，共导入 ${imported} 项`, imported });
});

// ===== 定时任务调度器 =====
const cron = require('node-cron');

let cronJob = null;

function loadScheduleConfig() {
  const settings = loadSettings();
  if (!settings.schedule) settings.schedule = { enabled: false, cron: '0 */2 * * *', lastRun: null };
  return settings.schedule;
}

function saveScheduleConfig(schedule) {
  const settings = loadSettings();
  settings.schedule = schedule;
  saveSettings(settings);
}

async function runScheduledTask() {
  if (runningTask) {
    log.info('[调度器] 跳过本次执行: 其他任务正在运行');
    return;
  }
  teraboxApi.refreshConfig();
  const accountCheck = await teraboxApi.checkAccount();
  if (!accountCheck.ok) {
    log.warn(`[调度器] 跳过执行: 账号异常 - ${accountCheck.error}`);
    return;
  }
  log.info('[调度器] 开始执行定时全流程任务');
  const startedAt = Date.now();
  runningTask = '定时全流程';
  taskLogs = [];
  state.reset();
  try {
    const crawl = require('../src/crawl');
    const syncFilename = require('../src/sync_filename');
    const transfer = require('../src/transfer');
    const share = require('../src/share');
    const replace = require('../src/replace');
    await crawl();
    await syncFilename();
    await transfer();
    await share();
    await replace();
    log.info('[调度器] 定时全流程任务执行完成');
  } catch (err) {
    if (err.message === 'TASK_STOPPED') {
      log.warn('[调度器] 定时全流程任务被终止');
    } else {
      log.error(`[调度器] 定时全流程任务执行失败: ${err.message}`);
    }
  } finally {
    runningTask = null;
    const schedule = loadScheduleConfig();
    schedule.lastRun = startedAt;
    saveScheduleConfig(schedule);
  }
}

function startCronScheduler() {
  const schedule = loadScheduleConfig();
  if (cronJob) { cronJob.stop(); cronJob = null; }
  if (schedule.enabled && schedule.cron) {
    if (!cron.validate(schedule.cron)) {
      log.warn(`[调度器] 无效的 cron 表达式: ${schedule.cron}`);
      return;
    }
    cronJob = cron.schedule(schedule.cron, () => { runScheduledTask(); }, { timezone: 'Asia/Shanghai' });
    log.info(`[调度器] 定时任务已启动: ${schedule.cron} (Asia/Shanghai)`);
  }
}

app.get('/api/schedule', authMiddleware, (req, res) => {
  const schedule = loadScheduleConfig();
  res.json({ schedule });
});

app.post('/api/schedule', authMiddleware, (req, res) => {
  const { enabled, cron: cronExpr } = req.body;
  if (cronExpr !== undefined && !cron.validate(cronExpr)) {
    return res.status(400).json({ error: '无效的 cron 表达式' });
  }
  const schedule = loadScheduleConfig();
  if (enabled !== undefined) schedule.enabled = enabled;
  if (cronExpr !== undefined) schedule.cron = cronExpr;
  saveScheduleConfig(schedule);
  startCronScheduler();
  res.json({ message: '定时任务配置已保存', schedule });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 TeraBox 网盘助手运行在 http://localhost:${PORT}\n`);
  startCronScheduler();
});