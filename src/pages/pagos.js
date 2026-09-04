// Página "Pagos de Consulta" (/pagos-consulta): registro de quién pagó su consulta
// antes de ser atendido. Lo usa cualquier usuario de la clínica (operador/admin).
// Formulario real: labels que envuelven al input → RUT, Nombre, Apellido,
// Correo (opcional), Monto, Método de pago; botón "Registrar pago".
import { visibleError } from './_helpers.js';

export const PAYMENT_METHODS = ['Efectivo', 'Tarjeta débito', 'Tarjeta crédito', 'Transferencia'];

function formatRut(rut) {
  const clean = String(rut).replace(/[^0-9kK]/g, '').toUpperCase();
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}

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
  await rutInput.fill(formatRut(payment.rut));
  await form.getByLabel('Nombre', { exact: true }).fill(payment.firstName);
  await form.getByLabel('Apellido', { exact: true }).fill(payment.lastName);
  if (payment.email) await form.getByLabel('Correo (opcional)', { exact: true }).fill(payment.email);
  await form.getByLabel('Monto', { exact: true }).fill(String(Math.round(payment.amount)));
  const method = PAYMENT_METHODS.includes(payment.paymentMethod) ? payment.paymentMethod : PAYMENT_METHODS[0];
  if (method !== payment.paymentMethod) log.warn(`Método de pago "${payment.paymentMethod}" no existe en la web; se usa "${method}".`);
  await form.getByLabel('Método de pago', { exact: true }).selectOption({ label: method });

  await form.getByRole('button', { name: 'Registrar pago', exact: true }).click();

  // La web vacía el RUT al guardar; si hay error lo muestra dentro del formulario.
  const started = Date.now();
  while (Date.now() - started < config.actionTimeoutMs) {
    if ((await rutInput.inputValue()) === '') break;
    const err = await visibleError(form);
    if (err) throw new Error(`La web rechazó el pago de consulta: ${err}`);
    await page.waitForTimeout(150);
  }
  if ((await rutInput.inputValue()) !== '') throw new Error(`El pago de consulta de ${payment.rut} no se confirmó en ${config.actionTimeoutMs} ms.`);

  const row = page.locator('tr').filter({ hasText: formatRut(payment.rut) }).first();
  const listed = await row.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  if (!listed) log.warn(`Pago de ${payment.rut} registrado, pero no se vio en la tabla (se da por creado).`);

  log.info(`Pago de consulta registrado: ${payment.firstName} ${payment.lastName} (${formatRut(payment.rut)}) $${Math.round(payment.amount)} · ${method}`);
  return true;
}
