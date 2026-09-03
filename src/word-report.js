// Informe diario en Word (.docx) para el equipo: cuántas clínicas y pacientes se
// ingresaron y con qué credenciales quedaron los usuarios creados.
// Se guarda en una carpeta del Escritorio (WORD_REPORT_DIR en .env, o
// "<Escritorio>\Carga Diaria Dental" por defecto). Un archivo por día.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { config } from './config.js';

const ROLE_LABELS = { admin: 'Administrador', odontologo: 'Odontólogo', operador: 'Operador', radiologo: 'Radiólogo' };

export function wordReportDir() {
  if (process.env.WORD_REPORT_DIR) return process.env.WORD_REPORT_DIR;
  const oneDriveDesktop = path.join(os.homedir(), 'OneDrive - rids.cl', 'Escritorio');
  const base = fs.existsSync(oneDriveDesktop) ? oneDriveDesktop : path.join(os.homedir(), 'Desktop');
  return path.join(base, 'Carga Diaria Dental');
}

function cell(text, { bold = false, width, shade } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: shade ? { fill: shade } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ''), bold, size: 20 })] })],
  });
}

function table(headers, rows, widths) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => cell(h, { bold: true, width: widths?.[i], shade: 'E3F4F4' })),
      }),
      ...rows.map((r) => new TableRow({ children: r.map((v, i) => cell(v, { width: widths?.[i] })) })),
    ],
  });
}

function heading(text, level = HeadingLevel.HEADING_2) {
  return new Paragraph({ text, heading: level, spacing: { before: 280, after: 120 } });
}

function para(text, opts = {}) {
  return new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 100 } });
}

function fmtDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CL', { dateStyle: 'full', timeZone: 'America/Santiago' }).format(new Date(y, m - 1, d, 12));
}

/**
 * Genera el Word del día. `summary` es el objeto de report.js; `plan` el plan con ids.
 * La contraseña de los usuarios creados se toma del .env dentro del script (nunca se registra en logs).
 */
export async function writeWordReport({ summary, plan, log }) {
  const dir = wordReportDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `Carga ${summary.date}${summary.runId.includes('_prueba') ? ' (prueba)' : ''}.docx`);
  const password = config.defaultUserPassword();
  const t = summary.totals;

  const children = [];
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: `Carga diaria DentalCloud · ${fmtDate(summary.date)}` })],
    })
  );
  children.push(para(`Ejecución ${summary.runId} · estado: ${summary.status}`, { color: '5F6F7D' }));
  children.push(para(`DentalCloud: ${config.dentalcloudUrl}   ·   Dental-Demo: ${config.dentalDemoUrl}`, { color: '5F6F7D' }));

  children.push(heading('Resumen del día'));
  children.push(
    table(
      ['Qué', 'Ingresado', 'Fallido'],
      [
        ['Clínicas (holdings)', t.holdings.ok, t.holdings.fail],
        ['Clínicas federadas a Dental-Demo', t.federation.ok, t.federation.fail],
        ['Pacientes', t.patients.ok, t.patients.fail],
        ['Profesionales y usuarios', t.users.ok, t.users.fail],
        ['Citas', t.appointments.ok, t.appointments.fail],
        ['Presupuestos', t.treatmentPlans.ok, t.treatmentPlans.fail],
        ['Evoluciones', t.evolutions.ok, t.evolutions.fail],
        ['Abonos y movimientos de cartola', t.ledger.ok, t.ledger.fail],
        ['Observaciones', t.observations.ok, t.observations.fail],
        ['Documentos clínicos', t.documents.ok, t.documents.fail],
      ],
      [50, 25, 25]
    )
  );

  children.push(heading('Credenciales de acceso'));
  children.push(
    para(
      `Todos los usuarios creados hoy usan la misma contraseña: ${password}`,
      { bold: true }
    )
  );
  children.push(para('Los correos son ficticios (dominio inexistente); sirven solo como nombre de usuario para entrar a la web.', { color: '5F6F7D' }));

  for (const clinic of plan.clinics) {
    const res = summary.clinics.find((c) => c.key === clinic.key);
    children.push(heading(`${clinic.name}`, HeadingLevel.HEADING_3));
    children.push(
      table(
        ['Dato', 'Valor'],
        [
          ['RUT', clinic.rut || ''],
          ['Tipo', clinic.tipo],
          ['ID en DentalCloud', clinic.id || 'no creado'],
          ['Federada a Dental-Demo', clinic.federated ? 'Sí' : 'No'],
          ['Pacientes ingresados', `${res?.counts.patients.ok ?? 0} de ${clinic.patients?.length ?? 0}`],
          ['Citas / Presupuestos / Evoluciones', `${res?.counts.appointments.ok ?? 0} / ${res?.counts.treatmentPlans.ok ?? 0} / ${res?.counts.evolutions.ok ?? 0}`],
          ['Estado', res?.status || ''],
        ],
        [35, 65]
      )
    );
    const userRows = [
      [clinic.admin.name, 'Administrador (inicial)', clinic.admin.email, password, clinic.id ? 'sí' : 'no'],
      ...(clinic.users || []).map((u) => [u.name, ROLE_LABELS[u.role] || u.role, u.email, password, u.done ? 'sí' : 'no']),
    ];
    children.push(new Paragraph({ spacing: { before: 80 } }));
    children.push(table(['Usuario', 'Rol', 'Correo (usuario)', 'Contraseña', 'Creado'], userRows, [26, 16, 32, 16, 10]));
  }

  const errors = summary.clinics.flatMap((c) => c.errors.map((e) => ({ clinic: c.name, ...e })));
  children.push(heading(`Errores (${errors.length})`));
  if (!errors.length) children.push(para('Sin errores.'));
  for (const e of errors.slice(0, 40)) children.push(para(`• ${e.clinic} · ${e.entity} · ${e.ref || ''}: ${e.message}`));
  if (errors.length > 40) children.push(para(`… y ${errors.length - 40} más (ver reports/${summary.runId}/report.md).`));

  const doc = new Document({
    creator: 'dental-carga-diaria',
    title: `Carga diaria ${summary.date}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children }],
  });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
  log?.info(`Informe Word escrito en ${filePath}`);
  return filePath;
}
