// Helpers compartidos por todos los flujos de Playwright.
import path from 'node:path';
import { config } from '../config.js';

export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Ruta absoluta a partir de una ruta relativa al proyecto. */
export function abs(relativeOrAbsolute) {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.join(config.dirs.root, relativeOrAbsolute);
}

/** Localiza el contenedor de un modal por el título de su <h2>. */
export function modal(page, title) {
  return page
    .locator('div.fixed.inset-0')
    .filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) })
    .last();
}

export async function waitModalClosed(page, title, timeout = config.actionTimeoutMs) {
  await page.getByRole('heading', { level: 2, name: title, exact: true }).waitFor({ state: 'hidden', timeout });
}

/** Texto del primer mensaje de error visible (p.text-red-600) dentro de un scope, o null. */
export async function visibleError(scope) {
  const box = scope.locator('p.text-red-600, p.text-red-700').first();
  if (await box.isVisible().catch(() => false)) return (await box.textContent())?.trim() || 'error sin detalle';
  return null;
}

/**
 * Envía un formulario y espera a que el modal se cierre. Si la web muestra un
 * error dentro del modal, lanza una excepción con ese texto.
 */
export async function submitAndWaitClosed(page, dlg, buttonName, title, timeout = config.actionTimeoutMs) {
  await dlg.getByRole('button', { name: buttonName, exact: true }).click();
  const heading = page.getByRole('heading', { level: 2, name: title, exact: true });
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (!(await heading.isVisible().catch(() => false))) return;
    const err = await visibleError(dlg);
    if (err) throw new Error(`La web rechazó "${title}": ${err}`);
    await page.waitForTimeout(150);
  }
  throw new Error(`El modal "${title}" no se cerró tras ${timeout} ms.`);
}

/** true si el elemento llega a ser visible dentro del plazo; false si no (nunca lanza). */
export async function appearsWithin(locator, timeout = 8000) {
  return locator.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
}

export async function waitForAttr(locator, attr, expected, timeout = config.actionTimeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await locator.getAttribute(attr);
    if (value === expected) return;
    await locator.page().waitForTimeout(150);
  }
  throw new Error(`Atributo ${attr} no llegó a "${expected}" en ${timeout} ms.`);
}

/** Deja un switch (role="switch", aria-label exacto) en el estado deseado y espera la confirmación. */
export async function ensureSwitch(page, name, desired, { timeout = config.actionTimeoutMs, scope = page } = {}) {
  const sw = scope.getByRole('switch', { name, exact: true });
  await sw.waitFor({ state: 'visible', timeout });
  const current = (await sw.getAttribute('aria-checked')) === 'true';
  if (current === desired) return false;
  await sw.click();
  await waitForAttr(sw, 'aria-checked', String(desired), timeout);
  return true;
}

export async function fillIfDefined(locator, value) {
  if (value === undefined || value === null || value === '') return;
  await locator.fill(String(value));
}

/** Dibuja una firma (garabato) sobre un canvas con el mouse. */
export async function drawSignature(page, canvas) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('No se encontró el canvas de firma.');
  const startX = box.x + box.width * 0.15;
  const midY = box.y + box.height * 0.55;
  await page.mouse.move(startX, midY);
  await page.mouse.down();
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = startX + t * box.width * 0.7;
    const y = midY + Math.sin(t * Math.PI * 4) * box.height * 0.22 - t * box.height * 0.1;
    await page.mouse.move(x, y, { steps: 2 });
  }
  await page.mouse.up();
}

/** Reintenta una acción asíncrona. Útil para pasos que dependen de la red. */
export async function retry(fn, { attempts = 3, delayMs = 1500, log, label = 'acción' } = {}) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastError = err;
      log?.warn(`${label}: intento ${i}/${attempts} falló: ${err.message}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
  throw lastError;
}

/**
 * Cierra cualquier modal que haya quedado abierto tras un error (botón "Cerrar" del
 * Modal genérico o tecla Escape), para que el siguiente paso no quede bloqueado.
 */
export async function closeOpenModals(page) {
  for (let i = 0; i < 3; i++) {
    const close = page.locator('button[aria-label="Cerrar"]').last();
    if (!(await close.isVisible().catch(() => false))) break;
    await close.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(200);
  }
  await page.keyboard.press('Escape').catch(() => undefined);
}

/** Extrae el último segmento de la URL actual (normalmente el ID del recurso). */
export function lastUrlSegment(page) {
  const { pathname } = new URL(page.url());
  return pathname.replace(/\/$/, '').split('/').pop();
}
