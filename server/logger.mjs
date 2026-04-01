/**
 * 统一日志模块
 *
 * 用法：
 *   import { createLogger } from '../logger.mjs';
 *   const log = createLogger('csv-manager');
 *
 *   log.debug('详细计算', { rows: 500 });
 *   log.info('数据加载完成', { symbol: '000300.SH', rows: 5158 });
 *   log.warn('akshare 返回空，降级到 EM fallback');
 *   log.error('Tushare API 失败', { status: 429 });
 *   log.fatal('无法启动服务', { port: 3001 });
 *
 * 环境变量：
 *   LOG_LEVEL=DEBUG|INFO|WARN|ERROR|FATAL  （默认 INFO）
 *   LOG_FILE=logs/server.log               （可选，同时写文件）
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ── 级别定义 ────────────────────────────────────────────────────
const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };

const LEVEL_LABELS = {
  0: 'DEBUG',
  1: 'INFO ',
  2: 'WARN ',
  3: 'ERROR',
  4: 'FATAL',
};

// ANSI 颜色（终端输出）
const COLORS = {
  DEBUG: '\x1b[90m',   // 灰色
  INFO:  '\x1b[37m',   // 白色
  WARN:  '\x1b[33m',   // 黄色
  ERROR: '\x1b[31m',   // 红色
  FATAL: '\x1b[1;31m', // 粗体红色
  RESET: '\x1b[0m',
};

// ── 全局配置 ────────────────────────────────────────────────────
const envLevel = (process.env.LOG_LEVEL ?? 'INFO').toUpperCase();
let currentLevel = LEVELS[envLevel] ?? LEVELS.INFO;

const logFile = process.env.LOG_FILE ?? null;
if (logFile) {
  try { mkdirSync(dirname(logFile), { recursive: true }); } catch { /* ok */ }
}

// 检测是否支持颜色（TTY 且未禁用）
const useColor = process.stdout.isTTY && process.env.NO_COLOR == null;

// ── 工具函数 ────────────────────────────────────────────────────

/** 将元数据对象格式化为内联 key=value 字符串 */
function formatMeta(meta) {
  if (!meta || typeof meta !== 'object') return '';
  return Object.entries(meta)
    .map(([k, v]) => {
      const val = v === null ? 'null'
        : v === undefined ? 'undefined'
        : typeof v === 'object' ? JSON.stringify(v)
        : String(v);
      return `${k}=${val}`;
    })
    .join(' ');
}

/** 当前时间戳字符串 */
function timestamp() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

/** 模块名固定宽度 14 字符 */
function padModule(name) {
  return name.length >= 14 ? name.slice(0, 14) : name.padEnd(14);
}

// ── 核心输出 ────────────────────────────────────────────────────

function emit(levelNum, module, message, meta) {
  if (levelNum < currentLevel) return;

  const levelName = LEVEL_LABELS[levelNum];
  const ts = timestamp();
  const mod = padModule(module);
  const metaStr = meta ? ` ${formatMeta(meta)}` : '';
  const plain = `${ts} [${levelName}] [${mod}] ${message}${metaStr}`;

  if (useColor) {
    const color = COLORS[levelName.trim()] ?? COLORS.RESET;
    process.stdout.write(`${color}${plain}${COLORS.RESET}\n`);
  } else {
    process.stdout.write(`${plain}\n`);
  }

  if (logFile) {
    try { appendFileSync(logFile, `${plain}\n`); } catch { /* ignore write errors */ }
  }
}

// ── 公共 API ────────────────────────────────────────────────────

/**
 * 创建带模块标签的 logger
 * @param {string} module - 模块名（最多14字符，超出截断）
 */
export function createLogger(module) {
  return {
    debug: (msg, meta) => emit(LEVELS.DEBUG, module, msg, meta),
    info:  (msg, meta) => emit(LEVELS.INFO,  module, msg, meta),
    warn:  (msg, meta) => emit(LEVELS.WARN,  module, msg, meta),
    error: (msg, meta) => emit(LEVELS.ERROR, module, msg, meta),
    fatal: (msg, meta) => emit(LEVELS.FATAL, module, msg, meta),
  };
}

/** 动态调整全局日志级别（运行时可调用） */
export function setLogLevel(level) {
  const n = LEVELS[level?.toUpperCase()];
  if (n != null) currentLevel = n;
}

/** 获取当前级别名称 */
export function getLogLevel() {
  return Object.keys(LEVELS).find((k) => LEVELS[k] === currentLevel) ?? 'INFO';
}
