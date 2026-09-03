# Contrato de datos: plan diario

Todos los módulos del proyecto consumen o producen este objeto. El generador
(`src/data/generator.js`) lo crea; los flujos de Playwright (`src/pages/*.js`,
`src/flows/*.js`) lo leen y lo enriquecen con los IDs que devuelve la web.

Reglas generales:

- Todo se carga **por la interfaz web**. Ningún módulo llama a la API ni a la base de datos.
- Los módulos de `src/pages` exportan funciones `async (page, datos, ctx)` y devuelven lo
  que la web muestra (por ejemplo, el ID de la URL). No hacen `console.log`: usan `ctx.log`.
- Localizadores: preferir `page.getByLabel`, `getByRole`, `getByPlaceholder`, `#id`.
  Los formularios de DentalCloud usan `<label htmlFor>` + `id`, y los switches son
  `role="switch"` con `aria-label` exacto.
- Textos en español de Chile. Correos siempre con `config.emailDomain`.
- Nada se borra ni se edita fuera de lo que este proceso creó.

## Estructura

```jsonc
{
  "runId": "2026-09-04_0830",
  "date": "2026-09-04",
  "clinics": [
    {
      "key": "C01",                          // clave interna del día (C01..C10)
      "name": "Demo Clínica Los Aromos",     // SIEMPRE empieza con config.clinicPrefix + " "
      "rut": "76.412.930-5",                 // empresa, único global (registro usedRuts)
      "tipo": "dental",                      // "dental" | "estetica" | "ambas"
      "pais": "Chile",
      "logoPath": "assets/generated/logo-C01.png",
      "id": null,                            // lo llena superadmin.createHolding (ID de la URL)
      "federated": false,                    // lo marca superadmin.configureFederation

      "admin": { "name": "Carolina Pérez Soto", "email": "admin.losaromos.0904@demo-fordent.invalid", "rut": "12.345.678-5" },
      // La contraseña de TODOS los usuarios creados es config.defaultUserPassword(). No va en el plan.

      "users": [
        { "key": "U1", "name": "Dr. Matías Rojas Fuentes", "email": "...", "role": "odontologo", "rut": "15.223.114-9", "signature": true },
        { "key": "U2", "name": "Dra. Fernanda Lagos Mena", "email": "...", "role": "odontologo", "rut": "...", "signature": true },
        { "key": "U3", "name": "Javiera Muñoz Díaz", "email": "...", "role": "operador", "rut": "...", "signature": false }
        // roles válidos en la web: "odontologo" | "radiologo" | "operador" | "admin"
      ],
      "schedules": [
        { "userKey": "U1", "weekday": 1, "start": "09:00", "end": "13:00", "chairNumber": 1 }
        // weekday: 0=Domingo..6=Sábado (igual al select de la web). chairNumber null = "Cualquiera".
      ],
      "chairs": [ { "number": 1, "name": "Box 1" }, { "number": 2, "name": "Box 2" } ],
      "sucursales": [ { "name": "Casa Matriz Providencia", "address": "Av. Providencia 1234, Providencia" } ],
      "previsiones": [ { "name": "Fonasa" }, { "name": "Isapre Banmédica" }, { "name": "Particular" } ],
      "convenios": [ { "name": "Convenio Colegio de Profesores", "discountPercent": 15 } ],
      "prestaciones": [
        { "code": "EX-01", "name": "Examen y diagnóstico", "price": 25000, "category": "dental", "odontogramMode": "session" }
        // odontogramMode: "session" | "tooth" | "surface" | "extraction" | "cuadrante" | "sextante" | "arcada"
        // category: "dental" | "estetica" (solo se pregunta en la web si tipo === "ambas")
      ],

      "patients": [
        {
          "key": "P001",
          "userKey": "U1",                       // odontólogo tratante: registra el motivo de consulta y firma sus presupuestos/evoluciones
          "rut": "17.845.221-3",                 // persona, único dentro de la clínica y en usedRuts
          "firstName": "Antonia", "lastName": "Riquelme Vega",
          "phoneLocal": "9 6123 4567",           // la web antepone +56 (se elige Chile en el selector)
          "birthDate": "1991-04-17",             // YYYY-MM-DD
          "email": "antonia.riquelme.0904@demo-fordent.invalid",
          "address": "Los Alerces 452, Ñuñoa, Santiago",
          "gender": "femenino",                  // "" | "femenino" | "masculino" | "otro"
          "maritalStatus": "casado",             // "" | "soltero" | "casado" | "conviviente_civil" | "divorciado" | "viudo"
          "nationality": "Chilena",
          "occupation": "Profesora",
          "healthInsurance": "isapre",           // "" | "fonasa" | "isapre" | "particular" | "otro"
          "healthInsuranceDetail": "Banmédica Plan 500",
          "emergencyContactName": "Rodrigo Riquelme",
          "emergencyContactPhone": "+56 9 8123 4567",
          "emergencyContactRelationship": "Hermano",
          "heightCm": 165, "weightKg": 61.5,
          "bloodType": "O+",                     // "" | A+ A- B+ B- AB+ AB- O+ O-
          "allergies": ["penicilina", "latex"],  // claves: fluoruro, penicilina, anestesicos_locales, latex, yodo, niquel_metales, aines, sulfitos, otro
          "allergyNotes": "Urticaria con amoxicilina (2019).",
          "medicalConditions": "Hipertensión controlada.",
          "currentMedications": "Losartán 50 mg diario.",
          "chronicDiseases": "Hipertensión arterial.",
          "dentalHistory": "Endodoncia pieza 36 (2021). Ortodoncia en adolescencia.",
          "tags": ["ortodoncia", "control semestral"],
          "motivoConsulta": "Paciente refiere dolor al masticar en molar inferior derecho desde hace dos semanas.",
          "photoPath": "assets/generated/avatar-C01-P001.png",   // o null (≈ 3 de cada 4 sin foto)
          "id": null                             // lo llena pacientes.createPatient (ID de la URL /pacientes/:id)
        }
      ],

      "appointments": [
        { "patientKey": "P001", "userKey": "U1", "chairNumber": 1, "date": "2026-09-05", "time": "10:00", "durationMin": 30, "notes": "Control y destartraje", "type": "cita" }
        // type: "cita" | "control". Fechas entre -10 y +20 días desde hoy. Sin choques: mismo sillón/hora no se repite.
      ],
      "treatmentPlans": [
        { "patientKey": "P001", "userKey": "U1", "sucursalName": "Casa Matriz Providencia", "previsionName": "Isapre Banmédica",
          "convenioName": "Particular", "paymentMethod": "Contado", "name": "Rehabilitación inferior derecha", "observations": "Iniciar por cuadrante inferior derecho.",
          "items": [ { "prestacionCode": "OB-01", "teeth": [46], "surfaces": ["O"], "notes": "" },
                     { "prestacionCode": "PE-01", "quadrants": [1], "notes": "" } ] }
        // Zonas según odontogramMode de la prestación: tooth/extraction → teeth[1]; surface → teeth[1] + surfaces;
        // cuadrante → quadrants[1..8]; sextante → sextants[1..6]; arcada → arches["superior"|"inferior"]; session → nada.
        // convenioName SIEMPRE presente (la web lo exige). paymentMethod SOLO "Contado" | "Cuotas" (enumeración distinta a la de cartola).
        // Solo clínicas tipo "dental" o "ambas" (odontograma); las "estetica" no llevan presupuestos. items[].discountPercent no se usa (la web aplica el del convenio).
        // Tras crearlo, tratamientos.createTreatmentPlan guarda el número visible en plan.number.
      ],
      "evolutions": [
        { "patientKey": "P001", "userKey": "U1", "text": "Se realiza destartraje supragingival completo. Sin complicaciones. Se indica control en 6 meses." }
      ],
      "ledger": [
        { "patientKey": "P001", "type": "abono", "amount": 45000, "paymentMethod": "Transferencia", "docNumber": "TRX-88213", "description": "Abono presupuesto inicial", "notes": "" }
        // type: "abono" | "interes" | "ajuste" (ajuste lleva direction "debe"|"haber"). paymentMethod: Efectivo | Transferencia | Tarjeta | Cheque | Otro
      ],
      "observations": [ { "patientKey": "P001", "text": "Paciente solicita recordatorio por WhatsApp el día anterior." } ],
      "documents": [
        { "patientKey": "P001", "category": "receta", "description": "Receta amoxicilina 500 mg", "filePath": "assets/generated/doc-C01-P001-receta.pdf" }
        // category: receta | derivacion | imagen | archivo | alta | solicitud_laboratorio | documento_pabellon | solicitud_pabellon
      ]
    }
  ]
}
```

## Contexto (`ctx`) que reciben los flujos

```js
ctx = {
  runId,          // identificador de la corrida (nombre de la carpeta en reports/)
  log,            // logger con info/warn/error/step
  config,         // src/config.js
  clinic,         // la clínica del plan que se está poblando
  counts,         // { entidad: { ok, fail } } de esta clínica (report.js#emptyCounts)
  errors,         // [{ entity, ref, message }] de esta clínica
  savePlan(),     // persiste el plan (ids, done) en reports/<runId>/plan.json
  shouldStop(),   // true cuando se alcanzó la hora límite
  deadlineHit,    // los flujos lo ponen en true si tuvieron que cortar
  resolveUser(key)    // -> objeto user del plan ("admin" devuelve clinic.admin)
  resolvePatient(key) // -> objeto patient del plan (con id si ya fue creado)
  resolveChair(number)// -> objeto chair
}
```

Campos opcionales que los flujos entienden aunque el generador no los produzca:
`treatmentPlans[].name`, `evolutions[].planNumber` / `.itemDescription`, `ledger[].planNumber`,
`observations[].userKey`. `admin.rut` solo se usa para reservar unicidad: el formulario
"Crear holding" no pide RUT del administrador.

```
```

## Orden obligatorio de creación (dependencias)

1. Superadmin: crear holding → abrir detalle → federación ON (y "Solo catálogo" OFF, conexiones individuales ON) → módulos ON.
2. Admin de la clínica: sillones → sucursales → previsiones → convenios → prestaciones → profesionales (con firma) → horarios.
3. Operador: pacientes (ficha completa + foto) → motivo de consulta → citas.
4. Odontólogo: presupuestos (necesitan prestaciones, sucursal, previsión) → evoluciones.
5. Admin u operador: abonos en cartola (pueden asociarse a presupuesto) → observaciones → documentos.
