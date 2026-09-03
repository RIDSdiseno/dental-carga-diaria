// Configuración central. Lee .env una sola vez y expone valores tipados.
// Los secretos se exponen como funciones (getter) para que nunca queden
// serializados por accidente en logs o informes.
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carga el archivo de credenciales. Se acepta ".env" y también ".env.txt"
// (el Bloc de notas suele agregar la extensión al guardar).
for (const candidate of ['.env', '.env.txt']) {
  const file = path.join(ROOT, candidate);
  if (fs.existsSync(file)) {
    dotenv.config({ path: file });
    break;
  }
}

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
    const value = (process.env.DEFAULT_USER_PASSWORD || '').trim();
    if (value) {
      if (value.length < 8) throw new Error('DEFAULT_USER_PASSWORD debe tener al menos 8 caracteres.');
      return value;
    }
    // Sin valor en .env: se genera una vez, se guarda en data/clave-usuarios.txt
    // (ignorado por git) y se informa en el Word diario.
    const file = path.join(dirs.data, 'clave-usuarios.txt');
    if (fs.existsSync(file)) {
      const saved = fs.readFileSync(file, 'utf8').trim();
      if (saved.length >= 8) return saved;
    }
    const generated = 'Demo' + randomBytes(6).toString('base64url').replace(/[-_]/g, 'x') + '!';
    fs.writeFileSync(file, generated + '\n', 'utf8');
    return generated;
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
