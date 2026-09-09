// Tarjetas de título (HTML local) que se muestran en el navegador durante la grabación.
import fs from 'node:fs';
import path from 'node:path';

const CSS = `
  html, body { margin: 0; height: 100%; background: #0e2a33; font-family: Segoe UI, Arial, sans-serif; color: #f4fbfb; }
  .wrap { height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 0 9vw; box-sizing: border-box;
          background: radial-gradient(circle at 80% 20%, #16606a 0%, #0e2a33 55%); }
  .brand { font-size: 2.2vw; letter-spacing: .18em; text-transform: uppercase; color: #8fd6d6; margin-bottom: 2.2vw; }
  .brand b { color: #ffffff; }
  h1 { font-size: 5.2vw; line-height: 1.08; margin: 0 0 1.4vw 0; font-weight: 700; max-width: 80vw; }
  p { font-size: 2.1vw; line-height: 1.45; margin: 0; color: #d6ecec; max-width: 72vw; }
  .kicker { font-size: 1.7vw; color: #8fd6d6; text-transform: uppercase; letter-spacing: .14em; margin-bottom: 1vw; }
  .bar { position: absolute; left: 0; bottom: 0; height: 1.1vw; width: 100%; background: linear-gradient(90deg, #22b3b3, #4c5fd5); }
  ul { font-size: 2.1vw; line-height: 1.6; color: #d6ecec; margin: 1vw 0 0 0; padding-left: 1.4em; }
`;

export function titleCardHtml({ kicker = '', title, subtitle = '', bullets = [] }) {
  const items = bullets.map((b) => `<li>${b}</li>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head>
<body><div class="wrap">
  <div class="brand">fordent<b>cloud</b></div>
  ${kicker ? `<div class="kicker">${kicker}</div>` : ''}
  <h1>${title}</h1>
  ${subtitle ? `<p>${subtitle}</p>` : ''}
  ${items ? `<ul>${items}</ul>` : ''}
  <div class="bar"></div>
</div></body></html>`;
}

/**
 * Correo de confirmación de cita tal como lo envía el portal del paciente
 * (mismo texto y estructura que la plantilla real), envuelto en una vista de bandeja
 * de entrada para el video.
 */
export function writeEmailCard(dir, { patientFirstName, professionalName, clinicaNombre, dateLabel, timeLabel, to }) {
  fs.mkdirSync(dir, { recursive: true });
  const body = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #0f172a;">Tu cita ha sido agendada</h2>
      <p>Hola ${patientFirstName},</p>
      <p>Confirmamos que agendaste tu hora en ${clinicaNombre} desde el Portal de Pacientes:</p>
      <div style="background-color: #f1f5f9; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
        <p style="margin: 0 0 6px; font-size: 15px;"><strong>Día:</strong> ${dateLabel}</p>
        <p style="margin: 0 0 6px; font-size: 15px;"><strong>Hora:</strong> ${timeLabel}</p>
        <p style="margin: 0; font-size: 15px;"><strong>Profesional:</strong> ${professionalName}</p>
      </div>
      <p style="font-size: 13px; color: #64748b;">
        Si necesitas reprogramar o cancelar tu cita, puedes hacerlo desde "Mis citas" en el portal, o comunícate directamente con ${clinicaNombre}.
      </p>
      <p style="margin-top: 32px; font-size: 13px; color: #64748b;">${clinicaNombre}</p>
    </div>`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Correo de confirmación</title>
<style>
  body { margin: 0; background: #e9eef3; font-family: Segoe UI, Arial, sans-serif; }
  .mail { max-width: 860px; margin: 36px auto; background: #fff; border-radius: 14px; box-shadow: 0 12px 40px rgba(15,23,42,.15); overflow: hidden; }
  .hdr { background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 18px 30px; font-size: 16px; color: #334155; line-height: 1.6; }
  .hdr b { color: #0f172a; }
  .body { padding: 26px 40px 34px; font-size: 20px; line-height: 1.5; }
  .body div { max-width: none !important; }
  .body h2 { font-size: 34px; margin: 0 0 18px; }
  .body p { font-size: 20px; }
  .body p[style*="13px"] { font-size: 17px !important; }
  .body strong + span, .body div p { font-size: 20px !important; }
</style></head>
<body><div class="mail">
  <div class="hdr"><div><b>De:</b> ${clinicaNombre} &lt;soporte@rids.cl&gt;</div><div><b>Para:</b> ${to}</div><div><b>Asunto:</b> Tu cita ha sido agendada</div></div>
  <div class="body">${body}</div>
</div></body></html>`;
  const file = path.join(dir, 'correo-cita.html');
  fs.writeFileSync(file, html, 'utf8');
  return 'file:///' + file.replace(/\\/g, '/');
}

/** Escribe la tarjeta en disco y devuelve su URL file:// para el navegador. */
export function writeTitleCard(dir, id, card) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.html`);
  fs.writeFileSync(file, titleCardHtml(card), 'utf8');
  return 'file:///' + file.replace(/\\/g, '/');
}
