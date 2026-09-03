// Generación de imágenes (logo y avatar) renderizando HTML/SVG con Chromium
// headless de Playwright, y de PDFs mínimos escritos a mano (sin librerías).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createRng } from './random.js';

const SIZE = 512;
const FONT = "'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif";

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Aclara (factor > 1) u oscurece (factor < 1) un color hex. */
function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * factor)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

const LOGO_PALETTES = [
  ['#0f766e', '#14b8a6'], ['#1d4ed8', '#60a5fa'], ['#6d28d9', '#a78bfa'], ['#0e7490', '#22d3ee'],
  ['#be185d', '#f472b6'], ['#334155', '#64748b'], ['#065f46', '#34d399'], ['#b45309', '#fbbf24'],
  ['#0f172a', '#334155'], ['#9d174d', '#fb7185'], ['#166534', '#4ade80'], ['#1e40af', '#3b82f6'],
  ['#0369a1', '#38bdf8'], ['#7c2d12', '#fb923c'], ['#4a044e', '#c084fc'], ['#134e4a', '#2dd4bf'],
];

const ICONS = {
  tooth:
    '<path d="M50 10c-9 0-13 6-21 6-10 0-17 9-17 21 0 15 7 21 11 36 3 11 6 17 12 17 6 0 7-11 9-19 2-7 4-9 6-9s4 2 6 9c2 8 3 19 9 19 6 0 9-6 12-17 4-15 11-21 11-36 0-12-7-21-17-21-8 0-12-6-21-6z"/>',
  cross:
    '<path d="M38 12h24v26h26v24H62v26H38V62H12V38h26z"/>',
  star:
    '<polygon points="50,6 61,36 93,36 67,55 77,88 50,68 23,88 33,55 7,36 39,36"/>',
  smile:
    '<path d="M14 42C34 22 66 22 86 42 74 76 26 76 14 42z"/><path d="M22 46c20 8 36 8 56 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" opacity=".55"/>',
  leaf:
    '<path d="M18 82C18 40 48 14 88 14 88 56 58 84 18 82z"/><path d="M22 78 70 30" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" opacity=".5"/>',
  sparkle:
    '<path d="M50 4c3 22 12 33 34 38-22 5-31 16-34 38-3-22-12-33-34-38 22-5 31-16 34-38z"/><circle cx="82" cy="18" r="6"/><circle cx="18" cy="82" r="5"/>',
  drop:
    '<path d="M50 6c18 26 30 42 30 58a30 30 0 1 1-60 0C20 48 32 32 50 6z"/>',
  shield:
    '<path d="M50 6 88 20v28c0 22-16 38-38 46C28 86 12 70 12 48V20z"/><path d="M34 50l10 10 22-22" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>',
};

const ICONS_BY_TIPO = {
  dental: ['tooth', 'tooth', 'cross', 'star', 'smile', 'shield', 'drop'],
  estetica: ['sparkle', 'leaf', 'smile', 'drop', 'star'],
  ambas: ['tooth', 'sparkle', 'leaf', 'smile', 'star', 'shield'],
};

const STOP_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'para', 'con']);

function deriveInitials(name) {
  const words = String(name)
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w.toLowerCase()));
  const letters = words.slice(0, 3).map((w) => w[0].toUpperCase());
  return letters.join('') || 'DC';
}

function iconSvg(kind, color, size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" fill="${color}" style="color:${color}">${ICONS[kind]}</svg>`;
}

/** HTML de un logo 512x512: iniciales o ícono sobre color plano / degradado suave. */
export function logoHtml({ name, tipo = 'dental', initials, rng }) {
  const r = rng || createRng(`logo:${name}`);
  const [c1, c2] = r.pick(LOGO_PALETTES);
  const gradient = r.chance(0.65);
  const angle = r.pick([135, 160, 180, 200, 45]);
  const background = gradient ? `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 100%)` : c1;
  const icon = r.pick(ICONS_BY_TIPO[tipo] || ICONS_BY_TIPO.dental);
  const letters = (initials || deriveInitials(name)).slice(0, 3);
  const variant = r.weighted([['initials', 40], ['icon', 30], ['icon-initials', 20], ['badge', 10]]);
  const shortName = esc(name.length > 28 ? `${name.slice(0, 27)}…` : name);

  let inner = '';
  if (variant === 'initials') {
    const fontSize = letters.length === 3 ? 190 : 230;
    inner = `
      <div class="ring"></div>
      <div class="initials" style="font-size:${fontSize}px">${esc(letters)}</div>`;
  } else if (variant === 'icon') {
    inner = `
      <div class="icon">${iconSvg(icon, '#ffffff', 270)}</div>
      <div class="name">${shortName}</div>`;
  } else if (variant === 'icon-initials') {
    inner = `
      <div class="icon small">${iconSvg(icon, '#ffffff', 170)}</div>
      <div class="initials mid">${esc(letters)}</div>`;
  } else {
    inner = `
      <div class="badge">
        ${iconSvg(icon, c1, 200)}
        <div class="badge-text" style="color:${c1}">${esc(letters)}</div>
      </div>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;overflow:hidden}
    .wrap{position:relative;width:${SIZE}px;height:${SIZE}px;background:${background};
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:${FONT};color:#fff}
    .ring{position:absolute;width:400px;height:400px;border-radius:50%;
      border:10px solid rgba(255,255,255,.28)}
    .initials{font-weight:700;letter-spacing:-6px;line-height:1;position:relative;
      text-shadow:0 6px 18px rgba(0,0,0,.18)}
    .initials.mid{font-size:120px;letter-spacing:-2px;margin-top:6px}
    .icon{filter:drop-shadow(0 8px 16px rgba(0,0,0,.2))}
    .icon.small{margin-bottom:8px}
    .name{margin-top:18px;font-size:30px;font-weight:600;text-align:center;
      max-width:440px;line-height:1.15;opacity:.95}
    .badge{width:360px;height:360px;border-radius:72px;background:#fff;display:flex;
      flex-direction:column;align-items:center;justify-content:center;
      box-shadow:0 14px 30px rgba(0,0,0,.22)}
    .badge-text{font-size:84px;font-weight:800;letter-spacing:-2px;margin-top:-6px}
  </style></head><body><div class="wrap">${inner}</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Avatar (retrato ilustrado con formas SVG)
// ---------------------------------------------------------------------------

const SKIN_TONES = ['#f7dcc4', '#f1cdb0', '#e8b894', '#d9a57f', '#c98a5e', '#b07343', '#8d5524', '#6e3f1f'];
const HAIR_COLORS = ['#1a1a1a', '#2b1b12', '#3b2a1a', '#4a2f1d', '#5a3825', '#7b4a2d', '#a0522d', '#c68e5a', '#d4a55a', '#8c1c1c'];
const GRAY_HAIR = ['#9ca3af', '#b8bcc4', '#d1d5db', '#e5e7eb', '#7d8590'];
const EYE_COLORS = ['#2f1b0e', '#3b2a1a', '#4b3621', '#1f3a5f', '#2e5b3a', '#5c4033'];
const CLOTHES = ['#1d4ed8', '#0f766e', '#7c3aed', '#b91c1c', '#334155', '#ca8a04', '#0e7490', '#be185d', '#15803d', '#ea580c', '#475569', '#111827', '#0284c7', '#9333ea'];
const BACKGROUNDS = ['#dbeafe', '#fce7f3', '#ecfccb', '#fef3c7', '#ede9fe', '#dcfce7', '#ffe4e6', '#e2e8f0', '#fae8ff', '#cffafe', '#fee2e2', '#f1f5f9'];

function ageFromBirthDate(birthDate, referenceDate) {
  if (!birthDate) return 35;
  const ref = referenceDate ? new Date(`${referenceDate}T12:00:00Z`) : new Date();
  const birth = new Date(`${birthDate}T12:00:00Z`);
  let age = ref.getUTCFullYear() - birth.getUTCFullYear();
  const m = ref.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && ref.getUTCDate() < birth.getUTCDate())) age--;
  return Math.max(0, age);
}

/** HTML de un avatar 512x512: cabeza, cabello, ropa y fondo variados con el rng. */
export function avatarHtml({ firstName = '', lastName = '', gender = '', birthDate, age, referenceDate, rng }) {
  const r = rng || createRng(`avatar:${firstName}:${lastName}:${birthDate}`);
  const years = Number.isFinite(age) ? age : ageFromBirthDate(birthDate, referenceDate);
  const isChild = years < 13;
  const isTeen = years >= 13 && years < 18;
  const isSenior = years >= 62;
  const feminine = gender === 'femenino' || (gender !== 'masculino' && r.chance(0.5));

  const skin = r.pick(SKIN_TONES);
  const skinDark = shade(skin, 0.82);
  const hair = isSenior ? (r.chance(0.8) ? r.pick(GRAY_HAIR) : r.pick(HAIR_COLORS)) : r.pick(HAIR_COLORS);
  const eye = r.pick(EYE_COLORS);
  const cloth = r.pick(CLOTHES);
  const clothDark = shade(cloth, 0.75);
  const bg = r.pick(BACKGROUNDS);
  const bg2 = shade(bg, 0.93);

  // Proporciones: niños con cabeza más redonda y hombros más angostos.
  const head = isChild
    ? { cx: 256, cy: 240, rx: 98, ry: 102 }
    : { cx: 256, cy: 228, rx: 92, ry: 108 };
  const shoulders = isChild
    ? 'M132 512C132 424 184 396 256 396C328 396 380 424 380 512Z'
    : 'M92 512C92 402 160 372 256 372C352 372 420 402 420 512Z';
  const neckY = isChild ? 318 : 302;

  const parts = [];
  parts.push(`<rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>`);
  parts.push(`<circle cx="256" cy="276" r="236" fill="${bg2}"/>`);

  // Cabello largo detrás de la cabeza (femenino, o masculino con melena ocasional)
  const longHair = feminine ? r.weighted([['long', 45], ['bob', 25], ['bun', 15], ['ponytail', 15]]) : (r.chance(0.08) ? 'long' : 'none');
  if (longHair === 'long') {
    parts.push(`<path d="M150 ${head.cy - 60}C150 ${head.cy - 170} 362 ${head.cy - 170} 362 ${head.cy - 60}L378 430C378 448 340 448 336 430L328 300L184 300L176 430C172 448 134 448 134 430Z" fill="${hair}"/>`);
  } else if (longHair === 'bob') {
    parts.push(`<path d="M154 ${head.cy - 50}C154 ${head.cy - 170} 358 ${head.cy - 170} 358 ${head.cy - 50}L366 320C366 340 330 344 320 330L192 330C182 344 146 340 146 320Z" fill="${hair}"/>`);
  } else if (longHair === 'ponytail') {
    parts.push(`<path d="M300 ${head.cy - 100}C360 ${head.cy - 60} 372 ${head.cy + 40} 352 ${head.cy + 150}C340 ${head.cy + 180} 318 ${head.cy + 170} 322 ${head.cy + 130}C332 ${head.cy + 60} 318 ${head.cy - 10} 292 ${head.cy - 60}Z" fill="${shade(hair, 0.9)}"/>`);
  }

  // Cuerpo y cuello
  parts.push(`<path d="${shoulders}" fill="${cloth}"/>`);
  const collar = r.weighted([['v', 40], ['round', 35], ['shirt', 25]]);
  if (collar === 'v') parts.push(`<path d="M214 ${neckY + 70}L256 ${neckY + 126}L298 ${neckY + 70}Z" fill="${clothDark}"/>`);
  if (collar === 'round') parts.push(`<path d="M206 ${neckY + 70}C220 ${neckY + 110} 292 ${neckY + 110} 306 ${neckY + 70}C290 ${neckY + 92} 222 ${neckY + 92} 206 ${neckY + 70}Z" fill="${clothDark}"/>`);
  if (collar === 'shirt') {
    parts.push(`<path d="M216 ${neckY + 68}L256 ${neckY + 120}L296 ${neckY + 68}L280 ${neckY + 64}L256 ${neckY + 96}L232 ${neckY + 64}Z" fill="#f8fafc"/>`);
    if (!feminine && r.chance(0.35)) parts.push(`<path d="M248 ${neckY + 96}L256 ${neckY + 170}L264 ${neckY + 96}Z" fill="${clothDark}"/>`);
  }
  parts.push(`<rect x="226" y="${neckY}" width="60" height="90" rx="20" fill="${skinDark}"/>`);

  // Orejas y cabeza
  parts.push(`<ellipse cx="${head.cx - head.rx + 4}" cy="${head.cy + 12}" rx="15" ry="22" fill="${skinDark}"/>`);
  parts.push(`<ellipse cx="${head.cx + head.rx - 4}" cy="${head.cy + 12}" rx="15" ry="22" fill="${skinDark}"/>`);
  if (feminine && !isChild && r.chance(0.35)) {
    const gold = r.pick(['#eab308', '#f59e0b', '#e5e7eb', '#f472b6']);
    parts.push(`<circle cx="${head.cx - head.rx + 2}" cy="${head.cy + 38}" r="6" fill="${gold}"/>`);
    parts.push(`<circle cx="${head.cx + head.rx - 2}" cy="${head.cy + 38}" r="6" fill="${gold}"/>`);
  }
  parts.push(`<ellipse cx="${head.cx}" cy="${head.cy}" rx="${head.rx}" ry="${head.ry}" fill="${skin}"/>`);

  // Mejillas
  if (isChild || feminine || r.chance(0.3)) {
    parts.push(`<ellipse cx="${head.cx - 50}" cy="${head.cy + 34}" rx="20" ry="12" fill="#f9a8b4" opacity=".35"/>`);
    parts.push(`<ellipse cx="${head.cx + 50}" cy="${head.cy + 34}" rx="20" ry="12" fill="#f9a8b4" opacity=".35"/>`);
  }

  // Cabello frontal
  const top = head.cy - head.ry;
  const bald = !feminine && years >= 45 && r.chance(years >= 62 ? 0.4 : 0.2);
  if (!bald) {
    const front = feminine
      ? r.weighted([['fringe', 45], ['part', 40], ['curls', 15]])
      : r.weighted([['short', 50], ['side', 30], ['buzz', 12], ['curls', 8]]);
    const l = head.cx - head.rx;
    const rt = head.cx + head.rx;
    if (front === 'fringe') {
      parts.push(`<path d="M${l - 2} ${head.cy - 10}C${l - 6} ${top - 24} ${rt + 6} ${top - 24} ${rt + 2} ${head.cy - 10}C${rt - 4} ${head.cy - 50} ${head.cx + 40} ${top + 34} ${head.cx - 60} ${top + 40}C${head.cx - 80} ${top + 44} ${l + 4} ${head.cy - 40} ${l - 2} ${head.cy - 10}Z" fill="${hair}"/>`);
    } else if (front === 'part') {
      parts.push(`<path d="M${l - 2} ${head.cy - 6}C${l - 6} ${top - 26} ${rt + 6} ${top - 26} ${rt + 2} ${head.cy - 6}C${rt - 10} ${head.cy - 60} ${head.cx + 70} ${top + 20} ${head.cx + 10} ${top + 30}C${head.cx - 40} ${top + 26} ${l + 10} ${head.cy - 44} ${l - 2} ${head.cy - 6}Z" fill="${hair}"/>`);
    } else if (front === 'curls') {
      parts.push(`<path d="M${l - 10} ${head.cy - 4}C${l - 18} ${top - 36} ${rt + 18} ${top - 36} ${rt + 10} ${head.cy - 4}C${rt - 2} ${head.cy - 50} ${head.cx + 60} ${top + 28} ${head.cx} ${top + 34}C${head.cx - 60} ${top + 28} ${l + 2} ${head.cy - 50} ${l - 10} ${head.cy - 4}Z" fill="${hair}"/>`);
      for (let i = 0; i < 7; i++) {
        const cx = l - 6 + i * ((rt - l + 12) / 6);
        parts.push(`<circle cx="${cx.toFixed(0)}" cy="${top - 8 + (i % 2) * 10}" r="20" fill="${hair}"/>`);
      }
    } else if (front === 'short') {
      // Casquete: arco exterior sobre la cabeza y línea de cabello a ~26 px de las cejas.
      parts.push(`<path d="M${l - 2} ${head.cy - 20}C${l - 2} ${top - 40} ${rt + 2} ${top - 40} ${rt + 2} ${head.cy - 20}C${rt - 10} ${top + 30} ${head.cx + 52} ${top + 44} ${head.cx} ${top + 44}C${head.cx - 52} ${top + 44} ${l + 10} ${top + 30} ${l - 2} ${head.cy - 20}Z" fill="${hair}"/>`);
    } else if (front === 'side') {
      // Con partidura: línea de cabello más baja a la izquierda y más alta a la derecha.
      parts.push(`<path d="M${l - 2} ${head.cy - 16}C${l - 4} ${top - 42} ${rt + 4} ${top - 42} ${rt + 2} ${head.cy - 24}C${rt - 6} ${top + 22} ${head.cx + 60} ${top + 26} ${head.cx + 20} ${top + 34}C${head.cx - 30} ${top + 44} ${l + 8} ${top + 52} ${l - 2} ${head.cy - 16}Z" fill="${hair}"/>`);
    } else if (front === 'buzz') {
      parts.push(`<path d="M${l} ${head.cy - 24}C${l} ${top - 30} ${rt} ${top - 30} ${rt} ${head.cy - 24}C${rt - 10} ${top + 26} ${head.cx + 50} ${top + 38} ${head.cx} ${top + 38}C${head.cx - 50} ${top + 38} ${l + 10} ${top + 26} ${l} ${head.cy - 24}Z" fill="${hair}" opacity=".8"/>`);
    }
    if (longHair === 'bun') parts.push(`<circle cx="${head.cx}" cy="${top - 26}" r="36" fill="${hair}"/>`);
  } else {
    parts.push(`<ellipse cx="${head.cx - head.rx + 10}" cy="${head.cy - 30}" rx="14" ry="30" fill="${hair}" opacity=".9"/>`);
    parts.push(`<ellipse cx="${head.cx + head.rx - 10}" cy="${head.cy - 30}" rx="14" ry="30" fill="${hair}" opacity=".9"/>`);
  }

  // Cejas, ojos, lentes, nariz, boca
  const eyeY = head.cy - 8;
  const browColor = isSenior ? shade(hair, 0.9) : hair;
  parts.push(`<path d="M${head.cx - 54} ${eyeY - 30}Q${head.cx - 34} ${eyeY - 42} ${head.cx - 14} ${eyeY - 30}" stroke="${browColor}" stroke-width="7" fill="none" stroke-linecap="round"/>`);
  parts.push(`<path d="M${head.cx + 14} ${eyeY - 30}Q${head.cx + 34} ${eyeY - 42} ${head.cx + 54} ${eyeY - 30}" stroke="${browColor}" stroke-width="7" fill="none" stroke-linecap="round"/>`);
  for (const dx of [-34, 34]) {
    parts.push(`<ellipse cx="${head.cx + dx}" cy="${eyeY}" rx="17" ry="12" fill="#fff"/>`);
    parts.push(`<circle cx="${head.cx + dx}" cy="${eyeY + 1}" r="8" fill="${eye}"/>`);
    parts.push(`<circle cx="${head.cx + dx + 3}" cy="${eyeY - 3}" r="2.6" fill="#fff"/>`);
  }
  const glassesChance = isChild ? 0.08 : isSenior ? 0.5 : 0.18;
  if (r.chance(glassesChance)) {
    const frame = r.pick(['#1f2937', '#7c2d12', '#374151', '#0f766e']);
    parts.push(`<circle cx="${head.cx - 34}" cy="${eyeY}" r="27" stroke="${frame}" stroke-width="4" fill="rgba(255,255,255,.15)"/>`);
    parts.push(`<circle cx="${head.cx + 34}" cy="${eyeY}" r="27" stroke="${frame}" stroke-width="4" fill="rgba(255,255,255,.15)"/>`);
    parts.push(`<path d="M${head.cx - 7} ${eyeY}L${head.cx + 7} ${eyeY}" stroke="${frame}" stroke-width="4"/>`);
  }
  parts.push(`<path d="M${head.cx} ${eyeY + 14}C${head.cx - 8} ${eyeY + 32} ${head.cx - 10} ${eyeY + 44} ${head.cx} ${eyeY + 50}C${head.cx + 8} ${eyeY + 46} ${head.cx + 8} ${eyeY + 36} ${head.cx + 3} ${eyeY + 22}" stroke="${skinDark}" stroke-width="4" fill="none" stroke-linecap="round"/>`);

  const mouthY = head.cy + 62;
  const lip = feminine && !isChild ? r.pick(['#be123c', '#db2777', '#c2410c', '#9f1239']) : '#a8453d';
  const mouth = r.weighted([['smile', 60], ['grin', 20], ['neutral', 20]]);
  if (mouth === 'smile') {
    parts.push(`<path d="M${head.cx - 30} ${mouthY}Q${head.cx} ${mouthY + 26} ${head.cx + 30} ${mouthY}" stroke="${lip}" stroke-width="6" fill="none" stroke-linecap="round"/>`);
  } else if (mouth === 'grin') {
    parts.push(`<path d="M${head.cx - 32} ${mouthY - 2}Q${head.cx} ${mouthY + 34} ${head.cx + 32} ${mouthY - 2}Z" fill="${lip}"/>`);
    parts.push(`<path d="M${head.cx - 24} ${mouthY + 2}Q${head.cx} ${mouthY + 14} ${head.cx + 24} ${mouthY + 2}Z" fill="#fff"/>`);
  } else {
    parts.push(`<path d="M${head.cx - 26} ${mouthY + 4}Q${head.cx} ${mouthY + 14} ${head.cx + 26} ${mouthY + 4}" stroke="${lip}" stroke-width="6" fill="none" stroke-linecap="round"/>`);
  }

  // Barba (masculino adulto) y líneas de expresión (mayores)
  if (!feminine && years >= 20 && r.chance(0.32)) {
    const beard = isSenior && r.chance(0.7) ? r.pick(GRAY_HAIR) : hair;
    parts.push(`<path d="M${head.cx - 82} ${head.cy + 10}C${head.cx - 78} ${head.cy + 88} ${head.cx - 40} ${head.cy + 118} ${head.cx} ${head.cy + 118}C${head.cx + 40} ${head.cy + 118} ${head.cx + 78} ${head.cy + 88} ${head.cx + 82} ${head.cy + 10}C${head.cx + 66} ${head.cy + 70} ${head.cx + 36} ${head.cy + 96} ${head.cx} ${head.cy + 96}C${head.cx - 36} ${head.cy + 96} ${head.cx - 66} ${head.cy + 70} ${head.cx - 82} ${head.cy + 10}Z" fill="${beard}" opacity=".92"/>`);
  }
  if (isSenior) {
    parts.push(`<path d="M${head.cx - 48} ${head.cy + 30}Q${head.cx - 58} ${head.cy + 60} ${head.cx - 42} ${head.cy + 80}" stroke="${skinDark}" stroke-width="3" fill="none" opacity=".6"/>`);
    parts.push(`<path d="M${head.cx + 48} ${head.cy + 30}Q${head.cx + 58} ${head.cy + 60} ${head.cx + 42} ${head.cy + 80}" stroke="${skinDark}" stroke-width="3" fill="none" opacity=".6"/>`);
  }
  if (isTeen && r.chance(0.3)) {
    parts.push(`<path d="M${head.cx - 26} ${mouthY - 1}L${head.cx + 26} ${mouthY - 1}" stroke="#94a3b8" stroke-width="3" opacity=".7"/>`);
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;overflow:hidden;background:${bg}}
    svg{display:block}
  </style></head><body><svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${parts.join('')}</svg></body></html>`;
}

// ---------------------------------------------------------------------------
// Fábrica: un solo navegador/página para muchas imágenes
// ---------------------------------------------------------------------------

/**
 * Abre Chromium una vez y devuelve { logo, avatar, pdf, close }.
 * Las llamadas se serializan sobre la misma página.
 */
export async function createImageFactory({ headless = true } = {}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  let queue = Promise.resolve();

  function render(html, outPath) {
    const job = queue.then(async () => {
      ensureDir(outPath);
      await page.setContent(html, { waitUntil: 'load' });
      await page.screenshot({ path: outPath, type: 'png', clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
      return outPath;
    });
    queue = job.catch(() => {});
    return job;
  }

  return {
    logo: (opts) => render(logoHtml(opts), opts.outPath),
    avatar: (opts) => render(avatarHtml(opts), opts.outPath),
    pdf: generatePdf,
    async close() {
      await queue;
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

async function withFactory(opts, fn) {
  if (opts.factory) return fn(opts.factory);
  const factory = await createImageFactory();
  try {
    return await fn(factory);
  } finally {
    await factory.close();
  }
}

/** Logo PNG 512x512. Acepta `factory` opcional para reutilizar el navegador. */
export function generateLogo(opts) {
  return withFactory(opts, (f) => f.logo(opts));
}

/** Avatar PNG 512x512 (retrato ilustrado). Acepta `factory` opcional. */
export function generateAvatar(opts) {
  return withFactory(opts, (f) => f.avatar(opts));
}

// ---------------------------------------------------------------------------
// PDF mínimo (1 página A4, Helvetica base-14, WinAnsiEncoding)
// ---------------------------------------------------------------------------

const WINANSI_EXTRA = {
  '€': 0x80, '…': 0x85, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '™': 0x99, 'Š': 0x8a, 'š': 0x9a,
  'Œ': 0x8c, 'œ': 0x9c, 'Ÿ': 0x9f, 'Ž': 0x8e, 'ž': 0x9e, 'ˆ': 0x88, '‰': 0x89,
};

/** Codifica texto a una cadena literal PDF con escapes octales (WinAnsi). */
function pdfString(text) {
  let out = '(';
  for (const ch of String(text)) {
    let code = ch.codePointAt(0);
    if (code > 0xff) code = WINANSI_EXTRA[ch] ?? 0x3f; // '?'
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += `\\${ch}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += ch;
  }
  return `${out})`;
}

function wrapLine(line, maxChars) {
  const words = String(line).split(/\s+/);
  const rows = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if ((current + ' ' + word).length <= maxChars) current += ' ' + word;
    else {
      rows.push(current);
      current = word;
    }
  }
  if (current || rows.length === 0) rows.push(current);
  return rows;
}

/** Construye los bytes de un PDF A4 con título, subtítulo opcional, líneas y pie. */
export function buildPdf({ title = 'Documento', subtitle = '', lines = [], footer = '' }) {
  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 56;
  const bodySize = 10.5;
  const leading = 15;
  const bodyTop = subtitle ? 722 : 746;
  const maxRows = Math.floor((bodyTop - 80) / leading);

  const rows = [];
  for (const line of lines) {
    if (line === '' || line === null || line === undefined) rows.push('');
    else rows.push(...wrapLine(line, 88));
  }
  const visibleRows = rows.slice(0, maxRows);
  if (rows.length > maxRows) visibleRows[maxRows - 1] = '…';

  let content = '';
  content += `BT /F1 18 Tf ${margin} ${pageH - margin - 12} Td ${pdfString(title)} Tj ET\n`;
  if (subtitle) content += `BT /F2 11 Tf 0.35 0.35 0.35 rg ${margin} ${pageH - margin - 34} Td ${pdfString(subtitle)} Tj ET\n`;
  const ruleY = subtitle ? pageH - margin - 46 : pageH - margin - 26;
  content += `0.75 0.75 0.75 RG 0.8 w ${margin} ${ruleY} m ${pageW - margin} ${ruleY} l S\n`;
  content += `BT /F2 ${bodySize} Tf ${leading} TL 0 0 0 rg ${margin} ${bodyTop} Td\n`;
  for (const row of visibleRows) content += `${pdfString(row)} Tj T*\n`;
  content += 'ET\n';
  if (footer) content += `BT /F2 8.5 Tf 0.45 0.45 0.45 rg ${margin} 40 Td ${pdfString(footer)} Tj ET\n`;

  const contentBuf = Buffer.from(content, 'latin1');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    Buffer.concat([Buffer.from(`<< /Length ${contentBuf.length} >>\nstream\n`, 'latin1'), contentBuf, Buffer.from('\nendstream', 'latin1')]),
    `<< /Title ${pdfString(title)} /Producer (dental-carga-diaria) /Creator (dental-carga-diaria) >>`,
  ];

  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let position = chunks[0].length;
  objects.forEach((body, i) => {
    offsets.push(position);
    const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
    const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
    const tail = Buffer.from('\nendobj\n', 'latin1');
    chunks.push(head, bodyBuf, tail);
    position += head.length + bodyBuf.length + tail.length;
  });

  const xrefPos = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}

/** Escribe un PDF válido de una página en `outPath`. */
export async function generatePdf({ title, subtitle, lines = [], footer, outPath }) {
  ensureDir(outPath);
  fs.writeFileSync(outPath, buildPdf({ title, subtitle, lines, footer }));
  return outPath;
}
