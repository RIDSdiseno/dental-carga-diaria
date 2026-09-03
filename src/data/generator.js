// Generador determinista del plan diario (ver CONTRACT.md). Produce clínicas,
// usuarios, catálogos, pacientes y actividad clínica coherentes, con rutas de
// assets ya decididas; `materializeAssets` crea los archivos físicos.
import fs from 'node:fs';
import path from 'node:path';
import { createRng } from './random.js';
import { generateRut } from './rut.js';
import * as C from './chile.js';
import { createImageFactory, generatePdf } from './images.js';
import { config as defaultConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export function slug(text, maxLen = 40) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, maxLen);
}

const pad = (n, len = 2) => String(n).padStart(len, '0');

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function formatDate(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}
function addYears(date, years) {
  const copy = new Date(date.getTime());
  copy.setUTCFullYear(copy.getUTCFullYear() + years);
  return copy;
}
function minutesToTime(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
function roundTo(value, step) {
  return Math.round(value / step) * step;
}

/** Fecha de nacimiento tal que la edad exacta en `today` sea `age`. */
function birthDateForAge(rng, today, age) {
  const start = addDays(addYears(today, -(age + 1)), 1);
  const end = addYears(today, -age);
  const span = Math.round((end - start) / 86400000);
  return formatDate(addDays(start, rng.int(0, Math.max(0, span))));
}

/** Reparte `total` en `parts` grupos casi parejos (diferencias de a lo más ±3). */
export function distributePatients(total, parts, rng) {
  const base = Math.floor(total / parts);
  const counts = Array.from({ length: parts }, (_, i) => base + (i < total % parts ? 1 : 0));
  if (parts > 1 && base >= 4) {
    // Pequeño desbalance realista, conservando el total.
    for (let i = 0; i + 1 < parts; i += 2) {
      if (rng.chance(0.5)) {
        counts[i] += 1;
        counts[i + 1] -= 1;
      }
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Contexto de generación (RUT y correos únicos)
// ---------------------------------------------------------------------------

function createContext({ rng, used, config, runId, date, photoRatio, seed }) {
  const ruts = new Set([...(used?.ruts ?? [])].map((r) => String(r).replace(/[^0-9kK]/g, '').toUpperCase()));
  const emails = new Set([...(used?.emails ?? [])].map((e) => String(e).toLowerCase()));
  const today = parseDate(date);
  const mmdd = `${pad(today.getUTCMonth() + 1)}${pad(today.getUTCDate())}`;
  const domain = config.emailDomain;

  function uniqueRut(kind) {
    for (let i = 0; i < 10000; i++) {
      const rut = generateRut(kind, rng.next);
      if (!ruts.has(rut.clean)) {
        ruts.add(rut.clean);
        return rut.formatted;
      }
    }
    throw new Error('No se pudo generar un RUT único.');
  }

  function uniqueEmail(base, { numbered = true } = {}) {
    // Cada segmento se normaliza por separado para conservar los puntos: nombre.apellido.MMDD
    const local = String(base).split('.').map((part) => slug(part, 32)).filter(Boolean).join('.');
    if (!numbered) {
      const first = `${local}@${domain}`;
      if (!emails.has(first)) {
        emails.add(first);
        return first;
      }
    }
    for (let n = numbered ? 1 : 2; n < 100000; n++) {
      const email = `${local}.${n}@${domain}`;
      if (!emails.has(email)) {
        emails.add(email);
        return email;
      }
    }
    throw new Error(`No se pudo generar un correo único para ${base}.`);
  }

  return { rng, config, runId, date, today, mmdd, domain, photoRatio, seed, uniqueRut, uniqueEmail, ruts, emails };
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

function pickFirstName(rng, gender) {
  if (gender === 'femenino') return rng.pick(C.FEMALE_NAMES);
  if (gender === 'masculino') return rng.pick(C.MALE_NAMES);
  return rng.pick(rng.chance(0.5) ? C.FEMALE_NAMES : C.MALE_NAMES);
}

function pickSurnames(rng) {
  const [a, b] = rng.pickMany(C.SURNAMES, 2);
  return { first: a, full: `${a} ${b}` };
}

function personName(rng, gender) {
  const first = pickFirstName(rng, gender);
  const surnames = pickSurnames(rng);
  return { firstName: first, lastName: surnames.full, surname1: surnames.first };
}

function pickAge(rng, tipo) {
  if (tipo === 'estetica') {
    return rng.weighted([[rng.int(18, 29), 20], [rng.int(30, 44), 40], [rng.int(45, 59), 30], [rng.int(60, 72), 10]]);
  }
  return rng.weighted([
    [rng.int(4, 12), 11], [rng.int(13, 17), 7], [rng.int(18, 29), 20], [rng.int(30, 44), 25],
    [rng.int(45, 59), 20], [rng.int(60, 74), 12], [rng.int(75, 88), 5],
  ]);
}

function maritalStatusFor(rng, age) {
  if (age < 18) return 'soltero';
  if (age <= 25) return rng.weighted([['soltero', 85], ['conviviente_civil', 10], ['casado', 5]]);
  if (age <= 40) return rng.weighted([['soltero', 40], ['casado', 35], ['conviviente_civil', 20], ['divorciado', 5]]);
  if (age <= 64) return rng.weighted([['casado', 50], ['soltero', 15], ['divorciado', 20], ['conviviente_civil', 10], ['viudo', 5]]);
  return rng.weighted([['casado', 45], ['viudo', 30], ['divorciado', 12], ['soltero', 10], ['conviviente_civil', 3]]);
}

function occupationFor(rng, age, gender) {
  const g = gender === 'masculino' ? 'm' : gender === 'femenino' ? 'f' : rng.pick(['f', 'm']);
  if (age < 6) return C.CHILD_OCCUPATIONS.preschool;
  if (age < 18) return C.CHILD_OCCUPATIONS.school;
  if (age <= 24 && rng.chance(0.55)) return C.CHILD_OCCUPATIONS.university[g];
  if (age >= 65 && rng.chance(0.65)) return rng.pick(C.RETIRED[g]);
  return rng.pick(C.OCCUPATIONS)[g];
}

const BOY_HEIGHTS = [102, 109, 115, 121, 127, 132, 137, 143, 149, 156, 163, 169, 173, 175];
const GIRL_HEIGHTS = [101, 108, 114, 120, 126, 132, 138, 145, 151, 156, 159, 161, 162, 163];

function bodyFor(rng, age, gender) {
  const masculine = gender === 'masculino' || (gender === 'otro' && rng.chance(0.5));
  const bell = (rng.next() + rng.next()) / 2; // distribución centrada
  let heightCm;
  let bmi;
  if (age <= 17) {
    const table = masculine ? BOY_HEIGHTS : GIRL_HEIGHTS;
    heightCm = table[age - 4] + rng.int(-5, 5);
    bmi = 14.5 + bell * 5.5;
  } else {
    heightCm = Math.round(masculine ? 162 + bell * 24 : 150 + bell * 22);
    if (age >= 70) heightCm -= 2;
    bmi = age >= 65 ? 21 + bell * 9 : 19 + bell * 13;
  }
  const weightKg = Math.round(bmi * (heightCm / 100) ** 2 * 10) / 10;
  return { heightCm, weightKg };
}

function insuranceFor(rng, age) {
  const type = rng.weighted([['fonasa', 55], ['isapre', 33], ['particular', 9], ['otro', 3]]);
  let detail;
  if (type === 'fonasa') detail = rng.pick(C.FONASA_TRAMOS) + (age < 18 ? ' (carga familiar)' : '');
  else if (type === 'isapre') {
    const isapre = rng.pick(C.ISAPRES);
    detail = `${isapre.name} ${rng.pick(isapre.plans)}${age < 18 ? ' (carga)' : ''}`;
  } else if (type === 'particular') detail = rng.pick(C.PARTICULAR_DETAIL);
  else detail = rng.pick(C.OTHER_INSURANCE);
  return { healthInsurance: type, healthInsuranceDetail: detail };
}

const FAMILY_RELATIONS = new Set(['Madre', 'Padre', 'Hermano', 'Hermana', 'Hijo', 'Hija', 'Abuela', 'Abuelo', 'Tía', 'Tío', 'Nieto', 'Nieta', 'Prima', 'Primo']);

function emergencyContactFor(rng, age, surname1) {
  const group = age < 18 ? 'child' : age >= 65 ? 'senior' : 'adult';
  // Hijos solo desde los 40; padres como contacto principal solo hasta los 60.
  const options = C.EMERGENCY_RELATIONSHIPS[group].filter(([rel]) => {
    if (age < 40 && (rel === 'Hijo' || rel === 'Hija')) return false;
    if (age > 60 && (rel === 'Madre' || rel === 'Padre')) return false;
    return true;
  });
  const [relationship, g] = rng.pick(options);
  const gender = g === 'any' ? rng.pick(['f', 'm']) : g;
  const first = gender === 'f' ? rng.pick(C.FEMALE_NAMES) : rng.pick(C.MALE_NAMES);
  const surname = FAMILY_RELATIONS.has(relationship) ? surname1 : rng.pick(C.SURNAMES);
  return {
    emergencyContactName: `${first} ${surname}`,
    emergencyContactPhone: `+56 9 ${rng.int(3000, 9999)} ${pad(rng.int(0, 9999), 4)}`,
    emergencyContactRelationship: relationship,
  };
}

function allergiesFor(rng) {
  const count = rng.weighted([[0, 65], [1, 25], [2, 8], [3, 2]]);
  const keys = [];
  while (keys.length < count) {
    const key = rng.weighted(C.ALLERGY_WEIGHTS);
    if (!keys.includes(key)) keys.push(key);
  }
  const allergyNotes = keys.length
    ? keys.map((k) => rng.pick(C.ALLERGY_NOTES[k])).join(' ')
    : rng.pick(C.NO_ALLERGY_NOTES);
  return { allergies: keys, allergyNotes };
}

function medicalFor(rng, age, gender) {
  if (age < 18) {
    const p = rng.pick(C.PEDIATRIC_PROFILES);
    return { profile: p };
  }
  const healthyChance = age < 35 ? 0.55 : age <= 60 ? 0.35 : 0.15;
  const wantHealthy = rng.chance(healthyChance);
  const pool = C.MEDICAL_PROFILES.filter((p) => {
    if (p.pregnant && (gender !== 'femenino' || age < 18 || age > 42)) return false;
    if (p.minAge && age < p.minAge) return false;
    if (p.gender && p.gender !== gender) return false;
    return wantHealthy ? Boolean(p.healthy) : !p.healthy;
  });
  return { profile: rng.pick(pool.length ? pool : C.MEDICAL_PROFILES) };
}

// Antecedentes que suponen rehabilitación o enfermedad de larga data: solo desde los 30.
const MATURE_DENTAL_HISTORY = /prótesis|puente|implante|edéntulo|corona|retratamiento|periodontitis|hace más de 5 años|desgaste oclusal severo/i;

function dentalHistoryFor(rng, age) {
  if (age < 14) return rng.pick(C.PEDIATRIC_DENTAL_HISTORY);
  const pool = age < 30 ? C.DENTAL_HISTORY.filter((h) => !MATURE_DENTAL_HISTORY.test(h)) : C.DENTAL_HISTORY;
  return rng.pick(pool.length ? pool : C.DENTAL_HISTORY);
}

const PEDIATRIC_MOTIVO = /niño|Madre|erupción|diente de leche|sellantes/;

function motivoFor(rng, tipo, age) {
  const useEstetica = tipo === 'estetica' || (tipo === 'ambas' && age >= 18 && rng.chance(0.3));
  if (useEstetica) return rng.pick(C.MOTIVOS_ESTETICA);
  const pool = age < 13
    ? C.MOTIVOS_DENTAL.filter((m) => PEDIATRIC_MOTIVO.test(m))
    : C.MOTIVOS_DENTAL.filter((m) => !PEDIATRIC_MOTIVO.test(m));
  return rng.pick(pool);
}

const CONTEXT_TAGS = new Set(['adulto mayor', 'odontopediatría', 'embarazada', 'alergia medicamentos', 'estudiante', 'Fonasa', 'Isapre', 'diabético', 'hipertenso', 'anticoagulado', 'estética facial']);

function tagsFor(rng, { age, profile, allergies, healthInsurance, tipo }) {
  const tags = [];
  if (age >= 65 && rng.chance(0.6)) tags.push('adulto mayor');
  if (age < 13 && rng.chance(0.7)) tags.push('odontopediatría');
  if (age >= 13 && age <= 24 && rng.chance(0.3)) tags.push('estudiante');
  if (profile.pregnant) tags.push('embarazada');
  if (allergies.length && rng.chance(0.6)) tags.push('alergia medicamentos');
  if (/diabetes/i.test(profile.chronic) && rng.chance(0.7)) tags.push('diabético');
  else if (/hipertensi/i.test(profile.chronic) && rng.chance(0.6)) tags.push('hipertenso');
  if (/anticoagul|warfarina|rivaroxab|acenocumarol/i.test(profile.medications + profile.conditions)) tags.push('anticoagulado');
  if (tipo === 'estetica' && rng.chance(0.5)) tags.push('estética facial');
  if (healthInsurance === 'fonasa' && rng.chance(0.25)) tags.push('Fonasa');
  if (healthInsurance === 'isapre' && rng.chance(0.25)) tags.push('Isapre');

  const general = C.PATIENT_TAGS.filter((t) => !CONTEXT_TAGS.has(t));
  const target = rng.weighted([[1, 40], [2, 40], [3, 20]]);
  const picked = rng.shuffle(tags).slice(0, target);
  for (const t of rng.shuffle(general)) {
    if (picked.length >= target) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Odontograma: piezas FDI coherentes con la edad y el modo
// ---------------------------------------------------------------------------

function pickTooth(rng, age, mode) {
  const temporary = age <= 5 || (age <= 12 && rng.chance(0.5));
  if (temporary) return rng.pick([5, 6, 7, 8]) * 10 + rng.int(1, 5);
  const quadrant = rng.pick([1, 2, 3, 4]);
  if (age <= 12) return quadrant * 10 + rng.pick([1, 2, 6]); // incisivos y primeros molares definitivos
  if (mode === 'extraction') return quadrant * 10 + rng.weighted([[8, 45], [7, 15], [6, 15], [5, 8], [4, 8], [3, 3], [2, 3], [1, 3]]);
  return quadrant * 10 + rng.weighted([[6, 22], [7, 18], [5, 14], [4, 14], [1, 10], [2, 8], [3, 8], [8, 6]]);
}

function surfacesFor(rng, tooth) {
  const anterior = tooth % 10 <= 3;
  const pool = anterior ? ['V', 'L', 'M', 'D'] : ['O', 'V', 'L', 'M', 'D'];
  const count = rng.weighted([[1, 65], [2, 35]]);
  return rng.pickMany(pool, count);
}

const CHILD_OK = /^(EX|RX|PR|OD|UR-02|OB-0[1-4]|EN-05|CX-04|OR-01)/;
const CHILD_ONLY = /^(OD|EN-05|CX-04)/;

function plannablePrestaciones(clinic, age) {
  const dental = clinic.prestaciones.filter((p) => p.category === 'dental');
  const filtered = dental.filter((p) => (age < 13 ? CHILD_OK.test(p.code) : !CHILD_ONLY.test(p.code)));
  return filtered.length ? filtered : dental;
}

// ---------------------------------------------------------------------------
// Clínica
// ---------------------------------------------------------------------------

function buildStaff(ctx, clinic) {
  const { rng } = ctx;
  const users = [];
  const roles = [
    ...Array(rng.int(2, 3)).fill('odontologo'),
    ...Array(rng.int(1, 2)).fill('operador'),
    ...(rng.chance(0.5) ? ['radiologo'] : []),
  ];
  roles.forEach((role, i) => {
    const gender = rng.pick(['femenino', 'masculino']);
    const { firstName, lastName, surname1 } = personName(rng, gender);
    const title = role === 'odontologo' ? (gender === 'femenino' ? 'Dra. ' : 'Dr. ') : '';
    users.push({
      key: `U${i + 1}`,
      name: `${title}${firstName} ${lastName}`,
      email: ctx.uniqueEmail(`${slug(firstName)}.${slug(surname1)}.${ctx.mmdd}`),
      role,
      rut: ctx.uniqueRut('persona'),
      signature: role === 'odontologo',
    });
  });

  const schedules = [];
  const combos = [];
  for (let weekday = 1; weekday <= 6; weekday++) for (const half of ['am', 'pm']) combos.push([weekday, half]);
  for (const user of users.filter((u) => u.role === 'odontologo')) {
    const blocks = rng.pickMany(combos, rng.int(3, 5)).sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
    for (const [weekday, half] of blocks) {
      schedules.push({
        userKey: user.key,
        weekday,
        start: half === 'am' ? '09:00' : '14:30',
        end: half === 'am' ? '13:00' : '19:00',
        chairNumber: rng.chance(0.7) ? rng.pick(clinic.chairs).number : null,
      });
    }
  }
  return { users, schedules };
}

function buildCatalog(ctx, clinic, homeComuna) {
  const { rng } = ctx;
  const chairPrefix = rng.pick(C.CHAIR_NAMES);
  clinic.chairs = Array.from({ length: rng.int(2, 4) }, (_, i) => ({ number: i + 1, name: `${chairPrefix} ${i + 1}` }));

  const address = (comuna) => `${rng.pick(comuna.streets)} ${rng.int(100, 4999)}, ${comuna.name}`;
  clinic.sucursales = [{ name: `${rng.pick(C.BRANCH_NAMES.main)} ${homeComuna.name}`, address: address(homeComuna) }];
  if (rng.chance(0.5)) {
    const sameCity = C.COMUNAS.filter((c) => c.ciudad === homeComuna.ciudad && c.name !== homeComuna.name);
    const other = rng.pick(sameCity.length ? sameCity : C.COMUNAS.filter((c) => c.name !== homeComuna.name));
    clinic.sucursales.push({ name: `${rng.pick(C.BRANCH_NAMES.secondary)} ${other.name}`, address: address(other) });
  }

  const isapres = rng.pickMany(C.ISAPRES, rng.int(1, 2)).map((i) => ({ name: `Isapre ${i.name}` }));
  clinic.previsiones = [{ name: 'Fonasa' }, { name: 'Particular' }, ...isapres];

  // "Particular 0 %" siempre presente: la web exige convenio en cada presupuesto.
  const otherConvenios = rng.pickMany(C.CONVENIOS.filter((c) => c.name !== 'Particular'), rng.int(1, 2));
  clinic.convenios = [{ name: 'Particular', discountPercent: 0 }, ...otherConvenios.map((c) => ({ ...c }))];

  const total = rng.int(12, 20);
  let prestaciones;
  if (clinic.tipo === 'estetica') {
    prestaciones = rng.pickMany(C.ESTETICA_PRESTACIONES, total);
  } else {
    const dentalCount = clinic.tipo === 'ambas' ? Math.max(6, Math.ceil(total * 0.6)) : total;
    const mandatory = C.DENTAL_PRESTACIONES.filter((p) => ['EX-01', 'PR-01', 'OB-01', 'CX-01'].includes(p.code));
    const rest = rng.pickMany(C.DENTAL_PRESTACIONES.filter((p) => !mandatory.includes(p)), dentalCount - mandatory.length);
    prestaciones = [...mandatory, ...rest];
    if (clinic.tipo === 'ambas') prestaciones.push(...rng.pickMany(C.ESTETICA_PRESTACIONES, Math.max(4, total - dentalCount)));
  }
  clinic.prestaciones = prestaciones
    .map((p) => ({ code: p.code, name: p.name, price: p.price, category: p.category, odontogramMode: p.odontogramMode }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function buildPatient(ctx, clinic, index, homeComuna, withPhoto) {
  const { rng } = ctx;
  const key = `P${pad(index + 1, 3)}`;
  const gender = rng.weighted([['femenino', 52], ['masculino', 46], ['otro', 2]]);
  const age = pickAge(rng, clinic.tipo);
  const { firstName, lastName, surname1 } = personName(rng, gender);

  const comunaPool = rng.chance(0.65) ? C.COMUNAS.filter((c) => c.ciudad === homeComuna.ciudad) : C.COMUNAS;
  const comuna = rng.pick(comunaPool.length ? comunaPool : C.COMUNAS);
  const extra = rng.pick(C.ADDRESS_EXTRAS);
  const address = `${rng.pick(comuna.streets)} ${rng.int(10, 4999)}${extra ? `, ${extra}` : ''}, ${comuna.name}${comuna.ciudad !== comuna.name ? `, ${comuna.ciudad}` : ''}`;

  const { profile } = medicalFor(rng, age, gender);
  const { allergies, allergyNotes } = allergiesFor(rng);
  const insurance = insuranceFor(rng, age);
  const dentalHistory = dentalHistoryFor(rng, age);

  return {
    key,
    rut: ctx.uniqueRut('persona'),
    firstName,
    lastName,
    phoneLocal: `9 ${rng.int(3000, 9999)} ${pad(rng.int(0, 9999), 4)}`,
    birthDate: birthDateForAge(rng, ctx.today, age),
    email: ctx.uniqueEmail(`${slug(firstName)}.${slug(surname1)}.${ctx.mmdd}`),
    address,
    gender,
    maritalStatus: maritalStatusFor(rng, age),
    nationality: rng.weighted(C.NATIONALITIES),
    occupation: occupationFor(rng, age, gender),
    ...insurance,
    ...emergencyContactFor(rng, age, surname1),
    ...bodyFor(rng, age, gender),
    bloodType: rng.weighted(C.BLOOD_TYPES),
    allergies,
    allergyNotes,
    medicalConditions: profile.conditions,
    currentMedications: profile.medications,
    chronicDiseases: profile.chronic,
    dentalHistory,
    tags: tagsFor(rng, { age, profile, allergies, healthInsurance: insurance.healthInsurance, tipo: clinic.tipo }),
    motivoConsulta: motivoFor(rng, clinic.tipo, age),
    photoPath: withPhoto ? `assets/generated/${ctx.runId}/avatar-${clinic.key}-${key}.png` : null,
    id: null,
    _age: age, // uso interno; se elimina antes de devolver el plan
  };
}

const ESTETICA_NOTES = ['Aplicación de toxina botulínica', 'Relleno con ácido hialurónico', 'Limpieza facial', 'Primera consulta', 'Revisión de presupuesto', 'Evaluación inicial'];
const ESTETICA_EVOLUTION = /toxina|hialurónico/i;

function buildAppointments(ctx, clinic) {
  const { rng } = ctx;
  const odontologos = clinic.users.filter((u) => u.role === 'odontologo');
  const bookings = []; // { date, start, end, chairNumber, userKey, patientKey }
  const overlaps = (a, b) => a.date === b.date && a.start < b.end && b.start < a.end;
  const notesPool = clinic.tipo === 'estetica' ? ESTETICA_NOTES : C.APPOINTMENT_NOTES.cita;
  const appointments = [];

  for (const patient of clinic.patients) {
    const wanted = rng.weighted([[1, 50], [2, 35], [3, 15]]);
    let created = 0;
    for (let attempt = 0; attempt < 40 && created < wanted; attempt++) {
      const day = addDays(ctx.today, rng.int(-10, 20));
      if (day.getUTCDay() === 0) continue; // sin domingos
      const start = 540 + rng.int(0, 38) * 15; // 09:00 .. 18:30
      const durationMin = rng.weighted([[30, 50], [45, 30], [60, 20]]);
      const candidate = {
        date: formatDate(day), start, end: start + durationMin,
        chairNumber: rng.pick(clinic.chairs).number, userKey: patient.userKey || rng.pick(odontologos).key, patientKey: patient.key,
      };
      const clash = bookings.some((b) => overlaps(b, candidate) && (b.chairNumber === candidate.chairNumber || b.userKey === candidate.userKey || b.patientKey === candidate.patientKey));
      if (clash) continue;
      bookings.push(candidate);
      appointments.push({
        patientKey: patient.key,
        userKey: candidate.userKey,
        chairNumber: candidate.chairNumber,
        date: candidate.date,
        time: minutesToTime(start),
        durationMin,
        notes: rng.pick(notesPool),
        type: 'cita',
      });
      created++;
    }
  }
  return appointments.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.chairNumber - b.chairNumber);
}

function previsionFor(clinic, patient, rng) {
  const names = clinic.previsiones.map((p) => p.name);
  if (patient.healthInsurance === 'fonasa') return 'Fonasa';
  if (patient.healthInsurance === 'isapre') {
    const isapres = names.filter((n) => n.startsWith('Isapre'));
    return isapres.length ? rng.pick(isapres) : 'Particular';
  }
  return 'Particular';
}

function buildTreatmentPlans(ctx, clinic) {
  const { rng } = ctx;
  if (clinic.tipo === 'estetica') return []; // mapa facial: no se automatiza
  const odontologos = clinic.users.filter((u) => u.role === 'odontologo');
  const plans = [];
  for (const patient of clinic.patients) {
    if (!rng.chance(0.5)) continue;
    const pool = plannablePrestaciones(clinic, patient._age);
    const chosen = rng.pickMany(pool, rng.int(1, Math.min(4, pool.length)));
    const items = chosen.map((p) => {
      let teeth = [];
      let surfaces = [];
      if (p.odontogramMode === 'tooth' || p.odontogramMode === 'extraction') {
        teeth = [pickTooth(rng, patient._age, p.odontogramMode)];
      } else if (p.odontogramMode === 'surface') {
        const tooth = pickTooth(rng, patient._age, 'surface');
        teeth = [tooth];
        surfaces = surfacesFor(rng, tooth);
      }
      return {
        prestacionCode: p.code,
        teeth,
        surfaces,
        discountPercent: rng.weighted([[0, 85], [5, 8], [10, 7]]),
        notes: rng.chance(0.2) ? rng.pick(['Pieza con sintomatología', 'Prioridad alta', 'Confirmar con radiografía', 'Segunda etapa']) : '',
      };
    });
    const convenio = rng.chance(0.7) ? 'Particular' : rng.pick(clinic.convenios).name;
    plans.push({
      patientKey: patient.key,
      userKey: patient.userKey || rng.pick(odontologos).key,
      sucursalName: rng.pick(clinic.sucursales).name,
      previsionName: previsionFor(clinic, patient, rng),
      convenioName: convenio,
      paymentMethod: rng.weighted([['Contado', 60], ['Cuotas', 40]]),
      observations: rng.pick(C.TREATMENT_PLAN_OBSERVATIONS),
      items,
    });
  }
  return plans;
}

function buildEvolutions(ctx, clinic) {
  const { rng } = ctx;
  const odontologos = clinic.users.filter((u) => u.role === 'odontologo');
  const estetica = C.EVOLUTION_TEXTS.filter((t) => ESTETICA_EVOLUTION.test(t));
  const dental = C.EVOLUTION_TEXTS.filter((t) => !ESTETICA_EVOLUTION.test(t));
  const evolutions = [];
  for (const patient of clinic.patients) {
    if (!rng.chance(0.6)) continue;
    const count = rng.weighted([[1, 65], [2, 35]]);
    let pool = dental;
    if (clinic.tipo === 'estetica') pool = estetica;
    else if (clinic.tipo === 'ambas' && patient._age >= 18 && rng.chance(0.3)) pool = estetica;
    for (const text of rng.pickMany(pool, count)) {
      evolutions.push({ patientKey: patient.key, userKey: patient.userKey || rng.pick(odontologos).key, text });
    }
  }
  return evolutions;
}

function docNumberFor(rng, method) {
  const prefix = { Transferencia: 'TRX', Tarjeta: 'VOU', Cheque: 'CHQ', Efectivo: '' }[method] ?? 'DOC';
  return prefix ? `${prefix}-${rng.int(10000, 999999)}` : '';
}

function buildLedger(ctx, clinic) {
  const { rng } = ctx;
  const withPlan = new Set(clinic.treatmentPlans.map((p) => p.patientKey));
  const ledger = [];
  for (const patient of clinic.patients) {
    if (!rng.chance(0.4)) continue;
    const count = rng.weighted([[1, 70], [2, 30]]);
    for (let i = 0; i < count; i++) {
      // El primer movimiento siempre es un abono; los siguientes pueden ser interés o ajuste si hay presupuesto.
      const type = i === 0 || !withPlan.has(patient.key) ? 'abono' : rng.weighted([['abono', 60], ['interes', 20], ['ajuste', 20]]);
      if (type === 'abono') {
        const method = rng.pick(C.PAYMENT_METHODS);
        ledger.push({
          patientKey: patient.key, type, amount: roundTo(rng.int(15000, 350000), 5000),
          paymentMethod: method, docNumber: docNumberFor(rng, method),
          description: rng.pick(C.LEDGER_DESCRIPTIONS), notes: rng.pick(C.LEDGER_NOTES),
        });
      } else if (type === 'interes') {
        ledger.push({
          patientKey: patient.key, type, amount: roundTo(rng.int(2000, 25000), 1000),
          description: rng.pick(['Interés por mora', 'Interés cuota atrasada', 'Interés por pago fuera de plazo']), notes: '',
        });
      } else {
        const direction = rng.pick(['debe', 'haber']);
        ledger.push({
          patientKey: patient.key, type, direction, amount: roundTo(rng.int(5000, 50000), 1000),
          description: direction === 'haber' ? rng.pick(['Ajuste por descuento comercial', 'Ajuste redondeo a favor', 'Ajuste por convenio']) : rng.pick(['Ajuste por insumo adicional', 'Ajuste de saldo', 'Ajuste por sesión extra']),
          notes: '',
        });
      }
    }
  }
  return ledger;
}

function buildObservations(ctx, clinic) {
  const { rng } = ctx;
  return clinic.patients
    .filter(() => rng.chance(0.35))
    .map((p) => ({ patientKey: p.key, text: rng.pick(C.ADMIN_OBSERVATIONS) }));
}

function buildDocuments(ctx, clinic) {
  const { rng } = ctx;
  const documents = [];
  for (const patient of clinic.patients) {
    if (!rng.chance(0.25)) continue;
    const category = rng.weighted(C.DOCUMENT_CATEGORY_WEIGHTS);
    const template = C.DOCUMENT_TEMPLATES[category];
    const base = `assets/generated/${ctx.runId}/doc-${clinic.key}-${patient.key}-${category}`;
    const filePath = category === 'imagen' ? patient.photoPath || `${base}.png` : `${base}.pdf`;
    documents.push({ patientKey: patient.key, category, description: rng.pick(template.descriptions), filePath });
  }
  return documents;
}

function buildClinic(ctx, { index, root, patientsCount }) {
  const { rng, config } = ctx;
  const key = `C${pad(index + 1)}`;
  const name = `${config.clinicPrefix} ${root}`;
  const tipo = rng.weighted([['dental', 70], ['ambas', 20], ['estetica', 10]]);
  const homeComuna = rng.pick(C.COMUNAS);
  const adminGender = rng.pick(['femenino', 'masculino']);
  const admin = personName(rng, adminGender);
  const adminSlug = slug(root.replace(/cl[ií]nica/i, ''), 24);

  const clinic = {
    key,
    name,
    rut: ctx.uniqueRut('empresa'),
    tipo,
    pais: 'Chile',
    logoPath: `assets/generated/${ctx.runId}/logo-${key}.png`,
    id: null,
    federated: false,
    admin: {
      name: `${admin.firstName} ${admin.lastName}`,
      email: ctx.uniqueEmail(`admin.${adminSlug}.${ctx.mmdd}`, { numbered: false }),
      rut: ctx.uniqueRut('persona'),
    },
    users: [], schedules: [], chairs: [], sucursales: [], previsiones: [], convenios: [], prestaciones: [],
    patients: [], appointments: [], treatmentPlans: [], evolutions: [], ledger: [], observations: [], documents: [],
  };

  buildCatalog(ctx, clinic, homeComuna);
  Object.assign(clinic, buildStaff(ctx, clinic));

  const photoCount = Math.round(patientsCount * ctx.photoRatio);
  const photoIdx = new Set(rng.pickMany(Array.from({ length: patientsCount }, (_, i) => i), photoCount));
  for (let i = 0; i < patientsCount; i++) clinic.patients.push(buildPatient(ctx, clinic, i, homeComuna, photoIdx.has(i)));
  // Odontólogo tratante fijo por paciente: registra su motivo de consulta y firma citas, presupuestos y evoluciones.
  {
    const tratantes = clinic.users.filter((u) => u.role === 'odontologo');
    for (const patient of clinic.patients) patient.userKey = tratantes.length ? ctx.rng.pick(tratantes).key : 'admin';
  }

  clinic.appointments = buildAppointments(ctx, clinic);
  clinic.treatmentPlans = buildTreatmentPlans(ctx, clinic);
  clinic.evolutions = buildEvolutions(ctx, clinic);
  clinic.ledger = buildLedger(ctx, clinic);
  clinic.observations = buildObservations(ctx, clinic);
  clinic.documents = buildDocuments(ctx, clinic);

  for (const p of clinic.patients) delete p._age;
  return clinic;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Construye el plan diario completo (sin ids). Determinista dado `seed`.
 * `used` = { ruts: Set, emails: Set } del registro (RUT limpios, correos en minúsculas).
 */
export function buildDailyPlan({ runId, date, clinicsCount, patientsTotal, photoRatio, used, config = defaultConfig, seed } = {}) {
  if (!runId) throw new Error('buildDailyPlan requiere runId.');
  if (!date) throw new Error('buildDailyPlan requiere date (YYYY-MM-DD).');
  const clinics = clinicsCount ?? config.clinicsPerDay;
  const patients = patientsTotal ?? config.patientsPerDay;
  const ratio = photoRatio ?? config.photoRatio ?? 0.25;
  const effectiveSeed = seed ?? runId;
  const rng = createRng(effectiveSeed);
  const ctx = createContext({ rng, used, config, runId, date, photoRatio: ratio, seed: effectiveSeed });

  const roots = rng.pickMany(C.CLINIC_ROOTS, clinics);
  if (roots.length < clinics) throw new Error(`Solo hay ${roots.length} raíces de nombre de clínica para ${clinics} clínicas.`);
  const counts = distributePatients(patients, clinics, rng);

  const plan = {
    runId,
    date,
    seed: effectiveSeed,
    clinics: roots.map((root, index) => buildClinic(ctx, { index, root, patientsCount: counts[index] })),
  };
  validatePlan(plan);
  return plan;
}

/** Verificaciones internas de coherencia; lanza si algo viola el contrato. */
export function validatePlan(plan) {
  const ruts = new Set();
  const emails = new Set();
  const names = new Set();
  const addRut = (rut, where) => {
    const clean = rut.replace(/[^0-9kK]/g, '').toUpperCase();
    if (ruts.has(clean)) throw new Error(`RUT repetido ${rut} en ${where}`);
    ruts.add(clean);
  };
  const addEmail = (email, where) => {
    if (email !== email.toLowerCase()) throw new Error(`Correo con mayúsculas ${email} en ${where}`);
    if (emails.has(email)) throw new Error(`Correo repetido ${email} en ${where}`);
    emails.add(email);
  };
  for (const clinic of plan.clinics) {
    if (names.has(clinic.name)) throw new Error(`Nombre de clínica repetido: ${clinic.name}`);
    names.add(clinic.name);
    addRut(clinic.rut, clinic.key);
    addRut(clinic.admin.rut, `${clinic.key}/admin`);
    addEmail(clinic.admin.email, `${clinic.key}/admin`);
    for (const u of clinic.users) {
      addRut(u.rut, `${clinic.key}/${u.key}`);
      addEmail(u.email, `${clinic.key}/${u.key}`);
    }
    const patientKeys = new Set(clinic.patients.map((p) => p.key));
    for (const p of clinic.patients) {
      addRut(p.rut, `${clinic.key}/${p.key}`);
      addEmail(p.email, `${clinic.key}/${p.key}`);
      if (p.allergies.length && !p.allergyNotes) throw new Error(`Paciente ${p.key} con alergias sin detalle.`);
    }
    if (!clinic.convenios.some((c) => c.name === 'Particular')) throw new Error(`${clinic.key} sin convenio Particular.`);
    const codes = new Set(clinic.prestaciones.map((p) => p.code));
    for (const tp of clinic.treatmentPlans) {
      if (!tp.convenioName) throw new Error(`Presupuesto sin convenio (${clinic.key}/${tp.patientKey}).`);
      if (!['Contado', 'Cuotas'].includes(tp.paymentMethod)) throw new Error(`Forma de pago inválida en presupuesto: ${tp.paymentMethod}`);
      for (const item of tp.items) {
        if (!codes.has(item.prestacionCode)) throw new Error(`Prestación ${item.prestacionCode} no está en el catálogo de ${clinic.key}.`);
        for (const s of item.surfaces) if (!['O', 'V', 'L', 'M', 'D'].includes(s)) throw new Error(`Cara inválida ${s}`);
      }
    }
    // Choques de agenda por sillón dentro de la clínica.
    const byChairDate = new Map();
    for (const a of clinic.appointments) {
      if (!patientKeys.has(a.patientKey)) throw new Error(`Cita con paciente inexistente ${a.patientKey}`);
      if (parseDate(a.date).getUTCDay() === 0) throw new Error(`Cita en domingo: ${a.date}`);
      const [h, m] = a.time.split(':').map(Number);
      const start = h * 60 + m;
      const listKey = `${a.chairNumber}|${a.date}`;
      const list = byChairDate.get(listKey) ?? [];
      for (const [s, e] of list) if (start < e && s < start + a.durationMin) throw new Error(`Choque de sillón ${listKey} ${a.time}`);
      list.push([start, start + a.durationMin]);
      byChairDate.set(listKey, list);
    }
  }
  return true;
}

/** Conteos por entidad, totales y por clínica. */
export function summarizePlan(plan) {
  const totals = {
    clinics: plan.clinics.length, byTipo: { dental: 0, ambas: 0, estetica: 0 },
    users: 0, odontologos: 0, schedules: 0, chairs: 0, sucursales: 0, previsiones: 0, convenios: 0, prestaciones: 0,
    patients: 0, patientsWithPhoto: 0, appointments: 0, treatmentPlans: 0, treatmentItems: 0,
    evolutions: 0, ledger: 0, observations: 0, documents: 0,
  };
  const perClinic = [];
  for (const c of plan.clinics) {
    totals.byTipo[c.tipo] = (totals.byTipo[c.tipo] ?? 0) + 1;
    const row = {
      key: c.key, name: c.name, tipo: c.tipo, users: c.users.length, patients: c.patients.length,
      appointments: c.appointments.length, treatmentPlans: c.treatmentPlans.length, evolutions: c.evolutions.length,
      ledger: c.ledger.length, observations: c.observations.length, documents: c.documents.length,
    };
    perClinic.push(row);
    totals.users += c.users.length;
    totals.odontologos += c.users.filter((u) => u.role === 'odontologo').length;
    totals.schedules += c.schedules.length;
    totals.chairs += c.chairs.length;
    totals.sucursales += c.sucursales.length;
    totals.previsiones += c.previsiones.length;
    totals.convenios += c.convenios.length;
    totals.prestaciones += c.prestaciones.length;
    totals.patients += c.patients.length;
    totals.patientsWithPhoto += c.patients.filter((p) => p.photoPath).length;
    totals.appointments += c.appointments.length;
    totals.treatmentPlans += c.treatmentPlans.length;
    totals.treatmentItems += c.treatmentPlans.reduce((s, p) => s + p.items.length, 0);
    totals.evolutions += c.evolutions.length;
    totals.ledger += c.ledger.length;
    totals.observations += c.observations.length;
    totals.documents += c.documents.length;
  }
  return { totals, perClinic };
}

function documentLines(plan, clinic, patient, doc) {
  const template = C.DOCUMENT_TEMPLATES[doc.category];
  const odontologo = clinic.users.find((u) => u.role === 'odontologo');
  return [
    `Paciente: ${patient.firstName} ${patient.lastName}`,
    `RUT: ${patient.rut}    Fecha de nacimiento: ${patient.birthDate}`,
    `Previsión: ${patient.healthInsuranceDetail}`,
    `Fecha de emisión: ${plan.date}`,
    `Profesional: ${odontologo ? odontologo.name : clinic.admin.name}`,
    `Sucursal: ${clinic.sucursales[0].name} — ${clinic.sucursales[0].address}`,
    '',
    `Descripción: ${doc.description}`,
    '',
    ...template.body,
    '',
    'Documento generado automáticamente con datos ficticios para ambiente de demostración.',
  ];
}

/**
 * Genera físicamente logos, avatares y PDFs del plan en config.dirs.generated/<runId>/.
 * Devuelve { files, dir }.
 */
export async function materializeAssets(plan, { log, config = defaultConfig } = {}) {
  const info = (msg) => (log?.info ? log.info(msg) : console.log(msg));
  const root = config.dirs.root;
  const dir = path.join(config.dirs.generated, plan.runId);
  fs.mkdirSync(dir, { recursive: true });
  const abs = (rel) => (path.isAbsolute(rel) ? rel : path.join(root, rel));
  const seed = plan.seed ?? plan.runId;

  const factory = await createImageFactory();
  const files = [];
  try {
    for (const clinic of plan.clinics) {
      // Iniciales a partir de la raíz del nombre (sin el prefijo fijo ni la palabra "Clínica").
      const root = clinic.name.replace(new RegExp(`^${config.clinicPrefix}\\s+`, 'i'), '').replace(/cl[ií]nica\s+/i, '');
      const initials = root.split(/\s+/).filter((w) => w && !/^(de|del|la|las|los|el|y)$/i.test(w)).slice(0, 3).map((w) => w[0].toUpperCase()).join('') || 'DC';
      await factory.logo({ name: root, initials, tipo: clinic.tipo, outPath: abs(clinic.logoPath), rng: createRng(`${seed}:logo:${clinic.key}`) });
      files.push(clinic.logoPath);

      const patientsByKey = new Map(clinic.patients.map((p) => [p.key, p]));
      for (const patient of clinic.patients) {
        if (!patient.photoPath) continue;
        await factory.avatar({
          firstName: patient.firstName, lastName: patient.lastName, gender: patient.gender, birthDate: patient.birthDate,
          referenceDate: plan.date, outPath: abs(patient.photoPath), rng: createRng(`${seed}:avatar:${clinic.key}:${patient.key}`),
        });
        files.push(patient.photoPath);
      }

      for (const doc of clinic.documents) {
        const patient = patientsByKey.get(doc.patientKey);
        if (doc.filePath.endsWith('.pdf')) {
          await generatePdf({
            title: C.DOCUMENT_TEMPLATES[doc.category].title,
            subtitle: `${clinic.name} · ${doc.description}`,
            lines: documentLines(plan, clinic, patient, doc),
            footer: `${clinic.name} — RUT ${clinic.rut} — documento de demostración`,
            outPath: abs(doc.filePath),
          });
          files.push(doc.filePath);
        } else if (doc.filePath !== patient.photoPath) {
          await factory.avatar({
            firstName: patient.firstName, lastName: patient.lastName, gender: patient.gender, birthDate: patient.birthDate,
            referenceDate: plan.date, outPath: abs(doc.filePath), rng: createRng(`${seed}:doc:${clinic.key}:${patient.key}`),
          });
          files.push(doc.filePath);
        }
      }
      info(`Assets de ${clinic.key} (${clinic.name}) listos: ${files.length} archivos acumulados.`);
    }
  } finally {
    await factory.close();
  }
  return { files, dir };
}
