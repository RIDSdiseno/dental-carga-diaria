// Manejo del navegador: un Browser por proceso, un BrowserContext por usuario.
// La sesión (cookie de refresh) se guarda en storage/<clave>.json para no
// volver a iniciar sesión en cada uso.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { config } from './config.js';

export async function launchBrowser() {
  return chromium.launch({ headless: config.headless, slowMo: config.slowMo });
}

function storagePath(storageKey) {
  const safe = storageKey.replace(/[^a-z0-9_@.-]/gi, '_');
  return path.join(config.dirs.storage, `${safe}.json`);
}

async function newContext(browser, storageKey) {
  const file = storagePath(storageKey);
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    storageState: fs.existsSync(file) ? file : undefined,
  });
  context.setDefaultTimeout(config.actionTimeoutMs);
  context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  return context;
}

/**
 * Inicia sesión en la web con el formulario real (/login). Nunca registra la contraseña.
 * Devuelve la URL a la que redirige la app tras entrar.
 */
export async function loginViaForm(page, baseURL, email, password, log) {
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  const errorBox = page.locator('p.text-red-600');
  await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: config.navigationTimeoutMs }),
    errorBox.waitFor({ state: 'visible', timeout: config.navigationTimeoutMs }).then(async () => {
      const text = (await errorBox.textContent())?.trim() || 'error desconocido';
      throw new Error(`La web rechazó el inicio de sesión de ${email}: ${text}`);
    }),
  ]);
  log?.info(`Sesión iniciada como ${email} → ${new URL(page.url()).pathname}`);
  return page.url();
}

/**
 * Abre (o reutiliza) una sesión para un usuario. Si la cookie guardada ya no sirve,
 * vuelve a entrar por el formulario y actualiza el storage.
 */
export async function openSession(browser, { baseURL, email, password, storageKey, log }) {
  const key = storageKey || email;
  const context = await newContext(browser, key);
  const page = await context.newPage();

  await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' });
  // ProtectedRoute redirige a /login cuando no hay sesión válida.
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const needsLogin = new URL(page.url()).pathname.startsWith('/login');

  if (needsLogin) {
    await loginViaForm(page, baseURL, email, password, log);
    await context.storageState({ path: storagePath(key) });
  } else {
    log?.info(`Sesión reutilizada para ${email}`);
  }

  return { context, page, close: () => context.close() };
}

/** Elimina sesiones guardadas (por ejemplo, tras cambiar una contraseña). */
export function clearStoredSession(storageKey) {
  const file = storagePath(storageKey);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
