// Presupuestos (pestaña "Tratamientos" de la ficha) en DentalCloud.
// Recorre el asistente real de 3 pasos del modal "Nuevo presupuesto"
// (TreatmentPlanFormModal.tsx) usando solo la interfaz web.
//
// Textos exactos de la web que se usan aquí:
//   - Pestaña de la ficha: botón "Tratamientos".
//   - Tarjeta: <h2>"Presupuestos"</h2>, botón "Nuevo presupuesto".
//   - Modal: <h2>"Nuevo presupuesto"</h2>. Pasos: "Datos administrativos",
//     "Prestaciones", "Totales y forma de pago". Botones: "Siguiente", "Prev",
//     "Cancelar", "Crear presupuesto" (mientras guarda: "Creando...").
//   - Paso 1: selects sin id, se ubican por su <label>: "Clínica *" (sucursal,
//     obligatoria, opción vacía "Selecciona..."), "Previsión" (opción vacía
//     "Sin especificar"), "Convenio *" (obligatorio, opciones "{nombre} (-{n}%)"),
//     "Profesional" (solo si el usuario es admin; opción vacía "Yo mismo ({nombre})").
//     Si el holding es tipo "ambas" aparece "Tipo de diagrama *" con botones
//     "Odontograma" / "Mapa facial".
//   - Paso 2: label "Buscar prestación", input placeholder
//     "Ej: destartraje, resina, corona..." (odontograma). El desplegable muestra
//     un botón por prestación: nombre + precio. Al elegir una:
//       * modo "session" (o prestación con piezas por defecto) => se agrega sola a
//         "Prestaciones agregadas".
//       * otros modos => banner "Prestación seleccionada: {nombre}" con la
//         instrucción del modo, textarea "Notas clínicas (ej. reacción del
//         paciente)..." y botones "Cancelar" / "Agregar prestación".
//     Odontograma (Odontogram.tsx): piezas con notación "1.8".."4.8" y
//     temporales "5.5".."8.5". Controles accesibles:
//       * botón "Seleccionar pieza completa {pieza}" (aria-pressed): selecciona
//         las 5 caras (modos tooth / extraction / surface) o el grupo completo
//         (cuadrante / sextante / arcada).
//       * role="button" "Pieza {pieza}, cara {superior|derecha|inferior|izquierda|central}".
//       * botón "Seleccionar cuadrante {1..8}".
//       * role="button" "Seleccionar sextante {1..6}".
//       * role="button" "Seleccionar arcada superior" / "Seleccionar arcada inferior".
//     Cada ítem agregado tiene un botón aria-label "Quitar".
//   - Paso 3: #plan-name (placeholder "Ej: Plan rehabilitación oral"),
//     #plan-payment (opciones "Contado" | "Cuotas"), #plan-notes
//     ("Observaciones generales").
//   - Errores del modal: <p class="... text-red-600">.
//   - Tras crear, la tarjeta "Presupuestos" muestra "N° {número}" del nuevo plan
//     (primero de la lista).
import { escapeRegExp, fillIfDefined, modal, submitAndWaitClosed, visibleError, waitForAttr } from './_helpers.js';
import { openPatientTab } from './pacientes.js';

/** Formas de pago que ofrece el select #plan-payment. */
export const PAYMENT_METHODS = ['Contado', 'Cuotas'];

/** Caras del odontograma (valor interno de la web -> etiqueta en aria-label). */
export const SURFACE_LABELS = {
  top: 'superior',
  right: 'derecha',
  bottom: 'inferior',
  left: 'izquierda',
  center: 'central',
};

/**
 * Alias aceptados en el plan para las caras. La web solo distingue 5 caras
 * geométricas (superior/derecha/inferior/izquierda/central); las siglas
 * odontológicas se aproximan así: O/oclusal e I/incisal -> central,
 * V/vestibular/B -> superior, L/lingual/P/palatino -> inferior,
 * M/mesial -> izquierda, D/distal -> derecha. Verificar contra la web real.
 */
export const SURFACE_ALIASES = {
  top: 'top', superior: 'top', v: 'top', vestibular: 'top', b: 'top', bucal: 'top',
  right: 'right', derecha: 'right', d: 'right', distal: 'right',
  bottom: 'bottom', inferior: 'bottom', l: 'bottom', lingual: 'bottom', p: 'bottom', palatino: 'bottom', palatina: 'bottom',
  left: 'left', izquierda: 'left', m: 'left', mesial: 'left',
  center: 'center', central: 'center', o: 'center', oclusal: 'center', i: 'center', incisal: 'center', c: 'center',
};

const UPPER_QUADRANTS = new Set(['1', '2', '5', '6']);
// Copia de SEXTANT_TEETH de Odontogram.tsx (los terceros molares no pertenecen a ningún sextante).
const SEXTANT_TEETH = {
  1: ['1.7', '1.6', '1.5', '1.4'],
  2: ['1.3', '1.2', '1.1', '2.1', '2.2', '2.3'],
  3: ['2.4', '2.5', '2.6', '2.7'],
  4: ['4.7', '4.6', '4.5', '4.4'],
  5: ['4.3', '4.2', '4.1', '3.1', '3.2', '3.3'],
  6: ['3.4', '3.5', '3.6', '3.7'],
};

/** Convierte 46 | "46" | "4.6" en la notación de la web: "4.6". */
export function toothLabel(tooth) {
  const raw = String(tooth).trim();
  if (/^\d\.\d$/.test(raw)) return raw;
  if (/^\d{2}$/.test(raw)) return `${raw[0]}.${raw[1]}`;
  throw new Error(`Pieza dental inválida en el plan: "${tooth}" (se espera 11..48, 51..85 o "1.1").`);
}

function surfaceKey(surface) {
  const key = SURFACE_ALIASES[String(surface).trim().toLowerCase()];
  if (!key) throw new Error(`Cara dental desconocida en el plan: "${surface}".`);
  return key;
}

function sextantForTooth(label) {
  const found = Object.entries(SEXTANT_TEETH).find(([, teeth]) => teeth.includes(label));
  return found ? Number(found[0]) : null;
}

/** Busca la prestación del catálogo de la clínica (ctx.clinic.prestaciones) por código o nombre. */
function resolvePrestacion(ctx, item) {
  const catalog = ctx.clinic?.prestaciones || [];
  const byCode = item.prestacionCode ? catalog.find((p) => p.code === item.prestacionCode) : null;
  const byName = item.prestacionName ? catalog.find((p) => p.name === item.prestacionName) : null;
  const prest = byCode || byName;
  if (prest) return prest;
  if (item.prestacionName) {
    return { code: item.prestacionCode || null, name: item.prestacionName, odontogramMode: item.odontogramMode };
  }
  throw new Error(`La prestación "${item.prestacionCode}" no existe en el catálogo del plan de la clínica.`);
}

/** Texto normalizado de todas las <option> de un select. */
async function readOptions(select) {
  return select.locator('option').evaluateAll((els) =>
    els.map((o) => ({ value: o.value, text: (o.textContent || '').replace(/\s+/g, ' ').trim() }))
  );
}

/** Espera a que un select cargue al menos `min` opciones (los catálogos se piden por red). */
async function waitForOptions(select, min, timeout) {
  const started = Date.now();
  let options = [];
  while (Date.now() - started < timeout) {
    options = await readOptions(select);
    if (options.length >= min) return options;
    await select.page().waitForTimeout(150);
  }
  return options;
}

/** Selecciona la primera opción (no vacía) cuyo texto cumple `matcher`; si no hay, falla listando las opciones. */
async function selectOptionMatching(select, matcher, description, timeout) {
  const options = await waitForOptions(select, 2, timeout);
  const found = options.find((o) => o.value !== '' && matcher(o.text));
  if (!found) {
    const list = options.map((o) => `"${o.text}"`).join(', ');
    throw new Error(`No se encontró la opción ${description}. Opciones disponibles: ${list || '(ninguna)'}.`);
  }
  await select.selectOption(found.value);
  return found;
}

/** <select> que sigue a un <label> cuyo texto empieza con `labelText` (los selects del paso 1 no tienen id). */
function selectByLabel(scope, labelText) {
  const re = new RegExp(`^${escapeRegExp(labelText)}(\\s|\\*|$)`);
  return scope.locator('label', { hasText: re }).first().locator('xpath=following-sibling::select[1]');
}

/** Espera a que aparezca `target` o a que el modal muestre un error (que se lanza). */
async function waitVisibleOrError(page, dlg, target, what, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await target.isVisible().catch(() => false)) return;
    const err = await visibleError(dlg);
    if (err) throw new Error(`La web rechazó ${what}: ${err}`);
    await page.waitForTimeout(150);
  }
  throw new Error(`Se agotó el tiempo esperando ${what}.`);
}

/** Prestaciones en "Prestaciones agregadas" (una por botón "Quitar"). */
function addedItems(dlg) {
  return dlg.getByRole('button', { name: 'Quitar', exact: true });
}

/** Deduce el modo desde el texto del banner amarillo (MODE_INSTRUCTIONS de la web). */
function modeFromBannerText(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('toda la boca') || t.includes('todo el rostro')) return 'session';
  if (t.includes('a extraer')) return 'extraction';
  if (t.includes('cuadrante')) return 'cuadrante';
  if (t.includes('sextante')) return 'sextante';
  if (t.includes('arcada')) return 'arcada';
  if (t.includes('caras afectadas')) return 'surface';
  if (t.includes('caras de cada pieza')) return 'tooth';
  return null;
}

async function clickWholeTooth(dlg, label) {
  const btn = dlg.getByRole('button', { name: `Seleccionar pieza completa ${label}`, exact: true });
  await btn.waitFor();
  if ((await btn.getAttribute('aria-pressed')) === 'true') return; // ya estaba marcada
  await btn.click();
  await waitForAttr(btn, 'aria-pressed', 'true', 5000);
}

/**
 * Marca en el odontograma lo que pide el ítem según el modo activo.
 * Devuelve cuántas líneas generará la web en "Prestaciones agregadas".
 */
async function selectOnOdontogram(dlg, mode, item, log) {
  const teeth = (item.teeth || []).map(toothLabel);
  const code = item.prestacionCode || item.prestacionName;

  if (mode === 'session') return 1;

  if (mode === 'tooth' || mode === 'extraction') {
    if (teeth.length === 0) throw new Error(`La prestación "${code}" (modo ${mode}) necesita al menos una pieza en item.teeth.`);
    for (const label of teeth) await clickWholeTooth(dlg, label);
    return teeth.length; // la web crea una línea por pieza
  }

  if (mode === 'surface') {
    if (teeth.length === 0) throw new Error(`La prestación "${code}" (modo cara) necesita al menos una pieza en item.teeth.`);
    const surfaces = (item.surfaces || []).map(surfaceKey);
    for (const label of teeth) {
      if (surfaces.length === 0) {
        await clickWholeTooth(dlg, label); // sin caras indicadas: las 5 caras
        continue;
      }
      for (const surface of surfaces) {
        const face = dlg.getByRole('button', { name: `Pieza ${label}, cara ${SURFACE_LABELS[surface]}`, exact: true });
        await face.waitFor();
        await face.click();
      }
    }
    return teeth.length; // una línea por pieza
  }

  if (mode === 'cuadrante') {
    const quadrants = new Set((item.quadrants || []).map(String));
    for (const label of teeth) quadrants.add(label[0]);
    if (quadrants.size === 0) {
      log.warn(`La prestación "${code}" (modo cuadrante) no trae cuadrante ni piezas: se marca el cuadrante 1.`);
      quadrants.add('1');
    }
    for (const q of quadrants) {
      const btn = dlg.getByRole('button', { name: `Seleccionar cuadrante ${q}`, exact: true });
      await btn.click();
      await waitForAttr(btn, 'aria-pressed', 'true', 5000);
    }
    return 1;
  }

  if (mode === 'sextante') {
    const sextants = new Set((item.sextants || []).map(Number));
    for (const label of teeth) {
      const s = sextantForTooth(label);
      if (s === null) throw new Error(`La pieza ${label} no pertenece a ningún sextante (terceros molares y temporales no se incluyen).`);
      sextants.add(s);
    }
    if (sextants.size === 0) {
      log.warn(`La prestación "${code}" (modo sextante) no trae sextante ni piezas: se marca el sextante 1.`);
      sextants.add(1);
    }
    for (const s of sextants) await dlg.getByRole('button', { name: `Seleccionar sextante ${s}`, exact: true }).click();
    return 1;
  }

  if (mode === 'arcada') {
    const arches = new Set((item.arches || []).map((a) => String(a).toLowerCase()));
    for (const label of teeth) arches.add(UPPER_QUADRANTS.has(label[0]) ? 'superior' : 'inferior');
    if (arches.size === 0) {
      log.warn(`La prestación "${code}" (modo arcada) no trae arcada ni piezas: se marca la arcada superior.`);
      arches.add('superior');
    }
    for (const a of arches) {
      if (a !== 'superior' && a !== 'inferior') throw new Error(`Arcada desconocida: "${a}".`);
      await dlg.getByRole('button', { name: `Seleccionar arcada ${a}`, exact: true }).click();
    }
    return 1;
  }

  log.warn(`Modo de odontograma desconocido "${mode}": se intenta agregar sin marcar piezas.`);
  return 1;
}

/** Paso 2: busca la prestación, la elige y (si la web lo pide) marca piezas y confirma. */
async function addItem(page, dlg, item, ctx) {
  const { log, config } = ctx;
  const prest = resolvePrestacion(ctx, item);
  const query = prest.code || prest.name;
  const before = await addedItems(dlg).count();

  // La web filtra por nombre O código (máx. 8 resultados). Se busca primero por
  // código y, si el catálogo web no lo tiene, por nombre.
  const search = dlg.getByPlaceholder(/^Ej: (destartraje|botox)/);
  // El desplegable muestra un botón por prestación: <span>{nombre}</span><span>{precio}</span>.
  const option = dlg.getByRole('button').filter({ has: page.getByText(prest.name, { exact: true }) }).first();
  let found = false;
  for (const q of [...new Set([query, prest.name])]) {
    await search.fill('');
    await search.fill(q);
    if (await option.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`La búsqueda "${query}" no mostró la prestación "${prest.name}" en el paso Prestaciones.`);
  await option.click();

  // Dos salidas posibles: se agrega directo (sesión / piezas por defecto) o aparece el banner.
  const bannerTitle = dlg.getByText(/^Prestación seleccionada:/);
  const started = Date.now();
  let bannerShown = false;
  while (Date.now() - started < config.actionTimeoutMs) {
    if (await bannerTitle.isVisible().catch(() => false)) {
      bannerShown = true;
      break;
    }
    if ((await addedItems(dlg).count()) > before) break;
    await page.waitForTimeout(100);
  }

  let expectedLines = 1;
  if (bannerShown) {
    const banner = bannerTitle.locator('xpath=..');
    const bannerText = (await banner.textContent()) || '';
    if (/requiere seleccionar un lote real del inventario/i.test(bannerText)) {
      throw new Error(`La prestación "${prest.name}" exige elegir un lote real del inventario (trazabilidad); no se automatiza.`);
    }
    const mode = modeFromBannerText(bannerText) || item.odontogramMode || prest.odontogramMode || 'tooth';
    log.info(`Prestación "${prest.name}": modo ${mode}`);
    expectedLines = await selectOnOdontogram(dlg, mode, item, log);
    await fillIfDefined(banner.getByPlaceholder('Notas clínicas (ej. reacción del paciente)...'), item.notes);
    await banner.getByRole('button', { name: 'Agregar prestación', exact: true }).click();

    const t0 = Date.now();
    while (Date.now() - t0 < config.actionTimeoutMs) {
      if (!(await bannerTitle.isVisible().catch(() => false))) break;
      const err = await visibleError(banner);
      if (err) throw new Error(`No se pudo agregar "${prest.name}": ${err}`);
      await page.waitForTimeout(150);
    }
  } else if (item.notes) {
    log.warn(`"${prest.name}" se agregó sin banner; la web no permite notas por ítem en ese caso.`);
  }

  const after = await addedItems(dlg).count();
  if (after < before + 1) throw new Error(`"${prest.name}" no apareció en "Prestaciones agregadas".`);
  if (after !== before + expectedLines) {
    log.warn(`"${prest.name}": se esperaban ${expectedLines} línea(s) y aparecieron ${after - before}.`);
  }
  if (item.discountPercent) log.warn('item.discountPercent se ignora: la web aplica solo el descuento del convenio.');
}

/** Números "N° X" visibles en la tarjeta Presupuestos, en orden de pantalla. */
async function listPlanNumbers(card) {
  const texts = await card.locator('span').filter({ hasText: /^N° \d+/ }).allTextContents();
  return texts.map((t) => Number((t.match(/^N° (\d+)/) || [])[1])).filter((n) => Number.isFinite(n));
}

/**
 * Crea un presupuesto desde la pestaña "Tratamientos" de la ficha.
 * `plan`: { userKey, sucursalName, previsionName, convenioName, paymentMethod, observations, name?, diagramType?,
 *           items: [{ prestacionCode, teeth, surfaces, quadrants?, sextants?, arches?, notes }] }
 * Devuelve el número del presupuesto (N°) que muestra la web y lo guarda en plan.number.
 */
export async function createTreatmentPlan(page, patient, plan, ctx) {
  const { config, log } = ctx;
  if (!plan.items?.length) throw new Error('El presupuesto no tiene prestaciones (plan.items vacío).');
  if (plan.diagramType === 'estetica') {
    throw new Error('Solo se automatiza el odontograma (dental); el mapa facial no está soportado.');
  }

  await openPatientTab(page, patient, 'Tratamientos', ctx);
  const card = page
    .getByRole('heading', { name: 'Presupuestos', exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  await card.waitFor();
  // Esperar a que termine de cargar la lista (mensaje vacío o al menos un "N° X").
  await card
    .getByText(/Este paciente aún no tiene presupuestos registrados\.|^N° \d+/)
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => undefined);
  const before = await listPlanNumbers(card);

  await card.getByRole('button', { name: 'Nuevo presupuesto', exact: true }).click();
  const dlg = modal(page, 'Nuevo presupuesto');
  await dlg.waitFor();

  // ---------- Paso 1: "Datos administrativos" ----------
  const odontogramaBtn = dlg.getByRole('button', { name: 'Odontograma', exact: true });
  if (await odontogramaBtn.isVisible().catch(() => false)) await odontogramaBtn.click(); // holding tipo "ambas"

  await selectOptionMatching(
    selectByLabel(dlg, 'Clínica'),
    (t) => t === plan.sucursalName,
    `de sucursal "${plan.sucursalName}" en "Clínica"`,
    config.actionTimeoutMs
  );

  if (plan.previsionName) {
    await selectOptionMatching(
      selectByLabel(dlg, 'Previsión'),
      (t) => t === plan.previsionName,
      `de previsión "${plan.previsionName}"`,
      config.actionTimeoutMs
    );
  }

  const convenioSelect = selectByLabel(dlg, 'Convenio');
  if (plan.convenioName) {
    const re = new RegExp(`^${escapeRegExp(plan.convenioName)}(\\s*\\(-\\d+%\\))?$`);
    await selectOptionMatching(convenioSelect, (t) => re.test(t), `de convenio "${plan.convenioName}"`, config.actionTimeoutMs);
  } else {
    // La web exige convenio ("Selecciona un convenio"): se toma uno sin descuento o, si no hay, el primero.
    const options = await waitForOptions(convenioSelect, 2, config.actionTimeoutMs);
    const real = options.filter((o) => o.value !== '');
    if (real.length === 0) throw new Error('El plan no trae convenio y la web no ofrece ninguno (es obligatorio).');
    const chosen = real.find((o) => !/\(-\d+%\)/.test(o.text)) || real[0];
    await convenioSelect.selectOption(chosen.value);
    log.warn(`El plan no trae convenio; se usó "${chosen.text}" porque la web lo exige.`);
  }

  const profSelect = selectByLabel(dlg, 'Profesional');
  if (plan.userKey && (await profSelect.count())) {
    const user = ctx.resolveUser(plan.userKey);
    if (!user?.name) throw new Error(`Presupuesto: no se pudo resolver el usuario "${plan.userKey}".`);
    const options = await waitForOptions(profSelect, 1, config.actionTimeoutMs);
    const mine = options.find((o) => o.value === '' && o.text.includes(user.name));
    const other = options.find((o) => o.value !== '' && o.text.startsWith(user.name));
    if (other) await profSelect.selectOption(other.value);
    else if (!mine) log.warn(`Profesional "${user.name}" no aparece en el select; queda "Yo mismo".`);
  }

  await dlg.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await waitVisibleOrError(
    page,
    dlg,
    dlg.getByPlaceholder(/^Ej: (destartraje|botox)/),
    'el paso "Prestaciones"',
    config.actionTimeoutMs
  );

  // ---------- Paso 2: "Prestaciones" ----------
  for (const item of plan.items) await addItem(page, dlg, item, ctx);

  await dlg.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await waitVisibleOrError(page, dlg, dlg.locator('#plan-payment'), 'el paso "Totales y forma de pago"', config.actionTimeoutMs);

  // ---------- Paso 3: "Totales y forma de pago" ----------
  await fillIfDefined(dlg.locator('#plan-name'), plan.name);
  const wanted = String(plan.paymentMethod || '');
  let payment = PAYMENT_METHODS.find((m) => m.toLowerCase() === wanted.toLowerCase());
  if (!payment) {
    payment = /cuota/i.test(wanted) ? 'Cuotas' : 'Contado';
    if (wanted) log.warn(`Forma de pago "${wanted}" no existe en la web (Contado | Cuotas); se usa "${payment}".`);
  }
  await dlg.locator('#plan-payment').selectOption({ label: payment });
  await fillIfDefined(dlg.locator('#plan-notes'), plan.observations);

  await submitAndWaitClosed(page, dlg, 'Crear presupuesto', 'Nuevo presupuesto', 60000);

  // El nuevo presupuesto se antepone a la lista: leer su "N° X".
  let number = null;
  const started = Date.now();
  while (Date.now() - started < config.actionTimeoutMs) {
    const numbers = await listPlanNumbers(card);
    const fresh = numbers.find((n) => !before.includes(n));
    if (fresh !== undefined) {
      number = fresh;
      break;
    }
    await page.waitForTimeout(200);
  }
  if (number === null) {
    const numbers = await listPlanNumbers(card);
    number = numbers[0] ?? null;
    log.warn(`No se pudo distinguir el presupuesto nuevo; se devuelve el primero de la lista (N° ${number}).`);
  }
  plan.number = number;
  log.info(`Presupuesto creado para ${patient.rut}: N° ${number} (${plan.items.length} prestación(es))`);
  return number;
}
