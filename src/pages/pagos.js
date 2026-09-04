// Página "Pagos de Consulta" (/pagos-consulta): registro de quién pagó su consulta
// antes de ser atendido. Lo usa cualquier usuario de la clínica (operador/admin).
// Formulario real: labels que envuelven al input → RUT, Nombre, Apellido,
// Correo (opcional), Monto, Método de pago; botón "Registrar pago".
import { visibleError } from './_helpers.js';
import { formatRutText } from '../data/rut.js';

export const PAYMENT_METHODS = ['Efectivo', 'Tarjeta débito', 'Tarjeta crédito', 'Transferencia'];

/**
 * Registra un pago de consulta. `payment` = { rut, firstName, lastName, email?, amount, paymentMethod }.
 * Éxito = la web limpia el formulario y el pago aparece en "Pagos registrados".
 */
export async function registerConsultationPayment(page, payment, ctx) {
  const { config, log } = ctx;
  const url = `${config.dentalcloudUrl}/pagos-consulta`;
  if (!page.url().startsWith(url)) await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Pagos de Consulta' }).waitFor();

  const form = page.locator('form').filter({ has: page.getByRole('button', { name: /Registrar pago|Registrando/ }) });
  const rutInput = form.getByLabel('RUT', { exact: true });
  await rutInput.fill(formatRutText(payment.rut));
  await form.getByLabel('Nombre', { exact: true }).fill(payment.firstName);
  await form.getByLabel('Apellido', { exact: true }).fill(payment.lastName);
  if (payment.email) await form.getByLabel('Correo (opcional)', { exact: true }).fill(payment.email);
  await form.getByLabel('Monto', { exact: true }).fill(String(Math.round(payment.amount)));
  const method = PAYMENT_METHODS.includes(payment.paymentMethod) ? payment.paymentMethod : PAYMENT_METHODS[0];
  if (method !== payment.paymentMethod) log.warn(`Método de pago "${payment.paymentMethod}" no existe en la web; se usa "${method}".`);
  // El <label> de "Método de pago" envuelve al <select>, así que su texto incluye las opciones
  // y getByLabel exacto no coincide; el formulario tiene un único <select>.
  await form.locator('select').first().selectOption({ label: method });

  await form.getByRole('button', { name: 'Registrar pago', exact: true }).click();

  // La web vacía el RUT al guardar; si hay error lo muestra dentro del formulario.
  const waitMs = Math.max(config.actionTimeoutMs, 45000);
  const started = Date.now();
  let confirmed = false;
  while (Date.now() - started < waitMs) {
    if ((await rutInput.inputValue()) === '') {
      confirmed = true;
      break;
    }
    const err = await visibleError(form);
    if (err) throw new Error(`La web rechazó el pago de consulta: ${err}`);
    await page.waitForTimeout(150);
  }

  const rowFor = () => page.locator('tr').filter({ hasText: formatRutText(payment.rut) }).first();
  if (!confirmed) {
    // Sin confirmación ni error: puede que la web haya guardado igual. Se recarga la
    // página y se busca el pago en "Pagos registrados" antes de darlo por fallido.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Pagos registrados' }).waitFor();
    const exists = await rowFor().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    if (!exists) throw new Error(`El pago de consulta de ${payment.rut} no se confirmó en ${waitMs} ms y no aparece en la tabla.`);
    log.warn(`Pago de ${payment.rut}: la web tardó en responder, pero el pago quedó registrado.`);
  } else {
    const listed = await rowFor().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    if (!listed) log.warn(`Pago de ${payment.rut} registrado, pero no se vio en la tabla (se da por creado).`);
  }

  log.info(`Pago de consulta registrado: ${payment.firstName} ${payment.lastName} (${formatRutText(payment.rut)}) $${Math.round(payment.amount)} · ${method}`);
  return true;
}
