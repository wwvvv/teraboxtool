/**
 * logger.js - 统一日志模块 v2.0.0
 * 支持按日期轮转，保留7天
 */

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'data', 'logs');
const MAX_DAYS = 7;

class Logger {
  constructor() {
    this.listeners = [];
    this._currentDate = '';
    this._ensureLogDir();
    this._cleanOldLogs();
  }

  _ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  _cleanOldLogs() {
    try {
      const files = fs.readdirSync(LOG_DIR);
      const now = Date.now();
      for (const f of files) {
        const match = f.match(/^app\.(\d{4}-\d{2}-\d{2})\.log$/);
        if (match) {
          const fileDate = new Date(match[1]);
          if (now - fileDate.getTime() > MAX_DAYS * 24 * 60 * 60 * 1000) {
            fs.unlinkSync(path.join(LOG_DIR, f));
          }
        }
      }
    } catch {}
  }

  _getLogFile() {
    const today = new Date().toISOString().slice(0, 10);
    return path.join(LOG_DIR, `app.${today}.log`);
  }

  _writeToFile(line) {
    try {
      fs.appendFileSync(this._getLogFile(), line + '\n', 'utf8');
    } catch {}
  }

  _ts() {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false });
  }

  _emit(level, msg) {
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`;
    this._writeToFile(line);
    this.listeners.forEach(fn => fn({ level, message: `[${this._ts()}] ${msg}`, raw: msg, time: Date.now() }));
    return line;
  }

  info(msg) {
    this._emit('info', msg);
    console.log(`${COLORS.cyan}[${this._ts()}]${COLORS.reset} ${msg}`);
  }

  success(msg) {
    this._emit('success', msg);
    console.log(`${COLORS.green}[${this._ts()}] ✓${COLORS.reset} ${msg}`);
  }

  warn(msg) {
    this._emit('warn', msg);
    console.log(`${COLORS.yellow}[${this._ts()}] ⚠${COLORS.reset} ${msg}`);
  }

  error(msg) {
    this._emit('error', msg);
    console.error(`${COLORS.red}[${this._ts()}] ✗${COLORS.reset} ${msg}`);
  }

  step(current, total, msg) {
    const pct = Math.round((current / total) * 100);
    const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
    const line = `[${current}/${total}] ${bar} ${pct}% ${msg}`;
    this._emit('progress', line);
    console.log(`${COLORS.blue}[${this._ts()}]${COLORS.reset} [${current}/${total}] ${bar} ${pct}% ${msg}`);
  }

  divider(title) {
    const line = `\n${'═'.repeat(20)} ${title} ${'═'.repeat(20)}\n`;
    console.log(`\n${COLORS.magenta}${'═'.repeat(20)} ${title} ${'═'.repeat(20)}${COLORS.reset}\n`);
    this._writeToFile(line);
    this._emit('divider', title);
  }

  onLog(fn) {
    this.listeners.push(fn);
  }
}

module.exports = new Logger();