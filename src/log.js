// Logger simple: consola + un único archivo por ejecución (run.log). Los loggers
// hijos (por clínica) comparten el mismo stream del padre. Tacha cualquier secreto
// del .env que aparezca en un mensaje para que nunca quede escrito en disco.
import fs from 'node:fs';
import path from 'node:path';
import { secretValues } from './config.js';

function nowIso() {
  return new Date().toISOString();
}

export function redact(text) {
  let out = String(text);
  for (const secret of secretValues()) {
    if (secret && out.includes(secret)) out = out.split(secret).join('***');
  }
  return out;
}

function buildLogger(stream, filePath, scope) {
  function write(level, message, extra) {
    const line = `${nowIso()} [${level}] [${scope}] ${redact(message)}`;
    const detail = extra !== undefined ? ' ' + redact(typeof extra === 'string' ? extra : JSON.stringify(extra)) : '';
    stream.write(line + detail + '\n');
    const printer = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
    printer(line + detail);
  }
  return {
    filePath,
    info: (message, extra) => write('INFO', message, extra),
    warn: (message, extra) => write('WARN', message, extra),
    error: (message, extra) => write('ERROR', message, extra),
    step: (message) => write('STEP', message),
    child: (childScope) => buildLogger(stream, filePath, `${scope}:${childScope}`),
    close: () => new Promise((resolve) => stream.end(resolve)),
  };
}

export function createLogger(runDir, scope = 'run') {
  fs.mkdirSync(runDir, { recursive: true });
  const filePath = path.join(runDir, 'run.log');
  const stream = fs.createWriteStream(filePath, { flags: 'a' });
  return buildLogger(stream, filePath, scope);
}
