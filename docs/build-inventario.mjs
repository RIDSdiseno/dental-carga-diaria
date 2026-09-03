// Construye inventario.html a partir de docs/inventario-informacion.md
// Conversor Markdown mínimo escrito a mano: encabezados, párrafos, listas,
// tablas con pipes, negrita, cursiva, código inline, bloques de código, citas, hr.
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const SRC = 'C:/Proyectos/dental-carga-diaria/docs/inventario-informacion.md';
const OUT = 'C:/Users/User/AppData/Local/Temp/claude/C--Proyectos/492aa0d7-538c-421f-8ca3-09eba4548a6f/scratchpad/inventario.html';
const PREVIEW = 'C:/Users/User/AppData/Local/Temp/claude/C--Proyectos/492aa0d7-538c-421f-8ca3-09eba4548a6f/scratchpad/preview.html';

const md = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const lines = md.split('\n');

// ---------- utilidades ----------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push('<code>' + esc(c) + '</code>');
    return '\uE000' + (codes.length - 1) + '\uE000';
  });
  s = esc(s);
  // URLs protegidas (mismo mecanismo de placeholders que el código) antes de insertar puntos de quiebre
  s = s.replace(/https?:\/\/[^\s<)]+/g, (m) => {
    codes.push('<a href="' + m + '">' + m + '</a>');
    return '\uE000' + (codes.length - 1) + '\uE000';
  });
  // punto de quiebre opcional tras barras internas ("superior/derecha/inferior")
  s = s.replace(/(?<=\S)\/(?=\S)/g, '/<wbr>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // cursiva conservadora: *texto* sin espacios adyacentes (evita "Nombre *, Fecha *")
  s = s.replace(/(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/g, '<em>$1</em>');
  s = s.replace(/\uE000(\d+)\uE000/g, (_, i) => codes[Number(i)]);
  return s;
}

const stripInline = (t) => t.replace(/`/g, '').replace(/\*\*/g, '').trim();

const usedIds = new Set();
function slug(text) {
  let base = stripInline(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let id = base || 'seccion';
  let n = 2;
  while (usedIds.has(id)) id = base + '-' + n++;
  usedIds.add(id);
  return id;
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}
const isSep = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

// ---------- parser de bloques ----------
function parseBlocks(src) {
  const blocks = [];
  let i = 0;
  while (i < src.length) {
    const line = src[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const lang = line.trim().slice(3).trim();
      const buf = [];
      i++;
      while (i < src.length && !/^\s*```/.test(src[i])) buf.push(src[i++]);
      i++;
      blocks.push({ type: 'code', lang, text: buf.join('\n') });
      continue;
    }
    if (/^-{3,}\s*$/.test(line) || /^\*{3,}\s*$/.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { blocks.push({ type: 'h', level: h[1].length, text: h[2] }); i++; continue; }
    if (line.trim().startsWith('|')) {
      const buf = [];
      while (i < src.length && src[i].trim().startsWith('|')) buf.push(src[i++]);
      if (buf.length >= 2 && isSep(buf[1])) {
        const header = splitRow(buf[0]);
        const rows = buf.slice(2).map(splitRow);
        blocks.push({ type: 'table', header, rows });
      } else {
        blocks.push({ type: 'p', text: buf.join(' ') });
      }
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < src.length && /^\s*>/.test(src[i])) buf.push(src[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', blocks: parseBlocks(buf) });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < src.length && /^\s*[-*+]\s+/.test(src[i])) {
        let item = src[i].replace(/^\s*[-*+]\s+/, '');
        i++;
        // líneas de continuación indentadas
        while (i < src.length && /^\s{2,}\S/.test(src[i]) && !/^\s*[-*+]\s+/.test(src[i])) item += ' ' + src[i++].trim();
        items.push(item);
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < src.length && /^\s*\d+\.\s+/.test(src[i])) items.push(src[i++].replace(/^\s*\d+\.\s+/, ''));
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }
    // párrafo
    const buf = [line];
    i++;
    while (i < src.length && !/^\s*$/.test(src[i]) && !/^(#{1,6})\s/.test(src[i]) && !src[i].trim().startsWith('|') && !/^\s*>/.test(src[i]) && !/^\s*[-*+]\s+/.test(src[i]) && !/^-{3,}\s*$/.test(src[i]) && !/^\s*```/.test(src[i])) buf.push(src[i++]);
    blocks.push({ type: 'p', text: buf.join(' ') });
  }
  return blocks;
}

// ---------- render de bloques ----------
let tableCount = 0, rowCount = 0;
const unconverted = [];

function renderTable(b, ctx) {
  const cols = b.header.length;
  tableCount++;
  const cls = ['table-wrap'];
  if (ctx.loose) cls.push('loose');
  if (ctx.glossary) cls.push('glossary');
  let html = '<div class="' + cls.join(' ') + '"><table><thead><tr>';
  for (const c of b.header) html += '<th scope="col">' + inline(c) + '</th>';
  html += '</tr></thead><tbody>';
  for (const r of b.rows) {
    rowCount++;
    const cells = r.slice(0, cols);
    while (cells.length < cols) cells.push('');
    if (r.length > cols) unconverted.push('Fila con más celdas que la cabecera: ' + r.join(' | ').slice(0, 80));
    html += '<tr>' + cells.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

function renderBlocks(blocks, ctx) {
  let out = '';
  for (const b of blocks) {
    switch (b.type) {
      case 'p': {
        const s = inline(b.text);
        if (/^<strong>[^<]*<\/strong>$/.test(s)) out += '<p class="label">' + s + '</p>';
        else out += '<p>' + s + '</p>';
        break;
      }
      case 'list':
        out += (b.ordered ? '<ol>' : '<ul>') + b.items.map((it) => '<li>' + inline(it) + '</li>').join('') + (b.ordered ? '</ol>' : '</ul>');
        break;
      case 'table':
        out += renderTable(b, ctx);
        break;
      case 'quote':
        out += '<blockquote>' + renderBlocks(b.blocks, ctx) + '</blockquote>';
        break;
      case 'code':
        out += '<pre><code>' + esc(b.text) + '</code></pre>';
        break;
      case 'hr':
        out += '<hr>';
        break;
      case 'h': {
        // h4+ dentro del cuerpo de un módulo
        const id = slug(b.text);
        const badge = ctx.h4Badge ? ctx.h4Badge(stripInline(b.text)) : '';
        out += '<h' + b.level + ' id="' + id + '">' + inline(b.text) + badge + '</h' + b.level + '>';
        break;
      }
      default:
        unconverted.push('Bloque desconocido: ' + b.type);
    }
  }
  return out;
}

// ---------- estructura del documento ----------
const blocks = parseBlocks(lines);
let h1 = null;
const intro = [];
const sections = []; // {text,id,num,intro:[],subs:[{text,id,num,blocks:[]}]}
let cur = null, sub = null;
for (const b of blocks) {
  if (b.type === 'h' && b.level === 1) { h1 = b.text; continue; }
  if (b.type === 'h' && b.level === 2) {
    cur = { text: b.text, id: slug(b.text), num: (/^(\d+)\./.exec(b.text) || [])[1] || '', intro: [], subs: [] };
    sub = null;
    sections.push(cur);
    continue;
  }
  if (b.type === 'h' && b.level === 3) {
    sub = { text: b.text, id: slug(b.text), num: (/^(\d+\.\d+)/.exec(b.text) || [])[1] || '', blocks: [] };
    cur.subs.push(sub);
    continue;
  }
  if (b.type === 'hr') continue; // los separadores se reemplazan por los límites de sección
  if (!cur) intro.push(b);
  else if (!sub) cur.intro.push(b);
  else sub.blocks.push(b);
}

const BADGE = {
  dc: '<span class="badge badge-dc">DentalCloud</span>',
  dd: '<span class="badge badge-dd">Dental-Demo</span>',
  fed: '<span class="badge badge-fed">Federación</span>',
  warn: '<span class="badge badge-warn">Datos sueltos</span>',
};
function badgesFor(secNum, subNum) {
  if (secNum === '2') return BADGE.dc;
  if (secNum === '3') return BADGE.dd;
  if (secNum === '4') return BADGE.fed;
  if (subNum === '5.1') return BADGE.dc + BADGE.warn;
  if (subNum === '5.2') return BADGE.dd + BADGE.warn;
  if (subNum === '7.1') return BADGE.dc;
  if (subNum === '7.2') return BADGE.dd;
  if (subNum === '7.3') return BADGE.fed;
  return '';
}
function h4BadgeFor(secNum) {
  if (secNum !== '6') return null;
  return (t) => (t === 'DentalCloud' ? BADGE.dc : t === 'Dental-Demo' ? BADGE.dd : '');
}

// tabla de conteos (1.3) para el encabezado
let countsTable = null;
for (const s of sections) for (const su of s.subs) if (su.num === '1.3') countsTable = su.blocks.find((b) => b.type === 'table');

// ---------- cuerpo ----------
let body = '';
for (const s of sections) {
  const ctxSec = { loose: s.num === '5', glossary: false, h4Badge: h4BadgeFor(s.num) };
  body += '<section class="sec" data-sec="' + s.num + '">';
  body += '<h2 id="' + s.id + '">' + inline(s.text) + (s.subs.length === 0 ? badgesFor(s.num, '') : '') + '</h2>';
  body += renderBlocks(s.intro, ctxSec);
  for (const su of s.subs) {
    const ctx = { ...ctxSec, glossary: su.num === '7.1' || su.num === '7.2' };
    body += '<details class="mod" open><summary><h3 id="' + su.id + '">' + inline(su.text) + badgesFor(s.num, su.num) + '</h3></summary><div class="mod-body">';
    body += renderBlocks(su.blocks, ctx);
    body += '</div></details>';
  }
  body += '</section>';
}
const bodyTables = tableCount, bodyRows = rowCount;

// ---------- índice ----------
let toc = '<ol class="toc-list" id="toc-list">';
for (const s of sections) {
  toc += '<li><a href="#' + s.id + '">' + inline(s.text) + '</a>';
  if (s.subs.length) {
    toc += '<ol>';
    for (const su of s.subs) toc += '<li><a href="#' + su.id + '">' + inline(su.text) + '</a></li>';
    toc += '</ol>';
  }
  toc += '</li>';
}
toc += '</ol>';

// ---------- encabezado ----------
const headerCounts = countsTable ? renderTable(countsTable, { loose: false, glossary: false }) : '';
// (el duplicado del encabezado no se cuenta en la verificación)
tableCount = bodyTables; rowCount = bodyRows;

const introHtml = renderBlocks(intro, { loose: false, glossary: false });

// ---------- CSS ----------
const css = `
:root {
  --bg: #F6F8FA; --surface: #FFFFFF; --ink: #16232E; --muted: #5F6F7D; --line: #DCE3EA;
  --dc: #0E8C8C; --dc-soft: #E3F4F4; --dd: #4C5FD5; --dd-soft: #E9ECFB;
  --warn: #B7791F; --warn-soft: #FBF1DF; --fed: #7A4FBF; --fed-soft: #F0E9FA;
  --code-bg: var(--dc-soft);
  --toc-w: 260px; --bar-h: 60px;
  --font-head: "Manrope", "Segoe UI", system-ui, -apple-system, sans-serif;
  --font-body: "Source Sans 3", "Segoe UI", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "Cascadia Code", Consolas, "Liberation Mono", monospace;
  color-scheme: light;
  scroll-padding-top: calc(var(--bar-h) + 12px);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0F1720; --surface: #16212C; --ink: #E6EDF3; --muted: #93A3B3; --line: #26333F;
    --dc: #3FC1C1; --dc-soft: #12303A; --dd: #8A97F0; --dd-soft: #1C2340;
    --warn: #E2B15B; --warn-soft: #33290F; --fed: #B08BEA; --fed-soft: #2A1F44;
    --code-bg: var(--dc-soft);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0F1720; --surface: #16212C; --ink: #E6EDF3; --muted: #93A3B3; --line: #26333F;
  --dc: #3FC1C1; --dc-soft: #12303A; --dd: #8A97F0; --dd-soft: #1C2340;
  --warn: #E2B15B; --warn-soft: #33290F; --fed: #B08BEA; --fed-soft: #2A1F44;
  --code-bg: var(--dc-soft);
  color-scheme: dark;
}
@media (prefers-reduced-motion: no-preference) {
  summary::before { transition: transform .15s ease; }
}

body { background: var(--bg); color: var(--ink); margin: 0; font: 400 1rem/1.55 var(--font-body); -webkit-text-size-adjust: 100%; }
*, *::before, *::after { box-sizing: border-box; }
h1, h2, h3, h4 { font-family: var(--font-head); text-wrap: balance; line-height: 1.2; margin: 0; color: var(--ink); }
h1 { font-size: 2rem; font-weight: 800; letter-spacing: -.01em; }
h2 { font-size: 1.5rem; font-weight: 700; }
h3 { font-size: 1.15rem; font-weight: 700; }
h4 { font-size: 1rem; font-weight: 700; margin: 28px 0 8px; }
p, ul, ol, blockquote { max-width: 72ch; }
p { margin: 0 0 12px; }
ul, ol { margin: 0 0 12px; padding-left: 1.4em; }
li { margin: 0 0 6px; }
li::marker { color: var(--muted); }
a { color: inherit; text-decoration: underline; text-decoration-color: var(--dc); text-underline-offset: 2px; }
a:hover { text-decoration-thickness: 2px; }
strong { font-weight: 600; }
code { font-family: var(--font-mono); font-size: .86em; background: var(--code-bg); color: var(--ink); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
pre { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
pre code { background: none; padding: 0; }
blockquote { margin: 0 0 16px; padding: 4px 0 4px 16px; border-left: 3px solid var(--line); color: var(--ink); }
blockquote p:last-child { margin-bottom: 0; }
hr { border: 0; border-top: 1px solid var(--line); margin: 32px 0; }
:focus-visible { outline: 2px solid var(--dc); outline-offset: 2px; border-radius: 4px; }

/* Índice lateral */
.toc { position: fixed; top: 0; left: 0; bottom: 0; width: var(--toc-w); overflow-y: auto; background: var(--surface); border-right: 1px solid var(--line); padding: 20px 14px 32px; z-index: 6; }
.toc-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.toc-title { font: 700 .78rem/1 var(--font-head); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.toc-toggle { display: none; font: 600 .85rem var(--font-body); color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
.toc-list, .toc-list ol { list-style: none; margin: 0; padding: 0; }
.toc-list li { margin: 0; }
.toc-list a { display: block; padding: 6px 8px; border-radius: 6px; text-decoration: none; color: var(--ink); font-size: .92rem; line-height: 1.3; }
.toc-list > li { margin-bottom: 6px; }
.toc-list > li > a { font-family: var(--font-head); font-weight: 700; font-size: .88rem; }
.toc-list ol { margin: 2px 0 6px; padding-left: 10px; border-left: 1px solid var(--line); margin-left: 8px; }
.toc-list ol a { font-size: .84rem; color: var(--muted); padding: 4px 8px; }
.toc-list a:hover { background: var(--bg); color: var(--ink); }
.toc-list a.active { background: var(--dc-soft); color: var(--ink); font-weight: 600; }
.toc-list a code { font-size: .8em; background: none; padding: 0; }

/* Página */
.page { margin-left: var(--toc-w); }
main { max-width: 1180px; margin: 0 auto; padding: 0 32px 80px; }
.page-head { padding: 40px 0 8px; }
.page-head .desc { color: var(--muted); font-size: 1.05rem; margin: 10px 0 4px; max-width: 72ch; }
.page-head .date { color: var(--muted); font-size: .92rem; margin: 0 0 20px; }
.page-head .table-wrap { max-width: 900px; }
.intro { margin: 8px 0 24px; }

/* Barra de filtro */
.bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px 0; margin: 8px 0 8px; background: var(--bg); border-bottom: 1px solid var(--line); }
.bar input[type="search"] { flex: 1 1 280px; min-width: 200px; font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
.bar input[type="search"]::placeholder { color: var(--muted); }
.bar .btns { display: flex; gap: 8px; }
.bar button { font: 600 .88rem var(--font-body); color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 7px 12px; cursor: pointer; }
.bar button:hover { background: var(--dc-soft); }
.bar output { margin-left: auto; color: var(--muted); font-size: .92rem; font-variant-numeric: tabular-nums; white-space: nowrap; }

/* Secciones y módulos */
.sec { margin-top: 44px; padding-top: 20px; border-top: 2px solid var(--line); }
.sec > h2 { margin-bottom: 14px; }
.sec > p, .sec > ul { margin-bottom: 14px; }
details.mod { border-top: 1px solid var(--line); }
details.mod:last-child { border-bottom: 1px solid var(--line); }
summary { list-style: none; cursor: pointer; display: flex; align-items: flex-start; gap: 12px; padding: 12px 4px; }
summary::-webkit-details-marker { display: none; }
summary::before { content: ""; flex: none; width: 8px; height: 8px; margin: .55em 6px 0 4px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(-45deg); }
details[open] > summary::before { transform: rotate(45deg); }
summary:hover { background: var(--surface); }
summary h3 { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.mod-body { padding: 4px 0 20px 30px; }
.mod-body > :first-child { margin-top: 0; }
.mod-body > h4:first-child { margin-top: 4px; }
.label { font: 700 1rem/1.3 var(--font-head); margin: 24px 0 8px; max-width: none; }
.label strong { font-weight: 700; }

/* Insignias */
.badge { display: inline-flex; align-items: center; gap: 6px; font: 600 .74rem/1 var(--font-head); letter-spacing: .01em; color: var(--ink); padding: 4px 9px 4px 7px; border-radius: 999px; vertical-align: middle; white-space: nowrap; }
.badge::before { content: ""; width: 7px; height: 7px; border-radius: 50%; flex: none; }
.badge-dc { background: var(--dc-soft); } .badge-dc::before { background: var(--dc); }
.badge-dd { background: var(--dd-soft); } .badge-dd::before { background: var(--dd); }
.badge-fed { background: var(--fed-soft); } .badge-fed::before { background: var(--fed); }
.badge-warn { background: var(--warn-soft); } .badge-warn::before { background: var(--warn); }
h2 .badge { font-size: .78rem; margin-left: 10px; }

/* Tablas */
.table-wrap { overflow-x: auto; margin: 12px 0 22px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
.table-wrap.fits { overflow: visible; }
/* Dentro de un contenedor con scroll horizontal, sticky se ancla al propio contenedor y taparía filas: se desactiva */
.table-wrap:not(.fits) thead th { position: static; }
.table-wrap.loose { border-left: 4px solid var(--warn); }
table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: .92rem; line-height: 1.45; font-variant-numeric: tabular-nums; }
thead th { position: sticky; top: var(--bar-h); z-index: 1; background: var(--surface); color: var(--muted); font-family: var(--font-body); font-weight: 600; font-size: .82rem; letter-spacing: .02em; text-align: left; padding: 10px 12px; border-bottom: 2px solid var(--line); vertical-align: bottom; }
tbody td { padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: var(--bg); }
tbody td:first-child { font-weight: 600; }
td code, th code, td a { overflow-wrap: anywhere; }
.glossary tbody td:nth-child(2) { font-family: var(--font-mono); font-size: .84em; overflow-wrap: anywhere; }
.glossary tbody td:nth-child(2) code { font-size: 1em; }

/* Responsivo */
@media (max-width: 999.98px) {
  .toc { position: static; width: auto; border-right: 0; border-bottom: 1px solid var(--line); padding: 14px 20px; }
  .toc-toggle { display: inline-block; }
  .toc-list { display: none; }
  .toc.open .toc-list { display: block; }
  .page { margin-left: 0; }
  main { padding: 0 18px 60px; }
  .page-head { padding-top: 24px; }
  h1 { font-size: 1.6rem; }
  h2 { font-size: 1.3rem; }
  .mod-body { padding-left: 0; }
}
@media (max-width: 560px) {
  .bar { gap: 8px; }
  .bar input[type="search"] { flex-basis: 100%; }
  summary h3 { font-size: 1.05rem; }
}
`;

// ---------- JS ----------
const js = `
(function () {
  var main = document.getElementById('content');
  var toc = document.getElementById('toc');
  var tocList = document.getElementById('toc-list');
  var toggle = document.getElementById('toc-toggle');
  var bar = document.getElementById('bar');
  var input = document.getElementById('filter');
  var out = document.getElementById('count');
  var root = document.documentElement;
  var isWide = function () { return window.matchMedia('(min-width: 1000px)').matches; };
  var norm = function (s) { return s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase(); };
  var toArr = function (l) { return Array.prototype.slice.call(l); };

  var rows = toArr(main.querySelectorAll('section.sec tbody tr'));
  var wraps = toArr(main.querySelectorAll('section.sec .table-wrap'));
  var allWraps = toArr(main.querySelectorAll('.table-wrap'));
  var details = toArr(main.querySelectorAll('details.mod'));
  var sections = toArr(main.querySelectorAll('section.sec'));
  rows.forEach(function (r) {
    r.dataset.k = norm(r.textContent);
    r.ownerBox = r.closest('details.mod') || r.closest('section.sec');
  });
  details.forEach(function (d) { d.dataset.k = norm(d.querySelector('summary').textContent); });
  sections.forEach(function (s) { s.dataset.k = norm(s.querySelector('h2').textContent); });

  function fmt(n) { try { return n.toLocaleString('es-CL'); } catch (e) { return String(n); } }
  function setBar() { root.style.setProperty('--bar-h', bar.offsetHeight + 'px'); }
  function fit() {
    allWraps.forEach(function (w) {
      w.classList.remove('fits');
      if (w.hidden || w.offsetParent === null) return;
      if (w.scrollWidth <= w.clientWidth + 1) w.classList.add('fits');
    });
  }
  var fitTimer = null;
  function fitSoon() { if (fitTimer) cancelAnimationFrame(fitTimer); fitTimer = requestAnimationFrame(function () { fitTimer = null; fit(); }); }

  function applyFilter() {
    var q = norm(input.value.trim());
    var visible = 0;
    rows.forEach(function (r) {
      var show = !q || r.ownerBox.dataset.k.indexOf(q) >= 0 || r.dataset.k.indexOf(q) >= 0;
      r.hidden = !show;
      if (show) visible++;
    });
    wraps.forEach(function (w) { w.hidden = !!q && !w.querySelector('tbody tr:not([hidden])'); });
    details.forEach(function (d) { d.hidden = !!q && !(d.dataset.k.indexOf(q) >= 0 || d.querySelector('tbody tr:not([hidden])')); });
    sections.forEach(function (s) { s.hidden = !!q && !(s.dataset.k.indexOf(q) >= 0 || s.querySelector('tbody tr:not([hidden])')); });
    out.textContent = fmt(visible) + (visible === 1 ? ' fila visible' : ' filas visibles');
    fitSoon();
    updateActive();
  }
  var filterTimer = null;
  input.addEventListener('input', function () { clearTimeout(filterTimer); filterTimer = setTimeout(applyFilter, 90); });
  input.addEventListener('search', applyFilter);

  document.getElementById('expand').addEventListener('click', function () { details.forEach(function (d) { d.open = true; }); fitSoon(); });
  document.getElementById('collapse').addEventListener('click', function () { details.forEach(function (d) { d.open = false; }); fitSoon(); });
  details.forEach(function (d) { d.addEventListener('toggle', fitSoon); });

  // Índice plegable en pantallas angostas
  toggle.addEventListener('click', function () {
    var open = toc.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  tocList.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a) return;
    if (!isWide()) { toc.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
  });

  // Abrir el details que contiene el ancla destino
  function revealHash() {
    if (!location.hash) return;
    var t;
    try { t = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) { return; }
    if (!t) return;
    var d = t.closest('details');
    if (d && !d.open && !d.contains(t.closest('summary'))) { d.open = true; t.scrollIntoView(); }
  }
  window.addEventListener('hashchange', revealHash);

  // Resaltado de la sección visible
  var heads = toArr(main.querySelectorAll('h2[id], h3[id]'));
  var links = {};
  toArr(tocList.querySelectorAll('a')).forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
  var seen = new Set();
  var current = null;
  function setActive(h) {
    if (!h || h === current) return;
    if (current && links[current.id]) { links[current.id].classList.remove('active'); links[current.id].removeAttribute('aria-current'); }
    current = h;
    var a = links[h.id];
    if (a) {
      a.classList.add('active'); a.setAttribute('aria-current', 'true');
      if (isWide()) {
        var r = a.getBoundingClientRect(), tr = toc.getBoundingClientRect();
        if (r.top < tr.top + 40 || r.bottom > tr.bottom - 40) a.scrollIntoView({ block: 'center' });
      }
    }
  }
  // Activo = último encabezado visible cuyo borde superior ya pasó la barra;
  // si ninguno pasó (inicio de página), el primero que está por debajo.
  function updateActive() {
    var top = bar.offsetHeight + 16;
    var best = null, firstBelow = null;
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      if (h.offsetParent === null) continue;
      var t = h.getBoundingClientRect().top;
      if (t <= top) best = h; else if (!firstBelow) firstBelow = h;
    }
    setActive(best || firstBelow);
  }
  var scrollTimer = null;
  function onScroll() { if (scrollTimer) return; scrollTimer = requestAnimationFrame(function () { scrollTimer = null; updateActive(); }); }
  if ('IntersectionObserver' in window) {
    // El observador dispara el recálculo cuando un encabezado cruza la franja superior
    var io = new IntersectionObserver(function () { updateActive(); }, { rootMargin: '-' + (bar.offsetHeight + 8) + 'px 0px -55% 0px', threshold: 0 });
    heads.forEach(function (h) { io.observe(h); });
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  function layout() { setBar(); fit(); updateActive(); }
  var rsTimer = null;
  window.addEventListener('resize', function () { clearTimeout(rsTimer); rsTimer = setTimeout(layout, 120); });
  layout();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  window.addEventListener('load', function () { layout(); revealHash(); });
  out.textContent = fmt(rows.length) + ' filas visibles';
})();
`;

// ---------- documento ----------
const title = 'Inventario DentalCloud y Dental-Demo';
const html = `<title>${title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>${css}</style>
<nav class="toc" id="toc" aria-label="Índice del documento">
  <div class="toc-head">
    <span class="toc-title">Índice</span>
    <button type="button" class="toc-toggle" id="toc-toggle" aria-expanded="false" aria-controls="toc-list">Mostrar índice</button>
  </div>
  ${toc}
</nav>
<div class="page">
<main id="content">
  <header class="page-head">
    <h1>${inline(h1 || title)}</h1>
    <p class="desc">Qué información se puede cargar por pantalla en cada aplicación, qué viaja por federación y qué datos quedan sueltos. Referencia para la carga de datos de prueba (10 clínicas, 300 pacientes diarios).</p>
    <p class="date">Actualizado el <time datetime="2026-09-03">3 de septiembre de 2026</time></p>
    ${headerCounts}
  </header>
  <div class="intro">${introHtml}</div>
  <div class="bar" id="bar" role="search">
    <input type="search" id="filter" placeholder="Filtrar campos, valores o módulos…" aria-label="Filtrar campos, valores o módulos" autocomplete="off" spellcheck="false">
    <div class="btns">
      <button type="button" id="expand">Expandir todo</button>
      <button type="button" id="collapse">Contraer todo</button>
    </div>
    <output id="count" for="filter" aria-live="polite"></output>
  </div>
  ${body}
</main>
</div>
<script>${js}</script>
`;

writeFileSync(OUT, html, 'utf8');
// Vista previa local con esqueleto equivalente al del visor de Artifacts
writeFileSync(PREVIEW, '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui;background:#fafafa}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + html + '</body></html>', 'utf8');

// ---------- verificación ----------
const mdTables = lines.filter((l) => l.trim().startsWith('|') && isSep(l)).length;
const mdPipeLines = lines.filter((l) => l.trim().startsWith('|')).length;
const mdRows = mdPipeLines - 2 * mdTables; // menos cabecera y separador
const htmlTables = (html.match(/<table>/g) || []).length;
const htmlRows = (html.match(/<tbody>[\s\S]*?<\/tbody>/g) || []).reduce((n, t) => n + (t.match(/<tr>/g) || []).length, 0);
const leftovers = [];
if (/\*\*/.test(html)) leftovers.push('quedan "**"');
if (/\| ?---/.test(html)) leftovers.push('quedan separadores "| ---"');
if (/`/.test(html.replace(/<script>[\s\S]*<\/script>/, '').replace(/<style>[\s\S]*<\/style>/, ''))) leftovers.push('quedan acentos graves en el contenido');
const size = statSync(OUT).size;
console.log(JSON.stringify({
  out: OUT,
  bytes: size,
  kb: Math.round(size / 1024),
  md: { tables: mdTables, rows: mdRows, lines: lines.length },
  html: { tablesBody: bodyTables, rowsBody: bodyRows, tablesTotal: htmlTables, rowsTotal: htmlRows },
  sections: sections.map((s) => s.num + ' (' + s.subs.length + ' subsecciones)'),
  leftovers,
  unconverted,
}, null, 2));
