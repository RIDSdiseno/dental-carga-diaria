// Flujos del rol admin sobre /catalogo en DentalCloud: sucursales (en la UI se
// llaman "Clínicas"), previsiones, convenios y prestaciones. Todo por la web.
//
// Formularios de la web que usa este módulo (dentalcloud-front/src/pages/catalogo):
// - Catalogo.tsx: h1 "Catálogo" y pestañas (botones) "Prestaciones" | "Convenios" |
//   "Previsiones" | "Clínicas" | "Inventario". En "Prestaciones" el botón
//   "Nueva prestación" abre PrestacionFormModal.
// - ClinicasTab.tsx: formulario en línea sin ids (placeholders "Ej: Sede Providencia" y
//   "Ej: Av. Providencia 1234") + botón "Agregar". En la tabla el nombre va dentro de un
//   <input> editable (no es texto), por eso se lee con inputValue.
// - PrevisionesTab.tsx: formulario en línea (placeholder "Ej: Fonasa, Isapre, Particular...")
//   + botón "Agregar". Tabla Nombre | Estado.
// - ConveniosTab.tsx: formulario en línea (placeholder "Ej: Particular, Convenio Colmena..."
//   + input type=number "Descuento %") + botón "Agregar". Tabla Nombre | Descuento | Estado.
// - PrestacionFormModal.tsx: modal "Nueva prestación" (placeholders "Ej: Ácido Hialurónico",
//   "Ej: AH-01" y "0" para el precio; botones "Dental"/"Estética" SOLO si la clínica es
//   tipo "ambas"; <select> "Modo de selección en el odontograma" con values
//   session|tooth|surface|extraction|cuadrante|sextante|arcada; botón "Guardar").
//
// Todas las funciones son idempotentes: si el elemento ya está en la tabla, avisan
// con ctx.log.warn y no lo vuelven a crear. Los errores 409 del backend
// ("Ya existe ...") también se tratan como "ya existía".
import { escapeRegExp, fillIfDefined, modal, submitAndWaitClosed, visibleError, waitModalClosed } from './_helpers.js';

export const CATALOG_TABS = ['Prestaciones', 'Convenios', 'Previsiones', 'Clínicas', 'Inventario'];

export const ODONTOGRAM_MODES = ['session', 'tooth', 'surface', 'extraction', 'cuadrante', 'sextante', 'arcada'];

/** Texto que pinta cada pestaña cuando su lista cargó vacía. */
const EMPTY_TEXT = {
  Prestaciones: 'Aún no hay prestaciones en el catálogo.',
  Convenios: 'Aún no hay convenios.',
  Previsiones: 'Aún no hay previsiones.',
  Clínicas: 'Aún no hay clínicas registradas.',
};

/** Elemento que confirma que la pestaña terminó de montarse. */
const TAB_READY = {
  Prestaciones: (page) => page.getByRole('button', { name: 'Nueva prestación', exact: true }),
  Convenios: (page) => page.getByText(/Los convenios definen un descuento/),
  Previsiones: (page) => page.getByText(/Las previsiones son sólo informativas/),
  Clínicas: (page) => page.getByText(/Las clínicas son las sedes físicas/),
  Inventario: null,
};

const PLACEHOLDERS = {
  sucursalName: 'Ej: Sede Providencia',
  sucursalAddress: 'Ej: Av. Providencia 1234',
  previsionName: 'Ej: Fonasa, Isapre, Particular...',
  convenioName: 'Ej: Particular, Convenio Colmena...',
  prestacionName: 'Ej: Ácido Hialurónico',
  prestacionCode: 'Ej: AH-01',
  prestacionPrice: '0',
};

function norm(text) {
  return String(text ?? '').trim().toLowerCase();
}

async function gotoCatalogo(page, ctx, { reload = false } = {}) {
  const url = `${ctx.config.dentalcloudUrl}/catalogo`;
  if (reload || !page.url().startsWith(url)) await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1, name: 'Catálogo', exact: true }).waitFor();
}

/** Recarga /catalogo para limpiar mensajes de error o inputs a medio llenar. */
async function resetCatalogo(page, ctx) {
  await gotoCatalogo(page, ctx, { reload: true }).catch(() => undefined);
}

/**
 * Abre /catalogo (si no está abierto) y hace clic en la pestaña indicada
 * ("Prestaciones" | "Convenios" | "Previsiones" | "Clínicas" | "Inventario").
 */
export async function openCatalogTab(page, tabLabel, ctx) {
  if (!CATALOG_TABS.includes(tabLabel)) {
    throw new Error(`Pestaña de catálogo desconocida: "${tabLabel}". Válidas: ${CATALOG_TABS.join(', ')}`);
  }
  await gotoCatalogo(page, ctx);
  await page.getByRole('button', { name: tabLabel, exact: true }).click();
  const ready = TAB_READY[tabLabel];
  if (ready) await ready(page).waitFor();
}

/**
 * Espera a que la lista de la pestaña termine de cargar: aparece la tabla (hay
 * datos) o el texto "Aún no hay ..." (lista vacía). Devuelve 'table' | 'empty'.
 */
async function waitListLoaded(page, tabLabel, ctx) {
  const timeout = ctx.config.actionTimeoutMs;
  const firstRow = page.locator('table tbody tr').first();
  const empty = page.getByText(EMPTY_TEXT[tabLabel], { exact: true });
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await firstRow.isVisible().catch(() => false)) return 'table';
    if (await empty.isVisible().catch(() => false)) return 'empty';
    const err = await visibleError(page);
    if (err) throw new Error(`La web no pudo cargar la pestaña ${tabLabel}: ${err}`);
    await page.waitForTimeout(150);
  }
  throw new Error(`La pestaña ${tabLabel} no terminó de cargar en ${timeout} ms.`);
}

/** Fila de la tabla que contiene una celda con exactamente ese texto. */
function rowWithText(page, text) {
  return page.locator('table tbody tr').filter({ has: page.getByText(text, { exact: true }) }).first();
}

/** Contenedor del formulario en línea: el padre del botón "Agregar". */
function inlineForm(page) {
  return page.getByRole('button', { name: 'Agregar', exact: true }).locator('xpath=..');
}

/**
 * Tras hacer clic en "Agregar", espera a que `isCreated()` sea verdadero o a
 * que la pestaña muestre un error (lo lanza como excepción).
 */
async function waitInlineCreated(page, isCreated, label, ctx) {
  const timeout = ctx.config.actionTimeoutMs;
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await isCreated()) return;
    const err = await visibleError(page);
    if (err) throw new Error(`La web rechazó ${label}: ${err}`);
    await page.waitForTimeout(150);
  }
  throw new Error(`${label} no apareció en la lista tras ${timeout} ms.`);
}

/** Maneja el error de un alta: "Ya existe ..." se trata como duplicado (false); otros se relanzan. */
async function handleCreateError(page, err, label, ctx) {
  await resetCatalogo(page, ctx);
  if (/ya existe/i.test(err.message)) {
    ctx.log.warn(`${label} ya existía según la web; no se crea de nuevo. (${err.message})`);
    return false;
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Sucursales (pestaña "Clínicas")
// ---------------------------------------------------------------------------

async function sucursalNamesInTable(page) {
  return page
    .locator('table tbody tr td:first-child input')
    .evaluateAll((els) => els.map((el) => String(el.value || '').trim()));
}

/** Lee la tabla de la pestaña "Clínicas": [{ name, address, active }]. */
export async function listExistingSucursales(page, ctx) {
  await openCatalogTab(page, 'Clínicas', ctx);
  if ((await waitListLoaded(page, 'Clínicas', ctx)) === 'empty') return [];
  const rows = page.locator('table tbody tr');
  const count = await rows.count();
  const items = [];
  for (let i = 0; i < count; i++) {
    const cells = rows.nth(i).locator('td');
    const name = (await cells.nth(0).locator('input').inputValue()).trim();
    const address = ((await cells.nth(1).textContent()) || '').trim();
    const state = ((await cells.nth(2).textContent()) || '').trim();
    items.push({ name, address: address === '—' ? '' : address, active: state === 'Activa' });
  }
  return items;
}

/**
 * Crea una sucursal con el formulario en línea de la pestaña "Clínicas".
 * Devuelve true si la creó, false si ya existía.
 */
export async function addSucursal(page, sucursal, ctx) {
  const { log } = ctx;
  const name = String(sucursal.name || '').trim();
  if (!name) throw new Error('addSucursal: el nombre es obligatorio.');
  const label = `la clínica/sucursal "${name}"`;

  await openCatalogTab(page, 'Clínicas', ctx);
  await waitListLoaded(page, 'Clínicas', ctx);
  const existing = await sucursalNamesInTable(page);
  if (existing.some((n) => norm(n) === norm(name))) {
    log.warn(`La sucursal (clínica) "${name}" ya estaba en el catálogo; no se crea de nuevo.`);
    return false;
  }

  await page.getByPlaceholder(PLACEHOLDERS.sucursalName).fill(name);
  await fillIfDefined(page.getByPlaceholder(PLACEHOLDERS.sucursalAddress), sucursal.address);
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  try {
    await waitInlineCreated(
      page,
      async () => (await sucursalNamesInTable(page)).some((n) => norm(n) === norm(name)),
      label,
      ctx
    );
  } catch (err) {
    return handleCreateError(page, err, label, ctx);
  }
  log.info(`Sucursal (clínica) creada: ${name}${sucursal.address ? ` — ${sucursal.address}` : ''}`);
  return true;
}

// ---------------------------------------------------------------------------
// Previsiones
// ---------------------------------------------------------------------------

/** Lee la tabla de "Previsiones": [{ name, active }]. */
export async function listExistingPrevisiones(page, ctx) {
  await openCatalogTab(page, 'Previsiones', ctx);
  if ((await waitListLoaded(page, 'Previsiones', ctx)) === 'empty') return [];
  const rows = page.locator('table tbody tr');
  const count = await rows.count();
  const items = [];
  for (let i = 0; i < count; i++) {
    const cells = rows.nth(i).locator('td');
    const name = ((await cells.nth(0).textContent()) || '').trim();
    const state = ((await cells.nth(1).textContent()) || '').trim();
    items.push({ name, active: state === 'Activa' });
  }
  return items;
}

/** Crea una previsión con el formulario en línea. Devuelve true si la creó, false si ya existía. */
export async function addPrevision(page, prevision, ctx) {
  const { log } = ctx;
  const name = String(prevision.name || '').trim();
  if (!name) throw new Error('addPrevision: el nombre es obligatorio.');
  const label = `la previsión "${name}"`;

  await openCatalogTab(page, 'Previsiones', ctx);
  await waitListLoaded(page, 'Previsiones', ctx);
  if (await rowWithText(page, name).count()) {
    log.warn(`La previsión "${name}" ya estaba en el catálogo; no se crea de nuevo.`);
    return false;
  }

  await page.getByPlaceholder(PLACEHOLDERS.previsionName).fill(name);
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  try {
    await waitInlineCreated(page, () => rowWithText(page, name).isVisible().catch(() => false), label, ctx);
  } catch (err) {
    return handleCreateError(page, err, label, ctx);
  }
  log.info(`Previsión creada: ${name}`);
  return true;
}

// ---------------------------------------------------------------------------
// Convenios
// ---------------------------------------------------------------------------

/** Lee la tabla de "Convenios": [{ name, discountPercent, active }]. */
export async function listExistingConvenios(page, ctx) {
  await openCatalogTab(page, 'Convenios', ctx);
  if ((await waitListLoaded(page, 'Convenios', ctx)) === 'empty') return [];
  const rows = page.locator('table tbody tr');
  const count = await rows.count();
  const items = [];
  for (let i = 0; i < count; i++) {
    const cells = rows.nth(i).locator('td');
    const name = ((await cells.nth(0).textContent()) || '').trim();
    const discount = Number(await cells.nth(1).locator('input').inputValue()) || 0;
    const state = ((await cells.nth(2).textContent()) || '').trim();
    items.push({ name, discountPercent: discount, active: state === 'Activo' });
  }
  return items;
}

/** Crea un convenio (nombre + % descuento). Devuelve true si lo creó, false si ya existía. */
export async function addConvenio(page, convenio, ctx) {
  const { log } = ctx;
  const name = String(convenio.name || '').trim();
  if (!name) throw new Error('addConvenio: el nombre es obligatorio.');
  const discount = Number(convenio.discountPercent ?? 0) || 0;
  const label = `el convenio "${name}"`;

  await openCatalogTab(page, 'Convenios', ctx);
  await waitListLoaded(page, 'Convenios', ctx);
  if (await rowWithText(page, name).count()) {
    log.warn(`El convenio "${name}" ya estaba en el catálogo; no se crea de nuevo.`);
    return false;
  }

  await page.getByPlaceholder(PLACEHOLDERS.convenioName).fill(name);
  // El input "Descuento %" no tiene id ni placeholder: es el único type=number del formulario en línea.
  await inlineForm(page).locator('input[type="number"]').fill(String(discount));
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  try {
    await waitInlineCreated(page, () => rowWithText(page, name).isVisible().catch(() => false), label, ctx);
  } catch (err) {
    return handleCreateError(page, err, label, ctx);
  }
  log.info(`Convenio creado: ${name} (${discount}% de descuento)`);
  return true;
}

// ---------------------------------------------------------------------------
// Prestaciones
// ---------------------------------------------------------------------------

/** Lee la tabla de "Prestaciones": [{ name, code, priceText }]. code es null cuando la web muestra "—". */
export async function listExistingPrestaciones(page, ctx) {
  await openCatalogTab(page, 'Prestaciones', ctx);
  if ((await waitListLoaded(page, 'Prestaciones', ctx)) === 'empty') return [];
  const rows = page.locator('table tbody tr');
  const count = await rows.count();
  const items = [];
  for (let i = 0; i < count; i++) {
    const cells = rows.nth(i).locator('td');
    const name = ((await cells.nth(0).textContent()) || '').trim();
    const code = ((await cells.nth(1).textContent()) || '').trim();
    const priceText = ((await cells.nth(2).textContent()) || '').trim();
    items.push({ name, code: code === '—' ? null : code, priceText });
  }
  return items;
}

function findPrestacionDuplicate(existing, prestacion) {
  const code = norm(prestacion.code);
  const name = norm(prestacion.name);
  return existing.find((p) => (code && norm(p.code) === code) || norm(p.name) === name) || null;
}

/**
 * Crea una prestación con el modal "Nueva prestación".
 * prestacion = { code, name, price, category, odontogramMode }.
 * - Si la clínica es tipo "ambas" la web muestra los botones Dental/Estética; si no,
 *   la categoría queda fija por el tipo de clínica y se ignora la del plan (con warn).
 * - El modo de odontograma solo existe para categoría dental; se elige por su value.
 * Devuelve true si la creó, false si ya existía (por código o por nombre).
 */
export async function addPrestacion(page, prestacion, ctx) {
  const { log } = ctx;
  const name = String(prestacion.name || '').trim();
  if (!name) throw new Error('addPrestacion: el nombre es obligatorio.');
  const price = Number(prestacion.price);
  if (!Number.isFinite(price) || price < 0) throw new Error(`addPrestacion: precio inválido para "${name}": ${prestacion.price}`);
  const category = prestacion.category || (ctx.clinic?.tipo === 'estetica' ? 'estetica' : 'dental');
  if (prestacion.odontogramMode && !ODONTOGRAM_MODES.includes(prestacion.odontogramMode)) {
    throw new Error(`addPrestacion: odontogramMode desconocido "${prestacion.odontogramMode}" en ${prestacion.code || name}.`);
  }
  const label = `la prestación "${prestacion.code || name}"`;
  const title = 'Nueva prestación';

  const existing = await listExistingPrestaciones(page, ctx);
  const dupe = findPrestacionDuplicate(existing, { ...prestacion, name });
  if (dupe) {
    log.warn(`La prestación ${prestacion.code || name} ya estaba en el catálogo (como "${dupe.name}" / ${dupe.code ?? 'sin código'}); no se crea de nuevo.`);
    return false;
  }

  await page.getByRole('button', { name: 'Nueva prestación', exact: true }).click();
  const dlg = modal(page, title);
  await dlg.waitFor();

  // El nombre va primero: la web sugiere el modo de odontograma a partir de él y
  // deja de hacerlo en cuanto tocamos el selector a mano.
  await dlg.getByPlaceholder(PLACEHOLDERS.prestacionName).fill(name);

  const dentalButton = dlg.getByRole('button', { name: 'Dental', exact: true });
  const esteticaButton = dlg.getByRole('button', { name: 'Estética', exact: true });
  const hasCategoryPicker = (await dentalButton.count()) > 0;
  let effectiveCategory = category;
  if (hasCategoryPicker) {
    await (category === 'estetica' ? esteticaButton : dentalButton).click();
  } else {
    // Clínica "dental" o "estetica": la web fija la categoría sola.
    const fixed = ctx.clinic?.tipo === 'estetica' ? 'estetica' : 'dental';
    if (category !== fixed) {
      log.warn(`La web no muestra selector de tipo (clínica tipo "${ctx.clinic?.tipo ?? '?'}"): ${prestacion.code || name} quedará como "${fixed}" en vez de "${category}".`);
    }
    effectiveCategory = fixed;
  }

  await fillIfDefined(dlg.getByPlaceholder(PLACEHOLDERS.prestacionCode), prestacion.code);
  await dlg.getByPlaceholder(PLACEHOLDERS.prestacionPrice, { exact: true }).first().fill(String(price));

  if (effectiveCategory !== 'estetica') {
    // Único <select> del modal (solo se pinta para prestaciones dentales).
    const modeSelect = dlg.locator('select').first();
    await modeSelect.waitFor();
    if (prestacion.odontogramMode) await modeSelect.selectOption(prestacion.odontogramMode);
  } else if (prestacion.odontogramMode) {
    log.info(`${prestacion.code || name} es estética: la web no pide modo de odontograma, se ignora "${prestacion.odontogramMode}".`);
  }

  try {
    await submitAndWaitClosed(page, dlg, 'Guardar', title, 60000);
  } catch (err) {
    await closeModalIfOpen(page, dlg, title);
    return handleCreateError(page, err, label, ctx);
  }

  const rowKey = prestacion.code ? String(prestacion.code).trim() : name;
  await rowWithText(page, rowKey).waitFor();
  log.info(`Prestación creada: ${prestacion.code ? `${prestacion.code} · ` : ''}${name} $${price} (${effectiveCategory}${prestacion.odontogramMode && effectiveCategory !== 'estetica' ? `, ${prestacion.odontogramMode}` : ''})`);
  return true;
}

async function closeModalIfOpen(page, dlg, title) {
  const heading = page.getByRole('heading', { level: 2, name: title, exact: true });
  if (!(await heading.isVisible().catch(() => false))) return;
  await dlg.getByRole('button', { name: 'Cerrar', exact: true }).click().catch(() => undefined);
  await waitModalClosed(page, title, 5000).catch(() => undefined);
}

export const _internal = { rowWithText, inlineForm, waitListLoaded, findPrestacionDuplicate, escapeRegExp };
