// Cartola (cuenta corriente del paciente) en DentalCloud: registrar abonos,
// intereses y ajustes por el modal LedgerMovementFormModal.tsx.
//
// Textos exactos de la web que se usan aquí:
//   - Pestaña de la ficha: botón "Cartola". Mientras carga: "Cargando cartola...".
//   - Secciones plegables con botón "+" aria-label "Agregar {título}":
//       "Abonos libres" -> movimiento tipo abono   -> modal "Nuevo abono"
//       "Intereses generados" -> tipo interes      -> modal "Nuevo interés"
//       "Ajustes" -> tipo ajuste                   -> modal "Nuevo ajuste"
//   - Campos del modal: #mov-plan (select; opción vacía "Sin presupuesto asociado",
//     resto "N° {número}[ · {nombre}]"), #mov-amount (number, min 1),
//     #mov-direction (solo ajuste: "Debe (aumenta saldo)" | "Haber (disminuye saldo)"),
//     #mov-payment (solo abono: Efectivo | Transferencia | Tarjeta | Cheque | Otro),
//     #mov-doc (solo abono, "N° documento"), #mov-description ("Glosa", placeholder
//     "Descripción breve del movimiento"), #mov-notes ("Observación").
//   - Botones: "Cancelar" / "Registrar" (mientras guarda: "Guardando...").
//   - Error: <p class="... text-red-600">.
//   - Tras registrar, la tabla "Saldo total" (abierta por defecto) lista el movimiento.
import { fillIfDefined, modal, submitAndWaitClosed } from './_helpers.js';
import { openPatientTab } from './pacientes.js';

export const MOVEMENT_TYPES = {
  abono: { section: 'Abonos libres', title: 'Nuevo abono' },
  interes: { section: 'Intereses generados', title: 'Nuevo interés' },
  ajuste: { section: 'Ajustes', title: 'Nuevo ajuste' },
};

export const PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Cheque', 'Otro'];

async function readOptions(select) {
  return select.locator('option').evaluateAll((els) =>
    els.map((o) => ({ value: o.value, text: (o.textContent || '').replace(/\s+/g, ' ').trim() }))
  );
}

/** Espera a que la cartola termine de cargar (desaparece "Cargando cartola..."). */
async function waitCartolaLoaded(page, timeout) {
  await page.getByText('Cargando cartola...').waitFor({ state: 'hidden', timeout }).catch(() => undefined);
  await page.getByText('Listado de presupuestos', { exact: true }).waitFor({ timeout });
}

/**
 * Registra un movimiento en la cartola.
 * `movement`: { type: "abono"|"interes"|"ajuste", amount, planNumber?, direction? ("debe"|"haber", solo ajuste),
 *               paymentMethod? (solo abono), docNumber? (solo abono), description?, notes? }
 */
export async function addLedgerMovement(page, patient, movement, ctx) {
  const { config, log } = ctx;
  const meta = MOVEMENT_TYPES[movement?.type];
  if (!meta) throw new Error(`Tipo de movimiento desconocido: "${movement?.type}" (abono | interes | ajuste).`);
  const amount = Number(movement.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`El monto del movimiento debe ser mayor a 0 (recibido: ${movement.amount}).`);

  await openPatientTab(page, patient, 'Cartola', ctx);
  await waitCartolaLoaded(page, config.navigationTimeoutMs);

  await page.getByRole('button', { name: `Agregar ${meta.section}`, exact: true }).click();
  const dlg = modal(page, meta.title);
  await dlg.waitFor();

  // Presupuesto asociado (opcional).
  const planSelect = dlg.locator('#mov-plan');
  if (movement.planNumber != null && movement.planNumber !== '') {
    const options = await readOptions(planSelect);
    const re = new RegExp(`^N° ${Number(movement.planNumber)}(\\s|·|$)`);
    const found = options.find((o) => o.value !== '' && re.test(o.text));
    if (!found) {
      const list = options.filter((o) => o.value !== '').map((o) => `"${o.text}"`).join(', ') || '(ninguno)';
      throw new Error(`El presupuesto N° ${movement.planNumber} no está en la cartola de ${patient.rut}. Disponibles: ${list}.`);
    }
    await planSelect.selectOption(found.value);
  } else {
    await planSelect.selectOption(''); // "Sin presupuesto asociado"
  }

  await dlg.locator('#mov-amount').fill(String(Math.round(amount)));

  if (movement.type === 'ajuste') {
    const direction = movement.direction || 'debe';
    if (!['debe', 'haber'].includes(direction)) throw new Error(`Dirección de ajuste inválida: "${movement.direction}" (debe | haber).`);
    if (!movement.direction) log.warn('Ajuste sin direction; se usa "debe".');
    await dlg.locator('#mov-direction').selectOption(direction);
  }

  if (movement.type === 'abono') {
    if (movement.paymentMethod) {
      const method = PAYMENT_METHODS.find((m) => m.toLowerCase() === String(movement.paymentMethod).toLowerCase());
      if (!method) throw new Error(`Forma de pago desconocida: "${movement.paymentMethod}" (${PAYMENT_METHODS.join(' | ')}).`);
      await dlg.locator('#mov-payment').selectOption({ label: method });
    }
    await fillIfDefined(dlg.locator('#mov-doc'), movement.docNumber);
  } else if (movement.paymentMethod || movement.docNumber) {
    log.warn(`Forma de pago / N° documento solo aplican a abonos; se ignoran para "${movement.type}".`);
  }

  await fillIfDefined(dlg.locator('#mov-description'), movement.description);
  await fillIfDefined(dlg.locator('#mov-notes'), movement.notes);

  await submitAndWaitClosed(page, dlg, 'Registrar', meta.title);

  // La pestaña recarga la cartola; confirmar que el movimiento quedó listado.
  await waitCartolaLoaded(page, config.navigationTimeoutMs);
  if (movement.description) {
    await page.getByText(movement.description, { exact: true }).first().waitFor({ timeout: config.actionTimeoutMs });
  }

  log.info(`Cartola ${patient.rut}: ${movement.type} de ${Math.round(amount)}${movement.planNumber != null ? ` (presupuesto N° ${movement.planNumber})` : ''} registrado`);
  return true;
}
