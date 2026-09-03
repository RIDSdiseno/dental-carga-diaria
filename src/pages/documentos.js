// Documentos clínicos (pestaña "Documentos clínicos" de la ficha) en
// DentalCloud: subir un archivo a una categoría (DocumentosClinicosTab.tsx).
//
// Textos exactos de la web que se usan aquí:
//   - Pestaña de la ficha: botón "Documentos clínicos".
//   - Barra de categorías (botones): "Recetas Médicas", "Derivaciones", "Imágenes",
//     "Archivos", "Documentos de Altas", "Solicitud Laboratorio",
//     "Documento Pabellón", "Solicitud Pabellón".
//   - Tarjeta: <h2>"{categoría}"</h2>; label "Archivo" + <input type="file">;
//     label "Descripción (opcional)" + input placeholder "Ej: Receta amoxicilina 500mg";
//     botón "Subir" (mientras sube: "Subiendo...").
//   - Error: <p class="... text-red-600"> ("Selecciona un archivo para subir", etc.).
//   - Lista: una fila por documento con el nombre del archivo y
//     "{Imagen|Video|Archivo} · {usuario} · {fecha}[ · {descripción}]".
//     Vacío: "Aún no se han subido archivos en {categoría}.".
import fs from 'node:fs';
import path from 'node:path';
import { abs, fillIfDefined, visibleError } from './_helpers.js';
import { openPatientTab } from './pacientes.js';

/** Clave del plan -> etiqueta visible del botón de categoría. */
export const DOCUMENT_CATEGORY_LABELS = {
  receta: 'Recetas Médicas',
  derivacion: 'Derivaciones',
  imagen: 'Imágenes',
  archivo: 'Archivos',
  alta: 'Documentos de Altas',
  solicitud_laboratorio: 'Solicitud Laboratorio',
  documento_pabellon: 'Documento Pabellón',
  solicitud_pabellon: 'Solicitud Pabellón',
};

/**
 * Sube un documento clínico.
 * `document`: { category, description?, filePath } — filePath relativo al proyecto o absoluto.
 * Espera a que el documento quede listado en la categoría.
 */
export async function uploadDocument(page, patient, document, ctx) {
  const { config, log } = ctx;
  const label = DOCUMENT_CATEGORY_LABELS[document?.category];
  if (!label) {
    throw new Error(`Categoría de documento desconocida: "${document?.category}" (${Object.keys(DOCUMENT_CATEGORY_LABELS).join(' | ')}).`);
  }
  if (!document.filePath) throw new Error('El documento no tiene filePath.');
  const absPath = abs(document.filePath);
  if (!fs.existsSync(absPath)) throw new Error(`No existe el archivo a subir: ${absPath}`);
  const fileName = path.basename(absPath);

  await openPatientTab(page, patient, 'Documentos clínicos', ctx);
  await page.getByRole('button', { name: label, exact: true }).click();
  const heading = page.getByRole('heading', { name: label, exact: true });
  await heading.waitFor();
  const card = heading.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');

  // Esperar a que cargue la lista de la categoría (vacía o con documentos) antes de subir.
  await card
    .getByText(new RegExp(`^Aún no se han subido archivos en |·`))
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => undefined);
  const before = await card.locator('a[aria-label="Descargar"]').count();

  const fileInput = card.locator('input[type="file"]');
  await fileInput.setInputFiles(absPath);
  await fillIfDefined(card.getByPlaceholder('Ej: Receta amoxicilina 500mg'), document.description);

  const upload = card.getByRole('button', { name: 'Subir', exact: true });
  await upload.click();

  // Éxito: la fila nueva aparece (un enlace "Descargar" más) y la web limpia el input.
  const started = Date.now();
  while (Date.now() - started < 90000) {
    const err = await visibleError(card);
    if (err) throw new Error(`La web rechazó el documento "${fileName}": ${err}`);
    const count = await card.locator('a[aria-label="Descargar"]').count();
    const inputCleared = (await fileInput.inputValue().catch(() => 'x')) === '';
    if (count > before && inputCleared) break;
    if (Date.now() - started >= 90000) break;
    await page.waitForTimeout(200);
  }
  const after = await card.locator('a[aria-label="Descargar"]').count();
  if (after <= before) throw new Error(`El documento "${fileName}" no apareció listado en "${label}" para ${patient.rut}.`);

  // Confirmación adicional (no bloqueante): nombre de archivo o descripción visibles.
  const shown =
    (await card.getByText(fileName).first().isVisible().catch(() => false)) ||
    (document.description && (await card.getByText(document.description, { exact: true }).first().isVisible().catch(() => false)));
  if (!shown) log.warn(`"${fileName}" se subió pero la lista no muestra su nombre ni la descripción (la web puede renombrar el archivo).`);

  log.info(`Documento subido para ${patient.rut}: ${label} · ${fileName}${document.description ? ` · ${document.description}` : ''}`);
  return true;
}
