// Configuración central. Lee .env una sola vez y expone valores tipados.
// Los secretos se exponen como funciones (getter) para que nunca queden
// serializados por accidente en logs o informes.
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Falta la variable ${name} en el archivo .env (usa .env.example como guía).`);
  }
  return value.trim();
}

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`La variable ${name} debe ser numérica (valor actual: "${raw}").`);
  return n;
}

const dirs = {
  root: ROOT,
  data: path.join(ROOT, 'data'),
  reports: path.join(ROOT, 'reports'),
  storage: path.join(ROOT, 'storage'),
  assets: path.join(ROOT, 'assets'),
  generated: path.join(ROOT, 'assets', 'generated'),
};
for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });

export const config = {
  dirs,
  dentalcloudUrl: (process.env.DC_BASE_URL || 'https://dentalcloudia.netlify.app').replace(/\/$/, ''),
  dentalDemoUrl: (process.env.DD_BASE_URL || 'https://dentalaicloud.netlify.app').replace(/\/$/, ''),

  superadminEmail: () => required('DC_SUPERADMIN_EMAIL'),
  superadminPassword: () => required('DC_SUPERADMIN_PASSWORD'),
  defaultUserPassword: () => {
    const value = required('DEFAULT_USER_PASSWORD');
    if (value.length < 8) throw new Error('DEFAULT_USER_PASSWORD debe tener al menos 8 caracteres.');
    return value;
  },

  clinicsPerDay: num('CLINICS_PER_DAY', 10),
  patientsPerDay: num('PATIENTS_PER_DAY', 300),
  parallelClinics: Math.max(1, num('PARALLEL_CLINICS', 3)),
  photoRatio: num('PHOTO_RATIO', 0.25),
  clinicPrefix: (process.env.CLINIC_PREFIX || 'Demo').trim(),
  emailDomain: (process.env.FAKE_EMAIL_DOMAIN || 'demo-fordent.invalid').trim(),

  headless: (process.env.HEADLESS || 'true').toLowerCase() !== 'false',
  slowMo: num('SLOW_MO', 0),
  actionTimeoutMs: num('ACTION_TIMEOUT_MS', 20000),
  navigationTimeoutMs: num('NAVIGATION_TIMEOUT_MS', 45000),
};

/** Fecha local de Chile en formato YYYY-MM-DD. */
export function todayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Identificador de ejecución: fecha + hora local, apto para nombres de carpeta. */
export function makeRunId(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hh = parts.find((p) => p.type === 'hour').value;
  const mm = parts.find((p) => p.type === 'minute').value;
  return `${todayKey(date)}_${hh}${mm}`;
}

/** Valores secretos actuales, para que el logger los tache si aparecen. */
export function secretValues() {
  return Object.entries(process.env)
    .filter(([key]) => /PASSWORD|SECRET|TOKEN|API_KEY/i.test(key))
    .map(([, value]) => value)
    .filter((value) => value && value.length >= 4);
}
