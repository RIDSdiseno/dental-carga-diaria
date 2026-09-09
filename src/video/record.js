// Graba el recorrido por la web real con Playwright (video webm 1280x720) y deja una
// línea de tiempo con el inicio de cada escena para sincronizar la narración.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { config } from '../config.js';
import { writeTitleCard } from './titles.js';

const WIDTH = 1280;
const HEIGHT = 720;

export async function recordVideo({ scenes, audio, data, workDir, log = console }) {
  const rawDir = path.join(workDir, 'raw');
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });
  const cardsDir = path.join(workDir, 'titulos');
  const durations = new Map(audio.map((a) => [a.id, a.duration]));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    recordVideo: { dir: rawDir, size: { width: WIDTH, height: HEIGHT } },
  });
  context.setDefaultTimeout(30000);
  const page = await context.newPage();
  const t0 = Date.now();

  const creds = {
    superadmin: { base: config.dentalcloudUrl, email: config.superadminEmail(), password: config.superadminPassword(), selectors: 'dc' },
    admin: { base: config.dentalcloudUrl, email: data.admin.email, password: config.defaultUserPassword(), selectors: 'dc' },
    operador: { base: config.dentalcloudUrl, email: data.operator.email, password: config.defaultUserPassword(), selectors: 'dc' },
    odontologo: { base: config.dentalcloudUrl, email: data.dentist.email, password: config.defaultUserPassword(), selectors: 'dc' },
    demo: { base: config.dentalDemoUrl, email: config.superadminEmail(), password: config.superadminPassword(), selectors: 'dd' },
  };

  const ctx = {
    page,
    data,
    dc: config.dentalcloudUrl,
    dd: config.dentalDemoUrl,
    openModal: false,
    pause: (ms) => page.waitForTimeout(ms),
    goto: async (url) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
    },
    tab: async (label) => {
      await page.getByRole('button', { name: label, exact: true }).click();
    },
    scroll: async (px) => {
      const steps = Math.max(1, Math.round(px / 80));
      for (let i = 0; i < steps; i++) {
        await page.mouse.wheel(0, 80);
        await page.waitForTimeout(60);
      }
    },
    card: async (id, spec) => {
      const url = writeTitleCard(cardsDir, id, spec);
      await page.goto(url);
    },
    dismissDebt: async () => {
      const heading = page.getByRole('heading', { level: 2, name: 'Saldo pendiente', exact: true });
      const shown = await heading.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false);
      if (shown) {
        await page.waitForTimeout(1200); // que se alcance a ver el aviso
        await page.locator('button[aria-label="Cerrar"]').last().click().catch(() => undefined);
      }
    },
    login: async (role) => {
      const c = creds[role];
      if (!c) throw new Error(`Rol desconocido: ${role}`);
      await context.clearCookies();
      await page.goto(`${c.base}/login`, { waitUntil: 'domcontentloaded' });
      const email = c.selectors === 'dc' ? page.locator('#email') : page.locator('input[type="email"], input[name="email"], #email').first();
      const pass = c.selectors === 'dc' ? page.locator('#password') : page.locator('input[type="password"]').first();
      await email.waitFor();
      await email.pressSequentially(c.email, { delay: 35 });
      await pass.fill(c.password);
      await page.waitForTimeout(600);
      await page.getByRole('button', { name: /^Ingresar$|^Iniciar sesión$|^Entrar$/ }).first().click();
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45000 }).catch(() => undefined);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.waitForTimeout(800);
    },
  };

  const timeline = [];
  for (const scene of scenes) {
    const startAbs = Date.now();
    const start = (startAbs - t0) / 1000;
    const dur = durations.get(scene.id) ?? 5;
    log.log?.(`[${scene.id}] ${scene.title} · inicio ${start.toFixed(1)} s · voz ${dur.toFixed(1)} s`);
    try {
      await scene.run(ctx);
    } catch (err) {
      log.warn?.(`[${scene.id}] acción falló (se continúa): ${String(err.message).split('\n')[0]}`);
    }
    // Mantener la escena hasta que termine la narración (+ respiro).
    const minMs = dur * 1000 + 900;
    const remaining = minMs - (Date.now() - startAbs);
    if (remaining > 0) await page.waitForTimeout(remaining);
    if (scene.after) await scene.after(ctx).catch(() => undefined);
    timeline.push({ id: scene.id, title: scene.title, section: scene.section, start, audio: dur, end: (Date.now() - t0) / 1000 });
  }
  await page.waitForTimeout(1200);

  const videoHandle = page.video();
  await context.close();
  const rawPath = await videoHandle.path();
  await browser.close();

  const result = { rawPath, width: WIDTH, height: HEIGHT, timeline, totalSeconds: timeline.at(-1)?.end ?? 0 };
  fs.writeFileSync(path.join(workDir, 'timeline.json'), JSON.stringify(result, null, 2), 'utf8');
  return result;
}
