// Flujos sobre la agenda de DentalCloud: crear sillones y agendar citas, ya sea
// desde la ficha del paciente (preferido) o desde /agenda con el buscador de
// pacientes. Todo por la interfaz web.
//
// Formularios de la web que usa este módulo (dentalcloud-front/src/pages/agenda):
// - Agenda.tsx: h1 "Agenda general"; botones "Nueva cita" (abre NewAppointmentModal),
//   "Atender urgencia", "Sillón" (abre ChairFormModal) y "Hoy". ChairAgendaGrid.tsx pinta
//   una columna por sillón con el texto `chair.name || "Sillón N"` y un botón
//   aria-label "Eliminar sillón N": lo usamos para saber si el sillón ya existe.
// - ChairFormModal.tsx: modal "Agregar sillón" con #number (type=number) y #name
//   (placeholder "Sillón N"); botón submit "Crear sillón".
//   Error 409 del backend: "Ya existe un sillón con el número N".
// - NewAppointmentModal.tsx: modal "Nueva cita" con PatientPicker.tsx (placeholder
//   "Buscar por nombre o RUT..."; resultados como botones "Nombre Apellido / RUT"; al
//   elegir, aparece el botón aria-label "Quitar paciente seleccionado"), #new-appt-date
//   (type=date), #new-appt-time (type=time), #new-appt-chair (options `chair.name ||
//   "Sillón N"`), #new-appt-duration (options value en minutos: 15/30/45/60/90 filtradas
//   por el paso de la agenda), #new-appt-professional (solo admin; option "" = "Yo mismo
//   (nombre)", el resto "Nombre (Rol)"), #new-appt-notes; botón submit "Agendar cita".
//   Error 409 del backend por choque: "Ese sillón ya tiene una cita en ese horario".
// - pages/pacientes/FichaPaciente.tsx: botón "Nueva cita" que abre el mismo modal con el
//   paciente ya seleccionado (siempre tipo "cita"). Al entrar a la ficha puede aparecer el
//   modal "Saldo pendiente" (DebtNotificationModal) si el paciente tiene deuda.
import { escapeRegExp, fillIfDefined, modal, submitAndWaitClosed, waitModalClosed } from './_helpers.js';

const NEW_APPOINTMENT_TITLE = 'Nueva cita';
const CHAIR_MODAL_TITLE = 'Agregar sillón';
const DEBT_MODAL_TITLE = 'Saldo pendiente';

/** Error específico para choques de horario: el orquestador puede reintentar con otra hora. */
export class AppointmentConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AppointmentConflictError';
    this.code = 'APPOINTMENT_CONFLICT';
  }
}

export function isAppointmentConflict(err) {
  if (err instanceof AppointmentConflictError) return true;
  return /ya tiene una cita en ese horario|se superpone|horario (?:no )?disponible|ocupad/i.test(err?.message || '');
}

function chairLabelOf(chairNumber, ctx) {
  const chair = ctx.resolveChair ? ctx.resolveChair(chairNumber) : null;
  return chair?.name || `Sillón ${chairNumber}`;
}

/** Regex tolerante para un RUT: acepta con o sin puntos/guion. */
function rutPattern(rut) {
  const clean = String(rut).replace(/[^0-9kK]/g, '').toUpperCase();
  if (!clean) return null;
  const body = clean.slice(0, -1).split('').map(escapeRegExp).join('\\.?');
  const dv = escapeRegExp(clean.slice(-1));
  return new RegExp(`${body}-?${dv}`, 'i');
}

async function optionList(select) {
  return select.locator('option').evaluateAll((els) => els.map((el) => ({ value: el.value, label: (el.textContent || '').trim() })));
}

/** Espera a que un <select> tenga al menos `min` opciones. */
async function waitOptions(select, min, ctx) {
  const timeout = ctx.config.actionTimeoutMs;
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if ((await select.locator('option').count()) >= min) return true;
    await select.page().waitForTimeout(150);
  }
  return false;
}

async function closeModalIfOpen(page, dlg, title) {
  const heading = page.getByRole('heading', { level: 2, name: title, exact: true });
  if (!(await heading.isVisible().catch(() => false))) return;
  await dlg.getByRole('button', { name: 'Cerrar', exact: true }).click().catch(() => undefined);
  await waitModalClosed(page, title, 5000).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Sillones
// ---------------------------------------------------------------------------

/**
 * Abre /agenda y espera a que la web termine de pedir los sillones (observamos
 * la respuesta de la propia página; no llamamos a la API).
 */
async function gotoAgenda(page, ctx) {
  const url = `${ctx.config.dentalcloudUrl}/agenda`;
  const chairsLoaded = page
    .waitForResponse((res) => /\/chairs(?:\?|$)/.test(res.url()), { timeout: ctx.config.navigationTimeoutMs })
    .catch(() => null);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1, name: 'Agenda general', exact: true }).waitFor();
  await chairsLoaded;
}

function chairRemoveButton(page, number) {
  return page.getByRole('button', { name: `Eliminar sillón ${number}`, exact: true });
}

/** true si la agenda ya muestra una columna para el sillón con ese número (espera breve al render). */
async function chairExists(page, number, timeout = 1500) {
  const button = chairRemoveButton(page, number);
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await button.count()) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

/** Lee los sillones visibles en la agenda: [{ number, label }]. */
export async function listExistingChairs(page, ctx) {
  await gotoAgenda(page, ctx);
  await page.waitForTimeout(300);
  const buttons = page.getByRole('button', { name: /^Eliminar sillón \d+$/ });
  const count = await buttons.count();
  const chairs = [];
  for (let i = 0; i < count; i++) {
    const aria = (await buttons.nth(i).getAttribute('aria-label')) || '';
    const number = Number(aria.replace(/\D/g, ''));
    const header = buttons.nth(i).locator('xpath=..');
    const label = ((await header.locator('span').last().textContent()) || '').trim();
    chairs.push({ number, label });
  }
  return chairs;
}

/**
 * Crea un sillón con el modal "Agregar sillón". chair = { number, name }.
 * Idempotente por número: si la agenda ya tiene la columna, avisa y devuelve false.
 */
export async function addChair(page, chair, ctx) {
  const { log } = ctx;
  const number = Number(chair.number);
  if (!Number.isInteger(number) || number < 1) throw new Error(`addChair: número de sillón inválido "${chair.number}".`);
  const display = chair.name || `Sillón ${number}`;

  await gotoAgenda(page, ctx);
  if (await chairExists(page, number)) {
    log.warn(`El sillón N° ${number} (${display}) ya existía en la agenda; no se crea de nuevo.`);
    return false;
  }

  await page.getByRole('button', { name: 'Sillón', exact: true }).click();
  const dlg = modal(page, CHAIR_MODAL_TITLE);
  await dlg.waitFor();
  await dlg.locator('#number').fill(String(number));
  await fillIfDefined(dlg.locator('#name'), chair.name);

  try {
    await submitAndWaitClosed(page, dlg, 'Crear sillón', CHAIR_MODAL_TITLE);
  } catch (err) {
    await closeModalIfOpen(page, dlg, CHAIR_MODAL_TITLE);
    if (/ya existe un sillón/i.test(err.message)) {
      log.warn(`La web indica que el sillón N° ${number} ya existe; se reutiliza. (${err.message})`);
      return false;
    }
    throw err;
  }

  await chairRemoveButton(page, number).waitFor({ state: 'attached' });
  log.info(`Sillón creado: ${display} (N° ${number})`);
  return true;
}

// ---------------------------------------------------------------------------
// Citas
// ---------------------------------------------------------------------------

/**
 * Llena el modal "Nueva cita" (sin el paciente): fecha, hora, sillón, duración,
 * profesional (solo si el select existe, es decir, sesión de admin) y notas.
 */
async function fillAppointmentForm(page, dlg, appointment, ctx) {
  const { log } = ctx;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointment.date || '')) throw new Error(`Cita: fecha inválida "${appointment.date}" (YYYY-MM-DD).`);
  if (!/^\d{2}:\d{2}$/.test(appointment.time || '')) throw new Error(`Cita: hora inválida "${appointment.time}" (HH:MM).`);

  const chairSelect = dlg.locator('#new-appt-chair');
  if (!(await waitOptions(chairSelect, 1, ctx))) {
    throw new Error('El selector de sillón de "Nueva cita" no cargó opciones; crea sillones antes de agendar.');
  }

  await dlg.locator('#new-appt-date').fill(appointment.date);
  await dlg.locator('#new-appt-time').fill(appointment.time);

  // Sillón: option cuyo texto sea chair.name o "Sillón N".
  const wantedChair = [chairLabelOf(appointment.chairNumber, ctx), `Sillón ${appointment.chairNumber}`].map((s) => s.trim().toLowerCase());
  const chairOptions = await optionList(chairSelect);
  const chairOption =
    chairOptions.find((o) => wantedChair.includes(o.label.toLowerCase())) ||
    chairOptions.find((o) => wantedChair.some((w) => o.label.toLowerCase().includes(w)));
  if (!chairOption) {
    throw new Error(`No se encontró el sillón ${appointment.chairNumber} (${wantedChair.join(' / ')}) en "Nueva cita". Opciones: ${chairOptions.map((o) => o.label).join(', ')}`);
  }
  await chairSelect.selectOption(chairOption.value);

  // Duración: option por value en minutos; si no está disponible, la primera con warn.
  const durationSelect = dlg.locator('#new-appt-duration');
  await waitOptions(durationSelect, 1, ctx);
  const durations = await optionList(durationSelect);
  const wantedDuration = durations.find((o) => o.value === String(appointment.durationMin));
  if (wantedDuration) {
    await durationSelect.selectOption(wantedDuration.value);
  } else if (durations.length) {
    log.warn(`Duración ${appointment.durationMin} min no disponible en la web (opciones: ${durations.map((o) => o.value).join(', ')}); se usa ${durations[0].label}.`);
    await durationSelect.selectOption(durations[0].value);
  } else {
    throw new Error('El selector de duración de "Nueva cita" no tiene opciones.');
  }

  // Profesional: solo aparece para el administrador.
  const professionalSelect = dlg.locator('#new-appt-professional');
  if (await professionalSelect.count()) {
    if (appointment.userKey) {
      const user = ctx.resolveUser(appointment.userKey);
      if (!user?.name) throw new Error(`Cita: no se pudo resolver el usuario "${appointment.userKey}".`);
      await waitOptions(professionalSelect, 2, ctx);
      const options = await optionList(professionalSelect);
      const exact = new RegExp(`^${escapeRegExp(user.name)} \\(`);
      const match =
        options.find((o) => exact.test(o.label)) ||
        options.find((o) => o.label.startsWith(user.name)) ||
        options.find((o) => o.label.includes(user.name));
      if (!match) {
        throw new Error(`No se encontró al profesional "${user.name}" en "Nueva cita". Opciones: ${options.map((o) => o.label).join(' | ')}`);
      }
      await professionalSelect.selectOption(match.value);
    }
  } else if (appointment.userKey) {
    log.warn('El selector de profesional solo aparece para el administrador; la cita quedará asignada según la sesión actual.');
  }

  await fillIfDefined(dlg.locator('#new-appt-notes'), appointment.notes);
}

/** Envía "Agendar cita". Un choque de horario se lanza como AppointmentConflictError. */
async function submitAppointment(page, dlg) {
  try {
    await submitAndWaitClosed(page, dlg, 'Agendar cita', NEW_APPOINTMENT_TITLE, 60000);
  } catch (err) {
    await closeModalIfOpen(page, dlg, NEW_APPOINTMENT_TITLE);
    if (isAppointmentConflict(err)) throw new AppointmentConflictError(err.message);
    throw err;
  }
}

/** Cierra el modal "Saldo pendiente" si la ficha lo mostró. */
async function dismissDebtModal(page, ctx) {
  const heading = page.getByRole('heading', { level: 2, name: DEBT_MODAL_TITLE, exact: true });
  if (!(await heading.isVisible().catch(() => false))) return false;
  const dlg = modal(page, DEBT_MODAL_TITLE);
  await dlg.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await waitModalClosed(page, DEBT_MODAL_TITLE);
  ctx.log.info('Se cerró el aviso "Saldo pendiente" de la ficha.');
  return true;
}

/**
 * PREFERIDO. Agenda una cita desde la ficha del paciente (/pacientes/:id → "Nueva cita"),
 * donde el paciente ya viene seleccionado.
 * appointment = { userKey, chairNumber, date "YYYY-MM-DD", time "HH:MM", durationMin, notes, type }.
 * Lanza AppointmentConflictError si la web rechaza por choque de horario.
 */
export async function createAppointmentFromFicha(page, patient, appointment, ctx) {
  const { config, log } = ctx;
  if (!patient?.id) throw new Error(`El paciente ${patient?.rut ?? '?'} aún no tiene id; créalo antes de agendar.`);
  if (appointment.type === 'control') {
    log.warn('Desde la ficha, "Nueva cita" siempre crea una cita tipo "cita"; la web no permite elegir "control" aquí.');
  }

  await page.goto(`${config.dentalcloudUrl}/pacientes/${patient.id}`, { waitUntil: 'domcontentloaded' });
  const newButton = page.getByRole('button', { name: 'Nueva cita', exact: true });
  await newButton.waitFor();
  // La ficha consulta el saldo tras cargar; si hay deuda abre "Saldo pendiente" encima.
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await dismissDebtModal(page, ctx);

  await newButton.click();
  const dlg = modal(page, NEW_APPOINTMENT_TITLE);
  await dlg.waitFor();
  await dlg.getByRole('button', { name: 'Quitar paciente seleccionado', exact: true }).waitFor();

  await fillAppointmentForm(page, dlg, appointment, ctx);
  await submitAppointment(page, dlg);

  log.info(`Cita agendada desde la ficha de ${patient.rut}: ${appointment.date} ${appointment.time} · ${chairLabelOf(appointment.chairNumber, ctx)} · ${appointment.durationMin} min`);
  return { patientId: patient.id, date: appointment.date, time: appointment.time, chairNumber: appointment.chairNumber };
}

/**
 * Alternativa: agenda desde /agenda → "Nueva cita" buscando al paciente en el
 * PatientPicker por RUT (y por nombre si el RUT no arroja resultados).
 * appointment.patientKey se resuelve con ctx.resolvePatient.
 */
export async function createAppointmentFromAgenda(page, appointment, ctx) {
  const { log } = ctx;
  const patient = ctx.resolvePatient(appointment.patientKey);
  if (!patient) throw new Error(`Cita: no se pudo resolver el paciente "${appointment.patientKey}".`);
  if (appointment.type === 'control') {
    log.warn('Desde la agenda, "Nueva cita" siempre crea una cita tipo "cita"; la web no permite elegir "control" aquí.');
  }

  await gotoAgenda(page, ctx);
  await page.getByRole('button', { name: 'Nueva cita', exact: true }).click();
  const dlg = modal(page, NEW_APPOINTMENT_TITLE);
  await dlg.waitFor();

  await pickPatient(dlg, patient, ctx);
  await fillAppointmentForm(page, dlg, appointment, ctx);
  await submitAppointment(page, dlg);

  log.info(`Cita agendada desde la agenda para ${patient.rut}: ${appointment.date} ${appointment.time} · ${chairLabelOf(appointment.chairNumber, ctx)} · ${appointment.durationMin} min`);
  return { patientId: patient.id ?? null, date: appointment.date, time: appointment.time, chairNumber: appointment.chairNumber };
}

/** Busca al paciente en el PatientPicker (RUT y, si no aparece, nombre) y lo selecciona. */
async function pickPatient(dlg, patient, ctx) {
  const search = dlg.getByPlaceholder('Buscar por nombre o RUT...');
  const selected = dlg.getByRole('button', { name: 'Quitar paciente seleccionado', exact: true });
  const pattern = rutPattern(patient.rut);
  const fullName = `${patient.firstName ?? ''} ${patient.lastName ?? ''}`.trim();
  const queries = [patient.rut, fullName].filter(Boolean);

  for (const query of queries) {
    await search.fill(query);
    // El picker busca con 250 ms de debounce y muestra los resultados como botones.
    const result = dlg
      .getByRole('button')
      .filter({ hasText: pattern || new RegExp(escapeRegExp(fullName), 'i') })
      .first();
    const found = await result.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (!found) {
      ctx.log.warn(`El buscador de pacientes no mostró resultados para "${query}".`);
      continue;
    }
    await result.click();
    await selected.waitFor();
    return true;
  }
  throw new Error(`No se encontró al paciente ${patient.rut} (${fullName}) en el buscador de "Nueva cita".`);
}

export const _internal = { rutPattern, fillAppointmentForm, chairExists, optionList };
