/**
 * logger.js - 统一日志模块
 * v1.0.0
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

const LOG_FILE = path.join(__dirname, '..', '..', 'data', 'logs', 'app.log');

class Logger {
  constructor() {
    this.listeners = [];
    this._ensureLogDir();
  }

  _ensureLogDir() {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _writeToFile(line) {
    try {
      fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
    } catch (e) {
      // ignore
    }
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
    const line = this._emit('info', msg);
    console.log(`${COLORS.cyan}[${this._ts()}]${COLORS.reset} ${msg}`);
  }

  success(msg) {
    const line = this._emit('success', msg);
    console.log(`${COLORS.green}[${this._ts()}] ✓${COLORS.reset} ${msg}`);
  }

  warn(msg) {
    const line = this._emit('warn', msg);
    console.log(`${COLORS.yellow}[${this._ts()}] ⚠${COLORS.reset} ${msg}`);
  }

  error(msg) {
    const line = this._emit('error', msg);
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
