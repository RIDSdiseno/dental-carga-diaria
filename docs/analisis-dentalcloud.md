# Análisis técnico exhaustivo — Plataforma DentalCloud (fordentcloud)

> Fecha del análisis: 2026-09-03
> Repos analizados:
> - Frontend: `C:\Users\User\OneDrive - rids.cl\Escritorio\dentalcloud-front` (React 19 + TypeScript + Vite 8 + Tailwind 4 + React Router 7 + axios)
> - Backend: `C:\Users\User\OneDrive - rids.cl\Escritorio\dentalcloud-backend` (Node + Express 5 + TypeScript + Prisma 6 / PostgreSQL)
>
> Objetivo: inventariar **toda** la información que la aplicación permite registrar/almacenar, cómo se captura (formularios), cómo viaja (API) y dónde se guarda (modelo de datos), identificando los "datos sueltos" (brechas entre modelo, API y UI).

---

## 0. Resumen ejecutivo y arquitectura

| Aspecto | Detalle |
|---|---|
| Nombre comercial | "fordentcloud" (en login, correos, PDF) / "DentalCloud" (sidebar, carpetas Cloudinary) |
| Multi‑tenant | Sí. Entidad raíz `Clinica` (llamada **"Holding"** en la UI de super‑admin). Casi todas las tablas tienen `clinicaId`. |
| Tipos de clínica | `dental`, `estetica`, `ambas` — cambia tema visual (azul/rosado), catálogo (odontograma vs. mapa facial) y pestañas. |
| Roles | `super_admin` (plataforma), `admin` (clínica), `odontologo`, `radiologo`, `operador`. |
| Autenticación | JWT access token (Bearer, en memoria del front) + refresh token en cookie httpOnly (`/api/auth`, 7 días). bcrypt para contraseñas. |
| Autorización | 3 capas: (1) `Clinica.modules` (plan de la clínica, 8 módulos) + `Clinica.rxEnabled`; (2) `Clinica.rolePermissions` (matriz por perfil odontologo/radiologo/operador, 10 llaves); (3) `User.permissionOverrides` / `User.moduleOverrides` (excepciones por usuario). `admin` y `super_admin` siempre tienen acceso total. |
| Almacenamiento de archivos | Cloudinary (fotos paciente, logos, firmas, fotos de procedimientos/evoluciones/plantillas, documentos clínicos, PDFs de consentimiento, audio motivo de consulta). |
| Correo | Microsoft Graph (client credentials) — confirmación de cita, envío de consentimiento, PDF de consentimiento firmado, cartola/recordatorio de deuda. |
| PDF/DOCX | pdfkit (consentimiento, cartola, informe de presupuesto) y librería `docx` (informe de presupuesto). |
| Integraciones externas | **RIDS RX / DIMAGE** (órdenes radiológicas, API v3 con X-API-KEY), **S3/MinIO de RIDS RX** (archivos DICOM para visor 3D Med3Web embebido en `/public/visor3d`), **Dental-Demo-Back** (federación bidireccional, X-API-KEY). |
| Despliegue | Front en Netlify (`netlify.toml` con redirect SPA), backend en Railway (comentarios en código; `trust proxy`). |
| Base de datos | PostgreSQL vía Prisma. 61 migraciones (2026‑07‑01 → 2026‑08‑28). |

### Estructura de carpetas relevante

**Backend** (`src/`)
- `index.ts` — Express, CORS (`FRONTEND_ORIGIN` lista separada por comas), cookie-parser, montaje de 21 routers, `startFederationRetryLoop()`.
- `routes/*.ts` (21 archivos) y `controllers/*.ts` (18 archivos).
- `middleware/`: `authenticate`, `requireAdmin`, `requireSuperAdmin`, `requireFederationOrSuperAdmin`, `requireModuleEnabled`, `requireRolePermission`, `requireRxEnabled`.
- `lib/`: `prisma`, `cloudinary`, `cloudinaryUpload`, `mailer` (MS Graph), `emailTemplates/*`, `consentPdf`, `consentText`, `consentTypes`, `cartolaPdf`, `treatmentPlanReportData/Pdf/Docx`, `dimageClient`, `dimageExamGroups`, `dimagePatientSync`, `dimageProfessionalSync`, `ridsRxStorage` (S3), `federationClient`, `federationSync`, `federationRetry`, `clinicaModules`, `rolePermissions`, `userAccessOverrides`, `allergies`, `odontogramMode`, `treatmentPlanLifecycle`, `privacyConsentSummary`.
- `utils/`: `rut` (validación/formato RUT chileno), `tokens` (JWT), `appointmentStatus`, `treatmentStatus`.
- `prisma/schema.prisma`, `prisma/seed.ts`, `prisma/seedEstetica.ts`, 61 migraciones.
- `assets/` — imágenes JPEG de rostro/músculos (no referenciadas por el código del backend; parecen fuentes del mapa facial que hoy vive en `front/public/facial-map`).

**Frontend** (`src/`)
- `App.tsx` (rutas), `main.tsx`, `context/AuthContext.tsx`, `api/*.ts` (18 clientes axios), `components/` (Modal, ReasonModal, RichTextEditor, SignaturePad, CountrySelect, guards de ruta, layout), `pages/` (agenda, pacientes, catalogo, profesionales, superadmin, consentimiento público, Login, Dashboard, ComingSoon), `data/` (allergies, countries), `utils/` (roles, rut, treatmentStatus), `theme.ts`.
- `public/visor3d/` — build estático de Med3Web (visor DICOM 3D). `public/facial-map/*.jpg` — fotos base del mapa facial (hombre/mujer, frontal y perfiles, capas piel/músculo).

---

## 1. Modelo de datos completo (`prisma/schema.prisma`)

> Convenciones: `PK` = clave primaria; `?` = opcional (nullable); `@unique` = único; `@default` = valor por defecto; `Json` = columna JSON de PostgreSQL. **No existen enums de Prisma**: todos los "estados" son `String` validados en los controladores (ver §1.20 con todos los valores permitidos).

### 1.1 `Clinica` (tabla `clinicas`) — Holding / clínica (tenant raíz)

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| name | String | no | — | Nombre del holding |
| active | Boolean | no | true | Si es false, sus usuarios no pueden iniciar sesión |
| createdAt | DateTime | no | now() | |
| rxEnabled | Boolean | no | true | Habilita módulo Rx (RIDS RX) |
| modules | Json | no | `{"cartola":true,"evoluciones":true,"observaciones":true,"documentosClinicos":true}` | Plan de módulos. `parseClinicaModules` rellena las 8 llaves (`pacientes, documentosClinicos, cartola, evoluciones, observaciones, agenda, tratamientos, consentimientos`) con `true` si faltan |
| tipo | String | no | "dental" | `dental` \| `estetica` \| `ambas` |
| logoUrl | String | sí | — | URL Cloudinary del logo |
| logoPublicId | String | sí | — | public_id Cloudinary |
| rut | String | sí | — | `@unique`. RUT del holding (limpio, sin puntos/guion) |
| rolePermissions | Json | no | `{}` | Matriz `{odontologo|radiologo|operador: {permKey: bool}}` (ver §1.20) |
| pais | String | no | "Chile" | Lista fija de 13 países (ver §1.20) |
| slotDurationMinutes | Int | no | 15 | Duración de bloque de agenda: 15 \| 30 \| 60 |
| federatedClinicId | String | sí | — | `@unique`. Id de la Clinic espejo en Dental-Demo-Back. Null = clínica local sin par |
| federationCatalogOnly | Boolean | no | false | Si true, solo se sincroniza catálogo (convenios/prestaciones/previsiones), nunca pacientes/citas/presupuestos/usuarios/sucursales |
| federationPaused | Boolean | no | false | Pausa manual de la sincronización sin perder emparejamiento |
| federationSyncSettings | Json | no | `{}` | Switches por tipo: `patients, appointments, treatmentPlans, users, sucursales, catalog` (ausente = true) |

Relaciones (1‑N): administrativeObservations, appointments, chairs, clinicalDocuments, consentTypes, consents, convenios, evolutionTemplates, evolutions, evolutionPhotos, evolutionDeletions, ledgerMovements, patients, prestaciones, previsiones, sucursales, treatmentItemPhotos, treatmentItems, treatmentPlanEdits, treatmentPlanPhotos, treatmentPlans, users, workSchedules.

### 1.2 `User` (tabla `users`) — Usuarios / profesionales

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| email | String | no | — | `@unique` global (entre todas las clínicas). Se guarda en minúsculas |
| passwordHash | String | no | — | bcrypt (10 rounds). Nunca se expone |
| name | String | no | — | |
| role | String | no | "odontologo" | `admin` \| `odontologo` \| `radiologo` \| `operador` \| `super_admin` (este último solo por seed/DB; no se crea desde la API) |
| createdAt | DateTime | no | now() | |
| updatedAt | DateTime | no | @updatedAt | |
| rut | String | sí | — | RUT limpio. Necesario para sincronizar con RIDS RX |
| clinicaId | String | sí | — | FK → Clinica. Null solo para `super_admin` (o usuarios legacy) |
| permissionOverrides | Json | sí | — | Excepciones `{permKey: bool}` sobre `Clinica.rolePermissions[role]`. Solo llaves explícitas |
| moduleOverrides | Json | sí | — | Excepciones `{moduleKey: bool}` sobre `Clinica.modules` (aplica incluso a admin) |
| signatureUrl | String | sí | — | Firma del profesional (PNG en Cloudinary, carpeta `dentalcloud/{clinicaId}/firmas-profesionales`) |
| signaturePublicId | String | sí | — | |
| federatedUserId | String | sí | — | `@unique`. Id del User espejo en Dental-Demo-Back |

Índice: `@@index([clinicaId])`. Relaciones: administrativeObservations, appointments (como profesional), appointmentsReceived (recibió urgencia), clinicalDocuments (subidos), consentsSent, evolutions, evolutionDeletions, ledgerMovements (registró), treatmentItemsTreatedBy, treatmentPlanEdits, treatmentPlansCompletedBy, treatmentPlansCreatedBy, treatmentPlansCreatedByLegacy, treatmentPlans (profesional a cargo), treatmentPlansStartedBy, workSchedules.

### 1.3 `Chair` (tabla `chairs`) — Sillones / boxes

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| number | Int | no | — | Entero positivo. `@@unique([clinicaId, number])` |
| name | String | sí | — | Nombre libre ("Box 1"). Si es null la UI muestra "Sillón {number}" |
| active | Boolean | no | true | |
| createdAt | DateTime | no | now() | |
| clinicaId | String | no | — | FK → Clinica |

Relaciones: appointments, workSchedules.

### 1.4 `Patient` (tabla `patients`) — Ficha de paciente

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| rut | String | no | — | RUT limpio (dígitos + K). `@@unique([clinicaId, rut])`. Validado con módulo 11 |
| firstName | String | no | — | |
| lastName | String | no | — | |
| phone | String | sí | — | Se guarda como "+56 9 1234 5678" (código país + número) |
| email | String | sí | — | Necesario para enviar consentimientos/cartola/confirmación de cita |
| birthDate | DateTime | sí | — | Solo fecha |
| address | String | sí | — | |
| gender | String | sí | — | `femenino` \| `masculino` \| `otro` (o vacío) |
| nationality | String | sí | — | Texto libre |
| maritalStatus | String | sí | — | `soltero` \| `casado` \| `conviviente_civil` \| `divorciado` \| `viudo` |
| occupation | String | sí | — | Texto libre |
| emergencyContactName | String | sí | — | |
| emergencyContactPhone | String | sí | — | Texto libre (sin selector de país) |
| emergencyContactRelationship | String | sí | — | |
| healthInsurance | String | sí | — | `fonasa` \| `isapre` \| `particular` \| `otro` (previsión informativa del paciente; distinto del catálogo `Prevision` usado en presupuestos) |
| healthInsuranceDetail | String | sí | — | Plan / póliza |
| bloodType | String | sí | — | `A+ A- B+ B- AB+ AB- O+ O-` |
| tags | String[] | no | [] | Etiquetas libres, máx. 20, sin duplicados, recortadas |
| photoUrl | String | sí | — | Foto del paciente (Cloudinary `dentalcloud/patients/photos`) |
| photoPublicId | String | sí | — | |
| motivoConsulta | String | sí | — | Texto libre — debe completarlo el profesional |
| motivoConsultaAudioUrl | String | sí | — | Grabación de voz (webm subida como `video` a Cloudinary `dentalcloud/patients/motivo-consulta-audio`). Requiere consentimiento `grabacion_voz` firmado |
| motivoConsultaAudioPublicId | String | sí | — | |
| createdAt | DateTime | no | now() | |
| updatedAt | DateTime | no | @updatedAt | |
| clinicaId | String | no | — | FK → Clinica |
| federatedPatientId | String | sí | — | `@unique`. Id del Patient espejo en Dental-Demo-Back |
| allergies | String[] | no | [] | Solo llaves del vocabulario `ALLERGY_KEYS` (ver §1.20); las demás se descartan |
| allergyNotes | String | sí | — | Detalle libre de alergias |
| currentMedications | String | sí | — | |
| heightCm | Int | sí | — | Redondeado |
| medicalConditions | String | sí | — | |
| weightKg | Float | sí | — | |
| chronicDiseases | String | sí | — | |
| dentalHistory | String | sí | — | |

Relaciones: administrativeObservations, appointments, clinicalDocuments, consents, evolutions, evolutionDeletions, ledgerMovements, treatmentPlans.

> Nota: el "estado del consentimiento de protección de datos" (`privacyConsentStatus`, `privacyConsentMethod`, `privacyConsentSentAt`, `privacyConsentExpiresAt`, `privacyConsentAt`, `privacyConsentSignerName`, `privacyConsentSignerRut`) que devuelve la API **no es columna de Patient**: se deriva en tiempo de lectura desde `Consent` con `consentType.code = 'proteccion_datos'` (`lib/privacyConsentSummary.ts`).

### 1.5 `ConsentType` (tabla `consent_types`) — Tipos de consentimiento (por clínica)

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| code | String | no | — | Clave de negocio estable. `@@unique([clinicaId, code])` |
| name | String | no | — | |
| legalText | String | no | — | Texto legal (placeholder en 12 de 13 tipos) |
| active | Boolean | no | true | |
| createdAt | DateTime | no | now() | |
| clinicaId | String | no | — | FK → Clinica |
| pdfPublicId | String | sí | — | PDF propio de la clínica (Cloudinary `raw`, carpeta `dentalcloud/{clinicaId}/consentimientos-tipos`) — reemplaza el texto legal |
| pdfUrl | String | sí | — | |

Se auto‑siembran 13 tipos por clínica en cada `GET /data-consents/types` (`ensureDefaultConsentTypes`): `proteccion_datos`, `tratamiento_general`, `anestesia`, `cirugia_procedimiento_invasivo`, `endodoncia`, `protesis`, `ortodoncia`, `implantes`, `blanqueamiento`, `uso_imagenes`, `sedacion`, `autorizacion_representante_menor`, `grabacion_voz`.

### 1.6 `Consent` (tabla `consents`) — Consentimiento de un paciente para un tipo

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| patientId | String | no | — | FK → Patient. `@@unique([patientId, consentTypeId])` (uno por tipo por paciente) |
| consentTypeId | String | no | — | FK → ConsentType |
| status | String | no | "pendiente" | `pendiente` \| `firmado` \| `rechazado` \| `expirado` |
| method | String | sí | — | `email` \| `presencial` |
| token | String | sí | — | `@unique`. 32 bytes hex para link público (`/consentimiento/:token`) |
| sentAt | DateTime | sí | — | |
| expiresAt | DateTime | sí | — | sentAt + 7 días |
| respondedAt | DateTime | sí | — | |
| signerName | String | sí | — | Nombre del firmante |
| signerRut | String | sí | — | RUT limpio del firmante (validado) |
| signerIp | String | sí | — | `req.ip` (trust proxy) |
| userAgent | String | sí | — | User-Agent del navegador |
| sentById | String | sí | — | FK → User que envió |
| contentSnapshot | String | sí | — | Copia del `legalText` al momento de enviar/firmar |
| clinicaId | String | no | — | FK → Clinica. `@@index` |
| createdAt | DateTime | no | now() | |
| updatedAt | DateTime | no | @updatedAt | |
| pdfSnapshotUrl | String | sí | — | Copia congelada del PDF del tipo (Cloudinary `dentalcloud/{clinicaId}/consentimientos-firmados`) |
| signaturePublicId | String | sí | — | Firma dibujada (PNG, `dentalcloud/{clinicaId}/firmas-consentimientos`) |
| signatureUrl | String | sí | — | Obligatoria al aceptar (`firmado`), nunca al rechazar |

### 1.7 `TreatmentPlan` (tabla `treatment_plans`) — Presupuesto / plan de tratamiento

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| number | Int | no | autoincrement() | `@unique`. Correlativo global (no por clínica) |
| patientId | String | no | — | FK → Patient |
| professionalId | String | sí | — | FK → User "profesional a cargo / diagnosticador" |
| status | String | no | "sin_iniciar" | `sin_iniciar` \| `en_tratamiento` \| `terminado` \| `alta`. Se recalcula desde ítems salvo `alta` (terminal, congela el plan) |
| amount | Int | no | 0 | Suma de `items.cost` (CLP enteros) |
| notes | String | sí | — | Observaciones generales |
| createdAt | DateTime | no | now() | |
| updatedAt | DateTime | no | @updatedAt | |
| convenioId | String | sí | — | FK → Convenio (obligatorio en UI) |
| name | String | sí | — | Nombre del presupuesto |
| paymentMethod | String | sí | — | UI: `Contado` \| `Cuotas` (texto libre en API) |
| previsionId | String | sí | — | FK → Prevision |
| sucursalId | String | sí | — | FK → Sucursal (obligatorio en UI, "Clínica") |
| clinicaId | String | no | — | FK → Clinica. `@@index` |
| diagramType | String | no | "dental" | `dental` (odontograma) \| `estetica` (mapa facial). Derivado de `Clinica.tipo`; elegible solo si tipo = `ambas` |
| createdById | String | sí | — | FK → User que creó el registro (usuario logueado) |
| facialAnnotations | Json | sí | — | Trazos a mano alzada del mapa facial: `{frontal: Stroke[], perfilDerecho: Stroke[], perfilIzquierdo: Stroke[]}`; Stroke = `{id, tool:'lapiz', points:[{x,y}]}` \| `{id, tool:'linea', from, to}` \| `{id, tool:'circulo', center, radius}`. Solo si diagramType = estetica |
| facialGender | String | sí | — | `hombre` \| `mujer` (foto base del mapa facial) |
| createdByUserId | String | sí | — | FK → User (legacy, mismo valor que createdById) |
| startedByUserId | String | sí | — | FK → User que lo pasó a `en_tratamiento` (se estampa una sola vez) |
| startedAt | DateTime | sí | — | |
| completedByUserId | String | sí | — | FK → User que lo dejó en `terminado` (una sola vez) |
| completedAt | DateTime | sí | — | |
| federatedTreatmentPlanId | String | sí | — | `@unique`. Espejo en Dental-Demo-Back |
| remoteProfessionalName | String | sí | — | Nombre informativo del profesional cuando el plan nació en Dental-Demo-Back |

Relaciones: ledgerMovements, items (TreatmentItem, cascade), photos (TreatmentPlanPhoto, cascade), edits (TreatmentPlanEdit, cascade), clinica, completedBy, convenio, createdBy, createdByLegacy, patient, prevision, professional, startedBy, sucursal.

### 1.8 `TreatmentPlanPhoto` (tabla `treatment_plan_photos`) — Plantilla fotográfica del presupuesto (estética)

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| treatmentPlanId | String | no | — | FK → TreatmentPlan (onDelete Cascade). `@@index` |
| url | String | no | — | Cloudinary `dentalcloud/{clinicaId}/treatment-plans/{planId}` |
| publicId | String | no | — | |
| label | String | sí | — | UI genera "`{Zona facial}` — `Antes|Después`" |
| position | Int | no | 0 | Orden (count al subir) |
| createdAt | DateTime | no | now() | |
| clinicaId | String | no | — | FK → Clinica. `@@index` |

### 1.9 `TreatmentPlanEdit` (tabla `treatment_plan_edits`) — Auditoría de modificaciones a presupuesto "en tratamiento"

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| treatmentPlanId | String | no | — | FK (Cascade). `@@index` |
| reason | String | no | — | Motivo obligatorio |
| userId | String | no | — | FK → User |
| createdAt | DateTime | no | now() | |
| clinicaId | String | no | — | `@@index` |

### 1.10 `TreatmentItem` (tabla `treatment_items`) — Procedimiento / prestación dentro del presupuesto

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| treatmentPlanId | String | no | — | FK (Cascade). `@@index` |
| description | String | no | — | Nombre de la prestación o texto libre |
| cost | Int | no | 0 | Precio final (con descuento de convenio) |
| completed | Boolean | no | false | Marcado a mano (checkbox) o al evolucionar |
| createdAt | DateTime | no | now() | Se escalona +1ms por índice para conservar orden |
| convenioDiscountPercent | Int | no | 0 | |
| listPrice | Int | no | 0 | Precio de lista (antes de descuento) |
| prestacionId | String | sí | — | FK → Prestacion (null = fuera de catálogo) |
| toothNumber | String | sí | — | Texto formateado: piezas ("Piezas: 1.6 y 2.6"), caras ("1.6: Vestibular, Oclusal"), zona ("Cuadrante 1", "Arcada superior"), "Sesión", o zonas faciales ("Frente, Mentón" / "Todo el rostro") |
| clinicaId | String | no | — | `@@index` |
| notes | String | sí | — | Nota clínica del procedimiento |
| productName | String | sí | — | Trazabilidad de producto (ej. Ácido Hialurónico) |
| productLot | String | sí | — | N° de lote (desde inventario de Dental-Demo-Back si la prestación exige trazabilidad) |
| productExpiresAt | DateTime | sí | — | Vencimiento del producto |
| productQuantity | String | sí | — | Cantidad aplicada (texto libre "1 jeringa 1ml") |
| treatedAt | DateTime | sí | — | Cuando se marcó completado |
| federatedTreatmentItemId | String | sí | — | `@unique`. Espejo en Dental-Demo-Back |
| treatedById | String | sí | — | FK → User que lo marcó realizado |

Relaciones: photos (TreatmentItemPhoto, cascade), evolutions, prestacion, treatedBy, treatmentPlan.

### 1.11 `TreatmentItemPhoto` (tabla `treatment_item_photos`)

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| treatmentItemId | String | no | — | FK (Cascade). `@@index` |
| url | String | no | — | Cloudinary `dentalcloud/{clinicaId}/treatment-items/{itemId}` (o copia de EvolutionPhoto) |
| publicId | String | no | — | |
| label | String | sí | — | `Antes` \| `Después` \| `Sticker ficha` \| `Sticker paciente` |
| createdAt | DateTime | no | now() | |
| clinicaId | String | no | — | `@@index` |

### 1.12 `Sucursal` (tabla `sucursales`) — Sedes físicas ("Clínicas" en la UI del holding)

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| name | String | no | — | `@@unique([clinicaId, name])` |
| address | String | sí | — | |
| active | Boolean | no | true | |
| createdAt | DateTime | no | now() | |
| dimageClinicId | String | sí | — | Id de la clínica en RIDS RX (necesario para crear órdenes Rx) |
| clinicaId | String | no | — | FK → Clinica |
| federatedSucursalId | String | sí | — | `@unique`. Location espejo en Dental-Demo-Back |

Relación: treatmentPlans.

### 1.13 `Prevision` (tabla `previsiones`)

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| name | String | no | — | `@@unique([clinicaId, name])` |
| active | Boolean | no | true | |
| createdAt | DateTime | no | now() | |
| clinicaId | String | no | — | |
| federatedPrevisionId | String | sí | — | `@unique` |

### 1.14 `Convenio` (tabla `convenios`)

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| name | String | no | — | `@@unique([clinicaId, name])` |
| discountPercent | Int | no | 0 | 0–100 (clamp en backend) |
| active | Boolean | no | true | |
| createdAt | DateTime | no | now() | |
| clinicaId | String | no | — | |
| federatedConvenioId | String | sí | — | `@unique` |

### 1.15 `Prestacion` (tabla `prestaciones`) — Catálogo de prestaciones

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| code | String | sí | — | `@@unique([clinicaId, code])` |
| name | String | no | — | |
| basePrice | Int | no | 0 | ≥ 0 |
| active | Boolean | no | true | |
| category | String | no | "dental" | `dental` \| `estetica` |
| odontogramMode | String | no | "tooth" | `session` \| `tooth` \| `surface` \| `extraction` \| `cuadrante` \| `sextante` \| `arcada`. Se sugiere por palabras clave del nombre (`guessOdontogramMode`) |
| createdAt | DateTime | no | now() | |
| clinicaId | String | no | — | |
| allowedZones | String[] | no | [] | Zonas faciales permitidas (14 llaves, ver §1.20). Solo `estetica`; vacío = sin restricción |
| requiresProductTracking | Boolean | no | false | Exige producto/lote/vencimiento/cantidad al evolucionar y lote real del inventario al presupuestar |
| appliesToWholeFace | Boolean | no | false | Modo "sesión" del mapa facial; ignora `allowedZones` |
| zonesApplyTogether | Boolean | no | false | Con 2+ zonas: todas juntas (true) o menú a elegir (false) |
| zonePrices | Json | sí | — | `{[zona]: precio}`. Solo con 2+ zonas; se completa cada zona faltante con basePrice |
| federatedPrestacionId | String | sí | — | `@unique` |

Relación: items (TreatmentItem).

### 1.16 `Appointment` (tabla `appointments`) — Citas

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| chairId | String | no | — | FK → Chair. `@@index([chairId, startAt])` |
| patientId | String | no | — | FK → Patient |
| startAt | DateTime | no | — | |
| endAt | DateTime | no | — | > startAt. Sin solapamiento por sillón (salvo canceladas) |
| notes | String | sí | — | Motivo / notas |
| status | String | no | "agendada" | `agendada` → `llego` → `en_atencion` → `finalizada`; `cancelada` |
| createdAt | DateTime | no | now() | |
| updatedAt | DateTime | no | @updatedAt | |
| professionalId | String | sí | — | FK → User. `@@index([professionalId, startAt])` |
| type | String | no | "cita" | `cita` \| `control` \| `urgencia` |
| clinicaId | String | no | — | `@@index` |
| arrivedAt | DateTime | sí | — | Sellado en "Marcar llegada" |
| attentionStartedAt | DateTime | sí | — | Sellado en "Pasar a atención" |
| attentionEndedAt | DateTime | sí | — | Sellado en "Terminar cita" |
| motivoUrgencia | String | sí | — | Solo type = urgencia |
| triageLevel | String | sí | — | `leve` \| `moderada` \| `grave` |
| receivedByUserId | String | sí | — | FK → User que recibió la urgencia |
| federatedAppointmentId | String | sí | — | `@unique` |

### 1.17 `AdministrativeObservation` (tabla `administrative_observations`)

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| patientId | String | no | — | `@@index([patientId, createdAt])` |
| professionalId | String | no | — | FK → User autor |
| content | String | no | — | Texto plano |
| createdAt | DateTime | no | now() | |
| clinicaId | String | no | — | `@@index` |

### 1.18 `ClinicalDocument` (tabla `clinical_documents`)

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| patientId | String | no | — | `@@index([patientId, category, createdAt])` |
| uploadedById | String | no | — | FK → User |
| category | String | no | — | `receta` \| `derivacion` \| `imagen` \| `archivo` \| `alta` \| `solicitud_laboratorio` \| `documento_pabellon` \| `solicitud_pabellon` |
| fileName | String | no | — | Nombre original |
| fileUrl | String | no | — | Cloudinary `dentalcloud/{patientId}/{category}` (resource_type auto). Límite 20 MB |
| resourceType | String | no | — | `image` \| `video` \| `raw` (de Cloudinary) |
| publicId | String | no | — | |
| description | String | sí | — | |
| createdAt | DateTime | no | now() | |
| clinicaId | String | no | — | `@@index` |

### 1.19 `Evolution` (tabla `evolutions`) — Evoluciones clínicas

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| patientId | String | no | — | `@@index([patientId, createdAt])` |
| professionalId | String | no | — | FK → User autor |
| content | String | no | — | **HTML** (RichTextEditor: negrita, cursiva, subrayado, listas, alineación). Debe tener texto |
| enabled | Boolean | no | true | Habilitada / deshabilitada (soft‑hide) |
| createdAt | DateTime | no | now() | |
| updatedAt | DateTime | no | @updatedAt | |
| clinicaId | String | no | — | `@@index` |
| treatmentItemId | String | sí | — | FK → TreatmentItem que documenta. Al crear, marca el ítem `completed` y copia producto. `@@index` |
| productName | String | sí | — | Producto usado (obligatorio si prestación `requiresProductTracking`) |
| productLot | String | sí | — | |
| productExpiresAt | DateTime | sí | — | |
| productQuantity | String | sí | — | |

Relaciones: photos (EvolutionPhoto, cascade), treatmentItem, professional, patient, clinica.

### 1.19b `EvolutionPhoto` (tabla `evolution_photos`)

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| evolutionId | String | no | — | FK (Cascade). `@@index` |
| url | String | no | — | Cloudinary `dentalcloud/{clinicaId}/evolutions/{evolutionId}`. Se duplica en `TreatmentItemPhoto` si la evolución tiene `treatmentItemId` |
| publicId | String | no | — | |
| label | String | sí | — | `Antes` \| `Después` \| `Sticker ficha` \| `Sticker paciente` |
| createdAt | DateTime | no | now() | |
| clinicaId | String | no | — | `@@index` |

### 1.19c `EvolutionDeletion` (tabla `evolution_deletions`) — Auditoría de borrado

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| evolutionId | String | no | — | Id de la evolución borrada (sin FK) |
| patientId | String | no | — | FK → Patient. `@@index` |
| professionalId | String | no | — | Autor original (sin FK) |
| content | String | no | — | Copia del HTML borrado |
| reason | String | no | — | Motivo obligatorio |
| deletedByUserId | String | no | — | FK → User |
| clinicaId | String | no | — | `@@index` |
| createdAt | DateTime | no | now() | |

### 1.19d `EvolutionTemplate` (tabla `evolution_templates`) — Plantillas de evolución

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| name | String | no | — | |
| section | String | sí | — | Agrupador ("Control", "Diagnóstico", "Alta") |
| content | String | no | — | HTML |
| active | Boolean | no | true | |
| createdAt | DateTime | no | now() | |
| clinicaId | String | no | — | `@@index` |

### 1.19e `LedgerMovement` (tabla `ledger_movements`) — Cartola (movimientos contables)

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| number | Int | no | autoincrement() | `@unique`. N° de movimiento global |
| patientId | String | no | — | `@@index([patientId, createdAt])` |
| treatmentPlanId | String | sí | — | FK → TreatmentPlan (null = abono libre) |
| type | String | no | — | `abono` (haber) \| `interes` (debe) \| `ajuste` (debe o haber) |
| debe | Int | no | 0 | |
| haber | Int | no | 0 | |
| description | String | sí | — | "Glosa" |
| paymentMethod | String | sí | — | UI: `Efectivo` \| `Transferencia` \| `Tarjeta` \| `Cheque` \| `Otro` (solo abonos) |
| documentNumber | String | sí | — | N° documento (solo abonos) |
| notes | String | sí | — | Observación |
| registeredById | String | no | — | FK → User |
| createdAt | DateTime | no | now() | |
| clinicaId | String | no | — | `@@index` |

> El "cargo" del presupuesto no es un movimiento: la cartola lo compone en tiempo de lectura (`TreatmentPlan.amount` como debe).

### 1.19f `WorkSchedule` (tabla `work_schedules`) — Horarios de profesionales

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| professionalId | String | no | — | FK → User. `@@index([professionalId, weekday])` |
| chairId | String | sí | — | FK → Chair (null = cualquiera) |
| weekday | Int | no | — | 0 (Domingo) – 6 (Sábado) |
| startTime | String | no | — | "HH:MM" |
| endTime | String | no | — | "HH:MM" > startTime; sin solapes por profesional/día |
| createdAt | DateTime | no | now() | |
| clinicaId | String | no | — | `@@index` |

### 1.19g `FederationSyncFailure` (tabla `federation_sync_failures`) — Cola de reintentos de federación

| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | uuid() | PK |
| entityType | String | no | — | `CLINICA` \| `CLINICA_STATUS` \| `PATIENT` \| `APPOINTMENT` \| `TREATMENT_PLAN` \| `TREATMENT_ITEM` \| `TREATMENT_ITEM_REMOVAL` \| `TREATMENT_ITEM_PHOTO` \| `TREATMENT_ITEM_PHOTO_REMOVAL` \| `CONVENIO` \| `PRESTACION` \| `PREVISION` \| `USER` \| `SUCURSAL`. `@@unique([entityType, localId])` |
| localId | String | no | — | Id local de la entidad |
| payload | Json | no | — | Último payload (sin contraseñas) |
| lastError | String | sí | — | |
| attempts | Int | no | 0 | Máx. 10 reintentos, cada 5 min, 50 por barrido |
| createdAt | DateTime | no | now() | |
| updatedAt | DateTime | no | @updatedAt | |

Sin `clinicaId` (tabla global).

### 1.20 Conjuntos de valores permitidos ("enums lógicos")

| Dominio | Valores | Dónde se valida |
|---|---|---|
| `User.role` | `admin`, `odontologo`, `radiologo`, `operador` (+ `super_admin` solo por DB) | `usersController.VALID_ROLES` |
| Roles con matriz de permisos | `odontologo`, `radiologo`, `operador` | `rolePermissions.PERMISSIONED_ROLES` |
| Llaves de permiso (`rolePermissions` / `permissionOverrides`) | `pacientes`, `documentosClinicos`, `cartola`, `evoluciones`, `observaciones`, `agenda`, `tratamientos`, `consentimientos`, `rx`, `crearPresupuestos` | `rolePermissions.PERMISSION_KEYS` |
| Módulos de clínica (`Clinica.modules` / `moduleOverrides`) | `pacientes`, `documentosClinicos`, `cartola`, `evoluciones`, `observaciones`, `agenda`, `tratamientos`, `consentimientos` | `clinicaModules` |
| `Clinica.tipo` | `dental`, `estetica`, `ambas` | `clinicasController.VALID_TIPOS` |
| `Clinica.pais` | Chile, Argentina, Perú, Colombia, México, Bolivia, Ecuador, Uruguay, Paraguay, Venezuela, España, Estados Unidos, Otro | `VALID_PAISES` |
| `Clinica.slotDurationMinutes` | 15, 30, 60 | `clinicaSettingsController` |
| `federationSyncSettings` llaves | `patients`, `appointments`, `treatmentPlans`, `users`, `sucursales`, `catalog` | `clinicasController` |
| `Appointment.status` | `agendada`, `llego`, `en_atencion`, `finalizada`, `cancelada` | `utils/appointmentStatus` |
| `Appointment.type` | `cita`, `control` (POST /appointments); `urgencia` (POST /appointments/urgencia) | `appointmentsController` |
| `Appointment.triageLevel` | `leve`, `moderada`, `grave` | `appointmentsController` |
| `TreatmentPlan.status` | `sin_iniciar`, `en_tratamiento`, `terminado`, `alta` | `utils/treatmentStatus` |
| `TreatmentPlan.diagramType` | `dental`, `estetica` | `treatmentPlansController` |
| `TreatmentPlan.facialGender` | `hombre`, `mujer` | idem |
| `TreatmentPlan.paymentMethod` (UI) | `Contado`, `Cuotas` | solo frontend |
| `Prestacion.category` | `dental`, `estetica` | `catalogsController` |
| `Prestacion.odontogramMode` | `session`, `tooth`, `surface`, `extraction`, `cuadrante`, `sextante`, `arcada` | `lib/odontogramMode` |
| Zonas faciales (`allowedZones`, `zonePrices`) | `frente`, `entrecejo`, `sienes`, `parpados`, `patas_gallo`, `ojeras`, `pomulos`, `nariz`, `nasogenianos`, `codigo_barras`, `labios`, `menton`, `mandibula`, `cuello` | frontend `facialZoneConfig.FACIAL_ZONES` (backend solo exige strings no vacíos) |
| Caras del odontograma | `top`, `right`, `bottom`, `left`, `center` | frontend `Odontogram.TOOTH_SURFACES` |
| Piezas dentales | Permanentes 1.1–1.8, 2.1–2.8, 3.1–3.8, 4.1–4.8; temporales 5.1–5.5, 6.1–6.5, 7.1–7.5, 8.1–8.5 | frontend `Odontogram.tsx` |
| `Patient.allergies` | `fluoruro`, `penicilina`, `anestesicos_locales`, `latex`, `yodo`, `niquel_metales`, `aines`, `sulfitos`, `otro` | `lib/allergies.ALLERGY_KEYS` |
| `Patient.gender` (UI) | `femenino`, `masculino`, `otro` | solo frontend |
| `Patient.maritalStatus` (UI) | `soltero`, `casado`, `conviviente_civil`, `divorciado`, `viudo` | solo frontend |
| `Patient.healthInsurance` (UI) | `fonasa`, `isapre`, `particular`, `otro` | solo frontend |
| `Patient.bloodType` (UI) | A+, A-, B+, B-, AB+, AB-, O+, O- | solo frontend |
| `Consent.status` | `pendiente`, `firmado`, `rechazado`, `expirado` | `dataConsentsController` |
| `Consent.method` | `email`, `presencial` | idem |
| `ClinicalDocument.category` | `receta`, `derivacion`, `imagen`, `archivo`, `alta`, `solicitud_laboratorio`, `documento_pabellon`, `solicitud_pabellon` | `documentsController.DOCUMENT_CATEGORIES` |
| `LedgerMovement.type` | `abono`, `interes`, `ajuste` | `ledgerController.MOVEMENT_TYPES` |
| `LedgerMovement.paymentMethod` (UI) | Efectivo, Transferencia, Tarjeta, Cheque, Otro | solo frontend |
| Etiquetas de foto (evolución / ítem) | `Antes`, `Después`, `Sticker ficha`, `Sticker paciente` | frontend `photoLabels` |
| Etiqueta foto plantilla presupuesto | "`{Zona}` — Antes" / "`{Zona}` — Después" | frontend |
| Prioridad orden Rx (UI crear) | `1 día`, `2 días`, `3 días`, `Normal`, `Urgente` | frontend `CreateRxOrderModal` |
| Prioridad orden Rx (UI editar) | `Normal`, `Urgente` | frontend `RxOrderDetailModal` |
| Inventario (Dental-Demo) categoría | Desechables, Bioseguridad, Anestesia, Restauracion, Ortodoncia, Higiene dental, Instrumental, Radiologia, Laboratorio, Otros | frontend `api/inventory` |
| Inventario unidad | unidad, caja, paquete, frasco, tubo, ml, kit | idem |
| Inventario consultorio | Consultorio 1–5, Sala RX, Pabellón menor | idem |
| Inventario estado insumo | `ACTIVE`, `LOW_STOCK`, `OUT_OF_STOCK`, `ARCHIVED` | Dental-Demo-Back |
| Inventario estado vencimiento lote | `ACTIVE`, `EXPIRING`, `EXPIRED`, `NO_EXPIRATION` | Dental-Demo-Back |
| Inventario tipo movimiento | `IN`, `OUT`, `ADJUSTMENT` | Dental-Demo-Back |
| Duraciones de cita (UI) | 15, 30, 45, 60, 90 min (filtradas por múltiplo del bloque) | frontend |
| Horario agenda (UI) | 08:00 – 20:00 | frontend grids |
| Códigos de consentimiento por defecto | 13 códigos (ver §1.5) | `lib/consentTypes` |


---

## 2. Endpoints de la API (backend)

Prefijo global: `/api`. Todos los routers (salvo los públicos indicados) aplican `authenticate` (JWT Bearer). Abreviaturas de middleware: **A**=authenticate, **Adm**=requireAdmin (rol `admin`), **SA**=requireSuperAdmin, **Fed|SA**=requireFederationOrSuperAdmin (X-API-KEY = `FEDERATION_API_KEY` o JWT super_admin), **Mod(x)**=requireModuleEnabled(x) (clínica + overrides de usuario), **Perm(x)**=requireRolePermission(x) (perfil + overrides; admin/super_admin pasan siempre), **Rx**=requireRxEnabled.

`GET /api/health` → `{ ok: true }` (sin auth).

### 2.1 Autenticación — `/api/auth`

| Método y ruta | Middleware | Entrada | Qué hace |
|---|---|---|---|
| POST `/auth/login` | — | body `{ email, password }` | Valida bcrypt; rechaza si la clínica está inactiva (403). Devuelve `{ accessToken, user }` y setea cookie `refreshToken` (httpOnly, path `/api/auth`, 7 días, SameSite none en prod). `user` incluye: id, email, name, role, clinicaId, clinicaModules (con overrides), clinicaTipo, clinicaName, clinicaLogoUrl, rxEnabled, slotDurationMinutes, permissions (resueltos). |
| POST `/auth/refresh` | cookie | — | Emite nuevo access + refresh token. |
| POST `/auth/logout` | — | — | Borra cookie. |
| GET `/auth/me` | A | — | Usuario actual (misma forma que login). |

Tokens: `JWT_ACCESS_SECRET`/`JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_SECRET`/`JWT_REFRESH_EXPIRES_IN`. Payload access: `{ sub, email, role, clinicaId }`.

### 2.2 Sillones — `/api/chairs` (A)

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/chairs` | query `all=true` (incluye inactivos) | Lista sillones de la clínica ordenados por número. |
| POST `/chairs` | `{ number:int>0, name? }` | Crea; 409 si el número existe en la clínica. |
| PATCH `/chairs/:id` | `{ name?: string\|null, active?: bool }` | Actualiza nombre/estado. |
| DELETE `/chairs/:id` | — | Elimina; 409 si tiene citas (sugiere desactivar). |

### 2.3 Pacientes — `/api/patients` (A, Mod(pacientes), Perm(pacientes))

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/patients` | query `search` (nombre, apellido o RUT limpio; máx 50 resultados) | Lista pacientes de la clínica + resumen de consentimiento de protección de datos. |
| POST `/patients` | body `PatientInput` (ver abajo) | Crea. Valida RUT (mód. 11), nombre y apellido obligatorios; 409 si RUT repetido en la clínica. Best‑effort: sincroniza a RIDS RX (si `rxEnabled`) y a Dental-Demo. |
| GET `/patients/:id` | — | Ficha completa + resumen de consentimiento. |
| PATCH `/patients/:id` | body `Partial<PatientInput>` (+ `rut`) | Actualiza campos presentes (`undefined` = no tocar; `""` = null). Sincroniza a Dental-Demo. |
| PATCH `/patients/:id/photo` | multipart `photo` | Sube a Cloudinary, borra la anterior, guarda `photoUrl/photoPublicId`. |
| PATCH `/patients/:id/motivo-consulta-audio` | multipart `audio` | 403 si no hay `Consent` firmado tipo `grabacion_voz`. Sube como `video` a Cloudinary; reemplaza la anterior. |

`PatientInput` (todos opcionales salvo rut/firstName/lastName en POST): `rut, firstName, lastName, phone, email, birthDate (ISO), address, gender, nationality, maritalStatus, occupation, heightCm (number|null), weightKg (number|null), allergies (string[] filtrado a ALLERGY_KEYS), allergyNotes, medicalConditions, currentMedications, chronicDiseases, dentalHistory, emergencyContactName, emergencyContactPhone, emergencyContactRelationship, healthInsurance, healthInsuranceDetail, bloodType, tags (string[] máx 20, únicos), motivoConsulta`.

### 2.4 Citas — `/api/appointments` (A, Mod(agenda), Perm(agenda))

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/appointments` | query: `date=YYYY-MM-DD` **o** `from`+`to` **o** `patientId`; opcional `chairId`, `mine=true` (solo mis citas si no soy admin) | Lista citas (excluye canceladas salvo con `patientId`). Incluye patient (id, rut, nombres, phone, email), professional, receivedBy, chair. |
| POST `/appointments` | `{ chairId*, patientId*, startAt*, endAt*, professionalId?, notes?, type? ('cita'\|'control') }` | Valida rango, sillón activo, paciente, solape por sillón (409). `professionalId` solo lo puede fijar admin; si no, el usuario logueado. Best‑effort: sync Dental-Demo y correo de confirmación al paciente (si tiene email). |
| POST `/appointments/urgencia` | `{ patientId*, motivoUrgencia*, triageLevel?, professionalId?, durationMinutes? (default 30) }` | Busca el primer sillón libre ahora; crea cita `type=urgencia`, `status=llego`, `arrivedAt=now`, `receivedByUserId=usuario`. 409 si no hay sillón. Sync Dental-Demo. |
| DELETE `/appointments/:id` | — | **Cancela** (status `cancelada`, no borra). 403 si no es admin ni el profesional de la cita. |
| PATCH `/appointments/:id/arrival` | — | `agendada` → `llego`, sella `arrivedAt`. |
| PATCH `/appointments/:id/start-attention` | — | `llego` → `en_atencion`, sella `attentionStartedAt`. |
| PATCH `/appointments/:id/finish` | — | `en_atencion` → `finalizada`, sella `attentionEndedAt`. |

### 2.5 Usuarios / profesionales — `/api/users` (A, Adm)

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/users` | — | Lista usuarios de la clínica (id, email, name, role, rut, createdAt, clinicaId, signatureUrl). |
| POST `/users` | `{ name*, email*, password* (≥8), role* (admin\|odontologo\|radiologo\|operador), rut?, signatureDataUrl? (PNG data URL) }` | Crea usuario en la clínica del admin. Sube firma a Cloudinary. Si rol odontologo/radiologo con RUT y clínica `rxEnabled`: crea el profesional en RIDS RX (radiólogo recibe contraseña generada devuelta una vez: `dimageGeneratedPassword`). Sync a Dental-Demo (con contraseña en claro solo en el intento original). |
| PATCH `/users/:id` | `{ rut?: string\|null }` | **Solo** actualiza RUT (validado). Si ganó RUT, intenta sync RIDS RX. |
| GET `/users/:id/permissions` | — | `{ role, isPermissionedRole, permissionDefaults, moduleDefaults, permissionOverrides, moduleOverrides, effectivePermissions, effectiveModules }`. |
| PATCH `/users/:id/permissions` | `{ permissionOverrides?: {key: bool\|null}, moduleOverrides?: {key: bool\|null} }` | `null` borra la excepción. 400 si el rol no admite permisos (admin). |
| POST `/users/import-from-dimage` | — | Trae odontólogos/radiólogos del holding en RIDS RX que no existen localmente (por RUT/email), los crea con contraseña aleatoria y la devuelve una vez (`imported[]`). Requiere `rxEnabled`. |

### 2.6 Horarios — `/api/work-schedules` (A, Adm)

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/work-schedules` | query `professionalId?` | Lista bloques (con chair). **No filtra por clínica.** |
| POST `/work-schedules` | `{ professionalId*, weekday* (0-6), startTime* HH:MM, endTime* HH:MM, chairId? }` | Valida formato, fin > inicio, sin solape mismo profesional/día (409). |
| DELETE `/work-schedules/:id` | — | Elimina. |

### 2.7 Presupuestos — `/api/treatment-plans` (A, Mod(tratamientos), Perm(tratamientos))

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/treatment-plans` | query `patientId*` | Planes del paciente con include completo (professional, createdBy, startedBy, completedBy, sucursal, prevision, convenio, items{prestacion, treatedBy, photos}, photos). |
| POST `/treatment-plans` | + Perm(crearPresupuestos). `PlanInput`: `{ patientId*, professionalId?, sucursalId?, previsionId?, convenioId?, name?, paymentMethod?, notes?, diagramType? (obligatorio si clínica 'ambas'), items?: ItemInput[], facialAnnotations?, facialGender? }` | Crea plan + ítems en una transacción; `amount` = Σ cost; `createdById` = usuario. `facialAnnotations/facialGender` solo se guardan si diagramType = estetica. Sync Dental-Demo (plan e ítems en serie). |
| PATCH `/treatment-plans/:id` | `{ status?, notes?, professionalId?: string\|null, name?, paymentMethod?: string\|null }` | 403 si plan está `alta`. Estampa startedBy/completedBy la primera vez. Sync. |
| DELETE `/treatment-plans/:id` | — | Borra (cascade ítems/fotos/edits). 403 si `alta`. Avisa `removed` a Dental-Demo. |
| POST `/treatment-plans/:id/items` | `ItemInput` (`description*`) | Agrega ítem y recalcula amount/status. 403 si `alta`. |
| POST `/treatment-plans/:id/edits` | `{ reason* }` | Registra `TreatmentPlanEdit` (auditoría). |
| POST `/treatment-plans/:id/photos` | multipart `file` (≤20MB) + `label?` | Sube foto de plantilla (Cloudinary). |
| DELETE `/treatment-plans/photos/:photoId` | — | Borra foto (Cloudinary + DB). |
| GET `/treatment-plans/:id/report` | query `format=pdf\|docx` | Informe descargable; 403 si el plan no está `alta`. |

`ItemInput`: `{ description*, cost?, prestacionId?, toothNumber?, listPrice?, convenioDiscountPercent?, notes?, productName?, productLot?, productExpiresAt? (ISO), productQuantity? }`.

### 2.8 Ítems de presupuesto — `/api/treatment-items` (A, Mod(tratamientos), Perm(tratamientos))

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| PATCH `/treatment-items/:id` | `{ description?, cost?, completed?, toothNumber?, notes?, productName?, productLot?, productExpiresAt?, productQuantity? }` | Al marcar `completed=true` estampa `treatedById/treatedAt` (usuario actual); al desmarcar los limpia. Recalcula plan. 403 si `alta`. Sync. |
| DELETE `/treatment-items/:id` | — | Borra ítem, recalcula, sync `removed`. |
| POST `/treatment-items/:id/photos` | multipart `file` + `label?` | Foto del procedimiento; sync a Dental-Demo (URL pública). |
| DELETE `/treatment-items/photos/:photoId` | — | Borra foto; sync removal. |

### 2.9 Catálogos — `/api/catalogs` (A; escrituras Adm)

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/catalogs/sucursales` | `all=true` | Lista sucursales activas (o todas). |
| POST `/catalogs/sucursales` (Adm) | `{ name*, address? }` | Crea (409 nombre repetido). Sync Dental-Demo. |
| PATCH `/catalogs/sucursales/:id` (Adm) | `{ name?, address?, active?, dimageClinicId? }` | Actualiza. **No** sincroniza a Dental-Demo. |
| DELETE `/catalogs/sucursales/:id` (Adm) | — | 409 si tiene presupuestos. |
| GET `/catalogs/previsiones` | `all=true` | |
| POST `/catalogs/previsiones` (Adm) | `{ name* }` | Sync. |
| PATCH `/catalogs/previsiones/:id` (Adm) | `{ name?, active? }` | Sync. |
| DELETE `/catalogs/previsiones/:id` (Adm) | — | 409 si usada; archiva espejo remoto. |
| GET `/catalogs/convenios` | `all=true` | |
| POST `/catalogs/convenios` (Adm) | `{ name*, discountPercent? (0-100) }` | Sync. |
| PATCH `/catalogs/convenios/:id` (Adm) | `{ name?, discountPercent?, active? }` | Sync. |
| DELETE `/catalogs/convenios/:id` (Adm) | — | 409 si usado; archiva espejo. |
| GET `/catalogs/prestaciones` | `all=true`, `q` (búsqueda por nombre) | |
| POST `/catalogs/prestaciones` (Adm) | `{ name*, code?, basePrice?, category?, odontogramMode?, allowedZones?, requiresProductTracking?, appliesToWholeFace?, zonesApplyTogether?, zonePrices? }` | Reglas: zonas solo si `estetica` y no `appliesToWholeFace`; `zonesApplyTogether` solo con 2+ zonas; `zonePrices` solo con 2+ zonas (rellena faltantes con basePrice); modo sugerido por nombre si no viene. 409 código repetido. Sync. |
| PATCH `/catalogs/prestaciones/:id` (Adm) | mismos campos + `active?` | Si pasa a `dental` limpia zonas. `zonePrices` se recalcula siempre (null → DbNull). Sync. |
| DELETE `/catalogs/prestaciones/:id` (Adm) | — | 409 si usada en ítems; archiva espejo. |
| GET `/catalogs/product-lots` | `q` (≥2 chars) | Busca lotes reales en Dental-Demo-Back (`/api/platform/federated/supply-lots`). Devuelve `{ lots, federationAvailable }`; degrada a lista vacía. |
| GET `/catalogs/evolution-templates` | `all=true` | Plantillas de evolución. |
| POST `/catalogs/evolution-templates` (Adm) | `{ name*, section?, content* }` | Crea. |
| PATCH `/catalogs/evolution-templates/:id` (Adm) | `{ name?, section?, content?, active? }` | |
| DELETE `/catalogs/evolution-templates/:id` (Adm) | — | |

### 2.10 Inventario (proxy a Dental-Demo-Back) — `/api/inventory` (A, Adm)

No hay tabla local; cada llamada pega a `DENTALDEMO_API_URL/api/platform/federated/inventory/...` con `clinicaId` nativo. 503 si la federación no está configurada; los errores del remoto se retransmiten con su status.

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/inventory/supplies` | query `search, category, supplier, status, dateFrom, dateTo, sucursalId, consultingRoom, page, limit` | Lista insumos `{ items, pagination }`. |
| GET `/inventory/supplies/:id` | — | Detalle insumo. |
| POST `/inventory/supplies` | `{ name*, sucursalId?, category?, supplier?, description?, purchaseDate?, quantity?, unit?, unitCost?, totalCost?, currentStock?, minimumStock?, consultingRoom?: string\|null }` | Crea insumo remoto. |
| PATCH `/inventory/supplies/:id` | mismos campos | Actualiza. |
| POST `/inventory/supplies/:id/archive` | — | Archiva. |
| GET `/inventory/supplies/:id/lots` | query `sucursalId, search, expirationStatus, sortBy, sortOrder, active, page, limit` | Lotes del insumo. |
| POST `/inventory/supplies/:id/lots` | `{ lotNumber*, manufacturer?, presentation?, concentration?, healthRegistration?, receivedAt?, expirationDate?, initialQuantity?, quantity?, isActive? }` | Crea lote. |
| PATCH `/inventory/supplies/:id/lots/:lotId` | idem | Actualiza lote. |
| POST `/inventory/supplies/:id/lots/:lotId/movements` | `{ movementType* (IN\|OUT\|ADJUSTMENT), quantity*, reason? }` | Registra movimiento; devuelve `{ movement, lot, supply }`. |
| GET `/inventory/alerts` | query `sucursalId, includeItems, expirationStatus, active, page, limit` | Alertas: vencidos, por vencer, sin stock, bajo stock. |

### 2.11 Evoluciones — `/api/evolutions` (A, Mod(evoluciones), Perm(evoluciones))

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/evolutions` | query `patientId*`, `professionalId?`, `enabled=true\|false\|all` (default true) | Lista con professional, treatmentItem, photos. |
| POST `/evolutions` | `{ patientId*, content* (HTML con texto), professionalId?, treatmentItemId?, productName?, productLot?, productExpiresAt?, productQuantity? }` | Si `treatmentItemId`: valida que sea del mismo paciente, que el plan no esté `alta`, y si la prestación exige trazabilidad los 4 campos de producto son obligatorios. Marca el ítem `completed`, copia producto al ítem, recalcula plan y sincroniza ítem a Dental-Demo. |
| PATCH `/evolutions/:id` | `{ content?, enabled? }` | Solo autor o admin. |
| DELETE `/evolutions/:id` | body `{ reason* }` | Solo autor o admin. Crea `EvolutionDeletion` y borra. |
| POST `/evolutions/:id/photos` | multipart `file` (≤20MB) + `label?` | Sube foto; si la evolución tiene ítem, duplica en `TreatmentItemPhoto`. |
| DELETE `/evolutions/photos/:photoId` | — | Borra y elimina el espejo del ítem (por publicId). |

### 2.12 Cartola — `/api/ledger` (A, Mod(cartola), Perm(cartola))

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/ledger/summary` | `patientId*` | `{ plans[] (subtotal, interes, ajustes, total, abonado, saldo), totals, abonosLibres[], intereses[], ajustes[], ledger[] (libro combinado plan+movimientos), abonosLibresTotal, saldoTotal }`. |
| GET `/ledger/summary/pdf` | `patientId*` | PDF de cartola (pdfkit, con logo). |
| GET `/ledger/balance` | `patientId*` | `{ saldoTotal }` (para la alerta de deuda al abrir la ficha). |
| POST `/ledger/send-email` | `{ patientId* }` | Envía cartola PDF por correo (recordatorio si saldo > 0). 400 sin email. |
| POST `/ledger/movements` | `{ patientId*, type* (abono\|interes\|ajuste), amount* (>0), treatmentPlanId?, direction? (debe\|haber, solo ajuste), description?, paymentMethod?, documentNumber?, notes? }` | Crea movimiento; abono → haber, interés → debe, ajuste según direction. |
| DELETE `/ledger/movements/:id` | — | Solo quien registró o admin. |

### 2.13 Observaciones administrativas — `/api/observations` (A, Mod(observaciones), Perm(observaciones))

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/observations` | `patientId*` | Lista desc. |
| POST `/observations` | `{ patientId*, content*, professionalId? }` | Crea. |
| DELETE `/observations/:id` | — | Autor o admin. |

### 2.14 Documentos clínicos — `/api/documents` (A, Mod(documentosClinicos), Perm(documentosClinicos))

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/documents` | `patientId*`, `category?` | Lista. |
| POST `/documents` | multipart `file` (≤20MB) + `patientId*`, `category*`, `description?` | Sube a Cloudinary (`resource_type auto`). 503 sin Cloudinary. |
| DELETE `/documents/:id` | — | Quien subió o admin; borra en Cloudinary. |

### 2.15 Módulo Rx (RIDS RX / DIMAGE) — `/api/rx` (A, Rx, Perm(rx))

Proxy a `DIMAGE_API_URL` con `X-API-KEY`. 503 si no está configurado; 502 con mensaje del remoto si falla.

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/rx/exam-catalog` | — | `{ types, groups }` — tipos de examen y grupos (mapeados a pestañas `intraorales`/`extraorales`: 1 Adultos, 2 Niños, 3 2D, 4 3D). |
| GET `/rx/patient-status` | `patientId*` | ¿Existe el paciente en RIDS RX por RUT? |
| POST `/rx/patient-sync` | `{ patientId* }` | Upsert paciente en RIDS RX (rut, name, email, celphone, address, dateofbirth, id_externo). |
| GET `/rx/orders` | `patientId*` | Órdenes del paciente en RIDS RX. |
| POST `/rx/orders` | `{ patientId*, sucursalId*, examenes*[{kindId, dientes?, urlTexto?, otroInput?}], professionalId?, diagnostico?, observaciones?, prioridad? }` | 403 radiólogos. Exige `Sucursal.dimageClinicId` y RUT del odontólogo; crea odontólogo en RIDS RX si no existe; sincroniza paciente; crea orden. |
| GET `/rx/orders/:id` | — | Detalle de orden (exámenes, archivos, respuestas). |
| POST `/rx/orders/:id/dicom-viewer-token` | — | Lista `.dcm` en S3 (`ordenes/{id}/`) y emite JWT de 2h → `{ token, entryFilename }`. 503 si S3 no configurado. |
| PUT `/rx/orders/:id` | `{ diagnostico?, observaciones?, prioridad?, professionalId?, examenes? }` | Actualiza orden remota. |
| PATCH `/rx/orders/:id/send` | — | Envía a radiólogo. |
| GET `/rx/orders/:id/pdf` | — | `{ url }` PDF remoto. |
| GET `/rx/orders/:id/zip` | — | `{ url }` ZIP remoto. |
| POST `/rx/orders/:id/files/:examinationId` | multipart `files[]` (≤10 archivos, ≤3 GB c/u, disco temporal) | Sube adjuntos a la orden en RIDS RX (streaming). |
| DELETE `/rx/order-files/:fileId` | — | Borra adjunto remoto. |

### 2.16 Visor DICOM — `/api/rx-viewer` (SIN authenticate; JWT corto en la URL)

| Método y ruta | Qué hace |
|---|---|
| GET `/rx-viewer/:token/file_list.txt` | Lista archivos DICOM de la orden (texto plano) desde S3 de RIDS RX. |
| GET `/rx-viewer/:token/:filename` | Stream de un `.dcm` (`application/dicom`). Nombre validado `^[\w.-]+$`. |

### 2.17 Consentimientos — `/api/data-consents` (A, Mod(consentimientos), Perm(consentimientos))

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/data-consents/types` | — | Tipos activos de la clínica (auto‑siembra los 13 por defecto). |
| GET `/data-consents/text/:consentTypeId` | — | `{ text, pdfUrl }`. |
| GET `/data-consents/patient/:patientId` | — | Consentimientos del paciente (id, consentTypeId, status, method, sentAt, expiresAt, respondedAt, signerName, signerRut). |
| GET `/data-consents/:id/pdf` | — | PDF del consentimiento (snapshot del PDF propio o generado con pdfkit: clínica, paciente, texto, estado, firmante, fecha, método, IP, firma). |
| POST `/data-consents` | `{ patientId*, consentTypeId* }` | Envía correo con link `FRONTEND_ORIGIN/consentimiento/{token}` (vence en 7 días); upsert Consent `pendiente`, `method=email`, `contentSnapshot`, snapshot del PDF si el tipo tiene. 400 sin email. |
| POST `/data-consents/:patientId/:consentTypeId/respond` | `{ decision* (firmado\|rechazado), signerName*, signerRut* (válido), readConfirmed* true, signatureDataUrl (PNG, obligatoria si firmado) }` | Firma **presencial**; guarda IP/UA; envía PDF firmado al paciente por correo. 409 si ya respondido. |
| POST `/data-consents/types/:consentTypeId/pdf` (Adm) | multipart `pdf` (≤5MB) | Sube PDF propio del tipo (reemplaza texto legal). |
| DELETE `/data-consents/types/:consentTypeId/pdf` (Adm) | — | Vuelve a modo texto. |

### 2.18 Consentimiento público — `/api/public/consents` (sin auth; token en URL)

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/public/consents/:token` | — | `{ patientName, consentTypeName, contentSnapshot, pdfUrl, expiresAt }`. 404 link inválido, 409 ya respondido, 410 vencido (marca `expirado`). |
| POST `/public/consents/:token/respond` | `{ decision*, signerName*, signerRut*, readConfirmed*, signatureDataUrl (si firmado) }` | Registra respuesta remota (IP, UA, firma) y envía PDF por correo. |

### 2.19 Clínicas / Holdings y federación — `/api/clinicas`

| Método y ruta | Middleware | Entrada | Qué hace |
|---|---|---|---|
| GET `/clinicas` | Fed\|SA | — | Todas las clínicas con estadísticas (`withStats`): counts de pacientes, usuarios, citas, planes, documentos, evoluciones, observaciones, movimientos; monto presupuestado; neto cartola; consentStats (firmado/rechazado/pendiente de protección de datos); flags de federación. |
| GET `/clinicas/pacientes` | Fed\|SA | — | Todos los pacientes (id, nombres, rut, createdAt, clinicaId, clinicaName, estado consentimiento). |
| GET `/clinicas/citas` | Fed\|SA | — | Últimas 200 citas de la plataforma. |
| GET `/clinicas/tratamientos` | A, SA | — | Últimos 200 planes. |
| GET `/clinicas/documentos` | A, SA | — | Últimos 200 documentos. |
| GET `/clinicas/cartola` | A, SA | — | Últimos 200 movimientos. |
| GET `/clinicas/evoluciones` | A, SA | — | Últimas 200 evoluciones (resumen 100 chars). |
| GET `/clinicas/observaciones` | A, SA | — | Últimas 200 observaciones. |
| GET `/clinicas/federated/overview` | A, SA | — | `{ local: {clinicas, patients, appointments}, remote: {clinics, patients, appointments} \| null, remoteAvailable }` (consulta en vivo a Dental-Demo `/api/platform/clinics|patients|appointments`). **No consumido por el frontend actual.** |
| POST `/clinicas` | A, SA | multipart `logo?` (≤5MB) + `{ name*, rut?, tipo?, pais?, adminName*, adminEmail*, adminPassword* (≥8) }` | Crea holding + usuario admin en transacción; sube logo; espeja a Dental-Demo (con datos del admin y contraseña en claro en el intento original). |
| PATCH `/clinicas/:id` | A, SA | `{ name?, rut?, active?, tipo?, pais?, rxEnabled?, modules?: Partial, federationCatalogOnly?, federationPaused?, federationSyncSettings?: Partial }` | Actualiza; los 3 flags de federación exigen clínica conectada (400). `active` se espeja a Dental-Demo. |
| PATCH `/clinicas/:id/logo` | A, SA | multipart `logo` | Reemplaza logo. |
| POST `/clinicas/:id/federation/connect` | A, SA | — | Empareja con Dental-Demo (`mirror clinic` con externalId = id local); arranca en `federationCatalogOnly=true`. |
| POST `/clinicas/:id/federation/disconnect` | A, SA | — | Limpia `federatedClinicId` y flags (no borra nada remoto). |
| POST `/clinicas/federated/mirror` | Fed\|SA | `{ externalId*, name*, pais?, adminName?, adminEmail?, adminPassword?, active?, clinicType? (DENTAL\|ESTHETIC\|BOTH) }` | **Entrada desde Dental-Demo**: upsert clínica espejo; al crear genera Chair "Sillón externo" (n°1), Sucursal "Clínica federada" y usuario admin (contraseña recibida o temporal). Devuelve `{ id, chairId }`. |
| POST `/clinicas/federated/patients/mirror` | Fed\|SA | `{ clinicaId*, externalId*, firstName*, lastName*, rut* (obligatorio aquí), email?, phone?, birthDate?, heightCm?, weightKg?, allergies?, allergyNotes?, medicalConditions?, currentMedications? }` | Upsert paciente espejo (vincula por RUT si ya existía). |
| POST `/clinicas/federated/users/mirror` | Fed\|SA | `{ clinicaId*, externalId*, name*, email*, password?, role? (CLINIC_OWNER→admin, PROFESSIONAL→odontologo, RECEPTIONIST/ASSISTANT/LOCATION_MANAGER/MARKETING_MANAGER→operador), rut? }` | Upsert usuario espejo (409 si el email pertenece a otra clínica). |
| POST `/clinicas/federated/appointments/mirror` | Fed\|SA | `{ clinicaId*, patientId*, externalId*, startAt*, endAt*, status? (CANCELLED/NO_SHOW→cancelada, resto→agendada), notes? }` | Upsert cita espejo en el "Sillón externo". |
| POST `/clinicas/federated/treatment-plans/mirror` | Fed\|SA | `{ patientId*, externalId*, title*, description?, planType? (DENTAL\|ESTHETIC), facialGender?, status? (solo 'alta' se fuerza), convenioId?, previsionId?, professionalName? }` | Upsert plan espejo (`remoteProfessionalName`). |
| POST `/clinicas/federated/treatment-plans/items/mirror` | Fed\|SA | `{ treatmentPlanId*, externalId*, name, description?, tooth?, unitPrice?, completed?, removed?, prestacionId?, listPrice?, convenioDiscountPercent?, productName?, productLot?, productExpiresAt?, productQuantity? }` | Upsert/borrado de ítem espejo; recalcula totales. |
| POST `/clinicas/federated/convenios/mirror` | Fed\|SA | `{ clinicaId*, externalId*, name*, discountPercent?, active? }` | Upsert (vincula por nombre). |
| POST `/clinicas/federated/prestaciones/mirror` | Fed\|SA | `{ clinicaId*, externalId*, name*, code?, basePrice?, active?, odontogramMode?, requiresProductTracking? }` | Upsert (vincula por código). |
| POST `/clinicas/federated/previsiones/mirror` | Fed\|SA | `{ clinicaId*, externalId*, name*, active? }` | Upsert (vincula por nombre). |
| POST `/clinicas/federated/sucursales/mirror` | Fed\|SA | `{ clinicaId*, externalId*, name*, active? }` | Upsert (vincula por nombre). |

### 2.20 Configuración de clínica (admin) — `/api/clinica/*` (A, Adm)

| Método y ruta | Entrada | Qué hace |
|---|---|---|
| GET `/clinica/role-permissions` | — | Matriz completa `{ odontologo, radiologo, operador }` × 10 llaves. |
| PATCH `/clinica/role-permissions` | `{ [role]: { [permKey]: bool } }` | Merge parcial. 400 rol/llave inválidos. |
| PATCH `/clinica/agenda-settings` | `{ slotDurationMinutes* (15\|30\|60) }` | Duración del bloque de agenda. |


---

## 3. Pantallas y formularios del frontend

### 3.0 Mapa de rutas (`App.tsx`)

| Ruta | Componente | Guard | Descripción |
|---|---|---|---|
| `/login` | `Login` | — | Inicio de sesión |
| `/consentimiento/:token` | `ConsentimientoPublico` | — (pública) | Firma remota de consentimiento (link enviado por correo) |
| `/` | `Dashboard` | ProtectedRoute | Bienvenida (Favoritos / Próximas citas / Novedades: **todos placeholders vacíos**) |
| `/agenda` | `Agenda` | Protected + módulo `agenda` + permiso `agenda` (sidebar) | Agenda general por sillón (día) |
| `/agenda/sillones-libres` | `SillonesLibres` | idem | Vista semanal de un sillón |
| `/agenda/diaria` | `AgendaDiaria` | idem | Lista de citas del día (admin: todas; otros: propias) |
| `/pacientes` | `Pacientes` | módulo/permiso `pacientes` | Listado y búsqueda |
| `/pacientes/:id` | `FichaPaciente` | idem | Ficha con 9 pestañas |
| `/terminos` | `ComingSoon` | — | "Términos y políticas" — en construcción |
| `/profesionales` | `Profesionales` | AdminRoute (rol `admin`) | Usuarios, horarios, permisos |
| `/catalogo` | `Catalogo` | AdminRoute | Prestaciones, Convenios, Previsiones, Clínicas (sucursales), Inventario |
| `/admin/clinicas` | `Clinicas` | SuperAdminRoute | Holdings |
| `/admin/clinicas/:id` | `ClinicaDetail` | SuperAdminRoute | Detalle/configuración de holding |
| `/admin/modulos/:moduleKey` | `ModuloConsumo` | SuperAdminRoute | Consumo por módulo y toggles por holding |
| `*` | redirect `/` | | |

**Layout** (`AppLayout` + `Sidebar` + `Topbar`): sidebar con navegación filtrada por rol/módulo/permiso y tema por `clinicaTipo` (azul dental / rosado estética; logo del holding si existe). Topbar: buscador global de fichas de paciente (≥2 caracteres, debounce 250 ms → `GET /patients?search`), botón de notificaciones (sin función), menú de usuario con "Cerrar sesión". Super‑admin ve otro menú (Resumen + 9 módulos).

Componentes compartidos: `Modal` (Escape para cerrar), `ReasonModal` (textarea motivo obligatorio), `RichTextEditor` (contentEditable con B/I/U, listas, alineación, contador de palabras), `SignaturePad` (canvas → PNG data URL, botón Borrar), `CountrySelect` (código de marcación con bandera; 49 países en `data/countries.ts`, default +34 España), `PhotoEditorModal` (recorte cuadrado 320px: zoom 1–3, rotación ±90°, flip H/V, 9 posiciones → PNG blob).

### 3.1 Login (`pages/Login.tsx`)

| Campo | Tipo | Obligatorio | Validación |
|---|---|---|---|
| Correo electrónico | email | sí | HTML5 |
| Contraseña | password (toggle mostrar) | sí | — |

Acción: `POST /auth/login`. Redirige a `/admin/clinicas` si `super_admin`, si no a la ruta original o `/`.

### 3.2 Agenda general (`pages/agenda/Agenda.tsx`)

Muestra: tabs de días de la semana (`DayTabs`), grilla sillones × horas 08:00–20:00 (`ChairAgendaGrid`, paso = `slotDurationMinutes`), línea de hora actual, contador de citas, botón "Hoy". Cada cita muestra paciente, horario y punto de color por estado. Clic en celda libre → `AppointmentFormModal`; clic en cita → `AppointmentActionModal`. Hover sobre cabecera de sillón → botón eliminar sillón (confirm).

Controles superiores: `SlotDurationControl` (solo admin: select 15/30/60 min → `PATCH /clinica/agenda-settings`), "Nueva cita" (`NewAppointmentModal`), "Atender urgencia" (`UrgencyAppointmentModal`), "Sillón" (`ChairFormModal`).

#### 3.2.1 `AppointmentFormModal` — "Agendar cita" (desde una celda)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| Paciente | `PatientPicker` (búsqueda ≥2 chars por nombre/RUT + "Crear nuevo paciente" → `PatientFormModal`) | sí | |
| Duración | select | sí | 15/30/45/60/90 min filtrados por múltiplo del bloque; muestra hora fin |
| Motivo / notas | textarea | no | → `notes` |

Sillón y hora de inicio vienen fijos de la celda. Envía `POST /appointments` (type por defecto `cita`, sin `professionalId` → usuario actual).

#### 3.2.2 `NewAppointmentModal` — "Nueva cita" / "Nuevo control"

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| Paciente | PatientPicker | sí | Precargado si se abre desde la ficha |
| Fecha | date | sí | Default: fecha seleccionada |
| Hora | time | sí | Default 09:00 |
| Sillón | select (sillones activos) | sí | |
| Duración | select | sí | 15/30/45/60/90 filtrados |
| Profesional | select | no | **Solo admin**: "Yo mismo" o cualquier usuario de la clínica |
| Motivo / notas | textarea | no | |

`type` = `cita` o `control` (cuando se abre desde "Crear próximo control" en Evoluciones).

#### 3.2.3 `UrgencyAppointmentModal` — "Atender urgencia"

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| Paciente | PatientPicker | sí | |
| Motivo de la urgencia | text | sí | → `motivoUrgencia` |
| Nivel de gravedad | select | no | Sin especificar / Leve / Moderada / Grave → `triageLevel` |
| Profesional | select | no | "Por asignar", "Yo mismo" (no admin), o cualquier profesional |

`POST /appointments/urgencia` (duración fija 30 min por defecto; el frontend no envía `durationMinutes`).

#### 3.2.4 `AppointmentActionModal` — detalle de cita

Muestra paciente, estado, horario, profesional, sillón, y si es urgencia: motivo y triage. Botones según estado: "Marcar llegada" (agendada), "Pasar a atención" (llego), "Terminar cita" + "Ir a evolucionar" (en_atencion), "Cancelar cita" (si no está cancelada/finalizada). Sin campos editables.

#### 3.2.5 `ChairFormModal` — "Agregar sillón"

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| Número de sillón | number ≥1 | sí | Default: máx+1 (o 101) |
| Nombre (opcional) | text | no | |

### 3.3 Sillones libres (`SillonesLibres.tsx`)

Tabs por sillón (`ChairTabs`), navegación por semanas, grilla 7 días × horas (`SillonesLibresGrid`) con celdas "Disponible" → `AppointmentFormModal` para ese sillón. Incluye `SlotDurationControl` y "Sillón". No agrega campos nuevos.

### 3.4 Agenda diaria (`AgendaDiaria.tsx`)

Lista de citas del día (`GET /appointments?date&mine=true`; admin ve todas), navegación día anterior/siguiente/hoy, "Nueva cita". Clic → `AppointmentActionModal`.

### 3.5 Pacientes — listado (`pages/pacientes/Pacientes.tsx`)

Buscador (nombre/apellido/RUT, debounce 300 ms), filtros por estado del consentimiento de protección de datos (Todos, Firmados, Pendientes, Rechazados, Expirados, No enviados) con contadores, tabla (Paciente, RUT, Contacto, Nacimiento, Consentimiento con fecha y método). "Nuevo paciente" → `PatientFormModal`; al crear navega a la ficha.

### 3.6 `PatientFormModal` — "Nuevo paciente" / "Editar paciente" (mismo formulario)

| Sección | Campo (label) | Input | Obligatorio | Opciones / validación | Campo destino |
|---|---|---|---|---|---|
| — | Fotografía del paciente (opcional) | file `image/*` (botón cuadrado con preview) | no | Se sube tras guardar vía `PATCH /patients/:id/photo` | `photoUrl` |
| — | RUT | text (auto‑formato `12.345.678-9`, maxLength 12) | sí | Módulo 11; error "RUT inválido" | `rut` |
| — | Nombre | text | sí | | `firstName` |
| — | Apellido | text | sí | | `lastName` |
| — | Teléfono | `CountrySelect` (código) + text | no | Se guarda "`+56` `9 1234 5678`" | `phone` |
| — | Fecha de nacimiento | date | no | | `birthDate` |
| — | Correo electrónico | email | no | | `email` |
| — | Dirección | text | no | | `address` |
| Datos personales | Género | select | no | No especificado / Femenino / Masculino / Otro | `gender` |
| | Estado civil | select | no | No especificado / Soltero/a / Casado/a / Conviviente civil / Divorciado/a / Viudo/a | `maritalStatus` |
| | Nacionalidad | text | no | placeholder "Ej. Chilena" | `nationality` |
| | Ocupación | text | no | | `occupation` |
| | Previsión de salud | select | no | No especificada / Fonasa / Isapre / Particular / Otro | `healthInsurance` |
| | Plan / póliza | text | no | | `healthInsuranceDetail` |
| Contacto de emergencia | Nombre | text | no | | `emergencyContactName` |
| | Teléfono | text | no | sin selector de país | `emergencyContactPhone` |
| | Relación | text | no | | `emergencyContactRelationship` |
| Antecedentes médicos | Altura (cm) | number ≥0 | no | | `heightCm` |
| | Peso (kg) | number ≥0 step 0.1 | no | | `weightKg` |
| | Grupo sanguíneo | select | no | Desconocido / A+ A- B+ B- AB+ AB- O+ O- | `bloodType` |
| | Alergias | 9 checkboxes | no | Flúor/fluoruro, Penicilina/betalactámicos, Anestésicos locales, Látex, Yodo/povidona, Níquel/metales, AINEs, Sulfitos, Otra | `allergies[]` |
| | (detalle alergias) | textarea | no | | `allergyNotes` |
| | Condiciones médicas relevantes | textarea | no | | `medicalConditions` |
| | Medicamentos actuales | textarea | no | | `currentMedications` |
| | Enfermedades crónicas | textarea | no | | `chronicDiseases` |
| | Antecedentes dentales | textarea | no | | `dentalHistory` |
| Etiquetas | Etiqueta (Enter o coma agrega) | text + chips | no | únicas | `tags[]` |

> El formulario **no** incluye `motivoConsulta` (se edita en la ficha) ni el audio.

### 3.7 Ficha del paciente (`FichaPaciente.tsx`)

Cabecera: foto (clic → cambiar foto, `PATCH /patients/:id/photo`), nombre, RUT, edad, píldoras de alergias y etiquetas; botones "Nueva cita" (`NewAppointmentModal` con paciente precargado) y "Editar" (`PatientFormModal`). Al abrir, si módulo cartola activo y `GET /ledger/balance` > 0 → `DebtNotificationModal` (sonido + "Ver cartola" / "Enviar recordatorio de pago" → `POST /ledger/send-email`).

Pestañas (visibles según módulos/permisos): **Datos paciente, Horas, Tratamientos, Evoluciones, Cartola, Observaciones, Documentos clínicos, Módulo Rx, Consentimientos**.

#### 3.7.1 Pestaña "Datos paciente"
Solo lectura de todos los campos del paciente (contacto, resumen de citas, datos personales, contacto de emergencia, seguimiento clínico con próxima/última cita, antecedentes médicos) **más** la tarjeta editable **Motivo de consulta**:

| Campo | Input | Notas |
|---|---|---|
| Motivo de consulta | textarea + botón Guardar | `PATCH /patients/:id { motivoConsulta }` |
| Grabación de respaldo | botón grabar/detener (MediaRecorder → `audio/webm`) + reproductor + "Grabar de nuevo" | Bloqueado hasta que exista consentimiento `grabacion_voz` firmado (link "Ir a Consentimientos"). `PATCH /patients/:id/motivo-consulta-audio` |

#### 3.7.2 Pestaña "Horas"
Historial de citas del paciente (fecha, horario, profesional, sillón, estado), botón "Cancelar" en citas futuras (`DELETE /appointments/:id`), tarjetas Próxima cita / Última cita atendida. Sin campos nuevos.


#### 3.7.3 Pestaña "Tratamientos" (`TreatmentPlanTab.tsx`)

Muestra: donut "No tratado vs. tratado" (filtro por presupuesto), tarjeta "Abonado vs. no abonado" (**placeholder, sin datos**), "Historial de zonas tratadas" (solo clínicas estética/ambas: mapa facial con zonas resaltadas del presupuesto más reciente, foto "Antes" por zona, "Ver historial" → `PlanHistoryModal` → `PlanDetailModal` de solo lectura), lista de presupuestos (`PlanCard`) con buscador (si > 3).

**`PlanCard`** (por presupuesto):
- Select de estado (`sin_iniciar / en_tratamiento / terminado / alta`) → `PATCH /treatment-plans/:id {status}`; deshabilitado si `alta`.
- Muestra N°, nombre, fecha, profesional (o `remoteProfessionalName`), sucursal, convenio, previsión, total, avance x/y %, trazabilidad ("Creado por", "Pasó a tratamiento el…", "Completado el…").
- Botones: **Modificar** (abre `TreatmentPlanFormModal` en modo edición; exige motivo vía `ReasonModal` si está `en_tratamiento` → `POST /treatment-plans/:id/edits`), **Evolucionar** (confirm → salta a pestaña Evoluciones preseleccionando el único ítem pendiente), **Eliminar** (confirm → `DELETE`), **Generar informe** (solo `alta`; `ReportFormatModal` PDF/Word → `GET /treatment-plans/:id/report?format`).
- Expandido: por ítem checkbox `completed` (debounce 400 ms → `PATCH /treatment-items/:id {completed}`), descripción, pieza/zona, badges de vencimiento de producto (vencido / vence en ≤30 días), costo, botón editar (`EditItemModal`), botón eliminar (confirm, motivo si en tratamiento). `ItemDetailsPanel`: tratado por/fecha, producto/lote/vence/cantidad, notas, alertas (falta producto; falta sticker ficha/paciente), fotos del procedimiento.
- Estética: `PlantillaFotografica` (subir foto → `PhotoEditorModal` → `POST /treatment-plans/:id/photos` con label "`Zona` — `Antes|Después`"; select de 14 zonas + toggle Antes/Después; eliminar foto).
- Agregar procedimiento a plan existente:
  - Estética: inputs "Nuevo procedimiento…" (text) + "Costo" (number) → `POST /treatment-plans/:id/items` (sin prestación, sin zona).
  - Dental: buscador de prestaciones del catálogo (categoría ≠ estética) → al elegir, `Odontogram` en el modo de la prestación, costo precalculado con descuento del convenio; o modo "fuera de catálogo" con Descripción + Costo + odontograma libre. Genera un ítem por pieza en modos `tooth/extraction/surface`.

**`EditItemModal`** — "Editar procedimiento":

| Campo | Input | Notas |
|---|---|---|
| Descripción | text | obligatorio |
| Pieza(s) (dental) | text libre ("Ej: 11, 12") | → `toothNumber` |
| Zona (estética) | `FacialMap` modo tooth (multi‑zona) + selector género | → `toothNumber` con etiquetas de zona |

`PATCH /treatment-items/:id { description, toothNumber }`. No edita costo/producto/notas.

#### 3.7.4 `TreatmentPlanFormModal` — "Nuevo presupuesto" (asistente 3 pasos) / "Modificar presupuesto Nº"

**Paso 1 — Datos administrativos**

| Campo | Input | Obligatorio | Opciones |
|---|---|---|---|
| Tipo de diagrama | toggle Odontograma / Mapa facial | sí (solo clínica `ambas`) | bloqueado si ya hay prestaciones |
| Clínica (sucursal) | select | sí | sucursales activas |
| Previsión | select | no | previsiones activas |
| Convenio | select | sí | convenios activos (muestra -%) |
| Profesional | select | no | **solo admin**; default "Yo mismo" |

**Paso 2 — Prestaciones**
- Buscar prestación (text, autocompletar hasta 8 por nombre/código; muestra precio o "Precio según zona"). Botones "Avanzada" y "Plantillas" **deshabilitados ("Próximamente")**.
- Al elegir: si la zona es inequívoca (modo `session`, una sola zona permitida, o zonas "juntas") y no hay alergia en conflicto ni trazabilidad requerida → se agrega directo. Si no, banner amarillo con:
  - Instrucción del modo; selección en `Odontogram` (piezas/caras/cuadrante/sextante/arcada) o `FacialMap` (zonas, con `allowedZones` de la prestación, herramientas de dibujo lápiz/línea/círculo/borrador, zoom 1–2.5×, deshacer/rehacer, vistas frontal/perfil derecho/izquierdo, toggle género hombre/mujer, capa piel/músculos —músculos deshabilitada por constante—).
  - Alerta roja si el nombre de la prestación contiene un alérgeno del paciente (`allergenDetection`: flúor, anestésicos, penicilina, látex, yodo, níquel/metal, AINEs).
  - Si `requiresProductTracking`: **Buscar lote real** (text, ≥2 chars, debounce 300 ms → `GET /catalogs/product-lots?q` a inventario Dental-Demo; muestra producto, lote, stock, vence; no se puede tipear a mano; rechaza stock 0) → rellena `productName`, `productLot`, `productExpiresAt`; campo **Cantidad aplicada** (text). 
  - Notas clínicas (textarea) → `notes`.
  - "Agregar prestación" / "Cancelar".
- Panel derecho: convenio actual y lista "Prestaciones agregadas" (área, descripción, detalle de piezas/zonas, **costo editable** (number), quitar; en modo edición los ítems existentes se marcan "Ya en el presupuesto" y pueden editarse (`EditItemModal`) o quitarse (`DELETE /treatment-items/:id`) con motivo si está en tratamiento). Total.
- Estética: pestaña "Plantilla fotográfica" (select zona + Antes/Después + file → `PhotoEditorModal`; se suben al crear).
- Ítems "fuera de catálogo": estados `customDescription`/`customCost` existen en el código pero el botón para activarlo (`setShowCustomItem`) **no está expuesto en la UI actual** (solo declarado).

**Paso 3 — Totales y forma de pago**
Tabla resumen (prestación, área, valor, dcto convenio, total) y:

| Campo | Input | Obligatorio | Opciones |
|---|---|---|---|
| Nombre del presupuesto | text | no | |
| Forma de pago | select | no | Contado / Cuotas |
| Observaciones generales | textarea | no | |

"Crear presupuesto" → `POST /treatment-plans` (items con description, cost, prestacionId, toothNumber, listPrice, convenioDiscountPercent, notes, productName, productLot, productExpiresAt, productQuantity; facialAnnotations y facialGender si estética) y luego sube fotos pendientes.
Modo edición: solo agrega ítems nuevos (`POST /treatment-plans/:id/items` uno a uno); sucursal/convenio/previsión/pago quedan fijos.

#### 3.7.5 Pestaña "Evoluciones" (`EvolucionesTab.tsx`)

Botones: "Crear próximo control" (`NewAppointmentModal` type `control`), "Próximos controles" (modal lista de controles futuros).

Formulario "Crear nueva evolución":

| Campo | Input | Obligatorio | Notas |
|---|---|---|---|
| ¿Documenta un procedimiento del presupuesto? | select (ítems no completados de todos los planes: "N° x · nombre — descripción") | no | → `treatmentItemId` |
| Producto | text | sí si la prestación exige trazabilidad | → `productName` |
| N° de lote | text | idem | → `productLot` (aquí sí se tipea a mano) |
| Fecha de vencimiento | date | idem | → `productExpiresAt` |
| Cantidad | text | idem | → `productQuantity` |
| Fotos (antes/después, sticker) | file `image/*` múltiple, con etiqueta seleccionada: Antes / Después / Sticker ficha / Sticker paciente | no | Se suben tras crear (`POST /evolutions/:id/photos`) |
| Profesional | select | no | **solo admin** |
| Sección | select (secciones de plantillas) | no | filtra plantillas |
| Predefinidas… | select (plantillas) | no | inserta HTML al contenido |
| Botón "Generar alta" | — | — | inserta plantilla de sección "Alta" |
| Contenido de la evolución | `RichTextEditor` (HTML) + Previsualizar | sí | → `content` |

"Grabar" → `POST /evolutions`. Panel derecho: filtro por profesional, imprimir (`window.print`), tabs Habilitadas/Deshabilitadas/Todas, tarjetas con Deshabilitar/Habilitar (`PATCH enabled`), Eliminar (→ `ReasonModal` motivo → `DELETE /evolutions/:id {reason}`), fotos con eliminar.

#### 3.7.6 Pestaña "Cartola" (`CartolaTab.tsx`)

Botones "Enviar por correo" (`POST /ledger/send-email`) y "Descargar PDF". Tabla "Listado de presupuestos" (N°, fecha, profesional, subtotal, interés, ajustes, total, abonado, saldo + totales). Secciones colapsables **Abonos libres**, **Intereses generados**, **Ajustes** (cada una con botón + → `LedgerMovementFormModal` del tipo correspondiente y eliminar por fila si es autor/admin) y **Saldo total** (libro completo: comprobante, N° mov., fecha, debe, haber, presupuesto, glosa, descripción pago, N° documento, observación).

**`LedgerMovementFormModal`** — "Nuevo abono / interés / ajuste":

| Campo | Input | Obligatorio | Visible en | Destino |
|---|---|---|---|---|
| Presupuesto | select (vacío = abono libre) | no | todos | `treatmentPlanId` |
| Monto | number ≥1 | sí | todos | `amount` |
| Dirección | select Debe (aumenta saldo) / Haber (disminuye) | sí | ajuste | `direction` |
| Forma de pago | select Efectivo/Transferencia/Tarjeta/Cheque/Otro | sí | abono | `paymentMethod` |
| N° documento | text | no | abono | `documentNumber` |
| Glosa | text | no | todos | `description` |
| Observación | textarea | no | todos | `notes` |

#### 3.7.7 Pestaña "Observaciones" (`ObservacionesTab.tsx`)

| Campo | Input | Obligatorio | Notas |
|---|---|---|---|
| Fecha | solo lectura (hoy) | — | no se envía; el backend usa `createdAt` |
| Realizado por | select (solo admin) / texto | no | → `professionalId` |
| Observación | textarea | sí | → `content` |

"Grabar" → `POST /observations`. Historial con eliminar (autor/admin).

#### 3.7.8 Pestaña "Documentos clínicos" (`DocumentosClinicosTab.tsx`)

Tabs de categoría: Recetas Médicas, Derivaciones, Imágenes, Archivos, Documentos de Altas, Solicitud Laboratorio, Documento Pabellón, Solicitud Pabellón.

| Campo | Input | Obligatorio |
|---|---|---|
| Archivo | file (cualquier tipo, ≤20 MB) | sí |
| Descripción (opcional) | text | no |

"Subir" → `POST /documents` (categoría activa). Lista con descargar y eliminar.

#### 3.7.9 Pestaña "Módulo Rx" (`RxTab.tsx`)

- Admin: sección "Configuración de integración RIDS RX": por cada sucursal un input **ID clínica en RIDS RX** (onBlur → `PATCH /catalogs/sucursales/:id {dimageClinicId}`).
- "Datos en Plataforma": nombre, identificación, email, fecha nacimiento del paciente en RIDS RX; botón "Actualizar datos en Plataforma" (`POST /rx/patient-sync`); "Crear Orden" (no radiólogos).
- Tabla de órdenes (id, estado, odontólogo, radiólogos, exámenes) con acciones Ver detalle, Enviar a radiólogo (si editable), Descargar PDF.

**`CreateRxOrderModal`** — "Crear orden Rx":

| Sección | Campo | Input | Obligatorio | Opciones |
|---|---|---|---|---|
| Datos de la orden | Clínica | select (solo sucursales con `dimageClinicId`) | sí | |
| | Odontólogo | select (admin) / fijo "yo mismo" | sí | |
| | Paciente | fijo | — | |
| | Prioridad | select | sí | 1 día / 2 días / 3 días / Normal / Urgente |
| Diagnóstico clínico | Examen sin diagnóstico clínico | checkbox | — | si marcado envía "Sin diagnóstico" |
| | Diagnóstico | textarea | sí (si no marcado) | |
| | Observaciones | textarea | no | |
| Tipos de examen | catálogo remoto | checkboxes por grupo, tabs intraorales/extraorales | ≥1 | |
| Detalle por examen | Observación / URL del examen | text | no | → `urlTexto` |
| | Archivos | file múltiple | no | se suben tras crear (`POST /rx/orders/:id/files/:examinationId`) |
| | Especificar piezas | `Odontogram` modo extracción | no | → `dientes[]` |

Botones "Guardar borrador" (`POST /rx/orders`) y "Enviar a radiólogo" (+ `PATCH /rx/orders/:id/send`).

**`RxOrderDetailModal`** — "Orden Rx N°": campos editables si `editable`: Diagnóstico (text), Prioridad (select Normal/Urgente), Observaciones (textarea) → `PUT /rx/orders/:id`. Por examen: archivos (Ver en 3D si `ruta_dcm` → abre `/visor3d/index.html?file=…` con token; descargar; eliminar), adjuntar archivos. Botones PDF / ZIP.

#### 3.7.10 Pestaña "Consentimientos" (`ConsentimientosTab.tsx`)

Una tarjeta por tipo de consentimiento (13): estado (No enviado / Pendiente / Firmado / Rechazado / Expirado), último envío, vence, respondido, firmante. Admin: gestión de PDF propio del tipo (Ver / Subir / Reemplazar / Quitar → `POST|DELETE /data-consents/types/:id/pdf`, `accept=application/pdf`). Botones: "Descargar PDF" (del consentimiento), "Ver / Firmar consentimiento" (`ConsentimientoPreviewModal`), "Enviar/Reenviar consentimiento" (requiere email → `POST /data-consents`). Auto‑refresco cada 20 s y al volver a la pestaña.

**`ConsentimientoPreviewModal`** — firma presencial:

| Campo | Input | Obligatorio |
|---|---|---|
| Documento | iframe PDF o texto legal | — |
| Nombre completo | text (prellenado con el paciente) | sí |
| RUT | text auto‑formato (prellenado) | sí, válido |
| "El paciente leyó y comprende este documento" | checkbox | sí |
| Firma del paciente | `SignaturePad` | sí para Aceptar |

Botones "Aceptar y firmar" / "Rechazar" → `POST /data-consents/:patientId/:consentTypeId/respond`.

### 3.8 Consentimiento público (`pages/consentimiento/ConsentimientoPublico.tsx`, ruta `/consentimiento/:token`)

Sin sesión. Muestra nombre del paciente, tipo, documento (PDF o texto). Campos: Nombre completo (text, sí), RUT (text, sí, válido), "He leído y comprendo este documento" (checkbox, sí), Firma (`SignaturePad`, sí para aceptar). Botones Aceptar y firmar / Rechazar → `POST /public/consents/:token/respond`. Estados: link inválido, vencido, ya respondido, éxito.


### 3.9 Profesionales (`pages/profesionales/Profesionales.tsx`, solo admin)

Tabla de usuarios de la clínica (Nombre, Correo, **RUT editable inline** onBlur → `PATCH /users/:id {rut}`, Rol) con botones "Permisos" (`PermisosUsuarioModal`) y "Horario" (`ScheduleModal`, roles odontologo/radiologo/operador). Botones superiores: "Importar desde RIDS RX" (si `rxEnabled`; → `POST /users/import-from-dimage`; muestra `GeneratedPasswordDialog` con contraseñas generadas), "Agregar profesional". Debajo: `PermisosPerfilPanel`.

**`ProfessionalFormModal`** — "Agregar profesional":

| Campo | Input | Obligatorio | Opciones |
|---|---|---|---|
| Nombre completo | text | sí | |
| Correo electrónico | email | sí | único global |
| Contraseña | password minLength 8 | sí | |
| Rol | select | sí | Odontólogo / Radiólogo / Operador / Administrador |
| RUT | text auto‑formato | no | válido si se completa |
| Firma | `SignaturePad` (120 px) | no | → `signatureDataUrl` |

`POST /users`. Si RIDS RX generó contraseña (radiólogo) se muestra una vez.

**`ScheduleModal`** — "Horario de {nombre}": lista por día (Domingo…Sábado) de bloques con eliminar; formulario:

| Campo | Input | Obligatorio | Opciones |
|---|---|---|---|
| Día | select | sí | Domingo–Sábado (0–6) |
| Desde | time | sí | default 09:00 |
| Hasta | time | sí | default 13:00 |
| Sillón | select | no | Cualquiera / sillones |

`POST /work-schedules`.

**`PermisosPerfilPanel`** — matriz de checkboxes 10 permisos × 3 perfiles (Pacientes, Agenda y citas, Planes de tratamiento, Crear presupuestos, Documentos clínicos, Cartola, Evoluciones, Observaciones, Consentimientos, Módulo Rx) → `PATCH /clinica/role-permissions`.

**`PermisosUsuarioModal`** — "Permisos individuales · {nombre}": por cada llave un toggle de 3 estados **Hereda (sí/no) / Sí / No**; sección "Pantallas" (9 permisos; solo roles odontologo/radiologo/operador) y "Módulos (plan de la clínica)" (8 módulos; aplica a todos los roles) → `PATCH /users/:id/permissions`.

**`GeneratedPasswordDialog`**: muestra contraseñas generadas (RIDS RX / importación) con botón copiar.

### 3.10 Catálogo (`pages/catalogo/Catalogo.tsx`, solo admin) — 5 pestañas

#### Prestaciones
Tabla (Nombre + badges "Lote"/"Todo el rostro", Código, Precio o "Según zona", Tipo [solo `ambas`], Modo odontograma [no estética], Zonas [estética], Estado toggle Activa/Desactivada → `PATCH active`, editar, eliminar).

**`PrestacionFormModal`** — "Nueva/Editar prestación":

| Campo | Input | Obligatorio | Visible | Destino |
|---|---|---|---|---|
| Nombre | text | sí | siempre | `name` (recalcula modo sugerido mientras no se toque el select) |
| Tipo de prestación | toggle Dental / Estética | sí | solo clínica `ambas` | `category` |
| Código | text | no | siempre | `code` |
| Precio | number ≥0 | sí | siempre | `basePrice` |
| Modo de selección en el odontograma | select 7 modos (Sesión, Pieza completa, Cara, Extracción, Cuadrante, Sextante, Arcada) | no | dental | `odontogramMode` |
| Requiere registrar producto y lote | checkbox | no | estética | `requiresProductTracking` |
| Aplica siempre a todo el rostro | checkbox | no | estética | `appliesToWholeFace` |
| Zonas donde puede aplicarse | toggle Sin restricción / Zonas específicas + 14 checkboxes | no | estética y no todo el rostro | `allowedZones` |
| Al usar en un presupuesto… | toggle "El profesional elige cuáles aplican" / "Se aplican todas juntas" | no | 2+ zonas | `zonesApplyTogether` |
| Precio | toggle "Mismo precio para todas" / "Precio distinto por zona" + number por zona | no | 2+ zonas | `zonePrices` |

#### Convenios (`ConveniosTab`)
Alta inline: Nombre (text, sí) + Descuento % (number 0–100). Tabla: nombre, descuento **editable inline** (onBlur), toggle Activo, eliminar.

#### Previsiones (`PrevisionesTab`)
Alta inline: Nombre (text, sí). Tabla: nombre, toggle Activa, eliminar.

#### Clínicas / sucursales (`ClinicasTab`)
Alta inline: Nombre (text, sí) + Dirección (opcional). Tabla: nombre **editable inline**, dirección (solo lectura), toggle Activa, eliminar.

#### Inventario (`InventarioTab`) — vive en Dental-Demo-Back
Tarjetas de alertas (lotes vencidos, por vencer, sin stock, bajo stock). Filtros: búsqueda (nombre/proveedor), categoría (10), proveedor (text), estado (Todos/Activo/Bajo stock/Sin stock/Archivado), sede (si >1). Tabla: nombre, categoría, sede, proveedor, stock/mín, costo total, estado; acciones Lotes (`LotesModal`), editar, archivar.

**`InsumoFormModal`** — "Nuevo/Editar insumo":

| Campo | Input | Obligatorio | Opciones |
|---|---|---|---|
| Nombre del insumo | text | sí | |
| Sede | select sucursales | sí (si hay sucursales) | se matchea por nombre al editar |
| Consultorio | select | no | Consultorio 1–5, Sala RX, Pabellón menor |
| Categoría | select | no | 10 categorías |
| Proveedor | text | no | |
| Descripción | textarea | no | |
| Fecha de compra | date | no | default hoy |
| Unidad | select | no | unidad, caja, paquete, frasco, tubo, ml, kit |
| Cantidad comprada | number | no | |
| Costo unitario | number | no | total = cantidad × unitario si no se tocó |
| Costo total | number | no | |
| Stock actual | solo lectura | — | |
| Stock mínimo | number | no | |

**`LotesModal`** — lista de lotes (lote, fabricante, vencimiento, cantidad, estado) + "Nuevo lote", "Movimiento", editar.

**`LoteFormModal`**: N° de lote (text, sí), Fabricante, Presentación, Concentración, Registro sanitario (text), Fecha de recepción (date), Vencimiento (date, vacío = sin vencimiento), Cantidad inicial/actual (number ≥0, sí).

**`MovimientoModal`**: Tipo (radio: Entrada / Salida / Ajuste), Cantidad (number >0, sí; "Cantidad final" en ajuste), Motivo (text; obligatorio en ajuste).

### 3.11 Super‑admin — Holdings (`pages/superadmin/*`)

**`Clinicas.tsx`** — tabla de holdings (logo, nombre, tipo · país, RUT, estado, pacientes, monto total). "Crear holding" → `CrearClinicaModal`.

**`CrearClinicaModal`**:

| Campo | Input | Obligatorio | Opciones |
|---|---|---|---|
| Logo del holding | file png/jpeg/webp ≤5 MB | no | |
| Nombre del holding | text | sí | |
| RUT | text auto‑formato | no | válido |
| Tipo | select | sí | Dental / Estética facial / Dental y estética |
| País | select | sí | 13 países |
| Administrador inicial: Nombre completo | text | sí | |
| Correo electrónico | email | sí | |
| Contraseña | password ≥8 | sí | |

`POST /clinicas` (multipart).

**`ClinicaDetail.tsx`** — configuración del holding:
- Logo (clic → `PATCH /clinicas/:id/logo`), toggle **Activo**.
- **Federación con Dental-Demo**: toggle Conectada/No conectada (`POST connect/disconnect` con confirm), y si conectada: toggle "Conexión activa" (`federationPaused` invertido), toggle "Solo catálogo" (`federationCatalogOnly`), 6 toggles "Conexiones individuales" (Pacientes, Citas, Presupuestos y tratamientos, Profesionales, Sucursales, Catálogo → `federationSyncSettings`).
- RUT (text + Guardar), Tipo de holding (select), País (select) → `PATCH /clinicas/:id`.
- Métricas (10 tiles) y consentimientos de protección de datos.
- **Módulos habilitados**: toggle Módulo Rx (oculto si tipo estética) + 8 toggles de módulos → `PATCH /clinicas/:id {rxEnabled | modules}`.

**`ModuloConsumo.tsx`** (`/admin/modulos/:moduleKey`) — por módulo (pacientes, agenda, tratamientos, documentosClinicos, cartola, evoluciones, observaciones, consentimientos, rx): KPIs, gráficos de barras por holding, tabla de detalle con búsqueda (usa `GET /clinicas/pacientes|citas|tratamientos|documentos|cartola|evoluciones|observaciones`), y tabla "Habilitar por holding" con toggle (`PATCH /clinicas/:id`). Rx: "No disponible aún".

---

## 4. Funcionalidades y flujos

### 4.1 Autenticación y sesión
1. `POST /auth/login` → access token en memoria (axios interceptor `Authorization: Bearer`) + cookie refresh.
2. Al cargar la app, `AuthProvider` llama `POST /auth/refresh`; en 401 de cualquier request, el interceptor reintenta tras refrescar una vez.
3. Clínica desactivada → 403 en login/refresh.
4. Super‑admin no tiene `clinicaId`; solo usa `/admin/*`.

### 4.2 Roles y permisos (3 niveles)
- **Plan de la clínica** (`Clinica.modules`, `rxEnabled`): lo administra el super‑admin. Oculta pestañas/menús y bloquea rutas (`requireModuleEnabled`, `requireRxEnabled`).
- **Perfil** (`Clinica.rolePermissions`): el admin decide qué ven odontólogo/radiólogo/operador (10 llaves, incl. `crearPresupuestos`). Admin y super‑admin siempre completo.
- **Excepciones por usuario** (`User.permissionOverrides`, `User.moduleOverrides`): hereda / sí / no. Los overrides de módulo aplican incluso a admins.
- Reglas adicionales por propiedad: solo el autor o admin puede eliminar evoluciones, observaciones, documentos y movimientos; solo admin o el profesional de la cita puede cancelar/avanzar la cita; radiólogos no crean órdenes Rx; admin puede asignar otro profesional en citas, presupuestos, evoluciones, observaciones y órdenes Rx.

### 4.3 Agenda y circuito del paciente
Sillones (boxes) por clínica; citas sin solape por sillón; bloques configurables 15/30/60. Tipos: cita, control (desde Evoluciones), urgencia (asigna primer sillón libre, nace en `llego`, con motivo y triage). Circuito de estados: `agendada → llego (arrivedAt) → en_atencion (attentionStartedAt) → finalizada (attentionEndedAt)`; `cancelada` es soft (no se borra). Al crear cita se envía correo de confirmación al paciente (MS Graph) y se sincroniza a Dental-Demo. Horarios de trabajo (`WorkSchedule`) se registran por profesional/día/sillón pero **no se usan para validar ni pintar la agenda** (solo se listan en el modal).

### 4.4 Pacientes
Ficha completa (identificación, contacto, datos personales, previsión informativa, contacto de emergencia, antecedentes médicos con vocabulario fijo de alergias, etiquetas, foto, motivo de consulta con grabación de voz). Detección automática de alérgenos al elegir prestaciones. Al crear: sync a RIDS RX (si Rx) y Dental-Demo. RUT único por clínica.

### 4.5 Presupuestos / planes de tratamiento
Asistente de 3 pasos. Diagrama según tipo de clínica: **odontograma** (32 piezas permanentes + 20 temporales, 5 caras, modos sesión/pieza/cara/extracción/cuadrante/sextante/arcada; sugerencia de modo por palabras clave del nombre de la prestación) o **mapa facial** (14 zonas, fotos base hombre/mujer frontal y perfiles, capa piel/músculo, anotaciones libres guardadas como JSON, precio por zona opcional, plantilla fotográfica antes/después por zona). Descuento por convenio aplicado a precio de lista. Estado derivado de ítems completados; `alta` congela el plan y habilita el **informe PDF/DOCX** (con fotos). Trazabilidad: quién creó, quién inició, quién completó, quién trató cada ítem; modificaciones de un plan en tratamiento exigen motivo (`TreatmentPlanEdit`). Trazabilidad de producto/lote con alertas de vencimiento y stickers faltantes; lote real obligatorio desde inventario Dental-Demo para prestaciones con `requiresProductTracking`.

### 4.6 Evoluciones
Notas clínicas en HTML con plantillas (seed: Control de rutina, Post operatorio, Anamnesis inicial, Alta odontológica). Pueden documentar un ítem del presupuesto → lo marca realizado, copia producto/lote y fotos al ítem. Habilitar/deshabilitar; borrar solo con motivo (auditoría `EvolutionDeletion`). Impresión vía navegador.

### 4.7 Cartola (cuenta corriente del paciente)
Cargo = monto del presupuesto; movimientos: abonos (con forma de pago y N° documento), intereses, ajustes (debe/haber); abonos libres sin presupuesto. Saldo por plan y total. PDF y envío por correo (recordatorio de deuda automático al abrir la ficha con saldo > 0, con sonido).

### 4.8 Observaciones administrativas y Documentos clínicos
Notas internas de texto plano por paciente. Documentos por 8 categorías subidos a Cloudinary (cualquier tipo, ≤20 MB) con descripción.

### 4.9 Consentimientos informados
13 tipos por clínica (texto legal editable **solo por PDF propio**, no por texto desde UI). Envío por correo con link público de 7 días o firma presencial; ambos exigen nombre, RUT válido, confirmación de lectura y firma dibujada (PNG) para aceptar; se registran IP y user‑agent; se genera/copia PDF y se envía al paciente. El consentimiento `proteccion_datos` alimenta filtros y KPIs; `grabacion_voz` habilita la grabación del motivo de consulta.

### 4.10 Módulo Rx (RIDS RX / DIMAGE)
Sincroniza pacientes y profesionales (odontólogos/radiólogos por RUT; radiólogos reciben contraseña propia) con RIDS RX; importa staff existente. Crea/edita/envía órdenes radiológicas con catálogo de exámenes remoto, piezas por odontograma, adjuntos (hasta 3 GB, streaming), PDF/ZIP. Visor 3D Med3Web servido desde `/visor3d` que lee DICOM vía `/api/rx-viewer/:token/*` desde el S3/MinIO de RIDS RX. Requiere `Sucursal.dimageClinicId`.

### 4.11 Inventario
No local: CRUD de insumos, lotes, movimientos y alertas contra Dental-Demo-Back vía federación (solo admin). El buscador de lotes del presupuesto usa el mismo inventario.

### 4.12 Super‑admin
Crear holdings con admin inicial y logo; activar/desactivar; tipo/país/RUT; módulos y Rx por holding; federación (conectar/desconectar/pausar/solo catálogo/switches por entidad); dashboards de consumo por módulo con datos agregados de toda la plataforma.

### 4.13 Correo (Microsoft Graph)
Plantillas HTML: confirmación de cita, solicitud de consentimiento (link), PDF de consentimiento firmado (adjunto), cartola / recordatorio de pago (adjunto PDF). Token client‑credentials cacheado con reintento en 401/403.

### 4.14 Generación de documentos
- `consentPdf.ts`: PDF A4 con logo, clínica, paciente, texto, estado, firmante, fecha, método, IP, imagen de firma.
- `cartolaPdf.ts`: cartola con logo, tablas de presupuestos, movimientos y libro.
- `treatmentPlanReportPdf.ts` / `treatmentPlanReportDocx.ts`: informe de presupuesto de alta (dental u odontológico vs. estética), ítems, tratado por, notas, galería de fotos.


---

## 5. Brechas: "datos sueltos" entre modelo, API y UI

### 5.1 Campos del modelo que **no se pueden cargar/editar desde ningún formulario del frontend**

| Modelo.campo | Situación | Cómo se llena hoy |
|---|---|---|
| `Clinica.name` | API `PATCH /clinicas/:id` acepta `name`, pero `ClinicaDetail` no tiene input de nombre | Solo al crear el holding o por federación |
| `Clinica.rolePermissions` | Editable (matriz) — OK | — |
| `Clinica.federatedClinicId` | Nunca editable a mano | Conectar federación / mirror |
| `User.name`, `User.email`, `User.role`, `User.passwordHash` | **No hay edición**: `PATCH /users/:id` solo acepta `rut`. No existe cambio de contraseña, recuperación ni edición de perfil | Solo al crear |
| `User.signatureUrl` | Solo al crear el usuario (`ProfessionalFormModal`). El texto de la UI dice "puedes agregarla después desde su perfil", pero **no existe esa pantalla ni endpoint** | Creación |
| `User.moduleOverrides` para admin | Editable vía PermisosUsuarioModal — OK | — |
| `Chair.name`, `Chair.active` | `PATCH /chairs/:id` existe y `api/chairs.updateChair` está definido, pero **ningún componente lo usa** (solo crear y eliminar). No se puede renombrar ni desactivar un sillón; eliminar falla si tiene citas | Creación |
| `Patient.nationality` | Texto libre (sin lista) — OK pero inconsistente con `CountrySelect` usado para teléfono | Formulario |
| `Patient.motivoConsulta` | Solo en la ficha (tarjeta), no en el formulario general | Ficha |
| `Sucursal.address` | Solo al crear; `updateSucursal` acepta `address` pero la tabla no lo edita | Creación |
| `Sucursal.dimageClinicId` | Solo desde la pestaña Rx de la ficha de un paciente (lugar poco intuitivo), no desde Catálogo → Clínicas | RxTab (admin) |
| `ConsentType.name`, `ConsentType.legalText`, `ConsentType.active`, `ConsentType.code` | **Sin endpoint de creación/edición**. Solo se pueden sembrar los 13 por defecto (con textos placeholder "[Este es un texto de ejemplo…]") y reemplazar por PDF. No se puede crear un tipo nuevo ni desactivar uno | Auto‑seed |
| `Consent.signerIp`, `userAgent`, `contentSnapshot`, `token`, `pdfSnapshotUrl` | Automáticos — OK | Backend |
| `TreatmentPlan.name`, `notes`, `paymentMethod`, `professionalId` (post‑creación) | `PATCH /treatment-plans/:id` los acepta, pero la UI solo envía `status`. No se pueden corregir después de crear | Creación |
| `TreatmentPlan.facialAnnotations`, `facialGender` (post‑creación) | Solo al crear; el modo "Modificar" no los reenvía | Creación |
| `TreatmentItem.cost` (post‑creación) | `PATCH` lo acepta; `EditItemModal` no lo expone | Creación |
| `TreatmentItem.notes`, `productName`, `productLot`, `productExpiresAt`, `productQuantity` (edición) | `PATCH` los acepta; solo se cargan al crear el ítem (presupuesto) o al evolucionar. No hay edición posterior | Creación / Evolución |
| `TreatmentItemPhoto` directa | `POST /treatment-items/:id/photos` existe y `api.uploadTreatmentItemPhoto` está definido, pero **la UI ya no lo usa**: las fotos de ítem se crean solo como espejo de `EvolutionPhoto` | Evolución |
| `Appointment.notes` (edición), `startAt/endAt`, `chairId`, `professionalId` | **No existe PATCH de cita**: no se puede reprogramar ni editar; solo cancelar y avanzar de estado | Creación |
| `Appointment.durationMinutes` en urgencia | El backend acepta `durationMinutes`; el frontend no lo envía (siempre 30 min) | Default |
| `Evolution.content` (edición) | `PATCH /evolutions/:id {content}` existe; la UI solo alterna `enabled`. No se puede corregir el texto de una evolución | Creación |
| `EvolutionTemplate` (name, section, content, active) | **CRUD completo en backend (`/catalogs/evolution-templates`) sin ninguna pantalla en el frontend**. Solo se consumen las sembradas por `seed.ts` | Seed |
| `WorkSchedule` (edición) | No hay PATCH (solo crear/eliminar) — coherente, pero no se usan en agenda | Modal horario |
| `LedgerMovement.description/notes/paymentMethod` (edición) | Sin PATCH; solo crear/eliminar | Creación |
| `Prestacion.code` a null | UI envía `code: null` al editar si se vacía — OK | — |
| `FederationSyncFailure` | Tabla interna; **sin endpoint ni pantalla** para ver/reintentar fallos de sincronización | Automático |
| `Clinica.federationSyncSettings` | Editable — OK | — |
| Datos capturados en UI pero nunca enviados | `ObservacionesTab` muestra "Fecha" (hoy) pero no se envía; `Dashboard` (Favoritos, Próximas citas, Novedades) es solo placeholder | — |

### 5.2 Cosas que el frontend **espera o envía** pero el backend **no guarda / no expone**

| Elemento | Detalle |
|---|---|
| `Prestacion.markColor`, `mark_color`, `allowMultipleTeeth`, `allow_multiple_teeth`, `defaultTeeth`, `default_teeth`, `defaultSurfaces`, `default_surfaces` | Declarados opcionales en `api/catalogs.ts` y consumidos por `getOdontogramConfig`; **no existen en el schema ni en la API**. Siempre `undefined` (colores/preselección de piezas nunca se configuran) |
| `TreatmentPlanFormModal` ítem "fuera de catálogo" (`customDescription`, `customCost`, `customMode`) | Estado y lógica implementados, pero el botón que activa el modo (`setShowCustomItem`) no está renderizado; solo se puede agregar fuera de catálogo desde `PlanCard` (plan ya creado) |
| `GET /clinicas/federated/overview` | Endpoint completo (local + remoto) sin consumidor en el frontend |
| `RxOrder.otroInput` / `otroinput` | El tipo de entrada lo admite; ningún campo de UI lo llena |
| `sendOrderToRadiologo(staff_ids)` | El cliente DIMAGE acepta `staff_ids`; el endpoint/ UI nunca los envía (se envía a todos) |
| `WorkSchedule` | Se registran pero la agenda no los valida ni los pinta |
| `Clinica.modules` default del schema | Solo 4 llaves; el parser rellena 8 — coherente en runtime, inconsistente en DB |
| `Patient.privacyConsent*` en respuesta | Campos virtuales (derivados de `Consent`), no columnas |
| `User.updatedAt` | Se actualiza pero nunca se expone |

### 5.3 Inconsistencias y observaciones

- `TreatmentPlan.number` y `LedgerMovement.number` son correlativos **globales** (no por clínica): un holding ve numeración con saltos.
- `GET /work-schedules` no filtra por `clinicaId` (fuga potencial entre clínicas si se conoce el `professionalId`).
- Varios endpoints `getOne/update/delete` (pacientes, citas, planes, ítems, evoluciones, observaciones, documentos, sillones, sucursales, previsiones, convenios, prestaciones) **no comprueban que el recurso pertenezca a la clínica del usuario** (solo confían en el id). Consentimientos y cartola sí lo hacen.
- `Patient.healthInsurance` (fonasa/isapre/particular/otro, informativo) coexiste con el catálogo `Prevision` del presupuesto; no están vinculados.
- `phone` por defecto arranca en `+34` (España) en `PatientFormModal` aunque el país por defecto del holding sea Chile.
- `createdByUserId` (legacy) y `createdById` guardan el mismo valor en `TreatmentPlan`.
- El título HTML del front es "frontend" (`index.html`).
- `backend/src/assets/*.jpeg|jfif` no se referencian desde el código.
- `test-pdf.ts` y `test-output.pdf` en la raíz del backend son artefactos de prueba.

---

## 6. Variables de entorno

> Los archivos `.env.example` están protegidos por las reglas del entorno de análisis y no pudieron abrirse; la lista se reconstruyó **a partir de los usos reales en el código** (`process.env.*` en backend, `import.meta.env.*` en frontend), lo que garantiza que corresponde exactamente a lo que la aplicación lee.

### 6.1 Backend (`dentalcloud-backend`)

| Variable | Usada en | Para qué sirve |
|---|---|---|
| `DATABASE_URL` | `prisma/schema.prisma` | Cadena de conexión PostgreSQL |
| `PORT` | `index.ts` | Puerto HTTP (default 4001) |
| `NODE_ENV` | `authController` | `production` → cookie refresh `secure` + `SameSite=None` |
| `FRONTEND_ORIGIN` | `index.ts`, `dataConsentsController` | Orígenes CORS (lista separada por comas, sin slash final) y base del link público de consentimiento (`{origen}/consentimiento/{token}`; default `http://localhost:5173`) |
| `JWT_ACCESS_SECRET` | `utils/tokens` | Firma del access token y del token del visor DICOM (2h) |
| `JWT_ACCESS_EXPIRES_IN` | `utils/tokens` | Expiración access token |
| `JWT_REFRESH_SECRET` | `utils/tokens` | Firma del refresh token |
| `JWT_REFRESH_EXPIRES_IN` | `utils/tokens` | Expiración refresh token |
| `CLOUDINARY_CLOUD_NAME` | `lib/cloudinary`, `cloudinaryUpload`, `documentsController` | Cuenta Cloudinary (fotos, logos, firmas, documentos, PDFs, audio) |
| `CLOUDINARY_API_KEY` | idem | Credencial Cloudinary |
| `CLOUDINARY_API_SECRET` | idem | Credencial Cloudinary |
| `MS_GRAPH_TENANT_ID` | `lib/mailer` | Tenant Azure AD para OAuth client‑credentials |
| `MS_GRAPH_CLIENT_ID` | `lib/mailer` | App registration |
| `MS_GRAPH_CLIENT_SECRET` | `lib/mailer` | Secreto de la app |
| `MS_GRAPH_SENDER` | `lib/mailer` | Buzón remitente (`/users/{sender}/sendMail`) |
| `DIMAGE_API_URL` | `lib/dimageClient` | Base URL de la API v3 de RIDS RX / DIMAGE |
| `DIMAGE_API_KEY` | `lib/dimageClient` | Header `X-API-KEY` hacia RIDS RX |
| `RIDSRX_S3_ENDPOINT` | `lib/ridsRxStorage` | Endpoint S3/MinIO donde RIDS RX guarda los DICOM |
| `RIDSRX_S3_REGION` | idem | Región (default `us-east-1`) |
| `RIDSRX_S3_BUCKET` | idem | Bucket (prefijo `ordenes/{orderId}/`) |
| `RIDSRX_S3_ACCESS_KEY_ID` | idem | Credencial S3 |
| `RIDSRX_S3_SECRET_ACCESS_KEY` | idem | Credencial S3 |
| `DENTALDEMO_API_URL` | `lib/federationClient` | Base URL de Dental-Demo-Back (federación e inventario) |
| `FEDERATION_API_KEY` | `federationClient`, `requireFederationOrSuperAdmin` | Clave compartida: se envía como `X-API-KEY` hacia Dental-Demo y se exige en las llamadas entrantes de Dental-Demo a `/api/clinicas/*` |

### 6.2 Frontend (`dentalcloud-front`)

| Variable | Usada en | Para qué sirve |
|---|---|---|
| `VITE_API_URL` | `api/client.ts`, `api/publicConsent.ts`, `RxOrderDetailModal` | Base URL del backend (`…/api`). En el visor 3D se reescribe `localhost` → `127.0.0.1` |

---

## 7. Conexión con Dental-Demo (federación)

### 7.1 Qué es
Dental-Demo-Back es la "plataforma de administración" hermana (inventario, holdings, agenda, presupuestos). DentalCloud y Dental-Demo se **espejan mutuamente** con una clave compartida (`FEDERATION_API_KEY`, header `X-API-KEY`) y guardan el id del par en columnas `federated*Id` (`Clinica.federatedClinicId`, `User.federatedUserId`, `Patient.federatedPatientId`, `Appointment.federatedAppointmentId`, `TreatmentPlan.federatedTreatmentPlanId`, `TreatmentItem.federatedTreatmentItemId`, `Sucursal.federatedSucursalId`, `Prevision.federatedPrevisionId`, `Convenio.federatedConvenioId`, `Prestacion.federatedPrestacionId`).

### 7.2 Configuración
- Backend: `DENTALDEMO_API_URL` + `FEDERATION_API_KEY` (`isFederationConfigured()`); sin ellas todo el sync se omite silenciosamente y el inventario responde 503.
- Por holding (super‑admin, `ClinicaDetail`): conectar/desconectar (`federatedClinicId`), `federationPaused`, `federationCatalogOnly` (default true al conectar manualmente), `federationSyncSettings` por entidad.

### 7.3 Salida DentalCloud → Dental-Demo (`lib/federationSync.ts` → `federationClient.ts`)

| Evento local | Endpoint remoto | Payload principal | Condiciones |
|---|---|---|---|
| Crear holding (`POST /clinicas`) o reintento | `POST /api/platform/federated/clinics/mirror` | externalId, name, pais, clinicType (DENTAL/ESTHETIC/BOTH), adminName, adminEmail, adminPassword (solo 1er intento) | federación configurada |
| Activar/desactivar holding | mismo | externalId, name, active | conectada y no pausada |
| Crear/editar paciente | `POST /api/platform/federated/patients/mirror` | clinicId, externalId, firstName, lastName, rut, email, phone, birthDate, heightCm, weightKg, allergies, allergyNotes, medicalConditions, currentMedications | conectada, no pausada, no catalogOnly, `patients` on |
| Crear usuario | `POST /api/platform/federated/users/mirror` | clinicId, externalId, name, email, role, rut, password (1er intento) | idem con `users` |
| Crear sucursal | `POST /api/platform/federated/locations/mirror` | clinicId, externalId, name, country, active | idem con `sucursales` |
| Crear/cancelar/avanzar cita | `POST /api/platform/federated/appointments/mirror` | clinicId, patientId (remoto), externalId, startAt, endAt, status (vocabulario DentalCloud), notes, professionalName, box | idem con `appointments`; si el paciente aún no tiene espejo se encola |
| Crear/editar/borrar presupuesto | `POST /api/platform/federated/treatment-plans/mirror` | patientId, externalId, title, description, status, agreementId, previsionId, professionalName, planType, facialGender, facialAnnotations; o `{externalId, removed:true}` | idem con `treatmentPlans` |
| Crear/editar/borrar ítem (incl. al evolucionar) | `POST /api/platform/federated/treatment-plans/items/mirror` | treatmentPlanId, externalId, name, description, tooth, unitPrice, completed, prestacionId, listPrice, convenioDiscountPercent, product*; o `removed` | idem |
| Subir/borrar foto de ítem | `POST /api/platform/federated/treatment-plans/items/photos/mirror` | treatmentItemId, externalId, url, label; o `removed` | ítem federado |
| Crear/editar/eliminar convenio | `POST /api/platform/federated/agreements/mirror` | clinicId, externalId, name, discountPercent, active | conectada, no pausada, `catalog` on |
| Crear/editar/eliminar prestación | `POST /api/platform/federated/prestaciones/mirror` | clinicId, externalId, name, code, basePrice, active, odontogramMode (solo dental), requiresProductTracking | idem |
| Crear/editar/eliminar previsión | `POST /api/platform/federated/previsiones/mirror` | clinicId, externalId, name, active | idem |
| Lecturas en vivo | `GET /api/platform/clinics`, `/patients`, `/appointments` (overview super‑admin), `GET /api/platform/federated/supply-lots?clinicaId&search` (lotes), `/api/platform/federated/inventory/*` (inventario completo) | — | configurada |

Fallos → `FederationSyncFailure` (upsert por entityType+localId); `federationRetry.ts` reintenta cada 5 min (máx. 10 intentos, 50 filas por barrido) releyendo el estado actual (excepto `TREATMENT_ITEM_REMOVAL`, que reutiliza el payload).

### 7.4 Entrada Dental-Demo → DentalCloud (`/api/clinicas/federated/*/mirror`, `requireFederationOrSuperAdmin`)
Upserts idempotentes por `externalId`: clínica (crea "Sillón externo" + sucursal "Clínica federada" + admin), pacientes (RUT obligatorio; vincula por RUT), usuarios (mapeo de roles CLINIC_OWNER→admin, PROFESSIONAL→odontologo, resto→operador), citas (CANCELLED/NO_SHOW→cancelada), presupuestos (planType, facialGender, `remoteProfessionalName`), ítems, convenios/prestaciones/previsiones/sucursales (vinculan por nombre/código). Además Dental-Demo puede leer `GET /api/clinicas`, `/api/clinicas/pacientes`, `/api/clinicas/citas`.

### 7.5 Referencias en el código
Backend: `schema.prisma` (comentarios en cada `federated*Id`), `index.ts` (`startFederationRetryLoop`), `middleware/requireFederationOrSuperAdmin.ts`, `lib/federationClient.ts`, `lib/federationSync.ts`, `lib/federationRetry.ts`, `controllers/clinicasController.ts` (mirrors, connect/disconnect, overview), y llamadas `sync*ToFederation` en `patientsController`, `appointmentsController`, `usersController`, `treatmentPlansController`, `treatmentItemsController`, `evolutionsController`, `catalogsController`, `inventoryController`.
Frontend: `api/clinicas.ts` (flags de federación), `pages/superadmin/ClinicaDetail.tsx` (panel "Federación con Dental-Demo"), `api/inventory.ts` + `pages/catalogo/Inventario*` (inventario remoto), `api/catalogs.ts` + `TreatmentPlanFormModal` (lotes remotos).

---

## 8. Anexos

### 8.1 Datos sembrados (`prisma/seed.ts`, `seedEstetica.ts`)
- Usuarios demo: `admin@dentalcloud.local` (admin), `profesional@dentalcloud.local` (odontólogo), `admin@esteticademo.local`, `profesional@esteticademo.local` (clínica `estetica-demo-clinica`).
- Sillones 101–106; 9 pacientes de ejemplo; 8 citas; sucursales "RIDS - Sede Central/Norte"; previsiones Fonasa/Isapre/Particular; convenios Particular (0%), Empresa RIDS (10%), Seguro Complementario (15%); 15 prestaciones dentales (CONS‑01…ORTO‑01) y 2 estéticas (AH‑01 Ácido Hialurónico, BTX‑01 Toxina Botulínica); 4 plantillas de evolución; presupuestos y movimientos de cartola de ejemplo; 13 tipos de consentimiento por clínica.
- Nota: `seed.ts` usa `where: { number }`, `{ rut }`, `{ name }`, `{ code }` sin `clinicaId`, incompatible con las claves compuestas actuales (`@@unique([clinicaId, …])`); probablemente ya no ejecuta sin ajustes.

### 8.2 Límites de carga
Logo holding 5 MB; PDF de tipo de consentimiento 5 MB; documentos clínicos, fotos de plan/ítem/evolución 20 MB; foto y audio de paciente sin límite explícito (memoria); adjuntos Rx hasta 3 GB × 10 (disco temporal).

### 8.3 Carpetas Cloudinary
`dentalcloud/patients/photos`, `dentalcloud/patients/motivo-consulta-audio`, `dentalcloud/clinicas/logos`, `dentalcloud/{clinicaId}/firmas-profesionales`, `dentalcloud/{clinicaId}/firmas-consentimientos`, `dentalcloud/{clinicaId}/consentimientos-tipos`, `dentalcloud/{clinicaId}/consentimientos-firmados`, `dentalcloud/{clinicaId}/treatment-plans/{planId}`, `dentalcloud/{clinicaId}/treatment-items/{itemId}`, `dentalcloud/{clinicaId}/evolutions/{evolutionId}`, `dentalcloud/{patientId}/{category}` (documentos).

### 8.4 Inventario resumido de "todo lo que se puede registrar" (vista de negocio)

1. **Holdings/clínicas**: nombre, RUT, tipo, país, logo, activo, módulos, Rx, bloque de agenda, permisos por perfil, federación.
2. **Usuarios**: nombre, email, contraseña, rol, RUT, firma, excepciones de permisos/módulos.
3. **Sillones**: número, nombre.
4. **Horarios de profesionales**: día, desde, hasta, sillón.
5. **Pacientes**: 30+ campos (identidad, contacto, datos personales, previsión informativa, contacto de emergencia, medidas, grupo sanguíneo, alergias, notas de alergias, condiciones, medicamentos, crónicas, antecedentes dentales, etiquetas, foto, motivo de consulta, audio del motivo).
6. **Citas**: sillón, paciente, profesional, inicio/fin, notas, tipo, estados con timestamps; urgencias con motivo y triage.
7. **Catálogos**: sucursales (nombre, dirección, id RIDS RX), previsiones, convenios (descuento), prestaciones (código, nombre, precio, categoría, modo odontograma, zonas, trazabilidad, todo el rostro, zonas juntas, precio por zona), plantillas de evolución (solo backend).
8. **Presupuestos**: sucursal, previsión, convenio, profesional, tipo de diagrama, nombre, forma de pago, observaciones, género facial, anotaciones faciales, fotos de plantilla; ítems con prestación, descripción, pieza/zona, precio lista, descuento, costo, notas, producto/lote/vencimiento/cantidad, completado, fotos; motivos de modificación.
9. **Evoluciones**: contenido HTML, profesional, ítem documentado, producto/lote/vencimiento/cantidad, fotos etiquetadas; habilitada; motivo de borrado.
10. **Cartola**: abonos (monto, forma de pago, N° documento), intereses, ajustes (debe/haber), glosa, observación, presupuesto asociado.
11. **Observaciones administrativas**: texto, autor.
12. **Documentos clínicos**: archivo, categoría, descripción.
13. **Consentimientos**: por tipo — envío por correo o firma presencial: nombre, RUT, confirmación de lectura, firma, IP, user‑agent; PDF propio por tipo.
14. **Rx (remoto)**: sincronización de paciente, órdenes (clínica, odontólogo, prioridad, diagnóstico, observaciones, exámenes con piezas, URL/observación, archivos).
15. **Inventario (remoto)**: insumos (13 campos), lotes (8 campos), movimientos (tipo, cantidad, motivo).
