# Análisis técnico exhaustivo — Plataforma Dental-Demo (forDentalCloud / "DentalOS")

**Fecha del análisis:** 2026-09-03
**Repositorios analizados (locales, sin `node_modules`, `dist`, `.git`; archivos `.env` no leídos):**

| Repo | Ruta | Stack |
|---|---|---|
| Frontend | `C:\Users\User\OneDrive - rids.cl\Escritorio\Dental-Demo` | React 19 + Vite 8 + react-router-dom 7 + Tailwind 4 (estilos inline mayormente) + Konva/react-konva (editor de marketing). Tests con `node --test`. Sin TypeScript. |
| Backend | `C:\Users\User\OneDrive - rids.cl\Escritorio\Dental-Demo-Back` (package `dentalos-backend`) | Node ESM + Express 4 + Prisma 5 (PostgreSQL) + zod 4 + JWT (cookie httpOnly) + bcrypt + multer + Cloudinary + OpenAI SDK + Stripe + exceljs + pdfkit + express-rate-limit + helmet. Tests con vitest (~150 archivos). |

## 0. Resumen ejecutivo

- **Qué es:** un SaaS multi-clínica para clínicas dentales/estéticas ("forDentalCloud" en el login, "DentalCloud" en el layout, "DentalOS" en la API). Cada **Clínica** tiene **Sedes**, **Usuarios** (7 roles), **Pacientes**, **Agenda**, **Ficha clínica/Odontograma**, **Planes de tratamiento** (dental con odontograma y estético con mapa facial), **Cotizaciones → Cobranza → Ingresos**, **Finanzas** (ingresos, gastos, caja, convenios, liquidaciones), **Inventario** (insumos, lotes, movimientos, cotizaciones de compra, recepciones), **Equipos**, **Simulación estética con IA (OpenAI)**, **Marketing IA (OpenAI + Cloudinary)**, **Reportes** (Excel/PDF), **Consentimientos**, **Privacidad (Ley de datos: exportación/anonimización)**, **Auditoría** y un **Panel de plataforma** (super-admin: clínicas, planes, módulos, suscripciones, pagos Stripe, tickets, uso).
- **Modelo de datos:** 58 modelos Prisma / 52 enums (sección 1, campo a campo).
- **API:** ~250 endpoints REST bajo `/api` (sección 2) protegidos por permisos granulares (58 permisos) y por "features" contratadas (módulos de suscripción).
- **Frontend:** ~60 rutas (sección 3) con inventario campo a campo de cada formulario/modal.
- **Federación con DentalCloud** (sección 7): sincronización bidireccional best-effort con `dentalcloud-backend` (otro producto de la misma casa) vía `X-API-KEY`: clínicas, sedes, usuarios, pacientes, citas, planes/ítems/fotos, convenios, prestaciones, previsiones, inventario y lotes.
- **Brechas principales** (sección 5): campos del modelo sin formulario (antecedentes médicos del paciente se capturan pero no se envían; `facialAnnotations` y fotos de ítems solo llegan por federación; `ClinicDataRetentionPolicy`, `SupportTicket`, `ClinicUsageSnapshot`, `Plan`, `FeatureModule` sin endpoint de escritura; `taxRatePercent`/`clinicType` no editables), desajustes de nombres de campos entre frontend y backend (`type/targetDate` vs `reminderType/dueDate`, `status` vs `active`, `supplier` vs `supplierName`, `isActive`/`URGENT` en reglas), y varias pantallas mock sin backend (Nómina, Reloj checador, Usuarios org/sede, Cargos, Documentos, Especialidades, Honorarios, Outbox, Precios, Recordatorios de ajustes, WhatsApp).

## 0.1 URLs y despliegue

| Elemento | Valor encontrado | Fuente |
|---|---|---|
| **API backend pública** | `https://dental-demo-back-production.up.railway.app` | `Dental-Demo/.env.example` (`VITE_API_URL=…`) — Railway |
| Frontend público | **No aparece en ningún archivo del repo** (no hay `netlify.toml`, `vercel.json` ni README con URL). El archivo `public/_redirects` (`/* /index.html 200`) indica despliegue tipo **Netlify** (o equivalente que soporte `_redirects`). El valor real vive en `FRONTEND_URL` del `.env` del backend (no leído). | `public/_redirects`; `Dental-Demo-Back/.env.example` solo trae `FRONTEND_URL=http://localhost:5173` |
| DentalCloud (federación) | `DENTALCLOUD_API_URL` vacío en `.env.example`; los scripts de demo mencionan hosts Railway (`railway`, `rlwy`) para la BD | `.env.example`, `scripts/*.js` |
| Webhook Stripe | `https://<backend>/api/webhooks/stripe` (documentado) | `docs/STRIPE_SETUP.md` (menciona que las variables se configuran "en Railway") |
| Correo de solicitudes de demo | destino fijo `soporte@rids.cl`, remitente `diseno@rids.cl` (Microsoft Graph) | `src/services/demoRequest.service.js` |
| Dev local | Frontend Vite `:5173`; backend `:4000` con fallback automático a `:4001`; el frontend detecta el puerto probando `GET /api/health` (`message: "DentalOS API running"`) | `src/services/api.js`, `src/server.js` |

## 0.2 Cómo leer este documento

1. **Modelo de datos** — todas las tablas, todos los campos, tipos, opcionalidad, defaults, enums completos, relaciones.
2. **Endpoints** — método + ruta + permiso + body/query (según validadores zod) + qué hace.
3. **Pantallas y formularios** — por módulo (Pacientes/Ficha, Planes/Cotizaciones, Agenda/Ajustes, Finanzas, Operaciones, Marketing, Admin/Dashboard/Reportes/Login), campo a campo.
4. **Funcionalidades** — flujo general, roles/permisos, módulos contratables, procesos automáticos.
5. **Brechas** — datos "sueltos": modelo sin formulario, formulario sin persistencia, desajustes de claves, endpoints sin uso, mocks.
6. **Variables de entorno** — nombres (de `.env.example`) y uso en código.
7. **Federación con DentalCloud** — qué se envía, qué se recibe, cómo se autentica, reintentos.


## 1. Modelo de datos completo (Prisma / PostgreSQL)

Fuente: `Dental-Demo-Back/prisma/schema.prisma` (2.402 líneas, 76 migraciones, 58 modelos, 52 enums). Todos los `id` son `String @id @default(cuid())`. `createdAt` = `DateTime @default(now())`, `updatedAt` = `DateTime @updatedAt`. Los montos monetarios son **enteros** (Int) en la moneda de la clínica (CLP sin decimales) salvo donde se indica `Decimal`.

### 1.1 Enums (valores completos)

| Enum | Valores |
|---|---|
| `UserRole` | PLATFORM_ADMIN, CLINIC_OWNER, LOCATION_MANAGER, MARKETING_MANAGER, PROFESSIONAL, RECEPTIONIST, ASSISTANT, CLINIC_ADMIN (legacy → CLINIC_OWNER), CLINIC_STAFF (legacy → PROFESSIONAL) |
| `UserProfession` | DENTIST, DENTAL_ASSISTANT, RECEPTIONIST, ADMINISTRATION, MARKETING, OTHER |
| `ClinicStatus` | ACTIVE, TRIAL, SUSPENDED, EXPIRED |
| `PlanName` | BASIC, PROFESSIONAL, ENTERPRISE |
| `SubscriptionStatus` | ACTIVE, TRIAL, EXPIRED, CANCELLED |
| `SubscriptionModuleStatus` | ACTIVE, TRIAL, EXPIRED, CANCELLED |
| `ModuleCustomizationRequestStatus` | PENDING, IN_REVIEW, APPROVED, REJECTED, CANCELLED |
| `PaymentStatus` | PAID, PENDING, FAILED, REFUNDED |
| `PaymentMethod` (pagos SaaS) | CREDIT_CARD, DEBIT_CARD, BANK_TRANSFER, OTHER |
| `TicketPriority` | LOW, MEDIUM, HIGH, URGENT |
| `TicketStatus` | OPEN, IN_REVIEW, RESOLVED, CLOSED |
| `TicketType` | TECHNICAL, BILLING, ACCOUNT, FEATURE_REQUEST, OTHER |
| `MarketingCampaignStatus` | DRAFT, READY, ARCHIVED |
| `ClinicSupplyStatus` | ACTIVE, LOW_STOCK, OUT_OF_STOCK, ARCHIVED |
| `ClinicSupplyLotMovementType` | IN, OUT, ADJUSTMENT |
| `SupplyPurchaseQuoteStatus` | DRAFT, RECEIVED, APPROVED, REJECTED, CANCELLED |
| `QuoteItemSourceType` | MANUAL, INVENTORY_SUPPLY |
| `ClinicEquipmentClinicalArea` | DENTAL, ESTHETIC, BOTH |
| `ClinicEquipmentStatus` | ACTIVE, IN_MAINTENANCE, OUT_OF_SERVICE, RETIRED, LOST |
| `ClinicExpenseStatus` | ACTIVE, ARCHIVED |
| `ClinicExpensePaymentMethod` | CASH, CARD, TRANSFER, CHECK, OTHER |
| `ClinicIncomeStatus` | ACTIVE, ARCHIVED |
| `ClinicIncomePaymentMethod` | CASH, CARD, TRANSFER, CHECK, OTHER |
| `ClinicIncomePaymentType` | FULL, PARTIAL |
| `CollectionOrderStatus` | PENDING, PAID, COVERED, CANCELLED |
| `CollectionOrderCoverageType` | NONE, FONASA, ISAPRE |
| `CollectionOrderPaymentMethod` | CASH, DEBIT_CARD, CREDIT_CARD |
| `ClinicAgreementType` | COMPANY, INSURANCE, PARTNER, INTERNAL, OTHER |
| `ClinicAgreementStatus` | ACTIVE, INACTIVE, EXPIRED, ARCHIVED |
| `ClinicAgreementDiscountType` | PERCENTAGE, FIXED_AMOUNT, CUSTOM |
| `ClinicSettlementStatus` | DRAFT, READY, PAID, CANCELLED, ARCHIVED |
| `ClinicSettlementPaymentMethod` | CASH, TRANSFER, CHECK, OTHER |
| `ClinicalNoteStatus` | DRAFT, FINAL, ARCHIVED |
| `PatientToothCondition` | HEALTHY, CARIES, RESTORATION, MISSING, EXTRACTION_INDICATED, IMPLANT, CROWN, ROOT_CANAL, FRACTURE, PERIODONTAL_ISSUE, OBSERVATION, OTHER |
| `TreatmentPlanStatus` | DRAFT, PROPOSED, ACCEPTED, IN_PROGRESS, COMPLETED, CANCELLED, ARCHIVED |
| `TreatmentPlanType` | DENTAL, ESTHETIC |
| `TreatmentPlanItemStatus` | PENDING, IN_PROGRESS, COMPLETED, CANCELLED |
| `PatientStatus` | ACTIVE, ARCHIVED |
| `ConsentStatus` | ACTIVE, REVOKED, EXPIRED |
| `ConsentMethod` | IN_PERSON, DIGITAL, VERBAL, IMPORTED |
| `PatientConsentPurpose` | GENERAL, ESTHETIC_AI_SIMULATION |
| `EstheticSimulationStatus` | PENDING, PROCESSING, COMPLETED, FAILED, DISCARDED |
| `AppointmentStatus` | SCHEDULED, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, NO_SHOW |
| `ReminderType` | CHECKUP, CLEANING, POST_TREATMENT, ORTHODONTIC_CONTROL, IMPLANT_CONTROL, SURGERY_FOLLOW_UP, GENERAL, QUOTE_FOLLOW_UP |
| `ReminderStatus` | PENDING, OVERDUE, CONTACTED, SCHEDULED, COMPLETED, CANCELLED |
| `ReminderPriority` | LOW, NORMAL, HIGH |
| `ReminderIntervalUnit` | DAYS, MONTHS |
| `QuoteStatus` | DRAFT, ISSUED, ACCEPTED, REJECTED, CANCELLED |
| `QuoteDiscountType` | PERCENTAGE, FIXED_AMOUNT |
| `QuoteTreatmentStatus` | NOT_STARTED, IN_PROGRESS |
| `PrivacyRequestType` | DATA_EXPORT, DATA_CORRECTION, DATA_RESTRICTION, DATA_ANONYMIZATION |
| `PrivacyRequestStatus` | PENDING, IN_REVIEW, APPROVED, REJECTED, COMPLETED, CANCELLED |
| `ModuleAccessEffect` | ALLOW, DENY |

Vocabularios que NO son enum de BD pero están fijados en código (backend `src/constants/*`):

| Vocabulario | Valores |
|---|---|
| Alergias (`Patient.allergies`, `ALLERGY_KEYS`) | fluoruro, penicilina, anestesicos_locales, latex, yodo, niquel_metales, aines, sulfitos, otro |
| Modo odontograma (`Prestacion.odontogramMode`) | session, tooth, surface, extraction, cuadrante, sextante, arcada |
| Tipo de clínica (`Clinic.clinicType`, texto) | DENTAL, ESTHETIC, BOTH |
| Género facial (`TreatmentPlan.facialGender`) | hombre, mujer |
| Método de pago plan (`TreatmentPlan.paymentMethod`, texto libre ≤40) | "Contado", "Cuotas" (por convención con DentalCloud) |
| Consultorios (`ClinicSupply.consultingRoom`, `ProfessionalAvailability.consultingRoom`) | "Consultorio 1", "Consultorio 2", "Consultorio 3", "Consultorio 4", "Consultorio 5", "Sala RX", "Pabellón menor" |
| Tipo tratamiento simulación IA (`EstheticSimulation.treatmentType`) | FACIAL_HARMONIZATION, LIP_AUGMENTATION, BOTULINUM_TOXIN, DERMAL_FILLER, FACIAL_CONTOURING, SMILE_DESIGN, TEETH_WHITENING, OTHER_ESTHETIC |
| Motivos cancelación cita (`AppointmentStatusHistory.reasonCode`) | PATIENT_CANCELLED, DOCTOR_UNAVAILABLE, RESCHEDULED, SCHEDULING_ERROR, ADMINISTRATIVE_ISSUE, CLINIC_CLOSED, OTHER |
| Motivos no-show | FORGOT_APPOINTMENT, COULD_NOT_CONTACT, TRANSPORT_ISSUE, PERSONAL_EMERGENCY, HEALTH_ISSUE, UNKNOWN, OTHER |
| Tipo de cálculo liquidación (`ClinicSettlementItem.calculationType`) | PERCENTAGE, FIXED |
| Módulos de menú (`ClinicUserModuleAccess.module`) | AGENDA, REPORTS, QUOTES, FINANCE, COLLECTIONS, INVENTORY, EQUIPMENT, ESTHETIC_SIMULATION, STAFF, PRESTACIONES, PREVISIONES, MARKETING |
| Feature modules (`FeatureModule.key`, seed) | MARKETING_AI, ADVANCED_FINANCE, CLINICAL_RECORD, TREATMENT_PLANS, ESTHETIC_TREATMENTS, AGREEMENTS, LIQUIDATIONS, MULTI_LOCATION, ADVANCED_REPORTS, API_ACCESS (+ ESTHETIC_AI_SIMULATION usado por código/scripts) |
| Categorías de auditoría (`AuditLog.category`) | AUTH, CLINICAL_RECORD, ODONTOGRAM, CONSENT, TREATMENT_PLAN, STAFF, PATIENT, DOCUMENT, AGENDA, FINANCE, EQUIPMENT, INVENTORY, ESTHETIC_SIMULATION, PLATFORM, SYSTEM, PRIVACY, QUOTE, MARKETING |
| Resultados auditoría (`AuditLog.outcome`) | SUCCESS, DENIED, FAILED |
| Acciones auditoría (`AuditLog.action`) | ~150 valores (LOGIN_SUCCESS, PATIENT_CREATED, … , MARKETING_SIMULATION_DELETED) — ver `src/constants/auditLog.js` |
| Permisos (`ClinicUserPermissionGrant.permission`) | ver sección 4.2 (58 permisos; 22 otorgables) |
| Tipo de entidad federación (`FederationSyncFailure.entityType`) | CLINIC, CLINIC_STATUS, PATIENT, USER, LOCATION, APPOINTMENT, TREATMENT_PLAN, TREATMENT_ITEM, TREATMENT_ITEM_REMOVAL, CONVENIO, PRESTACION, PREVISION |

### 1.2 Modelos — Plataforma / multi-tenant

#### `User` (usuarios: admin de plataforma y personal de clínica)
| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | cuid | PK |
| name | String | no | | nombre completo (se guarda `firstName + lastName` concatenado) |
| email | String | no | | único global |
| passwordHash | String | no | | bcrypt |
| role | UserRole | no | | |
| profession | UserProfession | sí | | |
| specialty | String | sí | | texto libre ≤120 |
| clinicId | String (FK Clinic) | sí | | null para PLATFORM_ADMIN |
| locationId | String (FK Location) | sí | | sede primaria (legacy) |
| active | Boolean | no | true | |
| supportsEstheticTreatments | Boolean | no | false | solo PROFESSIONAL |
| agendaColor | String | sí | | hex `#RRGGBB` |
| federatedUserId | String | sí | | único; id del User espejo en DentalCloud |
| isFederationActor | Boolean | no | false | bot interno para escrituras de inventario vía federación |
| createdAt / updatedAt | DateTime | no | | |
| Relaciones | | | | clinic, location, supportTickets, locationAssignments (UserLocation[]), customPermissionGrants, moduleAccessOverrides y ~50 back-refs de auditoría/creación (createdX/updatedX) |

#### `Clinic`
| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | cuid | |
| name | String | no | | |
| country | String | no | | |
| currency | String | no | | ISO-3 (CLP/USD/EUR) |
| taxRatePercent | Int | no | 19 | IVA incluido en precios de cotizaciones |
| timeZone | String | no | "America/Santiago" | IANA |
| status | ClinicStatus | no | TRIAL | |
| contactName | String | no | | |
| contactEmail | String | no | | único |
| contactPhone | String | no | | |
| clinicType | String | sí | | DENTAL / ESTHETIC / BOTH (escrito por SQL crudo) |
| stripeCustomerId | String | sí | | único |
| federatedClinicaId | String | sí | | único; id espejo en DentalCloud |
| createdAt / updatedAt | | | | |
| Relaciones | | | | locations, users, subscriptions, subscriptionPayments, subscriptionModules, moduleCustomizationRequests, supportTickets, usageSnapshots, y todas las entidades de clínica (pacientes, agenda, finanzas, etc.), dataRetentionPolicy (1:1) |

#### `Location` (sede / sucursal)
| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | cuid | |
| clinicId | FK Clinic | no | | onDelete Cascade |
| name | String | no | | único por clínica |
| country | String | no | | debe coincidir con clínica |
| currency | String | no | | debe coincidir con clínica |
| active | Boolean | no | true | |
| federatedLocationId | String | sí | | único; id Sucursal espejo en DentalCloud |
| createdAt / updatedAt | | | | |

#### `UserLocation` (asignación usuario ↔ sede)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| userId | FK User | no | Cascade |
| locationId | FK Location | no | Cascade |
| isPrimary | Boolean | no | false |
| createdAt / updatedAt | | | |
| Único | (userId, locationId) | | |

#### `ClinicConsultingRoom` (box / consultorio)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | Cascade |
| locationId | FK Location | sí | Cascade |
| name | String | no | |
| isActive | Boolean | no | true |
| supportsDental | Boolean | no | true |
| supportsEsthetic | Boolean | no | false |
| notes | Text | sí | |
| createdAt / updatedAt | | | |
| Único | (clinicId, locationId, name) | | |
| Relaciones | treatmentPlans, clinicEquipment | | |

#### `ProfessionalAvailability` (horario semanal del profesional)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| professionalUserId | FK User | no | Cascade |
| locationId | FK Location | sí | SetNull |
| dayOfWeek | Int (0-6) | no | |
| startTime | String "HH:mm" | no | |
| endTime | String "HH:mm" | no | |
| consultingRoom | String | sí | (lista fija de consultorios) |
| isActive | Boolean | no | true |
| createdAt / updatedAt | | | |

#### `ProfessionalAvailabilityBlock` (bloqueo de agenda)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| professionalUserId | FK User | no | Cascade |
| locationId | FK Location | sí | SetNull |
| startAt | DateTime | no | |
| endAt | DateTime | no | |
| reason | String | sí | ≤250 |
| isActive | Boolean | no | true |
| createdAt / updatedAt | | | |

#### `Plan` (planes SaaS)
| Campo | Tipo | Opcional | Default | Seed |
|---|---|---|---|---|
| id | String | no | cuid | |
| name | PlanName | no | | único |
| priceUsd | Int | no | | BASIC 29 / PROFESSIONAL 79 / ENTERPRISE 199 |
| maxLocations | Int | sí | | 1 / 3 / null (ilimitado) |
| maxUsers | Int | sí | | 3 / 10 / null |
| includesFinance | Boolean | no | false | false / true / true |
| includesAi | Boolean | no | false | false / true / true |
| includesApi | Boolean | no | false | false / false / true |
| publicVisible | Boolean | no | true | false / true / false |
| active | Boolean | no | true | |
| createdAt / updatedAt | | | | |

#### `FeatureModule` (módulos contratables)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| key | String | no | único (MARKETING_AI, ADVANCED_FINANCE, CLINICAL_RECORD, TREATMENT_PLANS, ESTHETIC_TREATMENTS, AGREEMENTS, LIQUIDATIONS, MULTI_LOCATION, ADVANCED_REPORTS, API_ACCESS, ESTHETIC_AI_SIMULATION) |
| name | String | no | |
| description | Text | sí | |
| priceUsd | Int | no | (20/15/15/10/10/10/10/20/15/25) |
| active | Boolean | no | true |
| sortOrder | Int | no | 0 |
| createdAt / updatedAt | | | |

#### `Subscription`
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | Cascade |
| planId | FK Plan | no | |
| status | SubscriptionStatus | no | TRIAL |
| startDate | DateTime | no | |
| endDate | DateTime | no | |
| autoRenew | Boolean | no | true |
| stripeSubscriptionId | String | sí | único |
| stripePriceId | String | sí | |
| stripeStatus | String | sí | |
| stripeCurrentPeriodEnd | DateTime | sí | |
| stripeBillingCycle | String | sí | MONTHLY / YEARLY |
| createdAt / updatedAt | | | |
| Relaciones | payments, modules | | |

#### `SubscriptionModule`
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| subscriptionId | FK Subscription | no | Cascade |
| clinicId | FK Clinic | no | Cascade |
| moduleId | FK FeatureModule | no | |
| status | SubscriptionModuleStatus | no | ACTIVE |
| quantity | Int | no | 1 |
| priceUsd | Int | no | (snapshot del precio) |
| startDate | DateTime | no | now() |
| endDate | DateTime | sí | |
| autoRenew | Boolean | no | true |
| createdAt / updatedAt | | | |
| Único | (subscriptionId, moduleId) | | |

#### `SubscriptionPayment` (pagos SaaS, alimentados por webhook Stripe / seed)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | Cascade |
| subscriptionId | FK Subscription | sí | SetNull |
| amountUsd | Decimal(10,2) | no | |
| currency | String | no | |
| status | PaymentStatus | no | |
| method | PaymentMethod | no | |
| externalReference | String | sí | único (id de invoice Stripe) |
| paidAt | DateTime | sí | |
| dueDate | DateTime | sí | |
| createdAt / updatedAt | | | |

#### `ModuleCustomizationRequest` (solicitud de módulos desde la clínica)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | Cascade |
| requestedByUserId | FK User | sí | SetNull |
| status | ModuleCustomizationRequestStatus | no | PENDING |
| requestedModules | Json | no | `[{ key, quantity }]` |
| currency | String | no | "USD" (CLP/USD/EUR) |
| estimatedPlanAmount | Int | sí | |
| estimatedModulesAmount | Int | sí | |
| estimatedTotalAmount | Int | sí | |
| message | Text | sí | ≤5000 |
| adminNotes | Text | sí | ≤10000 |
| createdAt / updatedAt | | | |
| resolvedAt | DateTime | sí | |

#### `SupportTicket`
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | Cascade |
| createdById | FK User | sí | SetNull |
| subject | String | no | |
| description | String | no | |
| type | TicketType | no | |
| priority | TicketPriority | no | |
| status | TicketStatus | no | |
| resolvedAt | DateTime | sí | |
| createdAt / updatedAt | | | |

#### `ClinicUsageSnapshot`
| Campo | Tipo | Opcional |
|---|---|---|
| id | String | no |
| clinicId | FK Clinic | no |
| periodStart | DateTime | no |
| periodEnd | DateTime | no |
| appointmentsCount | Int | no |
| patientsCount | Int | no |
| activeUsersCount | Int | no |
| storageUsedMb | Int | no |
| createdAt / updatedAt | | |
| Único | (clinicId, periodStart, periodEnd) | |

#### `ClinicUserPermissionGrant` (permisos adicionales por usuario)
| Campo | Tipo | Opcional |
|---|---|---|
| id | String | no |
| clinicId | FK Clinic | no |
| userId | FK User | no (Cascade) |
| permission | String | no (uno de los 22 otorgables) |
| grantedByUserId | FK User | no (Restrict) |
| createdAt | DateTime | no |
| Único | (userId, permission) | |

#### `ClinicUserModuleAccess` (visibilidad de módulos del menú por usuario)
| Campo | Tipo | Opcional |
|---|---|---|
| id | String | no |
| clinicId | FK Clinic | no |
| userId | FK User | no (Cascade) |
| module | String | no (12 claves de módulo) |
| effect | ModuleAccessEffect | no |
| grantedByUserId | FK User | no |
| createdAt | DateTime | no |
| Único | (userId, module) | |

#### `AuditLog`
| Campo | Tipo | Opcional |
|---|---|---|
| id | String | no |
| clinicId | FK Clinic | sí |
| locationId | FK Location | sí |
| actorUserId | FK User | sí |
| actorRole | String | sí |
| category | String | no |
| action | String | no |
| resourceType | String | sí |
| resourceId | String | sí |
| patientId | FK Patient | sí |
| outcome | String | no |
| method | String | sí (HTTP) |
| route | String | sí |
| ipHash | String | sí (HMAC con AUDIT_IP_HASH_SECRET) |
| userAgentSummary | String | sí |
| metadata | Json | sí |
| createdAt | DateTime | no |

#### `FederationSyncFailure` (cola de reintentos hacia DentalCloud)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| entityType | String | no | |
| localId | String | no | |
| payload | Json | no | |
| lastError | String | sí | |
| attempts | Int | no | 0 (máx. 10 reintentos, cada 5 min) |
| createdAt / updatedAt | | | |
| Único | (entityType, localId) | | |

### 1.3 Modelos — Pacientes y clínica

#### `Patient`
| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | cuid | |
| clinicId | FK Clinic | no | | Cascade |
| locationId | FK Location | sí | | SetNull |
| createdByUserId | FK User | sí | | |
| updatedByUserId | FK User | sí | | |
| firstName | String | no | | ≤80 |
| lastName | String | no | | ≤80 |
| rut | String | sí | | ≤20 |
| email | String | sí | | ≤254, minúsculas |
| phone | String | sí | | ≤30 |
| birthDate | DateTime | sí | | |
| gender | String | sí | | texto libre ≤30 |
| address | String | sí | | ≤200 |
| notes | Text | sí | | ≤10000 |
| heightCm | Int | sí | | positivo |
| weightKg | Float | sí | | positivo |
| allergies | String[] | no | [] | vocabulario fijo de 9 claves |
| allergyNotes | Text | sí | | ≤2000 |
| medicalConditions | Text | sí | | ≤2000 |
| currentMedications | Text | sí | | ≤2000 |
| status | PatientStatus | no | ACTIVE | |
| archivedAt | DateTime | sí | | |
| anonymizedAt | DateTime | sí | | |
| federatedPatientId | String | sí | | único; espejo DentalCloud |
| createdAt / updatedAt | | | | |
| Relaciones | | | | appointments, incomes, collectionOrders, settlementItems, clinicalRecord (1:1), clinicalNotes, odontogramEntries, treatmentPlans, reminders, consents, estheticSimulations, auditLogs, privacyRequests, quotes |

#### `PatientClinicalRecord` (antecedentes de la ficha clínica, 1:1 con paciente)
| Campo | Tipo | Opcional |
|---|---|---|
| id | String | no |
| clinicId | FK Clinic | no |
| patientId | FK Patient | no (único) |
| medicalHistory | Text | sí |
| allergies | Text | sí (texto libre, distinto de `Patient.allergies[]`) |
| currentMedications | Text | sí |
| chronicDiseases | Text | sí |
| dentalHistory | Text | sí |
| observations | Text | sí |
| createdAt / updatedAt | | |

#### `PatientClinicalNote` (evoluciones / notas clínicas)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| patientId | FK Patient | no | Cascade |
| appointmentId | FK Appointment | sí | SetNull |
| professionalUserId | FK User | sí | SetNull |
| noteDate | DateTime | no | now() |
| title | String | no | ≤180 |
| reason | String | sí | ≤250 |
| diagnosis | Text | sí | |
| treatment | Text | sí | |
| indications | Text | sí | |
| observations | Text | sí | |
| status | ClinicalNoteStatus | no | DRAFT |
| archivedAt | DateTime | sí | |
| createdAt / updatedAt | | | |

#### `PatientOdontogramEntry`
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| patientId | FK Patient | no | Cascade |
| toothNumber | String | no | FDI: 11-18, 21-28, 31-38, 41-48 (permanentes) y 51-55, 61-65, 71-75, 81-85 (temporales) |
| surface | String | no | "GENERAL" (texto ≤20; el frontend define las caras) |
| condition | PatientToothCondition | no | HEALTHY |
| diagnosis | Text | sí | |
| treatmentSuggestion | Text | sí | |
| notes | Text | sí | |
| recordedByUserId | FK User | sí | |
| createdAt / updatedAt | | | |
| Único | (patientId, toothNumber, surface) | | |

#### `ConsentTemplate`
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| createdById | FK User | sí | |
| name | String | no | ≤160 |
| version | String | no | ≤40 |
| title | String | no | ≤220 |
| body | Text | no | ≤50000 |
| purpose | Text | sí | ≤20000 |
| purposeType | PatientConsentPurpose | no | GENERAL |
| dataCategories | Json | sí | array de strings |
| channels | Json | sí | array de strings |
| isActive | Boolean | no | true |
| effectiveFrom | DateTime | sí | |
| createdAt / updatedAt | | | |
| Único | (clinicId, name, version) | | |

#### `PatientConsent`
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| patientId | FK Patient | no | Cascade |
| templateId | FK ConsentTemplate | sí | SetNull |
| templateName | String | no | snapshot |
| templateVersion | String | no | snapshot |
| titleSnapshot | String | no | |
| bodySnapshot | Text | no | |
| purposeSnapshot | Text | sí | |
| purposeType | PatientConsentPurpose | no | GENERAL |
| status | ConsentStatus | no | ACTIVE |
| acceptedAt | DateTime | sí | |
| revokedAt | DateTime | sí | |
| expiresAt | DateTime | sí | |
| registeredById | FK User | sí | |
| revokedById | FK User | sí | |
| method | ConsentMethod | no | IN_PERSON |
| patientNameSnapshot | String | sí | |
| patientRutSnapshot | String | sí | |
| representativeName | String | sí | ≤160 |
| representativeRut | String | sí | ≤30 |
| representativeRelationship | String | sí | ≤80 |
| notes | Text | sí | |
| createdAt / updatedAt | | | |
| Relaciones | treatmentPlans, estheticSimulations | | |

#### `PatientPrivacyRequest`
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| locationId | FK Location | sí | |
| patientId | FK Patient | no | Cascade |
| requestType | PrivacyRequestType | no | |
| status | PrivacyRequestStatus | no | PENDING |
| requestedByUserId | FK User | sí | |
| reviewedByUserId | FK User | sí | |
| completedByUserId | FK User | sí | |
| reason | Text | sí | ≤2000 sin HTML |
| resolutionNotes | Text | sí | ≤2000 sin HTML |
| requestedAt | DateTime | no | now() |
| reviewedAt | DateTime | sí | |
| completedAt | DateTime | sí | |
| createdAt / updatedAt | | | |

#### `ClinicDataRetentionPolicy` (1:1 clínica)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | único |
| countryCode | String | sí | |
| clinicalRecordRetentionYears | Int | sí | |
| allowAnonymizationAfterRetention | Boolean | no | false |
| requireManualApproval | Boolean | no | true |
| createdAt / updatedAt | | | |

### 1.4 Modelos — Agenda

#### `Appointment`
| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | cuid | |
| clinicId | FK Clinic | no | | |
| locationId | FK Location | sí | | (obligatoria al crear vía API) |
| patientId | FK Patient | no | | Cascade |
| professionalUserId | FK User | sí | | |
| createdByUserId | FK User | sí | | |
| updatedByUserId | FK User | sí | | |
| title | String | sí | | ≤150 |
| reason | String | sí | | ≤150 |
| service | String | sí | | ≤150 |
| startAt | DateTime | no | | |
| endAt | DateTime | no | | > startAt |
| durationMinutes | Int | sí | | |
| box | String | sí | | ≤80 (consultorio; el servicio lo exige) |
| notes | Text | sí | | |
| cancellationReason | Text | sí | | |
| status | AppointmentStatus | no | SCHEDULED | |
| cancelledAt | DateTime | sí | | |
| confirmedAt | DateTime | sí | | |
| completedAt | DateTime | sí | | |
| federatedAppointmentId | String | sí | | único |
| remoteProfessionalName | String | sí | | solo informativo (viene de DentalCloud) |
| createdAt / updatedAt | | | | |
| Relaciones | | | | incomes, settlementItems, clinicalNotes, reminders, statusHistory, quotes |

#### `AppointmentStatusHistory`
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| appointmentId | FK Appointment | no | Cascade |
| clinicId | FK Clinic | no | |
| locationId | FK Location | sí | |
| previousStatus | AppointmentStatus | sí | |
| newStatus | AppointmentStatus | no | |
| reasonCode | String | sí | catálogo cancelación / no-show / RESCHEDULED |
| reasonText | Text | sí | ≤500 |
| changedByUserId | FK User | sí | (null si vino por federación) |
| changedAt | DateTime | no | now() |
| previousStartAt / previousEndAt | DateTime | sí | (reagendamiento) |
| newStartAt / newEndAt | DateTime | sí | |
| metadata | Json | sí | p. ej. `{ source: "federation", remoteStatus }` |

#### `PatientReminder`
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| patientId | FK Patient | no | Cascade |
| locationId | FK Location | sí | |
| professionalUserId | FK User | sí | |
| appointmentId | FK Appointment | sí | |
| treatmentPlanId | FK TreatmentPlan | sí | |
| quoteId | FK Quote | sí | |
| createdByUserId | FK User | sí | |
| title | String | no | ≤180 |
| description | Text | sí | |
| reminderType | ReminderType | no | |
| dueDate | DateTime | no | |
| status | ReminderStatus | no | PENDING |
| priority | ReminderPriority | no | NORMAL |
| contactMethod | String | sí | ≤80 (p. ej. "EMAIL") |
| contactedAt | DateTime | sí | |
| completedAt | DateTime | sí | |
| notes | Text | sí | |
| createdAt / updatedAt | | | |

#### `ClinicReminderRule` (reglas de recordatorio automático)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| name | String | no | ≤120, único por clínica |
| reminderType | ReminderType | no | (sin QUOTE_FOLLOW_UP) |
| keywords | Json | no | array de strings en minúscula |
| intervalValue | Int | no | >0 |
| intervalUnit | ReminderIntervalUnit | no | |
| priority | ReminderPriority | no | NORMAL |
| isActive | Boolean | no | true |
| createdAt / updatedAt | | | |

### 1.5 Modelos — Planes de tratamiento, prestaciones, estética

#### `Prestacion` (catálogo de procedimientos)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| name | String | no | ≤180 |
| code | String | sí | ≤60 |
| basePrice | Int | no | 0 |
| active | Boolean | no | true |
| odontogramMode | String | no | "tooth" |
| requiresProductTracking | Boolean | no | false |
| federatedPrestacionId | String | sí | único |
| createdAt / updatedAt | | | |

#### `Prevision` (Fonasa / Isapre / Particular — informativo)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| name | String | no | ≤150 |
| active | Boolean | no | true |
| federatedPrevisionId | String | sí | único |
| createdAt / updatedAt | | | |

#### `TreatmentPlan` (plan / presupuesto de tratamiento)
| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | cuid | |
| clinicId | FK Clinic | no | | |
| patientId | FK Patient | no | | Cascade |
| professionalUserId | FK User | sí | | |
| consentId | FK PatientConsent | sí | | |
| consultingRoomId | FK ClinicConsultingRoom | sí | | |
| agreementId | FK ClinicAgreement | sí | | convenio (aplica % descuento a ítems) |
| previsionId | FK Prevision | sí | | informativo |
| title | String | no | | ≤180 |
| description | Text | sí | | |
| paymentMethod | String | sí | | "Contado" / "Cuotas" |
| status | TreatmentPlanStatus | no | DRAFT | |
| planType | TreatmentPlanType | no | DENTAL | |
| facialGender | String | sí | | hombre / mujer (mapa facial) |
| facialAnnotations | Json | sí | | trazos a mano alzada (lápiz/línea/círculo) — **solo lectura en Dental-Demo, llegan por federación** |
| estimatedTotal | Int | no | 0 | recalculado con los ítems |
| acceptedAt | DateTime | sí | | |
| completedAt | DateTime | sí | | |
| archivedAt | DateTime | sí | | |
| federatedTreatmentPlanId | String | sí | | único |
| remoteProfessionalName | String | sí | | informativo (DentalCloud) |
| createdAt / updatedAt | | | | |
| Relaciones | | | | items, reminders, estheticSimulations, quotes, clinicIncomes |

#### `TreatmentPlanItem`
| Campo | Tipo | Opcional | Default | Notas |
|---|---|---|---|---|
| id | String | no | cuid | |
| treatmentPlanId | FK TreatmentPlan | no | | Cascade |
| prestacionId | FK Prestacion | sí | | |
| name | String | no | | ≤180 |
| description | Text | sí | | |
| tooth | String | sí | | ≤500 (piezas/caras/zonas faciales en texto) |
| quantity | Int | no | 1 | |
| unitPrice | Int | no | 0 | precio ya descontado |
| totalPrice | Int | no | 0 | quantity × unitPrice |
| listPrice | Int | no | 0 | precio de lista antes de convenio |
| convenioDiscountPercent | Int | no | 0 | |
| productName | String | sí | | trazabilidad (p. ej. ácido hialurónico) |
| productLot | String | sí | | |
| productExpiresAt | DateTime | sí | | |
| productQuantity | String | sí | | texto ≤60 |
| status | TreatmentPlanItemStatus | no | PENDING | |
| sortOrder | Int | no | 0 | |
| federatedTreatmentItemId | String | sí | | único |
| createdAt / updatedAt | | | | |
| Relaciones | | | | photos |

#### `TreatmentPlanItemPhoto` (fotos Antes/Después — **solo espejo desde DentalCloud**)
| Campo | Tipo | Opcional |
|---|---|---|
| id | String | no |
| treatmentPlanItemId | FK TreatmentPlanItem | no (Cascade) |
| url | String | no |
| label | String | sí |
| createdAt | DateTime | no |
| externalId | String | no (único; id en DentalCloud) |

#### `EstheticSimulation` (simulación estética con IA)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| locationId | FK Location | sí | |
| patientId | FK Patient | no | Cascade |
| treatmentPlanId | FK TreatmentPlan | sí | |
| consentId | FK PatientConsent | no | (debe ser propósito ESTHETIC_AI_SIMULATION) |
| treatmentType | String | no | 8 tipos |
| status | EstheticSimulationStatus | no | PENDING |
| originalImagePublicId | String | sí | Cloudinary |
| generatedImagePublicId | String | sí | |
| thumbnailPublicId | String | sí | |
| provider | String | sí | "openai" |
| providerJobId | String | sí | |
| promptVersion | String | sí | ESTHETIC_SIMULATION_PROMPT_V1 |
| disclaimerAcceptedAt | DateTime | no | |
| generatedByUserId | FK User | no | |
| completedAt / failedAt / discardedAt / deletedAt | DateTime | sí | |
| createdAt / updatedAt | | | |

### 1.6 Modelos — Cotizaciones y cobranza

#### `Quote` (cotización / presupuesto comercial)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| locationId | FK Location | no | Restrict |
| patientId | FK Patient | no | Cascade |
| createdByUserId | FK User | no | |
| updatedByUserId | FK User | sí | |
| professionalUserId | FK User | sí | |
| appointmentId | FK Appointment | sí | |
| treatmentPlanId | FK TreatmentPlan | sí | |
| quoteNumber | String | sí | "COT-AAAA-000001", único por clínica |
| status | QuoteStatus | no | DRAFT |
| treatmentStatus | QuoteTreatmentStatus | sí | |
| currency | String | no | |
| subtotal | Int | no | 0 |
| discountTotal | Int | no | 0 |
| taxTotal | Int | no | 0 (IVA desglosado, incluido en total) |
| total | Int | no | 0 |
| validUntil | DateTime | sí | |
| notes | Text | sí | ≤2000 sin HTML |
| issuedAt / respondedAt / cancelledAt | DateTime | sí | |
| cancelReason | Text | sí | obligatorio al cancelar una ACCEPTED |
| followUpAt | DateTime | sí | |
| lastFollowUpAt | DateTime | sí | |
| createdAt / updatedAt | | | |
| Relaciones | items, collectionOrders, reminders, clinicIncomes | | |

#### `QuoteItem`
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| quoteId | FK Quote | no | Cascade |
| sourceType | QuoteItemSourceType | no | MANUAL |
| supplyId | FK ClinicSupply | sí | |
| nameSnapshot | String | no | ≤200 |
| descriptionSnapshot | Text | sí | ≤2000 |
| supplyUnitSnapshot | String | sí | |
| quantity | Int | no | >0 |
| unitPriceSnapshot | Int | no | ≥0 |
| discountType | QuoteDiscountType | sí | |
| discountValue | Int | no | 0 |
| discountAmount | Int | no | 0 |
| lineSubtotal | Int | no | |
| lineTotal | Int | no | |
| sortOrder | Int | no | 0 |
| createdAt / updatedAt | | | |

#### `QuoteCounter`, `CollectionOrderCounter`, `SupplyPurchaseQuoteCounter`, `SupplyPurchaseReceiptCounter`
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| year | Int | no | |
| lastValue | Int | no | 0 |
| createdAt / updatedAt | | | |
| Único | (clinicId, year) | | Prefijos: COT-, COB-, CPC-, REC- |

#### `CollectionOrder` (orden de cobro)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| locationId | FK Location | no | |
| patientId | FK Patient | no | |
| professionalUserId | FK User | no | |
| quoteId | FK Quote | sí | |
| clinicIncomeId | FK ClinicIncome | sí | único (ingreso generado al pagar) |
| createdByUserId / updatedByUserId | FK User | no / sí | |
| orderNumber | String | sí | COB-AAAA-000001 |
| totalAmount | Int | no | |
| coverageType | CollectionOrderCoverageType | no | NONE |
| coverageProviderName | String | sí | ≤120 |
| coverageAmount | Int | no | 0 |
| patientAmount | Int | no | total − cobertura |
| status | CollectionOrderStatus | no | PENDING (COVERED si patientAmount = 0) |
| paymentMethod | CollectionOrderPaymentMethod | sí | |
| paidAt / cancelledAt | DateTime | sí | |
| createdAt / updatedAt | | | |

### 1.7 Modelos — Finanzas

#### `ClinicIncome` (ingreso)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| locationId | FK Location | sí | |
| patientId | FK Patient | sí | |
| appointmentId | FK Appointment | sí | |
| quoteId | FK Quote | sí | |
| treatmentPlanId | FK TreatmentPlan | sí | |
| createdByUserId / updatedByUserId | FK User | no / sí | |
| name | String | no | ≤150 |
| category | String | sí | ≤80 |
| description | Text | sí | |
| incomeDate | DateTime | no | |
| amount | Int | no | ≥0 |
| paymentMethod | ClinicIncomePaymentMethod | sí | |
| paymentMethodOther | String | sí | ≤150, solo si OTHER |
| paymentType | ClinicIncomePaymentType | no | FULL |
| documentType | String | sí | ≤80 |
| documentNumber | String | sí | ≤80 |
| notes | Text | sí | |
| status | ClinicIncomeStatus | no | ACTIVE |
| archivedAt | DateTime | sí | |
| createdAt / updatedAt | | | |
| Relaciones | settlementItem (1:1), collectionOrder (1:1) | | |

#### `ClinicExpense` (gasto)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| locationId | FK Location | sí | |
| createdByUserId / updatedByUserId | FK User | no / sí | |
| name | String | no | ≤150 |
| category | String | sí | ≤80 |
| supplier | String | sí | ≤120 |
| description | Text | sí | |
| expenseDate | DateTime | no | |
| amount | Int | no | ≥0 |
| paymentMethod | ClinicExpensePaymentMethod | sí | |
| documentType | String | sí | ≤80 |
| documentNumber | String | sí | ≤80 |
| notes | Text | sí | |
| status | ClinicExpenseStatus | no | ACTIVE |
| archivedAt | DateTime | sí | |
| createdAt / updatedAt | | | |

#### `ClinicAgreement` (convenio)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| locationId | FK Location | sí | |
| name | String | no | ≤150 |
| type | ClinicAgreementType | no | COMPANY |
| status | ClinicAgreementStatus | no | ACTIVE |
| contactName | String | sí | ≤150 |
| contactEmail | String | sí | email |
| contactPhone | String | sí | ≤50 |
| description | Text | sí | |
| discountType | ClinicAgreementDiscountType | sí | |
| discountValue | Int | sí | |
| startDate / endDate | DateTime | sí | endDate ≥ startDate |
| notes | Text | sí | |
| archivedAt | DateTime | sí | |
| federatedConvenioId | String | sí | único |
| createdAt / updatedAt | | | |

#### `ClinicSettlement` (liquidación de profesional)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| locationId | FK Location | sí | |
| professionalUserId | FK User | sí | |
| period | String | no | "YYYY-MM" |
| title | String | no | ≤180 |
| periodStart / periodEnd | DateTime | sí | |
| status | ClinicSettlementStatus | no | DRAFT |
| grossAmount | Int | no | 0 |
| deductionsAmount | Int | no | 0 |
| bonusAmount | Int | no | 0 |
| netAmount | Int | no | 0 |
| paymentMethod | ClinicSettlementPaymentMethod | sí | |
| paymentDate | DateTime | sí | |
| documentType / documentNumber | String | sí | ≤80 |
| notes | Text | sí | |
| archivedAt | DateTime | sí | |
| createdAt / updatedAt | | | |

#### `ClinicSettlementItem`
| Campo | Tipo | Opcional |
|---|---|---|
| id | String | no |
| clinicId | FK Clinic | no |
| settlementId | FK ClinicSettlement | no (Cascade) |
| professionalUserId | FK User | no |
| clinicIncomeId | FK ClinicIncome | no (único: un ingreso solo se liquida una vez) |
| patientId | FK Patient | sí |
| appointmentId | FK Appointment | sí |
| locationId | FK Location | sí |
| serviceDate | DateTime | no |
| incomeDate | DateTime | no |
| patientNameSnapshot | String | no |
| locationNameSnapshot | String | sí |
| serviceSnapshot | String | no |
| descriptionSnapshot | String | sí |
| sourceAmount | Int | no |
| calculationType | String | no (PERCENTAGE / FIXED) |
| calculationValue | Int | no |
| professionalAmount | Int | no |
| createdAt / updatedAt | | |

### 1.8 Modelos — Inventario, compras y equipos

#### `ClinicSupply` (insumo)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| locationId | FK Location | sí | |
| createdByUserId / updatedByUserId | FK User | no / sí | |
| name | String | no | ≤150 |
| category | String | sí | ≤80 |
| supplier | String | sí | ≤120 |
| consultingRoom | String | sí | lista fija de 7 consultorios |
| description | Text | sí | |
| purchaseDate | DateTime | sí | |
| quantity | Float | sí | |
| unit | String | sí | ≤30 |
| unitCost | Int | sí | |
| totalCost | Int | sí | |
| currentStock | Float | sí | |
| minimumStock | Float | sí | |
| status | ClinicSupplyStatus | no | ACTIVE |
| archivedAt | DateTime | sí | |
| createdAt / updatedAt | | | |
| Relaciones | lots, lotMovements, quoteItems, purchaseQuoteItems, purchaseReceiptItems | | |

#### `ClinicSupplyLot` (lote)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| supplyId | FK ClinicSupply | no | Cascade |
| locationId | FK Location | sí | |
| createdByUserId / updatedByUserId | FK User | no / sí | |
| lotNumber | String | no | ≤120, regex `^[A-Za-z0-9][A-Za-z0-9 .-]*$`, único por insumo |
| manufacturer | String | sí | ≤120 |
| presentation | String | sí | ≤120 |
| concentration | String | sí | ≤120 |
| healthRegistration | String | sí | ≤120 (registro sanitario ISP) |
| receivedAt | DateTime | sí | |
| expiresAt | DateTime | sí | |
| initialQuantity | Float | no | |
| currentQuantity | Float | no | |
| isActive | Boolean | no | true |
| createdAt / updatedAt | | | |

#### `ClinicSupplyLotMovement`
| Campo | Tipo | Opcional |
|---|---|---|
| id | String | no |
| clinicId | FK Clinic | no |
| supplyId | FK ClinicSupply | no |
| lotId | FK ClinicSupplyLot | no |
| locationId | FK Location | sí |
| createdByUserId | FK User | no |
| purchaseReceiptId | FK SupplyPurchaseReceipt | sí |
| purchaseQuoteId | FK SupplyPurchaseQuote | sí |
| movementType | ClinicSupplyLotMovementType | no |
| quantity | Float | no (>0) |
| previousQuantity | Float | no |
| resultingQuantity | Float | no |
| reason | String | sí (≤500; obligatorio si ADJUSTMENT) |
| createdAt | DateTime | no |

#### `SupplyPurchaseQuote` (cotización de compra a proveedor)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| locationId | FK Location | no | |
| createdByUserId / updatedByUserId | FK User | no / sí | |
| quoteNumber | String | sí | CPC-AAAA-000001 |
| supplierName | String | no | ≤150 |
| supplierRut | String | sí | ≤20 (RUT chileno validado) |
| supplierContact | String | sí | ≤200 |
| quoteDate | DateTime | no | now() |
| validUntil | DateTime | sí | |
| status | SupplyPurchaseQuoteStatus | no | DRAFT |
| notes | Text | sí | ≤2000 |
| subtotal / discountAmount / shippingAmount / totalAmount | Int | no | 0 |
| createdAt / updatedAt | | | |
| Relaciones | items, receipt (1:1), receiptMovements | | |

#### `SupplyPurchaseQuoteItem`
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| purchaseQuoteId | FK SupplyPurchaseQuote | no | Cascade |
| supplyId | FK ClinicSupply | sí | |
| name | String | no | ≤200 |
| description | Text | sí | ≤2000 |
| unit | String | no | ≤60 |
| quantity | Decimal(12,3) | no | >0 |
| unitCost | Int | no | ≥0 |
| discountAmount | Int | no | 0 |
| lineSubtotal | Int | no | |
| lineTotal | Int | no | |
| sortOrder | Int | no | 0 |
| createdAt / updatedAt | | | |

#### `SupplyPurchaseReceipt` (recepción de compra)
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| locationId | FK Location | no | |
| purchaseQuoteId | FK SupplyPurchaseQuote | no | único (una recepción por cotización) |
| receivedByUserId | FK User | no | |
| receiptNumber | String | sí | REC-AAAA-000001 |
| receivedAt | DateTime | no | now() |
| supplierDocumentNumber | String | sí | ≤80 |
| supplierDocumentDate | DateTime | sí | |
| notes | Text | sí | ≤2000 |
| createdAt | DateTime | no | |

#### `SupplyPurchaseReceiptItem`
| Campo | Tipo | Opcional |
|---|---|---|
| id | String | no |
| purchaseReceiptId | FK SupplyPurchaseReceipt | no |
| purchaseQuoteItemId | FK SupplyPurchaseQuoteItem | no |
| supplyId | FK ClinicSupply | no |
| lotId | FK ClinicSupplyLot | no |
| nameSnapshot | String | no |
| unitSnapshot | String | no |
| quantityReceived | Decimal(12,3) | no |
| unitCostSnapshot | Int | no |
| createdAt | DateTime | no |
| Único | (purchaseReceiptId, purchaseQuoteItemId) | |

#### `ClinicEquipment`
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| locationId | FK Location | no | Restrict |
| consultingRoomId | FK ClinicConsultingRoom | sí | |
| responsibleUserId | FK User | sí | |
| createdByUserId / updatedByUserId | FK User | no / sí | |
| name | String | no | ≤150 |
| category | String | sí | ≤80 |
| clinicalArea | ClinicEquipmentClinicalArea | no | DENTAL |
| status | ClinicEquipmentStatus | no | ACTIVE |
| brand | String | sí | ≤100 |
| model | String | sí | ≤100 |
| serialNumber | String | sí | ≤120, único por clínica |
| assetTag | String | sí | ≤120, único por clínica |
| supplierName | String | sí | ≤120 |
| purchaseDate | DateTime | sí | |
| purchaseCost | Int | sí | |
| warrantyExpiresAt | DateTime | sí | |
| lastMaintenanceAt / nextMaintenanceAt | DateTime | sí | |
| lastCalibrationAt / nextCalibrationAt | DateTime | sí | |
| notes | Text | sí | |
| isActive | Boolean | no | true |
| createdAt / updatedAt | | | |
| Foto | (no hay columna) | | La foto vive en Cloudinary con publicId derivado del id del equipo |

### 1.9 Modelos — Marketing

#### `MarketingCampaign`
| Campo | Tipo | Opcional | Default |
|---|---|---|---|
| id | String | no | cuid |
| clinicId | FK Clinic | no | |
| locationId | FK Location | sí | |
| createdByUserId / updatedByUserId | FK User | no / sí | |
| name | String | no | ≤150 |
| service | String | sí | ≤200 |
| audience | String | sí | ≤500 |
| objective | String | sí | ≤500 |
| mainText | Text | sí | ≤10000 |
| shortText | Text | sí | ≤2000 |
| hashtags | Text | sí | ≤2000 |
| callToAction | String | sí | ≤200 |
| altText | Text | sí | ≤1000 |
| baseImageBase64 | Text | sí | ≤14 MB (legacy; hoy se sube a Cloudinary) |
| finalImageBase64 | Text | sí | ≤14 MB |
| imageMimeType | String | sí | |
| baseImageUrl / baseImagePublicId / baseImageBytes | String / String / Int | sí | Cloudinary |
| finalImageUrl / finalImagePublicId / finalImageBytes | String / String / Int | sí | Cloudinary |
| editorState | Json | sí | estado del editor de canvas (Konva) |
| templateKey | String | sí | ≤100 |
| visualStyleKey | String | sí | ≤100 |
| colorPaletteKey | String | sí | ≤100 |
| status | MarketingCampaignStatus | no | DRAFT |
| createdAt / updatedAt | | | |
| archivedAt | DateTime | sí | |

> Las "simulaciones de marketing" (`/marketing-simulations`) y la biblioteca de imágenes (`/marketing-media`) **no tienen tabla**: se almacenan directamente en Cloudinary (carpeta por clínica) y en el archivo estático `src/data/marketingImageLibrary.js`.


## 2. Endpoints de la API (Express, prefijo `/api`)

Fuente: `Dental-Demo-Back/src/app.js`, `src/routes/*.routes.js`, `src/validators/*.validators.js` (zod, todos `.strict()`: cualquier campo no listado es rechazado con 400). Autenticación: cookie httpOnly `access_token` (JWT HS256, TTL 2 h; en desarrollo también `Authorization: Bearer`). Respuestas típicas `{ ok: true, data }`. Todas las rutas (salvo las públicas) pasan por `authMiddleware` y por `requirePermission`/`requireAnyPermission`; muchas además por `requireClinicFeature(<FEATURE_KEY>)` (módulo contratado). Paginación estándar: `page` (default 1), `limit` (default 20, máx. 100).

Convenciones de tipos en "Body/Query": `str(n)` = string recortado con largo máximo n; `?` = opcional; `date` = fecha ISO coercible; `int≥0` = entero no negativo; `enum[...]` = valores permitidos.

### 2.1 Salud, autenticación y solicitudes de demo (públicos)

| Método | Ruta | Auth | Body / Query | Qué hace |
|---|---|---|---|---|
| GET | `/api/health` | — | — | `{ ok: true, message: "DentalOS API running" }` (el frontend lo usa para detectar el puerto 4001/4000 en dev) |
| POST | `/api/demo-requests` | — (rate limit 5/15 min) | `{ email: str(254) email }` | **Solicitud de demo** desde la landing forDentalCloud: envía correo "Nueva solicitud de demo — forDentalCloud" a `soporte@rids.cl` (remitente `diseno@rids.cl`) vía Microsoft Graph. **No persiste nada en BD.** |
| POST | `/api/auth/login` | — (rate limit 10/15 min) | `{ email, password }` | Valida credenciales (bcrypt) o, si el email = `SUPERADMIN_FEDERATED_EMAIL`, delega la verificación al login de DentalCloud. Setea cookie; responde `{ user, redirectTo }` (+ `token` en no-producción). |
| POST | `/api/auth/logout` | — | — | Borra cookie |
| GET | `/api/auth/me` | sí | — | Usuario actual + `permissions[]` efectivos + `accessScope` + `primaryLocation` + `assignedLocations` + `customGrants` |
| POST | `/api/webhooks/stripe` | firma Stripe (raw body) | evento Stripe | Procesa `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_succeeded/failed` → actualiza `Subscription.stripe*`, `Clinic.stripeCustomerId`, crea/actualiza `SubscriptionPayment` |

### 2.2 Plataforma (PLATFORM_ADMIN) — `/api/platform`

Rutas marcadas **(F)** aceptan además llamadas servidor-a-servidor desde DentalCloud con header `X-API-KEY = FEDERATION_API_KEY` (middleware `federationOrPlatformManage`).

| Método | Ruta | Body / Query | Qué hace |
|---|---|---|---|
| GET | `/clinics` (F) | — | Lista clínicas locales |
| GET | `/patients` (F) | — | Lista pacientes (todas las clínicas) |
| GET | `/appointments` (F) | — | Lista citas (todas las clínicas) |
| GET | `/dashboard` | — | KPIs de plataforma (clínicas, suscripciones, pagos, tickets, distribución de planes) |
| GET | `/federated/overview` | — | `{ local: {clinics, patients, appointments}, remote: {clinicas, pacientes, citas} \| null, remoteAvailable }` consultando DentalCloud |
| GET | `/plans` | — | Planes (BASIC/PROFESSIONAL/ENTERPRISE) |
| GET | `/feature-modules` | — | Catálogo de módulos |
| GET | `/module-requests` | `status?`, `clinicId?` | Solicitudes de personalización de módulos de todas las clínicas |
| GET | `/module-requests/:id` | — | Detalle |
| PATCH | `/module-requests/:id/status` | `{ status: enum[PENDING,IN_REVIEW,APPROVED,REJECTED,CANCELLED], adminNotes?: str(10000) }` | Resuelve la solicitud |
| GET | `/payments` | `status?`, `clinicId?`, `dateFrom?`, `dateTo?` | Pagos SaaS |
| GET | `/support-tickets` | `status?`, `priority?`, `clinicId?` | Tickets de soporte (**no existe endpoint para crearlos**) |
| GET | `/usage` | — | Snapshots de uso por clínica |
| POST | `/clinics` | `{ clinic: { name*, country? ("Chile"), currency? ("CLP", ISO-3), timeZone? ("America/Santiago", IANA válida), contactName*, contactEmail* (email), contactPhone*, clinicType? enum[DENTAL,ESTHETIC,BOTH] ("DENTAL") }, location: { name*, country?, currency? }, admin: { name*, email*, password* (≥10) }, subscription: { planId*, status enum[ACTIVE,TRIAL], startDate*, endDate* (> startDate), autoRenew (true) }, modules?: [{ key*, enabled*, quantity?, priceUsd? }] (≤100, sin duplicados) }` | **Alta de clínica** en transacción: Clinic + Location inicial + User CLINIC_OWNER + UserLocation + Subscription + SubscriptionModules. Luego (best-effort, asíncrono) espeja la clínica y la sede en DentalCloud (`syncClinicToFederation`, `syncLocationToFederation`) |
| GET | `/clinics/:id` | — | Detalle de clínica (suscripción vigente, módulos, pagos, tickets, uso) |
| PATCH | `/clinics/:id` | `{ name?, country?, currency?, timeZone?, contactName?, contactEmail?, contactPhone? }` (≥1 campo) | Edita datos de la clínica (valida coherencia país/moneda con sedes). **No permite editar `taxRatePercent` ni `clinicType`.** |
| PATCH | `/clinics/:id/status` | `{ status: enum[ACTIVE,TRIAL,SUSPENDED,EXPIRED] }` | Cambia estado; espeja activo/suspendido a DentalCloud |
| POST | `/clinics/:id/reactivate` | — | Reactiva clínica suspendida/expirada; espeja a DentalCloud |
| POST | `/clinics/:id/subscription` | `{ planId*, autoRenew? }` | Activa/cambia suscripción |
| GET | `/clinics/:id/modules` | — | Módulos de la clínica |
| PUT | `/clinics/:id/modules` | `{ modules: [{ key*, enabled*, quantity?, priceUsd? }] }` | Activa/desactiva módulos de la suscripción |
| GET | `/clinics/:id/payments` | — | Pagos de la clínica |
| GET | `/clinics/:id/support-tickets` | — | Tickets de la clínica |
| GET | `/clinics/:id/usage` | — | Uso de la clínica |
| GET | `/subscriptions` | — | Todas las suscripciones |
| **Federación entrante (F)** — payloads que envía dentalcloud-backend | | | |
| POST | `/federated/clinics/mirror` | `{ externalId*, name*, pais?, clinicType?, adminName?, adminEmail?, adminPassword?, active? }` | Crea/actualiza clínica espejo (`federatedClinicaId`); si es nueva crea también el usuario CLINIC_OWNER con la misma contraseña (o una temporal) |
| POST | `/federated/locations/mirror` | `{ clinicId*, externalId*, name*, country?, active? }` | Crea/vincula sede espejo (`federatedLocationId`) |
| POST | `/federated/users/mirror` | `{ clinicId*, externalId*, name*, email*, password?, role? }` | Crea/vincula usuario; mapea rol DentalCloud → local: admin→CLINIC_OWNER, odontologo→PROFESSIONAL/DENTIST, radiologo→PROFESSIONAL/OTHER, operador→RECEPTIONIST |
| POST | `/federated/patients/mirror` | `{ clinicId*, externalId*, firstName*, lastName*, rut?, email?, phone?, birthDate?, heightCm?, weightKg?, allergies?[], allergyNotes?, medicalConditions?, currentMedications? }` | Crea/actualiza paciente espejo (`federatedPatientId`); usa la sede "Sede federada" si no hay otra |
| POST | `/federated/appointments/mirror` | `{ clinicId*, patientId*, externalId*, startAt*, endAt*, status?, notes?, professionalName?, box? }` | Crea/actualiza cita espejo; mapea estados DentalCloud (agendada→SCHEDULED, llego→CONFIRMED, en_atencion→IN_PROGRESS, finalizada→COMPLETED, cancelada→CANCELLED) y registra `AppointmentStatusHistory` con `metadata.source = "federation"` |
| POST | `/federated/treatment-plans/mirror` | `{ patientId*, externalId*, title*, description?, status?, agreementId?, previsionId?, professionalName?, planType?, facialGender?, facialAnnotations?, removed? }` | Crea/actualiza plan espejo (estados: en_tratamiento→IN_PROGRESS, terminado/alta→COMPLETED, otro→DRAFT); `removed:true` archiva. **Única vía de escritura de `facialAnnotations`** |
| POST | `/federated/treatment-plans/items/mirror` | `{ treatmentPlanId*, externalId*, name*, description?, tooth?, unitPrice?, completed?, removed?, prestacionId?, listPrice?, convenioDiscountPercent?, productName?, productLot?, productExpiresAt?, productQuantity? }` | Crea/actualiza/borra ítem espejo (quantity siempre 1) y recalcula `estimatedTotal` |
| POST | `/federated/treatment-plans/items/photos/mirror` | `{ treatmentItemId*, externalId*, url*, label?, removed? }` | Upsert/borrado de `TreatmentPlanItemPhoto` (**única vía de escritura de fotos de ítems**) |
| POST | `/federated/agreements/mirror` | `{ clinicId*, externalId*, name*, discountPercent?, active? }` | Crea/vincula convenio (`federatedConvenioId`), sólo descuento porcentual |
| POST | `/federated/prestaciones/mirror` | `{ clinicId*, externalId*, name*, code?, basePrice?, active?, odontogramMode?, requiresProductTracking? }` | Crea/vincula prestación (por código si existe) |
| POST | `/federated/previsiones/mirror` | `{ clinicId*, externalId*, name*, active? }` | Crea/vincula previsión |
| GET | `/federated/supply-lots` | `clinicaId*` (id nativo DentalCloud), `search` (≥2 chars) | Devuelve hasta 20 lotes activos con stock (`{ id, supplyId, productName, lotNumber, expiresAt, stock }`) para que DentalCloud elija lote real al presupuestar |
| GET | `/federated/inventory/supplies` | `clinicaId*`, `sucursalId?` + filtros de insumos | Inventario federado (lectura) — actúa como "Bot de integración DentalCloud" |
| GET | `/federated/inventory/supplies/:id` | `clinicaId*` | Detalle insumo |
| POST | `/federated/inventory/supplies` | `{ clinicaId*, sucursalId?, ...createClinicSupplySchema }` | Crea insumo desde DentalCloud |
| PATCH | `/federated/inventory/supplies/:id` | `{ clinicaId*, sucursalId?, ...updateClinicSupplySchema }` | Edita insumo |
| POST | `/federated/inventory/supplies/:id/archive` | `{ clinicaId* }` | Archiva insumo |
| GET | `/federated/inventory/supplies/:id/lots` | `clinicaId*`, `sucursalId?` + filtros de lotes | Lotes del insumo |
| POST | `/federated/inventory/supplies/:id/lots` | `{ clinicaId*, ...createClinicSupplyLotSchema }` | Crea lote |
| PATCH | `/federated/inventory/supplies/:id/lots/:lotId` | `{ clinicaId*, ...updateClinicSupplyLotSchema }` | Edita lote |
| POST | `/federated/inventory/supplies/:id/lots/:lotId/movements` | `{ clinicaId*, movementType*, quantity*, reason? }` | Movimiento de lote |
| GET | `/federated/inventory/alerts` | `clinicaId*`, `sucursalId?` | Alertas de vencimiento |

### 2.3 Clínica — perfil, sedes, salas, personal, permisos

| Método | Ruta | Permiso | Body / Query | Qué hace |
|---|---|---|---|---|
| GET | `/api/clinic/profile` | CLINIC_VIEW | — | `{ clinic (con locations, subscriptions+plan, _count.users), entitlements (features, modules, limits, pricing), usage (users/locations vs límite) }`; sedes filtradas a las asignadas si no tiene LOCATIONS_VIEW_ALL |
| GET | `/api/clinic/locations` | LOCATIONS_VIEW_ALL/ASSIGNED | `search?`, `active?`/`isActive?`, `includeInactive?`, `page`, `limit` (50) | Lista sedes |
| GET | `/api/clinic/locations/:id` | idem | — | Detalle |
| POST | `/api/clinic/locations` | LOCATIONS_MANAGE + límite `maxLocations` | `{ name* str(150), country? str(100), currency? (3 letras), active?/isActive? }` | Crea sede (país/moneda deben coincidir con la clínica); espeja a DentalCloud |
| PUT | `/api/clinic/locations/:id` | LOCATIONS_MANAGE | mismos campos, ≥1 | Edita |
| DELETE | `/api/clinic/locations/:id` | LOCATIONS_MANAGE | — | Desactiva (active=false) |
| GET | `/api/clinic/consulting-rooms` | AGENDA_VIEW_* o EQUIPMENT_VIEW_* | `locationId?`, `supportsEsthetic?`, `isActive?`, `includeInactive?`, `page`, `limit` (100) | Lista boxes/salas |
| POST | `/api/clinic/consulting-rooms` | EQUIPMENT_MANAGE_* | `{ name* str(120), locationId*, isActive? (true), supportsDental? (true), supportsEsthetic? (false), notes? str(2000) }` | Crea sala |
| PUT | `/api/clinic/consulting-rooms/:id` | EQUIPMENT_MANAGE_* | mismos campos opcionales | Edita |
| PATCH/DELETE | `/api/clinic/consulting-rooms/:id/archive` · `/:id` | EQUIPMENT_MANAGE_* | — | Archiva (isActive=false) |
| GET | `/api/clinic/staff` | OPERATIONS_VIEW_ALL/ASSIGNED | `search?`, `role?`, `profession?`, `locationId?`, `status? enum[ACTIVE,INACTIVE,ALL]`, `page`, `limit` | Lista personal |
| GET | `/api/clinic/staff/:id` | idem | — | Detalle |
| POST | `/api/clinic/staff` | USERS_MANAGE_ALL/ASSIGNED + límite `maxUsers` | `{ firstName* str(80), lastName* str(80), email*, phone? str(30), password* (≥10), role enum[6 roles] ("PROFESSIONAL"), profession?, specialty? str(120), supportsEstheticTreatments? (false), agendaColor? (#RRGGBB \| null), locationId?, locationIds?[] (≤50), isActive (true) }` | Crea usuario de clínica. **`phone` es aceptado por el validador pero no existe columna en `User`: se descarta.** Si es PROFESSIONAL con estética se espeja a DentalCloud con la misma contraseña |
| PUT | `/api/clinic/staff/:id` | USERS_MANAGE_ALL/ASSIGNED | `{ firstName?, lastName?, name?, email?, phone?, role?, profession?, specialty?, supportsEstheticTreatments?, agendaColor?, locationId?, locationIds? }` | Edita (no cambia contraseña) |
| PATCH | `/api/clinic/staff/:id/status` | idem | `{ active?/isActive? }` (el frontend envía `{ status: 'ACTIVE'\|'INACTIVE' }` — ver brechas) | Activa/desactiva; impide dejar la clínica sin CLINIC_OWNER activo |
| GET | `/api/clinic/staff/:id/audit-history` | USERS_MANAGE_* | `action?`, `category?`, `actorUserId?`, `dateFrom?`, `dateTo?`, `page`, `limit` (50), `sortOrder` | Auditoría del usuario |
| GET | `/api/clinic/staff/permissions/grantable` | USERS_MANAGE_ALL | — | Catálogo de permisos otorgables agrupados (finance, collections, inventory, equipment, quotes, agenda) |
| GET | `/api/clinic/staff/:userId/permissions` | USERS_MANAGE_ALL | — | `{ rolePermissions, customGrants, effectivePermissions }` |
| PUT | `/api/clinic/staff/:userId/permissions` | USERS_MANAGE_ALL | `{ customGrants: string[] }` (conjunto completo) | Reemplaza `ClinicUserPermissionGrant` |
| GET | `/api/clinic/staff/me/module-access` | cualquier usuario autenticado | — | Overrides de menú propios |
| GET | `/api/clinic/staff/:userId/module-access` | USERS_MANAGE_ALL | — | Overrides de otro usuario |
| PUT | `/api/clinic/staff/:userId/module-access` | USERS_MANAGE_ALL | `{ overrides: [{ module: enum[12 módulos], effect: enum[ALLOW,DENY] }] }` | Reemplaza `ClinicUserModuleAccess` |

### 2.4 Suscripción, módulos y Stripe (clínica)

| Método | Ruta | Permiso | Body / Query | Qué hace |
|---|---|---|---|---|
| GET | `/api/clinic/module-requests` | SUBSCRIPTION_MANAGE | `page`, `limit` (50) | Solicitudes de módulos de la clínica |
| POST | `/api/clinic/module-requests` | SUBSCRIPTION_MANAGE | `{ modules: [{ key* str(80), quantity (1) }] (1..100), currency enum[CLP,USD,EUR] ("USD"), message? str(5000) }` | Crea `ModuleCustomizationRequest` con estimación de precios |
| GET | `/api/clinic/billing/stripe/status` | SUBSCRIPTION_MANAGE | — | `{ configured, testMode, hasCustomer, missing[], canCreateCheckout, canOpenPortal }` |
| POST | `/api/clinic/billing/stripe/checkout` | SUBSCRIPTION_MANAGE | `{ billingCycle: "MONTHLY" \| "YEARLY" }` | Crea sesión de Checkout (plan mensual/anual) |
| POST | `/api/clinic/billing/stripe/portal` | SUBSCRIPTION_MANAGE | — | Sesión de Customer Portal (requiere `stripeCustomerId`) |

### 2.5 Pacientes, privacidad, consentimientos — `/api/clinic/patients`

| Método | Ruta | Permiso | Body / Query | Qué hace |
|---|---|---|---|---|
| GET | `/` | AGENDA_VIEW_* | `search?`, `status? enum[ACTIVE,ARCHIVED]`, `locationId?`, `page`, `limit` | Lista pacientes (alcance por sedes asignadas) |
| GET | `/:id` | AGENDA_VIEW_* | — | Detalle (audita PATIENT_VIEWED) |
| POST | `/` | AGENDA_MANAGE_* | `{ firstName* str(80), lastName* str(80), rut? str(20), email? (≤254), phone? str(30), birthDate?, gender? str(30), address? str(200), notes? str(10000), locationId?, heightCm? int>0, weightKg? number>0, allergies? enum[9 claves][], allergyNotes? str(2000), medicalConditions? str(2000), currentMedications? str(2000) }` | Crea paciente; espeja a DentalCloud si la clínica está federada |
| PUT | `/:id` | AGENDA_MANAGE_* | mismos campos, ≥1 | Edita; espeja |
| DELETE | `/:id` | AGENDA_MANAGE_* | — | Archiva (status=ARCHIVED); espeja |
| GET | `/:id/audit-history` | AGENDA_VIEW_* | `category?`, `action?`, `actorUserId?`, `outcome?`, `dateFrom?`, `dateTo?`, `page`, `limit`(50), `sortOrder` | Auditoría del paciente |
| GET | `/:id/care-history` | AGENDA_VIEW_* | `dateFrom?`, `dateTo?`, `professionalId?`, `locationId?`, `status?`, `page`, `limit`, `sortOrder` | Historial de atenciones (citas) |
| GET | `/:id/privacy-requests` | PATIENTS_MANAGE_ASSIGNED | `requestType?`, `status?`, `dateFrom?`, `dateTo?`, `page`, `limit`, `sortOrder` | Solicitudes de privacidad |
| POST | `/:id/privacy-requests` | PATIENTS_MANAGE_ASSIGNED | `{ requestType: enum[DATA_EXPORT,DATA_CORRECTION,DATA_RESTRICTION,DATA_ANONYMIZATION], reason? str(2000) sin HTML }` | Crea solicitud (no duplica si hay una activa) |
| PATCH | `/:id/privacy-requests/:requestId/status` | USERS_MANAGE_ALL/ASSIGNED | `{ status: enum[6], resolutionNotes? str(2000) }` | Transiciones: PENDING→IN_REVIEW/CANCELLED; IN_REVIEW→APPROVED/REJECTED/CANCELLED; APPROVED→COMPLETED/CANCELLED |
| GET | `/:id/privacy-requests/:requestId/export` | USERS_MANAGE_ALL/ASSIGNED | — | Descarga JSON con datos del paciente (paciente, citas, historial de estados, planes+ítems, consentimientos, ficha clínica, notas, odontograma); requiere solicitud DATA_EXPORT APPROVED/COMPLETED |
| POST | `/:id/anonymize` | CLINIC_SETTINGS_MANAGE | `{ requestId*, confirm: true }` | Anonimiza (firstName="Paciente", lastName="Anonimizado-xxxxxx", rut/email/phone/address=null). Requiere: solicitud DATA_ANONYMIZATION APPROVED, paciente ARCHIVED, `ClinicDataRetentionPolicy.allowAnonymizationAfterRetention=true` y plazo de retención cumplido |
| GET | `/:patientId/consents` | AGENDA_VIEW_* | `status?`, `templateId?` | Consentimientos del paciente |
| GET | `/:patientId/consents/summary` | AGENDA_VIEW_* | — | Resumen (activos, vencidos, por propósito) |
| GET | `/:patientId/consents/:consentId` | AGENDA_VIEW_* | — | Detalle |
| GET | `/:patientId/consents/:consentId/pdf` | AGENDA_VIEW_* | — | PDF del consentimiento (pdfkit) |
| POST | `/:patientId/consents` | AGENDA_MANAGE_* + `requireCanManagePatientConsent` | `{ templateId*, method enum[IN_PERSON,DIGITAL,VERBAL,IMPORTED] ("IN_PERSON"), acceptedAt?, expiresAt? (≥ acceptedAt), representativeName? str(160), representativeRut? str(30), representativeRelationship? str(80), notes? str(20000) }` (si hay representante: nombre y relación obligatorios) | Registra consentimiento con snapshot de la plantilla |
| PATCH | `/:patientId/consents/:consentId/revoke` | AGENDA_MANAGE_* | `{ revokedAt?, reason? str(20000), notes? str(20000) }` | Revoca |

### 2.6 Plantillas de consentimiento — `/api/clinic/consent-templates`

| Método | Ruta | Permiso | Body / Query |
|---|---|---|---|
| GET | `/` | AGENDA_VIEW_* | `isActive?`, `search?` |
| GET | `/:id` | AGENDA_VIEW_* | — |
| POST | `/` | CLINIC_SETTINGS_MANAGE o USERS_MANAGE_ASSIGNED | `{ name* str(160), version* str(40), title* str(220), body* str(50000), purpose? str(20000), purposeType enum[GENERAL,ESTHETIC_AI_SIMULATION] ("GENERAL"), dataCategories? string[], channels? string[], isActive?, effectiveFrom? }` |
| PUT | `/:id` | idem | mismos campos, ≥1 |
| DELETE | `/:id` | idem | — (archiva: isActive=false) |

### 2.7 Ficha clínica y odontograma — `/api/clinic/clinical-records` (feature `CLINICAL_RECORD`)

| Método | Ruta | Permiso | Body / Query | Qué hace |
|---|---|---|---|---|
| GET | `/patients/:patientId` | CLINICAL_RECORD_VIEW_* | — | Antecedentes (`PatientClinicalRecord`) |
| PUT | `/patients/:patientId` | CLINICAL_RECORD_MANAGE_* | `{ medicalHistory?, allergies?, currentMedications?, chronicDiseases?, dentalHistory?, observations? }` (todos str(10000)) | Upsert antecedentes |
| GET | `/patients/:patientId/notes` | CLINICAL_RECORD_VIEW_* | `status?`, `professionalUserId?`, `appointmentId?`, `dateFrom?`, `dateTo?`, `page`, `limit` | Notas clínicas |
| POST | `/patients/:patientId/notes` | CLINICAL_RECORD_MANAGE_* | `{ title* str(180), noteDate?, reason? str(250), diagnosis?, treatment?, indications?, observations? (str 10000), appointmentId?, professionalUserId? }` | Crea nota (DRAFT) |
| GET | `/notes/:id` | VIEW | — | Detalle |
| PUT | `/notes/:id` | MANAGE | mismos campos, ≥1 | Edita |
| PATCH | `/notes/:id/status` | MANAGE | `{ status: enum[DRAFT,FINAL,ARCHIVED] }` | Cambia estado |
| DELETE | `/notes/:id` | MANAGE | — | Archiva |
| GET | `/patients/:patientId/odontogram` | ODONTOGRAM_VIEW_* | — | Entradas del odontograma |
| GET | `/patients/:patientId/odontogram/summary` | ODONTOGRAM_VIEW_* | — | Resumen por condición |
| GET | `/patients/:patientId/odontogram/:entryId` | ODONTOGRAM_VIEW_* | — | Detalle |
| POST | `/patients/:patientId/odontogram` | ODONTOGRAM_MANAGE_* | `{ toothNumber* (FDI válido), surface str(20) ("GENERAL"), condition* enum[12], diagnosis?, treatmentSuggestion?, notes? }` | Upsert por (diente, superficie) |
| PUT | `/patients/:patientId/odontogram/:entryId` | ODONTOGRAM_MANAGE_* | mismos campos opcionales | Edita |
| DELETE | `/patients/:patientId/odontogram/:entryId` | ODONTOGRAM_MANAGE_* | — | Elimina entrada |

### 2.8 Agenda — `/api/clinic/agenda`

| Método | Ruta | Permiso | Body / Query | Qué hace |
|---|---|---|---|---|
| GET | `/status-reasons` (también `/appointments/status-reasons`) | AGENDA_VIEW_* | — | Catálogo de motivos de cancelación y no-show |
| GET | `/professionals` | AGENDA_VIEW_* | `locationId?` | Profesionales agendables (con `agendaColor`) |
| GET | `/appointments` | AGENDA_VIEW_* | `date?`, `dateFrom?`, `dateTo?`, `locationId?`, `professionalUserId?`/`professionalId?`/`professionalIds?` (CSV ≤50), `patientId?`, `status?` | Lista citas |
| GET | `/appointments/daily-summary` | AGENDA_VIEW_* | `date` (hoy), `locationId?`, `professionalUserId?` | Resumen del día (conteos por estado, en espera, etc.) |
| GET | `/appointments/:id` | AGENDA_VIEW_* | — | Detalle |
| GET | `/appointments/:id/status-history` | AGENDA_VIEW_* | — | Historial de estados |
| POST | `/appointments` | AGENDA_MANAGE_* | `{ patientId*, startAt*, endAt* (> startAt), locationId* ("Debes seleccionar una sede"), professionalUserId?, title? str(150), reason? str(150), service? str(150), box? str(80) (el servicio lo exige: "Debes seleccionar un consultorio"), notes? str(10000), reasonCode?, reasonText? str(500), durationMinutes? int>0, status? }` | Crea cita (valida disponibilidad/solapes), espeja a DentalCloud y envía correo de confirmación al paciente si tiene email |
| PUT | `/appointments/:id` | AGENDA_MANAGE_* | mismos campos opcionales (≥1) | Reagenda/edita; si cambia horario registra historial con `reasonCode=RESCHEDULED` y horas previas |
| PATCH | `/appointments/:id/status` | AGENDA_MANAGE_* | `{ status* enum[6], reasonCode?, reasonText? }` | Cambia estado (CANCELLED/NO_SHOW exigen `reasonCode` del catálogo; OTHER exige `reasonText`). Al pasar a COMPLETED crea recordatorio automático según reglas |
| PATCH | `/appointments/:id/cancel` | AGENDA_MANAGE_* | `{ reasonCode?, reasonText?, cancellationReason? str(10000) }` | Cancela |
| GET | `/availability/professionals/:professionalUserId` | AGENDA_VIEW_* | — | Horarios semanales + bloqueos del profesional |
| GET | `/availability/professionals/:professionalUserId/check` | AGENDA_VIEW_* | `startAt*`, `endAt*`, `locationId?` | ¿Disponible en ese rango? |
| POST | `/availability/professionals/:professionalUserId/schedules` | AGENDA_MANAGE_* | `{ dayOfWeek* 0-6, startTime* HH:mm, endTime* HH:mm (> start), locationId?, consultingRoom? (lista fija \| null), isActive? }` | Crea tramo semanal |
| PUT / DELETE | `/availability/schedules/:id` | AGENDA_MANAGE_* | mismos campos / — | Edita / elimina tramo |
| POST | `/availability/professionals/:professionalUserId/blocks` | AGENDA_MANAGE_* | `{ startAt*, endAt* (> start), locationId?, reason? str(250), isActive? }` | Crea bloqueo |
| PUT / DELETE | `/availability/blocks/:id` | AGENDA_MANAGE_* | mismos campos / — | Edita / elimina bloqueo |
| GET | `/api/clinic/professionals/me/schedule` | autenticado | — | "Mi horario": horarios, bloqueos y próximas citas del profesional logueado |

### 2.9 Recordatorios — `/api/clinic/reminders`

| Método | Ruta | Permiso | Body / Query |
|---|---|---|---|
| GET | `/` | AGENDA_VIEW_* o PATIENTS_VIEW_ASSIGNED | `status?`, `patientId?`, `professionalUserId?`, `locationId?`, `dateFrom?`, `dateTo?`, `dueOnly?`, `overdueOnly?`, `page`, `limit` |
| GET | `/summary` | idem | mismos filtros sin paginación |
| GET | `/:id` | idem | — |
| POST | `/` | AGENDA_MANAGE_* o PATIENTS_MANAGE_ASSIGNED | `{ patientId*, locationId?, professionalUserId?, appointmentId?, treatmentPlanId?, title* str(180), description? str(10000), reminderType enum[7, sin QUOTE_FOLLOW_UP] ("GENERAL"), dueDate*, status enum[6] ("PENDING"), priority enum[LOW,NORMAL,HIGH] ("NORMAL"), contactMethod? str(80), contactedAt?, completedAt?, notes? str(10000) }` |
| PUT | `/:id` | idem | mismos campos opcionales (≥1). **No acepta `quoteId`** (solo lo setea el backend) |
| PATCH | `/:id/status` | idem | `{ status }` |
| DELETE | `/:id` | idem | — (cancela o elimina). El frontend envía `DELETE /api/clinic/reminders` con body `{ id }` (sin `/:id`) — ver brechas |
| GET | `/rules` | AGENDA_VIEW_* o PATIENTS_VIEW_ASSIGNED | — | Reglas automáticas |
| POST | `/rules` | AGENDA_MANAGE_* | `{ name* str(120), reminderType* enum[7], keywords* string[] (vacío sólo si GENERAL), intervalValue* int>0, intervalUnit* enum[DAYS,MONTHS], priority ("NORMAL") }` |
| PUT | `/rules/:id` | AGENDA_MANAGE_* | mismos campos opcionales |
| PATCH | `/rules/:id/status` | AGENDA_MANAGE_* | `{ isActive: boolean }` |
| DELETE | `/rules/:id` | AGENDA_MANAGE_* | — |

### 2.10 Prestaciones y previsiones (feature `TREATMENT_PLANS`, permisos CLINICAL_RECORD_*)

| Método | Ruta | Body / Query |
|---|---|---|
| GET | `/api/clinic/prestaciones` | `search?`, `all? ("true" incluye inactivas)` |
| POST | `/api/clinic/prestaciones` | `{ name* str(180), code? str(60), basePrice int≥0 (0), odontogramMode? enum[7], requiresProductTracking? bool }` (si no viene `odontogramMode` se sugiere por palabras clave del nombre). Espeja a DentalCloud |
| PUT | `/api/clinic/prestaciones/:id` | `{ name?, code?, basePrice?, active?, odontogramMode?, requiresProductTracking? }` |
| DELETE | `/api/clinic/prestaciones/:id` | — (active=false) |
| GET | `/api/clinic/previsiones` | `search?`, `all?` |
| POST | `/api/clinic/previsiones` | `{ name* str(150) }` |
| PUT | `/api/clinic/previsiones/:id` | `{ name?, active? }` |
| DELETE | `/api/clinic/previsiones/:id` | — |

### 2.11 Planes de tratamiento — `/api/clinic/treatment-plans` (feature `TREATMENT_PLANS`, permisos CLINICAL_RECORD_*)

| Método | Ruta | Body / Query | Qué hace |
|---|---|---|---|
| GET | `/` | `search?`, `status?`, `planType?`, `patientId?`, `professionalUserId?`, `page`, `limit` | Lista planes (incluye ítems con fotos, convenio, previsión, consentimiento, sala, pagos vinculados) |
| GET | `/summary` | `status?`, `planType?`, `patientId?`, `professionalUserId?` | Totales |
| GET | `/agreements/active` | — | Convenios activos (sin exigir permisos de finanzas) |
| GET | `/previsiones/active` | — | Previsiones activas |
| GET | `/supply-lots/search` | `search` | Lotes de inventario con stock > 0 (para prestaciones con `requiresProductTracking`) |
| GET | `/:id` | — | Detalle (audita) |
| GET | `/:id/estimate.pdf` | — | PDF del presupuesto |
| POST | `/` | `{ patientId*, professionalUserId?, consentId? (null), consultingRoomId? (null), agreementId?, previsionId?, planType enum[DENTAL,ESTHETIC] ("DENTAL"), facialGender? enum[hombre,mujer] \| null, title* str(180), description? str(10000), paymentMethod? str(40), items?: [{ name* str(180), description?, tooth? str(500), quantity int>0 (1), unitPrice int≥0 (0), sortOrder (0), prestacionId?, listPrice?, convenioDiscountPercent?, productName? str(180), productLot? str(120), productExpiresAt? str(30), productQuantity? str(60) }] }` | Crea plan con ítems en una transacción; espeja plan e ítems a DentalCloud |
| PUT | `/:id` | `{ professionalUserId?, consentId?, consultingRoomId?, agreementId?, previsionId?, planType?, facialGender?, title?, description?, paymentMethod? }` (≥1) | Edita cabecera. **No acepta `facialAnnotations`** |
| PATCH | `/:id/status` | `{ status enum[7] }` | Cambia estado (setea acceptedAt/completedAt/archivedAt) |
| POST | `/:id/items` | ítem (mismo shape que arriba) | Agrega ítem; recalcula total; espeja |
| PUT | `/:id/items/:itemId` | ítem opcional (≥1) | Edita ítem |
| PATCH | `/:id/items/:itemId/status` | `{ status enum[PENDING,IN_PROGRESS,COMPLETED,CANCELLED] }` | Cambia estado del ítem |
| DELETE | `/:id/items/:itemId` | — | Cancela ítem (status=CANCELLED) y lo quita del espejo |
| DELETE | `/:id` | — | Archiva plan |

### 2.12 Cotizaciones — `/api/clinic/quotes` (permisos QUOTES_*)

| Método | Ruta | Body / Query | Qué hace |
|---|---|---|---|
| GET | `/` | `status?`, `patientId?`, `locationId?`, `createdByUserId?`, `dateFrom?`, `dateTo?`, `search?`, `page`, `limit`, `sortOrder` | Lista |
| GET | `/eligible-professionals` | `locationId*` | Profesionales de la sede asignables |
| GET | `/eligible-supplies` | `locationId*`, `search?`, `page`, `limit` | Insumos de inventario para ítems INVENTORY_SUPPLY |
| GET | `/treatment-follow-up` | `status? enum[NOT_STARTED,IN_PROGRESS]`, `locationId?`, `search?`, `page`, `limit`, `sortOrder` | Cotizaciones aceptadas en seguimiento |
| GET | `/treatment-follow-up/summary` | `locationId?` | Conteos |
| POST | `/treatment-follow-up/reminders` | `{ locationId?, quoteIds?[] (1..50) }` | Genera `PatientReminder` tipo QUOTE_FOLLOW_UP y envía correo al paciente (aceptadas sin iniciar con `followUpAt` vencido, o en tratamiento sin citas hace >21 días) |
| GET | `/:id/pdf` | — | PDF (solo ISSUED/ACCEPTED/REJECTED/CANCELLED con número) |
| GET | `/:id` | — | Detalle |
| POST | `/` | `{ patientId*, locationId*, professionalUserId?, appointmentId?, treatmentPlanId?, validUntil?, notes? str(2000) sin HTML, items: [{ sourceType enum[MANUAL,INVENTORY_SUPPLY] ("MANUAL"), supplyId? (obligatorio si INVENTORY_SUPPLY), name? str(200) (obligatorio si MANUAL), description? str(2000), quantity* int>0, unitPrice* int≥0, discountType? enum[PERCENTAGE,FIXED_AMOUNT] \| null, discountValue int≥0 (0; ≤100 si %, ≤subtotal si fijo), sortOrder }] (≤100) }` | Crea (DRAFT); calcula subtotal/descuento/IVA (tasa de la clínica, incluido en el total)/total |
| PUT | `/:id` | igual sin `patientId` + `reason? str(500)` (obligatorio si la cotización ya está ACCEPTED) | Reemplaza ítems y datos |
| PATCH | `/:id/status` | `{ status* enum[5], reason? str(500) }` | Transiciones: DRAFT→ISSUED/CANCELLED; ISSUED→ACCEPTED/REJECTED/CANCELLED; ACCEPTED→CANCELLED (reason obligatorio; bloqueado si hay orden de cobro pagada). Al emitir asigna `quoteNumber` |
| PATCH | `/:id/treatment-status` | `{ treatmentStatus* enum[NOT_STARTED,IN_PROGRESS], followUpAt? }` | Seguimiento del tratamiento |
| POST | `/:id/follow-up-contact` | `{ followUpAt? }` | Marca contacto de seguimiento (`lastFollowUpAt`) |

### 2.13 Cobranza — `/api/clinic/collection-orders` (permisos COLLECTIONS_*)

| Método | Ruta | Body / Query | Qué hace |
|---|---|---|---|
| GET | `/` | `locationId?`, `status?`, `patientId?`, `search?`, `page`, `limit`, `sortOrder` | Lista órdenes |
| GET | `/:id` | — | Detalle |
| POST | `/` | `{ quoteId*, coverageType enum[NONE,FONASA,ISAPRE] ("NONE"), coverageProviderName? str(120), coverageAmount int≥0 (0; debe ser 0 si NONE, ≤ total) }` | Crea orden desde cotización ACCEPTED (número COB-…); `patientAmount = total − cobertura`; si queda 0 → COVERED |
| POST | `/:id/pay` | `{ paymentMethod* enum[CASH,DEBIT_CARD,CREDIT_CARD] }` | Registra pago: crea `ClinicIncome` vinculado (paciente, cotización, sede, profesional) y marca PAID |
| POST | `/:id/cancel` | `{}` | Cancela |

### 2.14 Finanzas — `/api/clinic/finance/*` (permisos FINANCE_*, feature `ADVANCED_FINANCE` salvo indicación)

| Método | Ruta | Body / Query | Qué hace |
|---|---|---|---|
| GET | `/cashbox/summary` | `dateFrom?`, `dateTo?`, `locationId?` | Caja operativa: ingresos, gastos, saldo, por método de pago |
| GET | `/incomes` | `search?`, `category?`, `patientId?`, `appointmentId?`, `quoteId?`, `treatmentPlanId?`, `locationId?`, `paymentMethod?`, `status?`, `dateFrom?`, `dateTo?`, `page`, `limit` | Lista ingresos |
| GET | `/incomes/summary` | mismos filtros | Totales |
| GET | `/incomes/:id` | — | Detalle |
| POST | `/incomes` | `{ name* str(150), category? str(80), description?, incomeDate*, amount* int≥0, paymentMethod? enum[CASH,CARD,TRANSFER,CHECK,OTHER], paymentMethodOther? str(150) (obligatorio si OTHER), paymentType? enum[FULL,PARTIAL], documentType? str(80), documentNumber? str(80), notes?, patientId?, appointmentId?, quoteId?, treatmentPlanId?, locationId? }` | Crea ingreso |
| PUT | `/incomes/:id` | mismos campos opcionales | Edita |
| DELETE | `/incomes/:id` | — | Archiva |
| PATCH | `/incomes/:id/restore` | — | Restaura |
| GET | `/expenses` · `/expenses/summary` · `/expenses/:id` | `search?`, `category?`, `supplier?`, `locationId?`, `paymentMethod?`, `status?`, `dateFrom?`, `dateTo?`, `page`, `limit` | Gastos |
| POST | `/expenses` | `{ name* str(150), category? str(80), supplier? str(120), description?, expenseDate*, amount* int≥0, paymentMethod? enum[5], documentType?, documentNumber?, notes?, locationId? }` | Crea gasto |
| PUT / DELETE | `/expenses/:id` | mismos campos / — | Edita / archiva |
| GET | `/agreements` · `/agreements/summary` · `/agreements/:id` (feature `AGREEMENTS`) | `search?`, `type?`, `status?`, `locationId?`, `dateFrom?`, `dateTo?`, `page`, `limit` | Convenios |
| POST | `/agreements` | `{ name* str(150), type? enum[5], contactName? str(150), contactEmail? email, contactPhone? str(50), description?, discountType? enum[PERCENTAGE,FIXED_AMOUNT,CUSTOM], discountValue? int≥0, startDate?, endDate? (≥ start), notes?, locationId? }` | Crea convenio; espeja a DentalCloud (solo % descuento) |
| PUT | `/agreements/:id` | mismos campos + `status? enum[ACTIVE,INACTIVE,EXPIRED,ARCHIVED]` | Edita |
| DELETE | `/agreements/:id` | — | Archiva |
| GET | `/settlements` (feature `LIQUIDATIONS`; PROFESSIONAL ve las suyas) | `search?`, `status?`, `period? YYYY-MM`, `professionalUserId?`, `locationId?`, `dateFrom?`, `dateTo?`, `page`, `limit` | Liquidaciones |
| GET | `/settlements/summary` · `/summary-by-professional` · `/by-professional/:professionalUserId` | `status?`, `period?`, `professionalUserId?`, `locationId?`, `dateFrom?`, `dateTo?` | Resúmenes |
| GET | `/settlements/eligible-incomes` | `professionalUserId?`, `periodStart*`, `periodEnd*`, `locationId?` | Ingresos no liquidados aún (vinculados al profesional vía cita o cotización) |
| GET | `/settlements/:id` · `/settlements/:id/pdf` | — | Detalle / PDF |
| POST | `/settlements` | `{ period* YYYY-MM, title* str(180), professionalUserId?, periodStart?, periodEnd?, grossAmount (0), deductionsAmount (0), bonusAmount (0), paymentMethod? enum[CASH,TRANSFER,CHECK,OTHER], paymentDate?, documentType?, documentNumber?, notes?, locationId?, items?: [{ clinicIncomeId*, calculationType* enum[PERCENTAGE,FIXED], calculationValue* (0-100 si %) }] (≤100) }` | Crea liquidación con ítems (snapshots de paciente/servicio, `professionalAmount` calculado); neto = bruto − deducciones + bonos |
| PUT | `/settlements/:id` | mismos campos de cabecera (sin `items`) | Edita cabecera |
| PATCH | `/settlements/:id/status` | `{ status enum[5] }` | Cambia estado |
| DELETE | `/settlements/:id` | — | Archiva |

### 2.15 Inventario — `/api/clinic/finance/supplies` (permisos INVENTORY_*, feature `ADVANCED_FINANCE`)

| Método | Ruta | Body / Query | Qué hace |
|---|---|---|---|
| GET | `/` · `/summary` | `search?`, `category?`, `supplier?`, `locationId?`, `consultingRoom? (lista fija o "**NONE**")`, `status?`, `dateFrom?`, `dateTo?`, `page`, `limit` | Insumos / KPIs |
| GET | `/lot-alerts` | `locationId?`, `includeItems (true)`, `expiresBefore?`, `expired?`, `expirationStatus? enum[ACTIVE,EXPIRING,EXPIRED,NO_EXPIRATION]`, `active?`, `page`, `limit` | Alertas de vencimiento de lotes |
| GET | `/:id` | — | Detalle |
| POST | `/` | `{ name* str(150), category? str(80), supplier? str(120), description?, purchaseDate?, quantity? num≥0, unit? str(30), unitCost? int≥0, totalCost? int≥0, currentStock? num≥0, minimumStock? num≥0, locationId?, consultingRoom? enum[7 consultorios] \| null }` | Crea insumo |
| PUT / DELETE | `/:id` | mismos campos / — | Edita / archiva |
| GET / PUT / DELETE | `/:supplyId/photo` | PUT: `{ imageBase64*, mimeType? }` (JPEG/PNG/WebP ≤10 MB, cuenta Cloudinary "inventory") | Foto del insumo |
| GET | `/:supplyId/lots` | `locationId?`, `search?`, `expirationStatus?`, `sortBy enum[lotNumber,quantity,expirationDate,receivedAt,createdAt]`, `sortOrder`, `active?`, `expiresBefore?`, `expired?`, `page`, `limit`(50) | Lotes |
| POST | `/:supplyId/lots` | `{ lotNumber*, manufacturer?, presentation?, concentration?, healthRegistration? (str 120), receivedAt?, expiresAt?/expirationDate?, initialQuantity?/quantity* num≥0, isActive (true) }` | Crea lote (actualiza stock) |
| PATCH | `/:supplyId/lots/:lotId` | `{ lotNumber?, manufacturer?, presentation?, concentration?, healthRegistration?, receivedAt?, expiresAt?, quantity?, isActive? }` | Edita lote |
| POST | `/:supplyId/lots/:lotId/movements` | `{ movementType* enum[IN,OUT,ADJUSTMENT], quantity* num>0, reason? str(500) (obligatorio si ADJUSTMENT) }` | Movimiento de stock |
| GET | `/:supplyId/lots/:lotId/movements` | `page`, `limit` | Historial |
| GET / PUT / DELETE | `/:supplyId/lots/:lotId/label-image` | PUT: `{ imageBase64*, mimeType? }` | Foto de la etiqueta del lote |

### 2.16 Cotizaciones de compra — `/api/clinic/supply-purchase-quotes` (INVENTORY_*, feature `ADVANCED_FINANCE`)

| Método | Ruta | Body / Query | Qué hace |
|---|---|---|---|
| GET | `/` | `locationId?`, `status?`, `search?`, `page`, `limit`, `sortOrder` | Lista |
| GET | `/:id` · `/:id/receipt` | — | Detalle / recepción asociada |
| POST | `/` | `{ locationId*, supplierName* str(150), supplierRut? str(20) (RUT válido), supplierContact? str(200), quoteDate? (null), validUntil? (null), shippingAmount (0), discountAmount (0), notes? str(2000), items*: [{ supplyId? \| null, name? str(200) (obligatorio si sin supplyId), description? str(2000), unit? str(60) (obligatorio si sin supplyId), quantity* num>0, unitCost* int≥0, discountAmount (0), sortOrder (0) }] (1..100) }` | Crea (DRAFT, número CPC-…) |
| PUT | `/:id` | mismos campos opcionales | Edita (DRAFT/RECEIVED) |
| PATCH | `/:id/status` | `{ status enum[5] }` | DRAFT→RECEIVED/CANCELLED; RECEIVED→APPROVED/REJECTED/CANCELLED |
| POST | `/:id/receive` | `{ receivedAt? (null), supplierDocumentNumber? str(80), supplierDocumentDate? (null), notes? str(2000), items*: [{ purchaseQuoteItemId*, lotNumber*, expirationDate?/expiresAt?, newSupplyData?: { category? str(80), minimumStock? num≥0, consultingRoom? str(80) } }] }` | Registra recepción (una sola por cotización APPROVED): crea insumos nuevos, lotes y movimientos IN; número REC-… |

### 2.17 Equipos — `/api/clinic/equipment` (permisos EQUIPMENT_*)

| Método | Ruta | Body / Query |
|---|---|---|
| GET | `/` | `search?`, `locationId?`, `consultingRoomId?`, `clinicalArea?`, `status?`, `category?`, `responsibleUserId?`, `maintenanceDueBefore?`, `calibrationDueBefore?`, `warrantyExpiresBefore?`, `isActive?`, `page`, `limit`, `sort enum[name,category,clinicalArea,status,purchaseDate,purchaseCost,warrantyExpiresAt,nextMaintenanceAt,nextCalibrationAt,createdAt,updatedAt]`, `order` |
| GET | `/summary` | mismos filtros |
| GET | `/:id` | — |
| POST | `/` | `{ locationId*, consultingRoomId? \| null, responsibleUserId? \| null, name* str(150), category? str(80), clinicalArea enum[DENTAL,ESTHETIC,BOTH] ("DENTAL"), status enum[5] ("ACTIVE"), brand? str(100), model? str(100), serialNumber? str(120), assetTag? str(120), supplierName? str(120), purchaseDate?, purchaseCost? int≥0, warrantyExpiresAt?, lastMaintenanceAt?, nextMaintenanceAt?, lastCalibrationAt?, nextCalibrationAt?, notes?, isActive (true) }` |
| PATCH | `/:id` | mismos campos opcionales |
| DELETE | `/:id` | — (archiva → RETIRED/isActive=false) |
| GET / PUT / DELETE | `/:id/photo` | PUT: `{ imageBase64*, mimeType? }` |

### 2.18 Simulación estética IA — `/api/clinic/esthetic-simulations` (features `ESTHETIC_TREATMENTS` + `ESTHETIC_AI_SIMULATION`, permisos ESTHETIC_SIMULATION_*)

| Método | Ruta | Body / Query | Qué hace |
|---|---|---|---|
| GET | `/` | `patientId?`, `locationId?`, `status?`, `page`, `limit` | Lista |
| GET | `/:id` | — | Detalle con URLs firmadas de Cloudinary (TTL `ESTHETIC_SIMULATION_SIGNED_URL_TTL_SECONDS`) |
| POST | `/` | `{ patientId*, locationId*, treatmentPlanId?, consentId* (consentimiento ACTIVO con propósito ESTHETIC_AI_SIMULATION), treatmentType* enum[8], disclaimerAccepted: true }` | Crea (PENDING) |
| POST | `/:id/original-image` | multipart `image` (≤10 MB) | Sube foto original a Cloudinary (privada) |
| POST | `/:id/generate` | — | Llama a OpenAI `gpt-image-1` (edición de imagen con prompt por tipo de tratamiento); límite diario `ESTHETIC_AI_DAILY_LIMIT` (20) → COMPLETED/FAILED |
| POST | `/:id/discard` | — | DISCARDED |
| DELETE | `/:id` | — | Borra registro e imágenes |

### 2.19 Marketing IA — `/api/clinic/marketing-*` (permisos MARKETING_VIEW / MARKETING_CREATE)

| Método | Ruta | Body / Query | Qué hace |
|---|---|---|---|
| GET | `/marketing-ai/status` (+plan con IA) | — | `{ configured, planIncludesAi, model… }` |
| POST | `/marketing-ai/generate-copy` (30/15 min) | `{ objective* str(500), platform* enum[INSTAGRAM,FACEBOOK,BOTH], audience* str(300), tone* enum[PROFESSIONAL,FRIENDLY,EDUCATIONAL,PROMOTIONAL], service* str(200), offer? str(200), clinicName? str(160), locationName? str(160), additionalInstructions? str(800), language "es-CL" }` | OpenAI texto (`gpt-5.4-mini` por defecto) → `{ caption, shortCaption, hashtags[5..12], callToAction, altText }` |
| POST | `/marketing-ai/generate-image` (10/15 min) | `{ prompt* str(2000), platform* enum[INSTAGRAM_POST(1024²),INSTAGRAM_STORY(1024×1536),FACEBOOK_POST(1536×1024),SQUARE], quality? enum[low,medium,high], variantCount 1\|3, visualMode enum[PHOTO,POST_BACKGROUND,FLYER_BACKGROUND], rightsConfirmed: true }` | Genera 1-3 imágenes (`gpt-image-2`) |
| POST | `/marketing-ai/edit-image` (10/15 min) | multipart `image` (png/jpeg/webp ≤ `OPENAI_MAX_UPLOAD_MB`) + `prompt*`, `platform*`, `quality?`, `visualMode`, `rightsConfirmed: true`, `containsPatient (false)`, `patientConsentConfirmed (false; obligatorio si containsPatient)` | Edición de imagen con IA (moderación previa) |
| GET | `/marketing-campaigns` | `status?`, `search?`, `locationId?`, `limit`, `page` | Campañas |
| GET | `/marketing-campaigns/:id` | — | Detalle |
| POST | `/marketing-campaigns` | `{ locationId?, name* str(150), service? str(200), audience? str(500), objective? str(500), mainText? str(10000), shortText? str(2000), hashtags? str(2000), callToAction? str(200), altText? str(1000), baseImageBase64? (≤14 MB), finalImageBase64?, imageMimeType?, editorState? (objeto JSON), templateKey? str(100), visualStyleKey? str(100), colorPaletteKey? str(100), status? enum[DRAFT,READY,ARCHIVED] }` | Crea campaña; las imágenes base64 se suben a Cloudinary y se guardan URL/publicId/bytes |
| PUT | `/marketing-campaigns/:id` | mismos campos opcionales | Edita |
| PATCH | `/marketing-campaigns/:id/status` | `{ status }` | Cambia estado |
| DELETE | `/marketing-campaigns/:id` | — | Archiva |
| GET | `/marketing-media/library` | — | Biblioteca estática de imágenes (`src/data/marketingImageLibrary.js`) |
| POST | `/marketing-media/upload` | imagen | Sube imagen a Cloudinary (carpeta marketing de la clínica) |
| GET | `/marketing-simulations` | `limit` (≤50), `nextCursor?` | Lista simulaciones (imágenes) en Cloudinary |
| POST | `/marketing-simulations` | `{ imageBase64*, mimeType? }` | Sube simulación |
| DELETE | `/marketing-simulations` | `{ publicId* }` | Borra |

### 2.20 Reportes — `/api/clinic/reports` (feature `ADVANCED_REPORTS`)

| Método | Ruta | Permiso | Query | Qué devuelve |
|---|---|---|---|---|
| GET | `/overview` | FINANCE/AGENDA/PATIENTS/OPERATIONS view | `dateFrom?`, `dateTo?`, `locationId?`, `groupBy enum[day,week,month] ("month")` | Resumen global (citas, pacientes, finanzas, tratamientos) con comparación vs. período anterior |
| GET | `/finance` | FINANCE_VIEW_* | idem | Ingresos, gastos, saldo, por método/categoría/mes, liquidaciones, insumos |
| GET | `/appointments` | AGENDA_VIEW_* | `dateFrom?`, `dateTo?`, `locationId?`, `professionalUserId?` | Citas por estado/profesional |
| GET | `/appointments/detailed` | AGENDA_VIEW_* | `dateFrom?`, `dateTo?`, `locationId?`, `professionalId?/professionalUserId?/professionalIds? (CSV ≤50)`, `status?/statuses? (CSV)`, `service?`, `createdByUserId?`, `box?`, `groupBy ("day")` | **Reporte detallado de citas**: KPIs (total, por estado, tasas de asistencia/cancelación/no-show, pacientes únicos/nuevos/recurrentes, creadas en período), timeline, desgloses por profesional/sede/box/servicio (cada uno con `avgAttentionDelayMinutes` = **demora en pasar a atender**: minutos entre `startAt` y el paso a IN_PROGRESS según `AppointmentStatusHistory`, mínimo 0, promedio), comparación período anterior, mapa de calor de demanda (día × franja), lead time de reserva, timing de cancelaciones, motivos de cancelación/no-show, reagendamientos, insights, calidad de datos |
| GET | `/appointments/detailed/rows` | AGENDA_VIEW_* | mismos + `page` (≤100000), `limit` (25, ≤100), `sortBy enum[startAt,status,professional,location,service,createdAt]`, `sortOrder` | Filas paginadas |
| GET | `/appointments/detailed/export/excel` · `/export/pdf` | AGENDA_VIEW_* | mismos filtros | Exporta Excel (exceljs, hojas: resumen, filas, doctores, sedes/boxes, motivos, demanda, calidad) / PDF |
| GET | `/patients` | PATIENTS_VIEW_ASSIGNED | `dateFrom?`, `dateTo?`, `locationId?`, `groupBy` | Nuevos pacientes por período, activos/archivados, por sede |
| GET | `/treatments` | AGENDA_VIEW_* | idem + `professionalUserId?` | Planes por estado/tipo/profesional, ítems, montos |


## 3. Pantallas y formularios del frontend

Fuente: `Dental-Demo/src/App.jsx` (rutas), `src/components/layout/Sidebar.jsx` (menú), `src/pages/**`. Convención: "Label" = texto por defecto de `t('clave', 'Texto')`; los payloads listados son exactamente lo que el código envía. Todas las llamadas usan `authFetch` (cookie de sesión) salvo descargas de PDF/Excel (fetch directo con `credentials: 'include'`).

### 3.0 Mapa de navegación (Sidebar) y rutas

**Grupo "Principal"**

| Menú | Ruta | Permiso / módulo requerido |
|---|---|---|
| Inicio | `/dashboard` | CLINIC_VIEW |
| Agenda → Agenda diaria | `/agenda/diaria` | AGENDA_VIEW_*/MANAGE_* (módulo de menú `AGENDA`) |
| Agenda → Monitor de sala | `/agenda/monitor` | idem (oculto para profesional) |
| Agenda → Mi horario | `/agenda/mi-horario` | solo profesional |
| Agenda → Recordatorios | `/agenda/recordatorios` | AGENDA_* |
| Agenda → Pacientes | `/agenda/pacientes` (alias `/pacientes`) | AGENDA_* |
| (desde Pacientes) Ficha clínica | `/pacientes/:id/ficha-clinica` | CLINICAL_RECORD_VIEW_* + feature `CLINICAL_RECORD` |
| (desde Pacientes) Planes de tratamiento | `/pacientes/:id/planes-tratamiento` | CLINICAL_RECORD_VIEW_* + feature `TREATMENT_PLANS` |
| Reportes | `/reportes` | canViewReports + feature `ADVANCED_REPORTS` (módulo `REPORTS`) |
| Mis liquidaciones (solo profesional) | `/finanzas/liquidaciones` | feature `LIQUIDATIONS` |
| Cotizaciones | `/cotizaciones`, `/cotizaciones/nueva`, `/cotizaciones/:id` | QUOTES_* (módulo `QUOTES`) |
| Finanzas → Caja operativa | `/finanzas/caja` | FINANCE_* + feature `ADVANCED_FINANCE` (módulo `FINANCE`) |
| Finanzas → Ingresos | `/finanzas/ingresos` | idem |
| Finanzas → Gastos | `/finanzas/gastos` | idem |
| Finanzas → Liquidaciones | `/finanzas/liquidaciones` | FINANCE_* + feature `LIQUIDATIONS` |
| Finanzas → Convenios | `/finanzas/convenios` | FINANCE_* + feature `AGREEMENTS` |
| Finanzas → Cobranza | `/finanzas/cobranza` | COLLECTIONS_* (módulo `COLLECTIONS`) |
| Operaciones → Inventario | `/operaciones/inventario` (legacy `/finanzas/insumos`) | INVENTORY_* + feature `ADVANCED_FINANCE` (módulo `INVENTORY`) |
| Operaciones → Cotizaciones de compra | `/operaciones/inventario/cotizaciones-compra` | idem |
| Operaciones → Equipos | `/operaciones/inventario/equipos` | EQUIPMENT_VIEW_* (módulo `EQUIPMENT`) |
| Operaciones → Simulación estética IA | `/operaciones/simulacion-estetica-ia` | rol CLINIC_OWNER/PROFESSIONAL + features `ESTHETIC_TREATMENTS` y `ESTHETIC_AI_SIMULATION` (módulo `ESTHETIC_SIMULATION`) |
| Operaciones → Personal | `/operaciones/personal` | OPERATIONS_* + rol CLINIC_OWNER/LOCATION_MANAGER (módulo `STAFF`) |
| Operaciones → Prestaciones | `/operaciones/prestaciones` | CLINICAL_RECORD_VIEW_* + feature `TREATMENT_PLANS` (módulo `PRESTACIONES`) |
| Operaciones → Previsiones | `/operaciones/previsiones` | idem (módulo `PREVISIONES`) |
| (sin menú) Nómina / Reloj checador | `/operaciones/nomina`, `/operaciones/reloj-checador` | OPERATIONS_* (mock) |
| Marketing IA | `/marketing-ia` | MARKETING_VIEW + feature `MARKETING_AI` (módulo `MARKETING`) |

**Grupo "Cuenta" → Ajustes**

| Menú | Ruta | Permiso |
|---|---|---|
| Suscripción | `/ajustes/suscripcion` (alias `/suscripcion`, `/plan-activo`) | SUBSCRIPTION_MANAGE (no plataforma) |
| Sedes | `/ajustes/sedes` (alias `/ajustes/sucursales`) | LOCATIONS_VIEW_ALL / LOCATIONS_MANAGE |
| Usuarios org | `/ajustes/usuarios-org` | USERS_VIEW_ALL / USERS_MANAGE_ALL (**mock**) |
| (sin menú) Usuarios sede | `/ajustes/usuarios-sede` | USERS_*_ASSIGNED (**mock**) |
| Horarios | `/ajustes/horarios` | AGENDA_VIEW_ALL / AGENDA_MANAGE_ALL / CLINIC_SETTINGS_MANAGE |
| Consentimientos | `/ajustes/consentimientos` | CLINIC_SETTINGS_MANAGE / USERS_MANAGE_ASSIGNED |
| (sin menú, stubs) Especialidades, Cargos, Precios, Honorarios, Documentos, Recordatorios, WhatsApp, Outbox | `/ajustes/*` | CLINIC_SETTINGS_MANAGE (**mock**) |
| Billing | `/billing/success`, `/billing/cancel` | retorno de Stripe |

**Panel de plataforma (`AdminLayout`, solo PLATFORM_MANAGE):** `/admin-plataforma/resumen`, `/clinicas`, `/clinicas/:id`, `/suscripciones`, `/planes`, `/pagos`, `/uso`, `/solicitudes-modulos`, `/soporte`.

**Otros:** `/login`, `/sin-autorizacion`.

Además del permiso, cada ítem de menú puede ser ocultado/mostrado por usuario mediante `ClinicUserModuleAccess` (ALLOW/DENY por módulo, ver Personal → "Permisos de módulos").


### 3.A Pacientes y Ficha clínica (`src/pages/Pacientes.jsx`, `src/pages/pacientes/*`)

#### 3.A.1 `Pacientes.jsx` — Listado de pacientes (`/pacientes`, `/agenda/pacientes`)

Permisos internos: `canManage` = AGENDA_MANAGE_ALL/ASSIGNED (crear/editar/archivar); `canAccessClinicalRecord` = CLINICAL_RECORD_VIEW_*; `canCreateQuote` = QUOTES_MANAGE_*. Carga `GET /api/clinic/patients?search&status&locationId` (debounce 250 ms; sede activa del dominio `agenda`).

KPIs: Total registrados · Activos · Archivados · "Listos para atención" (activos con teléfono o email). Tarjeta "Pacientes por atención": select `professionalFilter` (local) y tiles Con próxima cita / Sin próxima cita / Atendidos recientemente.

Filtros: tabs `attentionFilter` (Todos, Con próxima cita, Sin próxima cita, Archivados — local); `search` "Buscar por nombre, RUT, correo o teléfono..." (enviado y local); `filterStatus` (Todos los estados / Activos / Archivados → `status`); chips "Consentimiento:" (Todos, Vigente, Pendiente, Revocado, Vencido, Requiere atención — local sobre `consentSummary.status`).

Tabla: Paciente (avatar, nombre, email · teléfono, sede) | Atención (próxima/última atención con profesional, servicio, fecha, sede · consultorio) | Citas (N) | Consentimiento (badge → ficha `?section=consents`) | Estado | Acciones ("Ficha" + menú ⋮: Ver detalle, Planes de tratamiento, Nueva cita, Nueva cotización, Editar, Archivar con confirm → `DELETE /api/clinic/patients/:id`).

**Panel lateral `PatientPanel`** (solo lectura, pestañas Información / Notas): Teléfono, Correo, Nacimiento, Género (código crudo FEMALE/MALE/OTHER), Dirección, Creado, Actualizado; Antecedentes: Altura (cm), Peso (kg), Alergias (labels), Detalle alergias, Condiciones médicas, Medicamentos; Consentimiento: Estado, Plantilla, Versión, Última aceptación; Actividad clínica: Total citas, Próxima cita, Última atención, Profesional, Servicio, Consultorio; Notas.

**Modal `PatientModal` — "Nuevo paciente" / "Editar paciente"** → `POST /api/clinic/patients` / `PUT /api/clinic/patients/:id`. Guardar habilitado solo con nombre y apellido. El payload se construye con `buildPatientPayload` (`patientForm.js`) que **solo incluye** `firstName, lastName, rut, email, phone, birthDate, gender, address, notes` y omite vacíos.

| Campo (estado) | Label | Tipo | Obligatorio | Opciones / validación / default | Payload |
|---|---|---|---|---|---|
| `firstName` | Nombre * | text | Sí | trim | `firstName` |
| `lastName` | Apellido * | text | Sí | trim | `lastName` |
| `rut` | RUT | text con autoformato (puntos/guion, K) | No; si tiene valor debe pasar `isValidChileanRut` → "El RUT ingresado no es válido." | normalizado `12.345.678-9` | `rut` |
| `birthDate` | Fecha nacimiento | date | No | — | `birthDate` |
| `phone` | Teléfono | text | No | — | `phone` |
| `email` | Correo | email | No | validación HTML | `email` |
| `gender` | Género | select | No | `''` Sin especificar · `FEMALE` Femenino · `MALE` Masculino · `OTHER` Otro | `gender` |
| `address` | Dirección | text | No | — | `address` |
| `notes` | Notas | textarea | No | — | `notes` |
| `heightCm` | Altura (cm) | number min 0 | No | placeholder 170 | **NO se envía** |
| `weightKg` | Peso (kg) | number min 0 step 0.1 | No | placeholder 70 | **NO se envía** |
| `allergies` | Alergias | 9 checkboxes (`ALLERGY_OPTIONS`: fluoruro, penicilina, anestesicos_locales, latex, yodo, niquel_metales, aines, sulfitos, otro) | No | array de claves | **NO se envía** |
| `allergyNotes` | (placeholder "Detalle de alergias…") | textarea | No | — | **NO se envía** |
| `medicalConditions` | Condiciones médicas relevantes | textarea | No | placeholder "Ej. diabetes, hipertensión, embarazo..." | **NO se envía** |
| `currentMedications` | Medicamentos actuales | textarea | No | placeholder "Ej. anticoagulantes, antihipertensivos..." | **NO se envía** |
| (oculto) | — | — | — | solo al crear, si hay sede activa | `locationId` |

> Existe en `Pacientes.jsx` una función `buildPayload` (líneas ~273-285) que sí incluye altura/peso/alergias/condiciones/medicamentos, pero **nunca se invoca**.

#### 3.A.2 `FichaClinica.jsx` — Ficha clínica (`/pacientes/:id/ficha-clinica`)

Permisos: ver = CLINICAL_RECORD_VIEW_*; editar ficha/notas = CLINICAL_RECORD_MANAGE_*; odontograma editable solo roles CLINIC_OWNER/PROFESSIONAL; consentimientos gestionables por CLINIC_OWNER/LOCATION_MANAGER/RECEPTIONIST; drawer Privacidad = PATIENTS_MANAGE_ASSIGNED (revisar/exportar: USERS_MANAGE_*; anonimizar: CLINIC_SETTINGS_MANAGE).

Cargas: `GET /patients/:id`, `GET /clinical-records/patients/:id`, `GET …/notes`, `GET …/odontogram` + `/summary`, `GET /reminders?patientId&limit=50`, `GET /reminders/summary?patientId`, `GET /agenda/appointments?patientId&limit=50`, `GET /agenda/professionals`, perfil de clínica (sedes).

Cabecera: nombre, documento, contacto, badge estado, "Solo lectura" si aplica; botones Volver a pacientes · Historial de actividad · Historial de atenciones · Privacidad y datos · Ver planes de tratamiento · Nueva cita.

KPIs: Alergias (texto libre de la ficha) · Antecedentes médicos · Antecedentes dentales · Observaciones · Total notas clínicas · Última actualización.

**Seguimiento clínico:** botones Crear recordatorio / Agendar cita / Ver recordatorios; tarjetas Próxima cita, Recordatorios pendientes, Recordatorios vencidos, Último seguimiento, Última sede, Próxima sede; lista compacta (máx. 5) de recordatorios PENDING/OVERDUE + citas futuras.

**Modal `ReminderQuickModal` — "Nuevo recordatorio"** → `POST /api/clinic/reminders`

| Campo | Label | Tipo | Obligatorio | Opciones / default | Payload |
|---|---|---|---|---|---|
| `title` | Título * | text | Sí | — | `title` |
| `type` | Tipo * | select | Sí | GENERAL General, CHECKUP Control, CLEANING Limpieza, POST_TREATMENT Post tratamiento, ORTHODONTIC_CONTROL Control de ortodoncia, IMPLANT_CONTROL Control de implante, SURGERY_FOLLOW_UP Seguimiento cirugía; default GENERAL | `type` (**el backend espera `reminderType`**) |
| `targetDate` | Fecha de vencimiento * | date | Sí | — | `targetDate` (**el backend espera `dueDate`**) |
| `priority` | Prioridad * | select | Sí | LOW Baja, NORMAL Normal, HIGH Alta | `priority` |
| `professionalUserId` | Profesional | select | No | "Sin profesional asignado" + profesionales de agenda | `professionalUserId` |
| `locationId` | Sede | select | No | "Todas" + sedes | `locationId` |
| `notes` | Notas | textarea | No | — | `notes` |
| (oculto) | — | — | — | id de la ruta | `patientId` |

**Sección "Consentimiento y privacidad"** (`PatientConsentsSection`): tarjeta de estado (Vigente/Pendiente/Revocado/Vencido, última aceptación/revocación); botón contextual "Registrar consentimiento" / "Registrar nueva versión" / "Registrar nuevo consentimiento" / "Renovar consentimiento"; tabla historial: Plantilla | Versión | Estado | Método (Presencial/Digital/Verbal/Importado) | Fecha aceptación | Fecha revocación | Registrado por | Acciones (Descargar comprobante PDF `GET …/consents/:id/pdf`, Revocar).

**Modal `ConsentRegisterModal` — "Registrar consentimiento"** → `POST /api/clinic/patients/:id/consents`

| Campo | Label | Tipo | Obligatorio | Opciones / validación / default | Payload |
|---|---|---|---|---|---|
| `templateId` | Plantilla activa * | select | Sí | plantillas activas "{name} v{version}" (`GET /consent-templates?isActive=true`) | `templateId` |
| `method` | Método | select | (siempre) | IN_PERSON Presencial (default), DIGITAL Digital, VERBAL Verbal, IMPORTED Importado | `method` |
| `acceptedAt` | Fecha aceptación | date | No | default hoy | `acceptedAt` |
| `expiresAt` | Fecha expiración | date | No | ≥ acceptedAt | `expiresAt` |
| `legalRepresentativeName` | Representante legal | text | condicional (si hay datos de representante, nombre y relación obligatorios) | — | `representativeName` |
| `legalRepresentativeRut` | RUT representante | text con autoformato | No; RUT válido si presente | — | `representativeRut` |
| `legalRepresentativeRelationship` | Relación representante | text | condicional | — | `representativeRelationship` |
| (lectura) | Vista previa | — | — | nombre, versión, título, finalidad de la plantilla | — |
| `notes` | Observaciones | textarea | No | — | `notes` |

**Modal `ConsentRevokeModal`** → `PATCH …/consents/:consentId/revoke` con `{ reason, notes }` (ambas claves con el mismo texto del textarea "Observación o motivo").

**Formulario "Ficha general"** → `PUT /api/clinic/clinical-records/patients/:id` (siempre envía las 6 claves, ninguna obligatoria): `medicalHistory` "Antecedentes médicos", `allergies` "Alergias" (**texto libre**, distinto del vocabulario del paciente), `currentMedications` "Medicamentos actuales", `chronicDiseases` "Enfermedades crónicas", `dentalHistory` "Antecedentes dentales", `observations` "Observaciones". Botón "Guardar ficha".

**Sección "Notas clínicas":** tarjetas (título, fecha · profesional, badge Borrador/Final/Archivada, Motivo, Diagnóstico); acciones Ver/Editar (`GET /notes/:id`), Marcar final (`PATCH /notes/:id/status {status:'FINAL'}`), Archivar (`DELETE /notes/:id`).

**Modal `NoteModal` — "Nueva nota clínica" / "Editar nota clínica"** → `POST …/patients/:id/notes` / `PUT /notes/:id`

| Campo | Label | Tipo | Obligatorio | Default | Payload |
|---|---|---|---|---|---|
| `title` | Título | text required | Sí | — | `title` |
| `noteDate` | Fecha nota | date | No | hoy | `noteDate` |
| `reason` | Motivo | textarea | No | — | `reason` |
| `diagnosis` | Diagnóstico | textarea | No | — | `diagnosis` |
| `treatment` | Tratamiento | textarea | No | — | `treatment` |
| `indications` | Indicaciones | textarea | No | — | `indications` |
| `observations` | Observaciones | textarea | No | — | `observations` |

(El `status` no es editable en el modal; `appointmentId`/`professionalUserId` no tienen campo en la UI.)

**Sección "Odontograma"** (propio de la ficha): 32 piezas permanentes FDI (18-11, 21-28, 31-38, 48-41); superficies `GENERAL, O, M, D, V, L, P, MOD`; 12 condiciones: HEALTHY Sano, CARIES Caries, RESTORATION Restauracion, MISSING Ausente, EXTRACTION_INDICATED Extraccion indicada, IMPLANT Implante, CROWN Corona, ROOT_CANAL Endodoncia, FRACTURE Fractura, PERIODONTAL_ISSUE Periodontal, OBSERVATION Observacion, OTHER Otro. Resumen: Caries, Restauraciones, Coronas, Extracciones indicadas, Otros hallazgos.

**Modal `OdontogramModal` — "Pieza dental {n}"** → `POST …/odontogram` (upsert; también para editar) / `DELETE …/odontogram/:entryId`

| Campo | Label | Tipo | Obligatorio | Opciones / default | Payload |
|---|---|---|---|---|---|
| `toothNumber` | Pieza dental | text readOnly | — | pieza clicada | `toothNumber` |
| `surface` | Superficie | select | No | GENERAL/O/M/D/V/L/P/MOD; default GENERAL | `surface` |
| `condition` | Condición | select required | Sí | 12 condiciones; default HEALTHY | `condition` |
| `diagnosis` | Diagnóstico | textarea | No | — | `diagnosis` |
| `treatmentSuggestion` | Tratamiento sugerido | textarea | No | — | `treatmentSuggestion` |
| `notes` | Observaciones | textarea | No | — | `notes` |

**Drawer `PatientAuditDrawer` — "Historial de actividad"** → `GET /patients/:id/audit-history` (limit 20). Filtros: `category` (Todas, PATIENT, CLINICAL_RECORD, ODONTOGRAM, CONSENT, TREATMENT_PLAN, AGENDA, PRIVACY, QUOTE), `action` (~35 acciones: PATIENT_CREATED … QUOTE_DOWNLOADED), `actorUserId` (profesionales de agenda), `outcome` (SUCCESS/DENIED/FAILED), `dateFrom`, `dateTo`, `sortOrder`. Tarjeta: fecha, acción, categoría, resultado, actor, profesional tratante, sede, entidad, motivo, contexto de cita, cambios antes→después (oculta campos sensibles).

**Drawer `PatientCareDrawer` — "Historial de atenciones"** → `GET /patients/:id/care-history` (limit 20). Filtros: `dateFrom`, `dateTo`, `professionalId`, `locationId`, `status` (6 estados de cita), `sortOrder`. Resumen: Total de citas, Atenciones completadas, Canceladas, No asistió, Última atención, Próxima cita. Tarjeta por atención: fecha/hora, servicio, estado, badge de asistencia, profesional (color de agenda), sede, consultorio, duración, plan relacionado.

**Drawer `PatientPrivacyDrawer` — "Privacidad y datos"** → `GET /patients/:id/privacy-requests` (limit 20). Resumen (Pendientes, En revisión, Aprobadas, Completadas, Rechazadas/canceladas, sobre la página actual). Filtros: `requestType` (DATA_EXPORT Exportación de datos, DATA_CORRECTION Corrección de datos, DATA_RESTRICTION Restricción del tratamiento, DATA_ANONYMIZATION Anonimización), `status` (6), `dateFrom`, `dateTo`, `sortOrder`.

| Formulario | Campo | Label | Tipo | Obligatorio | Payload | Endpoint |
|---|---|---|---|---|---|---|
| Nueva solicitud | `createType` | Tipo de solicitud * | select | Sí | `requestType` | `POST /patients/:id/privacy-requests` |
| | `createReason` | Motivo (opcional) | textarea maxLength 2000 | No | `reason` | |
| Transición (`PrivacyTransitionModal`) | `transitionNotes` | Notas de resolución (opcional) | textarea maxLength 2000 | No | `{ status, resolutionNotes }` | `PATCH …/privacy-requests/:requestId/status` |
| Anonimizar (`PrivacyAnonymizeModal`) | `anonymizeConfirmText` | Escribe ANONIMIZAR para confirmar | text | Sí (exacto) | `{ requestId, confirm: true }` | `POST /patients/:id/anonymize` |
| Exportar | — | "Descargar datos" (DATA_EXPORT en APPROVED/COMPLETED) | botón | — | — | `GET …/privacy-requests/:requestId/export` (JSON) |

Transiciones: PENDING → IN_REVIEW/CANCELLED; IN_REVIEW → APPROVED/REJECTED/CANCELLED; APPROVED → COMPLETED/CANCELLED. Quien creó la solicitud no puede aprobarla.

#### 3.A.3 Odontograma de planes (`Odontogram.jsx`, `odontogramFormat.js`, `prestacionMode.js`, `ItemToothField.jsx`)

Componente distinto al de la ficha, usado en Planes de tratamiento. Piezas FDI con punto: permanentes 1.8…1.1, 2.1…2.8, 4.8…4.1, 3.1…3.8; temporales 5.5…5.1, 6.1…6.5, 8.5…8.1, 7.1…7.5. Caras: `top` superior, `right` derecha, `bottom` inferior, `left` izquierda, `center` central. Modos: `session` Sesión (toda la boca), `tooth` Pieza completa, `surface` Cara, `extraction` Extracción, `cuadrante`, `sextante` (S1-S6 sin terceros molares), `arcada` (superior/inferior). Salida a `TreatmentPlanItem.tooth` como **texto**: "Sesión" / "Piezas a extraer: 1.1, 1.2 y 1.3" / "Piezas: 1.1 y 2.1" / "Cuadrante 1" / "Sextante 2" / "Arcada superior" / "1.1: superior, derecha · 2.1: central". `ItemToothField`: label "Pieza(s) / zona", select de modo (si no viene bloqueado por la prestación) y odontograma interactivo; emite el texto y `odontogramMode/odontogramSelection` (no enviados).

#### 3.A.4 Mapa facial (`FacialZonePicker.jsx`, `FacialMapEditor.jsx`, `FacialZonesHighlight.jsx`, `facialMapPhotos.js`)

Usado en planes ESTHETIC. **14 zonas** (`FACIAL_ZONES`): frente Frente, entrecejo Entrecejo, sienes Sienes, parpados Párpados, patas_gallo Patas de gallo, ojeras Ojeras, pomulos Pómulos, nariz Nariz, nasogenianos Nasogenianos, codigo_barras Código de barras, labios Labios, menton Mentón, mandibula Mandíbula, cuello Cuello (en perfil solo 11: sin entrecejo, párpados, ojeras).

Imágenes (`public/facial-map/`): frontal `man-skin-layer-source.jpg` / `woman-skin-layer-source.jpg`; perfiles `man|woman-profile-derecho|izquierdo-skin.jpg`; con coordenadas (x%, y%) y tamaños por zona. Existen capas de músculo (`*-muscle*.jpg`) **no referenciadas** (`MUSCLE_LAYER_ENABLED = false`).

`FacialMapEditor` (interactivo): toggle vista `frontal` / `perfil` / `todas`; toggle género `mujer` (default) / `hombre` → `TreatmentPlan.facialGender`; toggle capa Piel / Músculos (**deshabilitado**, "Vista de músculos no disponible por ahora"); zoom 1.0–2.0; clic en zona o chip alterna la zona. **No hay herramientas de dibujo** (lápiz/línea/círculo). Valor guardado: **labels en español separados por coma** ("Frente, Mentón") en `TreatmentPlanItem.tooth`.

`FacialZonesHighlight` (solo lectura): resalta zonas de `items[].tooth` y renderiza `facialAnnotations` (`{ frontal: Stroke[], perfilDerecho: Stroke[], perfilIzquierdo: Stroke[] }`, `Stroke = { id, tool: lapiz|linea|circulo, points|from/to|center+radius }` en espacio 0–100) que **solo llegan por federación desde DentalCloud**.

`FacialZonePicker` (chips) define las zonas pero no se usa directamente.

#### 3.A.5 Alergias (`constants/allergies.js`, `allergenDetection.js`)

Vocabulario (9): fluoruro "Flúor / fluoruro", penicilina "Penicilina / antibióticos betalactámicos", anestesicos_locales "Anestésicos locales (lidocaína, articaína, etc.)", latex "Látex", yodo "Yodo / povidona yodada", niquel_metales "Níquel / metales", aines "AINEs (ibuprofeno, aspirina, etc.)", sulfitos "Sulfitos", otro "Otra". `detectAllergensInPrestacion(nombre)` detecta por palabra clave (fluor; anestesi/lidocaina/articaina/mepivacaina; penicilina/amoxicilina/betalactamico; latex; yodo/povidona; niquel/metal; ibuprofeno/aspirina/aine) para avisar "Este paciente es alérgico a: …" al agregar prestaciones.


### 3.B Planes de tratamiento y Cotizaciones

#### 3.B.1 `PlanesTratamiento.jsx` — `/pacientes/:id/planes-tratamiento`

Carga inicial: `GET /patients/:id`, `GET /staff?status=ACTIVE`, `GET /consulting-rooms?supportsEsthetic=true&isActive=true`, `GET /patients/:id/consents`, `GET /treatment-plans/agreements/active`, `GET /treatment-plans/previsiones/active`, `GET /prestaciones`, `GET /treatment-plans?patientId`, `GET /treatment-plans/summary?patientId`.

KPIs: Total planes · Planes activos · Planes aceptados · Monto estimado total · Pagado (`paidTotal`, derivado de `ClinicIncome.treatmentPlanId`) · Saldo pendiente · Items pendientes.

Panel izquierdo "Planes del paciente": pestañas "Planes dentales (N)" / "Planes estéticos (N)"; tarjeta por plan (título, profesional · fecha, badge tipo Dental/Estético orofacial, badge estado, total estimado, ítems, pagado, saldo; bloque estético: consultorio sugerido, consentimiento asociado/pendiente). Acciones: Ver detalle (`GET /:id`), Descargar presupuesto (`GET /:id/estimate.pdf`), Editar, `<select>` de estado (DRAFT Borrador, PROPOSED Propuesto, ACCEPTED Aceptado, IN_PROGRESS En curso, COMPLETED Completado, CANCELLED Cancelado, ARCHIVED Archivado → `PATCH /:id/status`), Archivar (`DELETE /:id`).

Panel derecho (detalle): cabecera con totales, profesional, convenio (-X%), previsión; en ESTHETIC bloque "Historial de zonas tratadas" (`FacialZonesHighlight`); tabla de ítems **Procedimiento | Pieza | Cant. | Unitario | Total | Estado | Acciones** (Editar, select estado PENDING/IN_PROGRESS/COMPLETED/CANCELLED → `PATCH /:id/items/:itemId/status`, Cancelar → `DELETE /:id/items/:itemId`); sub-línea de producto (Producto · Lote · Vence · cantidad) con aviso de vencimiento (rojo si venció, ámbar ≤30 días); miniaturas `item.photos[]`.

Reglas: convenio solo aplica descuento si `discountType === 'PERCENTAGE'` (`unitPrice = round(basePrice × (1 − pct/100))`); previsión informativa; profesionales para ESTHETIC filtrados por `supportsEstheticTreatments`; consentimientos estéticos = ACTIVE y texto con "estetic/orofacial".

**Asistente "Nuevo plan · Paso N de 3" (`NewPlanModal`)** → `POST /api/clinic/treatment-plans`

Paso 1 — Datos administrativos:

| Campo | Label | Tipo | Obligatorio | Opciones / default | Payload |
|---|---|---|---|---|---|
| `planType` | Tipo de plan | select | Sí | Dental / Estético orofacial (bloqueado si ya hay ítems) | `planType` |
| `previsionId` | Previsión | select | No | "Sin especificar" + previsiones activas | `previsionId` |
| `agreementId` | Convenio * | select | **Sí** ("Selecciona un convenio") | "Selecciona..." + convenios activos "{name} (-X%)" | `agreementId` |
| `professionalUserId` | Profesional | select | No | "Sin profesional asignado" + staff (ESTHETIC: solo habilitados) | `professionalUserId` |
| `consultingRoomId` | Consultorio estético sugerido | select (solo ESTHETIC) | No | salas aptas "{name · sede}" | `consultingRoomId` (null si vacío) |
| `consentId` | Consentimiento estético asociado | select (solo ESTHETIC) | No | consentimientos estéticos activos | `consentId` (null si vacío) |

Paso 2 — Prestaciones:

| Campo | Label / placeholder | Tipo | Obligatorio | Comportamiento | Payload |
|---|---|---|---|---|---|
| `prestacionSearch` | Buscar prestación ("Ej: destartraje, resina, corona..." / "Ej: botox, ácido hialurónico...") | autocomplete (máx. 8) | — | fija `prestacionId, name, listPrice, unitPrice, convenioDiscountPercent` y el modo de odontograma | — |
| botones "Avanzada" / "Plantillas" | — | disabled ("Próximamente") | — | — | — |
| `lotSearchQuery` / `selectedLot` | "Buscar lote real por producto o N° de lote..." | autocomplete (`GET /treatment-plans/supply-lots/search?search=`, ≥2 chars, debounce 300 ms) | **Sí si `requiresProductTracking`** | muestra "{producto} — Lote {n}", "Stock: N · Vence: fecha"; exige stock > 0 | `productName`, `productLot`, `productExpiresAt` (el `lot.id` **no** se envía) |
| `draftProductName` | "Producto (ej. Ácido Hialurónico)" | text (solo sin trazabilidad) | No | — | `items[].productName` |
| `draftProductLot` | "N° de lote" | text | No | — | `items[].productLot` |
| `draftProductExpiresAt` | "Fecha de vencimiento" | date | No | — | `items[].productExpiresAt` |
| `draftProductQuantity` | "Cantidad (ej. 1 jeringa 1ml)" | text | No | — | `items[].productQuantity` |
| `draftNotes` | "Notas clínicas (ej. reacción del paciente)..." | textarea | No | — | `items[].description` |
| `draftSelection` / `activeMode` | odontograma (DENTAL) | `Odontogram` | Sí salvo modo session | modo fijado por la prestación; 1 línea por pieza en modos tooth/extraction/surface | `items[].tooth` (texto) |
| `draftTooth` | mapa facial (ESTHETIC) | `FacialMapEditor` | Sí ("Selecciona al menos una zona…") | — | `items[].tooth` ("Frente, Mentón") |
| `form.facialGender` | Mujer / Hombre (toggle del mapa) | toggle | — | default `mujer` | `facialGender` |
| "Agregar prestación" | — | botón | — | agrega fila(s) a "Prestaciones agregadas" (nombre, badge -X%, tooth, ✕, precio editable) | `items[].unitPrice` |

Paso 3 — Totales y forma de pago: tabla resumen (Prestación | Área | Valor | Dcto convenio | Total) y:

| Campo | Label | Tipo | Obligatorio | Opciones / default | Payload |
|---|---|---|---|---|---|
| `title` | Nombre del plan | text | **Sí** | placeholder "Ej: Plan rehabilitación oral" | `title` |
| `paymentMethod` | Forma de pago | select | No | "Contado" (default), "Cuotas" | `paymentMethod` |
| `description` | Observaciones generales | textarea | No | — | `description` |

Payload final: `{ title, planType, description?, paymentMethod, professionalUserId?, agreementId?, previsionId?, [ESTHETIC: consultingRoomId, consentId, facialGender], patientId, items: [{ prestacionId?, name, tooth?, quantity: 1, unitPrice, listPrice, convenioDiscountPercent, sortOrder, productName?, productLot?, productExpiresAt?, productQuantity?, description? }] }`.

**Modal "Editar plan" (`PlanModal`)** → `PUT /api/clinic/treatment-plans/:id`: `planType` (Tipo de plan), `title` (Título, obligatorio), `description` (Observaciones generales), `previsionId`, `agreementId` (aquí opcional), `professionalUserId`, `consultingRoomId` y `consentId` (solo ESTHETIC). **No expone `paymentMethod` ni `facialGender`.**

**Modal "Nuevo procedimiento" / "Editar procedimiento" (`ItemModal`)** → `POST /:planId/items` / `PUT /:planId/items/:itemId`

| Campo | Label | Tipo | Obligatorio | Notas | Payload |
|---|---|---|---|---|---|
| `prestacionSearch` | Buscar prestación del catálogo | autocomplete (máx. 6) | — | fija prestación y modo | `prestacionId`, `listPrice`, `convenioDiscountPercent` (ocultos) |
| `name` | Nombre | text required | Sí | visible solo tras elegir prestación (o al editar) | `name` |
| `description` | Descripción | textarea | No | — | `description` |
| `quantity` | Cantidad | number min 1 | No (1) | — | `quantity` |
| `unitPrice` | Precio unitario (con -X% aplicado) | number min 0 | No | precalculado | `unitPrice` |
| `sortOrder` | Orden | number min 0 | No | — | `sortOrder` |
| `selectedLot` | buscador de lote | autocomplete | Sí si trazabilidad | — | `productName`, `productLot`, `productExpiresAt` |
| `productName` / `productLot` / `productExpiresAt` / `productQuantity` | Producto / N° de lote / Fecha de vencimiento / Cantidad | text/text/date/text | No | solo catálogo sin trazabilidad (cantidad siempre) | idem |
| `notes` | Notas clínicas | textarea | No | **no se envía** | — |
| `tooth` | Pieza(s) / zona | `ItemToothField` (DENTAL) / `FacialMapEditor` (ESTHETIC) | No | toggle género → `PUT /treatment-plans/:id { facialGender }` | `tooth` |

#### 3.B.2 `Cotizaciones.jsx` — `/cotizaciones`

`canManage` = QUOTES_MANAGE_ALL/ASSIGNED (ASSIGNED solo en sedes del usuario). Pestañas: **Cotizaciones** (documentos) / **Seguimiento** (aceptadas por iniciar o en tratamiento).

Filtros (`GET /api/clinic/quotes`): `search` "Número, paciente o RUT..."; `status` (Todos, DRAFT Borrador, ISSUED Emitida, ACCEPTED Aceptada, REJECTED Rechazada, CANCELLED Cancelada); `locationId` (solo si >1 sede); `dateFrom`; `dateTo`; `sortOrder` (desc/asc); chip oculto `patientId` (desde estado de navegación); `page`, `limit=20`.

Tabla: Número (o "Borrador sin número") | Paciente + RUT | Sede / Profesional | Estado (+ "Vigencia vencida") | Vigencia | Total | Acciones ("Ver" + menú). Menú por estado → `PATCH /quotes/:id/status`: DRAFT → Emitir (si hay ítems) / Cancelar; ISSUED → Marcar como aceptada (si no vencida) / Marcar como rechazada / Cancelar; ACCEPTED → Cancelar (**sin motivo desde el listado**); Descargar PDF (`GET /quotes/:id/pdf`) si tiene número y estado ≠ DRAFT.

Pestaña Seguimiento: KPIs (`GET /quotes/treatment-follow-up/summary`): Presupuestos no iniciados, en tratamiento, seguimientos pendientes; `followUpSearch` "Nombre del paciente o N° de cotización..."; sub-pestañas "No iniciado (N)" / "En tratamiento (N)" (`GET /quotes/treatment-follow-up?status&locationId&search&page&limit=20&sortOrder=asc`). Tarjeta: paciente, RUT, badges (No iniciado/En marcha; Seguimiento pendiente/programado/sin programar; Notificado/Recordatorio pendiente/No notificado), número, profesional, sede, total, aceptado, próximo seguimiento, último contacto. Acciones: Ver detalle; Registrar contacto (modal con `followUpAt` "Seleccionar próxima fecha" → `POST /quotes/:id/follow-up-contact`); Marcar en tratamiento / Marcar como no iniciado (`PATCH /quotes/:id/treatment-status {treatmentStatus}`); Enviar recordatorio (modal de confirmación → `POST /quotes/treatment-follow-up/reminders { quoteIds:[id] }`).

#### 3.B.3 `CotizacionDetalle.jsx` — `/cotizaciones/nueva`, `/cotizaciones/:id`

Modos: nueva (POST), editable (DRAFT, o ACCEPTED tras desbloqueo con motivo), documento solo lectura (ISSUED/ACCEPTED/REJECTED/CANCELLED). Profesionales elegibles `GET /quotes/eligible-professionals?locationId=` (solo dentistas). Moneda = `quote.currency || clinic.currency || 'CLP'`; IVA = `clinic.taxRatePercent ?? 19` (incluido en el total).

**Formulario principal** → `POST /api/clinic/quotes` / `PUT /api/clinic/quotes/:id`

| Campo | Label | Tipo | Obligatorio | Opciones / validación | Payload |
|---|---|---|---|---|---|
| `patientId` (`patientSearch`) | Paciente * | autocomplete (solo nueva; `GET /patients?search&status=ACTIVE&limit=10`) | Sí | "{nombre} - {RUT}" | `patientId` (solo POST) |
| `locationId` | Sede * | select | Sí | sedes accesibles | `locationId` |
| `professionalUserId` | Profesional (opcional) | select | No | elegibles de la sede | `professionalUserId` (null si vacío) |
| `validUntil` | Fecha de vigencia (opcional) | date | No | no puede estar en el pasado (bloquea Emitir) | `validUntil` (null) |
| `notes` | Observaciones administrativas | textarea maxLength 2000 | No | "no incluyas diagnósticos…" | `notes` (omitido si vacío) |
| `patientNotesPreview` | Observaciones para el paciente | textarea | No | **solo devPreview** | no se envía |
| `items` | Ítems de la cotización | `QuoteItemsEditor` | No | — | `items[]` |
| (ocultos) | — | — | — | nunca se setean | `appointmentId: null`, `treatmentPlanId: null` |
| `reason` | Motivo de edición (prompt) | textarea | Sí para editar ACCEPTED | — | `reason` |

**Editor de ítems (`QuoteItemsEditor` → `QuoteItemFormModal`)**: tipos MANUAL "Prestación" / INVENTORY_SUPPLY "Insumo" (selector `GET /quotes/eligible-supplies?locationId&search&limit=20` con "Buscar por nombre o código...").

| Campo | Label | Tipo | Obligatorio | Validación / default | Payload |
|---|---|---|---|---|---|
| `name` | Prestación * (manual) / Insumo (lectura) | text maxLength 200 | Sí MANUAL | — | `name` |
| `description` | Descripción administrativa (opcional) | textarea maxLength 2000 | No (solo MANUAL) | — | `description` |
| `quantity` | Cantidad * | number min 1 step 1 | Sí | entero >0; default 1 | `quantity` |
| `unitPrice` | Precio unitario * | number min 0 | Sí | ≥0; insumo default `salePrice ?? unitCost` | `unitPrice` |
| `discountType` | Tipo de descuento | select | No; requiere `QUOTES_APPROVE_DISCOUNT` | Sin descuento (null) / Porcentaje / Monto fijo | `discountType` |
| `discountValue` | Descuento (%) / (monto) | number | No | % 0-100; monto ≤ subtotal | `discountValue` |
| (ocultos) | — | — | — | — | `sourceType`, `supplyId`, `sortOrder` |

Tarjetas de lectura: Resumen (Subtotal, Descuentos, Total, Neto sin IVA, IVA), Seguimiento de presupuestos (solo ACCEPTED), Detalle (Creada por, Fecha creación, Emisión, Respuesta).

**Transiciones (`ConfirmDialog`)** → `PATCH /quotes/:id/status`: DRAFT → ISSUED "Emitir cotización" / CANCELLED; ISSUED → ACCEPTED / REJECTED / CANCELLED; ACCEPTED → CANCELLED con `cancelReasonDraft` obligatorio ("Motivo de la cancelación..."). Prompt "Motivo de edición de la cotización actual" (`editReasonDraft`) desbloquea la edición de una ACCEPTED.

**Vista documento (solo lectura):** cabecera (Cotización N°, badges, Paciente, RUT, Sede, Profesional, Emitida, Válida hasta), ítems agrupados, resumen, "Gestión de la cotización" (Editar / Cancelar, solo ACCEPTED), notas, "Seguimiento del tratamiento" (Contactar por WhatsApp, Registrar contacto, Marcar en tratamiento), "Cobranza" (Crear orden de cobro / Ver orden de cobro), "Información adicional", "Motivo de la cancelación".

**Modal "Crear orden de cobro" (`CreateCollectionOrderModal`)** → `POST /api/clinic/collection-orders`

| Campo | Label | Tipo | Obligatorio | Opciones / validación | Payload |
|---|---|---|---|---|---|
| (lectura) | Paciente, RUT, Profesional, Sede, Cotización, Total tratamiento | — | — | — | — |
| `coverageType` | Cobertura del paciente | radio | Sí (default NONE) | NONE "Particular / Sin cobertura", FONASA "Fonasa", ISAPRE "Isapre" | `coverageType` |
| `coverageProviderName` | Nombre de ISAPRE / aseguradora | text maxLength 120 | No (solo ISAPRE) | — | `coverageProviderName` |
| `coverageAmount` | Monto cubierto | number 0..total | No | disabled si NONE | `coverageAmount` |
| (lectura) | Total tratamiento / Cobertura / Monto paciente | — | — | aviso "La orden quedará cubierta completamente…" si 0 | — |
| (oculto) | — | — | — | — | `quoteId` |

**Modal "Contactar por WhatsApp"**: `message` (textarea con texto por defecto) → abre `https://wa.me/{tel}?text=` (normaliza teléfono chileno) y luego `followUpAt` → `POST /follow-up-contact`. No llama al backend para enviar.

**Modal "Configurar cobertura" (`QuoteCoverageModal`)** — **solo `?devPreview=1` en build DEV, no persiste**: `type` (Particular/Fonasa/Isapre/Otro), `insurerName` (Banmédica, Consalud, Cruz Blanca, Colmena Golden Cross, Vida Tres, Nueva Masvida u otro), `mode` Monto/Porcentaje, `amount`, `percentage`, `referenceCode`.


### 3.C Agenda y Ajustes

#### 3.C.1 `AgendaDiaria.jsx` — Agenda (`/agenda/diaria`)

`canManage` = AGENDA_MANAGE_ALL/ASSIGNED. Sede activa del dominio `agenda` (vista global si no hay sede: "Estás viendo todas las sedes…"). Pestañas **Diaria** / **Semanal**.

Cargas: `GET /agenda/appointments?date&locationId&professionalId|professionalIds` (diaria) o `?dateFrom&dateTo…` (semanal); `GET /patients?status=ACTIVE&limit=200`; `GET /agenda/professionals?locationId`; `GET /agenda/status-reasons` (lazy); `GET /agenda/appointments/:id/status-history` (al seleccionar). Deep-link `?patientId=` abre "Nueva cita" con el paciente.

Diaria: select `baseDuration` (15/20/30/45/60 "min base" — **sin efecto**); ◀ Hoy ▶; "Nueva cita". Columna izquierda: tarjeta fecha; "Estado" con 6 checkboxes (Agendado, Confirmado, En atención, Completado, Cancelado, No asistió); "Resumen del día" (Total, Completadas, Agendadas, No asistió — calculado en cliente). Lista: buscador "Buscar paciente...", "Ver: 10|20|50"; columnas Hora | Paciente (+ duración) | Servicio | Profesional · Consultorio | Sede (vista global) | Estado (select inline con 6 estados si editable) | Acciones (Ver/Cerrar).

Panel Detalle (lectura): Paciente, Servicio, Profesional, Hora, Consultorio, Estado, Historial (reagendamientos "Antes/Ahora", cambios de estado, motivo, observación). Botones (si editable): Editar cita, Confirmar, Iniciar atención, Completar, Marcar no asistió, Cancelar cita.

Semanal: `DoctorFilter` (chips por profesional con color `agendaColor`, "Todos"/"Limpiar"), leyenda de colores, grilla Lun–Dom 08:00–17:00, bloques con tooltip, grupos densos (≥3 solapadas) con popover. No aplica filtros de estado ni buscador.

Estados (`STATUS_CONFIG`): SCHEDULED Agendado (#6366f1), CONFIRMED Confirmado (#0891b2), IN_PROGRESS En atención (#7c3aed), COMPLETED Completado (#059669, terminal), CANCELLED Cancelado (#94a3b8, terminal), NO_SHOW No asistió (#dc2626). Cambios CONFIRMED/IN_PROGRESS/COMPLETED → `PATCH /appointments/:id/status {status}` (al completar: "Si corresponde, se generó un recordatorio de seguimiento."); CANCELLED/NO_SHOW → `ReasonModal`. Motivos vienen del backend (`GET /status-reasons`).

**Modal "Nueva cita" / "Editar cita" (`AppointmentModal`)** → `POST /api/clinic/agenda/appointments` / `PUT …/:id` (reagendar = editar fecha/hora)

| Campo | Label | Tipo | Obligatorio | Opciones / validación / default | Payload |
|---|---|---|---|---|---|
| `patientSearch` | "Buscar paciente..." | text | No | filtra el select | — |
| `patientId` | Paciente * | select | Sí | pacientes activos "Nombre - RUT" | `patientId` |
| `service` | Servicio | input + datalist (Limpieza dental, Ortodoncia, Extraccion, Blanqueamiento, Endodoncia, Radiografia, Consulta inicial, Control post-op) | No | default "Limpieza dental" | `service` y `title` (= service ‖ reason ‖ 'Cita') |
| `box` | Consultorio * | select | Sí ("Debes seleccionar un consultorio…") | Box 1, Box 2, Box 3, Box 4, Box 5, Sala RX, Pabellón menor (mostrados "Consultorio N") | `box` |
| `professionalUserId` | Profesional | select | No | "Por asignar" + profesionales "{nombre} - {especialidad}" | `professionalUserId` |
| `reason` | Motivo | text | No | — | `reason` (siempre) |
| `date` | Fecha * | date | Sí | fecha seleccionada | → `startAt`/`endAt` |
| `startTime` | Hora inicio * | time step 900 | Sí | 09:00 | → `startAt` ISO |
| `durationMinutes` | Duración | select | Sí | 15, 30, 45, 60, 90, 120 min; default 30 | `durationMinutes` y `endAt` |
| `notes` | Notas | textarea | No | — | `notes` |
| (oculto) | — | — | — | sede de la cita o activa ("No hay una sede válida seleccionada.") | `locationId` |

Sub-formulario "Crear paciente" (rápido) → `POST /api/clinic/patients`: `firstName` Nombre * · `lastName` Apellido * · `rut` RUT (autoformato + validación) · `phone` Teléfono · `email` Correo.

**Modal de motivo (`ReasonModal`)** → `PATCH /appointments/:id/status { status, reasonCode, reasonText }`: `reasonCode` "Motivo" (select del catálogo: cancelación PATIENT_CANCELLED, DOCTOR_UNAVAILABLE, RESCHEDULED, SCHEDULING_ERROR, ADMINISTRATIVE_ISSUE, CLINIC_CLOSED, OTHER; no-show FORGOT_APPOINTMENT, COULD_NOT_CONTACT, TRANSPORT_ISSUE, PERSONAL_EMERGENCY, HEALTH_ISSUE, UNKNOWN, OTHER); `reasonText` "Observación" (textarea ≤500, obligatorio si OTHER). Solo lectura: Paciente, Hora, Profesional, Consultorio.

#### 3.C.2 `MiHorario.jsx` — Mi horario (`/agenda/mi-horario`, solo profesional)

Solo lectura: `GET /api/clinic/professionals/me/schedule`. Tarjetas Profesional, Sede, Bloques semanales, Horas semanales; tabla Día | Bloques ("HH:MM-HH:MM · consultorio") | Sede | Consultorio | Estado. Sin formularios.

#### 3.C.3 `MonitorSala.jsx` — Monitor de sala (`/agenda/monitor`)

`GET /agenda/appointments?date=hoy&locationId` (sin auto-refresh). KPIs: En espera (SCHEDULED+CONFIRMED), Atendiendo (IN_PROGRESS), **Espera prom. = "—" fijo (no se calcula)**, Completadas. Acción "Llamar siguiente" → `PATCH /appointments/:id/status {status:'IN_PROGRESS'}` sobre la primera cita en espera. Secciones "Agenda por consultorio" (por `box`), "Sin consultorio asignado", "Sala de espera". Sin formularios.

#### 3.C.4 `Recordatorios.jsx` — Recordatorios clínicos (`/agenda/recordatorios`)

Cargas: `GET /patients?search&status=ACTIVE&limit=50`, `GET /agenda/professionals`, `GET /reminders/rules`, `GET /reminders?status&dateFrom&dateTo&patientId&professionalUserId&locationId&limit=50`, `GET /reminders/summary`.

Catálogos: estados PENDING Pendiente, OVERDUE Vencido, CONTACTED Contactado, SCHEDULED Agendado, COMPLETED Completado, CANCELLED Cancelado; tipos CHECKUP Control, CLEANING Limpieza, POST_TREATMENT Post tratamiento, ORTHODONTIC_CONTROL Control de ortodoncia, IMPLANT_CONTROL Implante, SURGERY_FOLLOW_UP Cirugía, GENERAL General; prioridades LOW/NORMAL/HIGH; origen "Automático" (con `appointmentId`) / "Manual".

Sección "Reglas automáticas": tabla Nombre | Tipo | Palabras clave | Plazo | Prioridad | Estado | Acciones (Editar, Desactivar/Activar → `PATCH /rules/:id/status {isActive}`, Eliminar → `DELETE /rules/:id`). KPIs (7): Pendientes, Vencidos, Para hoy, Próximos 7 días, Contactados, Agendados, Completados. Filtros: `status`, `dateFrom`, `dateTo`, `patientId`, `professionalUserId`, `locationId`. Tabla: Paciente | Tipo | Título | Fecha objetivo | Estado | Prioridad | Profesional | Sede | Origen | Acciones (Ver/editar, Agendar seguimiento, Contactado, Agendado, Completado, Cancelar → `PATCH /reminders/:id/status`).

**Modal "Nuevo recordatorio" / "Editar recordatorio" (`ReminderModal`)** → `POST /api/clinic/reminders` / `PUT …/:id`

| Campo | Label | Tipo | Obligatorio | Opciones / default | Payload |
|---|---|---|---|---|---|
| `patientSearch` | "Buscar paciente..." | text | No | recarga pacientes | — |
| `patientId` | Paciente * | select | Sí | "Nombre - RUT" | `patientId` |
| `type` | Tipo * | select | Sí | 7 tipos; default GENERAL | `type` (**backend: `reminderType`**) |
| `targetDate` | Fecha objetivo * | date | Sí | — | `targetDate` (**backend: `dueDate`**) |
| `title` | Título * | text | Sí | "Ej. Control posterior a tratamiento" | `title` |
| `professionalUserId` | Profesional | select | No | "Sin asignar" + profesionales | `professionalUserId` |
| `locationId` | Sede | select | No | "Sin sede específica" + sedes | `locationId` |
| `priority` | Prioridad | select | Sí | LOW Baja / NORMAL Normal / HIGH Alta | `priority` |
| `contactMethod` | Método de contacto | text | No | "Teléfono, WhatsApp, email..." | `contactMethod` |
| `description` | Descripción | textarea | No | — | `description` |
| `notes` | Notas | textarea | No | — | `notes` |

**Modal "Nueva cita de seguimiento" (`FollowUpAppointmentModal`)** → `POST /agenda/appointments` y luego `PATCH /reminders/:id/status {status:'SCHEDULED'}`: `patientId` *, `date` *, `locationId` Sede *, `startTime` * (09:00), `endTime` * (09:30, > inicio → `durationMinutes` calculado), `box` Consultorio * (Box 1–5, Sala RX, Pabellón menor), `professionalUserId`, `service` (default título del recordatorio), `reason`, `notes`.

**Modal "Nueva regla" / "Editar regla" (`ReminderRuleModal`)** → `POST /reminders/rules` / `PUT /rules/:id`

| Campo | Label | Tipo | Obligatorio | Opciones / default | Payload |
|---|---|---|---|---|---|
| `name` | Nombre de regla * | text | Sí | — | `name` |
| `reminderType` | Tipo de recordatorio * | select | Sí | GENERAL, CLEANING, ORTHODONTIC_CONTROL, SURGERY_FOLLOW_UP, IMPLANT_CONTROL (default GENERAL) | `reminderType` |
| `keywordsText` | Palabras clave | text (coma) | Sí si tipo ≠ GENERAL | — | `keywords[]` |
| `intervalValue` | Tiempo * | number min 1 | Sí | — | `intervalValue` |
| `intervalUnit` | Unidad * | select | Sí | DAYS Días / MONTHS Meses (default MONTHS) | `intervalUnit` |
| `priority` | Prioridad * | select | Sí | LOW, NORMAL, HIGH, **URGENT** (default NORMAL) | `priority` |
| `isActive` | Activa | checkbox | No | true | `isActive` (**el validador de creación no lo acepta**) |

#### 3.C.5 `ajustes/Horarios.jsx` — Horarios de atención (`/ajustes/horarios`)

Cargas: `GET /agenda/professionals`, `GET /locations?active=true&limit=200`, `GET /agenda/availability/professionals/:id` → `{schedules[], blocks[]}`. Stats: Profesional con horario, Horarios activos, Bloqueos/ausencias, Sedes disponibles. Secciones de lectura: "Horario semanal" (por día Domingo…Sabado: "HH:MM - HH:MM", sede, Activo/Inactivo, botones E/D → `DELETE /availability/schedules/:id`), "Bloqueos y ausencias" (inicio, fin, motivo, sede, E/D → `DELETE /availability/blocks/:id`).

| Formulario | Campo | Label | Tipo | Obligatorio | Opciones / default | Payload | Endpoint |
|---|---|---|---|---|---|---|---|
| Horario (F) | `dayOfWeek` | Día de semana | select | Sí | Domingo(0)…Sabado(6); default Lunes | `dayOfWeek` | `POST /availability/professionals/:id/schedules` / `PUT /availability/schedules/:id` |
| | `locationId` | Sede | select | No | "Sin sede" + sedes | `locationId` | |
| | `startTime` | Hora inicio | time | Sí | 09:00 | `startTime` | |
| | `endTime` | Hora término | time | Sí (> inicio) | 18:00 | `endTime` | |
| | `isActive` | Activo | checkbox | No | true | `isActive` | |
| | — | (no hay campo de consultorio/sala) | — | — | — | — | |
| Creación rápida (F.1) | `startTime`, `endTime`, `locationId`, `isActive` | idem | idem | — | crea Lunes–Viernes (5 POST) | `dayOfWeek` 1..5 | `POST …/schedules` ×5 |
| Bloqueo (G) | `startAt` | Inicio | datetime-local | Sí | — | `startAt` ISO | `POST /availability/professionals/:id/blocks` / `PUT /availability/blocks/:id` |
| | `endAt` | Término | datetime-local | Sí (> inicio) | — | `endAt` | |
| | `reason` | Motivo | text | No | "Almuerzo / reunión" | `reason` (siempre) | |
| | `locationId` | Sede | select | No | — | `locationId` | |
| | `isActive` | Activo | checkbox | No | true | `isActive` | |
| Probar disponibilidad (H) | `startAt`, `endAt`, `locationId` | Inicio / Término / Sede | datetime-local ×2 + select | Sí/Sí/No | mismo día | query | `GET /availability/professionals/:id/check` |

#### 3.C.6 `ajustes/Sedes.jsx` — Sedes operativas (`/ajustes/sedes`)

Cargas: `GET /locations`, `GET /clinic/profile` (país, moneda, zona horaria, `usage.locations`), `GET /consulting-rooms`, `GET /locations/:id` al editar. Botón "Nueva sede" deshabilitado si límite del plan alcanzado. Tabla (solo sedes activas con país/moneda de la clínica): Nombre | País | Moneda | Estado | Creada | Acciones (Editar, Desactivar → `DELETE /locations/:id`, bloqueado si es la última activa).

**Modal "Nueva sede" / "Editar sede"** → `POST /api/clinic/locations` / `PUT …/:id`: `name` Nombre (text, obligatorio) → `name`; `country` País (text **disabled**, heredado) y `currency` Moneda (text **disabled**) → se envían solo al editar. No hay dirección, teléfono, zona horaria ni usuarios por sede.

Tarjeta "Cambio de moneda referencial" (cálculo local): `amount` Monto (100), `fromCurrency` (CLP/USD/EUR, default USD), `toCurrency` (default CLP), tasas fijas USD 950 / EUR 1030 CLP.

**Sección "Consultorios por sede"**: filtros `locationId`, `supportsEsthetic` (Todos / Solo aptos estética), `isActive` (Activos default / Inactivos / Todos) — en cliente. Tabla Nombre | Sede | Dental | Estética orofacial | Estado | Notas | Acciones (Editar, Desactivar → `PATCH /consulting-rooms/:id/archive`).

**Modal "Nuevo consultorio" / "Editar consultorio"** → `POST /api/clinic/consulting-rooms` / `PUT …/:id`: `name` Nombre * · `locationId` Sede * (select) · `supportsDental` Atención dental (checkbox, true) · `supportsEsthetic` Estética orofacial (checkbox, false) · `isActive` Activo (checkbox, true) · `notes` Notas (textarea).

#### 3.C.7 `ajustes/ConsentTemplates.jsx` — Plantillas de consentimiento (`/ajustes/consentimientos`)

`GET /consent-templates`. Stats Plantillas / Activas / Inactivas. Tarjetas: nombre, título, pill Activa/Inactiva, versión, fecha creación, última actualización, canales, categorías. Acciones: Editar; Desactivar/Activar (PUT completo con `isActive` invertido).

**Modal "Nueva plantilla" / "Editar plantilla"** → `POST /api/clinic/consent-templates` / `PUT …/:id`

| Campo | Label | Tipo | Obligatorio | Opciones / default | Payload |
|---|---|---|---|---|---|
| `name` | Nombre * | text | Sí | — | `name` |
| `version` | Versión * | text | Sí | "v1.0" | `version` |
| `title` | Título * | text | Sí | — | `title` |
| `purpose` | Finalidad | textarea | No | — | `purpose` |
| `body` | Texto del consentimiento * | textarea | Sí | — | `body` |
| `dataCategories` | Categorías de datos | chips multi | No | identificacion, contacto, salud, historial_clinico, agenda, facturacion, comunicaciones | `dataCategories[]` |
| `channels` | Canales | chips multi | No | email, phone, whatsapp, sms | `channels[]` |
| `isActive` | Activa | checkbox | No | true | `isActive` |

**No hay campo `purposeType`** (GENERAL / ESTHETIC_AI_SIMULATION) **ni `effectiveFrom`**.

#### 3.C.8 `ajustes/Suscripcion.jsx` — Suscripción y módulos (`/ajustes/suscripcion`)

Acceso: SUBSCRIPTION_MANAGE y no plataforma. Cargas: `GET /clinic/profile` (suscripción, plan, entitlements, usage), `GET /module-requests`, `GET /billing/stripe/status`.

Lectura: aviso de suscripción vencida; tarjeta "Facturación con Stripe" (estado, modo test, plan, ciclo, módulos activos, variables faltantes); "PLAN ACTUAL" (nombre, clínica, estado, renovación, inicio/trial, total mensual); `UsageCard` SEDES y USUARIOS (current/limit, barra, "Límite alcanzado"); "PLAN DISPONIBLE" (Plan Profesional 79 USD/mes base; Precio base | Precio módulos | Total mensual); "Módulos del plan" (chips activos + tarjetas por módulo con estado comercial: activo / bloqueado por dependencia / pendiente / en revisión / rechazado / disponible); "Solicitudes recientes" (Fecha | Estado | Moneda | Total estimado | Módulos solicitados).

Módulos (`SUGGESTED_MODULES`, hardcodeados): MARKETING_AI, ADVANCED_FINANCE, CLINICAL_RECORD, TREATMENT_PLANS, ESTHETIC_TREATMENTS, ESTHETIC_AI_SIMULATION (depende de ESTHETIC_TREATMENTS), AGREEMENTS, LIQUIDATIONS, MULTI_LOCATION, ADVANCED_REPORTS, API_ACCESS.

Acciones Stripe: "Pagar mensual" → `POST /billing/stripe/checkout {billingCycle:'MONTHLY'}`; "Pagar anual" → `{billingCycle:'YEARLY'}`; "Gestionar facturación" → `POST /billing/stripe/portal` (requiere cliente Stripe).

**Modal "Solicitar personalizacion del plan" (`ModuleRequestModal`)** → `POST /api/clinic/module-requests`: `selectedModules` (checkboxes por módulo, ≥1, deshabilitados los no solicitables) → `modules: [{ key, quantity: 1 }]`; `currency` Moneda de referencia (CLP default / USD / EUR); `message` Mensaje opcional (textarea).

#### 3.C.9 Pantallas de Ajustes sin backend (mock estático)

| Archivo | Ruta | Contenido |
|---|---|---|
| `UsuariosOrg.jsx` | `/ajustes/usuarios-org` | 4 usuarios hardcodeados; buscador local; modal "Nuevo usuario" con inputs no controlados (Nombre, Email, Rol: Administrador / Director clínico / Odontólogo / Recepción) — "Enviar invitación" solo cierra |
| `UsuariosSede.jsx` | `/ajustes/usuarios-sede` | 4 filas fijas; botón "Asignar usuario" sin handler |
| `Cargos.jsx` | `/ajustes/cargos` | lista fija Odontólogo, Higienista, Recepcionista, Administrador; "Nuevo cargo" inerte |
| `Documentos.jsx` | `/ajustes/documentos` | tabla fija Plantilla/Tipo/Estado/Actualizado; "Nueva plantilla" inerte |
| `Especialidades.jsx` | `/ajustes/especialidades` | lista fija (Odontologia general, Ortodoncia, Endodoncia, Periodoncia, Implantologia) |
| `Honorarios.jsx` | `/ajustes/honorarios` | tabla fija Profesional/Modelo/Porcentaje/Estado |
| `Outbox.jsx` | `/ajustes/outbox` | tabla fija Destinatario/Canal/Mensaje/Estado/Fecha |
| `Precios.jsx` | `/ajustes/precios` | tabla fija Tratamiento/Categoría/Precio USD/Estado |
| `Recordatorios.jsx` (ajustes) | `/ajustes/recordatorios` | tabla fija Tipo/Canal/Anticipación/Estado (no conectada a las reglas reales) |
| `Whatsapp.jsx` | `/ajustes/whatsapp` | tabla fija Dispositivo/Número/Estado/Última conexión |
| `BillingSuccess.jsx` / `BillingCancel.jsx` | `/billing/success`, `/billing/cancel` | páginas estáticas de retorno de Stripe (no leen `session_id`) |
| `Stub.jsx` | — | componente "Esta sección está en desarrollo", no enrutado |


### 3.D Finanzas e Inventario (`src/pages/finanzas/*`)

Convenciones: `API` = `/api/clinic`. Sedes del dominio `finance`/`collections`/`inventory` (`utils/locationConfig.js`); moneda visual CLP/USD/EUR con tasas referenciales fijas (USD 950, EUR 1030) — no altera registros. `utils/tax.js`: IVA incluido (`netTotal = round(total×100/(100+rate))`). `finanzasUtils.js` contiene datos mock y un sistema de 7 monedas que **ninguna página usa**.

#### 3.D.1 `CajaOperativa.jsx` — Caja operativa (`/finanzas/caja`)

`GET API/finance/cashbox/summary?dateFrom&dateTo` (no envía `locationId`). Filtros: `dateFrom`, `dateTo`, Limpiar, Actualizar. KPIs: Ingresos, Gastos generales, Insumos, Egresos totales, Balance. Tablas: "Movimientos recientes" (Fecha | Tipo Ingreso/Gasto/Insumo | Nombre | Categoría | Sede | Monto | Origen), "Por categoría", "Resumen mensual" (Mes | Ingresos | Gastos | Insumos | Egresos | Balance). Sin formularios.

#### 3.D.2 `Cobranza.jsx` — Cobranza (`/finanzas/cobranza`)

`GET API/collection-orders?locationId&status&patientId&search&page&limit=20&sortOrder=desc`. Filtros: `status` (Todas, PENDING Pendientes, PAID Pagadas, COVERED Cubiertas, CANCELLED Canceladas), `search` "Orden, paciente, RUT o cotización...", paginación. KPIs (página actual): Pendientes, Pagadas, Cubiertas, Canceladas. Tabla: N° orden (+ cotización) | Paciente (+ RUT) | Sede / Profesional | Total | Paciente (monto + cobertura) | Estado (+ medio de pago) | Acciones (Ver, Cancelar orden).

Catálogos: cobertura NONE "Particular / Sin cobertura", FONASA, ISAPRE (+ proveedor); medios de pago CASH Efectivo, DEBIT_CARD Débito, CREDIT_CARD Crédito. `canPay` = PENDING y `patientAmount > 0` y COLLECTIONS_MANAGE_*; `canCancel` = PENDING/COVERED.

Modal "Orden de cobro" (lectura, `GET API/collection-orders/:id`): Nº, estado, paciente, RUT, profesional, sede, cotización origen, fecha, monto pagado/medio/fecha de pago (PAID), "Ingreso registrado: Sí", resumen Total / Cobertura / A pagar. Acciones: Registrar pago, Cancelar orden (`POST /:id/cancel {}`).

**Modal "Registrar pago"** → `POST API/collection-orders/:id/pay`: `paymentMethod` "Medio de pago" (radio: CASH Efectivo default, DEBIT_CARD Débito, CREDIT_CARD Crédito). Se paga siempre el `patientAmount` completo (sin pagos parciales).

(La creación de órdenes vive en Cotizaciones, ver 3.B.3.)

#### 3.D.3 `Convenios.jsx` — Convenios (`/finanzas/convenios`)

`GET API/finance/agreements?search&type&status&dateFrom&dateTo` + `/summary`. Filtros: `search` "Buscar por nombre/contacto...", `type` (COMPANY Empresa, INSURANCE Seguro, PARTNER Convenio, INTERNAL Particular, OTHER Otro), `status` (ACTIVE Activo default, INACTIVE, EXPIRED Vencido, EXPIRING_SOON Próximo a vencer, ARCHIVED), `dateFrom`, `dateTo`. KPIs: Convenios activos, vencidos, próximos a vencer, descuento promedio. Tabla: Nombre | Tipo | Contacto | Descuento | Vigencia | Estado | Acciones (Editar, Archivar → `DELETE /:id`).

**Modal "Nuevo convenio" / "Editar convenio"** → `POST API/finance/agreements` / `PUT …/:id`

| Campo | Label | Tipo | Obligatorio | Opciones / validación / default | Payload |
|---|---|---|---|---|---|
| `name` | Nombre | text | Sí | — | `name` |
| `type` | Tipo | select | No | COMPANY Empresa (default), INSURANCE Seguro, PARTNER Convenio, INTERNAL Particular, OTHER Otro | `type` |
| `status` | Estado | select (solo edición) | No | ACTIVE, INACTIVE, EXPIRED, EXPIRING_SOON, ARCHIVED | `status` |
| `contactName` | Nombre contacto | text | No | — | `contactName` |
| `contactEmail` | Email contacto | email | No | — | `contactEmail` |
| `contactPhone` | Teléfono contacto | text | No | — | `contactPhone` |
| `description` | Descripción | textarea | No | — | `description` |
| `discountType` | Tipo descuento | select | No | PERCENTAGE Porcentaje (default), FIXED_AMOUNT Monto fijo, CUSTOM Personalizado, NONE Sin descuento (→ `undefined`) | `discountType` |
| `discountValue` | Valor descuento | number min 0 step 0.01 | No | solo PERCENTAGE/FIXED_AMOUNT | `discountValue` |
| `startDate` / `endDate` | Fecha inicio / Fecha término | date | No | fin ≥ inicio | idem |
| `notes` | Notas | textarea | No | — | `notes` |

#### 3.D.4 `Gastos.jsx` — Gastos (`/finanzas/gastos`)

`GET API/finance/expenses?search&category&supplier&paymentMethod&status&dateFrom&dateTo&locationId` + `/summary` + `GET incomes/summary` (para la alerta "Los gastos superan los ingresos registrados."). Filtros: `search`, `category` (Arriendo, Servicios básicos, Sueldos, Insumos, Laboratorio, Marketing, Mantención, Equipamiento, Administración, Otros), `supplier`, `paymentMethod` (CASH Efectivo, CARD Tarjeta, TRANSFER Transferencia, CHECK Cheque, OTHER Otro), `status` (ACTIVE default / ARCHIVED), `dateFrom`, `dateTo`. KPIs: Total gastos, Cantidad, Categoría principal, Promedio. Tabla: Nombre | Categoría | Proveedor | Fecha | Monto | Método pago | Documento | Estado | Acciones (Editar, Archivar → `DELETE /:id`; **no hay restaurar**).

**Modal "Nuevo gasto" / "Editar gasto"** → `POST API/finance/expenses` / `PUT …/:id`

| Campo | Label | Tipo | Obligatorio | Opciones / default | Payload |
|---|---|---|---|---|---|
| `name` | Nombre del gasto * | text | Sí | — | `name` |
| `category` | Categoría | select | No | 10 categorías (default Arriendo) | `category` |
| `supplier` | Proveedor | text | No | — | `supplier` |
| `locationId` | Sede | select | Sí al crear | sedes accesibles; preset sede activa | `locationId` |
| `description` | Descripción | textarea | No | — | `description` |
| `expenseDate` | Fecha * | date | Sí | hoy | `expenseDate` |
| `amount` | Monto * | number min 0 | Sí (>0) | — | `amount` |
| `paymentMethod` | Método de pago | select | No | CASH, CARD, TRANSFER (default), CHECK, OTHER | `paymentMethod` |
| `documentType` | Tipo documento | text | No | — | `documentType` |
| `documentNumber` | Número documento | text | No | — | `documentNumber` |
| `notes` | Notas | textarea | No | — | `notes` |

#### 3.D.5 `Ingresos.jsx` — Ingresos (`/finanzas/ingresos`)

`GET API/finance/incomes?search&category&paymentMethod&status&dateFrom&dateTo&locationId` + `/summary`. Filtros: `search`, `category` (Consulta, Tratamiento, Limpieza dental, Ortodoncia, Estetica dental, Urgencia, Convenio, Abono, Otro), `paymentMethod`, `status`, fechas. KPIs: Total ingresos, Cantidad, Método principal, Promedio, Neto (sin IVA), IVA (`taxRatePercent`). Tabla: Nombre | Categoría | Fecha | Monto | Método pago (+ texto libre si OTHER) | Documento | Estado | Acciones (Editar, Archivar → `DELETE /:id`, Restaurar → `PATCH /:id/restore`).

**Modal "Nuevo ingreso" / "Editar ingreso"** → `POST API/finance/incomes` / `PUT …/:id`

| Campo | Label | Tipo | Obligatorio | Opciones / validación / default | Payload |
|---|---|---|---|---|---|
| `name` | Nombre del ingreso * | text | Sí | — | `name` |
| `category` | Categoría | select | No | 9 categorías (default Tratamiento) | `category` |
| `locationId` | Sede | select | Sí al crear | — | `locationId` (valor o null) |
| `incomeDate` | Fecha * | date | Sí | hoy | `incomeDate` |
| `amount` | Monto * | number min 0 | Sí (>0) | — | `amount` |
| `paymentMethod` | Método de pago | select | No | CASH, CARD (default), TRANSFER, CHECK, OTHER | `paymentMethod` |
| `paymentMethodOther` | ¿Qué otro método de pago desea ingresar? | text | Sí si OTHER | "Ej: Vale vista" | `paymentMethodOther` |
| `documentType` | Tipo documento | text + datalist (Boleta electronica, Factura electronica, Boleta manual, Comprobante interno, Nota de credito) | No | — | `documentType` |
| `documentNumber` | Número documento | text | No | — | `documentNumber` |
| `patientId` | Paciente (opcional) | buscador (`GET /patients?search&status=ACTIVE&limit=10`) | No | — | `patientId` |
| `quoteId` | Cotización vinculada (opcional) | select (`GET /quotes?patientId&status=ACCEPTED&limit=50`) | No | "{número} · {total} · {profesional}" | `quoteId` |
| `treatmentPlanId` | Plan de tratamiento vinculado (opcional) | select (`GET /treatment-plans?patientId&limit=100`, ACCEPTED/IN_PROGRESS/COMPLETED) | No | "{título} · {estimado}"; muestra saldo pendiente | `treatmentPlanId` |
| `paymentType` | Tipo de pago | toggle | No | FULL "Pago completo" (default) / PARTIAL "Abono parcial" | `paymentType` |
| `description` | Descripción | textarea | No | — | `description` |
| `notes` | Notas | textarea | No | — | `notes` |

(No hay campo `appointmentId` aunque el backend lo acepta.)

#### 3.D.6 `Insumos.jsx` — Inventario (`/operaciones/inventario`)

`GET API/finance/supplies?search&category&supplier&status&dateFrom&dateTo&locationId&consultingRoom` + `/summary` + `/lot-alerts?locationId&includeItems=false` + `GET /:id/photo` por fila. Panel "Inventario por consultorio": `selectedLocationId` (Todas las sedes si acceso global) y `consultingRoom` (Todos, `**NONE**` Sin consultorio asignado, Consultorio 1–5, Sala RX, Pabellón menor). KPIs: Total insumos, Lotes vencidos, Lotes por vencer, Sin stock, Bajo stock, Valor inventario, Categorías. Filtros: `search`, `category` (Desechables, Bioseguridad, Anestesia, Restauracion, Ortodoncia, Higiene dental, Instrumental, Radiologia, Laboratorio, Otros), `supplier`, `status` (Todos, ACTIVE, LOW_STOCK, OUT_OF_STOCK, ARCHIVED), fechas. Tabla (14 columnas): Foto | Nombre | Categoría | Sede | Consultorio | Proveedor | Cantidad comprada | Stock actual | Stock mínimo | Costo total | Fecha compra | Estado | Lotes (resumen) | Acciones ("Lotes", Editar, Archivar → `DELETE /:id`).

**Modal "Nuevo insumo" / "Editar insumo"** → `POST API/finance/supplies` / `PUT …/:id` (+ foto `PUT /:id/photo {imageBase64, mimeType}`)

| Campo | Label | Tipo | Obligatorio | Opciones / validación / default | Payload |
|---|---|---|---|---|---|
| `name` | Nombre del insumo * | text | Sí | — | `name` |
| `locationId` | Sede * | select | Sí | — | `locationId` |
| `consultingRoom` | Consultorio | select | No | Sin consultorio asignado, Consultorio 1–5, Sala RX, Pabellón menor | `consultingRoom` |
| `category` | Categoría | select | No | 10 categorías (default Desechables) | `category` |
| `supplier` | Proveedor | text | No | — | `supplier` |
| `photoFile` | Imagen | file jpeg/png/webp ≤10 MB | No | preview | PUT separado |
| `description` | Descripción | textarea | No | — | `description` |
| `purchaseDate` | Fecha de compra | date | No | hoy | `purchaseDate` |
| `unit` | Unidad | select | No | unidad, caja, paquete, frasco, tubo, ml, kit | `unit` |
| `quantity` | Cantidad comprada | number ≥0 | No | — | `quantity` |
| `unitCost` | Costo unitario | number ≥0 | No | — | `unitCost` |
| `totalCost` | Costo total | number ≥0 | No | calculado (disabled) si cantidad y costo unitario | `totalCost` |
| `currentStock` | Stock actual | number **readOnly** | — | creación → `currentStock: 0`; edición no se envía ("El stock se administra mediante lotes y movimientos") | `currentStock` (solo creación, 0) |
| `minimumStock` | Stock mínimo | number ≥0 | No | — | `minimumStock` |

Tras crear: prompt "¿Deseas registrar su primer lote?".

**Drawer "Lotes de {insumo}"** (`GET /:id/lots?locationId&search&expirationStatus&sortBy&sortOrder&page&limit=20`): KPIs Stock actual, Total lotes, Por vencer, Vencidos; filtros `search` (Número de lote), `expirationStatus` (ACTIVE, EXPIRING, EXPIRED, NO_EXPIRATION), `locationId`, `sortBy` (expirationDate, lotNumber, quantity, receivedAt, createdAt), `sortOrder`. Tabla: Número de lote | Sede | Cantidad | Recepción | Vencimiento (+ "vence en N días") | Estado | Actualizado | Acciones ("Etiqueta", Ver detalle, Editar lote, Registrar entrada, Registrar salida).

**Modal "Nuevo lote" / "Editar lote"** → `POST /:id/lots` / `PATCH /:id/lots/:lotId`

| Campo | Label | Tipo | Obligatorio | Validación / default | Payload |
|---|---|---|---|---|---|
| `lotNumber` | Número de lote * | text ≤120 | Sí | regex sin `<>` ni control | `lotNumber` |
| `manufacturer` | Fabricante | text | No | — | `manufacturer` |
| `presentation` | Presentacion | text | No | — | `presentation` |
| `concentration` | Concentracion | text | No | — | `concentration` |
| `sanitaryRegistry` | Registro sanitario | text | No | — | `healthRegistration` |
| `receivedAt` | Fecha de recepcion | date | No | — | `receivedAt` |
| `expirationDate` | Fecha de vencimiento | date | No | — | `expirationDate` |
| `initialQuantity` | Cantidad inicial * (creación) | number ≥0 step 0.01 | Sí | precargada con stock histórico si aplica | `quantity` e `initialQuantity` |
| `quantity` | Cantidad actual * (edición) | number ≥0 step 0.01 | Sí | confirm si disminuye | `quantity` |

**Modal de movimiento** → `POST /:id/lots/:lotId/movements`: `movementType` (IN "Registrar entrada" / OUT "Registrar salida" / ADJUSTMENT "Ajustar stock" — **sin entrada en la UI**), `quantity` Cantidad * (number min 1), `reason` Motivo (obligatorio si ADJUSTMENT). Historial de movimientos (`GET …/movements`): Fecha | Tipo | Cantidad | Stock anterior | Stock resultante | Motivo | Usuario. Alertas (`GET /lot-alerts`). **Modal "Etiqueta del lote"** (`GET/PUT/DELETE …/label-image`): subir/reemplazar/eliminar foto de etiqueta (jpeg/png/webp ≤10 MB).

#### 3.D.7 `Liquidaciones.jsx` — Liquidaciones por profesional (`/finanzas/liquidaciones`)

`canManage` = FINANCE_OPERATE_*; si no, `selfScoped` (profesional ve solo las suyas). Cargas: `GET /staff?status=ACTIVE`, `GET API/finance/settlements?professionalUserId&status&dateFrom&dateTo` + `/summary`; pestaña "Resumen por profesional" → `/summary-by-professional` y `GET /by-professional/:id`. Filtros: `professionalUserId` (oculto si selfScoped), `status` (PENDING, DRAFT Borrador, READY Lista, PAID Pagada, CANCELLED, ARCHIVED), `dateFrom`, `dateTo`. KPIs: Total, Pendientes, Listas, Pagadas, Profesionales con liquidación. Tabla: Profesional | Periodo | Estado | Atenciones/items | Total líquido ("Monto oculto" si `amountsHidden`) | Última actualización | Acciones (Ver detalle `GET /:id`, Descargar PDF `GET /:id/pdf`, Editar, Marcar lista `PATCH /:id/status {READY}`, Marcar pagada `{PAID}`, Archivar `DELETE /:id`).

**Modal "Nueva liquidación" / "Editar liquidación"** → `POST API/finance/settlements` / `PUT …/:id`; ingresos elegibles `GET /eligible-incomes?professionalUserId&periodStart&periodEnd&locationId`

| Campo | Label | Tipo | Obligatorio | Opciones / validación / default | Payload |
|---|---|---|---|---|---|
| `settlementType` | Tipo de liquidación | toggle (solo creación) | — | DETAILED "Detallada por atenciones" / MANUAL "Manual" | no se envía |
| `period` | Periodo * | month | Sí (YYYY-MM) | mes actual | `period` |
| `professionalUserId` | Profesional | select | Sí en DETAILED | staff activo | `professionalUserId` |
| `periodStart` / `periodEnd` | Fecha desde / Fecha hasta | date | Sí en DETAILED | 1er/último día | idem |
| `title` | Titulo * | text | Sí | — | `title` |
| `grossAmount` | Total bruto | number ≥0 | No | readOnly en DETAILED (suma) | `grossAmount` |
| `deductionsAmount` | Descuentos | number ≥0 | No | 0 | `deductionsAmount` |
| `bonusAmount` | Bonos | number ≥0 | No | 0 | `bonusAmount` |
| `paymentMethod` | Método de pago | select | No | CASH Efectivo, TRANSFER Transferencia (default), CHECK Cheque, OTHER Otro | `paymentMethod` |
| `paymentDate` | Fecha de pago | date | No | — | `paymentDate` |
| `documentType` / `documentNumber` | Tipo / Número documento | text | No | — | idem |
| `bulkPercentage` | Porcentaje (aplicar a seleccionados) | number 0-100 | — | — | no se envía |
| `selectedIds` | checkbox por ingreso disponible | checkbox | ≥1 en DETAILED | tabla: Fecha de atención, Paciente, Sede, Servicio, Monto pagado, Método | `items[].clinicIncomeId` |
| `drafts[id].calculationType` | Tipo de cálculo | select por fila | Sí en DETAILED | PERCENTAGE Porcentaje / FIXED Monto fijo | `items[].calculationType` |
| `drafts[id].calculationValue` | Valor | number | Sí en DETAILED | % 0-100 / fijo ≤ monto | `items[].calculationValue` |
| `notes` | Notas | textarea | No | — | `notes` |

Totales del formulario: Atenciones seleccionadas, Total pagado, Monto bruto profesional, Descuentos, Bonos, Monto líquido estimado. Modal "Detalle de liquidación" (lectura): información general, montos, ítems (Fecha, Paciente, Sede, Servicio, Monto pagado, Tipo de cálculo, Valor, Monto profesional), notas, PDF.


### 3.E Operaciones (`src/pages/operaciones/*`)

Rutas (desde `src/App.jsx`):

| Ruta | Componente | Guardas |
|---|---|---|
| `/operaciones/inventario` | **`Insumos`** (finanzas) — *no* `Inventario.jsx` | `INVENTORY_PERMISSIONS` + feature `ADVANCED_FINANCE` |
| `/operaciones/inventario/cotizaciones-compra` | `SupplyPurchaseQuotes` | `INVENTORY_PERMISSIONS` + feature `ADVANCED_FINANCE` |
| `/operaciones/inventario/equipos` | `Equipos` | `canViewEquipment` (EQUIPMENT_VIEW_ALL/ASSIGNED/MANAGE_ALL/ASSIGNED) |
| `/operaciones/simulacion-estetica-ia` | `SimulacionEsteticaIA` | rol CLINIC_OWNER o PROFESSIONAL + features `ESTHETIC_TREATMENTS` y `ESTHETIC_AI_SIMULATION` |
| `/operaciones/personal` | `Personal` | `OPERATIONS_PERMISSIONS` + `canViewStaff` (rol CLINIC_OWNER o LOCATION_MANAGER) |
| `/operaciones/prestaciones` | `Prestaciones` | `TREATMENT_PLAN_READ_PERMISSIONS` + feature `TREATMENT_PLANS` |
| `/operaciones/previsiones` | `Previsiones` | `TREATMENT_PLAN_READ_PERMISSIONS` + feature `TREATMENT_PLANS` |
| `/operaciones/nomina` | `Nomina` | `OPERATIONS_PERMISSIONS`, excluye recepcionista/profesional puros |
| `/operaciones/reloj-checador` | `RelojChecador` | idem Nómina |

#### 3.E.1 `Inventario.jsx` — Hub de inventario (huérfano)

Página índice con 3 tarjetas de navegación, sin formularios ni llamadas HTTP: "Inventario de insumos" → `/finanzas/insumos`; "Cotizaciones de compra" → `/operaciones/inventario/cotizaciones-compra`; "Inventario de equipos" → `/operaciones/inventario/equipos`. **No está importado en ninguna parte**; la ruta `/operaciones/inventario` renderiza `Insumos`.

#### 3.E.2 `Equipos.jsx` — Inventario de equipos

Título "Inventario de equipos" / "Control de equipos clinicos, ubicacion, responsables y vencimientos." ("Solo lectura" si no `canManageEquipment`).

Cargas: perfil clínica (sedes, moneda); feature `ESTHETIC_TREATMENTS`; personal activo `GET /api/clinic/staff?status=ACTIVE`; consultorios `GET /api/clinic/consulting-rooms?isActive=true`; lista `GET /api/clinic/equipment?search&locationId&consultingRoomId&clinicalArea&status&category&responsibleUserId&maintenanceDueBefore&calibrationDueBefore&warrantyExpiresBefore&isActive&page&limit&sort&order`; resumen `GET /api/clinic/equipment/summary`; foto por fila `GET /api/clinic/equipment/:id/photo`.

KPIs (6): total, activos, en mantención, fuera de servicio, mantención vencida, calibración vencida.

Filtros:

| Campo | Label/placeholder | Tipo | Opciones |
|---|---|---|---|
| `search` | "Buscar por nombre, marca, modelo, serie o código" | text | — |
| `consultingRoomId` | "Consultorio" | select | "" + consultorios compatibles con sede activa y área |
| `clinicalArea` | "Área clínica" | select | "", DENTAL, ESTHETIC, BOTH |
| `status` | "Estado" | select | "", ACTIVE, IN_MAINTENANCE, OUT_OF_SERVICE, RETIRED, LOST |
| `category` | "Categoría" | text | libre |
| `responsibleUserId` | "Responsable" | select | "" + staff activo compatible con sede |
| `maintenanceDueBefore` / `calibrationDueBefore` / `warrantyExpiresBefore` | "Próxima mantención" / "Próxima calibración" / "Garantía" | date | — |
| `isActive` | — | select | "" Activos y archivados; `true` solo activos; `false` solo archivados |

Tabla: Foto | Equipo | Área | Estado | Marca/modelo | Serie o código | Sede/consultorio | Responsable | Fechas técnicas | Acciones (Ver, Editar, Archivar con confirmación → `DELETE /api/clinic/equipment/:id`).

**Modal `EquipmentFormModal`** — "Nuevo equipo" / "Editar equipo". Crear `POST /api/clinic/equipment`; editar `PATCH /api/clinic/equipment/:id`; foto separada `PUT /api/clinic/equipment/:id/photo` `{imageBase64, mimeType}`.

| Campo | Label | Tipo | Obligatorio / validación | Opciones / default | Payload |
|---|---|---|---|---|---|
| `locationId` | "Sede *" | select required | Sí — "Sede obligatoria." | sedes accesibles; default sede activa | `locationId` |
| `consultingRoomId` | "Consultorio" | select | No; compatible con sede/área | "Sin consultorio asignado" + salas activas compatibles (DENTAL: supportsDental; ESTHETIC: supportsEsthetic; BOTH: ambas) | `consultingRoomId` (null si vacío) |
| `responsibleUserId` | "Responsable" | select | No; compatible con sede | "Por asignar" + staff ACTIVE de la sede | `responsibleUserId` (null si vacío) |
| `name` | "Nombre *" | text required | Sí; ≤160 | — | `name` |
| `category` | "Categoría" | text | No; ≤160 | libre (sin catálogo) | `category` |
| `clinicalArea` | "Área clínica" | select | Sí; ESTHETIC/BOTH requieren módulo Estética | DENTAL, ESTHETIC, BOTH; default DENTAL | `clinicalArea` |
| `status` | "Estado" | select | Sí | ACTIVE, IN_MAINTENANCE, OUT_OF_SERVICE, RETIRED, LOST; default ACTIVE | `status` |
| `brand` / `model` | "Marca" / "Modelo" | text | No; ≤160 | — | `brand`, `model` |
| `serialNumber` | "Número de serie" | text | No; 409 si duplicado | — | `serialNumber` |
| `assetTag` | "Código interno" | text | No; 409 si duplicado | — | `assetTag` |
| `supplier` | "Proveedor" | text | No | — | `supplier` (**el backend espera `supplierName`** — ver brechas) |
| `photoFile` | "Imagen" | file jpeg/png/webp ≤10 MB | No | preview local | PUT separado |
| `purchaseDate` | "Fecha de compra" | date | No | — | `purchaseDate` |
| `purchaseCost` | "Costo de compra" | number ≥0 | No | — | `purchaseCost` |
| `warrantyExpiresAt` | "Garantía" | date | No | — | `warrantyExpiresAt` |
| `lastMaintenanceAt` / `nextMaintenanceAt` | "Última mantención" / "Próxima mantención" | date | próxima ≥ última | — | idem |
| `lastCalibrationAt` / `nextCalibrationAt` | "Última calibración" / "Próxima calibración" | date | próxima ≥ última | — | idem |
| `isActive` | "Activo" | checkbox (solo edición) | — | default true | `isActive` |
| `notes` | "Notas" | textarea | No | — | `notes` |

**Modal `EquipmentDetailModal`** (solo lectura): indicadores "Mantención vencida", "Calibración vencida", "Garantía próxima a vencer" (≤30 días), "Fuera de servicio", "Archivado"; muestra todos los campos + Creado / Última actualización. No muestra la foto; no hay botón para eliminar foto (el `DELETE /photo` existe en servicio pero no en UI).

#### 3.E.3 `Personal.jsx` — Personal clínico y administrativo

Cargas: `GET /api/clinic/staff?search&profession&specialty&status&page&limit` (debounce 250 ms); perfil clínica (`usage.users` para límite de plan).

KPIs: Total personal · Profesionales clínicos · Recepción/asistentes · Activos · Inactivos. Aviso de límite: "Tu plan permite hasta {limit} usuarios…".

Filtros: `search` ("Buscar por nombre o correo..."); `professionFilter` (all, DENTIST Dentista, DENTAL_ASSISTANT Asistente dental, RECEPTIONIST Recepción, ADMINISTRATION Administración, MARKETING Marketing, OTHER Otro); `specialtyFilter` (dinámico); `statusFilter` (all, ACTIVE Activos, INACTIVE Inactivos); `estheticFilter` (all / enabled / notEnabled — **solo cliente**).

Tabla: Integrante (avatar con `agendaColor`, nombre, email) | Rol | Perfil (profesión + especialidad) | Sede | Estética (No aplica / Habilitado / No habilitado) | Estado | Acciones: Editar, menú "Más acciones" → Administrar permisos (requiere USERS_MANAGE_ALL, no self, target ≠ CLINIC_OWNER), Historial de cambios, Desactivar/Activar (`PATCH /api/clinic/staff/:id/status` body `{status:'ACTIVE'|'INACTIVE'}`).

Roles asignables: CLINIC_OWNER → CLINIC_OWNER "Administrador general", LOCATION_MANAGER "Administrador de sede", MARKETING_MANAGER "Encargado de marketing", PROFESSIONAL "Profesional", RECEPTIONIST "Recepción", ASSISTANT "Asistente"; LOCATION_MANAGER → PROFESSIONAL, RECEPTIONIST, ASSISTANT.

**Modal `StaffModal`** — "Nuevo personal" / "Editar personal". Crear `POST /api/clinic/staff`; editar `PUT /api/clinic/staff/:id`; luego, si hay overrides de módulos, `PUT /api/clinic/staff/:id/module-access` `{overrides:[{module, effect}]}`.

| Campo | Label | Tipo | Obligatorio / validación | Opciones / default | Payload |
|---|---|---|---|---|---|
| `firstName` | "Nombre *" | text | Sí | — | `firstName` |
| `lastName` | "Apellido *" | text | Sí | — | `lastName` |
| `email` | "Correo *" | email | Sí | — | `email` |
| `role` | "Rol" | select (disabled si no puede cambiar rol / self) | rol fuera de asignables → "Rol no permitido" | roles asignables; default PROFESSIONAL | `role` |
| `password` | "Contraseña temporal *" | password (**solo creación**) | Sí, ≥10 → "Debe tener al menos 10 caracteres." | — | `password` |
| `profession` | "Profesión" | select | — | 6 profesiones; default DENTIST | `profession` |
| `specialty` | "Especialidad" | text ("Ej: Ortodoncia") | No | — | `specialty` |
| `locationId` | "Sucursal principal" | select | No | "Por asignar" + sedes accesibles | `locationId` |
| `locationIds` | "Sucursales asignadas" | checkboxes | No | sedes accesibles | `locationIds` |
| `supportsEstheticTreatments` | "Habilitado para estética orofacial" | checkbox (solo rol PROFESSIONAL) | No | false | `supportsEstheticTreatments` |
| `agendaColor` | "Color en agenda" (**solo edición**, perfil clínico) | color + hex (maxLength 7) + paleta de 8 (`#2563EB, #16A34A, #9333EA, #EA580C, #0891B2, #DB2777, #4F46E5, #65A30D`) | hex válido → "Usa un color hexadecimal completo, por ejemplo #2563EB." | default #2563EB | `agendaColor` |
| `status` | "Activo" | checkbox (no self) | — | ACTIVE | `isActive` |
| botón "Permisos" | abre `ModuleAccessEditor` | — | — | precarga `GET /api/clinic/staff/:id/module-access` | `overrides` en PUT separado |

**`ModuleAccessEditor.jsx`** — modal "Permisos de módulos": una fila por módulo con radio ALLOW "Permitir" / DENY "Denegar" y subtítulo "Incluido por el rol"/"No incluido por el rol". Módulos: AGENDA Agenda, REPORTS Reportes, QUOTES Cotizaciones, FINANCE Finanzas, COLLECTIONS Cobranza, INVENTORY Inventario, EQUIPMENT Equipos, ESTHETIC_SIMULATION Simulación estética IA, STAFF Personal, PRESTACIONES Prestaciones, PREVISIONES Previsiones, MARKETING Marketing IA. **Siempre envía los 12 módulos** como override explícito (no hay estado neutro).

**`StaffPermissionsDrawer.jsx`** — drawer "Permisos de usuario": carga `GET /api/clinic/staff/permissions/grantable` (grupos finance, collections, inventory, equipment, quotes, agenda) y `GET /api/clinic/staff/:id/permissions`. Por grupo/capacidad un radiogroup con scopes `none` "Sin acceso" / `assigned` "Sedes asignadas" / `all` "Todas las sedes"; opciones deshabilitadas si el rol ya las cubre ("Incluido por el rol"). Guardar → `PUT /api/clinic/staff/:id/permissions` `{customGrants:[...]}` (conjunto completo); confirmación extra si se agregan permisos de finanzas.

**`StaffAuditDrawer`** — "Historial de cambios": `GET /api/clinic/staff/:id/audit-history?action&category&actorUserId&dateFrom&dateTo&page&limit=20&sortOrder`. Filtros: `action` (Todos, STAFF_UPDATED Datos generales, STAFF_ROLE_CHANGED Rol, STAFF_PERMISSIONS_CHANGED Permisos, STAFF_LOCATION_ASSIGNED, STAFF_LOCATION_REMOVED, STAFF_PRIMARY_LOCATION_CHANGED, STAFF_ACTIVATED, STAFF_DEACTIVATED, PROFESSIONAL_PROFILE_UPDATED, PROFESSIONAL_SPECIALTY_CHANGED, PROFESSIONAL_AGENDA_COLOR_CHANGED); `actorUserId`; `dateFrom`; `dateTo`; `sortOrder`. Tarjeta por evento con outcome, actor, sede, motivo y cambios antes→después.

#### 3.E.4 `Prestaciones.jsx` — Catálogo de prestaciones

Carga `GET /api/clinic/prestaciones?all=true`. Formulario inline de alta → `POST /api/clinic/prestaciones`:

| Campo | Label | Tipo | Obligatorio | Opciones/default | Payload |
|---|---|---|---|---|---|
| `newName` | "Nombre" ("Ej: Destartraje, Resina, Corona...") | text | Sí | autoinfiere el modo por palabras clave | `name` |
| `newCode` | "Código (opcional)" | text | No | — | `code` |
| `newPrice` | "Precio" | number ≥0 | No | 0 | `basePrice` |
| `newMode` | "Modo en el odontograma" | select | — | session "Sesión (toda la boca)", tooth "Pieza completa", surface "Cara", extraction "Extracción", cuadrante "Cuadrante", sextante "Sextante", arcada "Arcada"; default tooth | `odontogramMode` |
| `newRequiresProductTracking` | "Requiere producto y lote (ej. Ácido Hialurónico)" | checkbox | No | false | `requiresProductTracking` |

Tabla editable inline: Precio (onBlur → `PUT {basePrice}`), Modo (select → `PUT {odontogramMode}`), Lote real (checkbox → `PUT {requiresProductTracking}`), Estado (toggle → `PUT {active}`), "Desactivar" (`DELETE`). Nombre y código **no editables** tras crear.

#### 3.E.5 `Previsiones.jsx` — Catálogo de previsiones

Carga `GET /api/clinic/previsiones?all=true`. Alta: `newName` "Nombre" ("Ej: Fonasa, Isapre, Particular...") obligatorio → `POST {name}`. Tabla: Estado toggle (`PUT {active}`), "Desactivar" (`DELETE`). Nombre no editable.

#### 3.E.6 `SimulacionEsteticaIA.jsx` — Simulación estética IA

Cargas: perfil clínica; `listClinicPatients({limit:100, locationId})`; `GET /api/clinic/esthetic-simulations?patientId&locationId&status&page&limit`. Filtros: `patientId`, `locationId`, `status` (PENDING, PROCESSING, COMPLETED, FAILED, DISCARDED). Tabla: Paciente | Sede | Tratamiento proyectado | Estado | Fecha | "Ver detalle".

**Modal `SimulationModal`** (creación) → `POST /api/clinic/esthetic-simulations`:

| Campo | Label | Tipo | Obligatorio / validación | Opciones | Payload |
|---|---|---|---|---|---|
| `patientId` | "Seleccionar paciente" | select required | Sí | pacientes (≤100) | `patientId` |
| `locationId` | "Sede" | select required | Sí | sedes | `locationId` |
| `treatmentPlanId` | "Tratamiento proyectado" | select | No | planes ESTHETIC del paciente | `treatmentPlanId` |
| `treatmentType` | "Tipo de tratamiento" | select | Sí | FACIAL_HARMONIZATION Armonización facial, LIP_AUGMENTATION Aumento de labios, BOTULINUM_TOXIN Toxina botulínica, DERMAL_FILLER Relleno dérmico, FACIAL_CONTOURING Contorno facial, SMILE_DESIGN Diseño de sonrisa (default), TEETH_WHITENING Blanqueamiento dental, OTHER_ESTHETIC Otro estético | `treatmentType` |
| `consentId` | "Consentimiento para procesamiento mediante IA" | select required | Sí; solo consentimientos ACTIVE, no vencidos, con propósito ESTHETIC_AI_SIMULATION; link "Registrar consentimiento" → ficha clínica | consentimientos del paciente | `consentId` |
| `selectedFile` | "Fotografía original" (JPEG/PNG/WEBP ≤10 MB) | file | Sí | preview "Antes" | `POST /:id/original-image` (FormData `image`) |
| `accepted` | "Acepto el aviso de simulación orientativa." | checkbox | Sí | — | `disclaimerAccepted: true` |

Modo detalle: badge estado, paneles "Fotografía original" / "Resultado simulado" (watermark "SIMULACIÓN IA"), comparativa Antes/Después. Acciones: subir/reintentar foto, "Generar simulación" (solo PENDING/FAILED con original → `POST /:id/generate`; 503 si IA no configurada), "Descartar simulación" (`POST /:id/discard`), "Eliminar simulación" (`DELETE /:id`).

#### 3.E.7 `SupplyPurchaseQuotes.jsx` — Cotizaciones de compra

Banner dev "Modo de vista previa — datos ficticios" (solo build DEV + `?devPreview=1`, fixtures locales). Lista `GET /api/clinic/supply-purchase-quotes?locationId&status&search&page&limit&sortOrder`. Filtros: `search` ("Proveedor, N° cotización o insumo..."), `status` (Todas, DRAFT Borrador, RECEIVED Recibida, APPROVED Aprobada, REJECTED Rechazada, CANCELLED Cancelada), `sortOrder`.

Tabla: Comparar (checkbox máx. 4) | N° cotización | Proveedor | Insumos | Sede | Fecha | Vigencia | Total | Acciones (estado, "Ver detalle", "Editar" si DRAFT/RECEIVED, transiciones DRAFT→RECEIVED/CANCELLED, RECEIVED→APPROVED/REJECTED/CANCELLED → `PATCH /:id/status`). Panel "Comparar cotizaciones" (2–4): Proveedor | Insumo | Cantidad | Total ("Menor total") | Costo/u | Sede.

**Modal `PurchaseQuoteForm`** → `POST` / `PUT /api/clinic/supply-purchase-quotes/:id`:

| Campo | Label | Tipo | Obligatorio / validación | Payload |
|---|---|---|---|---|
| `supplierName` | "Proveedor *" | text ≤150 | Sí | `supplierName` |
| `supplierRut` | "RUT proveedor" | text ≤20 (formato chileno en vivo) | No; RUT válido | `supplierRut` normalizado |
| `supplierContact` | "Contacto" | text ≤200 | No | `supplierContact` |
| `locationId` | "Sede *" | select (disabled en edición) | Sí; solo sedes con permiso de gestión | `locationId` |
| `quoteDate` | "Fecha cotización" | date | No | `quoteDate` |
| `validUntil` | "Válida hasta" | date | No | `validUntil` |
| `shippingAmount` | "Despacho" | number ≥0 | No | `shippingAmount` |
| `discountAmount` | "Descuento general" | number ≥0 | No | `discountAmount` |
| `notes` | "Notas" | textarea ≤2000 | No | `notes` |
| Ítems ("+ Agregar insumo existente" via buscador `listClinicSupplies({locationId, search, limit:20})` / "+ Agregar insumo nuevo") | | | | |
| ítem `name` | "Nombre *" (solo nuevo) | text | Sí si nuevo | `name` |
| ítem `description` | "Descripción" (solo nuevo) | text | No | `description` |
| ítem `unit` | "Unidad *" | text (disabled si existente) | Sí si nuevo | `unit` |
| ítem `quantity` | "Cantidad *" | number >0 step 0.01 | Sí; default 1 | `quantity` |
| ítem `unitCost` | "Costo unitario *" | number ≥0 | Sí | `unitCost` |
| ítem `discountAmount` | "Descuento" | number ≥0 | No | `discountAmount` |
| ítem (oculto) | — | — | — | `supplyId`, `sortOrder` |

Totales: Subtotal, Descuento general, Despacho, Total. **Modal `DetailModal`** (lectura) con proveedor, RUT, contacto, sede, fechas, estado, ítems y recepción; si APPROVED sin recepción, botón "Registrar recepción".

**Modal `ReceiptModal`** → `POST /api/clinic/supply-purchase-quotes/:id/receive` (confirm "se crearán los lotes y se actualizará el stock…"):

| Campo | Label | Tipo | Obligatorio / validación | Payload |
|---|---|---|---|---|
| `receivedAt` | "Fecha recepción" | date | No | `receivedAt` |
| `supplierDocumentNumber` | "N° documento" | text ≤80 | No | `supplierDocumentNumber` |
| `supplierDocumentDate` | "Fecha documento" | date | No | `supplierDocumentDate` |
| `notes` | "Notas" | textarea ≤2000 | No | `notes` |
| por ítem: Cantidad / Costo unitario | readOnly (se recibe la cantidad completa cotizada) | — | no editable | no se envía |
| por ítem `lotNumber` | "Número de lote *" | text ≤120 | Sí; regex letras/números/espacios/puntos/guiones | `lotNumber` |
| por ítem `expirationDate` | "Fecha de vencimiento" | date | No | `expirationDate` |
| por ítem nuevo `newSupplyData.category` | "Categoría" | text ≤80 | No | `newSupplyData.category` |
| por ítem nuevo `newSupplyData.minimumStock` | "Stock mínimo" | number ≥0 | No | `newSupplyData.minimumStock` |
| por ítem nuevo `newSupplyData.consultingRoom` | "Consultorio" | text ≤80 | No | `newSupplyData.consultingRoom` |

#### 3.E.8 `Nomina.jsx` — Control de Nómina (**MOCK, sin backend**)

Datos hardcodeados (5 filas, "Período: Junio 2026"). KPIs: Pagos este mes, Total descuentos, Total neto pagado, Pendientes. Tabla: Personal | Cargo | Tipo (Fijo/Honor.) | Sueldo base | Descuentos | Bono | Neto | Estado. Modal "Procesar nómina" con checkbox "Confirmo que los montos han sido revisados" — el botón **solo cierra el modal**.

#### 3.E.9 `RelojChecador.jsx` — Reloj Checador (**MOCK, sin backend**)

Datos hardcodeados. KPIs: Presentes hoy, Atrasos, Salidas registradas, Ausentes. Tabla: Personal | Cargo | Entrada | Salida | Atraso | Estado. Modal "Registrar asistencia": `name` select "Integrante", `type` toggle Entrada/Salida, `time` input time (09:00). "Registrar" **no persiste nada** (`onSave` vacío).


### 3.F Marketing IA (`src/pages/MarketingAI.jsx`, `components/marketing/CampaignCanvasEditor.jsx`, `VariantGallery.jsx`)

Ruta `/marketing-ia` (MARKETING_VIEW, feature `MARKETING_AI`; oculto a profesional). `canCreate` = MARKETING_CREATE. Al montar: `GET /api/clinic/marketing-ai/status` → barra Estado (Disponible/No disponible), Plan (Incluye IA/Sin IA), Texto (modelo), Imagen (modelo). Generación bloqueada si no configurado, sin IA en el plan o sin permiso.

Cabecera: "Mis campañas" (`GET /marketing-campaigns?status&limit=50&page=1`), "Simulaciones guardadas" (`GET /marketing-simulations?limit=20`), "Nueva campaña" (reset local). Meta de campaña: `currentCampaignName` "Nombre de campaña" (input; fallback "Campaña {servicio}" / "Campaña Marketing IA") y badge estado Borrador/Lista/Archivada.

Stepper: 1 "Crear contenido" · 2 "Revisar texto" · 3 "Crear imagen" · 4 "Revisar campaña".

**Panel "Mis campañas":** filtro `campaignFilter` (Todas, DRAFT Borradores, READY Listas, ARCHIVED Archivadas); tarjetas (imagen, nombre, servicio, estado, fecha) con "Abrir" (`GET /marketing-campaigns/:id`) y "Archivar" (`DELETE /marketing-campaigns/:id`).

**Panel "Simulaciones guardadas":** tarjetas (imagen, fecha, dimensiones) con "Ver" (visor) y "Eliminar" (`DELETE /marketing-simulations {publicId}`); "Cargar más" (`nextCursor`).

#### Paso 1 — "Cuéntanos sobre tu campaña" (`copyForm`) → `POST /api/clinic/marketing-ai/generate-copy`

| Campo | Label | Tipo | Obligatorio | Opciones / default | Payload |
|---|---|---|---|---|---|
| `objective` | Objetivo * | textarea | Sí | — | `objective` |
| `service` | Servicio * | text | Sí | — | `service` |
| `audience` | Audiencia * | text | Sí | — | `audience` |
| `tone` | Tono * | select | Sí | PROFESSIONAL Profesional (default), FRIENDLY Cercano, EDUCATIONAL Educativo, PROMOTIONAL Promocional | `tone` |
| `offer` | Oferta o promoción | text | No | — | `offer` |
| `clinicName` | Nombre de clínica | text | No | placeholder nombre de la clínica | `clinicName` |
| `locationName` | Sucursal | text | No | default sede primaria | `locationName` |
| `additionalInstructions` | Instrucciones adicionales | textarea | No | — | `additionalInstructions` |
| (ocultos) | — | — | — | constantes | `platform: 'BOTH'`, `language: 'es-CL'` |

Respuesta → `campaignText` (`caption`, `shortCaption`, `hashtags`, `callToAction`, `altText`).

#### Paso 2 — "Revisa y edita el texto" (`campaignText`)

`caption` "Caption para la publicación" (textarea) → `mainText`; `shortCaption` "Versión corta" → `shortText`; `hashtags` "Hashtags" → `hashtags`; `callToAction` "Llamado a la acción" → `callToAction`; `altText` "Texto alternativo" → `altText`. Botones: Copiar contenido, Volver al brief, Regenerar propuesta (mismo POST), Continuar con imagen.

#### Paso 3 — "Prepara la imagen" (`imageMode`: `generate` / `library` / `upload-edit` / `variant-edit`)

**Generar con IA (`imageForm`)** → `POST /api/clinic/marketing-ai/generate-image`

| Campo | Label | Tipo | Obligatorio | Opciones / default | Payload |
|---|---|---|---|---|---|
| `visualMode` | Fotografia promocional / Post con texto / Flyer promocional | tarjetas | Sí | PHOTO (default), POST_BACKGROUND, FLYER_BACKGROUND | `visualMode` |
| `prompt` | Descripción de la imagen * | textarea | Sí | — | `prompt` |
| `format` | Formato de imagen * | select | Sí | SQUARE Cuadrado (default), INSTAGRAM_STORY Vertical, FACEBOOK_POST Horizontal | **`platform`** |
| `quality` | Calidad * | select | Sí | low Baja (default), medium Media, high Alta | `quality` |
| `variantCount` | Cantidad de propuestas * | select | Sí | 1 / 3 | `variantCount` |
| `rightsConfirmed` | "Confirmo que tengo derecho a utilizar…" | checkbox required | Sí | false | `rightsConfirmed` |

**Usar biblioteca:** `GET /api/clinic/marketing-media/library` (fallback local `marketingImageLibrary.js`: veneers-01, esthetic-evaluation-01, cleaning-01, orthodontics-01, dental-checkup-01, modern-clinic-01; categorías Carillas dentales, Higiene dental, Ortodoncia, Evaluacion, Clínica); selects `format`, `visualMode` "Tipo de pieza", `libraryFilter`; "Usar esta imagen" abre el editor.

**Editar una imagen existente (`editForm`)** → `POST /api/clinic/marketing-ai/edit-image` (multipart)

| Campo | Label | Tipo | Obligatorio | Validación / default | FormData |
|---|---|---|---|---|---|
| `image` | Imagen * | file png/jpeg/webp ≤10 MB | Sí (o variante origen) | — | `image` |
| `prompt` | Cambios solicitados * | textarea | Sí | — | `prompt` |
| `format` | Formato de imagen * | select | Sí | SQUARE/INSTAGRAM_STORY/FACEBOOK_POST | `platform` |
| `quality` | Calidad * | select | Sí | low/medium/high | `quality` |
| `rightsConfirmed` | confirmación de derechos | checkbox required | Sí | — | `rightsConfirmed` ('true'/'false') |
| `containsPatient` | ¿Contiene paciente identificable? | radio Sí/No | Sí | false | `containsPatient` |
| `patientConsentConfirmed` | "Confirmo que cuento con autorización del paciente…" | checkbox | Sí si containsPatient | — | `patientConsentConfirmed` |

Resultado: Reemplazar propuesta seleccionada / Conservar original / Descargar edición. `VariantGallery`: seleccionar propuesta, Descargar, Editar con IA, Generar nuevas propuestas, Continuar al editor.

#### Editor de canvas (`CampaignCanvasEditor`, Konva)

Lienzo por formato: SQUARE 1024×1024, INSTAGRAM_STORY 1024×1536, FACEBOOK_POST 1536×1024. Capas: fondo, overlay, bloques de plantilla, formas, badge, título, subtítulo, beneficios, destacado, CTA, contacto, textos libres (≤5), logo; `Transformer` para mover/redimensionar; atajos Esc/Delete.

| Panel | Campo | Label | Tipo | Opciones / rango / default |
|---|---|---|---|---|
| Diseño rápido | `adStyle` | Plantilla de diseño | select | clean-modern Limpio moderno, dental-tips Consejos dentales, badge-promo Promocion con badge, diagonal-panel Panel diagonal, premium-flyer Flyer premium, benefits-focus Beneficios destacados, offer-highlight Oferta destacada, before-booking Antes de agendar, clinic-card Tarjeta clínica, educational-post Post educativo, split-ad Flyer dividido |
| | `visualFinish` | Estilo visual | select | clean Profesional limpio (default), premium Premium elegante, commercial Comercial llamativo, educational Educativo visual, impact Alto impacto |
| | `quickPalette` | Paleta rápida | select | dental-teal Turquesa dental (default), professional-blue Azul profesional, premium-navy Azul oscuro premium, health-green Verde salud, esthetic-purple Morado estético, premium-gold Dorado premium |
| | `density` | Densidad del diseño | select | light Ligero, balanced Equilibrado, complete Completo |
| | botones | Probar otra plantilla, Ordenar diseño, Hacer más compacto, Hacer más grande, Centrar elementos principales, Ajustar textos | — | — |
| | `primaryColor` / `secondaryColor` / `textColor` | Color principal / secundario / texto | color | #0891b2 / #0f172a / #ffffff |
| | `fontFamily` | Tipografia | select | Arial, Georgia, Verdana, Trebuchet MS |
| | `alignment` | Alineación | select | left Izquierda, center Centro, right Derecha |
| Contenido | `badgeText` | Etiqueta | input | "Nuevo servicio" / "Cupos disponibles" |
| | `title` | Título | input maxLength 80 | servicio del brief |
| | `subtitle` | Subtítulo | textarea | oferta / caption corto |
| | `benefits[]` | Beneficios | hasta 3 inputs | — |
| | `callToAction` | Botón de llamada a la acción | input | CTA del texto |
| | `phone` | Teléfono o WhatsApp | input | — |
| | `website` | Sitio web | input | — |
| | `clinicName` | Nombre de clínica | input | — |
| | `highlightTitle` / `highlightText` | Bloque destacado / Texto del bloque destacado | input / textarea | — |
| Logo | archivo | Subir logo | file png/jpg/webp ≤5 MB | **no persistido** |
| | `logoPlacement` | Posición rápida | select | free Libre, top-left, top-right, bottom-left, bottom-right |
| | `positions.logo.width` | Tamaño del logo | range | — |
| | botones | Quitar logo, Ocultar/Mostrar logo | — | — |
| Elemento seleccionado | tamaño de letra (range/number/±/Restablecer/Ajustar texto al bloque), X/Y/Ancho/Alto, altura mínima, espacio interno, alineaciones, traer adelante/enviar atrás; CTA: color botón, color texto, mostrar botón, mostrar como botón, sombra, ancho completo, presets Compacto/Normal/Grande; beneficios: fondo, checks, transparencia; texto libre: contenido, color, tipografía, alineación, transparencia, negrita; forma: color, transparencia, borde, grosor, radio/diámetro/longitud | — | — | límites `FONT_SIZE_LIMITS`, `BLOCK_SIZE_LIMITS` |
| Agregar elementos | `template` | Plantilla antigua | select | minimal Minimalista, bottom-band Banda inferior, split-flyer Flyer dividido, modern-promo Promocion moderna, side-card Tarjeta lateral, center-hero Centro destacado |
| | visibilidad | Mostrar título / subtítulo / etiqueta / beneficios / caja de fondo / botón / como botón / contacto / bloque destacado / logo; Fondo título; Fondo subtítulo; Marco interior | checkboxes/toggles | — |
| | "Agregar texto" (≤5), formas Rectangulo / Rectangulo redondeado / Circulo / Línea separadora / Banda horizontal (≤10); lista de capas | — | — |
| Filtro sobre imagen | `overlayEnabled` / `overlayTone` / `overlayOpacity` | Activar overlay / Tipo overlay (dark Oscuro, light Claro) / Intensidad 0–0.7 | checkbox/select/range | true / dark / 0.32 |

Acciones del editor: Volver · Nueva campaña (reset local) · Descargar imagen sin texto · Guardar borrador / Actualizar borrador · Guardar como lista · Mis campañas · Descargar pieza final (exporta PNG y pasa al paso 4).

`editorState` persistido (JSON en `MarketingCampaign.editorState`): `version, format, visualMode, template, adStyle, visualFinish, quickPalette, density, positions{…}, manualPositions, fontSizes{…}, customFontSizes, primaryColor, secondaryColor, textColor, fontFamily, alignment, overlayEnabled, overlayTone, overlayOpacity, frameEnabled, titleStyle, subtitleStyle, badgeStyle, benefitStyle, ctaStyle, contactStyle, highlightStyle, logoOptions, logoPlacement, shapes[], freeTexts[], texts{title, subtitle, benefits[], callToAction, phone, website, clinicName, badgeText, highlightTitle, highlightText}`.

#### Paso 4 — "Revisa la campaña"

Imagen final, `caption` "Caption editable", `hashtags`, `callToAction` "CTA". Botones: Editar texto, Editar diseño, Cambiar propuesta, **Guardar campaña / Actualizar campaña** (`POST /marketing-campaigns` o `PUT /:id`), **Guardar como lista** (status READY), **Guardar simulación** (`POST /marketing-simulations {imageBase64, mimeType}`; bloqueado si la imagen contiene paciente), Descargar pieza, Nueva campaña, Copiar publicación.

**Payload de campaña (`buildCampaignPayload`)**: `name, service, audience, objective, mainText, shortText, hashtags, callToAction, altText, imageMimeType, editorState, templateKey (= adStyle || template), visualStyleKey (= visualFinish), colorPaletteKey (= quickPalette), status (DRAFT|READY), baseImageBase64?, baseImageUrl?, finalImageBase64?, finalImageUrl?`. **No envía `locationId`** ni los campos del brief `tone/offer/clinicName/locationName/additionalInstructions`.


### 3.G Login, Dashboard, Reportes, Preferencias y Panel de plataforma

#### 3.G.1 `Login.jsx` — `/login`

Marca "fordentcloud", "Inicia sesión para continuar". Campos: `email` "Correo electrónico" (email, placeholder `usuario@clinica.com`) y `password` "Contraseña" (password con botón mostrar/ocultar). Validación JS "Completa usuario y contraseña para continuar."; error "Credenciales inválidas o usuario inactivo.". `POST /api/auth/login {email, password}` → `GET /api/auth/me` → redirección por `redirectTo` (plataforma → `/admin-plataforma/resumen`; clínica → `/dashboard`). **No hay** "Recordarme", recuperación de contraseña ni credenciales demo visibles (el seed crea `admin@dentalos.com` PLATFORM_ADMIN y `clinica@demo.com` CLINIC_OWNER).

#### 3.G.2 Preferencias (`PreferencesControls.jsx`)

`currentLanguage` "Idioma" (select: es Español, en English; `localStorage['dentalcloud_language']`); `selectedCurrency` "Moneda" (select: CLP, USD, EUR; `localStorage['dentalcloud_currency']`; conversión visual con tasas fijas USD 950 / EUR 1030 CLP y sufijo " ref."). No hay selector de tema.

#### 3.G.3 `Dashboard.jsx` — `/dashboard`

Vista por rol (admin / recepción / profesional). Endpoints: `GET /clinic/profile`; `GET /agenda/appointments?date=hoy&locationId?`; `GET /reports/finance?dateFrom=1°mes&dateTo=hoy&locationId?` (no recepción/profesional); `GET /reports/patients?locationId?`; `GET /finance/supplies/summary?locationId?` (INVENTORY_*); `GET /reminders/summary?locationId?`; `GET /finance/settlements/summary?professionalUserId=me` (profesional). Con acceso global y >1 sede repite por sede ("Resumen por sede").

KPIs: Citas de hoy, En atención, Pacientes activos, Ingresos del mes, Balance, Insumos bajo stock (admin/recep); Próximas citas, Recordatorios pendientes, Mis liquidaciones (profesional). Secciones: Accesos rápidos (Nueva cita, Nuevo paciente, Configurar horarios, Ver monitor, Ver recordatorios, Ver mis liquidaciones, Ver finanzas, Ver reportes), Resumen por sede, Primeros pasos (checklist por rol), Agenda de hoy (Hora | Paciente | Servicio | Profesional | Consultorio | Estado), Resumen financiero (Ingresos, Gastos, Insumos, Liquidaciones, Balance), Estado de consultorios, Pacientes a revisar, Alertas operativas. Sin formularios.

#### 3.G.4 `Reportes.jsx` — `/reportes?section=…` (feature `ADVANCED_REPORTS`)

Pestañas: `overview` Resumen general · `finance` Finanzas · `appointments` Agenda y asistencia · `patients` Pacientes · `treatments` Tratamientos (acceso por FINANCE_*/AGENDA_*/PATIENTS_*).

Filtros generales (`GET /reports/overview|finance|patients|treatments`): `dateFrom` "Fecha desde" (default 1° del mes), `dateTo` "Fecha hasta" (último día), `groupBy` "Agrupar por" (day Día, week Semana, month Mes; default month), `locationId` oculto (sede activa). Botones Aplicar filtros, Limpiar, Mes actual, Últimos 30 días.

- **Resumen general:** KPIs (Pacientes activos, Citas del periodo, Citas completadas, Tasa de asistencia, Ingresos, Gastos, Balance, Planes activos/aceptados, Monto estimado, Sedes activas), Actividad clínica, Salud financiera, Actividad de pacientes, Actividad de tratamientos, Puntos de atención (alertas), Hallazgos, Calidad de datos.
- **Finanzas:** KPIs (Ingresos, Gastos, Insumos, Liquidaciones, Balance, Transacciones, Ingreso/Gasto promedio); "Evolución financiera" (métrica: Ingresos, Gastos, Balance, Insumos, Liquidaciones); Ingresos por concepto; Gastos por categoría; Métodos de pago; tabla Resultados por sede (Sede | Ingresos | Gastos | Balance); Gastos principales (Fecha | Concepto | Categoría | Sede | Monto); Hallazgos; Calidad de datos.
- **Pacientes:** KPIs (Total, Activos, Archivados, Nuevos, Recurrentes, Con citas, Sin citas, Promedio citas); evolución (Nuevos, Recurrentes, Activos, Citas); Nuevos vs recurrentes; Frecuencia de atención; Actividad; Inactividad (30/60/90 días, nunca atendidos); tabla Actividad por sede.
- **Tratamientos:** estados (Total, Borradores, Propuestos, Aceptados, En progreso, Completados, Cancelados, Archivados), finanzas (Monto estimado/promedio), tasas (aceptación, finalización), evolución, distribución por estado, antigüedad; tablas Procedimientos (Procedimiento | Cantidad | Planes | Monto | %), Por profesional (Profesional | Especialidad | Total | Aceptados | En progreso | Completados | Monto | Aceptación | Finalización), Por sede.

**Agenda y asistencia — reporte detallado** (`GET /reports/appointments/detailed` + `/rows`; sub-pestañas Resumen, Demanda y horarios, Doctores y sedes, Motivos, Detalle):

| Filtro | Label | Tipo | Validación | Opciones / default | Query |
|---|---|---|---|---|---|
| `dateFrom` / `dateTo` | Fecha desde / hasta | date | obligatorios; rango ≤366 días | 1°/último día del mes | `dateFrom`, `dateTo` |
| `groupBy` | Agrupar por | select | — | day (default) / week / month | `groupBy` |
| `professionalIds` | Doctores | multiselección (buscar doctor, Todos, Limpiar) | — | `GET /agenda/professionals?locationId` | `professionalIds=a,b` |
| `statuses` | Estados | multiselección | — | SCHEDULED Agendada, CONFIRMED Confirmada, IN_PROGRESS En atención, COMPLETED Completada, CANCELLED Cancelada, NO_SHOW No asistió | `statuses=A,B` |
| `service` | Servicio o tratamiento | text | — | — | `service` |
| `box` | Consultorio o box | text | — | — | `box` |
| `createdByUserId` | Agendada por | select | — | `GET /staff?status=ACTIVE&limit=200` ("Nombre · Rol") | `createdByUserId` |
| `limit` / `sortBy` / `sortOrder` / `page` | Filas / Ordenar por | select | — | 10/25/50/100; startAt, status, professional, location, service, createdAt | solo `/rows` |

Contenido: KPIs con comparación vs. período anterior (Total citas, Completadas, Canceladas, No asistió, Asistencia, Cancelación, No asistencia, Creadas en periodo, Pacientes únicos, Citas reagendadas), Hallazgos, Calidad de datos, Evolución por periodo, Estados; **Mapa de demanda** (7 días × 8 franjas), Anticipación de agendamiento (promedio, mediana, mismo día, >14 días, distribución); **Doctores y sedes**: Por profesional (% asistencia), **"Demora en pasar a atender"** (`avgAttentionDelayMinutes` en minutos por profesional, solo con muestra > 0 — minutos entre la hora agendada y el paso a IN_PROGRESS, mínimo 0), Por sede, Por box, Por servicio, Por usuario que agendó; **Motivos** de cancelación y no asistencia, Momento de cancelación (>48 h, 24–48 h, <24 h, mismo día, después de la hora), Reagendamientos; **Detalle**: tabla Fecha | Hora | Paciente | Profesional | Sede | Servicio | Estado | Motivo | Creada | Box | Usuario | Reag.

Exportaciones: "Descargar Excel" (`GET /reports/appointments/detailed/export/excel`) y "Descargar PDF" (`…/export/pdf`) con los filtros aplicados (límite backend 10.000 filas).

#### 3.G.5 Panel de plataforma (`src/pages/adminPlataforma/*`, solo PLATFORM_MANAGE)

`adminMock.js` (datos ficticios) **no es importado por ninguna página**: todas consumen el backend real.

**AdminResumen** (`/admin-plataforma/resumen`) — `GET /api/platform/dashboard`: KPIs Total clínicas, Clínicas activas, MRR estimado, Suscripciones vencidas, Pagos fallidos, Tickets abiertos, Usuarios totales, Sedes totales; Salud de plataforma; Distribución por plan; Ingresos últimos meses; Renovaciones próximas; Alertas críticas; Actividad reciente. Sin formularios.

**Clinicas** (`/admin-plataforma/clinicas`) — `GET /api/platform/clinics`; filtros locales `search` "Buscar clínica", `country`, `status` (ACTIVE Activa, TRIAL Prueba, SUSPENDED Suspendida, EXPIRED Vencida). Tabla: Clínica | País | Moneda | Zona horaria | Plan | Estado | Sedes | Usuarios | Último acceso | Acción (Ver detalle).

**Modal "Nueva clínica"** → `POST /api/platform/clinics` (carga `GET /platform/plans`, `GET /platform/feature-modules`)

| Sección | Campo | Label | Tipo | Obligatorio / validación | Opciones / default | Payload |
|---|---|---|---|---|---|---|
| Datos de la clínica | `clinicName` | Nombre | text | Sí | — | `clinic.name` |
| | `clinicCountry` | País | select | Sí | Chile (default), España, Colombia, Perú, México, Estados Unidos, Venezuela, Francia, Otro (aplica moneda/zona por defecto) | `clinic.country` |
| | `clinicCurrency` | Moneda | select | Sí (3 letras) | CLP (default), EUR, USD, COP, PEN, MXN, VES | `clinic.currency` |
| | `clinicTimeZone` | Zona horaria | select | Sí | America/Santiago (default), Europe/Madrid, America/Bogota, America/Lima, America/Mexico_City, America/New_York, America/Los_Angeles, America/Caracas, Europe/Paris | `clinic.timeZone` |
| | `contactName` | Nombre de contacto | text | Sí | — | `clinic.contactName` |
| | `contactEmail` | Correo de contacto | email | Sí (regex) | — | `clinic.contactEmail` |
| | `contactPhone` | Teléfono | text | Sí | — | `clinic.contactPhone` |
| | `clinicType` | Tipo de clínica | select | Sí | DENTAL Dental (default), ESTHETIC Estética facial, BOTH Dental y estética | `clinic.clinicType` |
| Sede inicial | `locationName` | Nombre de la sede | text | Sí | "Sede Principal" | `location.name` |
| | `locationCountry` / `locationCurrency` | País / Moneda | text readOnly | — | espejo de la clínica | `location.country`, `location.currency` |
| Administrador | `adminName` | Nombre | text | Sí | — | `admin.name` |
| | `adminEmail` | Correo | email | Sí | — | `admin.email` |
| | `adminPassword` | Contraseña temporal | password | Sí (≥10) | — | `admin.password` |
| | `adminPasswordConfirm` | Confirmar contraseña | password | Sí (coincidir) | — | no se envía |
| Suscripción | `planId` | Plan base | select | Sí | planes activos visibles "{name} - USD {precio} - sedes N - usuarios N" (default PROFESSIONAL) | `subscription.planId` |
| | `subscriptionStatus` | Estado | select | — | ACTIVE Activa (default), TRIAL En prueba | `subscription.status` |
| | `startDate` / `endDate` | Fecha de inicio / término | date | Sí (fin > inicio) | hoy / hoy + 1 mes | `subscription.startDate`, `subscription.endDate` |
| | `autoRenew` | Renovación automática | checkbox | — | true | `subscription.autoRenew` |
| Extensiones iniciales | `selectedModules` | checkboxes por módulo activo | — | preseleccionados ADVANCED_FINANCE, CLINICAL_RECORD, TREATMENT_PLANS, ADVANCED_REPORTS | — | `modules: [{ key, enabled: true, quantity: 1 }]` |

Resumen de costo (Plan base, Extensiones, Total estimado USD/mes). **No hay campo IVA (`taxRatePercent`)**, dirección de sede ni teléfono del administrador.

**ClinicaDetalle** (`/admin-plataforma/clinicas/:id`) — `GET /platform/clinics/:id`, `GET /platform/feature-modules`, `GET /platform/clinics/:id/modules`. Lectura: KPIs (Plan actual, Estado suscripción, Sedes, Usuarios, MRR, Último acceso), Información general (Responsable, Correo, Teléfono, País, Moneda, Zona horaria, Fecha de alta), Suscripción actual (Plan, Estado, Monto, Inicio, Vencimiento, Renovación automática), tablas Sedes (Sede | Ciudad | País | Estado) y Usuarios (Usuario | Correo | Rol | Estado).

| Formulario | Campos | Endpoint |
|---|---|---|
| "Editar clínica" | `name` Nombre, `country` País (select 9), `currency` Moneda (select 7), `timeZone` Zona horaria (select 9), `contactName`, `contactEmail`, `contactPhone` — todos obligatorios | `PATCH /api/platform/clinics/:id` |
| "Activar suscripción" (solo sin plan) | `planId` Plan (select `GET /platform/plans` "{name} — {USD}/mes"), `autoRenew` Renovación automática (true) | `POST /api/platform/clinics/:id/subscription` |
| Suspender clínica (confirm) | — | `PATCH /api/platform/clinics/:id/status {status:'SUSPENDED'}` |
| Reactivar clínica (confirm) | — | `POST /api/platform/clinics/:id/reactivate` |
| "Plan y módulos" (editor inline) | por módulo: `enabled` Activo/Inactivo (checkbox), `priceUsd` Precio (number ≥0), `quantity` Cantidad (si el módulo lo permite) | `PUT /api/platform/clinics/:id/modules { modules: [{ key, enabled, priceUsd, quantity }] }` |

**Suscripciones** (`GET /platform/subscriptions`): filtros locales `plan`, `status`; tabla Clínica | Plan | Monto (USD) | Moneda | Estado | Inicio | Vencimiento | Renovación automática | Acción ("Renovar"/"Cambiar plan" — **Próximamente**, deshabilitados).

**Planes** (`GET /platform/plans`): tarjetas Basic/Professional/Enterprise con precio, código, visibilidad, sedes, usuarios, suscripciones, Finanzas/IA/API, módulos incluidos. "Nuevo plan" deshabilitado (Próximamente).

**Pagos** (`GET /platform/payments?status&clinicId&dateFrom&dateTo`): filtros `status` (PAID Pagado, PENDING Pendiente, FAILED Fallido, REFUNDED Reembolsado), `clinicId`, `dateFrom`, `dateTo`; KPIs Total pagado, Pendiente, Fallidos, Último pago; tabla Clínica | Plan | Monto | Moneda | Estado | Método de pago | Fecha | Referencia. Sin mutaciones.

**Soporte** (`GET /platform/support-tickets?status&priority&clinicId`): filtros `status` (Abierto, En revisión, Resuelto), `priority` (Alta, Media, Baja), `clinicId`; KPIs Abiertos, En revisión, Resueltos, Urgentes; tabla Clínica | Asunto | Tipo | Prioridad | Estado | Usuario creador | Fecha. "Nuevo ticket interno" deshabilitado (Próximamente). **No existe creación ni edición de tickets en ninguna parte.**

**UsoSistema** (`GET /platform/usage`): KPIs Clínicas, Usuarios, Pacientes, Citas, Clínicas inactivas; tabla Clínica | Periodo | Citas | Pacientes | Usuarios activos | Almacenamiento utilizado | Última actualización.

**ModuleRequests** (`/admin-plataforma/solicitudes-modulos`) — `GET /platform/module-requests?status&clinicId`; filtros `status` (PENDING, IN_REVIEW, APPROVED, REJECTED, CANCELLED), `clinicId`, `search`; tabla Clínica | Fecha | Estado | Moneda | Total estimado | Módulos solicitados | Acciones (Ver detalle → `GET /platform/module-requests/:id`). Drawer "Detalle de solicitud" (lectura: clínica, solicitante, fecha, estado, moneda, precios estimados, mensaje, módulos) con aviso "Aprobar esta solicitud no activa módulos automáticamente" y botón "Ir a módulos de la clínica".

**Formulario "Cambiar estado"** → `PATCH /api/platform/module-requests/:id/status`: `statusForm` "Estado" (select PENDING Pendiente, IN_REVIEW En revisión, APPROVED Aprobada, REJECTED Rechazada, CANCELLED Cancelada) → `status`; `adminNotes` "Notas internas" (textarea) → `adminNotes`.

#### 3.G.6 Componentes legacy no usados

`Topbar.jsx`, `Header.jsx` (marca "zydent", "Sede: REFF 1", "DAVID CABALLERO" hardcodeados) y `BottomNav.jsx` no se importan en ningún archivo.


## 4. Funcionalidades y flujo general

### 4.1 Autenticación y sesión

- `POST /api/auth/login` (rate limit 10 intentos / 15 min): email + contraseña → bcrypt. Excepción: si el email coincide con `SUPERADMIN_FEDERATED_EMAIL`, la contraseña se valida **contra el login de DentalCloud** (`POST {DENTALCLOUD_API_URL}/api/auth/login`), no contra el hash local.
- Sesión: JWT HS256 (`sub, role, profession, specialty, clinicId, locationId`, TTL 2 h) en cookie httpOnly `access_token` (`secure` + `sameSite=none` en producción; `lax` en dev; `Bearer` aceptado solo fuera de producción). `GET /api/auth/me` devuelve usuario + permisos efectivos + `accessScope` + sedes asignadas.
- **No existe** recuperación/cambio de contraseña, registro público ni MFA. Las contraseñas se fijan al crear (plataforma o Personal) y no hay endpoint para cambiarlas.
- Solicitud de demo pública (`POST /api/demo-requests {email}`): solo envía un correo a `soporte@rids.cl`; no persiste.

### 4.2 Roles y permisos

Roles (`UserRole`): PLATFORM_ADMIN (super-admin, sin clínica), CLINIC_OWNER "Administrador general", LOCATION_MANAGER "Administrador de sede", MARKETING_MANAGER, PROFESSIONAL, RECEPTIONIST, ASSISTANT (+ legacy CLINIC_ADMIN→CLINIC_OWNER, CLINIC_STAFF→PROFESSIONAL). Profesiones: DENTIST, DENTAL_ASSISTANT, RECEPTIONIST, ADMINISTRATION, MARKETING, OTHER.

Permisos (58, `src/constants/permissions.js`): PLATFORM_MANAGE; CLINIC_VIEW, CLINIC_SETTINGS_MANAGE, SUBSCRIPTION_MANAGE; LOCATIONS_VIEW_ALL/ASSIGNED, LOCATIONS_MANAGE; USERS_VIEW_ALL/ASSIGNED, USERS_MANAGE_ALL/ASSIGNED; AGENDA_VIEW_ALL/ASSIGNED, AGENDA_MANAGE_ALL/ASSIGNED; CLINICAL_RECORD_VIEW/MANAGE_ALL/ASSIGNED; ODONTOGRAM_VIEW/MANAGE_ALL/ASSIGNED; PATIENTS_VIEW_ASSIGNED, PATIENTS_MANAGE_ASSIGNED; FINANCE_VIEW/OPERATE_ALL/ASSIGNED; COLLECTIONS_VIEW/MANAGE_ALL/ASSIGNED; INVENTORY_VIEW/MANAGE_ALL/ASSIGNED; OPERATIONS_VIEW_ALL/ASSIGNED, OPERATIONS_MANAGE_ASSIGNED; EQUIPMENT_VIEW/MANAGE_ALL/ASSIGNED; ESTHETIC_SIMULATION_VIEW/MANAGE_ALL/ASSIGNED, ESTHETIC_SIMULATION_GENERATE_ASSIGNED; MARKETING_VIEW/CREATE/APPROVE/PUBLISH, SOCIAL_CONNECTIONS_MANAGE; QUOTES_VIEW/MANAGE_ALL/ASSIGNED, QUOTES_APPROVE_DISCOUNT, QUOTES_CONVERT.

Matriz por rol (resumen): CLINIC_OWNER tiene todo lo de clínica (ALL); LOCATION_MANAGER: ASSIGNED de usuarios, agenda, ficha (solo ver), odontograma (ver), pacientes, finanzas, cobranza, inventario, operaciones, equipos, marketing ver/crear, cotizaciones; MARKETING_MANAGER: CLINIC_VIEW + MARKETING_VIEW/CREATE; PROFESSIONAL: agenda, ficha y odontograma ASSIGNED (ver/gestionar), pacientes, simulación estética, operaciones ver, equipos ver; RECEPTIONIST: agenda, pacientes, operaciones, cotizaciones (sin clínica ni finanzas); ASSISTANT: solo lectura (agenda, ficha, odontograma, pacientes, operaciones, equipos).

Capas adicionales:
- **Permisos personalizados** (`ClinicUserPermissionGrant`): CLINIC_OWNER puede otorgar 22 permisos extra (finance, collections, inventory, equipment, quotes en scope assigned/all; agenda solo assigned), con dependencias (operate/manage requiere view) — UI: Personal → "Administrar permisos".
- **Visibilidad de módulos** (`ClinicUserModuleAccess`): ALLOW/DENY por usuario para 12 módulos del menú — UI: Personal → "Permisos" (`ModuleAccessEditor`). Solo afecta navegación, no la API.
- **Alcance por sede**: roles LOCATION_MANAGER/PROFESSIONAL/RECEPTIONIST/ASSISTANT solo ven datos de sus `UserLocation`; CLINIC_OWNER toda la clínica.
- **Features contratadas** (`requireClinicFeature`): CLINICAL_RECORD (ficha/odontograma), TREATMENT_PLANS (planes, prestaciones, previsiones), ADVANCED_FINANCE (caja, ingresos, gastos, inventario, compras), AGREEMENTS, LIQUIDATIONS, ADVANCED_REPORTS, ESTHETIC_TREATMENTS + ESTHETIC_AI_SIMULATION (simulación IA), MARKETING_AI (plan con IA). Se calculan desde `Subscription` + `SubscriptionModule` + flags legacy del `Plan` (includesAi→MARKETING_AI, includesFinance→ADVANCED_FINANCE, includesApi→API_ACCESS). Límites `maxUsers`/`maxLocations` del plan se aplican al crear personal/sedes.

### 4.3 Módulos funcionales (flujo)

1. **Plataforma (super-admin):** crea clínica (con sede inicial, owner, suscripción, módulos) → se espeja en DentalCloud; gestiona estado (suspender/reactivar), suscripción, módulos y precios; revisa solicitudes de módulos de las clínicas (aprobar no activa módulos: se hace manualmente en "Plan y módulos"); consulta pagos Stripe, tickets (solo lectura), uso, dashboard.
2. **Clínica → Ajustes:** sedes (país/moneda heredados; límite por plan), consultorios (dental/estético), horarios semanales y bloqueos por profesional (validados al agendar), plantillas de consentimiento (versionadas, categorías de datos, canales), suscripción (checkout Stripe mensual/anual, portal, solicitud de módulos).
3. **Personal:** alta de usuarios con rol/profesión/especialidad/sedes/color de agenda/estética; activar/desactivar; permisos extra; visibilidad de módulos; auditoría por usuario. Profesionales con estética se espejan en DentalCloud.
4. **Pacientes:** alta/edición/archivo; RUT chileno validado; consentimientos (registro con snapshot de plantilla, representante legal, revocación, PDF); historial de atenciones; auditoría (quién vio/modificó qué); privacidad (solicitudes DATA_EXPORT/CORRECTION/RESTRICTION/ANONYMIZATION con flujo de revisión; exportación JSON; anonimización irreversible sujeta a política de retención). Espejo en DentalCloud.
5. **Ficha clínica:** antecedentes (texto), notas clínicas (DRAFT→FINAL→ARCHIVED), odontograma FDI con superficies y 12 condiciones.
6. **Agenda:** citas por sede/profesional/box con validación de disponibilidad (horario + bloqueos + solapes); estados SCHEDULED→CONFIRMED→IN_PROGRESS→COMPLETED / CANCELLED / NO_SHOW con motivos codificados e historial (`AppointmentStatusHistory`, incluye reagendamientos); correo de confirmación al paciente (Microsoft Graph); al completar se crea un **recordatorio automático** según reglas (palabras clave del servicio → tipo, plazo en días/meses, prioridad) o por defecto (implante → 3 meses; general → 6 meses). Vista diaria/semanal, monitor de sala ("Llamar siguiente"), "Mi horario" del profesional. Espejo en DentalCloud.
7. **Recordatorios:** manuales y automáticos; estados PENDING/OVERDUE/CONTACTED/SCHEDULED/COMPLETED/CANCELLED; agendar seguimiento crea cita y marca SCHEDULED.
8. **Prestaciones / Previsiones:** catálogo con precio, código, modo de odontograma (sugerido por palabras clave), trazabilidad de producto; previsiones informativas (Fonasa/Isapre/Particular). Espejo en DentalCloud.
9. **Planes de tratamiento:** DENTAL (odontograma por pieza/cara/cuadrante/sextante/arcada/sesión) o ESTHETIC (mapa facial 14 zonas, género, consultorio/consentimiento estético); ítems con precio de lista, descuento por convenio, producto/lote/vencimiento (búsqueda de lotes reales), estados; total estimado, pagado (ingresos vinculados) y saldo; PDF de presupuesto. Espejo bidireccional con DentalCloud (fotos y anotaciones faciales solo llegan desde allá).
10. **Cotizaciones (documento comercial):** ítems manuales o de inventario, descuentos por ítem (permiso), IVA desglosado (incluido), numeración COT-AAAA-N al emitir, transiciones DRAFT→ISSUED→ACCEPTED/REJECTED/CANCELLED, PDF, seguimiento del tratamiento (NOT_STARTED/IN_PROGRESS, `followUpAt`, contacto, WhatsApp), recordatorios QUOTE_FOLLOW_UP con correo automático (aceptadas sin iniciar con seguimiento vencido; en tratamiento sin cita hace >21 días).
11. **Cobranza:** orden de cobro desde cotización aceptada (COB-AAAA-N) con cobertura NONE/FONASA/ISAPRE; pagar (CASH/DEBIT_CARD/CREDIT_CARD) crea un `ClinicIncome` vinculado a paciente/cotización/profesional; cancelar.
12. **Finanzas:** ingresos (método de pago, "otro" texto libre, total/parcial, documento, vínculo a paciente/cotización/plan), gastos, caja operativa (ingresos − gastos − insumos), convenios (tipo, descuento %, fijo o custom, vigencia; espejo en DentalCloud solo %), liquidaciones por profesional (ingresos elegibles → ítems con % o monto fijo; bruto − deducciones + bonos; estados DRAFT/READY/PAID; PDF).
13. **Inventario:** insumos por sede/consultorio con stock por lotes (número, fabricante, presentación, concentración, registro sanitario, recepción, vencimiento), movimientos IN/OUT/ADJUSTMENT, alertas de vencimiento, foto de insumo y de etiqueta (Cloudinary); cotizaciones de compra a proveedores (CPC-AAAA-N, RUT chileno, ítems existentes o nuevos, envío/descuento, comparación) → recepción (REC-AAAA-N) que crea insumos/lotes/movimientos. Accesible también por federación desde DentalCloud.
14. **Equipos:** inventario de equipamiento (área DENTAL/ESTHETIC/BOTH, estados, serie, tag, garantía, mantención, calibración, responsable, sala, foto).
15. **Simulación estética IA:** requiere consentimiento con propósito ESTHETIC_AI_SIMULATION; sube foto original (Cloudinary privado, URL firmada), genera con OpenAI `gpt-image-1` según 8 tipos de tratamiento (prompt fijo "subtle, realistic…"), límite diario 20; descartar/eliminar.
16. **Marketing IA:** brief → copy (OpenAI texto), imagen generada/editada (OpenAI imagen, moderación) o de biblioteca, editor de piezas (Konva) → campaña (DRAFT/READY/ARCHIVED, imágenes en Cloudinary) y "simulaciones" (galería Cloudinary). La publicación en redes está anunciada como futura.
17. **Reportes:** overview, finanzas, pacientes, tratamientos y **reporte detallado de citas** (asistencia, cancelación, no-show, demanda por día/franja, anticipación, motivos, reagendamientos, **demora en pasar a atender** = promedio de minutos entre `startAt` y el cambio a IN_PROGRESS, con exportación Excel/PDF).
18. **Auditoría:** `AuditLog` con ~150 acciones (categorías AUTH, PATIENT, CLINICAL_RECORD, ODONTOGRAM, CONSENT, TREATMENT_PLAN, STAFF, AGENDA, FINANCE, EQUIPMENT, INVENTORY, ESTHETIC_SIMULATION, PRIVACY, QUOTE, MARKETING…), IP hasheada con `AUDIT_IP_HASH_SECRET`, consultable por paciente y por usuario.

### 4.4 Integraciones externas

| Integración | Uso | Configuración |
|---|---|---|
| **DentalCloud (dentalcloud-backend)** | Federación bidireccional (sección 7) | `DENTALCLOUD_API_URL`, `FEDERATION_API_KEY`, `SUPERADMIN_FEDERATED_EMAIL` |
| **Stripe** | Suscripción SaaS de la clínica (checkout mensual/anual, portal, webhooks) | `STRIPE_*` (no en `.env.example`; documentadas en `docs/STRIPE_SETUP.md`) |
| **OpenAI** | Marketing (texto `gpt-5.4-mini`, imagen `gpt-image-2`, moderación) y simulación estética (`gpt-image-1`) | `OPENAI_*`, `ESTHETIC_AI_*` |
| **Cloudinary** (2 cuentas) | Marketing (campañas, simulaciones, biblioteca), etiquetas de lotes, simulación estética (privado/firmado); cuenta separada para fotos de insumos/equipos | `CLOUDINARY_*`, `CLOUDINARY_INVENTORY_*` |
| **Microsoft Graph** | Correos: confirmación de cita, seguimiento de cotización, solicitud de demo | `MS_GRAPH_*` |
| **Railway** | Hosting del backend y BD (scripts con guardas `--allow-railway`) | — |

### 4.5 Datos de demostración (seed y scripts)

`prisma/seed.js`: planes BASIC/PROFESSIONAL/ENTERPRISE, 10 feature modules, clínica "Clinica Dental Norte" (Chile, CLP), sede "Sede Chile", usuarios `admin@dentalos.com` (PLATFORM_ADMIN) y `clinica@demo.com` (CLINIC_OWNER), suscripción ENTERPRISE, un pago, un ticket, un snapshot de uso. Scripts: `seedDemoClinicData.js`, `seedDemoFinanceData.js`, `resetVisualDemoData.js`, `fillPresentationAgenda.js`, `enhancePresentationAgendaColors.js`, `fixVisualDemoSettlementTotals.js`, `enableEstheticAiSimulationDemo.js` (activa ESTHETIC_TREATMENTS + ESTHETIC_AI_SIMULATION para la clínica demo) — todos con confirmaciones explícitas.


## 5. Brechas: datos "sueltos" entre modelo, API y formularios

Leyenda: **BD sin UI** = el campo existe en Prisma pero ningún formulario del frontend lo carga (solo llega por seed/federación/backend); **UI sin BD** = el frontend captura o envía algo que el backend no guarda o rechaza; **Desajuste de clave** = el frontend envía un nombre distinto al que exige el validador zod `.strict()` (el backend responde 400 "Unrecognized key"/"requerido").

### 5.1 Campos del modelo que NO se pueden cargar desde ningún formulario (BD sin UI)

| Modelo.campo | Cómo se llena hoy | Observación |
|---|---|---|
| `Patient.heightCm`, `weightKg`, `allergies[]`, `allergyNotes`, `medicalConditions`, `currentMedications` | Solo por federación (`mirrorPatient`) o API directa | El modal de paciente **muestra y captura** estos 6 campos pero `buildPatientPayload` (`patientForm.js`) los descarta; existe `buildPayload` con ellos pero no se invoca. El panel lateral sí los muestra si vienen del backend. |
| `Patient.locationId` (cambio de sede) | Solo al crear (sede activa) | No hay selector de sede en el modal de paciente. |
| `Clinic.taxRatePercent` | Default 19; solo por BD | Ni el panel de plataforma ni Ajustes lo exponen; `updatePlatformClinicSchema` no lo acepta. Afecta el desglose de IVA de cotizaciones. |
| `Clinic.clinicType` | Solo en alta de clínica (plataforma) o `mirrorClinic` | No editable después (`PATCH /platform/clinics/:id` no lo acepta). |
| `Clinic.stripeCustomerId`, `Subscription.stripe*` | Webhook Stripe | Correcto (sistema). |
| `User.passwordHash` (cambio de contraseña) | Solo al crear el usuario | **No existe ningún endpoint** de cambio/reseteo de contraseña ni "olvidé mi contraseña". |
| `User.agendaColor` | Solo en "Editar personal" | No disponible al crear. |
| `User.federatedUserId`, `isFederationActor` | Federación | Sistema. |
| `Location.country/currency` distintos de la clínica | — | Forzados a los de la clínica; campos disabled en UI. |
| `ProfessionalAvailability.consultingRoom` | Solo API | El formulario "Horarios" **no tiene campo de consultorio/sala**, aunque "Mi horario" lo muestra y el validador lo acepta (lista fija de 7 consultorios). |
| `Appointment.cancellationReason`, `confirmedAt`, `completedAt` | Backend | `PATCH /appointments/:id/cancel` (con `cancellationReason`) existe pero la UI cancela vía `/status` con `reasonCode/reasonText`. |
| `Appointment.remoteProfessionalName`, `federatedAppointmentId` | Federación | Sistema. |
| `AppointmentStatusHistory.*` | Backend | Sistema (incluye reagendamientos). |
| `PatientReminder.appointmentId`, `treatmentPlanId`, `quoteId`, `contactedAt`, `completedAt` | Backend (automáticos) | El validador acepta `appointmentId/treatmentPlanId/contactedAt/completedAt` pero los modales manuales no los exponen; `quoteId` nunca se acepta por API (solo lo setea el seguimiento de cotizaciones). |
| `PatientReminder.reminderType = QUOTE_FOLLOW_UP` | Backend | No seleccionable en la UI (correcto). |
| `ClinicReminderRule.reminderType = CHECKUP`, `POST_TREATMENT` | API | El select de reglas solo ofrece 5 de los 7 tipos. |
| `ConsentTemplate.purposeType`, `effectiveFrom` | Solo API / script | **Crítico:** la Simulación estética IA exige un consentimiento con `purposeType = ESTHETIC_AI_SIMULATION`, pero el formulario de plantillas no permite fijar `purposeType` (siempre GENERAL). Solo `scripts/enableEstheticAiSimulationDemo.js` o la API lo crean. |
| `PatientConsent.patientNameSnapshot`, `patientRutSnapshot`, `expiresAt` (parcial) | Backend | Snapshots automáticos. |
| `PatientClinicalNote.appointmentId`, `professionalUserId` | API | Aceptados por el validador, sin campo en el modal de nota. |
| `TreatmentPlan.facialAnnotations` | **Solo federación** (`mirrorTreatmentPlan`) | Trazos a mano alzada del mapa facial: no hay herramienta de dibujo en Dental-Demo ni lo acepta `PUT /treatment-plans/:id`. |
| `TreatmentPlan.remoteProfessionalName`, `federatedTreatmentPlanId` | Federación | Sistema. |
| `TreatmentPlan.paymentMethod` | Solo al crear (paso 3) | "Editar plan" no lo expone y **no se muestra en ninguna pantalla**. |
| `TreatmentPlan.facialGender` | Toggle del mapa facial | No editable en "Editar plan". |
| `TreatmentPlanItemPhoto` (fotos Antes/Después) | **Solo federación** (`mirrorTreatmentItemPhoto`) | Solo lectura en Dental-Demo. |
| `TreatmentPlanItem.productLot` ↔ `ClinicSupplyLot` | Texto | Al elegir un lote real solo se copian nombre/lote/vencimiento; no se guarda `lotId` ni se descuenta stock. |
| `Quote.appointmentId`, `treatmentPlanId` | Siempre `null` | El payload los envía como `null`; no hay UI para vincular cotización con cita o plan. |
| `Quote.currency` | Backend (moneda de la clínica) | Correcto. |
| `ClinicIncome.appointmentId` | API | Aceptado por el validador; el modal de ingreso vincula paciente/cotización/plan pero no cita (la cobranza sí lo setea al pagar). |
| `ClinicExpense` (restaurar) | — | No hay endpoint ni UI de restauración de gastos (ingresos sí). |
| `ClinicSettlement.locationId` | Probablemente nunca | `Liquidaciones.jsx` deriva `activeLocation` de `user.clinic` (no del perfil), por lo que `locationId` casi nunca viaja. |
| `ClinicSettlement.items` (edición) | Solo al crear | `PUT /settlements/:id` no acepta `items`. |
| `ClinicSupply.currentStock` (edición) | Lotes/movimientos | En creación se fuerza `0`; en edición no se envía. |
| `ClinicSupplyLot.locationId`, `isActive` (archivar) | API | El lote hereda la sede del insumo; no hay UI para archivar lotes. |
| `ClinicSupplyLotMovement.movementType = ADJUSTMENT` | API / modal inaccesible | El `LotMovementModal` soporta "Ajustar stock" pero el menú de la UI solo ofrece Entrada/Salida. |
| `SupplyPurchaseReceiptItem.quantityReceived` ≠ cantidad cotizada | — | La recepción no permite editar cantidad ni costo (se recibe todo lo cotizado). |
| `ClinicEquipment.supplierName` | — | El formulario envía `supplier` (ver 5.3). |
| `MarketingCampaign.locationId` | — | El payload de campaña nunca lo envía. |
| `MarketingCampaign.baseImageBase64/finalImageBase64` | Legacy | Hoy se suben a Cloudinary y se guardan `*Url/*PublicId/*Bytes`. |
| `ModuleCustomizationRequest.estimated*Amount`, `resolvedAt` | Backend | Calculados. |
| `SupportTicket` (todo el modelo) | Solo `prisma/seed.js` | **No existe endpoint de creación/edición** (solo `GET /platform/support-tickets`); "Nuevo ticket interno" está deshabilitado. |
| `ClinicUsageSnapshot` (todo) | Solo seed | Sin endpoint de escritura ni job que lo calcule. |
| `Plan` (todo) | Solo seed | Sin CRUD ("Nuevo plan" deshabilitado). |
| `FeatureModule` (todo) | Solo seed | Sin CRUD; `ESTHETIC_AI_SIMULATION` ni siquiera está en el seed (lo crea el script demo). |
| `SubscriptionPayment` | Webhook Stripe / seed | Sin registro manual de pagos. |
| `ClinicDataRetentionPolicy` (todo) | **Ningún endpoint ni UI** | La anonimización de pacientes exige `allowAnonymizationAfterRetention = true`; sin escribir la fila directamente en BD la anonimización es imposible. |
| `AuditLog` | Backend | Sistema (correcto). |
| `FederationSyncFailure` | Backend | Sistema; no hay UI para ver/reintentar fallos de federación. |

### 5.2 Datos que el frontend captura/envía y el backend NO guarda (UI sin BD)

| Pantalla | Dato | Qué pasa |
|---|---|---|
| Pacientes → modal | Altura, Peso, Alergias, Detalle alergias, Condiciones médicas, Medicamentos | Se capturan y se pierden (no van en el payload). |
| Planes → "Nuevo procedimiento" (`ItemModal`) | "Notas clínicas" (`notes`) | No se incluye en el payload (en el asistente sí, como `description`). |
| Planes → asistente | `lot.id` del lote elegido, `odontogramMode`, `odontogramSelection` | Se eliminan antes de enviar; el odontograma se persiste solo como texto en `tooth`. |
| Cotizaciones → detalle | "Observaciones para el paciente", "Cobertura del paciente" (Fonasa/Isapre/Otro, monto/porcentaje, referencia) | Solo `?devPreview=1` en build DEV; no se envían. |
| Cotizaciones → ítems | `unit`, `availableStock`, `id` del ítem | No se envían (el backend reemplaza la lista). |
| Marketing IA → brief | `tone`, `offer`, `clinicName`, `locationName`, `additionalInstructions` | Solo viajan a `generate-copy`; la campaña guardada no los persiste (al reabrir se pierden). |
| Marketing IA → editor | Logo (archivo) | Solo en memoria; `editorState` guarda posición/opciones pero no la imagen. |
| Marketing IA → edit-image | `containsPatient` | Bloquea "Guardar simulación" pero no se persiste en la campaña. |
| Liquidaciones | `settlementType`, `bulkPercentage` | Locales. |
| Sedes → "Cambio de moneda referencial" | monto/monedas | Calculadora local. |
| Agenda | `baseDuration` ("min base") | Control sin efecto. |
| Personal | `estheticFilter` | Filtro solo en cliente. |
| Alta de clínica (plataforma) | `adminPasswordConfirm` | Solo validación local (correcto). |
| Nómina, Reloj checador, Usuarios org/sede, Cargos, Documentos, Especialidades, Honorarios, Outbox, Precios, Recordatorios (ajustes), WhatsApp | todos sus "formularios" | Mock estático: ningún dato llega al backend. |

### 5.3 Desajustes de claves frontend ↔ validador (el backend rechaza con 400)

| Pantalla → endpoint | Frontend envía | Backend (zod `.strict()`) espera | Efecto |
|---|---|---|---|
| Recordatorios (`ReminderModal`) y Ficha clínica (`ReminderQuickModal`) → `POST/PUT /api/clinic/reminders` | `type`, `targetDate` | `reminderType`, `dueDate` | Claves no reconocidas y `dueDate` requerido → **la creación/edición manual de recordatorios falla** (el controlador no mapea). Los automáticos (citas completadas, seguimiento de cotizaciones) sí funcionan. |
| Personal → activar/desactivar → `PATCH /api/clinic/staff/:id/status` | `{ status: 'ACTIVE' \| 'INACTIVE' }` | `{ active }` o `{ isActive }` (booleano) | 400 "active o isActive es requerido". |
| Equipos → `POST/PATCH /api/clinic/equipment` | `supplier` | `supplierName` | 400 cuando el proveedor no está vacío. |
| Recordatorios → "Nueva regla" → `POST /api/clinic/reminders/rules` | `isActive: true/false` | no acepta `isActive` en creación (solo en `PATCH /:id/status`) | 400. En edición (`PUT`) tampoco lo acepta. |
| Recordatorios → regla `priority = URGENT` | `URGENT` | enum `LOW/NORMAL/HIGH` | 400. |
| Recordatorios → regla `reminderType` | 5 opciones | 7 en backend | Faltan CHECKUP y POST_TREATMENT en la UI. |
| Recordatorios → `deletePatientReminder` (servicio, no usado) | `DELETE /api/clinic/reminders` body `{id}` | `DELETE /api/clinic/reminders/:id` | Ruta incorrecta si se llegara a usar. |
| Cotizaciones (listado) → cancelar ACCEPTED | `{ status: 'CANCELLED' }` sin `reason` | `reason` obligatorio para ACCEPTED | 400 `QUOTE_CANCEL_REASON_REQUIRED` (el detalle sí pide motivo). |
| Convenios → "Sin descuento" | `discountType: undefined` | — | En PUT no limpia el tipo anterior (no hay forma de quitar un descuento). |
| Cotizaciones/Planes → vaciar `notes`/campos | clave omitida | — | `buildQuotePayload`/`buildPatientPayload` omiten vacíos: no se puede borrar un valor existente. |
| Plataforma → Soporte | filtros `status`/`priority` con etiquetas en español ("Abierto", "Alta") | enums `OPEN…`, `LOW…` | El filtro remoto no coincide (se compensa filtrando en cliente). |

### 5.4 Endpoints del backend que ningún componente del frontend invoca

`PATCH /agenda/appointments/:id/cancel`; `GET /agenda/appointments/:id`; `GET /agenda/appointments/daily-summary`; `GET /reminders/:id`; `DELETE /reminders/:id`; `GET /consent-templates/:id`; `DELETE /consent-templates/:id`; `GET /clinical-records/patients/:id/odontogram/:entryId`; `PUT …/odontogram/:entryId` (la UI edita vía POST upsert); `PATCH /marketing-campaigns/:id/status`; `POST /marketing-media/upload`; `DELETE /equipment/:id/photo`; `DELETE /finance/supplies/:supplyId/photo`; `DELETE /consulting-rooms/:id` (se usa `PATCH /archive`); `GET /platform/federated/overview`; `GET /platform/clinics/:id/payments|support-tickets|usage`; `GET /clinic/locations/:id` (solo en Sedes); `GET /esthetic-simulations` desde Ficha clínica; parámetros soportados sin UI: `consentStatus`, `professionalId`, `sort/order` en pacientes; `search`, `period`, `locationId` en liquidaciones; `createdByUserId` en cotizaciones; `type`, `priority`, `search` en recordatorios; `locationId` en caja operativa.

### 5.5 Otras inconsistencias relevantes

1. **Dos odontogramas** no relacionados: el de la ficha (piezas 11–48, superficies `GENERAL/O/M/D/V/L/P/MOD`, 12 condiciones, tabla `PatientOdontogramEntry`) y el de planes (piezas 1.1–8.5 con temporales, 5 caras, 7 modos, persistido como texto en `TreatmentPlanItem.tooth`).
2. **Dos modelos de alergias**: `Patient.allergies[]` (vocabulario fijo de 9, no persistible desde UI) vs `PatientClinicalRecord.allergies` (texto libre en la ficha).
3. **Consultorios**: la agenda usa una lista fija de `box` (Box 1–5, Sala RX, Pabellón menor) en texto; Sedes administra `ClinicConsultingRoom` (tabla real) que solo usan Equipos y planes estéticos; insumos y horarios usan otra lista fija (Consultorio 1–5, Sala RX, Pabellón menor).
4. **Género**: `Patient.gender` (FEMALE/MALE/OTHER, mostrado sin traducir) no alimenta `TreatmentPlan.facialGender` (mujer/hombre).
5. **Zonas faciales** guardadas como labels en español en el campo `tooth` (frágil ante cambios de texto).
6. **Mapa facial**: capa "Músculos" deshabilitada aunque las imágenes existen; sin dibujo (las anotaciones solo se ven si vienen de DentalCloud).
7. **Monitor de sala**: KPI "Espera prom." es un `—` fijo; la única métrica real de demora es "Demora en pasar a atender" del reporte detallado.
8. **Prestación fuera de catálogo** inalcanzable en el asistente e `ItemModal` (sin catálogo, no se puede agregar ítems).
9. **Editar ítem dental** limpia la selección de piezas (`ItemToothField` monta vacío y sobrescribe `tooth`).
10. **Módulo `ESTHETIC_AI_SIMULATION`** no está en `prisma/seed.js` (solo el script demo lo crea) pero sí en la UI de suscripción y en las rutas.
11. **Plan por defecto** en alta de clínica limitado a `publicVisible` (solo PROFESSIONAL en el seed).
12. **Marca inconsistente**: "fordentcloud" (login), "DentalCloud" (layout), "DentalOS" (API/paquete), "zydent" (Header legacy sin uso).
13. **`Inventario.jsx`** (hub) huérfano; `adminMock.js`, `Stub.jsx`, `Topbar/Header/BottomNav` código muerto; `finanzasUtils.js` con mocks y 7 monedas sin uso.
14. Textos y confirmaciones hardcodeados en español fuera de `t()` en Finanzas/Inventario/Liquidaciones; textos sin tilde en Horarios ("Miercoles", "termino").
15. `Clinic.clinicType` se escribe con SQL crudo por un cliente Prisma no regenerado (TODO en `platform.controller.js`).


## 6. Variables de entorno (solo nombres, de `.env.example`) y su uso

### 6.1 Frontend (`Dental-Demo/.env.example`)

| Variable | Uso en código |
|---|---|
| `VITE_API_URL` | Origen del backend (`src/services/api.js`). En producción es obligatoria (error "VITE_API_URL no está configurada"); en dev, si falta, se detecta automáticamente `http://localhost:4001` → `4000` probando `GET /api/health`. Valor de ejemplo: `https://dental-demo-back-production.up.railway.app`. |

### 6.2 Backend (`Dental-Demo-Back/.env.example`)

| Variable | Uso en código | Obligatoria |
|---|---|---|
| `DATABASE_URL` | Prisma / PostgreSQL (`schema.prisma`) | **Sí** (`validateEnv`) |
| `JWT_SECRET` | Firma/verificación del JWT (`utils/jwt.js`) | **Sí** |
| `AUDIT_IP_HASH_SECRET` | HMAC de la IP en `AuditLog.ipHash` (`utils/auditHttp.js`) | No |
| `PORT` | Puerto HTTP (default 4000; fallback 4001 si está ocupado) | No |
| `FRONTEND_URL` | Orígenes CORS permitidos (lista separada por comas; default `http://localhost:5173`) | No |
| `DENTALCLOUD_API_URL` | Base URL de dentalcloud-backend para la federación (`lib/federationClient.js`) y para el login delegado del super-admin | No (sin ella la federación se omite) |
| `FEDERATION_API_KEY` | Header `X-API-KEY` saliente hacia DentalCloud y validación de las llamadas entrantes `/api/platform/federated/*` y `GET /clinics|/patients|/appointments` (`federationOrPlatformManage.middleware.js`) | No |
| `SUPERADMIN_FEDERATED_EMAIL` | Email cuyo login se valida contra DentalCloud en vez del hash local (`auth.controller.js`) | No |
| `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_SENDER` | Envío de correos vía Microsoft Graph (`lib/mailer.js`): confirmación de citas, seguimiento de cotizaciones, solicitud de demo. Si falta alguna, el envío se omite. | No |
| `OPENAI_API_KEY` | Cliente OpenAI (`config/openai.js`) — Marketing IA y Simulación estética | No (503 si se usa sin configurar) |
| `OPENAI_IMAGE_MODEL` | Modelo de imagen marketing (default `gpt-image-2`) | No |
| `OPENAI_TEXT_MODEL` | Modelo de texto marketing (default `gpt-5.4-mini`) | No |
| `OPENAI_IMAGE_SIZE` | Tamaño de imagen por defecto (`1024x1024`) | No |
| `OPENAI_IMAGE_QUALITY` | Calidad por defecto (`medium`) | No |
| `OPENAI_MAX_UPLOAD_MB` | Tamaño máximo de imagen subida a `edit-image` (default 10) | No |
| `ESTHETIC_AI_PROVIDER` | Proveedor de simulación estética (solo `openai`) | No |
| `ESTHETIC_AI_MODEL` | Modelo (default `gpt-image-1`) | No |
| `ESTHETIC_AI_QUALITY` | Calidad (default `medium`) | No |
| `ESTHETIC_AI_SIZE` | Tamaño (default `1024x1024`) | No |
| `ESTHETIC_AI_TIMEOUT_MS` | Timeout de generación (default 150000) | No |
| `ESTHETIC_AI_DAILY_LIMIT` | Límite diario de generaciones por clínica (default 20) | No |
| `ESTHETIC_SIMULATION_STORAGE_MODE` | Tipo de entrega Cloudinary de las fotos de simulación: `private` (default) o `authenticated` | No |
| `ESTHETIC_SIMULATION_SIGNED_URL_TTL_SECONDS` | Vigencia de las URLs firmadas de simulación | No |
| `CLOUDINARY_URL` / `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Cuenta Cloudinary principal (marketing, simulaciones de marketing, etiquetas de lotes, simulación estética) — `config/cloudinary.js` | No (503 `CLOUDINARY_CONFIGURATION_MISSING`) |
| `CLOUDINARY_MARKETING_FOLDER` | Carpeta base de marketing en Cloudinary (`services/marketingMedia.service.js`) | No |
| `MARKETING_SIMULATION_MAX_UPLOAD_MB` | Tamaño máximo de simulaciones de marketing | No |
| `CLOUDINARY_INVENTORY_CLOUD_NAME` / `CLOUDINARY_INVENTORY_API_KEY` / `CLOUDINARY_INVENTORY_API_SECRET` | Segunda cuenta Cloudinary exclusiva para fotos de insumos y equipos (`config/cloudinaryInventory.js`) | No |

### 6.3 Variables usadas por el código pero **ausentes** en `.env.example`

| Variable | Uso |
|---|---|
| `BACKEND_URL` | `config/env.js` (referenciada; no consumida activamente) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_YEARLY`, `STRIPE_CUSTOMER_PORTAL_RETURN_URL`, `STRIPE_CHECKOUT_SUCCESS_URL`, `STRIPE_CHECKOUT_CANCEL_URL` | Facturación Stripe (`config/stripe.js`, `services/stripeBilling.service.js`); documentadas en `docs/STRIPE_SETUP.md`. `GET /api/clinic/billing/stripe/status` informa cuáles faltan. |
| `ESTHETIC_SIMULATION_MAX_UPLOAD_MB` | Límite de subida de la foto original de simulación estética (default 10) |
| `NODE_ENV` | Cookies seguras, Bearer solo en dev, logs |
| `PROFILE_TIMING_LOGS` | Logs de tiempos en auth/perfil |


## 7. Conexión con DentalCloud (federación)

Fuente: `src/lib/federationClient.js`, `federationSync.js`, `federationRetry.js`, `federationInventoryActor.js`, `middlewares/federationOrPlatformManage.middleware.js`, `controllers/platform.controller.js` (`mirror*`), `controllers/federatedInventory.controller.js`, `controllers/auth.controller.js`.

### 7.1 Qué es

DentalCloud es **otro producto** de la misma organización (repos `dentalcloud-backend` TypeScript y `dentalcloud-front`, referenciados en comentarios y en `.claude/settings.json`). Dental-Demo/DentalOS actúa como "backoffice extendido" y ambos sistemas **espejan** entidades entre sí para compartir pacientes, agenda, presupuestos, catálogos e inventario. La sincronización es **best-effort y asíncrona**: nunca bloquea la operación local; los fallos se encolan en `FederationSyncFailure` y se reintentan cada 5 minutos (máximo 10 intentos, 50 filas por barrido) releyendo el estado local vigente.

### 7.2 Autenticación

| Dirección | Mecanismo |
|---|---|
| Dental-Demo → DentalCloud | `fetch("${DENTALCLOUD_API_URL}/api/...")` con header `X-API-KEY: FEDERATION_API_KEY` |
| DentalCloud → Dental-Demo | Rutas `/api/platform/federated/*` y `GET /api/platform/clinics|patients|appointments` aceptan `X-API-KEY = FEDERATION_API_KEY` (middleware `federationOrPlatformManage`); si no viene la key exigen sesión + PLATFORM_MANAGE |
| Login del super-admin | Si `email === SUPERADMIN_FEDERATED_EMAIL`, la contraseña se valida con `POST ${DENTALCLOUD_API_URL}/api/auth/login` (sin API key) |
| Escrituras de inventario entrantes | Se atribuyen a un usuario bot por clínica: "Bot de integración DentalCloud" (`federacion+<clinicId>@dentalcloud-demo.internal`, rol ASSISTANT, `isFederationActor = true`, permisos INVENTORY_* solo en memoria) |

`isFederationConfigured()` = `DENTALCLOUD_API_URL` y `FEDERATION_API_KEY` presentes; si no, todos los sync se omiten silenciosamente.

### 7.3 Identificadores cruzados

| Modelo local | Campo espejo | Modelo DentalCloud |
|---|---|---|
| Clinic | `federatedClinicaId` | Clinica |
| Location | `federatedLocationId` | Sucursal |
| User | `federatedUserId` | User |
| Patient | `federatedPatientId` | Patient |
| Appointment | `federatedAppointmentId` | Appointment |
| TreatmentPlan | `federatedTreatmentPlanId` | TreatmentPlan |
| TreatmentPlanItem | `federatedTreatmentItemId` | TreatmentItem |
| TreatmentPlanItemPhoto | `externalId` | TreatmentItemPhoto |
| ClinicAgreement | `federatedConvenioId` | Convenio |
| Prestacion | `federatedPrestacionId` | Prestacion |
| Prevision | `federatedPrevisionId` | Prevision |

### 7.4 Salida: qué envía Dental-Demo a DentalCloud (`federationSync.js` → `federationClient.js`)

| Disparador local | Función | Endpoint remoto | Payload |
|---|---|---|---|
| Alta de clínica (plataforma) | `syncClinicToFederation` | `POST /api/clinicas/federated/mirror` | `externalId, name, pais, clinicType (DENTAL/ESTHETIC/BOTH), adminName, adminEmail, adminPassword` (contraseña en claro solo en el primer intento) |
| Suspender/reactivar/activar suscripción | `syncClinicStatusToFederation` | idem | `externalId, name, active` (ACTIVE/TRIAL → true) |
| Crear sede (plataforma o Ajustes) | `syncLocationToFederation` | `POST /api/clinicas/federated/sucursales/mirror` | `clinicaId, externalId, name, active` |
| Crear personal PROFESSIONAL con `supportsEstheticTreatments` | `syncStaffToFederation` | `POST /api/clinicas/federated/users/mirror` | `clinicaId, externalId, name, email, role (vocabulario local), password` |
| Crear/editar/archivar paciente | `syncPatientToFederation` | `POST /api/clinicas/federated/patients/mirror` | `clinicaId, externalId, firstName, lastName, rut, email, phone, birthDate, heightCm, weightKg, allergies[], allergyNotes, medicalConditions, currentMedications` |
| Crear/editar cita | `syncAppointmentToFederation` | `POST /api/clinicas/federated/appointments/mirror` | `clinicaId, patientId (remoto), externalId, startAt, endAt, status (enum local), notes` (si el paciente aún no tiene espejo, queda pendiente) |
| Crear/editar/estado/archivar plan | `syncTreatmentPlanToFederation` | `POST /api/clinicas/federated/treatment-plans/mirror` | `patientId (remoto), externalId, title, description, planType, facialGender, status ("alta" solo si COMPLETED/ARCHIVED), convenioId?, previsionId?, professionalName` |
| Crear/editar/estado/cancelar ítem | `syncTreatmentPlanItemToFederation` | `POST /api/clinicas/federated/treatment-plans/items/mirror` | `treatmentPlanId (remoto), externalId, name, description, tooth, unitPrice (= totalPrice), completed, prestacionId?, listPrice×qty, convenioDiscountPercent, productName, productLot, productExpiresAt, productQuantity` — o `{ removed: true }` si CANCELLED |
| Crear/editar/archivar convenio | `syncAgreementToFederation` | `POST /api/clinicas/federated/convenios/mirror` | `clinicaId, externalId, name, discountPercent (solo si PERCENTAGE, si no 0), active` |
| Crear/editar/archivar prestación | `syncPrestacionToFederation` | `POST /api/clinicas/federated/prestaciones/mirror` | `clinicaId, externalId, name, code, basePrice, active, odontogramMode, requiresProductTracking` |
| Crear/editar/archivar previsión | `syncPrevisionToFederation` | `POST /api/clinicas/federated/previsiones/mirror` | `clinicaId, externalId, name, active` |
| Panel de plataforma "overview federado" | `fetchRemoteClinics/Patients/Appointments` | `GET /api/clinicas`, `GET /api/clinicas/pacientes`, `GET /api/clinicas/citas` | lectura (endpoint `GET /api/platform/federated/overview`, sin UI actual) |

Tipos de entidad en la cola de reintentos: CLINIC, CLINIC_STATUS, PATIENT, USER, LOCATION, APPOINTMENT, TREATMENT_PLAN, TREATMENT_ITEM, TREATMENT_ITEM_REMOVAL, CONVENIO, PRESTACION, PREVISION.

### 7.5 Entrada: qué recibe Dental-Demo desde DentalCloud (`/api/platform/federated/*`, X-API-KEY)

| Endpoint | Efecto local |
|---|---|
| `POST /clinics/mirror` | Crea/actualiza `Clinic` (moneda USD por defecto, contacto del admin) y, si es nueva, el usuario CLINIC_OWNER con la misma contraseña |
| `POST /locations/mirror` | Crea/vincula `Location` |
| `POST /users/mirror` | Crea/vincula `User` (admin→CLINIC_OWNER, odontologo→PROFESSIONAL/DENTIST, radiologo→PROFESSIONAL/OTHER, operador→RECEPTIONIST); asigna sede "Sede federada" si el rol la requiere |
| `POST /patients/mirror` | Crea/actualiza `Patient` (incluye antecedentes médicos y alergias) |
| `POST /appointments/mirror` | Crea/actualiza `Appointment` (estados agendada/llego/en_atencion/finalizada/cancelada → SCHEDULED/CONFIRMED/IN_PROGRESS/COMPLETED/CANCELLED) y registra `AppointmentStatusHistory` con `metadata.source = "federation"` para que las citas espejadas entren en el reporte de **demora en atención** |
| `POST /treatment-plans/mirror` | Crea/actualiza/archiva `TreatmentPlan` (estados en_tratamiento/terminado/alta → IN_PROGRESS/COMPLETED); **única vía para `facialAnnotations`** y `remoteProfessionalName` |
| `POST /treatment-plans/items/mirror` | Crea/actualiza/borra `TreatmentPlanItem` y recalcula `estimatedTotal` |
| `POST /treatment-plans/items/photos/mirror` | Upsert/borrado de `TreatmentPlanItemPhoto` (URL pública de Cloudinary de DentalCloud) |
| `POST /agreements/mirror`, `/prestaciones/mirror`, `/previsiones/mirror` | Crea/vincula catálogos (por nombre/código si ya existían localmente) |
| `GET /supply-lots?clinicaId&search` | Búsqueda en vivo de lotes con stock para que el profesional en DentalCloud elija un lote real al presupuestar |
| `GET/POST/PATCH /inventory/supplies…`, `/lots…`, `/movements`, `/alerts` | CRUD completo de inventario desde DentalCloud, ejecutado como el bot de integración y auditado con `metadata.source = "dentalcloud-federation"` |
| `GET /clinics`, `/patients`, `/appointments` | Listados globales para DentalCloud |

### 7.6 Convenciones compartidas (deben mantenerse en sync manualmente)

- Vocabulario de alergias (`ALLERGY_KEYS`) idéntico a `dentalcloud-backend/src/lib/allergies.ts`.
- Modos de odontograma y palabras clave (`lib/odontogramMode.js` ↔ `odontogramMode.ts` / `odontogramConfig.ts`).
- Zonas y anotaciones del mapa facial (`FacialAnnotations` en `facialZoneConfig.ts`).
- Correos con el mismo estilo visual y el mismo remitente Microsoft Graph que dentalcloud-backend.
- Variables `FRONTEND_URL` (lista) y `MS_GRAPH_*` reutilizan el patrón de dentalcloud-backend.

### 7.7 Limitaciones conocidas de la federación

- No hay federación de cuentas de staff en general (solo profesionales estéticos): los planes y citas que nacen en DentalCloud guardan solo el **nombre** del profesional (`remoteProfessionalName`).
- DentalCloud no tiene cantidad por ítem (se colapsa `quantity × unitPrice`), ni estados PROPOSED/ACCEPTED/CANCELLED de plan, ni descuentos fijos/custom de convenio (viajan como 0 %).
- Las fotos de ítems y las anotaciones faciales solo fluyen DentalCloud → Dental-Demo.
- Un paciente sin RUT puede no espejarse (DentalCloud lo exige).
- No existe UI para ver la cola `FederationSyncFailure`; los errores solo quedan en logs.


