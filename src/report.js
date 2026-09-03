// Informe de cada ejecución: report.json (máquina) y report.md (personas).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const ENTITY_LABELS = {
  holdings: 'Holdings',
  federation: 'Federación',
  modules: 'Módulos',
  chairs: 'Sillones',
  sucursales: 'Sucursales',
  previsiones: 'Previsiones',
  convenios: 'Convenios',
  prestaciones: 'Prestaciones',
  users: 'Profesionales',
  schedules: 'Bloques de horario',
  patients: 'Pacientes',
  motivos: 'Motivos de consulta',
  appointments: 'Citas',
  treatmentPlans: 'Presupuestos',
  evolutions: 'Evoluciones',
  ledger: 'Movimientos de cartola',
  observations: 'Observaciones',
  documents: 'Documentos clínicos',
};

export function emptyCounts() {
  const counts = {};
  for (const key of Object.keys(ENTITY_LABELS)) counts[key] = { ok: 0, fail: 0 };
  return counts;
}

export function mergeCounts(target, source) {
  for (const key of Object.keys(ENTITY_LABELS)) {
    target[key].ok += source[key]?.ok || 0;
    target[key].fail += source[key]?.fail || 0;
  }
  return target;
}

function fmtDuration(ms) {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h} h ${m} min` : m ? `${m} min ${s} s` : `${s} s`;
}

export function buildMarkdown(summary) {
  const lines = [];
  lines.push(`# Carga diaria ${summary.runId}`);
  lines.push('');
  lines.push(`- Inicio: ${summary.startedAt}`);
  lines.push(`- Fin: ${summary.finishedAt}`);
  lines.push(`- Duración: ${fmtDuration(new Date(summary.finishedAt) - new Date(summary.startedAt))}`);
  lines.push(`- Parámetros: ${summary.params.clinics} clínicas, ${summary.params.patients} pacientes, ${summary.params.parallel} en paralelo`);
  lines.push(`- Estado general: **${summary.status}**`);
  if (summary.deadlineHit) lines.push('- Se alcanzó la hora límite: quedaron elementos pendientes.');
  lines.push('');

  lines.push('## Totales');
  lines.push('');
  lines.push('| Entidad | Creados | Fallidos |');
  lines.push('|---|---:|---:|');
  for (const [key, label] of Object.entries(ENTITY_LABELS)) {
    const c = summary.totals[key];
    if (!c || (c.ok === 0 && c.fail === 0)) continue;
    lines.push(`| ${label} | ${c.ok} | ${c.fail} |`);
  }
  lines.push('');

  lines.push('## Clínicas del día');
  lines.push('');
  lines.push('| Clave | Holding | ID | Federada | Pacientes | Citas | Presupuestos | Estado |');
  lines.push('|---|---|---|---|---:|---:|---:|---|');
  for (const c of summary.clinics) {
    lines.push(
      `| ${c.key} | ${c.name} | ${c.id || '—'} | ${c.federated ? 'sí' : 'no'} | ${c.counts.patients.ok}/${c.counts.patients.ok + c.counts.patients.fail} | ${c.counts.appointments.ok} | ${c.counts.treatmentPlans.ok} | ${c.status} |`
    );
  }
  lines.push('');

  const errors = summary.clinics.flatMap((c) => c.errors.map((e) => ({ clinic: c.name, ...e })));
  lines.push(`## Errores (${errors.length})`);
  lines.push('');
  if (!errors.length) lines.push('Sin errores.');
  for (const e of errors.slice(0, 60)) {
    const message = String(e.message || '').split('\n')[0].slice(0, 300);
    lines.push(`- **${e.clinic}** · ${ENTITY_LABELS[e.entity] || e.entity} · ${e.ref || ''}: ${message}`);
  }
  if (errors.length > 60) lines.push(`- … y ${errors.length - 60} más (ver report.json).`);
  lines.push('');

  if (summary.git?.length) {
    lines.push('## Sincronización con GitHub');
    lines.push('');
    lines.push('| Repo | Acción | OK | Detalle |');
    lines.push('|---|---|---|---|');
    for (const g of summary.git) lines.push(`| ${g.repo} | ${g.action} | ${g.ok ? 'sí' : 'NO'} | ${g.detail || ''} |`);
    lines.push('');
  }
  return lines.join('\n');
}

export function writeReport(runDir, summary) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(summary, null, 2), 'utf8');
  const md = buildMarkdown(summary);
  fs.writeFileSync(path.join(runDir, 'report.md'), md, 'utf8');
  // Copia "último informe" para encontrarlo rápido.
  fs.writeFileSync(path.join(config.dirs.reports, 'ULTIMO-INFORME.md'), md, 'utf8');
  return path.join(runDir, 'report.md');
}

export { ENTITY_LABELS };

if (process.argv[2] && /report\.js$/.test(process.argv[1] || '')) {
  const file = path.join(config.dirs.reports, process.argv[2], 'report.md');
  console.log(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : `No existe ${file}`);
}
