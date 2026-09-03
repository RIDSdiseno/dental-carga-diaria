// Registro local de todo lo que el proceso ha creado. Es la única fuente para
// saber qué clínicas son "nuestras" y para no repetir RUT ni correos entre días.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const REGISTRY_PATH = path.join(config.dirs.data, 'registry.json');

function emptyRegistry() {
  return { version: 1, updatedAt: null, clinics: [], usedRuts: [], usedEmails: [] };
}

export function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return emptyRegistry();
  try {
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    return { ...emptyRegistry(), ...parsed };
  } catch (err) {
    throw new Error(`No se pudo leer ${REGISTRY_PATH}: ${err.message}`);
  }
}

export function saveRegistry(registry) {
  registry.updatedAt = new Date().toISOString();
  const tmp = REGISTRY_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), 'utf8');
  fs.renameSync(tmp, REGISTRY_PATH);
}

export function registryPath() {
  return REGISTRY_PATH;
}

/** Conjuntos en memoria para consultas rápidas durante la generación. */
export function usedSets(registry) {
  return {
    ruts: new Set(registry.usedRuts.map((r) => r.replace(/[^0-9kK]/g, '').toUpperCase())),
    emails: new Set(registry.usedEmails.map((e) => e.toLowerCase())),
  };
}

export function reserve(registry, { ruts = [], emails = [] }) {
  for (const rut of ruts) registry.usedRuts.push(rut);
  for (const email of emails) registry.usedEmails.push(email.toLowerCase());
}

/** Inserta o actualiza una clínica por su clave del día (runId + key). */
export function upsertClinic(registry, clinic) {
  const idx = registry.clinics.findIndex((c) => c.runId === clinic.runId && c.key === clinic.key);
  if (idx >= 0) registry.clinics[idx] = { ...registry.clinics[idx], ...clinic };
  else registry.clinics.push(clinic);
}

export function clinicsForRun(registry, runId) {
  return registry.clinics.filter((c) => c.runId === runId);
}
