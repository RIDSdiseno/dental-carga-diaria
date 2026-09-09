// Datos de demostración para el video: una clínica ya cargada por el robot, con sus
// usuarios y un paciente "completo" (pago de consulta, ficha, citas, presupuesto,
// evolución, abono y documento).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { loadRegistry } from '../registry.js';

const hasDone = (list, patientKey) => (list || []).some((item) => item.patientKey === patientKey && item.done);

export function loadDemoClinic(preferredName = process.env.VIDEO_CLINIC || 'Demo Dental Las Palmas') {
  const registry = loadRegistry();
  const candidates = registry.clinics.filter((c) => c.federated && c.status === 'completa' && c.id);
  const entry = candidates.find((c) => c.name === preferredName) || candidates[candidates.length - 1];
  if (!entry) throw new Error('No hay clínicas completas en el registro para grabar el video.');

  const planPath = path.join(config.dirs.reports, entry.runId, 'plan.json');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const clinic = plan.clinics.find((c) => c.key === entry.key);
  if (!clinic) throw new Error(`La clínica ${entry.name} no está en ${planPath}`);

  const complete = (clinic.patients || []).filter(
    (p) =>
      p.id &&
      hasDone(clinic.treatmentPlans, p.key) &&
      hasDone(clinic.evolutions, p.key) &&
      hasDone(clinic.ledger, p.key) &&
      hasDone(clinic.documents, p.key) &&
      hasDone(clinic.consultationPayments, p.key)
  );
  const withPhoto = complete.filter((p) => p.photoPath);
  const patient = withPhoto[0] || complete[0] || (clinic.patients || []).find((p) => p.id);
  if (!patient) throw new Error(`La clínica ${clinic.name} no tiene pacientes creados.`);

  const dentist = (clinic.users || []).find((u) => u.key === patient.userKey && u.done) || (clinic.users || []).find((u) => u.role === 'odontologo' && u.done);
  const operator = (clinic.users || []).find((u) => u.role === 'operador' && u.done);
  const professionalWithSchedule = (clinic.users || []).find((u) => u.done && (clinic.schedules || []).some((s) => s.userKey === u.key && s.done)) || dentist;

  return {
    runId: entry.runId,
    clinic,
    admin: clinic.admin,
    dentist,
    operator: operator || clinic.admin,
    professionalWithSchedule,
    patient,
    stats: {
      patients: (clinic.patients || []).filter((p) => p.id).length,
      appointments: (clinic.appointments || []).filter((a) => a.done).length,
      plans: (clinic.treatmentPlans || []).filter((t) => t.done).length,
      evolutions: (clinic.evolutions || []).filter((e) => e.done).length,
      payments: (clinic.consultationPayments || []).filter((c) => c.done).length,
    },
  };
}

// Uso directo: node src/video/demo-data.js
if (process.argv[1] && /demo-data\.js$/.test(process.argv[1])) {
  const d = loadDemoClinic();
  console.log(`clínica: ${d.clinic.name} (${d.clinic.tipo}) id=${d.clinic.id} corrida=${d.runId}`);
  console.log(`admin: ${d.admin.email}`);
  console.log(`odontólogo: ${d.dentist?.name} <${d.dentist?.email}> | operador: ${d.operator?.name} <${d.operator?.email}>`);
  console.log(`paciente: ${d.patient.firstName} ${d.patient.lastName} ${d.patient.rut} id=${d.patient.id} foto=${Boolean(d.patient.photoPath)}`);
  console.log('stats:', JSON.stringify(d.stats));
}
