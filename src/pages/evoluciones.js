// Evoluciones clínicas (pestaña "Evoluciones" de la ficha) en DentalCloud.
// No hay modal: el formulario "Crear nueva evolución" vive en la misma
// pestaña (EvolucionesTab.tsx) y el editor es un contenteditable
// (RichTextEditor.tsx). Todo por la interfaz web.
//
// Textos exactos de la web que se usan aquí:
//   - Pestaña de la ficha: botón "Evoluciones".
//   - Tarjeta del formulario: <h2>"Crear nueva evolución"</h2>.
//   - Select opcional (solo si hay procedimientos pendientes de presupuesto):
//     label "¿Documenta un procedimiento del presupuesto?", opción vacía
//     "No, es una nota general", opciones "N° {n}[ · {nombre}] — {descripción}".
//   - Select "Profesional" (solo admin), opción vacía "Yo mismo ({nombre})".
//   - Label "Contenido de la evolución"; editor: <div contenteditable> con
//     placeholder visual "Clic aquí para editar"; pie "{n} palabras".
//   - Botón "Grabar" (mientras guarda: "Guardando...").
//   - Éxito: "Evolución guardada correctamente." (3 s). Error: <p class="... text-red-600">.
//   - Lista derecha: filtros "Habilitadas" | "Deshabilitadas" | "Todas"; tarjeta
//     por evolución con el HTML del contenido.
import { appearsWithin, visibleError } from './_helpers.js';
import { openPatientTab } from './pacientes.js';

function normalizeSpaces(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

async function readOptions(select) {
  return select.locator('option').evaluateAll((els) =>
    els.map((o) => ({ value: o.value, text: (o.textContent || '').replace(/\s+/g, ' ').trim() }))
  );
}

/** Escribe en el RichTextEditor (contenteditable). `fill` funciona en contenteditable; si no, se teclea. */
async function typeIntoEditor(page, editor, text) {
  await editor.click();
  try {
    await editor.fill(text);
  } catch {
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type(text);
  }
  const written = normalizeSpaces(await editor.innerText());
  if (!written) throw new Error('El editor de la evolución quedó vacío después de escribir.');
}

/**
 * Crea una evolución para el paciente.
 * `evolution`: { userKey, text, planNumber?, itemDescription? }
 *   - planNumber / itemDescription (opcionales): si vienen y el select
 *     "¿Documenta un procedimiento del presupuesto?" existe, se elige la opción
 *     "N° {planNumber} ... — {itemDescription}"; si no coincide, se deja
 *     "No, es una nota general" y se avisa.
 * Espera a que la evolución aparezca en la lista de la derecha.
 */
export async function createEvolution(page, patient, evolution, ctx) {
  const { config, log } = ctx;
  const text = String(evolution?.text || '').trim();
  if (!text) throw new Error('La evolución no tiene texto (evolution.text).');

  await openPatientTab(page, patient, 'Evoluciones', ctx);
  const heading = page.getByRole('heading', { name: 'Crear nueva evolución' });
  await heading.waitFor();
  const form = heading.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');

  // Procedimiento del presupuesto (opcional).
  const itemLabel = form.locator('label', { hasText: '¿Documenta un procedimiento del presupuesto?' });
  if (evolution.planNumber != null || evolution.itemDescription) {
    if (await itemLabel.count()) {
      const select = itemLabel.locator('xpath=following-sibling::select[1]');
      const options = await readOptions(select);
      const wanted = options.find((o) => {
        if (o.value === '') return false;
        const okPlan = evolution.planNumber == null || new RegExp(`^N° ${evolution.planNumber}(\\s|·|—|$)`).test(o.text);
        const okItem = !evolution.itemDescription || o.text.includes(evolution.itemDescription);
        return okPlan && okItem;
      });
      if (wanted) {
        await select.selectOption(wanted.value);
        log.info(`Evolución enlazada al procedimiento "${wanted.text}"`);
        // Si el procedimiento exige producto/lote, la web bloquea "Grabar" sin esos datos.
        const requires = await form.getByText(/requiere registrar producto, lote, vencimiento y cantidad/).isVisible().catch(() => false);
        if (requires) {
          await select.selectOption('');
          log.warn('El procedimiento exige trazabilidad de producto; se graba como nota general.');
        }
      } else {
        log.warn(`No hay procedimiento pendiente para N° ${evolution.planNumber ?? '?'} "${evolution.itemDescription ?? ''}"; se graba como nota general.`);
      }
    } else {
      log.warn('El paciente no tiene procedimientos pendientes; la evolución se graba como nota general.');
    }
  }

  // Profesional (solo admin).
  const profLabel = form.locator('label', { hasText: /^Profesional$/ });
  if (evolution.userKey && (await profLabel.count())) {
    const user = ctx.resolveUser(evolution.userKey);
    if (!user?.name) throw new Error(`Evolución: no se pudo resolver el usuario "${evolution.userKey}".`);
    const select = profLabel.locator('xpath=following-sibling::select[1]');
    const options = await readOptions(select);
    const other = options.find((o) => o.value !== '' && o.text.startsWith(user.name));
    const mine = options.find((o) => o.value === '' && o.text.includes(user.name));
    if (other) await select.selectOption(other.value);
    else if (!mine) log.warn(`Profesional "${user.name}" no está en el select de la evolución; queda "Yo mismo".`);
  }

  // Si quedó activa la previsualización, volver al editor.
  const backToEdit = form.getByRole('button', { name: 'Volver a editar', exact: true });
  if (await backToEdit.isVisible().catch(() => false)) await backToEdit.click();

  const editor = form.locator('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]').first();
  await editor.waitFor();
  await typeIntoEditor(page, editor, text);

  const save = form.getByRole('button', { name: 'Grabar', exact: true });
  if (await save.isDisabled()) throw new Error('El botón "Grabar" de la evolución está deshabilitado (faltan datos obligatorios).');
  await save.click();

  // Éxito: mensaje verde o editor vacío sin error. Error: p.text-red-600 en la tarjeta.
  const success = form.getByText('Evolución guardada correctamente.');
  const started = Date.now();
  let saved = false;
  while (Date.now() - started < config.actionTimeoutMs) {
    const err = await visibleError(form);
    if (err) throw new Error(`La web rechazó la evolución: ${err}`);
    if (await success.isVisible().catch(() => false)) {
      saved = true;
      break;
    }
    const stillSaving = (await save.textContent().catch(() => ''))?.includes('Guardando');
    if (!stillSaving && !normalizeSpaces(await editor.innerText().catch(() => 'x'))) {
      saved = true;
      break;
    }
    await page.waitForTimeout(150);
  }
  if (!saved) throw new Error(`La evolución no se guardó en ${config.actionTimeoutMs} ms (sin confirmación de la web).`);

  // La web ya confirmó el guardado. Verificar además que aparece en la lista es solo
  // una comprobación adicional: si no se encuentra el texto (paginación, formato), se
  // avisa pero NO se considera error, para no volver a crearla en un --resume.
  const list = page.getByRole('button', { name: 'Imprimir', exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  const snippet = normalizeSpaces(text).slice(0, 40);
  const listed = await appearsWithin(list.getByText(snippet).first(), 8000);
  if (!listed) log.warn(`Evolución guardada para ${patient.rut}, pero no se encontró su texto en el listado (se da por creada).`);

  log.info(`Evolución creada para ${patient.rut}: "${snippet}${text.length > 40 ? '…' : ''}"`);
  return true;
}
