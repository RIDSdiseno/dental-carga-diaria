// Poblado de una clínica ya configurada, con la sesión de cada rol:
//  - operador: pacientes (ficha completa + foto)
//  - administrador: citas (elige el profesional), cartola, observaciones, documentos
//  - cada odontólogo: motivo de consulta, presupuestos y evoluciones de SUS pacientes
import { openSession } from '../browser.js';
import * as pacientes from '../pages/pacientes.js';
import * as pagos from '../pages/pagos.js';
import * as agenda from '../pages/agenda.js';
import * as tratamientos from '../pages/tratamientos.js';
import * as evoluciones from '../pages/evoluciones.js';
import * as cartola from '../pages/cartola.js';
import * as observaciones from '../pages/observaciones.js';
import * as documentos from '../pages/documentos.js';
import { eachItem } from './clinic-setup.js';
import { closeOpenModals } from '../pages/_helpers.js';

function sessionFor(browser, ctx, user, suffix) {
  return openSession(browser, {
    baseURL: ctx.config.dentalcloudUrl,
    email: user.email,
    password: ctx.config.defaultUserPassword(),
    storageKey: `${ctx.runId}_${ctx.clinic.key}_${suffix}`,
    log: ctx.log,
  });
}

function patientRef(ctx) {
  return (item) => {
    const p = ctx.resolvePatient(item.patientKey);
    return p ? `${p.firstName} ${p.lastName} (${p.rut})` : item.patientKey;
  };
}

/** Filtra items cuyo paciente ya existe en la web; los demás se marcan como fallidos. */
function withCreatedPatient(items, entity, ctx) {
  const ready = [];
  for (const item of items || []) {
    if (item.done) continue;
    const p = ctx.resolvePatient(item.patientKey);
    if (p?.id) ready.push(item);
    else if (!item.error) {
      item.error = 'el paciente no se creó';
      ctx.counts[entity].fail += 1;
      ctx.errors.push({ entity, ref: item.patientKey, message: item.error });
    }
  }
  return ready;
}

export async function populateClinic(browser, clinic, ctx) {
  const { log } = ctx;
  const users = clinic.users || [];
  const operador = users.find((u) => u.role === 'operador' && u.done) || clinic.admin;
  const odontologos = users.filter((u) => u.role === 'odontologo' && u.done);

  const pending = (items) => (items || []).some((i) => !i.done);

  // 1) Recepción (operador): primero los pagos de consulta de quienes pagaron antes de
  //    la atención, y después las fichas de paciente.
  if (pending(clinic.consultationPayments) || (clinic.patients || []).some((p) => !p.id)) {
    log.step(`[${clinic.key}] Pagos de consulta (${(clinic.consultationPayments || []).length}) y pacientes (${clinic.patients.length}) como ${operador.email}`);
    const s = await sessionFor(browser, ctx, operador, 'operador');
    ctx.onItemError = () => closeOpenModals(s.page);
    try {
      await eachItem(clinic.consultationPayments, 'consultationPayments', ctx, (pay) => pagos.registerConsultationPayment(s.page, pay, ctx), (pay) => `${pay.firstName} ${pay.lastName} ${pay.rut}`);
      await eachItem(clinic.patients, 'patients', ctx, (p) => pacientes.createPatient(s.page, p, ctx), (p) => `${p.firstName} ${p.lastName} ${p.rut}`);
    } finally {
      await s.close();
    }
  }

  // 2) Citas con el administrador (puede elegir el profesional en el formulario).
  if (pending(clinic.appointments)) {
    log.step(`[${clinic.key}] Citas (${(clinic.appointments || []).length})`);
    const s = await sessionFor(browser, ctx, clinic.admin, 'admin');
    ctx.onItemError = () => closeOpenModals(s.page);
    try {
      const ready = withCreatedPatient(clinic.appointments, 'appointments', ctx);
      await eachItem(ready, 'appointments', ctx, async (a) => {
        const patient = ctx.resolvePatient(a.patientKey);
        try {
          await agenda.createAppointmentFromFicha(s.page, patient, a, ctx);
        } catch (err) {
          // Choque de horario: reintentar una vez corriendo la cita 30 minutos.
          if (agenda.isAppointmentConflict(err)) {
            a.originalTime = a.originalTime || a.time;
            const [hh, mm] = a.time.split(':').map(Number);
            const shifted = new Date(2000, 0, 1, hh, mm + 30);
            a.time = `${String(shifted.getHours()).padStart(2, '0')}:${String(shifted.getMinutes()).padStart(2, '0')}`;
            log.warn(`Cita movida a ${a.time} por choque de horario.`);
            await agenda.createAppointmentFromFicha(s.page, patient, a, ctx);
          } else throw err;
        }
      }, patientRef(ctx));
    } finally {
      await s.close();
    }
  }

  // 3) Cada odontólogo: motivo de consulta, presupuestos y evoluciones de sus pacientes.
  for (const dentist of odontologos.length ? odontologos : [clinic.admin]) {
    const mine = (items) => (items || []).filter((i) => (i.userKey ? i.userKey === dentist.key : true));
    const plans = withCreatedPatient(mine(clinic.treatmentPlans), 'treatmentPlans', ctx);
    const evols = withCreatedPatient(mine(clinic.evolutions), 'evolutions', ctx);
    const motivos = (clinic.patients || []).filter((p) => p.id && !p.motivoDone && p.motivoConsulta && (p.userKey ? p.userKey === dentist.key : true));
    if (!plans.length && !evols.length && !motivos.length) continue;

    log.step(`[${clinic.key}] ${dentist.name}: ${motivos.length} motivos, ${plans.length} presupuestos, ${evols.length} evoluciones`);
    const s = await sessionFor(browser, ctx, dentist, `odo_${dentist.key || 'admin'}`);
    ctx.onItemError = () => closeOpenModals(s.page);
    try {
      for (const p of motivos) {
        if (ctx.shouldStop?.()) {
          ctx.deadlineHit = true;
          break;
        }
        try {
          await pacientes.setMotivoConsulta(s.page, p, ctx);
          p.motivoDone = true;
          ctx.counts.motivos.ok += 1;
        } catch (err) {
          ctx.counts.motivos.fail += 1;
          ctx.errors.push({ entity: 'motivos', ref: p.rut, message: String(err.message).split('\n')[0] });
          log.error(`Motivo de consulta de ${p.rut} falló: ${err.message}`);
          await closeOpenModals(s.page).catch(() => undefined);
        }
        ctx.savePlan?.();
      }
      await eachItem(plans, 'treatmentPlans', ctx, (t) => tratamientos.createTreatmentPlan(s.page, ctx.resolvePatient(t.patientKey), t, ctx), patientRef(ctx));
      await eachItem(evols, 'evolutions', ctx, (e) => evoluciones.createEvolution(s.page, ctx.resolvePatient(e.patientKey), e, ctx), patientRef(ctx));
    } finally {
      await s.close();
    }
  }

  // 4) Administrador: cartola, observaciones y documentos.
  if (pending(clinic.ledger) || pending(clinic.observations) || pending(clinic.documents)) {
    log.step(`[${clinic.key}] Cartola, observaciones y documentos`);
    const s = await sessionFor(browser, ctx, clinic.admin, 'admin');
    ctx.onItemError = () => closeOpenModals(s.page);
    try {
      await eachItem(withCreatedPatient(clinic.ledger, 'ledger', ctx), 'ledger', ctx, (m) => cartola.addLedgerMovement(s.page, ctx.resolvePatient(m.patientKey), m, ctx), patientRef(ctx));
      await eachItem(withCreatedPatient(clinic.observations, 'observations', ctx), 'observations', ctx, (o) => observaciones.addObservation(s.page, ctx.resolvePatient(o.patientKey), o, ctx), patientRef(ctx));
      await eachItem(withCreatedPatient(clinic.documents, 'documents', ctx), 'documents', ctx, (d) => documentos.uploadDocument(s.page, ctx.resolvePatient(d.patientKey), d, ctx), patientRef(ctx));
    } finally {
      await s.close();
    }
  }

  clinic.populateDone = !ctx.deadlineHit;
}
