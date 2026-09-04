// Flujos sobre pacientes en DentalCloud: crear ficha completa (con foto),
// abrir ficha y registrar el motivo de consulta. Todo por la interfaz web.
import { abs, appearsWithin, fillIfDefined, lastUrlSegment, modal, submitAndWaitClosed, waitForAttr } from './_helpers.js';

export const ALLERGY_LABELS = {
  fluoruro: 'Flúor / fluoruro',
  penicilina: 'Penicilina / antibióticos betalactámicos',
  anestesicos_locales: 'Anestésicos locales (lidocaína, articaína, etc.)',
  latex: 'Látex',
  yodo: 'Yodo / povidona yodada',
  niquel_metales: 'Níquel / metales',
  aines: 'AINEs (ibuprofeno, aspirina, etc.)',
  sulfitos: 'Sulfitos',
  otro: 'Otra',
};

async function ensureChileDialCode(dlg) {
  const dial = dlg.getByRole('button', { name: /^\+\d+/ }).first();
  const current = ((await dial.textContent()) || '').trim();
  if (current.includes('+56')) return;
  await dial.click();
  await dlg.getByRole('button', { name: /^Chile\b/ }).click();
}

/** Busca un paciente en el listado por RUT y abre su ficha. Devuelve el ID o null. */
export async function openPatientByRut(page, rut, ctx) {
  const { config } = ctx;
  await page.goto(`${config.dentalcloudUrl}/pacientes`, { waitUntil: 'domcontentloaded' });
  const search = page.getByPlaceholder('Buscar por nombre, apellido o RUT...');
  await search.fill(rut);
  const row = page.locator('tr, li, div[role="button"]').filter({ hasText: rut }).first();
  if (!(await row.count())) return null;
  await row.click();
  await page.waitForURL(/\/pacientes\/[^/]+$/);
  return lastUrlSegment(page);
}

/**
 * Crea un paciente con TODOS los campos del formulario "Nuevo paciente".
 * Al guardar, la web navega a /pacientes/:id; guardamos ese id en patient.id.
 */
export async function createPatient(page, patient, ctx) {
  const { config, log } = ctx;
  await page.goto(`${config.dentalcloudUrl}/pacientes`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Nuevo paciente' }).click();
  const dlg = modal(page, 'Nuevo paciente');
  await dlg.waitFor();

  if (patient.photoPath) await dlg.locator('input[type="file"]').setInputFiles(abs(patient.photoPath));

  await dlg.locator('#rut').fill(patient.rut);
  await dlg.locator('#firstName').fill(patient.firstName);
  await dlg.locator('#lastName').fill(patient.lastName);

  if (patient.phoneLocal) {
    await ensureChileDialCode(dlg);
    await dlg.locator('#phone').fill(patient.phoneLocal);
  }
  await fillIfDefined(dlg.locator('#birthDate'), patient.birthDate);
  await fillIfDefined(dlg.locator('#email'), patient.email);
  await fillIfDefined(dlg.locator('#address'), patient.address);

  if (patient.gender) await dlg.locator('#gender').selectOption(patient.gender);
  if (patient.maritalStatus) await dlg.locator('#maritalStatus').selectOption(patient.maritalStatus);
  await fillIfDefined(dlg.locator('#nationality'), patient.nationality);
  await fillIfDefined(dlg.locator('#occupation'), patient.occupation);
  if (patient.healthInsurance) await dlg.locator('#healthInsurance').selectOption(patient.healthInsurance);
  await fillIfDefined(dlg.locator('#healthInsuranceDetail'), patient.healthInsuranceDetail);

  await fillIfDefined(dlg.locator('#emergencyContactName'), patient.emergencyContactName);
  await fillIfDefined(dlg.locator('#emergencyContactPhone'), patient.emergencyContactPhone);
  await fillIfDefined(dlg.locator('#emergencyContactRelationship'), patient.emergencyContactRelationship);

  await fillIfDefined(dlg.locator('#heightCm'), patient.heightCm);
  await fillIfDefined(dlg.locator('#weightKg'), patient.weightKg);
  if (patient.bloodType) await dlg.locator('#bloodType').selectOption(patient.bloodType);

  for (const key of patient.allergies || []) {
    const label = ALLERGY_LABELS[key];
    if (!label) throw new Error(`Alergia desconocida en el plan: ${key}`);
    await dlg.getByLabel(label, { exact: true }).check();
  }
  await fillIfDefined(dlg.getByPlaceholder(/Detalle de alergias/), patient.allergyNotes);
  await fillIfDefined(dlg.locator('#medicalConditions'), patient.medicalConditions);
  await fillIfDefined(dlg.locator('#currentMedications'), patient.currentMedications);
  await fillIfDefined(dlg.locator('#chronicDiseases'), patient.chronicDiseases);
  await fillIfDefined(dlg.locator('#dentalHistory'), patient.dentalHistory);

  const tagInput = dlg.getByPlaceholder('Escribe una etiqueta y presiona Enter');
  for (const tag of patient.tags || []) {
    await tagInput.fill(tag);
    await tagInput.press('Enter');
  }

  await submitAndWaitClosed(page, dlg, 'Guardar paciente', 'Nuevo paciente', 60000);

  // Tras guardar, la web abre la ficha. Si no lo hiciera, la buscamos por RUT.
  try {
    await page.waitForURL(/\/pacientes\/[^/]+$/, { timeout: 15000 });
  } catch {
    const id = await openPatientByRut(page, patient.rut, ctx);
    if (!id) throw new Error(`Paciente ${patient.rut} guardado pero no se encontró en el listado.`);
  }
  patient.id = lastUrlSegment(page);
  log.info(`Paciente creado: ${patient.firstName} ${patient.lastName} (${patient.rut}) id=${patient.id}`);
  return patient.id;
}

/** Abre la ficha del paciente (pestaña "Datos paciente"). */
export async function openPatient(page, patient, ctx) {
  const { config } = ctx;
  if (!patient.id) throw new Error(`El paciente ${patient.rut} aún no tiene id; créalo primero.`);
  const url = `${config.dentalcloudUrl}/pacientes/${patient.id}`;
  if (!page.url().startsWith(url)) await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Datos paciente' }).waitFor();
  await dismissDebtNotice(page);
}

/**
 * Si el paciente tiene saldo pendiente, la ficha abre el aviso "Saldo pendiente"
 * que bloquea las pestañas. Se cierra como lo haría una persona (botón Cerrar).
 */
export async function dismissDebtNotice(page) {
  const heading = page.getByRole('heading', { level: 2, name: 'Saldo pendiente', exact: true });
  // El aviso aparece tras cargar la cartola; se le da una breve oportunidad de mostrarse.
  if (!(await appearsWithin(heading, 1500))) return false;
  await page.locator('button[aria-label="Cerrar"]').last().click();
  await heading.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  return true;
}

/** Abre una pestaña de la ficha por su texto (Horas, Tratamientos, Evoluciones, Cartola, ...). */
export async function openPatientTab(page, patient, tabLabel, ctx) {
  await openPatient(page, patient, ctx);
  await page.getByRole('button', { name: tabLabel, exact: true }).click();
}

/** Escribe y guarda el "Motivo de consulta" en la ficha (lo hace el profesional). */
export async function setMotivoConsulta(page, patient, ctx) {
  const { log } = ctx;
  if (!patient.motivoConsulta) return;
  await openPatient(page, patient, ctx);
  await page.getByRole('button', { name: 'Datos paciente', exact: true }).click();

  const heading = page.getByRole('heading', { name: 'Motivo de consulta' });
  await heading.waitFor();
  const card = heading.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  const textarea = card.locator('textarea');
  await textarea.fill(patient.motivoConsulta);
  const save = card.getByRole('button', { name: 'Guardar', exact: true });
  await save.click();
  // El botón vuelve a quedar deshabilitado cuando el texto guardado coincide con el borrador.
  await waitForAttr(save, 'disabled', '', 30000);
  log.info(`Motivo de consulta guardado para ${patient.rut}`);
}
