// Ensamblaje final: narración sincronizada, subtítulos, codificación bajo el límite de
// tamaño y documentos del guion (Markdown y Word).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';

const MB = 1024 * 1024;

function ffmpeg(args) {
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
}

function probeDuration(file) {
  return Number(execFileSync(ffprobe.path, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).toString().trim());
}

function fmtTime(sec, withMs = false) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const base = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return withMs ? `${base},${String(ms).padStart(3, '0')}` : base.slice(3);
}

function splitSentences(text) {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?:;])\s+/)
    .filter(Boolean);
}

/** Subtítulos SRT: cada oración ocupa un tiempo proporcional a su largo dentro de la narración. */
export function buildSrt(scenes, timeline, audio) {
  const durations = new Map(audio.map((a) => [a.id, a.duration]));
  let n = 1;
  const cues = [];
  for (const scene of scenes) {
    const t = timeline.find((x) => x.id === scene.id);
    if (!t) continue;
    const sentences = splitSentences(scene.narration);
    const total = sentences.reduce((s, x) => s + x.length, 0) || 1;
    let cursor = t.start;
    const dur = durations.get(scene.id) ?? 5;
    for (const sentence of sentences) {
      const len = (sentence.length / total) * dur;
      cues.push(`${n++}\n${fmtTime(cursor, true)} --> ${fmtTime(cursor + Math.max(0.8, len - 0.05), true)}\n${sentence}\n`);
      cursor += len;
    }
  }
  return cues.join('\n');
}

/** Mezcla la narración (un mp3 por escena, colocado en su instante) y codifica el MP4 bajo maxMB. */
export function encodeVideo({ rawPath, timeline, audio, srtPath, outPath, maxMB = 18 }) {
  const inputs = ['-i', rawPath];
  const filters = [];
  const labels = [];
  audio.forEach((a, i) => {
    const t = timeline.find((x) => x.id === a.id);
    if (!t) return;
    inputs.push('-i', a.file);
    const delay = Math.max(0, Math.round(t.start * 1000));
    filters.push(`[${i + 1}:a]adelay=${delay}|${delay}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,volume=1.6,alimiter=limit=0.95[aout]`);
  const totalSeconds = probeDuration(rawPath);
  const common = [
    ...inputs,
    '-i', srtPath,
    '-filter_complex', filters.join(';'),
    '-map', '0:v', '-map', '[aout]', `-map`, `${labels.length + 1}:s`,
    '-vf', 'fps=15,scale=1280:720:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-tune', 'stillimage', '-profile:v', 'high', '-g', '150',
    '-c:a', 'aac', '-b:a', '48k', '-ac', '1', '-ar', '24000',
    '-c:s', 'mov_text', '-metadata:s:s:0', 'language=spa', '-metadata:s:s:0', 'title=Español',
    '-metadata', 'title=fordentcloud - Presentación del sistema',
    '-movflags', '+faststart', '-shortest',
  ];

  // Intento 1: calidad constante.
  ffmpeg([...common, '-crf', '30', outPath]);
  let size = fs.statSync(outPath).size;
  if (size <= maxMB * MB) return { size, mode: 'crf30', totalSeconds };

  // Intento 2: dos pasadas apuntando al tamaño (margen 6 %).
  const targetBits = maxMB * MB * 8 * 0.94;
  const videoKbps = Math.max(60, Math.floor((targetBits / totalSeconds - 48000) / 1000));
  const passlog = path.join(path.dirname(outPath), 'ffpass');
  ffmpeg([...common.filter((x, i, arr) => !(x === '-i' && arr[i + 1] === srtPath) && x !== srtPath && !x.startsWith('-map') && !/^\d+:s$|^\[aout\]$|^0:v$/.test(x)), '-an', '-sn', '-b:v', `${videoKbps}k`, '-pass', '1', '-passlogfile', passlog, '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null']);
  ffmpeg([...common, '-b:v', `${videoKbps}k`, '-pass', '2', '-passlogfile', passlog, outPath]);
  size = fs.statSync(outPath).size;
  return { size, mode: `2pass ${videoKbps}k`, totalSeconds };
}

/** Guion en Markdown (ficha técnica, tabla de escenas y texto corrido). */
export function buildGuionMarkdown({ scenes, timeline, audio, totalSeconds, videoName }) {
  const durations = new Map(audio.map((a) => [a.id, a.duration]));
  const words = scenes.reduce((n, s) => n + s.narration.split(/\s+/).length, 0);
  const lines = [];
  lines.push('# fordentcloud · Guion del video de presentación');
  lines.push('');
  lines.push('## Ficha técnica');
  lines.push('');
  lines.push(`- Video: ${videoName}`);
  lines.push(`- Duración: ${fmtTime(totalSeconds)} (${Math.round(totalSeconds)} s)`);
  lines.push(`- Escenas: ${scenes.length}`);
  lines.push(`- Palabras narradas: ${words}`);
  lines.push('- Voz: narración en español de Chile');
  lines.push('- Roles que aparecen: super administrador, administrador de clínica, recepción (operador), odontólogo, super administrador de Dental-Demo');
  lines.push('- Plataformas: DentalCloud (dentalcloudia.netlify.app) y Dental-Demo (dentalaicloud.netlify.app)');
  lines.push('');
  lines.push('## Resumen');
  lines.push('');
  lines.push(
    'El video presenta fordentcloud a un cliente: primero DentalCloud como sistema del holding (crear una clínica, conectarla con Dental-Demo y habilitar módulos), luego la configuración de la clínica (agenda y sillones, catálogo, profesionales y horarios), después el recorrido completo de un paciente con cada rol (pago de consulta, ficha, citas, motivo de consulta, presupuesto con odontograma, evolución, cartola y documentos), y finalmente Dental-Demo mostrando la misma clínica sincronizada más inventario, radiografías y finanzas.'
  );
  lines.push('');
  lines.push('## Escenas');
  lines.push('');
  lines.push('| N° | Inicio | Duración | Sección | Título | En pantalla | Narración |');
  lines.push('|---|---|---|---|---|---|---|');
  scenes.forEach((s, i) => {
    const t = timeline.find((x) => x.id === s.id);
    const start = t ? fmtTime(t.start) : '';
    const dur = t ? Math.round(t.end - t.start) : Math.round(durations.get(s.id) ?? 0);
    lines.push(`| ${i + 1} | ${start} | ${dur} s | ${s.section} | ${s.title} | ${s.screen} | ${s.narration} |`);
  });
  lines.push('');
  lines.push('## Texto corrido de la narración');
  lines.push('');
  for (const s of scenes) lines.push(s.narration, '');
  return lines.join('\n');
}

export async function buildGuionDocx({ scenes, timeline, audio, totalSeconds, videoName, outPath }) {
  const durations = new Map(audio.map((a) => [a.id, a.duration]));
  const cell = (text, bold = false, width) =>
    new TableCell({
      width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
      children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ''), bold, size: 18 })] })],
    });
  const rows = [
    new TableRow({ tableHeader: true, children: ['N°', 'Inicio', 'Dur.', 'Título', 'En pantalla', 'Narración'].map((h, i) => cell(h, true, [5, 8, 6, 17, 27, 37][i])) }),
    ...scenes.map((s, i) => {
      const t = timeline.find((x) => x.id === s.id);
      return new TableRow({
        children: [
          cell(i + 1), cell(t ? fmtTime(t.start) : ''), cell(`${t ? Math.round(t.end - t.start) : Math.round(durations.get(s.id) ?? 0)} s`),
          cell(`${s.section}\n${s.title}`), cell(s.screen), cell(s.narration),
        ],
      });
    }),
  ];
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun('fordentcloud · Guion del video de presentación')] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, text: 'Ficha técnica' }),
    new Paragraph(`Video: ${videoName}`),
    new Paragraph(`Duración: ${fmtTime(totalSeconds)} · Escenas: ${scenes.length} · Voz: español de Chile`),
    new Paragraph('Roles que aparecen: super administrador, administrador de clínica, recepción, odontólogo y super administrador de Dental-Demo.'),
    new Paragraph({ heading: HeadingLevel.HEADING_2, text: 'Escenas' }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, text: 'Texto corrido de la narración' }),
    ...scenes.map((s) => new Paragraph({ children: [new TextRun(s.narration)], spacing: { after: 160 } })),
  ];
  const doc = new Document({ creator: 'fordentcloud', title: 'Guion del video', styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } }, sections: [{ children }] });
  fs.writeFileSync(outPath, await Packer.toBuffer(doc));
  return outPath;
}

export function humanSize(bytes) {
  return `${(bytes / MB).toFixed(2)} MB`;
}
