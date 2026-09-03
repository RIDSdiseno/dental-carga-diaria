// Observaciones administrativas (pestaña "Observaciones" de la ficha) en
// DentalCloud. Formulario en la misma pestaña (ObservacionesTab.tsx), sin modal.
//
// Textos exactos de la web que se usan aquí:
//   - Pestaña de la ficha: botón "Observaciones".
//   - Tarjeta: <h2>"Observaciones administrativas"</h2>; "Fecha" (solo lectura),
//     "Realizado por" (select solo para admin, opción vacía "Yo mismo ({nombre})";
//     para otros roles es un texto fijo), textarea #obs-content (label
//     "Observación", placeholder "Escribe una nota interna sobre el paciente...").
//   - Botón "Grabar" (mientras guarda: "Guardando...").
//   - Error: <p class="... text-red-600"> ("Escribe una observación", etc.).
//   - Tarjeta "Historial": una entrada por observación con su texto en <p>.
import { visibleError } from './_helpers.js';
import { openPatientTab } from './pacientes.js';

/**
 * Agrega una observación administrativa.
 * `observation`: { text, userKey? } — userKey solo se usa si la sesión es admin
 * (aparece el select "Realizado por").
 * Espera a que la observación aparezca en el "Historial".
 */
export async function addObservation(page, patient, observation, ctx) {
  const { config, log } = ctx;
  const text = String(observation?.text || '').trim();
  if (!text) throw new Error('La observación no tiene texto (text).');

  await openPatientTab(page, patient, 'Observaciones', ctx);
  const heading = page.getByRole('heading', { name: 'Observaciones administrativas' });
  await heading.waitFor();
  const form = heading.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');

  // "Realizado por" (solo admin).
  const doneByLabel = form.locator('label', { hasText: /^Realizado por$/ });
  const select = doneByLabel.locator('xpath=following-sibling::select[1]');
  if (observation.userKey && (await select.count())) {
    const user = ctx.resolveUser(observation.userKey);
    if (!user?.name) throw new Error(`Observación: no se pudo resolver el usuario "${observation.userKey}".`);
    const options = await select
      .locator('option')
      .evaluateAll((els) => els.map((o) => ({ value: o.value, text: (o.textContent || '').replace(/\s+/g, ' ').trim() })));
    const other = options.find((o) => o.value !== '' && o.text.startsWith(user.name));
    const mine = options.find((o) => o.value === '' && o.text.includes(user.name));
    if (other) await select.selectOption(other.value);
    else if (!mine) log.warn(`"${user.name}" no está en "Realizado por"; queda "Yo mismo".`);
  }

  const textarea = form.locator('#obs-content');
  await textarea.fill(text);
  const save = form.getByRole('button', { name: 'Grabar', exact: true });
  await save.click();

  // Éxito: la web vacía el textarea y antepone la observación al historial.
  const history = page.getByRole('heading', { name: 'Historial' }).locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  const entry = history.getByText(text, { exact: true }).first();
  const started = Date.now();
  while (Date.now() - started < config.actionTimeoutMs) {
    const err = await visibleError(form);
    if (err) throw new Error(`La web rechazó la observación: ${err}`);
    if (await entry.isVisible().catch(() => false)) {
      log.info(`Observación registrada para ${patient.rut}: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
      return true;
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`La observación no apareció en el historial de ${patient.rut} tras ${config.actionTimeoutMs} ms.`);
}
