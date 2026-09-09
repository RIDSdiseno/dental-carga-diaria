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

/** Escribe la tarjeta en disco y devuelve su URL file:// para el navegador. */
export function writeTitleCard(dir, id, card) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.html`);
  fs.writeFileSync(file, titleCardHtml(card), 'utf8');
  return 'file:///' + file.replace(/\\/g, '/');
}
