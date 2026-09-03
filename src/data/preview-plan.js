// CLI de vista previa: construye un plan sin consultar el registro real,
// materializa los assets en assets/generated/preview/ y escribe el JSON.
//   node src/data/preview-plan.js --clinics 1 --patients 10 --seed 42 [--date 2026-09-04]
import fs from 'node:fs';
import path from 'node:path';
import { config, todayKey } from '../config.js';
import { buildDailyPlan, materializeAssets, summarizePlan } from './generator.js';

function parseArgs(argv) {
  const args = { clinics: 1, patients: 10, seed: 42, date: todayKey(), skipAssets: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--clinics') args.clinics = Number(next());
    else if (arg === '--patients') args.patients = Number(next());
    else if (arg === '--seed') {
      const raw = next();
      args.seed = /^\d+$/.test(raw) ? Number(raw) : raw;
    } else if (arg === '--date') args.date = next();
    else if (arg === '--skip-assets') args.skipAssets = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Uso: node src/data/preview-plan.js [--clinics N] [--patients N] [--seed S] [--date YYYY-MM-DD] [--skip-assets]');
      process.exit(0);
    } else throw new Error(`Argumento desconocido: ${arg}`);
  }
  if (!Number.isInteger(args.clinics) || args.clinics < 1) throw new Error('--clinics debe ser un entero >= 1');
  if (!Number.isInteger(args.patients) || args.patients < 1) throw new Error('--patients debe ser un entero >= 1');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = 'preview';
  const started = Date.now();

  const plan = buildDailyPlan({
    runId,
    date: args.date,
    clinicsCount: args.clinics,
    patientsTotal: args.patients,
    photoRatio: config.photoRatio,
    used: { ruts: new Set(), emails: new Set() },
    config,
    seed: args.seed,
  });

  const outDir = path.join(config.dirs.generated, runId);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  let assets = { files: [], dir: outDir };
  if (!args.skipAssets) {
    assets = await materializeAssets(plan, { config });
  }

  fs.mkdirSync(config.dirs.reports, { recursive: true });
  const reportPath = path.join(config.dirs.reports, 'preview-plan.json');
  fs.writeFileSync(reportPath, JSON.stringify(plan, null, 2), 'utf8');

  const summary = summarizePlan(plan);
  console.log(`\nPlan de vista previa (seed=${args.seed}, fecha=${args.date}) generado en ${Date.now() - started} ms`);
  console.log(`JSON: ${reportPath}`);
  console.log(`Assets: ${assets.files.length} archivos en ${assets.dir}`);
  console.log('\nResumen:');
  console.log(JSON.stringify(summary, null, 2));

  // Verificación de que todos los assets referenciados existen y pesan > 0.
  const missing = [];
  for (const rel of assets.files) {
    const absPath = path.isAbsolute(rel) ? rel : path.join(config.dirs.root, rel);
    if (!fs.existsSync(absPath) || fs.statSync(absPath).size === 0) missing.push(rel);
  }
  if (missing.length) {
    console.error(`\nAssets faltantes o vacíos (${missing.length}):\n  ${missing.join('\n  ')}`);
    process.exitCode = 1;
  } else if (assets.files.length) {
    console.log(`\nTodos los assets existen y pesan más de 0 bytes.`);
  }
}

main().catch((err) => {
  console.error(`Error en preview-plan: ${err.stack || err.message}`);
  process.exit(1);
});
