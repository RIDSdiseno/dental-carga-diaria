// Flujos del rol super_admin en DentalCloud: crear holding, federarlo con
// Dental-Demo y habilitar todos los módulos. Todo por la interfaz web.
import { abs, ensureSwitch, escapeRegExp, lastUrlSegment, modal, submitAndWaitClosed, visibleError } from './_helpers.js';

const FEDERATION_SYNC_LABELS = ['Pacientes', 'Citas', 'Presupuestos y tratamientos', 'Profesionales', 'Sucursales', 'Catálogo'];
const MODULE_LABELS = [
  'Pacientes',
  'Agenda y citas',
  'Planes de tratamiento',
  'Documentos clínicos',
  'Cartola',
  'Evoluciones',
  'Observaciones',
  'Consentimientos',
];

/** Fila de la tabla de holdings cuyo nombre coincide exactamente. */
function holdingRow(page, name) {
  return page.locator('tr').filter({ has: page.getByText(name, { exact: true }) }).first();
}

/**
 * Crea el holding con el formulario "Crear holding" y abre su detalle.
 * Devuelve el ID que aparece en la URL /admin/clinicas/:id.
 */
export async function createHolding(page, clinic, ctx) {
  const { config, log } = ctx;
  await page.goto(`${config.dentalcloudUrl}/admin/clinicas`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Holdings' }).waitFor();

  // Si ya existe (re-ejecución tras un error), solo abrimos su detalle.
  const existing = holdingRow(page, clinic.name);
  if (await existing.count()) {
    log.warn(`El holding "${clinic.name}" ya existía; se reutiliza.`);
  } else {
    await page.getByRole('button', { name: 'Crear holding' }).click();
    const dlg = modal(page, 'Crear holding');
    await dlg.waitFor();

    if (clinic.logoPath) await dlg.locator('input[type="file"]').setInputFiles(abs(clinic.logoPath));
    await dlg.locator('#clinica-name').fill(clinic.name);
    if (clinic.rut) await dlg.locator('#clinica-rut').fill(clinic.rut);
    await dlg.locator('#clinica-tipo').selectOption(clinic.tipo);
    await dlg.locator('#clinica-pais').selectOption({ label: clinic.pais || 'Chile' });
    await dlg.locator('#admin-name').fill(clinic.admin.name);
    await dlg.locator('#admin-email').fill(clinic.admin.email);
    await dlg.locator('#admin-password').fill(config.defaultUserPassword());

    await submitAndWaitClosed(page, dlg, 'Crear holding', 'Crear holding', 60000);
    log.info(`Holding creado en la web: ${clinic.name}`);
  }

  await holdingRow(page, clinic.name).waitFor();
  await holdingRow(page, clinic.name).click();
  await page.waitForURL(/\/admin\/clinicas\/[^/]+$/);
  clinic.id = lastUrlSegment(page);
  log.info(`Detalle del holding abierto: id=${clinic.id}`);
  return clinic.id;
}

/**
 * En el detalle del holding: conecta con Dental-Demo, desactiva "Solo catálogo",
 * deja la conexión activa y enciende las 6 conexiones individuales.
 */
export async function configureFederation(page, clinic, ctx) {
  const { config, log } = ctx;
  const detailUrl = `${config.dentalcloudUrl}/admin/clinicas/${clinic.id}`;
  if (!page.url().startsWith(detailUrl)) await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Federación con Dental-Demo' }).waitFor();

  const connectionLabel = `Conexión de ${clinic.name} con Dental-Demo`;
  const changed = await ensureSwitch(page, connectionLabel, true, { timeout: 90000 });
  if (changed) {
    // La conexión crea el espejo en Dental-Demo; esperamos el badge "Conectada" o un error.
    const badge = page.getByText('Conectada', { exact: true });
    const started = Date.now();
    while (!(await badge.isVisible().catch(() => false))) {
      const err = await visibleError(page);
      if (err) throw new Error(`Federación rechazada por la web: ${err}`);
      if (Date.now() - started > 90000) throw new Error('La federación no llegó a "Conectada" en 90 s.');
      await page.waitForTimeout(300);
    }
    log.info('Federación conectada con Dental-Demo.');
  } else {
    log.info('El holding ya estaba conectado a Dental-Demo.');
  }

  await ensureSwitch(page, `Conexión federada de ${clinic.name} activa`, true);
  await ensureSwitch(page, `Solo catálogo para ${clinic.name}`, false);
  for (const label of FEDERATION_SYNC_LABELS) {
    await ensureSwitch(page, `${label} de ${clinic.name}`, true);
  }
  clinic.federated = true;
  log.info('Conexiones individuales encendidas: ' + FEDERATION_SYNC_LABELS.join(', '));
}

/** Habilita el módulo Rx (si el tipo lo permite) y los 8 módulos funcionales. */
export async function enableAllModules(page, clinic, ctx) {
  const { config, log } = ctx;
  const detailUrl = `${config.dentalcloudUrl}/admin/clinicas/${clinic.id}`;
  if (!page.url().startsWith(detailUrl)) await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Módulos habilitados' }).waitFor();

  await ensureSwitch(page, `Holding ${clinic.name} activo`, true);

  const rx = page.getByRole('switch', { name: `Módulo Rx para ${clinic.name}`, exact: true });
  if (await rx.count()) await ensureSwitch(page, `Módulo Rx para ${clinic.name}`, true);

  for (const label of MODULE_LABELS) {
    await ensureSwitch(page, `${label} para ${clinic.name}`, true);
  }
  log.info('Módulos habilitados: ' + MODULE_LABELS.join(', ') + (await rx.count() ? ', Rx' : ''));
}

/** Lee las métricas del detalle (pacientes, citas, etc.) para el informe. */
export async function readHoldingStats(page, clinic, ctx) {
  const { config } = ctx;
  const detailUrl = `${config.dentalcloudUrl}/admin/clinicas/${clinic.id}`;
  if (!page.url().startsWith(detailUrl)) await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
  const tiles = page.locator('div.rounded-xl.bg-slate-50');
  const count = await tiles.count();
  const stats = {};
  for (let i = 0; i < count; i++) {
    const label = (await tiles.nth(i).locator('p').nth(0).textContent())?.trim();
    const value = (await tiles.nth(i).locator('p').nth(1).textContent())?.trim();
    if (label) stats[label] = value;
  }
  return stats;
}

export const _internal = { holdingRow, escapeRegExp };
