// Tiny dependency-free leveled logger, same shape as the other consumers here.
//
// The original outage on this box was a consumer that logged a line per
// firehose event and grew /var/log/syslog past 2 GB. Per-event chatter stays at
// debug; production runs at info and is nearly silent.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };

const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = LEVELS[envLevel] ?? LEVELS.info;
const asJson = String(process.env.LOG_JSON || 'false').toLowerCase() === 'true';

function emit(level, msg, fields) {
  if (LEVELS[level] > threshold) return;
  const out =
    level === 'error' || level === 'warn' ? console.error : console.log;
  if (asJson) {
    out(JSON.stringify({ level, msg, ...(fields || {}) }));
    return;
  }
  let line = `[${level.toUpperCase()}] ${msg}`;
  if (fields && Object.keys(fields).length) {
    line += ` { ${Object.entries(fields)
      .map(([k, v]) => {
        if (v instanceof Error) return `${k}=${v.message}`;
        if (typeof v === 'object' && v !== null)
          return `${k}=${JSON.stringify(v)}`;
        return `${k}=${v}`;
      })
      .join(', ')} }`;
  }
  out(line);
}

export const logger = {
  error: (msg, fields) => emit('error', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  debug: (msg, fields) => emit('debug', msg, fields),
  trace: (msg, fields) => emit('trace', msg, fields),
  level: envLevel,
};
