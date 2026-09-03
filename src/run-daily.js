// Orquestador de la carga diaria.
//
//   node src/run-daily.js                         → 10 clínicas / 300 pacientes (según .env)
//   node src/run-daily.js --clinics 1 --patients 10 --tag prueba
//   node src/run-daily.js --resume 2026-09-04_0830  → continúa un plan interrumpido
//   Opciones: --seed N  --no-git  --only-setup  --deadline HH:MM (por defecto 17:45)
//
// Fases: plan → assets → superadmin (holdings + federación + módulos) →
// por clínica en paralelo (admin configura, operador/odontólogos/admin pueblan) →
// informe → sincronización con GitHub.
import fs from 'node:fs';
import path from 'node:path';
import { config, todayKey, makeRunId } from './config.js';
import { createLogger } from './log.js';
import { loadRegistry, saveRegistry, usedSets, reserve, upsertClinic } from './registry.js';
import { launchBrowser, openSession } from './browser.js';
import { buildDailyPlan, materializeAssets, summarizePlan } from './data/generator.js';
import * as superadmin from './pages/superadmin.js';
import { setupClinic } from './flows/clinic-setup.js';
import { populateClinic } from './flows/clinic-populate.js';
import { writeReport, emptyCounts, mergeCounts } from './report.js';
import { writeWordReport } from './word-report.js';
import { gitSync } from './git-sync.js';

function parseArgs(argv) {
  const args = {
    clinics: config.clinicsPerDay,
    patients: config.patientsPerDay,
    parallel: config.parallelClinics,
    seed: null,
    tag: '',
    git: true,
    resume: null,
    onlySetup: false,
    deadline: process.env.DEADLINE || '17:45',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--clinics') args.clinics = Number(next());
    else if (a === '--patients') args.patients = Number(next());
    else if (a === '--parallel') args.parallel = Number(next());
    else if (a === '--seed') args.seed = Number(next());
    else if (a === '--tag') args.tag = String(next()).replace(/[^a-z0-9_-]/gi, '');
    else if (a === '--no-git') args.git = false;
    else if (a === '--only-setup') args.onlySetup = true;
    else if (a === '--resume') args.resume = next();
    else if (a === '--deadline') args.deadline = next();
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  return args;
}

function chileHHMM(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const runId = args.resume || makeRunId(startedAt) + (args.tag ? `_${args.tag}` : '');
  const runDir = path.join(config.dirs.reports, runId);
  const planPath = path.join(runDir, 'plan.json');
  const log = createLogger(runDir);
  log.info(`Inicio de la carga ${runId}`, { clinics: args.clinics, patients: args.patients, parallel: args.parallel, deadline: args.deadline, resume: Boolean(args.resume) });

  // Verificación temprana de credenciales (sin registrarlas).
  config.superadminEmail();
  config.superadminPassword();
  config.defaultUserPassword();

  const registry = loadRegistry();
  let plan;
  const savePlan = () => fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');

  if (args.resume) {
    if (!fs.existsSync(planPath)) throw new Error(`No existe el plan a reanudar: ${planPath}`);
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    log.info(`Plan reanudado con ${plan.clinics.length} clínicas.`);
  } else {
    const used = usedSets(registry);
    plan = buildDailyPlan({
      runId,
      date: todayKey(startedAt),
      clinicsCount: args.clinics,
      patientsTotal: args.patients,
      photoRatio: config.photoRatio,
      used,
      config,
      seed: args.seed ?? Date.now(),
    });
    const ruts = [];
    const emails = [];
    for (const c of plan.clinics) {
      ruts.push(c.rut);
      emails.push(c.admin.email);
      if (c.admin.rut) ruts.push(c.admin.rut);
      for (const u of c.users || []) {
        if (u.rut) ruts.push(u.rut);
        emails.push(u.email);
      }
      for (const p of c.patients || []) {
        ruts.push(p.rut);
        if (p.email) emails.push(p.email);
      }
    }
    reserve(registry, { ruts, emails });
    saveRegistry(registry);
    savePlan();
    log.info('Plan generado', summarizePlan(plan));
    log.step('Generando logos, fotos y documentos');
    await materializeAssets(plan, { log });
    savePlan();
  }

  const shouldStop = () => chileHHMM() >= args.deadline;
  const results = new Map();
  for (const c of plan.clinics) {
    results.set(c.key, { key: c.key, name: c.name, id: c.id || null, federated: Boolean(c.federated), status: 'pendiente', counts: emptyCounts(), errors: [] });
  }
  const makeCtx = (clinic) => {
    const res = results.get(clinic.key);
    return {
      runId,
      log: log.child(clinic.key),
      config,
      clinic,
      counts: res.counts,
      errors: res.errors,
      savePlan,
      shouldStop,
      deadlineHit: false,
      resolveUser: (key) => (key === 'admin' ? clinic.admin : (clinic.users || []).find((u) => u.key === key)),
      resolvePatient: (key) => (clinic.patients || []).find((p) => p.key === key),
      resolveChair: (number) => (clinic.chairs || []).find((c) => c.number === number),
    };
  };
  const recordClinic = (clinic) => {
    const res = results.get(clinic.key);
    res.id = clinic.id || null;
    res.federated = Boolean(clinic.federated);
    upsertClinic(registry, {
      runId,
      key: clinic.key,
      id: clinic.id || null,
      name: clinic.name,
      rut: clinic.rut,
      tipo: clinic.tipo,
      date: plan.date,
      adminEmail: clinic.admin.email,
      federated: Boolean(clinic.federated),
      users: (clinic.users || []).map((u) => ({ email: u.email, role: u.role, created: Boolean(u.done) })),
      patientsCreated: (clinic.patients || []).filter((p) => p.id).length,
      patientsPlanned: (clinic.patients || []).length,
      status: res.status,
      updatedAt: new Date().toISOString(),
    });
    saveRegistry(registry);
    savePlan();
  };

  const browser = await launchBrowser();
  let deadlineHit = false;
  try {
    // ---------- Fase 1: superadmin ----------
    log.step('Fase 1: superadmin crea holdings, federación y módulos');
    const sa = await openSession(browser, {
      baseURL: config.dentalcloudUrl,
      email: config.superadminEmail(),
      password: config.superadminPassword(),
      storageKey: 'superadmin',
      log,
    });
    try {
      for (const clinic of plan.clinics) {
        if (shouldStop()) {
          deadlineHit = true;
          log.warn('Hora límite alcanzada antes de crear todos los holdings.');
          break;
        }
        const res = results.get(clinic.key);
        const ctx = makeCtx(clinic);
        try {
          if (!clinic.id) {
            await superadmin.createHolding(sa.page, clinic, ctx);
            res.counts.holdings.ok += 1;
          }
          if (!clinic.federated) {
            try {
              await superadmin.configureFederation(sa.page, clinic, ctx);
              res.counts.federation.ok += 1;
            } catch (err) {
              res.counts.federation.fail += 1;
              res.errors.push({ entity: 'federation', ref: clinic.name, message: err.message });
              ctx.log.error(`Federación falló: ${err.message}`);
            }
          }
          if (!clinic.modulesDone) {
            try {
              await superadmin.enableAllModules(sa.page, clinic, ctx);
              clinic.modulesDone = true;
              res.counts.modules.ok += 1;
            } catch (err) {
              res.counts.modules.fail += 1;
              res.errors.push({ entity: 'modules', ref: clinic.name, message: err.message });
              ctx.log.error(`Módulos fallaron: ${err.message}`);
            }
          }
          res.status = 'holding_listo';
        } catch (err) {
          res.counts.holdings.fail += 1;
          res.status = 'error_holding';
          res.errors.push({ entity: 'holdings', ref: clinic.name, message: err.message });
          ctx.log.error(`Holding falló: ${err.message}`);
        }
        recordClinic(clinic);
      }
    } finally {
      await sa.close();
    }

    // ---------- Fase 2: clínicas en paralelo ----------
    const queue = plan.clinics.filter((c) => c.id);
    log.step(`Fase 2: configurar y poblar ${queue.length} clínicas (${args.parallel} en paralelo)`);
    const worker = async (n) => {
      while (queue.length) {
        const clinic = queue.shift();
        const res = results.get(clinic.key);
        if (shouldStop()) {
          deadlineHit = true;
          res.status = 'pendiente_hora_limite';
          recordClinic(clinic);
          continue;
        }
        const ctx = makeCtx(clinic);
        ctx.log.info(`Trabajador ${n} toma la clínica ${clinic.name}`);
        try {
          if (!clinic.setupDone) await setupClinic(browser, clinic, ctx);
          if (!args.onlySetup) await populateClinic(browser, clinic, ctx);
          if (ctx.deadlineHit) deadlineHit = true;
          res.status = ctx.deadlineHit ? 'incompleta_hora_limite' : res.errors.length ? 'completa_con_errores' : 'completa';
        } catch (err) {
          res.status = 'error';
          res.errors.push({ entity: 'clinic', ref: clinic.name, message: err.message });
          ctx.log.error(`La clínica se detuvo por un error: ${err.message}`);
        }
        recordClinic(clinic);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(args.parallel, queue.length || 1)) }, (_, i) => worker(i + 1)));
  } finally {
    await browser.close().catch(() => undefined);
  }

  // ---------- Informe ----------
  const clinics = [...results.values()];
  const totals = clinics.reduce((acc, r) => mergeCounts(acc, r.counts), emptyCounts());
  const anyErrors = clinics.some((c) => c.errors.length);
  const status = deadlineHit ? 'INCOMPLETA (hora límite)' : anyErrors ? 'COMPLETA CON ERRORES' : 'OK';

  let git = [];
  if (args.git) {
    log.step('Sincronización con GitHub');
    try {
      git = await gitSync({ log, message: `carga diaria ${runId}: ${totals.holdings.ok} clínicas, ${totals.patients.ok} pacientes` });
    } catch (err) {
      log.error(`Sincronización con GitHub falló: ${err.message}`);
      git = [{ repo: '(todos)', action: 'error', ok: false, detail: err.message }];
    }
  }

  const finishedAt = new Date();
  const summary = {
    runId,
    date: plan.date,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    params: { clinics: args.clinics, patients: args.patients, parallel: args.parallel, deadline: args.deadline },
    status,
    deadlineHit,
    totals,
    clinics,
    git,
    planCounts: summarizePlan(plan),
  };
  const reportPath = writeReport(runDir, summary);
  log.info(`Informe escrito en ${reportPath}`);
  try {
    await writeWordReport({ summary, plan, log });
  } catch (err) {
    log.error(`No se pudo generar el Word del día: ${err.message}`);
  }
  log.info(`Resultado: ${status} · holdings ${totals.holdings.ok}/${totals.holdings.ok + totals.holdings.fail} · pacientes ${totals.patients.ok}/${totals.patients.ok + totals.patients.fail}`);
  await log.close();
  process.exitCode = status === 'OK' ? 0 : 1;
}

main().catch((err) => {
  console.error(`[FATAL] ${err.stack || err.message}`);
  process.exitCode = 2;
});
