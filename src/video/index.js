// Produce el video de presentación de fordentcloud:
//   node src/video/index.js                 → voz + grabación + ensamblaje
//   node src/video/index.js --skip-record   → reutiliza la última grabación (solo re-ensambla)
//   node src/video/index.js --voice masculina
//   node src/video/index.js --max-mb 18 --out "C:\Proyectos\fordentcloud-video"
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildScenes } from './scenes.js';
import { synthesizeScenes, VOICES } from './tts.js';
import { recordVideo } from './record.js';
import { loadDemoClinic } from './demo-data.js';
import { buildSrt, encodeVideo, buildGuionMarkdown, buildGuionDocx, humanSize } from './build.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const skipRecord = process.argv.includes('--skip-record');
const voice = VOICES[arg('--voice', 'femenina')] || VOICES.femenina;
const maxMB = Number(arg('--max-mb', 18));
const outRoot = arg('--out', 'C:\\Proyectos\\fordentcloud-video');
const workDir = path.join(outRoot, 'trabajo');
const outDir = path.join(outRoot, 'salida');
fs.mkdirSync(workDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const started = Date.now();
// La clínica y el paciente de demostración se eligen antes de la voz: la narración nombra a la clínica.
const data = loadDemoClinic();
console.log(`Clínica de demostración: ${data.clinic.name} (${data.runId}) · paciente: ${data.patient.firstName} ${data.patient.lastName}`);
const scenes = buildScenes(data);
console.log(`Escenas: ${scenes.length} · voz: ${voice}`);

console.log('\n== 1/3 Narración ==');
const audio = await synthesizeScenes(scenes, path.join(workDir, 'voz'), voice);
const narrated = audio.reduce((s, a) => s + a.duration, 0);
console.log(`Narración total: ${narrated.toFixed(0)} s`);

console.log('\n== 2/3 Grabación ==');
let recording;
const timelinePath = path.join(workDir, 'timeline.json');
if (skipRecord && fs.existsSync(timelinePath)) {
  recording = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));
  console.log(`Reutilizando grabación: ${recording.rawPath}`);
} else {
  recording = await recordVideo({ scenes, audio, data, workDir });
  console.log(`Grabado: ${recording.rawPath} · ${recording.totalSeconds.toFixed(0)} s`);
}

console.log('\n== 3/3 Ensamblaje ==');
const videoName = 'fordentcloud-presentacion.mp4';
const srtPath = path.join(outDir, 'fordentcloud-presentacion.srt');
fs.writeFileSync(srtPath, buildSrt(scenes, recording.timeline, audio), 'utf8');
const outPath = path.join(outDir, videoName);
const enc = encodeVideo({ rawPath: recording.rawPath, timeline: recording.timeline, audio, srtPath, outPath, maxMB });
console.log(`MP4: ${outPath} · ${humanSize(enc.size)} · ${enc.mode} · ${enc.totalSeconds.toFixed(0)} s`);

const md = buildGuionMarkdown({ scenes, timeline: recording.timeline, audio, totalSeconds: enc.totalSeconds, videoName });
fs.writeFileSync(path.join(outDir, 'guion.md'), md, 'utf8');
await buildGuionDocx({ scenes, timeline: recording.timeline, audio, totalSeconds: enc.totalSeconds, videoName, outPath: path.join(outDir, 'guion.docx') });

// Copia al Escritorio para que quede a la mano.
const desktop = fs.existsSync(path.join(os.homedir(), 'OneDrive - rids.cl', 'Escritorio'))
  ? path.join(os.homedir(), 'OneDrive - rids.cl', 'Escritorio')
  : path.join(os.homedir(), 'Desktop');
const deliver = path.join(desktop, 'fordentcloud video');
fs.mkdirSync(deliver, { recursive: true });
for (const f of [videoName, 'guion.docx', 'guion.md', 'fordentcloud-presentacion.srt']) fs.copyFileSync(path.join(outDir, f), path.join(deliver, f));

console.log(`\nListo en ${((Date.now() - started) / 1000).toFixed(0)} s. Entregables en: ${deliver}`);
if (enc.size > maxMB * 1024 * 1024) {
  console.error(`ATENCIÓN: el video pesa ${humanSize(enc.size)}, por encima de ${maxMB} MB.`);
  process.exitCode = 1;
}
