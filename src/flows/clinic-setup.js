// Configuración inicial de una clínica con la sesión de su ADMINISTRADOR:
// sillones → sucursales → previsiones → convenios → prestaciones → profesionales → horarios.
import { openSession } from '../browser.js';
import * as agenda from '../pages/agenda.js';
import * as catalogo from '../pages/catalogo.js';
import * as profesionales from '../pages/profesionales.js';
import { closeOpenModals } from '../pages/_helpers.js';

/** Ejecuta `fn` para cada item no hecho, registrando éxito/fallo sin detener el flujo. */
export async function eachItem(items, entity, ctx, fn, refOf = (i) => i.name || i.code || i.key) {
  for (const item of items || []) {
    if (item.done) continue;
    if (ctx.shouldStop?.()) {
      ctx.log.warn(`Hora límite alcanzada: se omite el resto de ${entity}.`);
      ctx.deadlineHit = true;
      return;
    }
    try {
      await fn(item);
      item.done = true;
      ctx.counts[entity].ok += 1;
    } catch (err) {
      const message = String(err.message).split('\n')[0].slice(0, 400);
      item.error = message;
      ctx.counts[entity].fail += 1;
      ctx.errors.push({ entity, ref: String(refOf(item) ?? ''), message });
      ctx.log.error(`${entity} "${refOf(item)}" falló: ${err.message}`);
      // Deja la pantalla limpia (cierra modales abiertos) para que el siguiente ítem no se bloquee.
      if (ctx.onItemError) await ctx.onItemError().catch(() => undefined);
    }
    ctx.savePlan?.();
  }
}

export async function setupClinic(browser, clinic, ctx) {
  const { config, log } = ctx;
  const session = await openSession(browser, {
    baseURL: config.dentalcloudUrl,
    email: clinic.admin.email,
    password: config.defaultUserPassword(),
    storageKey: `${ctx.runId}_${clinic.key}_admin`,
    log,
  });
  const { page } = session;
  ctx.onItemError = () => closeOpenModals(page);
  try {
    log.step(`[${clinic.key}] Sillones`);
    await eachItem(clinic.chairs, 'chairs', ctx, (c) => agenda.addChair(page, c, ctx), (c) => `Sillón ${c.number}`);

    log.step(`[${clinic.key}] Sucursales`);
    await eachItem(clinic.sucursales, 'sucursales', ctx, (s) => catalogo.addSucursal(page, s, ctx));

    log.step(`[${clinic.key}] Previsiones`);
    await eachItem(clinic.previsiones, 'previsiones', ctx, (p) => catalogo.addPrevision(page, p, ctx));

    log.step(`[${clinic.key}] Convenios`);
    await eachItem(clinic.convenios, 'convenios', ctx, (c) => catalogo.addConvenio(page, c, ctx));

    log.step(`[${clinic.key}] Prestaciones`);
    await eachItem(clinic.prestaciones, 'prestaciones', ctx, (p) => catalogo.addPrestacion(page, p, ctx), (p) => p.code);

    log.step(`[${clinic.key}] Profesionales`);
    await eachItem(clinic.users, 'users', ctx, (u) => profesionales.addProfessional(page, u, ctx), (u) => u.email);

    log.step(`[${clinic.key}] Horarios`);
    const byUser = new Map();
    for (const block of clinic.schedules || []) {
      if (block.done) continue;
      if (!byUser.has(block.userKey)) byUser.set(block.userKey, []);
      byUser.get(block.userKey).push(block);
    }
    for (const [userKey, blocks] of byUser) {
      const user = ctx.resolveUser(userKey);
      if (!user?.done) {
        for (const b of blocks) {
          ctx.counts.schedules.fail += 1;
          ctx.errors.push({ entity: 'schedules', ref: userKey, message: 'el profesional no se creó' });
        }
        continue;
      }
      try {
        await profesionales.addSchedule(page, user, blocks, ctx);
        for (const b of blocks) b.done = true;
        ctx.counts.schedules.ok += blocks.length;
      } catch (err) {
        ctx.counts.schedules.fail += blocks.length;
        ctx.errors.push({ entity: 'schedules', ref: user.email, message: err.message });
        log.error(`Horario de ${user.name} falló: ${err.message}`);
      }
      ctx.savePlan?.();
    }
    // Solo se marca completa si no quedó nada pendiente; así --resume reintenta lo que falló.
    const lists = [clinic.chairs, clinic.sucursales, clinic.previsiones, clinic.convenios, clinic.prestaciones, clinic.users, clinic.schedules];
    clinic.setupDone = lists.every((list) => (list || []).every((item) => item.done));
  } finally {
    await session.close();
  }
}
