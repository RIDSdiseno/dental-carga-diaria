// Narración con voz neuronal (Microsoft Edge TTS) y medición de duración con ffprobe.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffprobe from 'ffprobe-static';

export const VOICES = {
  femenina: 'es-CL-CatalinaNeural',
  masculina: 'es-CL-LorenzoNeural',
};

export function audioDuration(file) {
  const out = execFileSync(ffprobe.path, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  return Number(out.toString().trim());
}

/** Genera un MP3 por escena. Reutiliza el archivo si el texto no cambió (caché por hash simple). */
export async function synthesizeScenes(scenes, outDir, voice = VOICES.femenina) {
  fs.mkdirSync(outDir, { recursive: true });
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const results = [];
  for (const scene of scenes) {
    const file = path.join(outDir, `${scene.id}.mp3`);
    const stamp = path.join(outDir, `${scene.id}.txt`);
    const text = scene.narration.replace(/\s+/g, ' ').trim();
    if (!(fs.existsSync(file) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === `${voice}\n${text}`)) {
      const { audioStream } = tts.toStream(text);
      const chunks = [];
      for await (const c of audioStream) chunks.push(c);
      fs.writeFileSync(file, Buffer.concat(chunks));
      fs.writeFileSync(stamp, `${voice}\n${text}`, 'utf8');
    }
    const duration = audioDuration(file);
    results.push({ id: scene.id, file, duration });
    console.log(`voz ${scene.id}: ${duration.toFixed(1)} s`);
  }
  return results;
}
