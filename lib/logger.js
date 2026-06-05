/**
 * NOTEtoolsLM v2 — Structured Logger
 * JSON-formatted logs with levels and request IDs.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const ENV_LEVEL = process.env.LOG_LEVEL || 'info';
const MIN_LEVEL = LEVELS[ENV_LEVEL] ?? 1;

class Logger {
  constructor(context = 'app') {
    this.context = context;
  }

  _log(level, message, meta = {}) {
    if (LEVELS[level] < MIN_LEVEL) return;
    const entry = {
      time: new Date().toISOString(),
      level,
      context: this.context,
      message,
      ...meta
    };
    const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    out.write(JSON.stringify(entry) + '\n');
  }

  debug(msg, meta) { this._log('debug', msg, meta); }
  info(msg, meta) { this._log('info', msg, meta); }
  warn(msg, meta) { this._log('warn', msg, meta); }
  error(msg, meta) { this._log('error', msg, meta); }
}

module.exports = { Logger };
