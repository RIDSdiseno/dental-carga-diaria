// Flujos del rol admin sobre /profesionales en DentalCloud: crear usuarios
// (profesionales) con firma dibujada y asignar bloques de horario. Todo por la web.
//
// Formularios de la web que usa este módulo (dentalcloud-front/src/pages/profesionales):
// - Profesionales.tsx: h1 "Profesionales", botón "Agregar profesional" y tabla
//   Nombre | Correo | RUT | Rol con botones "Permisos" y "Horario" por fila (el de
//   "Horario" solo existe para roles odontologo | radiologo | operador).
// - ProfessionalFormModal.tsx: modal "Agregar profesional" con #prof-name, #prof-email,
//   #prof-password (mín. 8), #prof-role (values odontologo|radiologo|operador|admin),
//   #prof-rut (placeholder "76.123.456-7") y el <canvas> de components/SignaturePad.tsx
//   (dibujo con Pointer Events, botón "Borrar"); botón submit "Crear profesional".
// - GeneratedPasswordDialog.tsx: modal "Contraseña generada para RIDS RX". Aparece solo
//   cuando la clínica tiene Rx y el profesional sincronizó con RIDS RX; se cierra con
//   "Entendido". Nunca registramos su contenido.
// - ScheduleModal.tsx: modal "Horario de <nombre>". Lista un renglón por día
//   ("Domingo".."Sábado") con chips "HH:MM–HH:MM · <sillón>" y un formulario de alta
//   sin ids: <select> Día (values 0..6), <input type=time> Desde, <input type=time> Hasta,
//   <select> Sillón (option "" = "Cualquiera"; el resto `chair.name || "Sillón N"`) y botón
//   "Agregar". Los selects se ubican por orden dentro del contenedor del botón "Agregar".
//   Error 409 del backend al solapar: "Ese horario se superpone con un bloque ya agregado".
import {
  drawSignature,
  escapeRegExp,
  fillIfDefined,
  modal,
  submitAndWaitClosed,
  visibleError,
  waitModalClosed,
} from './_helpers.js';

export const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const VALID_ROLES = ['odontologo', 'radiologo', 'operador', 'admin'];
export const SCHEDULABLE_ROLES = ['odontologo', 'radiologo', 'operador'];

const GENERATED_PASSWORD_TITLE = 'Contraseña generada para RIDS RX';

async function gotoProfesionales(page, ctx, { reload = false } = {}) {
  const url = `${ctx.config.dentalcloudUrl}/profesionales`;
  if (reload || !page.url().startsWith(url)) await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1, name: 'Profesionales', exact: true }).waitFor();
}

/** Espera a que la tabla (o el aviso de lista vacía) termine de cargar. */
async function waitUsersLoaded(page, ctx) {
  const timeout = ctx.config.actionTimeoutMs;
  const firstRow = page.locator('table tbody tr').first();
  const empty = page.getByText('Aún no hay profesionales registrados.', { exact: true });
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await firstRow.isVisible().catch(() => false)) return 'table';
    if (await empty.isVisible().catch(() => false)) return 'empty';
    const err = await visibleError(page);
    if (err) throw new Error(`La web no pudo cargar los profesionales: ${err}`);
    await page.waitForTimeout(150);
  }
  throw new Error(`La lista de profesionales no terminó de cargar en ${timeout} ms.`);
}

/** Fila de la tabla cuyo correo coincide (sin distinguir mayúsculas). */
function userRow(page, email) {
  const pattern = new RegExp(`^${escapeRegExp(String(email).trim())}$`, 'i');
  return page.locator('table tbody tr').filter({ has: page.getByText(pattern) }).first();
}

/** Lee la tabla: [{ name, email, rut, roleLabel }]. */
export async function listExistingProfessionals(page, ctx) {
  await gotoProfesionales(page, ctx);
  if ((await waitUsersLoaded(page, ctx)) === 'empty') return [];
  const rows = page.locator('table tbody tr');
  const count = await rows.count();
  const items = [];
  for (let i = 0; i < count; i++) {
    const cells = rows.nth(i).locator('td');
    items.push({
      name: ((await cells.nth(0).textContent()) || '').trim(),
      email: ((await cells.nth(1).textContent()) || '').trim(),
      rut: (await cells.nth(2).locator('input').inputValue().catch(() => '')).trim(),
      roleLabel: ((await cells.nth(3).textContent()) || '').trim(),
    });
  }
  return items;
}

async function closeModalIfOpen(page, dlg, title) {
  const heading = page.getByRole('heading', { level: 2, name: title, exact: true });
  if (!(await heading.isVisible().catch(() => false))) return;
  await dlg.getByRole('button', { name: 'Cerrar', exact: true }).click().catch(() => undefined);
  await waitModalClosed(page, title, 5000).catch(() => undefined);
}

/**
 * Si tras crear el usuario la web muestra "Contraseña generada para RIDS RX",
 * lo cierra con "Entendido". El diálogo aparece en el mismo render en que se
 * cierra el formulario, por eso basta una espera corta.
 */
async function dismissGeneratedPasswordDialog(page, ctx, timeout = 1500) {
  const heading = page.getByRole('heading', { level: 2, name: GENERATED_PASSWORD_TITLE, exact: true });
  const appeared = await heading
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;
  const dlg = modal(page, GENERATED_PASSWORD_TITLE);
  await dlg.getByRole('button', { name: 'Entendido', exact: true }).click();
  await waitModalClosed(page, GENERATED_PASSWORD_TITLE);
  ctx.log.info('La web mostró una contraseña generada para RIDS RX; se cerró el aviso sin registrarla.');
  return true;
}

/**
 * Crea un profesional con el modal "Agregar profesional".
 * user = { name, email, role, rut, signature }. La contraseña es siempre
 * ctx.config.defaultUserPassword() y nunca se escribe en el log.
 * Idempotente por correo: si ya aparece en la tabla, avisa y devuelve false.
 */
export async function addProfessional(page, user, ctx) {
  const { config, log } = ctx;
  if (!user?.email || !user?.name) throw new Error('addProfessional: name y email son obligatorios.');
  if (!VALID_ROLES.includes(user.role)) {
    throw new Error(`addProfessional: rol "${user.role}" no existe en la web (válidos: ${VALID_ROLES.join(', ')}).`);
  }
  const title = 'Agregar profesional';

  await gotoProfesionales(page, ctx);
  await waitUsersLoaded(page, ctx);
  if (await userRow(page, user.email).count()) {
    log.warn(`El profesional ${user.email} ya estaba en la tabla; no se crea de nuevo.`);
    return false;
  }

  await page.getByRole('button', { name: 'Agregar profesional', exact: true }).click();
  const dlg = modal(page, title);
  await dlg.waitFor();

  await dlg.locator('#prof-name').fill(user.name);
  await dlg.locator('#prof-email').fill(user.email);
  await dlg.locator('#prof-password').fill(config.defaultUserPassword());
  await dlg.locator('#prof-role').selectOption(user.role);
  await fillIfDefined(dlg.locator('#prof-rut'), user.rut);

  if (user.signature) {
    // El canvas puede quedar bajo el pliegue del modal (max-h 75vh con scroll).
    const canvas = dlg.locator('canvas').first();
    await canvas.waitFor();
    await canvas.scrollIntoViewIfNeeded();
    await drawSignature(page, canvas);
  }

  try {
    await submitAndWaitClosed(page, dlg, 'Crear profesional', title, 60000);
  } catch (err) {
    await closeModalIfOpen(page, dlg, title);
    if (/ya existe un usuario/i.test(err.message)) {
      log.warn(`La web indica que ${user.email} ya existe; se reutiliza. (${err.message})`);
      await gotoProfesionales(page, ctx, { reload: true });
      return false;
    }
    throw err;
  }

  await dismissGeneratedPasswordDialog(page, ctx);
  await userRow(page, user.email).waitFor();
  log.info(`Profesional creado: ${user.name} <${user.email}> rol=${user.role}${user.rut ? ` rut=${user.rut}` : ''}${user.signature ? ' (con firma)' : ''}`);
  return true;
}

// ---------------------------------------------------------------------------
// Horarios
// ---------------------------------------------------------------------------

/** Abre el modal "Horario de <nombre>" desde la fila del profesional y ubica su formulario. */
async function openScheduleModal(page, user, ctx) {
  await gotoProfesionales(page, ctx);
  await waitUsersLoaded(page, ctx);
  const row = userRow(page, user.email);
  if (!(await row.count())) {
    throw new Error(`El profesional ${user.email} no aparece en la tabla; créalo antes de asignarle horario.`);
  }
  const horarioButton = row.getByRole('button', { name: 'Horario', exact: true });
  if (!(await horarioButton.count())) return null;
  await horarioButton.click();

  // El título usa el nombre tal como lo guardó el backend; lo leemos del propio h2.
  const heading = page.getByRole('heading', { level: 2, name: /^Horario de / });
  await heading.waitFor();
  const title = ((await heading.textContent()) || '').trim();
  const dlg = modal(page, title);
  await dlg.waitFor();

  const addButton = dlg.getByRole('button', { name: 'Agregar', exact: true });
  const form = addButton.locator('xpath=..');
  return {
    dlg,
    title,
    addButton,
    daySelect: form.locator('select').nth(0),
    chairSelect: form.locator('select').nth(1),
    fromInput: form.locator('input[type="time"]').nth(0),
    toInput: form.locator('input[type="time"]').nth(1),
  };
}

async function closeScheduleModal(page, opened) {
  if (!opened) return;
  await opened.dlg.getByRole('button', { name: 'Cerrar', exact: true }).click().catch(() => undefined);
  await waitModalClosed(page, opened.title, 5000).catch(() => undefined);
}

/** Chip "HH:MM–HH:MM" dentro del renglón del día indicado (tolera segundos y guion corto/largo). */
function scheduleChip(dlg, dayLabel, start, end) {
  const dayRow = dlg
    .locator('span', { hasText: new RegExp(`^${escapeRegExp(dayLabel)}$`) })
    .first()
    .locator('xpath=..');
  const timePattern = new RegExp(`^${escapeRegExp(start)}(?::\\d{2})?\\s*[–-]\\s*${escapeRegExp(end)}(?::\\d{2})?`);
  return dayRow.locator('span', { hasText: timePattern }).first();
}

async function optionList(select) {
  return select.locator('option').evaluateAll((els) => els.map((el) => ({ value: el.value, label: (el.textContent || '').trim() })));
}

/** Espera a que el <select> de sillón tenga más opciones que "Cualquiera". */
async function waitChairOptions(select, ctx) {
  const timeout = ctx.config.actionTimeoutMs;
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if ((await select.locator('option').count()) > 1) return true;
    await select.page().waitForTimeout(150);
  }
  return false;
}

/**
 * Devuelve la opción del <select> de sillón para chairNumber (null = "Cualquiera").
 * Busca por `chair.name` del plan (ctx.resolveChair) o por "Sillón N"; primero
 * coincidencia exacta y luego "contiene".
 */
async function resolveChairOption(select, chairNumber, ctx) {
  if (chairNumber === null || chairNumber === undefined || chairNumber === '') {
    return { value: '', label: 'Cualquiera' };
  }
  const chair = ctx.resolveChair ? ctx.resolveChair(chairNumber) : null;
  const wanted = [chair?.name, `Sillón ${chairNumber}`].filter(Boolean).map((s) => s.trim().toLowerCase());
  const options = (await optionList(select)).filter((o) => o.value !== '');
  const exact = options.find((o) => wanted.includes(o.label.toLowerCase()));
  if (exact) return exact;
  const partial = options.find((o) => wanted.some((w) => o.label.toLowerCase().includes(w)));
  if (partial) return partial;
  throw new Error(
    `No se encontró el sillón ${chairNumber} (${wanted.join(' / ')}) en el selector de horario. Opciones: ${options.map((o) => o.label).join(', ') || 'ninguna'}`
  );
}

/**
 * Agrega bloques de horario al profesional con el modal "Horario de <nombre>".
 * blocks = [{ weekday (0=Domingo..6=Sábado), start "HH:MM", end "HH:MM", chairNumber|null }].
 * Idempotente: si el chip del bloque ya está en el día, lo salta. Espera a que
 * cada bloque aparezca en la lista antes de agregar el siguiente.
 * Devuelve la cantidad de bloques creados.
 */
export async function addSchedule(page, user, blocks, ctx) {
  const { log } = ctx;
  if (!blocks || blocks.length === 0) return 0;
  if (!SCHEDULABLE_ROLES.includes(user.role)) {
    log.warn(`El rol "${user.role}" de ${user.email} no admite horario en la web; se omiten ${blocks.length} bloque(s).`);
    return 0;
  }

  let opened = await openScheduleModal(page, user, ctx);
  if (!opened) {
    log.warn(`La fila de ${user.email} no tiene botón "Horario"; se omiten ${blocks.length} bloque(s).`);
    return 0;
  }

  if (blocks.some((b) => b.chairNumber !== null && b.chairNumber !== undefined)) {
    if (!(await waitChairOptions(opened.chairSelect, ctx))) {
      await closeScheduleModal(page, opened);
      throw new Error(`El selector de sillón de ${user.email} no cargó sillones; crea los sillones antes de los horarios.`);
    }
  }

  let added = 0;
  try {
    for (const block of blocks) {
      const weekday = Number(block.weekday);
      const dayLabel = WEEKDAY_LABELS[weekday];
      if (!dayLabel) throw new Error(`addSchedule: weekday inválido "${block.weekday}" (0=Domingo..6=Sábado).`);
      if (!/^\d{2}:\d{2}$/.test(block.start) || !/^\d{2}:\d{2}$/.test(block.end)) {
        throw new Error(`addSchedule: horas inválidas "${block.start}"–"${block.end}" (formato HH:MM).`);
      }
      const label = `${dayLabel} ${block.start}–${block.end}${block.chairNumber != null ? ` (sillón ${block.chairNumber})` : ''}`;

      const chip = scheduleChip(opened.dlg, dayLabel, block.start, block.end);
      if (await chip.count()) {
        log.warn(`Bloque de horario ya existente para ${user.email}: ${label}; se omite.`);
        continue;
      }

      const chairOption = await resolveChairOption(opened.chairSelect, block.chairNumber, ctx);
      await opened.daySelect.selectOption(String(weekday));
      await opened.fromInput.fill(block.start);
      await opened.toInput.fill(block.end);
      await opened.chairSelect.selectOption(chairOption.value);
      await opened.addButton.click();

      const outcome = await waitChipOrError(page, opened.dlg, chip, label, ctx);
      if (outcome === 'overlap') {
        log.warn(`La web rechazó ${label} para ${user.email} por solaparse con un bloque existente; se omite.`);
        // Reabrimos el modal para limpiar el mensaje de error antes del siguiente bloque.
        await closeScheduleModal(page, opened);
        opened = await openScheduleModal(page, user, ctx);
        continue;
      }
      added++;
      log.info(`Horario agregado a ${user.email}: ${label}${chairOption.value ? ` → ${chairOption.label}` : ' → Cualquiera'}`);
    }
  } finally {
    await closeScheduleModal(page, opened);
  }
  return added;
}

/** Espera a que el chip aparezca o a que el modal muestre un error. Devuelve 'created' | 'overlap'. */
async function waitChipOrError(page, dlg, chip, label, ctx) {
  const timeout = ctx.config.actionTimeoutMs;
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await chip.isVisible().catch(() => false)) return 'created';
    const err = await visibleError(dlg);
    if (err) {
      if (/se superpone/i.test(err)) return 'overlap';
      throw new Error(`La web rechazó el bloque ${label}: ${err}`);
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`El bloque ${label} no apareció en la lista tras ${timeout} ms.`);
}

export const _internal = { userRow, scheduleChip, resolveChairOption, optionList };
