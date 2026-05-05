/**
 * server/index.js - Express 后端 API 服务 v2.0.0
 * 提供 REST API 给 Vue 前端调用
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Records = require('../src/records');
const log = require('../src/lib/logger');
const state = require('../src/lib/state');

const app = express();
const PORT = process.env.PORT || 3721;

app.use(cors());
app.use(express.json());

// 静态文件服务 Vue 构建产物
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

// 运行状态
let runningTask = null;
let taskLogs = [];

// 日志监听
log.onLog(entry => {
  taskLogs.push(entry);
  if (taskLogs.length > 500) taskLogs = taskLogs.slice(-300);
});

// API: 获取记录表
app.get('/api/records', (req, res) => {
  const records = new Records();
  records.load();
  res.json({ data: records.data, stats: records.stats() });
});

// API: 获取状态统计
app.get('/api/stats', (req, res) => {
  const records = new Records();
  records.load();
  res.json(records.stats());
});

// API: 获取日志
app.get('/api/logs', (req, res) => {
  const since = parseInt(req.query.since || '0');
  const filtered = taskLogs.filter(l => l.time > since);
  res.json({ logs: filtered, running: !!runningTask });
});

// API: 执行任务
app.post('/api/run/:task', async (req, res) => {
  const taskName = req.params.task;
  const validTasks = ['crawl', 'sync_filename', 'transfer', 'share', 'replace', 'run'];
  if (!validTasks.includes(taskName)) {
    return res.status(400).json({ error: `无效任务: ${taskName}` });
  }
  const targetList = req.body.ids; // [{postId, originalLink}, ...]
  if (runningTask) {
    return res.status(409).json({ error: `任务 ${runningTask} 正在运行中` });
  }

  runningTask = taskName;
  taskLogs = [];
  state.reset();
  res.json({ message: `任务 ${taskName} 已启动` });

  // 异步执行
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

// API: 更新单条记录
app.post('/api/records/update', (req, res) => {
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

// API: 强行终止任务
app.post('/api/stop', (req, res) => {
  if (!runningTask) {
    return res.status(400).json({ error: '没有正在运行的任务' });
  }
  state.stop();
  res.json({ message: '已发送终止信号' });
});

// API: 批量重置状态
app.post('/api/reset', (req, res) => {
  const { targetStatus, ids } = req.body;
  const validTargets = ['已采集', '已转存'];
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

// API: 导入旧数据
app.post('/api/import', (req, res) => {
  const oldFile = path.join(__dirname, '..', '..', 'box', 'all_links_table.json');
  const records = new Records();
  records.load();
  const count = records.importFromOld(oldFile);
  records.save();
  res.json({ imported: count, total: records.data.length });
});

// API: 删除记录
app.post('/api/delete', (req, res) => {
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

// API: 导出 CSV
app.get('/api/export', (req, res) => {
  const records = new Records();
  records.load();
  const csvPath = path.join(__dirname, '..', 'data', 'records.csv');
  records.exportCsv(csvPath);
  res.download(csvPath, 'records.csv');
});

// Vue SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 TeraBox 管理面板运行在 http://localhost:${PORT}\n`);
});
