// Sincronización con GitHub al terminar la carga.
//
// Reglas acordadas con el equipo:
//  - En los repos del producto SOLO se traen los cambios de los compañeros
//    (fast-forward). Nunca se hace merge automático, force push ni reescritura.
//  - Si un repo del producto tiene cambios locales sin commit, NO se toca y se
//    informa (puede ser trabajo de alguien en este equipo).
//  - Solo se hace commit de archivos nuestros: los listados en data/our-files.json
//    (por repo). Si no hay lista, no se commitea nada en ese repo.
//  - Ante divergencia o conflicto: se detiene y se informa.
//  - Este repo de automatización sí se commitea completo y se sube si tiene remoto.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const run = promisify(execFile);

const DESKTOP = path.join(os.homedir(), 'OneDrive - rids.cl', 'Escritorio');
const DEFAULT_REPOS = ['dentalcloud-front', 'dentalcloud-backend', 'Dental-Demo', 'Dental-Demo-Back'].map((name) =>
  path.join(DESKTOP, name)
);

async function git(cwd, args) {
  try {
    const { stdout } = await run('git', args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim();
    throw new Error(`git ${args.join(' ')} → ${detail}`);
  }
}

function loadOurFiles() {
  const file = path.join(config.dirs.data, 'our-files.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Sincroniza un repo del producto. Devuelve un resumen para el informe. */
async function syncProductRepo(repoPath, ourFiles, log) {
  const name = path.basename(repoPath);
  const result = { repo: name, path: repoPath, action: 'nada', ok: true, detail: '' };
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    result.ok = false;
    result.detail = 'no es un repositorio git';
    return result;
  }

  const branch = await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = await git(repoPath, ['status', '--porcelain', '--untracked-files=no']);
  const dirtyFiles = dirty ? dirty.split('\n').map((l) => l.slice(3).trim()) : [];
  const allowed = new Set(ourFiles[name] || []);
  const foreignChanges = dirtyFiles.filter((f) => !allowed.has(f));
  const ourChanges = dirtyFiles.filter((f) => allowed.has(f));

  if (foreignChanges.length) {
    result.ok = false;
    result.action = 'omitido';
    result.detail = `cambios locales sin commit que no son nuestros (${foreignChanges.length}): ${foreignChanges.slice(0, 5).join(', ')}`;
    log.warn(`[${name}] ${result.detail}. No se toca.`);
    return result;
  }

  await git(repoPath, ['fetch', 'origin', branch]);
  const before = await git(repoPath, ['rev-parse', 'HEAD']);

  if (ourChanges.length) {
    await git(repoPath, ['add', '--', ...ourChanges]);
    await git(repoPath, ['commit', '-m', `chore(carga-diaria): actualiza ${ourChanges.length} archivo(s) de automatización`]);
    log.info(`[${name}] commit de ${ourChanges.length} archivo(s) nuestros.`);
  }

  try {
    await git(repoPath, ['pull', '--ff-only', 'origin', branch]);
  } catch (err) {
    // Divergencia: hay commits locales y remotos distintos. No se resuelve solo.
    result.ok = false;
    result.action = 'conflicto';
    result.detail = `no se pudo hacer fast-forward: ${err.message}`;
    log.error(`[${name}] ${result.detail}`);
    return result;
  }

  const after = await git(repoPath, ['rev-parse', 'HEAD']);
  const ahead = Number(await git(repoPath, ['rev-list', '--count', `origin/${branch}..HEAD`]));
  if (ahead > 0) {
    await git(repoPath, ['push', 'origin', branch]);
    result.action = 'commit y push';
    log.info(`[${name}] push de ${ahead} commit(s).`);
  } else {
    result.action = before === after ? 'ya al día' : 'actualizado desde GitHub';
  }
  result.detail = `${branch} ${before.slice(0, 7)} → ${after.slice(0, 7)}`;
  log.info(`[${name}] ${result.action} (${result.detail}).`);
  return result;
}

/** Commit de este proyecto (scripts, docs, registro NO: está en .gitignore). */
async function syncSelf(log, message) {
  const repoPath = config.dirs.root;
  const result = { repo: path.basename(repoPath), path: repoPath, action: 'nada', ok: true, detail: '' };
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    await git(repoPath, ['init']);
    log.info('[dental-carga-diaria] repositorio git inicializado.');
  }
  const status = await git(repoPath, ['status', '--porcelain']);
  if (status) {
    await git(repoPath, ['add', '-A']);
    await git(repoPath, ['commit', '-m', message]);
    result.action = 'commit';
  }
  const remotes = await git(repoPath, ['remote']);
  if (remotes.includes('origin')) {
    const branch = await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    try {
      await git(repoPath, ['pull', '--ff-only', 'origin', branch]);
      await git(repoPath, ['push', 'origin', branch]);
      result.action = result.action === 'commit' ? 'commit y push' : 'push';
    } catch (err) {
      result.ok = false;
      result.detail = err.message;
    }
  } else {
    result.detail = 'sin remoto configurado (solo commit local)';
  }
  log.info(`[dental-carga-diaria] ${result.action} ${result.detail}`.trim());
  return result;
}

export async function gitSync({ log, message = 'chore: carga diaria' } = {}) {
  const repos = (process.env.GIT_REPOS ? process.env.GIT_REPOS.split(';') : DEFAULT_REPOS).map((p) => p.trim()).filter(Boolean);
  const ourFiles = loadOurFiles();
  const results = [];
  for (const repo of repos) {
    try {
      results.push(await syncProductRepo(repo, ourFiles, log));
    } catch (err) {
      results.push({ repo: path.basename(repo), path: repo, action: 'error', ok: false, detail: err.message });
      log.error(`[${path.basename(repo)}] ${err.message}`);
    }
  }
  try {
    results.push(await syncSelf(log, message));
  } catch (err) {
    results.push({ repo: 'dental-carga-diaria', path: config.dirs.root, action: 'error', ok: false, detail: err.message });
    log.error(`[dental-carga-diaria] ${err.message}`);
  }
  return results;
}

// Uso directo: node src/git-sync.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const log = { info: console.log, warn: console.warn, error: console.error };
  gitSync({ log }).then((r) => console.table(r.map(({ repo, action, ok, detail }) => ({ repo, action, ok, detail }))));
}
