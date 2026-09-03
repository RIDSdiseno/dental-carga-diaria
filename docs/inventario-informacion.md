# Inventario de información: DentalCloud y Dental-Demo

> Documento consolidado a partir de los análisis técnicos `docs/analisis-dentalcloud.md` (1.485 líneas) y `docs/analisis-dentaldemo.md` (2.904 líneas), ambos fechados 2026-09-03. Está escrito para personas de negocio/producto y responde a la pregunta **"¿qué información se puede agregar a cada aplicación, sin dejar ningún dato suelto?"**. Su uso previsto es guiar la carga de datos de prueba realistas por la interfaz web (10 clínicas y 300 pacientes diarios).
>
> Reglas de lectura: todo lo que aquí se afirma proviene de esos dos análisis. Cuando algo no pudo confirmarse se marca como **"a verificar en la web"**. No se incluyen valores de secretos ni de variables de entorno.
>
> Convenciones de las tablas de campos: **Campo** = etiqueta que ve el usuario en pantalla; **Tipo de dato** = tipo de control/valor; **Obligatorio** = Sí/No según la validación del formulario o del servidor; **Valores posibles o formato** = todas las opciones del selector o el formato aceptado; **Notas** = reglas, dependencias, destino en base de datos cuando ayuda, y advertencias.

---

## 1. Resumen en una página

### 1.1 Qué es cada plataforma

| Aspecto | DentalCloud ("fordentcloud") | Dental-Demo ("forDentalCloud" / "DentalOS") |
|---|---|---|
| Qué es | Plataforma clínica para **holdings** odontológicos/estéticos: ficha de paciente, agenda por sillón, presupuestos con odontograma o mapa facial, evoluciones clínicas, cartola (cuenta corriente del paciente), consentimientos informados firmados, documentos clínicos, órdenes radiológicas (RIDS RX) e inventario (que vive en Dental-Demo) | SaaS multi-clínica que funciona como **backoffice extendido**: sedes, personal con permisos granulares, pacientes, ficha clínica y odontograma, planes de tratamiento, cotizaciones → cobranza → ingresos, finanzas (gastos, caja, convenios, liquidaciones), inventario con lotes y compras, equipos, simulación estética con IA, marketing con IA, reportes, privacidad/auditoría y un panel de plataforma (suscripciones, Stripe) |
| Frontend público | https://dentalcloudia.netlify.app | https://dentalaicloud.netlify.app (URL indicada por el equipo; el repositorio no la contiene, solo un `_redirects` tipo Netlify) |
| Backend público | https://dentalcloud-backend-production.up.railway.app (API bajo `/api`) | https://dental-demo-back-production.up.railway.app (API bajo `/api`) |
| Tecnología | React 19 + TypeScript (Vite) · Node + Express 5 + Prisma 6 · PostgreSQL | React 19 + JavaScript (Vite) · Node + Express 4 + Prisma 5 + zod · PostgreSQL |
| Entidad raíz (tenant) | `Clinica` = **Holding** en la UI; sus sedes son `Sucursal` (llamadas "Clínicas" en el catálogo) | `Clinic` = **Clínica**; sus sedes son `Location` (**Sedes**) |
| Tipos de clínica | `dental`, `estetica`, `ambas` (cambia tema visual, odontograma vs. mapa facial y pestañas) | `DENTAL`, `ESTHETIC`, `BOTH` |
| Roles | `super_admin` (plataforma), `admin` (holding), `odontologo`, `radiologo`, `operador` | `PLATFORM_ADMIN` (plataforma), `CLINIC_OWNER` (administrador general), `LOCATION_MANAGER` (administrador de sede), `MARKETING_MANAGER`, `PROFESSIONAL`, `RECEPTIONIST`, `ASSISTANT` |
| Cómo se controla el acceso | 3 capas: plan de módulos del holding (8 módulos + Rx) → matriz de permisos por perfil (10 llaves) → excepciones por usuario (hereda / sí / no) | 58 permisos por rol + 22 permisos otorgables por usuario + visibilidad de 12 módulos de menú (permitir/denegar) + "features" contratadas por suscripción + alcance por sede asignada |
| Archivos | Cloudinary (fotos, logos, firmas, documentos, PDF, audio) | Cloudinary (2 cuentas: general e inventario/equipos) |
| Correo | Microsoft Graph (confirmación de cita, consentimientos, cartola) | Microsoft Graph (confirmación de cita, seguimiento de cotización, solicitud de demo) |
| Integraciones externas | RIDS RX / DIMAGE (órdenes Rx), S3/MinIO de RIDS RX (visor DICOM 3D), Dental-Demo (federación) | Stripe (suscripción SaaS), OpenAI (marketing y simulación estética), DentalCloud (federación) |
| Autenticación | Correo + contraseña; sin recuperación de contraseña | Correo + contraseña; sin recuperación ni cambio de contraseña |

### 1.2 Cómo se conectan (federación)

- Ambos backends se **espejan mutuamente** con una clave compartida (cabecera `X-API-KEY`). Cada entidad espejada guarda el identificador del par en una columna `federated…Id` (holding↔clínica, sucursal↔sede, usuario, paciente, cita, presupuesto/plan, ítem, foto de ítem, convenio, prestación, previsión).
- La sincronización es **best-effort y asíncrona**: nunca bloquea la operación local; los fallos se encolan (`FederationSyncFailure`) y se reintentan cada 5 minutos, máximo 10 intentos. **Ninguna de las dos aplicaciones tiene pantalla para ver o reintentar esos fallos.**
- **Los interruptores viven en DentalCloud** (super-admin → detalle del holding): Conectada/No conectada, Conexión activa (pausa), "Solo catálogo" (solo convenios/prestaciones/previsiones) y 6 conexiones individuales (Pacientes, Citas, Presupuestos y tratamientos, Profesionales, Sucursales, Catálogo). Al conectar manualmente un holding arranca en **"Solo catálogo"**. Dental-Demo no tiene interruptores: sincroniza siempre que la clínica tenga par y la federación esté configurada.
- **El inventario existe solo en Dental-Demo**: DentalCloud lo lee y escribe en vivo (insumos, lotes, movimientos, alertas) a través de la federación y lo usa para elegir "lote real" al presupuestar prestaciones con trazabilidad.
- **Roles en el ecosistema**: DentalCloud es la operación clínica del holding (ficha, agenda por sillón, presupuestos, evoluciones, cartola, consentimientos firmados, Rx); Dental-Demo es la administración y las finanzas (sedes, personal, cotizaciones, cobranza, ingresos/gastos, liquidaciones, inventario, equipos, marketing, reportes, suscripción SaaS). El super-admin de Dental-Demo puede validar su contraseña contra DentalCloud (login delegado).
- El detalle campo a campo está en la sección 4.

### 1.3 Tabla de conteos

| Indicador | DentalCloud | Dental-Demo |
|---|---|---|
| Modelos de base de datos (tablas Prisma) | 25 | 58 |
| Enums de base de datos | 0 (≈43 conjuntos de valores validados en código) | 52 (+ ≈20 vocabularios fijos en código) |
| Endpoints REST | ≈148 (21 routers, prefijo `/api`) | ≈250 (prefijo `/api`) |
| Pantallas (rutas del frontend) | 14 rutas (la ficha de paciente tiene 9 pestañas; el catálogo 5) | ≈60 rutas (≈12 son maquetas sin backend) |
| Formularios / modales que cargan datos | ≈36 | ≈60 (más ≈12 maquetas que no guardan nada) |
| Campos cargables por pantalla (aprox., sin contar repeticiones) | ≈240 | ≈400 |
| Campos que existen pero no se pueden cargar por pantalla ("sueltos") | ≈35 casos (sección 5.1) | ≈55 casos + 9 desajustes que devuelven error 400 + 12 pantallas maqueta (sección 5.2) |
| Campos de paciente cargables al 100% por la web | Sí (29 campos en 2 pasos: modal + ficha) | No: 9 de 15 campos del modal se guardan; 6 antecedentes médicos se pierden (se completan vía federación desde DentalCloud) |

---
## 2. DentalCloud: qué se puede cargar por pantalla

Mapa de pantallas: `/login`, `/` (Dashboard, solo maqueta), `/agenda` (agenda general por sillón), `/agenda/sillones-libres`, `/agenda/diaria`, `/pacientes` (listado), `/pacientes/:id` (ficha con pestañas Datos paciente · Horas · Tratamientos · Evoluciones · Cartola · Observaciones · Documentos clínicos · Módulo Rx · Consentimientos), `/profesionales` (admin), `/catalogo` (admin; pestañas Prestaciones · Convenios · Previsiones · Clínicas · Inventario), `/admin/clinicas` y `/admin/clinicas/:id` (super-admin), `/admin/modulos/:moduleKey` (super-admin), `/consentimiento/:token` (pública), `/terminos` (en construcción). La barra superior tiene un buscador global de pacientes (≥2 caracteres).

Las pestañas de la ficha y los menús se muestran solo si el módulo está habilitado en el plan del holding **y** el perfil/usuario tiene el permiso correspondiente. `admin` y `super_admin` siempre tienen acceso total.

### 2.1 Holdings y sucursales ("Clínicas")

#### 2.1.1 Crear holding
- **Rol:** `super_admin`. **Pantalla:** `/admin/clinicas` → botón "Crear holding" (modal). Crea el holding y su usuario administrador en una sola operación y, si la federación está configurada, lo espeja en Dental-Demo.

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Logo del holding | Archivo imagen (png / jpeg / webp, ≤ 5 MB) | No | — | Se puede reemplazar después desde el detalle del holding |
| Nombre del holding | Texto | Sí | — | El nombre **no** se puede editar después desde la pantalla de detalle (ver 5.1) |
| RUT | Texto con autoformato `12.345.678-9` | No | RUT chileno válido (módulo 11); único entre holdings | Se guarda limpio (sin puntos ni guion) |
| Tipo | Selección | Sí | Dental · Estética facial · Dental y estética | Define tema (azul/rosado), odontograma vs. mapa facial y pestañas |
| País | Selección | Sí | Chile · Argentina · Perú · Colombia · México · Bolivia · Ecuador · Uruguay · Paraguay · Venezuela · España · Estados Unidos · Otro | Default Chile |
| Administrador inicial · Nombre completo | Texto | Sí | — | Crea el usuario con rol `admin` |
| Administrador inicial · Correo electrónico | Correo | Sí | Único en toda la plataforma (todas las clínicas) | Se guarda en minúsculas |
| Administrador inicial · Contraseña | Contraseña | Sí | Mínimo 8 caracteres | No existe cambio de contraseña posterior |

#### 2.1.2 Sucursales del holding (pestaña "Clínicas" del catálogo)
- **Rol:** `admin`. **Pantalla:** `/catalogo` → pestaña "Clínicas". Alta inline y tabla. Una sucursal es obligatoria para crear presupuestos ("Clínica" del paso 1) y para crear órdenes Rx.

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre | Texto | Sí | Único por holding | Editable inline después de crear; al crear se espeja en Dental-Demo como Sede (los cambios posteriores **no** se espejan) |
| Dirección | Texto | No | — | Solo al crear; la tabla la muestra pero no permite editarla |
| Activa | Interruptor | — | Sí / No | Las inactivas no aparecen en los selectores |
| ID clínica en RIDS RX | Texto | No | Identificador de la clínica en RIDS RX/DIMAGE | Se carga en **Ficha de paciente → pestaña Módulo Rx → "Configuración de integración RIDS RX"** (un input por sucursal, guarda al salir del campo), no desde el catálogo. Sin él no se pueden crear órdenes Rx en esa sucursal |

Eliminar una sucursal falla si tiene presupuestos asociados (se sugiere desactivarla).

#### 2.1.3 Configuración de agenda del holding
- **Rol:** `admin`. **Pantalla:** `/agenda` o `/agenda/sillones-libres` → control "Duración del bloque".

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Duración del bloque de agenda | Selección | Sí | 15 · 30 · 60 minutos | Define el paso de la grilla (08:00–20:00) y filtra las duraciones de cita disponibles (15/30/45/60/90 que sean múltiplos del bloque) |

### 2.2 Usuarios y profesionales

- **Rol:** `admin`. **Pantalla:** `/profesionales`. Tabla de usuarios del holding con RUT editable inline y botones "Permisos" y "Horario" por usuario; botones superiores "Importar desde RIDS RX" (si el holding tiene Rx) y "Agregar profesional"; debajo, panel "Permisos por perfil".

#### 2.2.1 Agregar profesional (modal)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre completo | Texto | Sí | — | No editable después de crear |
| Correo electrónico | Correo | Sí | Único en toda la plataforma | No editable después |
| Contraseña | Contraseña | Sí | Mínimo 8 caracteres | No hay cambio de contraseña posterior |
| Rol | Selección | Sí | Odontólogo · Radiólogo · Operador · Administrador | `super_admin` no se puede crear desde la web |
| RUT | Texto con autoformato | No | RUT válido si se completa | Necesario para sincronizar odontólogos/radiólogos con RIDS RX. Editable inline en la tabla (guarda al salir del campo) |
| Firma | Dibujo en pantalla (panel de firma, PNG) | No | — | **Solo al crear**; la UI dice "puedes agregarla después desde su perfil" pero esa pantalla no existe |

Si el rol es odontólogo o radiólogo con RUT y el holding tiene Rx habilitado, el usuario se crea también en RIDS RX; a los radiólogos se les muestra una contraseña generada **una sola vez**. Con federación activa (interruptor "Profesionales") el usuario se espeja en Dental-Demo.

#### 2.2.2 Importar desde RIDS RX
Botón sin campos: trae odontólogos/radiólogos del holding en RIDS RX que no existan localmente (por RUT o correo), los crea con contraseña aleatoria y la muestra una vez.

#### 2.2.3 Permisos por perfil (panel)
Matriz de casillas 3 perfiles (Odontólogo, Radiólogo, Operador) × 10 permisos. Cada casilla es Sí/No.

| Campo (permiso) | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Pacientes | Casilla por perfil | — | Sí / No | Llave `pacientes` |
| Agenda y citas | Casilla por perfil | — | Sí / No | `agenda` |
| Planes de tratamiento | Casilla por perfil | — | Sí / No | `tratamientos` (ver presupuestos) |
| Crear presupuestos | Casilla por perfil | — | Sí / No | `crearPresupuestos` (además de ver) |
| Documentos clínicos | Casilla por perfil | — | Sí / No | `documentosClinicos` |
| Cartola | Casilla por perfil | — | Sí / No | `cartola` |
| Evoluciones | Casilla por perfil | — | Sí / No | `evoluciones` |
| Observaciones | Casilla por perfil | — | Sí / No | `observaciones` |
| Consentimientos | Casilla por perfil | — | Sí / No | `consentimientos` |
| Módulo Rx | Casilla por perfil | — | Sí / No | `rx` (requiere Rx habilitado en el holding) |

#### 2.2.4 Permisos individuales de un usuario (modal "Permisos individuales · nombre")

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Pantallas (9 permisos de la matriz de perfil: Pacientes, Agenda y citas, Planes de tratamiento, Crear presupuestos, Documentos clínicos, Cartola, Evoluciones, Observaciones, Consentimientos, Módulo Rx — el análisis indica 9 conmutadores; cuál de las 10 llaves no aparece es **a verificar en la web**) | Conmutador de 3 estados por permiso | — | Hereda (muestra sí/no del perfil) · Sí · No | Solo para roles odontólogo / radiólogo / operador (no aplica a administradores) |
| Módulos (plan de la clínica): Pacientes, Documentos clínicos, Cartola, Evoluciones, Observaciones, Agenda, Tratamientos, Consentimientos | Conmutador de 3 estados por módulo | — | Hereda · Sí · No | Aplica a **todos** los roles, incluido `admin` |

### 2.3 Sillones (boxes)

- **Rol:** cualquier usuario con acceso a la agenda (el servidor solo exige sesión). **Pantalla:** `/agenda` o `/agenda/sillones-libres` → botón "Sillón" (modal "Agregar sillón"). Hover sobre la cabecera del sillón → eliminar (falla si tiene citas; no hay forma de renombrar ni desactivar por pantalla, ver 5.1).

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Número de sillón | Número entero ≥ 1 | Sí | Único por holding | Por defecto el máximo actual + 1 (o 101 si no hay sillones) |
| Nombre (opcional) | Texto | No | — | Si se deja vacío la agenda muestra "Sillón N" |

### 2.4 Horarios de profesionales

- **Rol:** `admin`. **Pantalla:** `/profesionales` → botón "Horario" (modal "Horario de {nombre}", disponible para odontólogo/radiólogo/operador). Lista los bloques por día con botón eliminar y un formulario de alta. **Advertencia:** estos horarios se registran pero **la agenda no los usa** para validar ni pintar disponibilidad.

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Día | Selección | Sí | Domingo · Lunes · Martes · Miércoles · Jueves · Viernes · Sábado | — |
| Desde | Hora | Sí | HH:MM (default 09:00) | — |
| Hasta | Hora | Sí | HH:MM > Desde (default 13:00) | No puede solaparse con otro bloque del mismo profesional y día |
| Sillón | Selección | No | Cualquiera · sillones del holding | — |

### 2.5 Pacientes

- **Rol:** cualquier perfil con permiso "Pacientes" (admin siempre). **Pantallas:** `/pacientes` → "Nuevo paciente" (modal); ficha `/pacientes/:id` → "Editar" (mismo modal); también desde el selector de paciente de cualquier cita ("Crear nuevo paciente"). El listado permite buscar por nombre/apellido/RUT y filtrar por estado del consentimiento de protección de datos (Todos, Firmados, Pendientes, Rechazados, Expirados, No enviados).

#### 2.5.1 Modal "Nuevo paciente" / "Editar paciente"

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Fotografía del paciente (opcional) | Archivo imagen (botón cuadrado con vista previa) | No | Cualquier imagen | Se sube después de guardar el paciente; también desde la foto de la cabecera de la ficha |
| RUT | Texto con autoformato `12.345.678-9` (máx. 12 caracteres) | Sí | RUT chileno válido (módulo 11); **único por holding** | Error "RUT inválido" si no valida; error 409 si ya existe en el holding |
| Nombre | Texto | Sí | — | — |
| Apellido | Texto | Sí | — | — |
| Teléfono | Selector de país (código con bandera, 49 países) + número | No | Se guarda como "+56 9 1234 5678" | **El código arranca en +34 (España)** aunque el holding sea de Chile: hay que cambiarlo a +56 |
| Fecha de nacimiento | Fecha | No | AAAA-MM-DD | Se usa para mostrar la edad |
| Correo electrónico | Correo | No | — | Necesario para enviar consentimientos, cartola y confirmación de cita |
| Dirección | Texto | No | — | — |
| Género | Selección | No | No especificado · Femenino · Masculino · Otro | — |
| Estado civil | Selección | No | No especificado · Soltero/a · Casado/a · Conviviente civil · Divorciado/a · Viudo/a | — |
| Nacionalidad | Texto | No | Texto libre (ej. "Chilena") | Sin lista de países |
| Ocupación | Texto | No | — | — |
| Previsión de salud | Selección | No | No especificada · Fonasa · Isapre · Particular · Otro | Informativa; **no** está vinculada al catálogo de previsiones del presupuesto |
| Plan / póliza | Texto | No | — | — |
| Contacto de emergencia · Nombre | Texto | No | — | — |
| Contacto de emergencia · Teléfono | Texto | No | Texto libre (sin selector de país) | — |
| Contacto de emergencia · Relación | Texto | No | — | — |
| Altura (cm) | Número ≥ 0 | No | Entero (se redondea) | — |
| Peso (kg) | Número ≥ 0, paso 0,1 | No | Decimal | — |
| Grupo sanguíneo | Selección | No | Desconocido · A+ · A- · B+ · B- · AB+ · AB- · O+ · O- | — |
| Alergias | 9 casillas | No | Flúor/fluoruro · Penicilina/betalactámicos · Anestésicos locales · Látex · Yodo/povidona · Níquel/metales · AINEs · Sulfitos · Otra | Vocabulario fijo; se usa para alertar al agregar prestaciones que contengan el alérgeno |
| Detalle de alergias | Área de texto | No | — | — |
| Condiciones médicas relevantes | Área de texto | No | — | — |
| Medicamentos actuales | Área de texto | No | — | — |
| Enfermedades crónicas | Área de texto | No | — | — |
| Antecedentes dentales | Área de texto | No | — | — |
| Etiquetas | Texto + chips (Enter o coma agrega) | No | Hasta 20 etiquetas únicas | Se muestran como píldoras en la cabecera de la ficha |

Al crear, si el holding tiene Rx habilitado, el paciente se sincroniza a RIDS RX; con federación activa (interruptor "Pacientes") se espeja en Dental-Demo.

#### 2.5.2 Ficha → pestaña "Datos paciente" (tarjeta editable "Motivo de consulta")

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Motivo de consulta | Área de texto + botón Guardar | No | Texto libre | **No está en el modal de paciente**; solo aquí. Debe completarlo el profesional |
| Grabación de respaldo (motivo de consulta) | Botón grabar/detener (audio del navegador) + reproductor + "Grabar de nuevo" | No | Audio webm | **Bloqueado hasta que exista el consentimiento "Grabación de voz" firmado** (link "Ir a Consentimientos"). Reemplaza la grabación anterior |

Las demás pestañas de solo lectura de esta sección (contacto, resumen de citas, próxima/última cita, antecedentes) no cargan datos.

### 2.6 Agenda y citas

- **Rol:** perfiles con permiso "Agenda y citas". **Pantallas:** `/agenda` (grilla sillones × horas 08:00–20:00 por día), `/agenda/sillones-libres` (semana de un sillón), `/agenda/diaria` (lista del día; admin ve todas, el resto las propias), ficha del paciente → "Nueva cita" y pestaña "Horas" (historial con botón "Cancelar" en citas futuras).

#### 2.6.1 "Agendar cita" desde una celda libre de la grilla

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Paciente | Buscador (≥ 2 caracteres por nombre o RUT) + "Crear nuevo paciente" | Sí | Paciente del holding | Abre el modal de paciente si no existe |
| Duración | Selección | Sí | 15 · 30 · 45 · 60 · 90 min (solo los múltiplos del bloque de agenda); muestra la hora de término | — |
| Motivo / notas | Área de texto | No | Texto libre | — |
| (fijos) Sillón y hora de inicio | — | — | Vienen de la celda elegida | Tipo de cita = "cita"; el profesional es el usuario logueado |

#### 2.6.2 "Nueva cita" / "Nuevo control" (botón superior o desde la ficha)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Paciente | Buscador | Sí | — | Precargado si se abre desde la ficha |
| Fecha | Fecha | Sí | Default: día seleccionado en la agenda | — |
| Hora | Hora | Sí | Default 09:00 | — |
| Sillón | Selección | Sí | Sillones activos | Sin solapamiento con otra cita del mismo sillón (salvo canceladas) |
| Duración | Selección | Sí | 15 · 30 · 45 · 60 · 90 min filtrados por el bloque | — |
| Profesional | Selección | No | "Yo mismo" · cualquier usuario del holding | **Solo lo ve el admin**; para los demás la cita queda a nombre del usuario logueado |
| Motivo / notas | Área de texto | No | — | — |
| (implícito) Tipo | — | — | "cita" o "control" (control cuando se abre desde Evoluciones → "Crear próximo control") | — |

Al crear se envía correo de confirmación al paciente (si tiene correo) y se espeja en Dental-Demo (interruptor "Citas").

#### 2.6.3 "Atender urgencia"

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Paciente | Buscador | Sí | — | — |
| Motivo de la urgencia | Texto | Sí | — | — |
| Nivel de gravedad | Selección | No | Sin especificar · Leve · Moderada · Grave | — |
| Profesional | Selección | No | Por asignar · Yo mismo (no admin) · cualquier profesional | — |
| (automático) Sillón, hora, duración, estado | — | — | Primer sillón libre ahora; 30 minutos fijos; nace en estado "llegó" con hora de llegada y "recibido por" = usuario | Error si no hay sillón libre. La duración no es editable desde la web |

#### 2.6.4 Detalle de cita (modal de acciones)
Sin campos editables. Botones según estado: "Marcar llegada" (agendada → llegó), "Pasar a atención" (llegó → en atención), "Terminar cita" + "Ir a evolucionar" (en atención → finalizada), "Cancelar cita" (si no está cancelada/finalizada; solo admin o el profesional de la cita). Cada paso sella su fecha/hora. **No existe edición ni reprogramación de citas** (ver 5.1).

### 2.7 Catálogos (Prestaciones, Convenios, Previsiones)

- **Rol:** `admin`. **Pantalla:** `/catalogo`. (Las sucursales están en 2.1.2 y el inventario en 2.15.)

#### 2.7.1 Prestaciones — modal "Nueva/Editar prestación"

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre | Texto | Sí | — | Mientras no se toque el selector de modo, el sistema sugiere el modo de odontograma por palabras clave del nombre |
| Tipo de prestación | Conmutador | Sí (solo holdings "Dental y estética") | Dental · Estética | En holdings dental o estética se fija automáticamente |
| Código | Texto | No | Único por holding | Se usa para vincular con Dental-Demo |
| Precio | Número ≥ 0 | Sí | CLP entero | Precio de lista antes de descuento por convenio |
| Modo de selección en el odontograma | Selección | No | Sesión · Pieza completa · Cara · Extracción · Cuadrante · Sextante · Arcada | Solo prestaciones dentales |
| Requiere registrar producto y lote | Casilla | No | Sí / No | Solo estética. Obliga a elegir un **lote real del inventario de Dental-Demo** al presupuestar y a registrar producto/lote/vencimiento/cantidad al evolucionar |
| Aplica siempre a todo el rostro | Casilla | No | Sí / No | Solo estética; ignora las zonas |
| Zonas donde puede aplicarse | Conmutador "Sin restricción / Zonas específicas" + 14 casillas | No | Frente · Entrecejo · Sienes · Párpados · Patas de gallo · Ojeras · Pómulos · Nariz · Nasogenianos · Código de barras · Labios · Mentón · Mandíbula · Cuello | Solo estética y si no aplica a todo el rostro |
| Al usar en un presupuesto… | Conmutador | No | "El profesional elige cuáles aplican" · "Se aplican todas juntas" | Solo con 2 o más zonas |
| Precio | Conmutador "Mismo precio para todas / Precio distinto por zona" + un número por zona | No | CLP por zona | Solo con 2 o más zonas; las zonas sin precio toman el precio base |
| Estado (tabla) | Interruptor | — | Activa / Desactivada | Eliminar falla si la prestación se usó en algún presupuesto |

#### 2.7.2 Convenios (alta inline + tabla)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre | Texto | Sí | Único por holding | — |
| Descuento % | Número | No | 0 – 100 | Editable inline en la tabla (guarda al salir del campo). Se aplica al precio de lista de cada prestación del presupuesto |
| Activo | Interruptor | — | Sí / No | Eliminar falla si se usó en presupuestos |

#### 2.7.3 Previsiones (alta inline + tabla)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre | Texto | Sí | Único por holding (ej. Fonasa, Isapre, Particular) | Informativa en el presupuesto |
| Activa | Interruptor | — | Sí / No | — |

#### 2.7.4 Plantillas de evolución
No tienen pantalla (ver 5.1). Solo existen las 4 sembradas: Control de rutina, Post operatorio, Anamnesis inicial, Alta odontológica.

### 2.8 Presupuestos (planes de tratamiento)

- **Rol:** perfiles con permiso "Planes de tratamiento" (y "Crear presupuestos" para crear). **Pantalla:** ficha → pestaña "Tratamientos" → "Nuevo presupuesto" (asistente de 3 pasos) o "Modificar" en una tarjeta de presupuesto. Requisitos previos: al menos una **sucursal** activa y un **convenio** activo; prestaciones en el catálogo; para prestaciones con trazabilidad, lotes con stock en el inventario de Dental-Demo.

#### 2.8.1 Paso 1 — Datos administrativos

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Tipo de diagrama | Conmutador | Sí (solo holdings "Dental y estética") | Odontograma · Mapa facial | Se bloquea cuando ya hay prestaciones agregadas |
| Clínica (sucursal) | Selección | Sí | Sucursales activas | Queda fija después de crear |
| Previsión | Selección | No | Previsiones activas | Queda fija |
| Convenio | Selección | Sí | Convenios activos (muestra -X %) | Queda fijo |
| Profesional | Selección | No | Default "Yo mismo"; cualquier usuario | **Solo admin**; el resto queda a su nombre |

#### 2.8.2 Paso 2 — Prestaciones (se repite por cada procedimiento)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Buscar prestación | Autocompletar (hasta 8 por nombre o código) | Sí | Prestaciones activas del tipo del diagrama; muestra precio o "Precio según zona" | Botones "Avanzada" y "Plantillas" están deshabilitados ("Próximamente") |
| Selección en el odontograma (dental) | Odontograma interactivo | Sí (salvo modo Sesión) | Piezas permanentes 1.1–4.8 y temporales 5.1–8.5; caras superior/derecha/inferior/izquierda/central; cuadrantes 1–4; sextantes; arcada superior/inferior | El modo lo fija la prestación. En modos pieza/cara/extracción se genera **un ítem por pieza** |
| Selección en el mapa facial (estética) | Mapa interactivo con zonas + herramientas de dibujo (lápiz, línea, círculo, borrador), zoom 1–2,5×, deshacer/rehacer, vistas frontal/perfil derecho/perfil izquierdo, conmutador Hombre/Mujer, capa Piel (Músculos deshabilitada) | Sí (según la prestación) | 14 zonas (restringidas por la prestación); trazos libres | Los trazos se guardan como anotaciones del presupuesto; el género define la foto base |
| Alerta de alergia | Aviso rojo automático | — | Se muestra si el nombre de la prestación contiene un alérgeno del paciente (flúor, anestésicos, penicilina, látex, yodo, níquel/metal, AINEs) | No bloquea |
| Buscar lote real | Autocompletar (≥ 2 caracteres) contra el inventario de Dental-Demo | Sí si la prestación exige trazabilidad | Muestra producto, N° lote, stock y vencimiento; rechaza lotes con stock 0 | **No se puede tipear a mano**; rellena producto, lote y vencimiento. No descuenta stock |
| Cantidad aplicada | Texto | No | Ej. "1 jeringa 1ml" | Solo con trazabilidad |
| Notas clínicas | Área de texto | No | — | Nota del procedimiento |
| Costo (en la lista "Prestaciones agregadas") | Número editable por ítem | — | CLP; precalculado con el descuento del convenio | Se puede corregir antes de crear |

#### 2.8.3 Paso 2 — Plantilla fotográfica (solo estética)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Zona | Selección | Sí | 14 zonas faciales | — |
| Momento | Conmutador | Sí | Antes · Después | La etiqueta queda "Zona — Antes/Después" |
| Foto | Archivo imagen (≤ 20 MB) → editor (recorte cuadrado, zoom 1–3, rotación ±90°, volteo) | Sí | — | Se sube al crear el presupuesto; también disponible en la tarjeta del presupuesto |

#### 2.8.4 Paso 3 — Totales y forma de pago

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre del presupuesto | Texto | No | — | **No editable después** (ver 5.1) |
| Forma de pago | Selección | No | Contado · Cuotas | No editable después |
| Observaciones generales | Área de texto | No | — | No editable después |

#### 2.8.5 Tarjeta del presupuesto (acciones posteriores)

| Campo / acción | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Estado | Selección | — | Sin iniciar · En tratamiento · Terminado · Alta | Se recalcula desde los ítems; "Alta" es terminal (congela el presupuesto y habilita "Generar informe") |
| Completado (por ítem) | Casilla | — | Sí / No | Sella quién y cuándo lo trató |
| Motivo de modificación | Área de texto (modal) | Sí si el presupuesto está "En tratamiento" | — | Se registra como auditoría al modificar o quitar ítems |
| Agregar procedimiento (estética) | Texto "Nuevo procedimiento…" + Costo | Sí / Sí | — | Sin prestación ni zona |
| Agregar procedimiento (dental) | Buscador de prestaciones + odontograma, **o** "fuera de catálogo": Descripción + Costo + odontograma libre | Sí | — | Única vía para ítems fuera de catálogo (en el asistente el botón no está visible) |
| Editar procedimiento · Descripción | Texto | Sí | — | — |
| Editar procedimiento · Pieza(s) (dental) / Zona (estética) | Texto libre ("11, 12") / mapa facial multi-zona + género | No | — | No edita costo, notas ni producto |
| Generar informe | Selección | — | PDF · Word | Solo con estado "Alta" |
| Evolucionar | Botón | — | — | Salta a Evoluciones con el ítem pendiente preseleccionado |
| Eliminar presupuesto / ítem | Botón con confirmación | — | — | Bloqueado si está en "Alta" |

### 2.9 Evoluciones

- **Rol:** perfiles con permiso "Evoluciones". **Pantalla:** ficha → pestaña "Evoluciones" → formulario "Crear nueva evolución". Botones "Crear próximo control" (crea cita tipo control) y "Próximos controles".

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| ¿Documenta un procedimiento del presupuesto? | Selección | No | Ítems no completados de todos los presupuestos del paciente ("N° x · nombre — descripción") | Al grabar marca el ítem como realizado y copia producto/lote/fotos al ítem |
| Producto | Texto | Sí si la prestación exige trazabilidad | — | — |
| N° de lote | Texto | Sí si trazabilidad | Aquí **sí** se tipea a mano | — |
| Fecha de vencimiento | Fecha | Sí si trazabilidad | — | — |
| Cantidad | Texto | Sí si trazabilidad | — | — |
| Fotos | Archivos imagen múltiples (≤ 20 MB c/u) con etiqueta | No | Etiqueta: Antes · Después · Sticker ficha · Sticker paciente | Se suben tras grabar; se duplican en el ítem documentado |
| Profesional | Selección | No | Usuarios del holding | **Solo admin** |
| Sección | Selección | No | Secciones de las plantillas (ej. Control, Diagnóstico, Alta) | Filtra las plantillas |
| Predefinidas… | Selección | No | Plantillas de evolución activas | Inserta el texto en el contenido |
| Generar alta | Botón | — | Inserta la plantilla de sección "Alta" | — |
| Contenido de la evolución | Editor de texto enriquecido (negrita, cursiva, subrayado, listas, alineación) + Previsualizar | Sí | Debe tener texto | Se guarda como HTML |
| Habilitar / Deshabilitar (tarjetas) | Botón | — | — | Ocultar sin borrar |
| Motivo de eliminación | Área de texto (modal) | Sí | — | Solo autor o admin; deja auditoría del borrado |

### 2.10 Cartola (cuenta corriente del paciente)

- **Rol:** perfiles con permiso "Cartola". **Pantalla:** ficha → pestaña "Cartola". El cargo de cada presupuesto se calcula automáticamente; por pantalla se agregan **abonos**, **intereses** y **ajustes** con el botón "+" de cada sección. Botones "Enviar por correo" (requiere correo del paciente) y "Descargar PDF". Al abrir la ficha con saldo > 0 aparece un aviso de deuda con opción de enviar recordatorio.

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Tipo de movimiento | Botón "+" de la sección | Sí | Abono · Interés · Ajuste | Abono suma al haber; interés al debe; ajuste según dirección |
| Presupuesto | Selección | No | Presupuestos del paciente; vacío = abono libre | — |
| Monto | Número ≥ 1 | Sí | CLP entero | — |
| Dirección | Selección | Sí (solo ajuste) | Debe (aumenta saldo) · Haber (disminuye) | — |
| Forma de pago | Selección | Sí (solo abono) | Efectivo · Transferencia · Tarjeta · Cheque · Otro | — |
| N° documento | Texto | No (solo abono) | — | — |
| Glosa | Texto | No | — | — |
| Observación | Área de texto | No | — | — |

Los movimientos no se editan; solo se eliminan (quien los registró o admin).

### 2.11 Observaciones administrativas

- **Rol:** perfiles con permiso "Observaciones". **Pantalla:** ficha → pestaña "Observaciones".

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Fecha | Solo lectura (hoy) | — | — | No se envía; el servidor usa la fecha de creación |
| Realizado por | Selección (admin) / texto fijo (otros) | No | Usuarios del holding | — |
| Observación | Área de texto | Sí | Texto plano | Solo autor o admin puede eliminar |

### 2.12 Documentos clínicos

- **Rol:** perfiles con permiso "Documentos clínicos". **Pantalla:** ficha → pestaña "Documentos clínicos", con una sub-pestaña por categoría.

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Categoría (sub-pestaña activa) | Pestaña | Sí | Recetas Médicas · Derivaciones · Imágenes · Archivos · Documentos de Altas · Solicitud Laboratorio · Documento Pabellón · Solicitud Pabellón | — |
| Archivo | Archivo (cualquier tipo, ≤ 20 MB) | Sí | — | — |
| Descripción (opcional) | Texto | No | — | — |

### 2.13 Consentimientos informados

- **Rol:** perfiles con permiso "Consentimientos". **Pantalla:** ficha → pestaña "Consentimientos": una tarjeta por cada uno de los **13 tipos** (Protección de datos, Tratamiento general, Anestesia, Cirugía/procedimiento invasivo, Endodoncia, Prótesis, Ortodoncia, Implantes, Blanqueamiento, Uso de imágenes, Sedación, Autorización de representante de menor, Grabación de voz). Cada tarjeta muestra estado (No enviado · Pendiente · Firmado · Rechazado · Expirado), último envío, vencimiento, respuesta y firmante. Los tipos **no se pueden crear, renombrar ni desactivar por pantalla**; el texto legal (placeholder en 12 de 13) solo se reemplaza subiendo un PDF propio.

| Campo / acción | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Enviar / Reenviar consentimiento | Botón | — | — | Requiere correo del paciente; envía link público válido 7 días; queda "Pendiente" (método correo) |
| Firma presencial · Nombre completo | Texto (prellenado con el paciente) | Sí | — | Modal "Ver / Firmar consentimiento" |
| Firma presencial · RUT | Texto con autoformato (prellenado) | Sí | RUT válido | — |
| Firma presencial · "El paciente leyó y comprende este documento" | Casilla | Sí | — | — |
| Firma presencial · Firma del paciente | Dibujo en pantalla | Sí para aceptar | PNG | No se pide al rechazar |
| Firma presencial · Decisión | Botones | Sí | Aceptar y firmar · Rechazar | Guarda IP y navegador; envía PDF firmado por correo. Un consentimiento respondido no se puede volver a responder |
| PDF propio del tipo (admin) | Archivo PDF ≤ 5 MB | No | — | Botones Ver / Subir / Reemplazar / Quitar; reemplaza el texto legal del tipo para todo el holding |

#### 2.13.1 Página pública `/consentimiento/:token` (paciente, sin sesión)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre completo | Texto | Sí | — | — |
| RUT | Texto | Sí | RUT válido | — |
| "He leído y comprendo este documento" | Casilla | Sí | — | — |
| Firma | Dibujo en pantalla | Sí para aceptar | PNG | — |
| Decisión | Botones | Sí | Aceptar y firmar · Rechazar | Estados posibles del link: inválido, vencido (marca "Expirado"), ya respondido, éxito |

### 2.14 Módulo Rx (RIDS RX / DIMAGE)

- **Rol:** perfiles con permiso "Módulo Rx" en holdings con Rx habilitado; los radiólogos no crean órdenes. **Pantalla:** ficha → pestaña "Módulo Rx". Requisitos: la sucursal debe tener "ID clínica en RIDS RX" (2.1.2) y el odontólogo debe tener RUT.

| Campo / acción | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Actualizar datos en Plataforma | Botón | — | — | Sincroniza el paciente (RUT, nombre, correo, teléfono, dirección, nacimiento) a RIDS RX |
| Crear orden · Clínica | Selección | Sí | Sucursales con ID de RIDS RX | — |
| Crear orden · Odontólogo | Selección (admin) / fijo "yo mismo" | Sí | Usuarios odontólogos con RUT | — |
| Crear orden · Prioridad | Selección | Sí | 1 día · 2 días · 3 días · Normal · Urgente | — |
| Crear orden · Examen sin diagnóstico clínico | Casilla | — | Sí / No | Si se marca envía "Sin diagnóstico" |
| Crear orden · Diagnóstico | Área de texto | Sí (si no se marcó la casilla) | — | — |
| Crear orden · Observaciones | Área de texto | No | — | — |
| Crear orden · Tipos de examen | Casillas por grupo, pestañas Intraorales / Extraorales | ≥ 1 | Catálogo remoto de RIDS RX (grupos Adultos, Niños, 2D, 3D) | — |
| Crear orden · Observación / URL del examen (por examen) | Texto | No | — | — |
| Crear orden · Archivos (por examen) | Archivos múltiples (hasta 10, ≤ 3 GB c/u) | No | — | Se suben tras crear la orden |
| Crear orden · Especificar piezas (por examen) | Odontograma en modo extracción | No | Piezas dentales | — |
| Guardar borrador / Enviar a radiólogo | Botones | — | — | Enviar cambia el estado de la orden en RIDS RX |
| Detalle de orden · Diagnóstico | Texto | — | — | Editable si la orden lo permite |
| Detalle de orden · Prioridad | Selección | — | Normal · Urgente | — |
| Detalle de orden · Observaciones | Área de texto | — | — | — |
| Detalle de orden · Adjuntar archivos / eliminar adjunto / Ver en 3D / PDF / ZIP | Botones | — | — | El visor 3D lee los DICOM desde el almacenamiento de RIDS RX |

### 2.15 Inventario (vive en Dental-Demo; DentalCloud lo gestiona en vivo)

- **Rol:** `admin`. **Pantalla:** `/catalogo` → pestaña "Inventario". Requiere federación configurada (si no, error 503). Tarjetas de alertas (lotes vencidos, por vencer, sin stock, bajo stock); filtros por búsqueda, categoría, proveedor, estado y sede. Los datos se guardan en Dental-Demo (tablas de insumos, lotes y movimientos).

#### 2.15.1 Modal "Nuevo/Editar insumo"

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre del insumo | Texto | Sí | — | — |
| Sede | Selección | Sí (si el holding tiene sucursales) | Sucursales del holding | Se corresponde por nombre con la sede de Dental-Demo |
| Consultorio | Selección | No | Consultorio 1 · Consultorio 2 · Consultorio 3 · Consultorio 4 · Consultorio 5 · Sala RX · Pabellón menor | — |
| Categoría | Selección | No | Desechables · Bioseguridad · Anestesia · Restauracion · Ortodoncia · Higiene dental · Instrumental · Radiologia · Laboratorio · Otros | — |
| Proveedor | Texto | No | — | — |
| Descripción | Área de texto | No | — | — |
| Fecha de compra | Fecha | No | Default hoy | — |
| Unidad | Selección | No | unidad · caja · paquete · frasco · tubo · ml · kit | — |
| Cantidad comprada | Número | No | — | — |
| Costo unitario | Número | No | — | Costo total = cantidad × unitario si no se modifica |
| Costo total | Número | No | — | — |
| Stock actual | Solo lectura | — | — | Se administra con lotes y movimientos |
| Stock mínimo | Número | No | — | Genera alerta de bajo stock |

#### 2.15.2 Modal "Nuevo lote" (desde "Lotes" del insumo)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| N° de lote | Texto | Sí | Letras, números, espacios, puntos y guiones; único por insumo | — |
| Fabricante | Texto | No | — | — |
| Presentación | Texto | No | — | — |
| Concentración | Texto | No | — | — |
| Registro sanitario | Texto | No | — | — |
| Fecha de recepción | Fecha | No | — | — |
| Vencimiento | Fecha | No | Vacío = sin vencimiento | Alimenta las alertas (vencido / por vencer) |
| Cantidad inicial / actual | Número ≥ 0 | Sí | — | — |

#### 2.15.3 Modal "Movimiento" de un lote

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Tipo | Opción | Sí | Entrada · Salida · Ajuste | En ajuste la cantidad es la "cantidad final" |
| Cantidad | Número > 0 | Sí | — | — |
| Motivo | Texto | Sí en ajuste | — | — |

Además: botón "Archivar" insumo.

### 2.16 Super-admin (configuración de holdings y módulos)

- **Rol:** `super_admin`. **Pantallas:** `/admin/clinicas/:id` (detalle del holding) y `/admin/modulos/:moduleKey` (consumo por módulo).

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Logo | Clic sobre el logo → archivo imagen ≤ 5 MB | No | — | Reemplaza el logo |
| Activo | Interruptor | — | Sí / No | Si es No, los usuarios del holding no pueden iniciar sesión; se espeja a Dental-Demo |
| Federación con Dental-Demo: Conectada | Interruptor con confirmación | — | Conectada / No conectada | Al conectar crea la clínica espejo y arranca en "Solo catálogo" |
| Federación: Conexión activa | Interruptor | — | Sí / No | No = pausa la sincronización sin perder el emparejamiento |
| Federación: Solo catálogo | Interruptor | — | Sí / No | Sí = solo viajan convenios, prestaciones y previsiones |
| Federación: Conexiones individuales | 6 interruptores | — | Pacientes · Citas · Presupuestos y tratamientos · Profesionales · Sucursales · Catálogo | Ausente = activo |
| RUT | Texto + Guardar | No | RUT válido, único | — |
| Tipo de holding | Selección | — | Dental · Estética facial · Dental y estética | — |
| País | Selección | — | 13 países (ver 2.1.1) | — |
| Módulo Rx | Interruptor | — | Sí / No | Oculto si el tipo es estética |
| Módulos habilitados | 8 interruptores | — | Pacientes · Documentos clínicos · Cartola · Evoluciones · Observaciones · Agenda · Tratamientos · Consentimientos | Ocultan pestañas y bloquean rutas |
| Consumo por módulo → "Habilitar por holding" | Interruptor por holding | — | Sí / No | Misma configuración que los módulos, vista por módulo (Rx: "No disponible aún") |

El nombre del holding **no** tiene campo de edición en esta pantalla (ver 5.1). Las métricas (10 indicadores y consentimientos de protección de datos) son de solo lectura.

---
## 3. Dental-Demo: qué se puede cargar por pantalla

Mapa de navegación (menú lateral): **Principal** → Inicio (`/dashboard`), Agenda (Agenda diaria `/agenda/diaria`, Monitor de sala `/agenda/monitor`, Mi horario `/agenda/mi-horario`, Recordatorios `/agenda/recordatorios`, Pacientes `/pacientes`), Reportes (`/reportes`), Cotizaciones (`/cotizaciones`), Finanzas (Caja operativa, Ingresos, Gastos, Liquidaciones, Convenios, Cobranza), Operaciones (Inventario, Cotizaciones de compra, Equipos, Simulación estética IA, Personal, Prestaciones, Previsiones), Marketing IA (`/marketing-ia`). **Cuenta → Ajustes** → Suscripción, Sedes, Usuarios org (maqueta), Horarios, Consentimientos. Desde la ficha del paciente: Ficha clínica (`/pacientes/:id/ficha-clinica`) y Planes de tratamiento (`/pacientes/:id/planes-tratamiento`). **Panel de plataforma** (solo `PLATFORM_ADMIN`): `/admin-plataforma/resumen`, `/clinicas`, `/clinicas/:id`, `/suscripciones`, `/planes`, `/pagos`, `/uso`, `/solicitudes-modulos`, `/soporte`.

Cada menú exige un permiso y, en muchos casos, una **"feature" contratada** en la suscripción de la clínica (CLINICAL_RECORD, TREATMENT_PLANS, ADVANCED_FINANCE, AGREEMENTS, LIQUIDATIONS, ADVANCED_REPORTS, ESTHETIC_TREATMENTS, ESTHETIC_AI_SIMULATION, MARKETING_AI). Además, cada usuario puede tener módulos de menú permitidos/denegados individualmente. Los roles con alcance por sede (LOCATION_MANAGER, PROFESSIONAL, RECEPTIONIST, ASSISTANT) solo ven datos de sus sedes asignadas.

**Advertencia general para la carga de datos:** el servidor rechaza con error 400 cualquier campo que no esté en su lista (validación estricta). Varias pantallas envían nombres de campo distintos a los esperados y por eso **fallan al guardar**; se indican en cada módulo y se consolidan en 5.2.

### 3.1 Plataforma: clínicas, suscripciones y módulos

- **Rol:** `PLATFORM_ADMIN`. **Pantalla:** `/admin-plataforma/clinicas` → "Nueva clínica" (modal); `/admin-plataforma/clinicas/:id` (detalle); `/admin-plataforma/solicitudes-modulos`.

#### 3.1.1 Modal "Nueva clínica"
Crea en una sola operación la clínica, su sede inicial, el usuario administrador general (CLINIC_OWNER), la suscripción y los módulos; luego espeja clínica y sede en DentalCloud.

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Datos de la clínica · Nombre | Texto | Sí | — | — |
| País | Selección | Sí | Chile (default) · España · Colombia · Perú · México · Estados Unidos · Venezuela · Francia · Otro | Al elegir país se proponen moneda y zona horaria |
| Moneda | Selección | Sí | CLP (default) · EUR · USD · COP · PEN · MXN · VES | Código ISO de 3 letras; todas las sedes heredan la misma |
| Zona horaria | Selección | Sí | America/Santiago (default) · Europe/Madrid · America/Bogota · America/Lima · America/Mexico_City · America/New_York · America/Los_Angeles · America/Caracas · Europe/Paris | — |
| Nombre de contacto | Texto | Sí | — | — |
| Correo de contacto | Correo | Sí | Único entre clínicas | — |
| Teléfono | Texto | Sí | — | — |
| Tipo de clínica | Selección | Sí | DENTAL Dental (default) · ESTHETIC Estética facial · BOTH Dental y estética | **No editable después** |
| Sede inicial · Nombre de la sede | Texto | Sí | Default "Sede Principal" | País y moneda de la sede son solo lectura (copian los de la clínica) |
| Administrador · Nombre | Texto | Sí | — | — |
| Administrador · Correo | Correo | Sí | Único global | — |
| Administrador · Contraseña temporal | Contraseña | Sí | Mínimo 10 caracteres | No existe cambio de contraseña posterior |
| Administrador · Confirmar contraseña | Contraseña | Sí | Debe coincidir | Solo validación local |
| Suscripción · Plan base | Selección | Sí | Planes activos visibles ("{nombre} - USD {precio} - sedes N - usuarios N"); default PROFESSIONAL | En el seed solo PROFESSIONAL es visible (BASIC 29 USD / 1 sede / 3 usuarios; PROFESSIONAL 79 USD / 3 sedes / 10 usuarios; ENTERPRISE 199 USD / ilimitado) |
| Suscripción · Estado | Selección | — | ACTIVE Activa (default) · TRIAL En prueba | — |
| Suscripción · Fecha de inicio / Fecha de término | Fecha / Fecha | Sí | Término > inicio; default hoy / hoy + 1 mes | — |
| Suscripción · Renovación automática | Casilla | — | Default Sí | — |
| Extensiones iniciales | Casillas por módulo activo | — | MARKETING_AI · ADVANCED_FINANCE · CLINICAL_RECORD · TREATMENT_PLANS · ESTHETIC_TREATMENTS · AGREEMENTS · LIQUIDATIONS · MULTI_LOCATION · ADVANCED_REPORTS · API_ACCESS (y ESTHETIC_AI_SIMULATION si existe en la BD) | Preseleccionados ADVANCED_FINANCE, CLINICAL_RECORD, TREATMENT_PLANS, ADVANCED_REPORTS. **Los módulos determinan qué menús verá la clínica** |

No hay campo de IVA (`taxRatePercent`, fijo en 19), dirección de sede ni teléfono del administrador.

#### 3.1.2 Detalle de clínica

| Campo / acción | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Editar clínica · Nombre, País, Moneda, Zona horaria, Nombre/Correo/Teléfono de contacto | Texto / selecciones (mismas listas de 3.1.1) | Todos obligatorios | — | El tipo de clínica y el IVA **no** se pueden editar |
| Activar suscripción (solo si no tiene) · Plan | Selección | Sí | Planes ("{nombre} — {USD}/mes") | — |
| Activar suscripción · Renovación automática | Casilla | — | Default Sí | — |
| Suspender clínica / Reactivar clínica | Botón con confirmación | — | Estados ACTIVE · TRIAL · SUSPENDED · EXPIRED | Suspender/reactivar se espeja como activo/inactivo en DentalCloud |
| Plan y módulos · Activo/Inactivo (por módulo) | Casilla | — | Sí / No | — |
| Plan y módulos · Precio (por módulo) | Número ≥ 0 | — | USD | — |
| Plan y módulos · Cantidad (por módulo) | Número | — | Solo si el módulo lo permite | — |

#### 3.1.3 Solicitudes de módulos (enviadas por las clínicas) → "Cambiar estado"

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Estado | Selección | Sí | PENDING Pendiente · IN_REVIEW En revisión · APPROVED Aprobada · REJECTED Rechazada · CANCELLED Cancelada | Aprobar **no** activa los módulos: hay que hacerlo en "Plan y módulos" |
| Notas internas | Área de texto | No | — | — |

Las demás pantallas de plataforma (Resumen, Suscripciones, Planes, Pagos, Uso, Soporte) son de solo lectura; sus botones "Renovar", "Cambiar plan", "Nuevo plan" y "Nuevo ticket interno" están deshabilitados ("Próximamente").

### 3.2 Sedes y consultorios

- **Rol:** CLINIC_OWNER (permiso LOCATIONS_MANAGE; consultorios: EQUIPMENT_MANAGE). **Pantalla:** Ajustes → Sedes (`/ajustes/sedes`). El botón "Nueva sede" se deshabilita al alcanzar el límite de sedes del plan.

#### 3.2.1 Modal "Nueva sede" / "Editar sede"

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre | Texto | Sí | Único por clínica | Al crear se espeja como Sucursal en DentalCloud |
| País | Texto deshabilitado | — | Heredado de la clínica | — |
| Moneda | Texto deshabilitado | — | Heredada de la clínica | — |
| Desactivar (tabla) | Botón | — | — | Bloqueado si es la última sede activa |

No hay dirección, teléfono ni zona horaria por sede.

#### 3.2.2 Modal "Nuevo consultorio" / "Editar consultorio" (sección "Consultorios por sede")

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre | Texto | Sí | Único por sede | — |
| Sede | Selección | Sí | Sedes activas | — |
| Atención dental | Casilla | — | Default Sí | — |
| Estética orofacial | Casilla | — | Default No | Necesario para "consultorio estético sugerido" en planes estéticos y para equipos de área estética |
| Activo | Casilla | — | Default Sí | "Desactivar" en la tabla lo archiva |
| Notas | Área de texto | No | — | — |

**Atención:** estos consultorios (tabla real) los usan solo Equipos y Planes estéticos. La **agenda** usa una lista fija de texto (Box 1–5, Sala RX, Pabellón menor) y los **insumos/horarios** otra (Consultorio 1–5, Sala RX, Pabellón menor). No están relacionados entre sí.

### 3.3 Usuarios (Personal)

- **Rol:** CLINIC_OWNER (todos los roles) o LOCATION_MANAGER (solo PROFESSIONAL, RECEPTIONIST, ASSISTANT en sus sedes). **Pantalla:** Operaciones → Personal (`/operaciones/personal`). El botón de alta se bloquea al alcanzar el límite de usuarios del plan.

#### 3.3.1 Modal "Nuevo personal" / "Editar personal"

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre | Texto | Sí | — | Se guarda junto al apellido como nombre completo |
| Apellido | Texto | Sí | — | — |
| Correo | Correo | Sí | Único global | — |
| Rol | Selección | — | CLINIC_OWNER Administrador general · LOCATION_MANAGER Administrador de sede · MARKETING_MANAGER Encargado de marketing · PROFESSIONAL Profesional (default) · RECEPTIONIST Recepción · ASSISTANT Asistente | Deshabilitado al editarse a sí mismo |
| Contraseña temporal | Contraseña (**solo al crear**) | Sí | Mínimo 10 caracteres | No hay cambio de contraseña posterior |
| Profesión | Selección | — | DENTIST Dentista (default) · DENTAL_ASSISTANT Asistente dental · RECEPTIONIST Recepción · ADMINISTRATION Administración · MARKETING Marketing · OTHER Otro | — |
| Especialidad | Texto | No | Ej. "Ortodoncia" | — |
| Sucursal principal | Selección | No | "Por asignar" + sedes accesibles | — |
| Sucursales asignadas | Casillas | No | Sedes accesibles | Define el alcance de datos del usuario |
| Habilitado para estética orofacial | Casilla (solo rol PROFESSIONAL) | — | Default No | Requerido para asignarlo a planes estéticos. **Si está marcado, el usuario se espeja en DentalCloud** (con la misma contraseña) |
| Color en agenda | Selector de color + código hex (paleta de 8: #2563EB, #16A34A, #9333EA, #EA580C, #0891B2, #DB2777, #4F46E5, #65A30D) | — | `#RRGGBB`; default #2563EB | **Solo en edición**, para perfiles clínicos |
| Activo | Casilla (no aplica a sí mismo) | — | Default Sí | — |
| Teléfono | — | — | — | El servidor acepta `phone` pero **no existe la columna**: se descarta |

Botón "Permisos" dentro del modal → **Permisos de módulos**: una fila por módulo con opción Permitir / Denegar (AGENDA Agenda · REPORTS Reportes · QUOTES Cotizaciones · FINANCE Finanzas · COLLECTIONS Cobranza · INVENTORY Inventario · EQUIPMENT Equipos · ESTHETIC_SIMULATION Simulación estética IA · STAFF Personal · PRESTACIONES Prestaciones · PREVISIONES Previsiones · MARKETING Marketing IA). Siempre se guardan los 12 como decisión explícita.

#### 3.3.2 Menú "Más acciones"

| Acción | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Administrar permisos (drawer "Permisos de usuario") | Un grupo de opciones por capacidad (finanzas, cobranza, inventario, equipos, cotizaciones, agenda) | — | Sin acceso · Sedes asignadas · Todas las sedes (agenda solo "asignadas") | Solo CLINIC_OWNER, no sobre sí mismo ni sobre otro CLINIC_OWNER; las opciones ya cubiertas por el rol aparecen deshabilitadas. Pide confirmación extra al otorgar finanzas |
| Desactivar / Activar | Botón | — | — | **Falla con error 400**: la pantalla envía `status: ACTIVE/INACTIVE` y el servidor espera un booleano `active`/`isActive` (ver 5.2). Alternativa: casilla "Activo" del modal de edición |
| Historial de cambios | Drawer de solo lectura | — | — | Auditoría del usuario |

### 3.4 Horarios de atención y bloqueos

- **Rol:** AGENDA_MANAGE_ALL / CLINIC_SETTINGS_MANAGE. **Pantalla:** Ajustes → Horarios (`/ajustes/horarios`), se elige el profesional y se ven "Horario semanal" y "Bloqueos y ausencias". **A diferencia de DentalCloud, aquí los horarios y bloqueos sí se validan al agendar.**

| Formulario | Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|---|
| Horario | Día de semana | Selección | Sí | Domingo (0) … Sabado (6); default Lunes | — |
| Horario | Sede | Selección | No | "Sin sede" + sedes | — |
| Horario | Hora inicio | Hora | Sí | Default 09:00 | — |
| Horario | Hora término | Hora | Sí | > inicio; default 18:00 | — |
| Horario | Activo | Casilla | — | Default Sí | — |
| Horario | (no existe) Consultorio/sala | — | — | — | El servidor lo acepta (lista de 7 consultorios) y "Mi horario" lo muestra, pero el formulario no lo tiene (ver 5.2) |
| Creación rápida | Hora inicio, Hora término, Sede, Activo | Igual que arriba | — | — | Crea de una vez Lunes a Viernes (5 horarios) |
| Bloqueo | Inicio | Fecha y hora | Sí | — | — |
| Bloqueo | Término | Fecha y hora | Sí | > inicio | — |
| Bloqueo | Motivo | Texto | No | Ej. "Almuerzo / reunión" | — |
| Bloqueo | Sede | Selección | No | — | — |
| Bloqueo | Activo | Casilla | — | Default Sí | — |
| Probar disponibilidad | Inicio, Término, Sede | Fecha y hora ×2 + selección | Sí / Sí / No | Mismo día | Solo consulta, no guarda |

"Mi horario" (`/agenda/mi-horario`, solo PROFESSIONAL) es de solo lectura.

### 3.5 Pacientes

- **Rol:** perfiles con AGENDA_MANAGE (CLINIC_OWNER, LOCATION_MANAGER, PROFESSIONAL, RECEPTIONIST). **Pantalla:** Pacientes (`/pacientes`) → "Nuevo paciente" / menú "Editar"; también el sub-formulario "Crear paciente" del modal de cita.

#### 3.5.1 Modal "Nuevo paciente" / "Editar paciente"

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre * | Texto | Sí | ≤ 80 caracteres | Guardar se habilita solo con nombre y apellido |
| Apellido * | Texto | Sí | ≤ 80 | — |
| RUT | Texto con autoformato (puntos/guion, K) | No | RUT chileno válido si se completa | **Sin RUT el paciente puede no espejarse en DentalCloud** (allá es obligatorio) |
| Fecha nacimiento | Fecha | No | — | — |
| Teléfono | Texto | No | ≤ 30 | Sin selector de país |
| Correo | Correo | No | ≤ 254, se guarda en minúsculas | Necesario para el correo de confirmación de cita |
| Género | Selección | No | Sin especificar · FEMALE Femenino · MALE Masculino · OTHER Otro | El panel lateral muestra el código crudo (FEMALE/MALE/OTHER) |
| Dirección | Texto | No | ≤ 200 | — |
| Notas | Área de texto | No | ≤ 10.000 | — |
| Altura (cm) | Número ≥ 0 | No | — | **SE CAPTURA PERO NO SE GUARDA** (el payload lo descarta) |
| Peso (kg) | Número ≥ 0, paso 0,1 | No | — | **SE CAPTURA PERO NO SE GUARDA** |
| Alergias | 9 casillas | No | fluoruro · penicilina · anestesicos_locales · latex · yodo · niquel_metales · aines · sulfitos · otro | **SE CAPTURA PERO NO SE GUARDA** |
| Detalle de alergias | Área de texto | No | — | **SE CAPTURA PERO NO SE GUARDA** |
| Condiciones médicas relevantes | Área de texto | No | Ej. "diabetes, hipertensión, embarazo" | **SE CAPTURA PERO NO SE GUARDA** |
| Medicamentos actuales | Área de texto | No | Ej. "anticoagulantes, antihipertensivos" | **SE CAPTURA PERO NO SE GUARDA** |
| (oculto) Sede | — | — | Sede activa al crear | No hay selector; no se puede cambiar de sede después |
| Archivar (menú ⋮, con confirmación) | Botón | — | Estado ACTIVE → ARCHIVED | Se espeja a DentalCloud |

Los 6 antecedentes médicos existen en la base de datos y **sí se completan cuando el paciente llega por federación desde DentalCloud** (ver secciones 4 y 6). El panel lateral de la lista los muestra si tienen valor. Al vaciar un campo y guardar, el valor anterior **no se borra** (el payload omite vacíos).

#### 3.5.2 Sub-formulario "Crear paciente" dentro de "Nueva cita"
Campos: Nombre *, Apellido *, RUT (autoformato + validación), Teléfono, Correo. Crea el paciente y lo selecciona en la cita.

### 3.6 Ficha clínica y odontograma

- **Rol:** CLINICAL_RECORD_MANAGE (CLINIC_OWNER, PROFESSIONAL); odontograma editable solo CLINIC_OWNER/PROFESSIONAL. Requiere feature **CLINICAL_RECORD**. **Pantalla:** `/pacientes/:id/ficha-clinica`.

#### 3.6.1 Formulario "Ficha general" (antecedentes) → botón "Guardar ficha"

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Antecedentes médicos | Área de texto | No | ≤ 10.000 | — |
| Alergias | Área de texto | No | **Texto libre** | Es un dato distinto de las 9 casillas del paciente (dos modelos de alergias no relacionados) |
| Medicamentos actuales | Área de texto | No | — | Distinto del campo del paciente |
| Enfermedades crónicas | Área de texto | No | — | — |
| Antecedentes dentales | Área de texto | No | — | — |
| Observaciones | Área de texto | No | — | — |

Siempre se envían los 6 campos; ninguno es obligatorio.

#### 3.6.2 Modal "Nueva nota clínica" / "Editar nota clínica" (evoluciones)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Título | Texto | Sí | ≤ 180 | — |
| Fecha nota | Fecha | No | Default hoy | — |
| Motivo | Área de texto | No | ≤ 250 | — |
| Diagnóstico | Área de texto | No | — | — |
| Tratamiento | Área de texto | No | — | — |
| Indicaciones | Área de texto | No | — | — |
| Observaciones | Área de texto | No | — | — |
| Estado (tarjeta) | Botones "Marcar final" / "Archivar" | — | DRAFT Borrador → FINAL Final → ARCHIVED Archivada | La nota nace como borrador. No hay campo para vincularla a una cita ni a un profesional (el servidor lo aceptaría) |

#### 3.6.3 Modal "Pieza dental {n}" (odontograma de la ficha)
Se abre al hacer clic en una de las 32 piezas permanentes (18–11, 21–28, 31–38, 48–41). Guarda una entrada por (pieza, superficie).

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Pieza dental | Solo lectura | — | Pieza clicada (numeración FDI) | — |
| Superficie | Selección | No | GENERAL (default) · O · M · D · V · L · P · MOD | — |
| Condición | Selección | Sí | HEALTHY Sano (default) · CARIES Caries · RESTORATION Restauración · MISSING Ausente · EXTRACTION_INDICATED Extracción indicada · IMPLANT Implante · CROWN Corona · ROOT_CANAL Endodoncia · FRACTURE Fractura · PERIODONTAL_ISSUE Periodontal · OBSERVATION Observación · OTHER Otro | Alimenta el resumen (Caries, Restauraciones, Coronas, Extracciones indicadas, Otros hallazgos) |
| Diagnóstico | Área de texto | No | — | — |
| Tratamiento sugerido | Área de texto | No | — | — |
| Observaciones | Área de texto | No | — | — |
| Eliminar entrada | Botón | — | — | — |

Este odontograma **no tiene relación** con el odontograma de los planes de tratamiento (que usa piezas 1.1–8.5 con temporales, 5 caras y 7 modos, y se guarda como texto en el ítem).

#### 3.6.4 Modal "Nuevo recordatorio" (seguimiento clínico) — **NO GUARDA (error 400)**

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Título * | Texto | Sí | — | — |
| Tipo * | Selección | Sí | GENERAL General (default) · CHECKUP Control · CLEANING Limpieza · POST_TREATMENT Post tratamiento · ORTHODONTIC_CONTROL Control de ortodoncia · IMPLANT_CONTROL Control de implante · SURGERY_FOLLOW_UP Seguimiento cirugía | La pantalla envía `type`; el servidor espera `reminderType` |
| Fecha de vencimiento * | Fecha | Sí | — | La pantalla envía `targetDate`; el servidor espera `dueDate` |
| Prioridad * | Selección | Sí | LOW Baja · NORMAL Normal · HIGH Alta | — |
| Profesional | Selección | No | "Sin profesional asignado" + profesionales | — |
| Sede | Selección | No | "Todas" + sedes | — |
| Notas | Área de texto | No | — | — |

Por el desajuste de nombres, **la creación manual de recordatorios falla**. Los recordatorios que sí existen son los **automáticos** (al completar una cita, según reglas o por defecto: implante → 3 meses, general → 6 meses) y los de seguimiento de cotización.

#### 3.6.5 Drawers de solo lectura
"Historial de actividad" (auditoría), "Historial de atenciones" (citas) — sin carga de datos. "Privacidad y datos" se detalla en 3.8.

### 3.7 Consentimientos (plantillas y registro por paciente)

#### 3.7.1 Plantillas — Ajustes → Consentimientos (`/ajustes/consentimientos`)
- **Rol:** CLINIC_SETTINGS_MANAGE o USERS_MANAGE_ASSIGNED.

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre * | Texto | Sí | ≤ 160; (nombre + versión) únicos por clínica | — |
| Versión * | Texto | Sí | ≤ 40; default "v1.0" | Cada cambio de texto debería registrarse como nueva versión |
| Título * | Texto | Sí | ≤ 220 | — |
| Finalidad | Área de texto | No | ≤ 20.000 | — |
| Texto del consentimiento * | Área de texto | Sí | ≤ 50.000 | — |
| Categorías de datos | Chips de selección múltiple | No | identificacion · contacto · salud · historial_clinico · agenda · facturacion · comunicaciones | — |
| Canales | Chips de selección múltiple | No | email · phone · whatsapp · sms | — |
| Activa | Casilla | — | Default Sí | "Desactivar/Activar" en la tarjeta |
| (no existe) Propósito | — | — | GENERAL · ESTHETIC_AI_SIMULATION | **Sin campo en la web: toda plantilla queda GENERAL.** La Simulación estética IA exige un consentimiento con propósito ESTHETIC_AI_SIMULATION, por lo que **no se puede habilitar desde la web** (ver 5.2) |
| (no existe) Vigente desde | — | — | — | Sin campo |

#### 3.7.2 Registro de consentimiento — Ficha clínica → sección "Consentimiento y privacidad"
- **Rol:** CLINIC_OWNER, LOCATION_MANAGER, RECEPTIONIST (con AGENDA_MANAGE). Botón contextual "Registrar consentimiento" / "Registrar nueva versión" / "Renovar consentimiento".

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Plantilla activa * | Selección | Sí | Plantillas activas "{nombre} v{versión}" | Se guarda una copia (snapshot) del texto |
| Método | Selección | Sí | IN_PERSON Presencial (default) · DIGITAL Digital · VERBAL Verbal · IMPORTED Importado | **No hay firma dibujada ni envío por correo** (a diferencia de DentalCloud) |
| Fecha aceptación | Fecha | No | Default hoy | — |
| Fecha expiración | Fecha | No | ≥ fecha de aceptación | Define el estado "Vencido" |
| Representante legal | Texto | Condicional | ≤ 160 | Si se indica algún dato del representante, nombre y relación son obligatorios |
| RUT representante | Texto con autoformato | No | RUT válido si se completa | — |
| Relación representante | Texto | Condicional | ≤ 80 | — |
| Observaciones | Área de texto | No | ≤ 20.000 | — |
| Revocar (tabla) → "Observación o motivo" | Área de texto (modal) | No | — | Estado ACTIVE → REVOKED; se descarga comprobante PDF |

### 3.8 Privacidad y protección de datos

- **Rol:** crear solicitud: PATIENTS_MANAGE_ASSIGNED; revisar/exportar: USERS_MANAGE_*; anonimizar: CLINIC_SETTINGS_MANAGE. **Pantalla:** Ficha clínica → botón "Privacidad y datos" (drawer).

| Formulario | Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|---|
| Nueva solicitud | Tipo de solicitud * | Selección | Sí | DATA_EXPORT Exportación de datos · DATA_CORRECTION Corrección de datos · DATA_RESTRICTION Restricción del tratamiento · DATA_ANONYMIZATION Anonimización | No se duplica si ya hay una activa |
| Nueva solicitud | Motivo (opcional) | Área de texto | No | ≤ 2.000, sin HTML | — |
| Transición de estado | Estado (botón) | — | — | PENDING → IN_REVIEW / CANCELLED; IN_REVIEW → APPROVED / REJECTED / CANCELLED; APPROVED → COMPLETED / CANCELLED | Quien creó la solicitud no puede aprobarla |
| Transición de estado | Notas de resolución (opcional) | Área de texto | No | ≤ 2.000 | — |
| Anonimizar | Escribe ANONIMIZAR para confirmar | Texto | Sí (exacto) | — | **En la práctica no se puede completar**: exige una política de retención de datos de la clínica que no tiene pantalla ni endpoint (ver 5.2), además de solicitud aprobada y paciente archivado |
| Exportar | "Descargar datos" | Botón | — | Solo con solicitud DATA_EXPORT aprobada o completada | Descarga JSON del paciente |

### 3.9 Agenda (citas)

- **Rol:** AGENDA_MANAGE (CLINIC_OWNER, LOCATION_MANAGER, PROFESSIONAL, RECEPTIONIST). **Pantalla:** Agenda diaria (`/agenda/diaria`, pestañas Diaria/Semanal) → "Nueva cita" / "Editar cita"; también desde Pacientes (menú "Nueva cita") y Ficha clínica ("Agendar cita"). Requiere una **sede activa** seleccionada. El selector "min base" (15/20/30/45/60) **no tiene efecto**.

#### 3.9.1 Modal "Nueva cita" / "Editar cita" (editar = también reagendar)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Paciente * | Buscador + selección | Sí | Pacientes activos ("Nombre - RUT") | Sub-formulario "Crear paciente" (3.5.2) |
| Servicio | Texto con sugerencias | No | Limpieza dental (default) · Ortodoncia · Extraccion · Blanqueamiento · Endodoncia · Radiografia · Consulta inicial · Control post-op (o texto libre) | Se guarda también como título de la cita. **Las palabras del servicio disparan las reglas de recordatorio automático** al completar |
| Consultorio * | Selección | Sí | Box 1 · Box 2 · Box 3 · Box 4 · Box 5 · Sala RX · Pabellón menor (mostrados como "Consultorio N") | Lista fija de texto, no relacionada con los consultorios de Ajustes → Sedes |
| Profesional | Selección | No | "Por asignar" + profesionales ("{nombre} - {especialidad}") | Si se asigna, se valida su horario semanal, sus bloqueos y solapes |
| Motivo | Texto | No | ≤ 150 | — |
| Fecha * | Fecha | Sí | Default: día seleccionado | — |
| Hora inicio * | Hora (pasos de 15 min) | Sí | Default 09:00 | — |
| Duración | Selección | Sí | 15 · 30 (default) · 45 · 60 · 90 · 120 min | Calcula la hora de término |
| Notas | Área de texto | No | ≤ 10.000 | — |
| (oculto) Sede | — | Sí | Sede activa | Error "No hay una sede válida seleccionada" si falta |

Al crear se envía correo de confirmación al paciente (si tiene correo) y se espeja en DentalCloud (en el "Sillón externo"). Al reagendar se guarda historial con las horas anteriores.

#### 3.9.2 Cambios de estado (select inline o botones del panel de detalle)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Estado | Selección / botones (Confirmar, Iniciar atención, Completar, Marcar no asistió, Cancelar cita) | — | SCHEDULED Agendado · CONFIRMED Confirmado · IN_PROGRESS En atención · COMPLETED Completado (terminal) · CANCELLED Cancelado (terminal) · NO_SHOW No asistió | Al pasar a COMPLETED se genera el recordatorio automático. El tiempo entre la hora agendada y "En atención" alimenta el reporte "Demora en pasar a atender" |
| Motivo (al cancelar o marcar no asistió) | Selección (modal) | Sí | Cancelación: PATIENT_CANCELLED · DOCTOR_UNAVAILABLE · RESCHEDULED · SCHEDULING_ERROR · ADMINISTRATIVE_ISSUE · CLINIC_CLOSED · OTHER. No asistió: FORGOT_APPOINTMENT · COULD_NOT_CONTACT · TRANSPORT_ISSUE · PERSONAL_EMERGENCY · HEALTH_ISSUE · UNKNOWN · OTHER | — |
| Observación (al cancelar / no asistió) | Área de texto | Sí si el motivo es OTHER | ≤ 500 | — |

Monitor de sala (`/agenda/monitor`): botón "Llamar siguiente" (pasa la primera cita en espera a "En atención"); el indicador "Espera prom." es un guion fijo, no se calcula.

### 3.10 Recordatorios y reglas automáticas

- **Rol:** AGENDA_MANAGE o PATIENTS_MANAGE_ASSIGNED. **Pantalla:** Agenda → Recordatorios (`/agenda/recordatorios`).

#### 3.10.1 Modal "Nuevo recordatorio" / "Editar recordatorio" — **NO GUARDA (error 400)**

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Paciente * | Buscador + selección | Sí | "Nombre - RUT" | — |
| Tipo * | Selección | Sí | GENERAL (default) · CHECKUP Control · CLEANING Limpieza · POST_TREATMENT Post tratamiento · ORTHODONTIC_CONTROL Control de ortodoncia · IMPLANT_CONTROL Implante · SURGERY_FOLLOW_UP Cirugía | Enviado como `type` (servidor: `reminderType`) |
| Fecha objetivo * | Fecha | Sí | — | Enviado como `targetDate` (servidor: `dueDate`) |
| Título * | Texto | Sí | Ej. "Control posterior a tratamiento" | — |
| Profesional | Selección | No | "Sin asignar" + profesionales | — |
| Sede | Selección | No | "Sin sede específica" + sedes | — |
| Prioridad | Selección | Sí | LOW Baja · NORMAL Normal · HIGH Alta | — |
| Método de contacto | Texto | No | Ej. "Teléfono, WhatsApp, email" | — |
| Descripción | Área de texto | No | — | — |
| Notas | Área de texto | No | — | — |

#### 3.10.2 Acciones sobre recordatorios existentes (sí funcionan)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Estado (botones Contactado · Agendado · Completado · Cancelar) | Botón | — | PENDING Pendiente · OVERDUE Vencido · CONTACTED Contactado · SCHEDULED Agendado · COMPLETED Completado · CANCELLED Cancelado | Sobre recordatorios automáticos (origen "Automático") |
| "Agendar seguimiento" → modal "Nueva cita de seguimiento": Paciente *, Fecha *, Sede *, Hora inicio * (09:00), Hora fin * (09:30, > inicio), Consultorio * (Box 1–5, Sala RX, Pabellón menor), Profesional, Servicio (default: título del recordatorio), Motivo, Notas | Formulario | Según se indica | — | Crea la cita y marca el recordatorio como Agendado |

#### 3.10.3 Modal "Nueva regla" / "Editar regla" — **falla al guardar (error 400)**

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre de regla * | Texto | Sí | ≤ 120, único por clínica | — |
| Tipo de recordatorio * | Selección | Sí | GENERAL (default) · CLEANING · ORTHODONTIC_CONTROL · SURGERY_FOLLOW_UP · IMPLANT_CONTROL | El servidor admite además CHECKUP y POST_TREATMENT (no ofrecidos) |
| Palabras clave | Texto separado por comas | Sí si el tipo no es GENERAL | Se comparan con el servicio de la cita | — |
| Tiempo * | Número ≥ 1 | Sí | — | — |
| Unidad * | Selección | Sí | DAYS Días · MONTHS Meses (default) | — |
| Prioridad * | Selección | Sí | LOW · NORMAL (default) · HIGH · **URGENT** | URGENT no existe en el servidor (400) |
| Activa | Casilla | — | Default Sí | El servidor **no acepta** este campo al crear ni al editar → 400 ("a verificar en la web" si algún caso llega a guardarse) |

Sobre reglas ya existentes sí funcionan "Desactivar/Activar" y "Eliminar".

### 3.11 Prestaciones y previsiones

- **Rol:** CLINICAL_RECORD_* (crear/editar requiere gestión). Requiere feature **TREATMENT_PLANS**. **Pantallas:** Operaciones → Prestaciones (`/operaciones/prestaciones`), Operaciones → Previsiones (`/operaciones/previsiones`). Alta inline y tabla editable.

#### 3.11.1 Prestaciones

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre | Texto | Sí | ≤ 180 (ej. "Destartraje, Resina, Corona") | El modo se infiere por palabras clave. **No editable después** |
| Código (opcional) | Texto | No | ≤ 60 | Se usa para vincular con DentalCloud. **No editable después** |
| Precio | Número ≥ 0 | No | Default 0 | Editable inline (guarda al salir) |
| Modo en el odontograma | Selección | — | session Sesión (toda la boca) · tooth Pieza completa (default) · surface Cara · extraction Extracción · cuadrante Cuadrante · sextante Sextante · arcada Arcada | Editable inline |
| Requiere producto y lote | Casilla | — | Default No | Obliga a elegir un lote real del inventario al planificar. Editable inline ("Lote real") |
| Estado (tabla) | Interruptor / "Desactivar" | — | Activa / Inactiva | — |

No existen aquí categoría dental/estética, zonas faciales ni precio por zona (esos atributos son exclusivos de DentalCloud y no viajan).

#### 3.11.2 Previsiones

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre | Texto | Sí | ≤ 150 (ej. Fonasa, Isapre, Particular) | No editable después |
| Estado (tabla) | Interruptor / "Desactivar" | — | Activa / Inactiva | — |

### 3.12 Planes de tratamiento (dental y estético)

- **Rol:** CLINICAL_RECORD_MANAGE (CLINIC_OWNER, PROFESSIONAL). Requiere feature **TREATMENT_PLANS** (y ESTHETIC_TREATMENTS para el mapa facial). **Pantalla:** `/pacientes/:id/planes-tratamiento` → "Nuevo plan" (asistente de 3 pasos), "Editar", "Nuevo procedimiento". Requisitos: al menos un **convenio activo** (obligatorio), prestaciones; para estética: profesional habilitado, consultorio con estética y (opcional) consentimiento estético; para trazabilidad: lotes con stock en Inventario.

#### 3.12.1 Asistente "Nuevo plan" — Paso 1 Datos administrativos

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Tipo de plan | Selección | Sí | Dental · Estético orofacial | Bloqueado cuando ya hay ítems |
| Previsión | Selección | No | "Sin especificar" + previsiones activas | Informativa |
| Convenio * | Selección | Sí | Convenios activos "{nombre} (-X%)" | Solo aplica descuento si el convenio es de tipo Porcentaje |
| Profesional | Selección | No | "Sin profesional asignado" + personal activo (estético: solo habilitados) | — |
| Consultorio estético sugerido | Selección (solo estético) | No | Salas con estética "{nombre · sede}" | — |
| Consentimiento estético asociado | Selección (solo estético) | No | Consentimientos activos del paciente cuyo texto mencione "estetic/orofacial" | — |

#### 3.12.2 Paso 2 — Prestaciones (por procedimiento)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Buscar prestación | Autocompletar (hasta 8) | Sí | Prestaciones activas | Fija nombre, precio de lista, precio con descuento y modo. "Avanzada"/"Plantillas" deshabilitados |
| Buscar lote real por producto o N° de lote | Autocompletar (≥ 2 caracteres) sobre lotes con stock > 0 | Sí si la prestación exige lote | Muestra "{producto} — Lote {n}", stock y vencimiento | Copia producto, lote y vencimiento como texto; **no** descuenta stock ni guarda el id del lote |
| Producto | Texto (solo sin trazabilidad) | No | Ej. "Ácido Hialurónico" | — |
| N° de lote | Texto | No | — | — |
| Fecha de vencimiento | Fecha | No | — | — |
| Cantidad | Texto | No | Ej. "1 jeringa 1ml" | — |
| Notas clínicas | Área de texto | No | Ej. "reacción del paciente" | Se guarda como descripción del ítem |
| Odontograma (dental) | Odontograma interactivo | Sí salvo modo Sesión | Piezas 1.8–1.1, 2.1–2.8, 4.8–4.1, 3.1–3.8; temporales 5.5–5.1, 6.1–6.5, 8.5–8.1, 7.1–7.5; caras superior/derecha/inferior/izquierda/central; cuadrantes; sextantes S1–S6; arcada superior/inferior | Modo fijado por la prestación; genera una línea por pieza en modos pieza/extracción/cara. Se guarda como texto ("Piezas: 1.1 y 2.1", "Cuadrante 1", "1.1: superior, derecha") |
| Mapa facial (estético) | Mapa interactivo: vistas frontal/perfil/todas, zoom 1–2×, clic en zona o chip | Sí ("Selecciona al menos una zona") | 14 zonas: Frente · Entrecejo · Sienes · Párpados · Patas de gallo · Ojeras · Pómulos · Nariz · Nasogenianos · Código de barras · Labios · Mentón · Mandíbula · Cuello (en perfil 11) | Se guarda como etiquetas en español separadas por coma. **Sin herramientas de dibujo** (a diferencia de DentalCloud) |
| Mujer / Hombre (conmutador del mapa) | Conmutador | — | mujer (default) · hombre | Género del mapa facial del plan |
| Precio (en "Prestaciones agregadas") | Número editable por ítem | — | Precio unitario con descuento | — |

#### 3.12.3 Paso 3 — Totales y forma de pago

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre del plan * | Texto | Sí | ≤ 180 (ej. "Plan rehabilitación oral") | — |
| Forma de pago | Selección | No | Contado (default) · Cuotas | **No se muestra en ninguna pantalla ni se puede editar después** |
| Observaciones generales | Área de texto | No | — | — |

#### 3.12.4 Modal "Editar plan"
Campos: Tipo de plan, Título (obligatorio), Observaciones generales, Previsión, Convenio (aquí opcional), Profesional, Consultorio y Consentimiento (solo estético). **No** expone forma de pago ni género facial.

#### 3.12.5 Modal "Nuevo procedimiento" / "Editar procedimiento" (ítem)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Buscar prestación del catálogo | Autocompletar (hasta 6) | Sí | — | Sin prestación del catálogo no se puede agregar un ítem ("fuera de catálogo" inalcanzable) |
| Nombre | Texto | Sí | ≤ 180 | Visible tras elegir prestación |
| Descripción | Área de texto | No | — | — |
| Cantidad | Número ≥ 1 | No | Default 1 | DentalCloud no tiene cantidad: al espejarse viaja cantidad × precio |
| Precio unitario (con -X % aplicado) | Número ≥ 0 | No | Precalculado | — |
| Orden | Número ≥ 0 | No | — | — |
| Lote real / Producto / N° de lote / Fecha de vencimiento / Cantidad | Igual que 3.12.2 | — | — | — |
| Notas clínicas | Área de texto | No | — | **No se envía** (se pierde) |
| Pieza(s) / zona | Odontograma (dental) o mapa facial (estético) | No | — | Al editar un ítem dental la selección de piezas arranca vacía y sobrescribe la anterior |
| Estado del ítem (tabla) | Selección | — | PENDING Pendiente · IN_PROGRESS En curso · COMPLETED Completado · CANCELLED Cancelado | "Cancelar" lo marca CANCELLED y lo quita del espejo |

#### 3.12.6 Estado del plan (tarjeta)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Estado | Selección | — | DRAFT Borrador · PROPOSED Propuesto · ACCEPTED Aceptado · IN_PROGRESS En curso · COMPLETED Completado · CANCELLED Cancelado · ARCHIVED Archivado | Archivar = botón aparte. Hacia DentalCloud solo viaja "alta" cuando está COMPLETED/ARCHIVED |
| Descargar presupuesto | Botón | — | PDF | — |

Las fotos Antes/Después de los ítems y los trazos del mapa facial se **ven** en Dental-Demo pero **solo pueden crearse en DentalCloud** (llegan por federación).

### 3.13 Cotizaciones (documento comercial)

- **Rol:** QUOTES_MANAGE (CLINIC_OWNER, LOCATION_MANAGER, RECEPTIONIST). **Pantallas:** `/cotizaciones` (listado y pestaña Seguimiento), `/cotizaciones/nueva`, `/cotizaciones/:id`. Una cotización nace en Borrador; al emitirla recibe número COT-AAAA-000001. El IVA (19 % de la clínica) va **incluido** en el total y se desglosa.

#### 3.13.1 Formulario principal

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Paciente * | Autocompletar (solo al crear) | Sí | Pacientes activos "{nombre} - {RUT}" | No se cambia después |
| Sede * | Selección | Sí | Sedes accesibles | — |
| Profesional (opcional) | Selección | No | Profesionales elegibles de la sede (solo dentistas) | Necesario para que el ingreso resultante entre en liquidaciones |
| Fecha de vigencia (opcional) | Fecha | No | No puede estar en el pasado (bloquea "Emitir") | — |
| Observaciones administrativas | Área de texto | No | ≤ 2.000, sin HTML ("no incluyas diagnósticos") | Al vaciarlo no se borra el valor anterior |
| Observaciones para el paciente | Área de texto | No | — | **Solo en modo vista previa de desarrollo; no se envía** |
| Motivo de edición | Área de texto (ventana) | Sí para editar una cotización Aceptada | ≤ 500 | — |

#### 3.13.2 Ítems de la cotización (modal por ítem)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Tipo de ítem | Pestañas | Sí | MANUAL "Prestación" · INVENTORY_SUPPLY "Insumo" | Insumo: buscador de inventario por nombre o código |
| Prestación * (manual) / Insumo (lectura) | Texto ≤ 200 / selección | Sí si manual | — | — |
| Descripción administrativa (opcional) | Área de texto ≤ 2.000 | No (solo manual) | — | — |
| Cantidad * | Número entero ≥ 1 | Sí | Default 1 | — |
| Precio unitario * | Número ≥ 0 | Sí | Insumo: default precio de venta o costo unitario | — |
| Tipo de descuento | Selección | No | Sin descuento · Porcentaje · Monto fijo | Requiere permiso QUOTES_APPROVE_DISCOUNT |
| Descuento (%) / (monto) | Número | No | % 0–100; monto ≤ subtotal de la línea | — |

Hasta 100 ítems.

#### 3.13.3 Transiciones y seguimiento

| Campo / acción | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Estado | Botones con confirmación | — | DRAFT Borrador → ISSUED Emitida (asigna número) / CANCELLED; ISSUED → ACCEPTED Aceptada / REJECTED Rechazada / CANCELLED; ACCEPTED → CANCELLED | Emitir requiere ítems y vigencia no vencida |
| Motivo de la cancelación | Área de texto | Sí al cancelar una Aceptada | ≤ 500 | **Desde el listado la cancelación de una Aceptada falla (400)** porque no pide motivo; usar la pantalla de detalle |
| Seguimiento del tratamiento | Botones | — | NOT_STARTED No iniciado · IN_PROGRESS En tratamiento | Solo cotizaciones Aceptadas |
| Registrar contacto → "Seleccionar próxima fecha" | Fecha | No | — | Guarda último contacto y próximo seguimiento |
| Contactar por WhatsApp → mensaje | Área de texto | — | Texto por defecto | Abre WhatsApp en el navegador; no se guarda el mensaje; luego pide la próxima fecha |
| Enviar recordatorio | Botón con confirmación | — | — | Crea recordatorio QUOTE_FOLLOW_UP y envía correo al paciente |
| Descargar PDF | Botón | — | Solo con número (no Borrador) | — |

El modal "Configurar cobertura" (Particular/Fonasa/Isapre/Otro, aseguradora, monto/porcentaje, referencia) **solo existe en modo desarrollo y no guarda**.

### 3.14 Cobranza (órdenes de cobro)

- **Rol:** COLLECTIONS_MANAGE (CLINIC_OWNER, LOCATION_MANAGER). **Pantallas:** detalle de cotización Aceptada → "Crear orden de cobro"; Finanzas → Cobranza (`/finanzas/cobranza`) → "Registrar pago" / "Cancelar orden". La orden recibe número COB-AAAA-000001.

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Cobertura del paciente | Opción | Sí | NONE "Particular / Sin cobertura" (default) · FONASA "Fonasa" · ISAPRE "Isapre" | — |
| Nombre de ISAPRE / aseguradora | Texto ≤ 120 | No (solo Isapre) | — | — |
| Monto cubierto | Número 0..total | No | Debe ser 0 si es Particular; ≤ total | Monto paciente = total − cobertura; si queda 0 la orden nace "Cubierta" |
| Registrar pago · Medio de pago | Opción | Sí | CASH Efectivo (default) · DEBIT_CARD Débito · CREDIT_CARD Crédito | Paga siempre el monto completo del paciente (sin parciales). **Crea automáticamente un Ingreso** vinculado a paciente, cotización, sede y profesional |
| Cancelar orden | Botón | — | Estados: PENDING Pendiente · PAID Pagada · COVERED Cubierta · CANCELLED Cancelada | Solo pendientes o cubiertas |

### 3.15 Finanzas → Ingresos

- **Rol:** FINANCE_OPERATE. Requiere feature **ADVANCED_FINANCE**. **Pantalla:** `/finanzas/ingresos` → "Nuevo ingreso" / "Editar ingreso".

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre del ingreso * | Texto | Sí | ≤ 150 | — |
| Categoría | Selección | No | Consulta · Tratamiento (default) · Limpieza dental · Ortodoncia · Estetica dental · Urgencia · Convenio · Abono · Otro | — |
| Sede | Selección | Sí al crear | Sedes accesibles | — |
| Fecha * | Fecha | Sí | Default hoy | — |
| Monto * | Número > 0 | Sí | Entero (CLP) | — |
| Método de pago | Selección | No | CASH Efectivo · CARD Tarjeta (default) · TRANSFER Transferencia · CHECK Cheque · OTHER Otro | — |
| ¿Qué otro método de pago desea ingresar? | Texto | Sí si Otro | Ej. "Vale vista" | — |
| Tipo documento | Texto con sugerencias | No | Boleta electronica · Factura electronica · Boleta manual · Comprobante interno · Nota de credito | — |
| Número documento | Texto | No | ≤ 80 | — |
| Paciente (opcional) | Buscador | No | Pacientes activos | — |
| Cotización vinculada (opcional) | Selección | No | Cotizaciones Aceptadas del paciente "{número} · {total} · {profesional}" | — |
| Plan de tratamiento vinculado (opcional) | Selección | No | Planes del paciente en estado Aceptado / En curso / Completado; muestra saldo pendiente | Alimenta "Pagado" y "Saldo" del plan |
| Tipo de pago | Conmutador | No | FULL "Pago completo" (default) · PARTIAL "Abono parcial" | — |
| Descripción | Área de texto | No | — | — |
| Notas | Área de texto | No | — | — |
| Archivar / Restaurar (tabla) | Botones | — | ACTIVE · ARCHIVED | — |

No hay campo para vincular una cita (el servidor lo aceptaría; la cobranza sí lo hace al pagar).

### 3.16 Finanzas → Gastos

- **Rol:** FINANCE_OPERATE; feature ADVANCED_FINANCE. **Pantalla:** `/finanzas/gastos` → "Nuevo gasto" / "Editar gasto".

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre del gasto * | Texto | Sí | ≤ 150 | — |
| Categoría | Selección | No | Arriendo (default) · Servicios básicos · Sueldos · Insumos · Laboratorio · Marketing · Mantención · Equipamiento · Administración · Otros | — |
| Proveedor | Texto | No | ≤ 120 | — |
| Sede | Selección | Sí al crear | Sedes accesibles (preseleccionada la activa) | — |
| Descripción | Área de texto | No | — | — |
| Fecha * | Fecha | Sí | Default hoy | — |
| Monto * | Número > 0 | Sí | Entero | — |
| Método de pago | Selección | No | CASH Efectivo · CARD Tarjeta · TRANSFER Transferencia (default) · CHECK Cheque · OTHER Otro | — |
| Tipo documento | Texto | No | ≤ 80 | — |
| Número documento | Texto | No | ≤ 80 | — |
| Notas | Área de texto | No | — | — |
| Archivar (tabla) | Botón | — | ACTIVE · ARCHIVED | **No hay restaurar** para gastos |

### 3.17 Finanzas → Convenios

- **Rol:** FINANCE_OPERATE; feature **AGREEMENTS**. **Pantalla:** `/finanzas/convenios` → "Nuevo convenio" / "Editar convenio". Los convenios se usan en los planes de tratamiento (descuento) y se espejan a DentalCloud (solo el porcentaje).

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre | Texto | Sí | ≤ 150 | — |
| Tipo | Selección | No | COMPANY Empresa (default) · INSURANCE Seguro · PARTNER Convenio · INTERNAL Particular · OTHER Otro | — |
| Estado | Selección (solo al editar) | No | ACTIVE · INACTIVE · EXPIRED Vencido · EXPIRING_SOON Próximo a vencer · ARCHIVED | El servidor solo admite ACTIVE, INACTIVE, EXPIRED, ARCHIVED (EXPIRING_SOON es un filtro visual) — **a verificar en la web** |
| Nombre contacto | Texto | No | ≤ 150 | — |
| Email contacto | Correo | No | — | — |
| Teléfono contacto | Texto | No | ≤ 50 | — |
| Descripción | Área de texto | No | — | — |
| Tipo descuento | Selección | No | PERCENTAGE Porcentaje (default) · FIXED_AMOUNT Monto fijo · CUSTOM Personalizado · NONE Sin descuento | Solo "Porcentaje" descuenta en los planes y viaja a DentalCloud; "Sin descuento" no limpia un tipo anterior al editar |
| Valor descuento | Número ≥ 0 (paso 0,01) | No | Solo con Porcentaje o Monto fijo | — |
| Fecha inicio / Fecha término | Fecha / Fecha | No | Término ≥ inicio | — |
| Notas | Área de texto | No | — | — |
| Archivar (tabla) | Botón | — | — | — |

### 3.18 Finanzas → Liquidaciones por profesional

- **Rol:** FINANCE_OPERATE (el PROFESSIONAL solo ve las suyas). Requiere feature **LIQUIDATIONS**. **Pantalla:** `/finanzas/liquidaciones` → "Nueva liquidación" / "Editar liquidación". Requiere **ingresos** previos vinculados al profesional (vía cita o cotización) y aún no liquidados.

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Tipo de liquidación | Conmutador (solo al crear) | — | DETAILED "Detallada por atenciones" · MANUAL "Manual" | Solo controla el formulario; no se guarda |
| Periodo * | Mes | Sí | AAAA-MM; default mes actual | — |
| Profesional | Selección | Sí en Detallada | Personal activo | — |
| Fecha desde / Fecha hasta | Fecha / Fecha | Sí en Detallada | Default 1er y último día del mes | Filtra los ingresos elegibles |
| Titulo * | Texto | Sí | ≤ 180 | — |
| Total bruto | Número ≥ 0 | No | Solo lectura en Detallada (suma de los ítems) | — |
| Descuentos | Número ≥ 0 | No | Default 0 | Neto = bruto − descuentos + bonos |
| Bonos | Número ≥ 0 | No | Default 0 | — |
| Método de pago | Selección | No | CASH Efectivo · TRANSFER Transferencia (default) · CHECK Cheque · OTHER Otro | — |
| Fecha de pago | Fecha | No | — | — |
| Tipo documento / Número documento | Texto / Texto | No | ≤ 80 | — |
| Porcentaje (aplicar a seleccionados) | Número 0–100 | — | — | Ayuda local; no se guarda |
| Ingresos disponibles (tabla con casilla por fila: Fecha de atención, Paciente, Sede, Servicio, Monto pagado, Método) | Casillas | ≥ 1 en Detallada | Ingresos no liquidados del profesional en el período | Cada ingreso solo puede liquidarse una vez |
| Tipo de cálculo (por fila) | Selección | Sí en Detallada | PERCENTAGE Porcentaje · FIXED Monto fijo | — |
| Valor (por fila) | Número | Sí en Detallada | % 0–100 o monto ≤ monto pagado | — |
| Notas | Área de texto | No | — | — |
| Estado (tabla) | Botones "Marcar lista" / "Marcar pagada" / "Archivar" | — | DRAFT Borrador · READY Lista · PAID Pagada · CANCELLED · ARCHIVED | Los ítems no se pueden editar después de crear |

### 3.19 Inventario (insumos, lotes, movimientos)

- **Rol:** INVENTORY_MANAGE (CLINIC_OWNER, LOCATION_MANAGER). Requiere feature **ADVANCED_FINANCE**. **Pantalla:** Operaciones → Inventario (`/operaciones/inventario`). El mismo inventario lo administra DentalCloud por federación (2.15) y lo consultan los planes/presupuestos de ambas plataformas para "lote real".

#### 3.19.1 Modal "Nuevo insumo" / "Editar insumo"

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre del insumo * | Texto | Sí | ≤ 150 | — |
| Sede * | Selección | Sí | Sedes accesibles | — |
| Consultorio | Selección | No | Sin consultorio asignado · Consultorio 1 · Consultorio 2 · Consultorio 3 · Consultorio 4 · Consultorio 5 · Sala RX · Pabellón menor | Lista fija de texto |
| Categoría | Selección | No | Desechables (default) · Bioseguridad · Anestesia · Restauracion · Ortodoncia · Higiene dental · Instrumental · Radiologia · Laboratorio · Otros | — |
| Proveedor | Texto | No | ≤ 120 | — |
| Imagen | Archivo jpeg/png/webp ≤ 10 MB | No | — | Se sube aparte tras guardar |
| Descripción | Área de texto | No | — | — |
| Fecha de compra | Fecha | No | Default hoy | — |
| Unidad | Selección | No | unidad · caja · paquete · frasco · tubo · ml · kit | — |
| Cantidad comprada | Número ≥ 0 | No | — | — |
| Costo unitario | Número ≥ 0 | No | — | — |
| Costo total | Número ≥ 0 | No | Calculado (cantidad × unitario) si ambos existen | — |
| Stock actual | Solo lectura | — | Al crear se fija en 0 | "El stock se administra mediante lotes y movimientos" |
| Stock mínimo | Número ≥ 0 | No | — | Genera alerta de bajo stock |
| Archivar (tabla) | Botón | — | Estados: ACTIVE · LOW_STOCK · OUT_OF_STOCK · ARCHIVED | — |

Tras crear, la pantalla propone registrar el primer lote.

#### 3.19.2 Modal "Nuevo lote" / "Editar lote" (drawer "Lotes de {insumo}")

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Número de lote * | Texto ≤ 120 | Sí | Letras, números, espacios, puntos y guiones; único por insumo | — |
| Fabricante | Texto | No | ≤ 120 | — |
| Presentacion | Texto | No | ≤ 120 | — |
| Concentracion | Texto | No | ≤ 120 | — |
| Registro sanitario | Texto | No | ≤ 120 (registro ISP) | — |
| Fecha de recepcion | Fecha | No | — | — |
| Fecha de vencimiento | Fecha | No | Vacío = sin vencimiento | Estados de vencimiento: ACTIVE · EXPIRING · EXPIRED · NO_EXPIRATION |
| Cantidad inicial * (crear) / Cantidad actual * (editar) | Número ≥ 0 (paso 0,01) | Sí | — | Al disminuir pide confirmación |
| Etiqueta del lote (modal "Etiqueta") | Archivo jpeg/png/webp ≤ 10 MB | No | — | Subir / reemplazar / eliminar |

#### 3.19.3 Movimientos de un lote ("Registrar entrada" / "Registrar salida")

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Tipo | Botón de origen | Sí | IN Entrada · OUT Salida (ADJUSTMENT "Ajustar stock" existe en el modal pero **no hay botón que lo abra**) | — |
| Cantidad * | Número ≥ 1 | Sí | — | — |
| Motivo | Texto | Sí solo en ajuste | ≤ 500 | — |

### 3.20 Cotizaciones de compra y recepciones

- **Rol:** INVENTORY_MANAGE; feature ADVANCED_FINANCE. **Pantalla:** Operaciones → Cotizaciones de compra (`/operaciones/inventario/cotizaciones-compra`). Número CPC-AAAA-000001; la recepción genera REC-AAAA-000001 y crea insumos nuevos, lotes y movimientos de entrada.

#### 3.20.1 Formulario de cotización de compra

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Proveedor * | Texto ≤ 150 | Sí | — | — |
| RUT proveedor | Texto ≤ 20 con formato chileno | No | RUT válido si se completa | — |
| Contacto | Texto ≤ 200 | No | — | — |
| Sede * | Selección (bloqueada al editar) | Sí | Sedes con permiso de gestión | — |
| Fecha cotización | Fecha | No | — | — |
| Válida hasta | Fecha | No | — | — |
| Despacho | Número ≥ 0 | No | — | — |
| Descuento general | Número ≥ 0 | No | — | — |
| Notas | Área de texto ≤ 2.000 | No | — | — |
| Ítem · "+ Agregar insumo existente" | Buscador de inventario (por sede) | — | — | Toma nombre y unidad del insumo |
| Ítem · Nombre * (nuevo) | Texto ≤ 200 | Sí si es nuevo | — | — |
| Ítem · Descripción (nuevo) | Texto ≤ 2.000 | No | — | — |
| Ítem · Unidad * | Texto ≤ 60 | Sí si es nuevo | — | — |
| Ítem · Cantidad * | Número > 0 (paso 0,01) | Sí | Default 1 | — |
| Ítem · Costo unitario * | Número ≥ 0 | Sí | — | — |
| Ítem · Descuento | Número ≥ 0 | No | — | — |
| Estado (tabla) | Botones | — | DRAFT Borrador → RECEIVED Recibida / CANCELLED; RECEIVED → APPROVED Aprobada / REJECTED Rechazada / CANCELLED | Solo Borrador/Recibida son editables; "Comparar" hasta 4 cotizaciones |

#### 3.20.2 Modal "Registrar recepción" (solo cotizaciones Aprobadas; una por cotización)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Fecha recepción | Fecha | No | Default ahora | — |
| N° documento | Texto ≤ 80 | No | Documento del proveedor | — |
| Fecha documento | Fecha | No | — | — |
| Notas | Área de texto ≤ 2.000 | No | — | — |
| Por ítem · Cantidad / Costo unitario | Solo lectura | — | Se recibe la cantidad completa cotizada | No se puede recibir parcialmente |
| Por ítem · Número de lote * | Texto ≤ 120 | Sí | Letras/números/espacios/puntos/guiones | Crea el lote |
| Por ítem · Fecha de vencimiento | Fecha | No | — | — |
| Por ítem nuevo · Categoría | Texto ≤ 80 | No | — | Solo para insumos que no existían |
| Por ítem nuevo · Stock mínimo | Número ≥ 0 | No | — | — |
| Por ítem nuevo · Consultorio | Texto ≤ 80 | No | — | — |

### 3.21 Equipos

- **Rol:** EQUIPMENT_MANAGE (CLINIC_OWNER, LOCATION_MANAGER). **Pantalla:** Operaciones → Equipos (`/operaciones/inventario/equipos`) → "Nuevo equipo" / "Editar equipo".

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Sede * | Selección | Sí | Sedes accesibles (default activa) | — |
| Consultorio | Selección | No | "Sin consultorio asignado" + salas activas compatibles con la sede y el área (dental/estética) | Usa los consultorios reales de Ajustes → Sedes |
| Responsable | Selección | No | "Por asignar" + personal activo de la sede | — |
| Nombre * | Texto | Sí | ≤ 150 | — |
| Categoría | Texto libre | No | ≤ 80 | Sin catálogo |
| Área clínica | Selección | Sí | DENTAL (default) · ESTHETIC · BOTH | Estética/ambas requieren el módulo de estética |
| Estado | Selección | Sí | ACTIVE (default) · IN_MAINTENANCE En mantención · OUT_OF_SERVICE Fuera de servicio · RETIRED Retirado · LOST Perdido | — |
| Marca / Modelo | Texto / Texto | No | ≤ 100 | — |
| Número de serie | Texto | No | ≤ 120, único por clínica (409 si se repite) | — |
| Código interno | Texto | No | ≤ 120, único por clínica | — |
| Proveedor | Texto | No | — | **Si se completa, el guardado falla con 400** (la pantalla envía `supplier`; el servidor espera `supplierName`). Dejarlo vacío |
| Imagen | Archivo jpeg/png/webp ≤ 10 MB | No | — | Se sube aparte |
| Fecha de compra | Fecha | No | — | — |
| Costo de compra | Número ≥ 0 | No | — | — |
| Garantía | Fecha | No | — | Alerta "próxima a vencer" ≤ 30 días |
| Última mantención / Próxima mantención | Fecha / Fecha | No | Próxima ≥ última | — |
| Última calibración / Próxima calibración | Fecha / Fecha | No | Próxima ≥ última | — |
| Activo | Casilla (solo al editar) | — | Default Sí | — |
| Notas | Área de texto | No | — | — |
| Archivar (tabla) | Botón con confirmación | — | Pasa a RETIRED e inactivo | — |

### 3.22 Simulación estética con IA

- **Rol:** CLINIC_OWNER o PROFESSIONAL. Requiere features **ESTHETIC_TREATMENTS + ESTHETIC_AI_SIMULATION** y OpenAI configurado (si no, error 503 al generar). Límite: 20 generaciones diarias por clínica. **Pantalla:** Operaciones → Simulación estética IA.

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Seleccionar paciente | Selección | Sí | Pacientes (hasta 100) | — |
| Sede | Selección | Sí | Sedes | — |
| Tratamiento proyectado | Selección | No | Planes estéticos del paciente | — |
| Tipo de tratamiento | Selección | Sí | FACIAL_HARMONIZATION Armonización facial · LIP_AUGMENTATION Aumento de labios · BOTULINUM_TOXIN Toxina botulínica · DERMAL_FILLER Relleno dérmico · FACIAL_CONTOURING Contorno facial · SMILE_DESIGN Diseño de sonrisa (default) · TEETH_WHITENING Blanqueamiento dental · OTHER_ESTHETIC Otro estético | — |
| Consentimiento para procesamiento mediante IA | Selección | Sí | Consentimientos activos, no vencidos, con propósito ESTHETIC_AI_SIMULATION | **Bloqueante**: ese propósito no se puede asignar a una plantilla desde la web (3.7.1), así que el selector queda vacío salvo que exista una plantilla creada por script/API |
| Fotografía original | Archivo JPEG/PNG/WEBP ≤ 10 MB | Sí | — | Se sube tras crear (privada, con URL firmada) |
| Acepto el aviso de simulación orientativa | Casilla | Sí | — | — |
| Generar simulación / Descartar / Eliminar | Botones | — | Estados: PENDING · PROCESSING · COMPLETED · FAILED · DISCARDED | — |

### 3.23 Marketing con IA

- **Rol:** MARKETING_CREATE (CLINIC_OWNER, LOCATION_MANAGER, MARKETING_MANAGER). Requiere feature **MARKETING_AI**, plan con IA y OpenAI configurado. **Pantalla:** `/marketing-ia` (asistente de 4 pasos + editor de piezas). Lo que se **guarda** es la campaña (nombre, servicio, audiencia, objetivo, textos, imágenes, estado del editor, plantilla/estilo/paleta, estado) y las "simulaciones" (imágenes en la galería).

#### 3.23.1 Paso 1 — Brief ("Cuéntanos sobre tu campaña")

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Objetivo * | Área de texto | Sí | ≤ 500 | Se guarda en la campaña |
| Servicio * | Texto | Sí | ≤ 200 | Se guarda |
| Audiencia * | Texto | Sí | ≤ 300 | Se guarda |
| Tono * | Selección | Sí | PROFESSIONAL Profesional (default) · FRIENDLY Cercano · EDUCATIONAL Educativo · PROMOTIONAL Promocional | Solo se usa para generar; **no se guarda** en la campaña |
| Oferta o promoción | Texto | No | ≤ 200 | No se guarda |
| Nombre de clínica | Texto | No | ≤ 160 | No se guarda |
| Sucursal | Texto | No | Default sede primaria | No se guarda |
| Instrucciones adicionales | Área de texto | No | ≤ 800 | No se guarda |

#### 3.23.2 Paso 2 — Texto generado (editable)

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Caption para la publicación | Área de texto | — | ≤ 10.000 | Texto principal de la campaña |
| Versión corta | Área de texto | — | ≤ 2.000 | — |
| Hashtags | Área de texto | — | ≤ 2.000 | — |
| Llamado a la acción | Texto | — | ≤ 200 | — |
| Texto alternativo | Área de texto | — | ≤ 1.000 | — |

#### 3.23.3 Paso 3 — Imagen

| Campo | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Modo de imagen | Pestañas | — | Generar con IA · Usar biblioteca · Editar una imagen existente · Editar propuesta | — |
| Generar · Tipo de pieza | Tarjetas | Sí | PHOTO Fotografia promocional (default) · POST_BACKGROUND Post con texto · FLYER_BACKGROUND Flyer promocional | — |
| Generar · Descripción de la imagen * | Área de texto | Sí | ≤ 2.000 | — |
| Generar · Formato de imagen * | Selección | Sí | SQUARE Cuadrado (default, 1024×1024) · INSTAGRAM_STORY Vertical (1024×1536) · FACEBOOK_POST Horizontal (1536×1024) | — |
| Generar · Calidad * | Selección | Sí | low Baja (default) · medium Media · high Alta | — |
| Generar · Cantidad de propuestas * | Selección | Sí | 1 · 3 | — |
| Generar · Confirmo que tengo derecho a utilizar… | Casilla | Sí | — | — |
| Biblioteca · imagen | Galería | — | veneers-01, esthetic-evaluation-01, cleaning-01, orthodontics-01, dental-checkup-01, modern-clinic-01 (categorías Carillas dentales, Higiene dental, Ortodoncia, Evaluacion, Clínica) | — |
| Editar imagen · Imagen * | Archivo png/jpeg/webp ≤ 10 MB | Sí | — | — |
| Editar imagen · Cambios solicitados * | Área de texto | Sí | — | — |
| Editar imagen · Formato / Calidad | Selección | Sí | Igual que Generar | — |
| Editar imagen · Confirmación de derechos | Casilla | Sí | — | — |
| Editar imagen · ¿Contiene paciente identificable? | Opción Sí/No | Sí | Default No | Si Sí, bloquea "Guardar simulación"; no se guarda en la campaña |
| Editar imagen · Confirmo que cuento con autorización del paciente | Casilla | Sí si contiene paciente | — | — |

#### 3.23.4 Editor de piezas (lienzo)
Todo lo del editor se guarda como "estado del editor" de la campaña, más la plantilla, el estilo visual y la paleta elegidos.

| Panel | Campo | Tipo de dato | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Diseño rápido | Plantilla de diseño | Selección | clean-modern Limpio moderno · dental-tips Consejos dentales · badge-promo Promocion con badge · diagonal-panel Panel diagonal · premium-flyer Flyer premium · benefits-focus Beneficios destacados · offer-highlight Oferta destacada · before-booking Antes de agendar · clinic-card Tarjeta clínica · educational-post Post educativo · split-ad Flyer dividido | Se guarda como plantilla de la campaña |
| Diseño rápido | Estilo visual | Selección | clean Profesional limpio (default) · premium Premium elegante · commercial Comercial llamativo · educational Educativo visual · impact Alto impacto | Se guarda |
| Diseño rápido | Paleta rápida | Selección | dental-teal Turquesa dental (default) · professional-blue Azul profesional · premium-navy Azul oscuro premium · health-green Verde salud · esthetic-purple Morado estético · premium-gold Dorado premium | Se guarda |
| Diseño rápido | Densidad del diseño | Selección | light Ligero · balanced Equilibrado · complete Completo | — |
| Diseño rápido | Color principal / secundario / de texto | Color | Default #0891b2 / #0f172a / #ffffff | — |
| Diseño rápido | Tipografia | Selección | Arial · Georgia · Verdana · Trebuchet MS | — |
| Diseño rápido | Alineación | Selección | Izquierda · Centro · Derecha | — |
| Contenido | Etiqueta | Texto | Ej. "Nuevo servicio" / "Cupos disponibles" | — |
| Contenido | Título | Texto ≤ 80 | Default: servicio del brief | — |
| Contenido | Subtítulo | Área de texto | Default: oferta / caption corto | — |
| Contenido | Beneficios | Hasta 3 textos | — | — |
| Contenido | Botón de llamada a la acción | Texto | Default: CTA generado | — |
| Contenido | Teléfono o WhatsApp | Texto | — | — |
| Contenido | Sitio web | Texto | — | — |
| Contenido | Nombre de clínica | Texto | — | — |
| Contenido | Bloque destacado / Texto del bloque destacado | Texto / Área de texto | — | — |
| Logo | Subir logo | Archivo png/jpg/webp ≤ 5 MB | — | **Solo en memoria: la imagen del logo no se guarda** (sí su posición y opciones) |
| Logo | Posición rápida | Selección | free Libre · top-left · top-right · bottom-left · bottom-right | — |
| Logo | Tamaño del logo | Deslizador | — | — |
| Elemento seleccionado | Tamaño de letra, X/Y/ancho/alto, altura mínima, espacio interno, alineaciones, orden de capas; CTA (color botón/texto, mostrar, sombra, ancho completo, presets Compacto/Normal/Grande); beneficios (fondo, checks, transparencia); texto libre (contenido, color, tipografía, alineación, transparencia, negrita); forma (color, transparencia, borde, grosor, radio) | Varios | — | — |
| Agregar elementos | Plantilla antigua | Selección | minimal Minimalista · bottom-band Banda inferior · split-flyer Flyer dividido · modern-promo Promocion moderna · side-card Tarjeta lateral · center-hero Centro destacado | — |
| Agregar elementos | Visibilidad de título / subtítulo / etiqueta / beneficios / caja de fondo / botón / contacto / bloque destacado / logo; fondo de título/subtítulo; marco interior | Casillas | — | — |
| Agregar elementos | "Agregar texto" (hasta 5); formas Rectangulo · Rectangulo redondeado · Circulo · Línea separadora · Banda horizontal (hasta 10) | Botones | — | — |
| Filtro sobre imagen | Activar overlay / Tipo overlay / Intensidad | Casilla / Selección / Deslizador | dark Oscuro · light Claro; 0–0,7 (default activo, oscuro, 0,32) | — |

#### 3.23.5 Paso 4 — Guardar

| Campo / acción | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Nombre de campaña | Texto (cabecera) | No | Default "Campaña {servicio}" | — |
| Caption editable / Hashtags / CTA | Texto | — | — | Última corrección antes de guardar |
| Guardar campaña / Actualizar campaña | Botón | — | Estado DRAFT Borrador | — |
| Guardar como lista | Botón | — | Estado READY Lista | — |
| Archivar (panel "Mis campañas") | Botón | — | ARCHIVED | — |
| Guardar simulación | Botón | — | Imagen final a la galería de simulaciones | Bloqueado si la imagen contiene paciente |

La campaña **no guarda la sede**. La publicación en redes sociales está anunciada como futura.

### 3.24 Suscripción de la clínica (Ajustes)

- **Rol:** SUBSCRIPTION_MANAGE (CLINIC_OWNER). **Pantalla:** Ajustes → Suscripción (`/ajustes/suscripcion`). Lectura del plan, uso de sedes/usuarios y módulos; acciones:

| Campo / acción | Tipo de dato | Obligatorio | Valores posibles o formato | Notas |
|---|---|---|---|---|
| Solicitar personalización del plan · Módulos | Casillas | ≥ 1 | MARKETING_AI · ADVANCED_FINANCE · CLINICAL_RECORD · TREATMENT_PLANS · ESTHETIC_TREATMENTS · ESTHETIC_AI_SIMULATION (depende de ESTHETIC_TREATMENTS) · AGREEMENTS · LIQUIDATIONS · MULTI_LOCATION · ADVANCED_REPORTS · API_ACCESS | Deshabilitados los que no se pueden solicitar |
| Solicitar personalización · Moneda de referencia | Selección | — | CLP (default) · USD · EUR | — |
| Solicitar personalización · Mensaje opcional | Área de texto | No | ≤ 5.000 | Crea una solicitud que revisa la plataforma (3.1.3) |
| Pagar mensual / Pagar anual | Botón | — | Ciclo MONTHLY · YEARLY | Abre Stripe Checkout (requiere Stripe configurado) |
| Gestionar facturación | Botón | — | — | Portal de Stripe (requiere cliente Stripe) |

### 3.25 Preferencias locales (no son datos de la clínica)
Idioma (Español · English) y Moneda visual (CLP · USD · EUR con tasas fijas de referencia) se guardan solo en el navegador del usuario.

### 3.26 Pantallas maqueta (capturan pero no guardan nada)
Nómina (`/operaciones/nomina`, "Procesar nómina" solo cierra), Reloj checador (`/operaciones/reloj-checador`, "Registrar asistencia" no persiste), Usuarios org (`/ajustes/usuarios-org`, "Enviar invitación" solo cierra), Usuarios sede, Cargos, Documentos, Especialidades, Honorarios, Outbox, Precios, Recordatorios (ajustes, no conectado a las reglas reales), WhatsApp. En plataforma: Suscripciones ("Renovar"/"Cambiar plan"), Planes ("Nuevo plan") y Soporte ("Nuevo ticket interno") están deshabilitados. **No cargar datos de prueba en estas pantallas.**

---
## 4. Lo que viaja por federación entre ambas

Condiciones generales (aplican a todas las filas): la federación debe estar configurada en ambos servidores (URL del par + clave compartida); el holding de DentalCloud debe estar **Conectado** y con **Conexión activa** (no pausado); en DentalCloud además rige "Solo catálogo" (si está activo, solo viajan convenios, prestaciones y previsiones) y las 6 conexiones individuales. Dental-Demo envía siempre que la clínica tenga par. Los envíos son asíncronos y se reintentan cada 5 minutos hasta 10 veces; **no hay pantalla para ver los fallos** en ninguna de las dos plataformas. Los vínculos se hacen por identificador externo y, al recibir catálogos, por nombre (convenios, previsiones, sucursales) o código (prestaciones); los pacientes se vinculan por RUT si ya existían.

| Entidad | Dirección | Qué campos se copian | Condiciones / qué NO viaja |
|---|---|---|---|
| Holding ↔ Clínica | Ambas | DentalCloud → Demo: nombre, país, tipo (dental→DENTAL, estetica→ESTHETIC, ambas→BOTH), nombre/correo/contraseña del administrador (contraseña solo en el primer intento), activo. Demo → DentalCloud: nombre, país, tipo, nombre/correo/contraseña del administrador, activo | DentalCloud→Demo al crear el holding y al activar/desactivar. Demo→DentalCloud al crear la clínica en plataforma y al suspender/reactivar (ACTIVE/TRIAL = activo). Al recibir una clínica, DentalCloud crea automáticamente el sillón "Sillón externo" (n° 1), la sucursal "Clínica federada" y el admin; Dental-Demo crea la clínica (moneda USD por defecto) y el CLINIC_OWNER. Al conectar manualmente desde DentalCloud el holding arranca en "Solo catálogo". No viajan: RUT, logo, módulos, permisos, moneda/zona horaria/IVA, plan/suscripción, contacto |
| Sucursal ↔ Sede | Ambas | Nombre, país (solo DentalCloud→Demo), activo | Interruptor "Sucursales"; no en "Solo catálogo". **Solo al crear**: los cambios de nombre/dirección/activo hechos después en DentalCloud no se espejan (Dental-Demo sí reenvía al editar: a verificar en la web). Vincula por nombre. No viajan: dirección, ID de RIDS RX, moneda |
| Usuario ↔ Personal | Ambas (parcial) | DentalCloud → Demo: nombre, correo, rol, RUT, contraseña (1er intento). Mapeo: admin→CLINIC_OWNER; odontologo→PROFESSIONAL (profesión DENTIST); radiologo→PROFESSIONAL (OTHER); operador→RECEPTIONIST. Demo → DentalCloud: **solo profesionales con "Habilitado para estética orofacial"**: nombre, correo, rol, contraseña. Mapeo: CLINIC_OWNER→admin; PROFESSIONAL→odontologo; RECEPTIONIST/ASSISTANT/LOCATION_MANAGER/MARKETING_MANAGER→operador | Interruptor "Profesionales"; no en "Solo catálogo". Solo al crear. Error si el correo ya pertenece a otra clínica. No viajan: firma, permisos, sedes asignadas, color de agenda, especialidad, estado activo posterior. Consecuencia: citas y planes que nacen en el otro sistema guardan solo el **nombre** del profesional (`remoteProfessionalName`) |
| Paciente | Ambas | Nombre, apellido, RUT, correo, teléfono, fecha de nacimiento, altura, peso, alergias (9 claves), detalle de alergias, condiciones médicas, medicamentos actuales | Interruptor "Pacientes"; no en "Solo catálogo". Crear y editar (Dental-Demo también al archivar). **DentalCloud exige RUT al recibir**: un paciente sin RUT en Dental-Demo puede no espejarse. No viajan desde DentalCloud: dirección, género, nacionalidad, estado civil, ocupación, contacto de emergencia, previsión de salud, plan/póliza, grupo sanguíneo, enfermedades crónicas, antecedentes dentales, etiquetas, foto, motivo de consulta y audio. No viajan desde Dental-Demo: género, dirección, notas, sede, estado archivado (se envía como edición), ficha clínica (antecedentes en texto), notas clínicas, odontograma |
| Cita | Ambas | DentalCloud → Demo: inicio, fin, estado (agendada→SCHEDULED, llego→CONFIRMED, en_atencion→IN_PROGRESS, finalizada→COMPLETED, cancelada→CANCELLED), notas, nombre del profesional, box (n° de sillón). Demo → DentalCloud: inicio, fin, estado (CANCELLED/NO_SHOW→cancelada; el resto→agendada), notas | Interruptor "Citas"; no en "Solo catálogo". El paciente debe tener espejo (si no, queda en cola). En DentalCloud las citas recibidas caen en el "Sillón externo". Dental-Demo registra historial con origen "federation" (así las citas de DentalCloud entran en el reporte de demora en atención). No viajan: tipo cita/control/urgencia, triage, sillón real, servicio, sede, consultorio, motivo de cancelación, reagendamientos posteriores desde DentalCloud (no existen) |
| Presupuesto ↔ Plan de tratamiento | Ambas | DentalCloud → Demo: nombre (título), observaciones (descripción), estado (en_tratamiento→IN_PROGRESS, terminado/alta→COMPLETED, otro→DRAFT), convenio, previsión, nombre del profesional, tipo (dental→DENTAL, estetica→ESTHETIC), género facial, **anotaciones del mapa facial**; o "eliminado". Demo → DentalCloud: título, descripción, tipo, género facial, estado (solo "alta" cuando COMPLETED/ARCHIVED), convenio, previsión, nombre del profesional | Interruptor "Presupuestos y tratamientos"; no en "Solo catálogo". Las anotaciones faciales **solo** viajan DentalCloud→Demo (única forma de tenerlas en Dental-Demo). No viajan: sucursal, forma de pago, consultorio estético, consentimiento asociado, quién creó/inició/completó, motivos de modificación, fotos de plantilla, estados PROPOSED/ACCEPTED/CANCELLED (DentalCloud no los tiene) |
| Ítem de presupuesto | Ambas | Nombre, descripción/notas, pieza o zona (texto), precio (DentalCloud costo ↔ Demo precio unitario), completado, prestación, precio de lista, % descuento convenio, producto, lote, vencimiento, cantidad aplicada; o "eliminado" | Igual que el plan. Demo → DentalCloud colapsa cantidad × precio (DentalCloud no tiene cantidad). Desde DentalCloud viaja también al marcar realizado por evolución. Estado CANCELLED en Demo = eliminado en DentalCloud |
| Foto de ítem (Antes/Después/Stickers) | DentalCloud → Demo | URL pública, etiqueta; o "eliminada" | Solo si el ítem está federado. **Única vía** para que Dental-Demo tenga fotos de ítems (allí son de solo lectura) |
| Convenio | Ambas | Nombre, % de descuento, activo | Interruptor "Catálogo" (funciona incluso en "Solo catálogo"). Demo → DentalCloud: solo si el tipo de descuento es Porcentaje (si es monto fijo o personalizado viaja 0 %). DentalCloud → Demo crea un convenio de tipo porcentaje. Vincula por nombre. No viajan: tipo de convenio, contacto, vigencia, notas |
| Prestación | Ambas | Nombre, código, precio base, activo, modo de odontograma (desde DentalCloud solo si es dental), requiere producto y lote | Interruptor "Catálogo". Vincula por código. No viajan: categoría dental/estética, zonas permitidas, "todo el rostro", "zonas juntas", precio por zona |
| Previsión | Ambas | Nombre, activo | Interruptor "Catálogo". Vincula por nombre |
| Inventario (insumos, lotes, movimientos, alertas) | DentalCloud lee y escribe en Dental-Demo (en vivo, sin copia local) | Todos los campos del insumo, lote y movimiento (2.15) | Solo requiere federación configurada (no depende de los interruptores del holding). En Dental-Demo las escrituras quedan a nombre del usuario "Bot de integración DentalCloud" y auditadas como origen federación |
| Lotes para presupuestar ("lote real") | DentalCloud lee de Dental-Demo | Producto, N° de lote, vencimiento, stock (hasta 20 lotes activos con stock) | Prestaciones con trazabilidad; búsqueda ≥ 2 caracteres. Solo se copian nombre/lote/vencimiento como texto; **no se descuenta stock** en ninguna de las dos |
| Listados globales (clínicas, pacientes, citas) | Ambas (lectura) | Resúmenes | Para el "overview federado" del super-admin; **ningún frontend lo muestra hoy** |
| Login del super-admin | Demo → DentalCloud | Correo y contraseña | Solo para el correo configurado como super-admin federado; la contraseña se valida contra DentalCloud |

---

## 5. Datos sueltos (existen pero no se pueden cargar por pantalla)

### 5.1 DentalCloud

| Entidad | Campo | Dónde existe (BD/API) | Por qué no se puede cargar | Cómo sí se puede cargar hoy |
|---|---|---|---|---|
| Holding | Nombre (edición) | BD; la API de edición lo acepta | El detalle del holding no tiene campo de nombre | Solo al crear el holding o por federación desde Dental-Demo |
| Holding | Módulos por defecto (4 llaves en BD, 8 en uso) | BD | Inconsistencia interna; en pantalla se ven los 8 | Automático |
| Holding | Id federado, flags de federación | BD | Se manejan con los interruptores de federación (no a mano) | Conectar/desconectar (2.16) |
| Usuario | Nombre, correo, rol, contraseña (edición) | BD | La API de edición solo acepta RUT; no existe cambio ni recuperación de contraseña ni edición de perfil | Solo al crear el usuario |
| Usuario | Firma (después de crear) | BD; solo en la creación | No existe pantalla ni endpoint para agregarla después (la UI lo promete) | Al crear el usuario |
| Sillón | Nombre y activo (edición) | BD y API PATCH | Ningún componente lo usa: no se puede renombrar ni desactivar; eliminar falla si tiene citas | Al crear; sillones con citas quedan para siempre |
| Sucursal | Dirección (edición) | BD y API | La tabla la muestra pero no la edita | Al crear |
| Sucursal | ID clínica en RIDS RX | BD y API | Solo se carga desde la pestaña Rx de la ficha de un paciente (lugar poco intuitivo) | Ficha → Módulo Rx (admin) |
| Sucursal | Cambios posteriores → Dental-Demo | Federación | La edición de sucursal no sincroniza | Solo la creación viaja |
| Tipo de consentimiento | Código, nombre, texto legal, activo (crear/editar/desactivar) | BD | No hay endpoint de creación ni edición; los 13 tipos se siembran con textos de ejemplo | Solo reemplazando el texto por un PDF propio (admin) |
| Consentimiento | IP, navegador, copia del texto, token, PDF congelado | BD | Automáticos | Al enviar/firmar |
| Paciente | Motivo de consulta y audio | BD | No están en el modal de paciente | Ficha → Datos paciente (2.5.2); el audio exige consentimiento "Grabación de voz" firmado |
| Paciente | Estado del consentimiento de protección de datos | Virtual | Se deriva de los consentimientos, no es columna | Enviar/firmar el consentimiento |
| Paciente | Previsión de salud vs. catálogo de previsiones | BD | Dos datos no vinculados (informativo vs. presupuesto) | Ambos se cargan por separado |
| Presupuesto | Nombre, observaciones, forma de pago, profesional (edición) | BD y API PATCH | La pantalla solo envía el estado | Solo al crear (paso 1 y 3) |
| Presupuesto | Sucursal, convenio, previsión (edición) | BD | Fijos después de crear | Al crear |
| Presupuesto | Anotaciones faciales y género (edición) | BD | "Modificar" no los reenvía | Al crear |
| Ítem de presupuesto | Costo (edición) | API PATCH | "Editar procedimiento" no lo expone | Al agregar (costo editable en la lista) |
| Ítem de presupuesto | Notas, producto, lote, vencimiento, cantidad (edición) | API PATCH | Solo se cargan al agregar el ítem o al evolucionar | Presupuesto (paso 2) o Evolución |
| Ítem de presupuesto | Ítem "fuera de catálogo" en el asistente | Código del frontend | El botón que activa el modo no está renderizado | Tarjeta del presupuesto ya creado → agregar procedimiento |
| Foto de ítem | Subida directa | API POST | La UI no la usa; las fotos de ítem solo nacen como copia de las fotos de evolución | Evolución que documenta el ítem, o federación |
| Cita | Notas, inicio/fin, sillón, profesional (edición) | BD | **No existe edición ni reprogramación de citas** | Cancelar y crear otra |
| Cita | Duración de la urgencia | API (acepta minutos) | El frontend no la envía (siempre 30) | — |
| Evolución | Contenido (edición) | API PATCH | La UI solo habilita/deshabilita | Solo al crear (o borrar con motivo y crear otra) |
| Plantilla de evolución | Nombre, sección, contenido, activa | API CRUD completo | Sin ninguna pantalla | Solo las 4 sembradas |
| Horario de profesional | Edición | — | Solo crear/eliminar; además la agenda no los usa | Eliminar y crear |
| Movimiento de cartola | Glosa, observación, forma de pago (edición) | BD | Solo crear/eliminar | Eliminar y crear |
| Prestación | Color de marca, múltiples piezas, piezas/caras por defecto | Solo en el frontend | El frontend los espera pero no existen en BD ni API (siempre vacíos) | No se pueden configurar |
| Cola de federación | Fallos de sincronización | BD | Sin endpoint ni pantalla para ver/reintentar | Automático (reintentos) |
| Orden Rx | "Otro" del examen, radiólogos destinatarios | Cliente de RIDS RX | Ningún campo de la UI los llena (se envía a todos los radiólogos) | — |
| Panel de inicio | Favoritos, Próximas citas, Novedades | UI | Son maquetas vacías | — |
| Observación | Fecha | UI | Se muestra "hoy" pero no se envía; el servidor usa la fecha de creación | — |
| Tratamientos | Tarjeta "Abonado vs. no abonado" | UI | Sin datos (maqueta) | La cartola sí tiene los abonos |
| Super-admin | "Overview federado" | API | Sin consumidor en el frontend | — |
| Numeración | N° de presupuesto y N° de movimiento de cartola | BD | Correlativos **globales** (todos los holdings): la numeración de un holding tiene saltos | — |
| Paciente | Teléfono | UI | El código de país arranca en +34 (España) | Cambiar manualmente a +56 |
| Seguridad (nota) | Varias operaciones de detalle/edición/borrado no verifican que el registro pertenezca al holding del usuario | API | Observación del análisis, no afecta la carga | — |

### 5.2 Dental-Demo

**A) Capturado en pantalla pero NO se guarda (se pierde al guardar)**

| Entidad | Campo | Dónde existe (BD/API) | Por qué no se puede cargar | Cómo sí se puede cargar hoy |
|---|---|---|---|---|
| Paciente | Altura, Peso, Alergias (9 casillas), Detalle de alergias, Condiciones médicas, Medicamentos actuales | BD y API (los aceptan) | El modal los muestra, pero la función que arma el envío solo incluye nombre, apellido, RUT, correo, teléfono, nacimiento, género, dirección y notas. Existe otra función que sí los incluye pero nunca se invoca | **Federación desde DentalCloud** (paciente creado/editado allá) o API directa. Alternativa parcial: la "Ficha general" de la ficha clínica guarda antecedentes como texto libre (otra tabla) |
| Ítem de plan ("Nuevo/Editar procedimiento") | Notas clínicas | BD (descripción) | El modal no la incluye en el envío | Asistente "Nuevo plan" paso 2 ("Notas clínicas" → descripción) |
| Plan · asistente | Id del lote real elegido, modo y selección del odontograma | BD (lote); — | Se eliminan antes de enviar; el odontograma se guarda solo como texto | — (el lote queda como texto; no descuenta stock) |
| Cotización | "Observaciones para el paciente", "Cobertura del paciente" (Fonasa/Isapre/Otro, monto/porcentaje, referencia) | — | Solo existen en modo vista previa de desarrollo | La cobertura real se registra en la orden de cobro (3.14) |
| Cotización · ítems | Unidad, stock disponible | — | No se envían | — |
| Marketing · brief | Tono, Oferta, Nombre de clínica, Sucursal, Instrucciones adicionales | — (la campaña no tiene esas columnas) | Solo viajan a la generación de texto | — |
| Marketing · editor | Imagen del logo | — | Solo en memoria (sí se guarda su posición/opciones) | — |
| Marketing · editar imagen | "Contiene paciente identificable" | — | Solo bloquea "Guardar simulación" | — |
| Liquidación | Tipo de liquidación, Porcentaje masivo | — | Ayudas locales | — |
| Sedes | Calculadora "Cambio de moneda referencial" | — | Local | — |
| Agenda | Selector "min base" | — | Sin efecto | — |
| Personal | Filtro de estética | — | Solo en cliente | — |
| Maquetas | Nómina, Reloj checador, Usuarios org, Usuarios sede, Cargos, Documentos, Especialidades, Honorarios, Outbox, Precios, Recordatorios (ajustes), WhatsApp | Sin tabla ni endpoint | Pantallas estáticas: ningún dato llega al servidor | No cargar |

**B) Desajustes de claves entre pantalla y servidor (el guardado devuelve error 400)**

| Entidad | Campo / acción | Dónde existe (BD/API) | Por qué falla | Cómo sí se puede cargar hoy |
|---|---|---|---|---|
| Recordatorio | "Nuevo recordatorio" y "Editar recordatorio" (Recordatorios y Ficha clínica) | BD y API | La pantalla envía `type` y `targetDate`; el servidor exige `reminderType` y `dueDate` (validación estricta) → **la creación/edición manual falla siempre** | Recordatorios **automáticos**: completar una cita (regla por palabras clave del servicio o defecto implante 3 meses / general 6 meses) y "Enviar recordatorio" de seguimiento de cotizaciones. Sobre esos sí funcionan los cambios de estado y "Agendar seguimiento" |
| Personal | Desactivar / Activar (menú) | BD y API | La pantalla envía `status: ACTIVE/INACTIVE`; el servidor espera booleano `active`/`isActive` | Casilla "Activo" del modal "Editar personal" |
| Equipo | Proveedor | BD (`supplierName`) | La pantalla envía `supplier` → 400 cuando no está vacío | Dejar el proveedor vacío (o anotarlo en Notas) |
| Regla de recordatorio | "Nueva regla" / "Editar regla" | BD y API | La pantalla envía `isActive`, que el servidor no acepta al crear ni editar → 400; además ofrece prioridad URGENT (inexistente) y solo 5 de 7 tipos | No hay vía por pantalla (a verificar en la web si alguna combinación guarda). Sobre reglas existentes sí funcionan activar/desactivar/eliminar |
| Cotización (listado) | Cancelar una cotización Aceptada | API | El listado no pide motivo y el servidor lo exige → 400 | Cancelar desde la pantalla de detalle (pide motivo) |
| Convenio | "Sin descuento" al editar | API | No limpia el tipo de descuento anterior | Archivar y crear otro |
| Paciente / Cotización | Vaciar un campo para borrarlo | API | El envío omite los vacíos: el valor anterior permanece | — |
| Plataforma → Soporte | Filtros de estado/prioridad | API | Envían etiquetas en español en vez de códigos; se compensa filtrando en cliente | — |
| Recordatorio | Eliminar (función de servicio no usada) | API | Ruta incorrecta si se llegara a usar | Cancelar (cambio de estado) |

**C) Existe en la base de datos pero ninguna pantalla lo carga**

| Entidad | Campo | Dónde existe (BD/API) | Por qué no se puede cargar | Cómo sí se puede cargar hoy |
|---|---|---|---|---|
| Paciente | Sede (cambio) | BD y API | No hay selector de sede en el modal; se fija con la sede activa al crear | Solo al crear |
| Clínica | IVA (`taxRatePercent`) | BD | Ni plataforma ni ajustes lo exponen; la API no lo acepta | Fijo en 19 % (solo BD) |
| Clínica | Tipo de clínica (edición) | BD | La API de edición no lo acepta | Solo al crear o por federación |
| Clínica | Cliente Stripe, datos de suscripción Stripe | BD | Los escribe el webhook de Stripe | Pago real vía Stripe |
| Usuario | Contraseña (cambio) | BD | **No existe ningún endpoint** de cambio ni recuperación | Solo al crear |
| Usuario | Color en agenda al crear | BD y API | Solo aparece en "Editar personal" | Editar después de crear |
| Usuario | Teléfono | — | El servidor lo acepta pero no hay columna | No existe |
| Sede | País y moneda distintos de la clínica | BD | Forzados a los de la clínica (campos deshabilitados) | — |
| Horario de profesional | Consultorio / sala | BD y API (lista de 7 consultorios) | El formulario de Horarios no tiene el campo; "Mi horario" lo muestra | API |
| Cita | Motivo de cancelación (texto largo), confirmadoEn, completadoEn | BD y API (endpoint `/cancel`) | La UI cancela por cambio de estado con código y observación | Cambio de estado (equivalente) |
| Cita | Historial de estados y reagendamientos | BD | Automático | Cambiar estado / editar horario |
| Recordatorio | Cita, plan, cotización vinculados; contactado en; completado en | BD y API (parcial) | Los modales no los exponen; la cotización vinculada solo la fija el seguimiento | Automáticos |
| Recordatorio | Tipo QUOTE_FOLLOW_UP | BD | No seleccionable (correcto) | "Enviar recordatorio" en Cotizaciones → Seguimiento |
| Regla de recordatorio | Tipos CHECKUP y POST_TREATMENT | BD y API | El selector solo ofrece 5 tipos | API |
| Plantilla de consentimiento | Propósito (GENERAL / ESTHETIC_AI_SIMULATION), Vigente desde | BD y API | **Crítico:** sin campo en la web; toda plantilla queda GENERAL, y la Simulación estética IA exige un consentimiento con propósito ESTHETIC_AI_SIMULATION | Script de demo o API |
| Consentimiento de paciente | Copias de nombre/RUT del paciente | BD | Automáticas | — |
| Nota clínica | Cita y profesional vinculados | BD y API | Sin campo en el modal | API |
| Plan de tratamiento | Anotaciones del mapa facial (trazos) | BD | Sin herramienta de dibujo; la API de edición no las acepta | **Solo federación desde DentalCloud** |
| Plan de tratamiento | Forma de pago (edición y visualización) | BD | Solo en el paso 3 al crear; no se muestra en ninguna pantalla | Al crear |
| Plan de tratamiento | Género facial (edición) | BD | "Editar plan" no lo expone | Conmutador del mapa al crear/editar ítem |
| Foto de ítem (Antes/Después) | Todo | BD | Solo lectura en Dental-Demo | **Solo federación desde DentalCloud** (fotos de evolución) |
| Ítem de plan | Vínculo real con el lote de inventario | BD (lotes) | Solo se copian nombre/lote/vencimiento como texto; no se descuenta stock | Registrar salida manual en Inventario |
| Ítem de plan | Prestación fuera de catálogo | — | Inalcanzable en asistente y modal (obligan a elegir del catálogo) | Crear la prestación en el catálogo |
| Cotización | Cita y plan vinculados | BD y API | El envío los manda siempre vacíos; sin campo | — |
| Ingreso | Cita vinculada | BD y API | Sin campo (paciente, cotización y plan sí) | Automático al pagar una orden de cobro |
| Gasto | Restaurar archivado | — | Sin endpoint ni botón | — |
| Liquidación | Sede | BD y API | La pantalla casi nunca la envía | — |
| Liquidación | Ítems (edición) | BD | La edición no acepta ítems | Solo al crear |
| Insumo | Stock actual (edición directa) | BD | Se fija 0 al crear y no se envía al editar | Lotes y movimientos |
| Lote | Sede propia, archivar | BD y API | Hereda la sede del insumo; sin botón de archivar | API |
| Movimiento de lote | Ajuste (ADJUSTMENT) | BD y API; el modal lo soporta | El menú solo ofrece Entrada/Salida | API (o editar la cantidad del lote) |
| Recepción de compra | Cantidad recibida distinta de la cotizada, costo | BD | La recepción recibe todo lo cotizado; no editable | — |
| Equipo | Foto (eliminar) | API | Sin botón | — |
| Campaña de marketing | Sede | BD y API | El envío nunca la incluye | — |
| Campaña de marketing | Imágenes en base64 | BD (legacy) | Hoy se guardan en Cloudinary | Automático |
| Solicitud de módulos | Montos estimados, fecha de resolución | BD | Calculados por el servidor | Automático |
| Ticket de soporte | Todo el modelo | BD; solo lectura por API | **No existe endpoint de creación ni edición**; "Nuevo ticket interno" deshabilitado | Solo seed |
| Uso por clínica (snapshots) | Todo | BD | Sin endpoint de escritura ni proceso que lo calcule | Solo seed |
| Plan SaaS (BASIC/PROFESSIONAL/ENTERPRISE) | Todo | BD | Sin CRUD ("Nuevo plan" deshabilitado) | Solo seed |
| Módulo contratable (FeatureModule) | Todo | BD | Sin CRUD; ESTHETIC_AI_SIMULATION ni siquiera está en el seed | Seed / script de demo |
| Pago de suscripción | Registro manual | BD | Solo webhook de Stripe | Stripe |
| Política de retención de datos | Todo (país, años de retención, permitir anonimización, aprobación manual) | BD | **Sin endpoint ni pantalla**; la anonimización de pacientes exige que esta fila exista con "permitir anonimización" activo → **anonimizar es imposible desde la web** | Solo BD |
| Auditoría | Todo | BD | Automático (correcto) | Uso normal |
| Cola de federación | Fallos | BD | Sin pantalla | Automático |
| Reportes / Dashboard / Monitor | "Espera prom." del monitor de sala | UI | Guion fijo, no se calcula | El reporte detallado de citas sí calcula "Demora en pasar a atender" |

**D) Otras inconsistencias que afectan la carga**

| Tema | Detalle |
|---|---|
| Dos odontogramas | El de la ficha (piezas 11–48, superficies GENERAL/O/M/D/V/L/P/MOD, 12 condiciones, tabla propia) y el de los planes (piezas 1.1–8.5 con temporales, 5 caras, 7 modos, guardado como texto en el ítem) no se relacionan |
| Dos modelos de alergias | 9 casillas del paciente (no guardables desde la web; llegan por federación) vs. texto libre "Alergias" de la ficha clínica |
| Tres listas de consultorios | Agenda: Box 1–5, Sala RX, Pabellón menor (texto). Insumos y horarios: Consultorio 1–5, Sala RX, Pabellón menor (texto). Ajustes → Sedes: consultorios reales (tabla), usados solo por Equipos y planes estéticos |
| Género | El género del paciente (FEMALE/MALE/OTHER, mostrado sin traducir) no alimenta el género del mapa facial (mujer/hombre) |
| Zonas faciales | Se guardan como etiquetas en español separadas por coma en el campo "pieza/zona" |
| Mapa facial | Sin herramientas de dibujo y capa "Músculos" deshabilitada; las anotaciones solo se ven si vienen de DentalCloud |
| Editar ítem dental | La selección de piezas arranca vacía y sobrescribe la anterior |
| Marca | "fordentcloud" (login), "DentalCloud" (layout), "DentalOS" (API) |
| Módulo ESTHETIC_AI_SIMULATION | Aparece en la suscripción y las rutas, pero no está en el seed (solo lo crea el script de demo) |
| Plan por defecto en alta de clínica | Solo los planes "visibles" (en el seed, solo PROFESSIONAL) |

---
## 6. Implicancias para la carga de datos de prueba

### 6.1 Qué campos de paciente se pueden completar al 100 % por la web

| Plataforma | Se completa al 100 % por la web | Queda fuera | Comentario |
|---|---|---|---|
| **DentalCloud** | **Sí.** Los 27 campos del modal (RUT, nombre, apellido, teléfono, nacimiento, correo, dirección, género, estado civil, nacionalidad, ocupación, previsión de salud, plan/póliza, 3 de contacto de emergencia, altura, peso, grupo sanguíneo, alergias, detalle de alergias, condiciones médicas, medicamentos, enfermedades crónicas, antecedentes dentales, etiquetas) + foto, y en la ficha el motivo de consulta y su grabación | Nada del modelo queda sin vía. Solo el audio exige antes el consentimiento "Grabación de voz" firmado | Se hace en 2 pasos: modal "Nuevo paciente" y luego tarjeta "Motivo de consulta" en la ficha. Recordar cambiar el código telefónico de +34 a +56 |
| **Dental-Demo** | **No.** Del modal solo se guardan 9 campos: nombre, apellido, RUT, nacimiento, teléfono, correo, género, dirección, notas (+ la sede activa al crear) | Altura, peso, alergias (9 claves), detalle de alergias, condiciones médicas y medicamentos actuales **se pierden** al guardar. Tampoco hay sede editable | Los 6 antecedentes existen en la BD y se muestran en el panel lateral si tienen valor. La "Ficha general" de la ficha clínica guarda antecedentes como texto libre, pero es otra tabla (no rellena esos 6 campos) |

**¿Crear en DentalCloud con federación activa cubre lo que Dental-Demo no permite cargar directo?** **Sí, para los antecedentes médicos.** El espejo de paciente DentalCloud → Dental-Demo copia nombre, apellido, RUT, correo, teléfono, nacimiento, **altura, peso, alergias, detalle de alergias, condiciones médicas y medicamentos actuales**. Es la única forma de que esos 6 campos tengan valor en Dental-Demo. Condiciones: holding conectado, conexión activa, "Solo catálogo" desactivado e interruptor "Pacientes" activo. **No cubre**: género, dirección y notas de Dental-Demo (se completan después editando el paciente allá; al editar en Dental-Demo no se pierden los antecedentes porque el envío omite esos campos en vez de vaciarlos). Tampoco viajan desde DentalCloud los datos que Dental-Demo no tiene (estado civil, ocupación, contacto de emergencia, previsión, grupo sanguíneo, etiquetas, foto, motivo de consulta, enfermedades crónicas, antecedentes dentales).

**Recomendación para las 300 fichas diarias:** crear al paciente **primero en DentalCloud** (RUT válido único por holding, teléfono +56, correo si se van a probar consentimientos/cartola/confirmaciones), esperar el espejo (asíncrono, con reintentos cada 5 min) y luego completar en Dental-Demo género, dirección, notas y la ficha clínica (antecedentes en texto, notas clínicas, odontograma). Un paciente creado en Dental-Demo **sin RUT** puede no llegar a DentalCloud.

### 6.2 Otros datos que solo se completan por federación o que conviene originar en una plataforma concreta

| Dato | Dónde originarlo | Motivo |
|---|---|---|
| Fotos Antes/Después/Stickers de procedimientos | DentalCloud (evolución que documenta el ítem) | En Dental-Demo son solo lectura |
| Trazos del mapa facial (anotaciones) | DentalCloud (asistente de presupuesto estético) | Dental-Demo no tiene herramienta de dibujo |
| Prestaciones estéticas con zonas, "todo el rostro", precio por zona | DentalCloud | Esos atributos no existen en Dental-Demo (viajan nombre, código, precio, activo, trazabilidad) |
| Convenios con contacto, vigencia y tipo | Dental-Demo (Finanzas → Convenios) | DentalCloud solo tiene nombre y %; solo los de tipo Porcentaje descuentan y viajan como % |
| Inventario, lotes, movimientos | Cualquiera de las dos (misma base) | El dato vive en Dental-Demo; DentalCloud lo opera en vivo. Necesario **antes** de presupuestar prestaciones con "Requiere producto y lote" en cualquiera de las dos |
| Citas con estados completos | Cada plataforma para su propio flujo | Las citas espejadas llegan simplificadas (DentalCloud → "agendada"/"cancelada" hacia allá; Dental-Demo recibe 5 estados) y sin profesional como usuario |
| Usuarios/personal | Crear en cada plataforma | Solo se espejan al crear (y desde Dental-Demo solo profesionales con estética). Las contraseñas no se pueden cambiar después en ninguna |
| Clínica/holding | **Elegir un solo origen por clínica** (a verificar en la web) | Ambas plataformas espejan la alta de clínica hacia la otra; crear la misma clínica en las dos produciría duplicados. Al crear el holding en DentalCloud y conectar, hay que quitar "Solo catálogo" para que viajen pacientes/citas/presupuestos |

### 6.3 Orden recomendado de creación por rol y dependencias

#### DentalCloud

| Paso | Rol | Qué crear (pantalla) | Depende de |
|---|---|---|---|
| 1 | super_admin | Holding (nombre, RUT, tipo, país, logo) + administrador inicial (`/admin/clinicas` → Crear holding) | — |
| 2 | super_admin | Detalle del holding: Activo, módulos habilitados (los 8) y Módulo Rx; Federación: Conectar → desactivar "Solo catálogo" → activar las 6 conexiones individuales | Paso 1; federación configurada en ambos servidores |
| 3 | admin | Catálogo → Clínicas: ≥ 1 sucursal (nombre, dirección); si se usa Rx, su "ID clínica en RIDS RX" (desde la pestaña Rx de cualquier ficha) | Paso 1 |
| 4 | admin | Catálogo → Convenios (≥ 1, obligatorio en presupuestos; ej. "Particular 0 %"), Previsiones (Fonasa, Isapre, Particular), Prestaciones (dentales con modo de odontograma; estéticas con zonas/trazabilidad) | Paso 1 |
| 5 | admin | Agenda → Sillones (≥ 1) y Duración del bloque (15/30/60) | Paso 1 |
| 6 | admin | Profesionales → Agregar profesional (odontólogos, radiólogos, operadores/recepción; RUT y firma) → Horario por profesional → Permisos por perfil y permisos individuales | Pasos 1 y 5 (sillón en el horario, opcional) |
| 7 | admin | Catálogo → Inventario: insumos, lotes con stock y vencimiento (viven en Dental-Demo) | Paso 2 (federación) y paso 3 (sede por nombre en Dental-Demo) |
| 8 | operador (recepción) o admin | Pacientes → Nuevo paciente (27 campos + foto) | Paso 1 |
| 9 | operador o admin | Agenda → Nueva cita (paciente, fecha, hora, sillón, duración; profesional solo admin) / Agendar desde celda / Atender urgencia | Pasos 5 y 8 (sillón activo y paciente); correo del paciente para la confirmación |
| 10 | operador o admin | Ficha → Consentimientos: enviar por correo (requiere correo) o firmar presencial (nombre, RUT, lectura, firma). Firmar al menos "Protección de datos" y "Grabación de voz" | Paso 8 |
| 11 | operador o admin | Ficha → Documentos clínicos (archivo + categoría), Observaciones | Paso 8 |
| 12 | odontólogo | Ficha → Datos paciente: Motivo de consulta (+ grabación si hay consentimiento de voz) | Pasos 8 y 10 |
| 13 | odontólogo (con permiso "Crear presupuestos") | Ficha → Tratamientos → Nuevo presupuesto (sucursal, convenio, previsión, prestaciones con piezas/zonas, lote real si trazabilidad, fotos de plantilla en estética; nombre, forma de pago, observaciones) | Pasos 3, 4 y 8; paso 7 si hay trazabilidad |
| 14 | odontólogo | Agenda: Marcar llegada → Pasar a atención → Terminar cita → "Ir a evolucionar" | Paso 9 |
| 15 | odontólogo | Ficha → Evoluciones: contenido (plantilla), ítem documentado, producto/lote/vencimiento/cantidad si trazabilidad, fotos etiquetadas; "Crear próximo control" | Pasos 13 y 14 |
| 16 | odontólogo | Ficha → Tratamientos: marcar ítems realizados, cambiar estado (en tratamiento → terminado → alta), motivo de modificación si corresponde, Generar informe PDF/Word (solo en alta) | Paso 13 |
| 17 | operador o admin | Ficha → Cartola: abonos (forma de pago, N° documento), intereses, ajustes; enviar por correo / PDF | Paso 13 (para vincular al presupuesto) |
| 18 | odontólogo (no radiólogo) | Ficha → Módulo Rx: actualizar paciente en RIDS RX, crear orden (clínica con ID RIDS RX, prioridad, diagnóstico, exámenes, piezas, archivos), enviar a radiólogo | Pasos 2 (Rx habilitado), 3 (ID RIDS RX), 6 (odontólogo con RUT) |

#### Dental-Demo

| Paso | Rol | Qué crear (pantalla) | Depende de |
|---|---|---|---|
| 1 | PLATFORM_ADMIN | Nueva clínica (datos, sede inicial, administrador con contraseña ≥ 10, suscripción con fechas, módulos: al menos CLINICAL_RECORD, TREATMENT_PLANS, ADVANCED_FINANCE, ADVANCED_REPORTS; agregar AGREEMENTS, LIQUIDATIONS, MULTI_LOCATION, ESTHETIC_TREATMENTS, MARKETING_AI según lo que se vaya a probar) | — (o recibirla por federación desde DentalCloud; no crearla dos veces) |
| 2 | PLATFORM_ADMIN | Detalle de clínica → Plan y módulos (activar/ajustar precios); resolver solicitudes de módulos | Paso 1 |
| 3 | CLINIC_OWNER | Ajustes → Sedes: sedes adicionales (límite del plan) y **Consultorios** (con "Estética orofacial" si habrá planes estéticos/equipos estéticos) | Paso 1 |
| 4 | CLINIC_OWNER | Operaciones → Personal: usuarios (rol, profesión, especialidad, sedes asignadas, estética; contraseña ≥ 10); luego editar para Color en agenda; Permisos de módulos y permisos adicionales | Pasos 1 y 3 (sedes) |
| 5 | CLINIC_OWNER | Ajustes → Horarios: horario semanal (o creación rápida Lu–Vi) y bloqueos por profesional. **Imprescindible**: sin horario el profesional no está disponible al agendar | Paso 4 |
| 6 | CLINIC_OWNER | Ajustes → Consentimientos: plantillas (nombre, versión, título, texto, categorías, canales) | Paso 1 |
| 7 | CLINIC_OWNER | Operaciones → Prestaciones (nombre, código, precio, modo, trazabilidad) y Previsiones | Paso 1 (feature TREATMENT_PLANS) |
| 8 | CLINIC_OWNER | Finanzas → Convenios (≥ 1 de tipo Porcentaje; obligatorio en planes) | Paso 1 (feature AGREEMENTS) |
| 9 | CLINIC_OWNER / LOCATION_MANAGER | Operaciones → Inventario: insumos (sede, consultorio, categoría, costo, stock mínimo) → lotes (n°, vencimiento, cantidad) → movimientos; Cotizaciones de compra → recepción (crea lotes) | Paso 3 (sede); feature ADVANCED_FINANCE |
| 10 | CLINIC_OWNER / LOCATION_MANAGER | Operaciones → Equipos (sede, consultorio, responsable, área, estado, serie, fechas técnicas; **proveedor vacío**) | Pasos 3 y 4 |
| 11 | RECEPTIONIST | Pacientes → Nuevo paciente (9 campos guardables; incluir RUT para federación) — o esperar el espejo desde DentalCloud | Paso 3 (sede activa) |
| 12 | RECEPTIONIST | Agenda diaria → Nueva cita (paciente, servicio, consultorio Box, profesional, fecha, hora, duración); estados Confirmar → Iniciar atención → Completar (genera recordatorio automático) / Cancelar / No asistió con motivo | Pasos 5 y 11 |
| 13 | RECEPTIONIST | Ficha clínica → Consentimiento y privacidad → Registrar consentimiento (plantilla, método, fechas, representante) | Pasos 6 y 11 |
| 14 | PROFESSIONAL | Ficha clínica: Ficha general (6 antecedentes en texto), Notas clínicas (título, motivo, diagnóstico, tratamiento, indicaciones, observaciones → Marcar final), Odontograma (pieza, superficie, condición, diagnóstico, sugerencia) | Paso 11; feature CLINICAL_RECORD |
| 15 | PROFESSIONAL | Planes de tratamiento → Nuevo plan (tipo, convenio obligatorio, previsión, profesional; estético: consultorio estético y consentimiento; prestaciones con odontograma/zonas, lote real si trazabilidad; nombre, forma de pago, observaciones); estados del plan y de los ítems | Pasos 7, 8, 11; paso 9 si trazabilidad; paso 3/4/13 para estética |
| 16 | RECEPTIONIST / CLINIC_OWNER | Cotizaciones → Nueva (paciente, sede, profesional, vigencia, ítems manuales o de inventario, descuentos con permiso) → Emitir → Aceptar → Seguimiento (registrar contacto, marcar en tratamiento, enviar recordatorio) | Pasos 4, 11 (y 9 para ítems de inventario) |
| 17 | CLINIC_OWNER / LOCATION_MANAGER | Cotización aceptada → Crear orden de cobro (cobertura Particular/Fonasa/Isapre, monto cubierto) → Cobranza → Registrar pago (efectivo/débito/crédito) — genera el Ingreso | Paso 16 |
| 18 | CLINIC_OWNER | Finanzas → Ingresos (manuales, vinculados a paciente/cotización/plan; abono parcial) y Gastos | Paso 1 (feature ADVANCED_FINANCE); pasos 11/15/16 para vínculos |
| 19 | CLINIC_OWNER | Finanzas → Liquidaciones (período, profesional, ingresos elegibles con % o monto fijo, descuentos, bonos) → Marcar lista → Marcar pagada | Pasos 16–18 (ingresos vinculados a un profesional vía cita o cotización); feature LIQUIDATIONS |
| 20 | CLINIC_OWNER / MARKETING_MANAGER | Marketing IA: brief → texto → imagen → editor → Guardar campaña / lista; simulaciones | Paso 1 (feature MARKETING_AI, OpenAI configurado) |
| 21 | CLINIC_OWNER | Ajustes → Suscripción: solicitar personalización del plan; Stripe (si está configurado) | Paso 1 |
| — | CLINIC_OWNER / PROFESSIONAL | Simulación estética IA | **Bloqueada por la web**: requiere una plantilla de consentimiento con propósito ESTHETIC_AI_SIMULATION que no se puede crear por pantalla |

### 6.4 Trampas a tener en cuenta al cargar volumen (10 clínicas, 300 pacientes/día)

- **RUT**: en DentalCloud es obligatorio, debe pasar el módulo 11 y es único por holding; en Dental-Demo es opcional pero validado si se completa, y sin él el paciente puede no espejarse. Generar RUTs válidos y distintos.
- **Correos de usuarios**: únicos en toda la plataforma (no por clínica) en ambas. Los correos de pacientes no tienen esa restricción.
- **Contraseñas**: DentalCloud ≥ 8, Dental-Demo ≥ 10; **ninguna de las dos permite cambiarlas después**. Anotarlas al crear.
- **Citas en DentalCloud no se editan**: cualquier error obliga a cancelar (queda registro) y crear otra. Sin solapamiento por sillón. Las urgencias duran siempre 30 min.
- **Citas en Dental-Demo** se validan contra horario, bloqueos y solapes del profesional: sin horario semanal, "Por asignar" es la única opción que agenda. La sede activa debe estar seleccionada.
- **Presupuestos**: en ambas el convenio es obligatorio; en DentalCloud además la sucursal. Nombre, forma de pago y observaciones del presupuesto no se editan después en DentalCloud; en Dental-Demo la forma de pago no se ve ni se edita.
- **Trazabilidad**: una prestación con "Requiere producto y lote" no se puede agregar a un presupuesto/plan sin un lote con stock > 0 en Inventario (Dental-Demo). El stock no se descuenta automáticamente.
- **Recordatorios manuales, reglas nuevas, "Desactivar" personal y "Proveedor" de equipos fallan** en Dental-Demo (sección 5.2 B). Probar recordatorios completando citas.
- **Consentimientos**: en DentalCloud los 13 tipos son fijos; firmar "Protección de datos" alimenta los filtros del listado y las métricas del super-admin; "Grabación de voz" habilita el audio del motivo de consulta. En Dental-Demo hay que crear plantillas antes de registrar.
- **Numeración**: en DentalCloud el N° de presupuesto y de movimiento de cartola es global (los holdings verán saltos); en Dental-Demo cotizaciones (COT), órdenes de cobro (COB), cotizaciones de compra (CPC) y recepciones (REC) numeran por clínica y año.
- **Federación asíncrona**: los espejos tardan hasta 5 minutos si el primer intento falla; no hay pantalla para verificarlo, salvo revisar la entidad en la otra aplicación.
- **Espacio en pantalla**: la lista de pacientes de DentalCloud devuelve como máximo 50 resultados por búsqueda; el selector de paciente de la agenda de Dental-Demo carga 200 activos y el de simulación IA 100. Con 300 pacientes/día conviene buscar por RUT o apellido.

---

## 7. Glosario breve de estados y valores

### 7.1 DentalCloud (todos son textos validados en código; no hay enums de BD)

| Entidad · campo | Valores |
|---|---|
| Holding · tipo | dental · estetica · ambas |
| Holding · país | Chile · Argentina · Perú · Colombia · México · Bolivia · Ecuador · Uruguay · Paraguay · Venezuela · España · Estados Unidos · Otro |
| Holding · duración del bloque de agenda | 15 · 30 · 60 |
| Holding · módulos del plan | pacientes · documentosClinicos · cartola · evoluciones · observaciones · agenda · tratamientos · consentimientos (+ rxEnabled) |
| Holding · conexiones de federación | patients · appointments · treatmentPlans · users · sucursales · catalog |
| Usuario · rol | admin · odontologo · radiologo · operador (super_admin solo por BD) |
| Perfiles con matriz de permisos | odontologo · radiologo · operador |
| Llaves de permiso | pacientes · documentosClinicos · cartola · evoluciones · observaciones · agenda · tratamientos · consentimientos · rx · crearPresupuestos |
| Excepción por usuario | Hereda · Sí · No |
| Paciente · género | femenino · masculino · otro |
| Paciente · estado civil | soltero · casado · conviviente_civil · divorciado · viudo |
| Paciente · previsión de salud | fonasa · isapre · particular · otro |
| Paciente · grupo sanguíneo | A+ · A- · B+ · B- · AB+ · AB- · O+ · O- |
| Paciente · alergias | fluoruro · penicilina · anestesicos_locales · latex · yodo · niquel_metales · aines · sulfitos · otro |
| Paciente · etiquetas | Libres, máximo 20 |
| Cita · estado | agendada → llego → en_atencion → finalizada; cancelada |
| Cita · tipo | cita · control · urgencia |
| Cita · nivel de gravedad (triage) | leve · moderada · grave |
| Cita · duraciones | 15 · 30 · 45 · 60 · 90 min (múltiplos del bloque); urgencia 30 |
| Agenda · horario visible | 08:00 – 20:00 |
| Horario de profesional · día | 0 Domingo … 6 Sábado |
| Presupuesto · estado | sin_iniciar · en_tratamiento · terminado · alta (terminal) |
| Presupuesto · tipo de diagrama | dental · estetica |
| Presupuesto · género facial | hombre · mujer |
| Presupuesto · forma de pago | Contado · Cuotas |
| Prestación · categoría | dental · estetica |
| Prestación · modo de odontograma | session · tooth · surface · extraction · cuadrante · sextante · arcada |
| Odontograma · piezas | Permanentes 1.1–1.8, 2.1–2.8, 3.1–3.8, 4.1–4.8; temporales 5.1–5.5, 6.1–6.5, 7.1–7.5, 8.1–8.5 |
| Odontograma · caras | top · right · bottom · left · center |
| Mapa facial · zonas | frente · entrecejo · sienes · parpados · patas_gallo · ojeras · pomulos · nariz · nasogenianos · codigo_barras · labios · menton · mandibula · cuello |
| Mapa facial · herramientas | lapiz · linea · circulo (+ borrador) |
| Foto de evolución / ítem · etiqueta | Antes · Después · Sticker ficha · Sticker paciente |
| Foto de plantilla de presupuesto · etiqueta | "{Zona} — Antes" · "{Zona} — Después" |
| Consentimiento · estado | pendiente · firmado · rechazado · expirado (y "No enviado" cuando no existe) |
| Consentimiento · método | email · presencial |
| Consentimiento · tipos (13) | proteccion_datos · tratamiento_general · anestesia · cirugia_procedimiento_invasivo · endodoncia · protesis · ortodoncia · implantes · blanqueamiento · uso_imagenes · sedacion · autorizacion_representante_menor · grabacion_voz |
| Documento clínico · categoría | receta · derivacion · imagen · archivo · alta · solicitud_laboratorio · documento_pabellon · solicitud_pabellon |
| Movimiento de cartola · tipo | abono · interes · ajuste |
| Movimiento de cartola · dirección (ajuste) | debe · haber |
| Movimiento de cartola · forma de pago | Efectivo · Transferencia · Tarjeta · Cheque · Otro |
| Orden Rx · prioridad (crear) | 1 día · 2 días · 3 días · Normal · Urgente |
| Orden Rx · prioridad (editar) | Normal · Urgente |
| Orden Rx · grupos de examen | Intraorales / Extraorales (Adultos, Niños, 2D, 3D según catálogo remoto) |
| Inventario (remoto) · categoría | Desechables · Bioseguridad · Anestesia · Restauracion · Ortodoncia · Higiene dental · Instrumental · Radiologia · Laboratorio · Otros |
| Inventario · unidad | unidad · caja · paquete · frasco · tubo · ml · kit |
| Inventario · consultorio | Consultorio 1 · 2 · 3 · 4 · 5 · Sala RX · Pabellón menor |
| Inventario · estado de insumo | ACTIVE · LOW_STOCK · OUT_OF_STOCK · ARCHIVED |
| Inventario · estado de vencimiento del lote | ACTIVE · EXPIRING · EXPIRED · NO_EXPIRATION |
| Inventario · tipo de movimiento | IN (Entrada) · OUT (Salida) · ADJUSTMENT (Ajuste) |
| Cola de federación · tipo de entidad | CLINICA · CLINICA_STATUS · PATIENT · APPOINTMENT · TREATMENT_PLAN · TREATMENT_ITEM · TREATMENT_ITEM_REMOVAL · TREATMENT_ITEM_PHOTO · TREATMENT_ITEM_PHOTO_REMOVAL · CONVENIO · PRESTACION · PREVISION · USER · SUCURSAL |
| Plantillas de evolución sembradas | Control de rutina · Post operatorio · Anamnesis inicial · Alta odontológica (secciones Control, Diagnóstico, Alta) |

### 7.2 Dental-Demo

**Enums de base de datos**

| Entidad · campo | Valores |
|---|---|
| Usuario · rol (UserRole) | PLATFORM_ADMIN · CLINIC_OWNER · LOCATION_MANAGER · MARKETING_MANAGER · PROFESSIONAL · RECEPTIONIST · ASSISTANT (legacy: CLINIC_ADMIN→CLINIC_OWNER, CLINIC_STAFF→PROFESSIONAL) |
| Usuario · profesión (UserProfession) | DENTIST · DENTAL_ASSISTANT · RECEPTIONIST · ADMINISTRATION · MARKETING · OTHER |
| Clínica · estado (ClinicStatus) | ACTIVE · TRIAL · SUSPENDED · EXPIRED |
| Plan SaaS (PlanName) | BASIC · PROFESSIONAL · ENTERPRISE |
| Suscripción · estado | ACTIVE · TRIAL · EXPIRED · CANCELLED |
| Módulo de suscripción · estado | ACTIVE · TRIAL · EXPIRED · CANCELLED |
| Solicitud de módulos · estado | PENDING · IN_REVIEW · APPROVED · REJECTED · CANCELLED |
| Pago SaaS · estado (PaymentStatus) | PAID · PENDING · FAILED · REFUNDED |
| Pago SaaS · método (PaymentMethod) | CREDIT_CARD · DEBIT_CARD · BANK_TRANSFER · OTHER |
| Ticket · prioridad / estado / tipo | LOW · MEDIUM · HIGH · URGENT / OPEN · IN_REVIEW · RESOLVED · CLOSED / TECHNICAL · BILLING · ACCOUNT · FEATURE_REQUEST · OTHER |
| Campaña de marketing · estado | DRAFT · READY · ARCHIVED |
| Insumo · estado (ClinicSupplyStatus) | ACTIVE · LOW_STOCK · OUT_OF_STOCK · ARCHIVED |
| Movimiento de lote · tipo | IN · OUT · ADJUSTMENT |
| Cotización de compra · estado | DRAFT · RECEIVED · APPROVED · REJECTED · CANCELLED |
| Ítem de cotización · origen (QuoteItemSourceType) | MANUAL · INVENTORY_SUPPLY |
| Equipo · área clínica | DENTAL · ESTHETIC · BOTH |
| Equipo · estado | ACTIVE · IN_MAINTENANCE · OUT_OF_SERVICE · RETIRED · LOST |
| Gasto · estado / método de pago | ACTIVE · ARCHIVED / CASH · CARD · TRANSFER · CHECK · OTHER |
| Ingreso · estado / método de pago / tipo de pago | ACTIVE · ARCHIVED / CASH · CARD · TRANSFER · CHECK · OTHER / FULL · PARTIAL |
| Orden de cobro · estado | PENDING · PAID · COVERED · CANCELLED |
| Orden de cobro · cobertura | NONE · FONASA · ISAPRE |
| Orden de cobro · medio de pago | CASH · DEBIT_CARD · CREDIT_CARD |
| Convenio · tipo | COMPANY · INSURANCE · PARTNER · INTERNAL · OTHER |
| Convenio · estado | ACTIVE · INACTIVE · EXPIRED · ARCHIVED (la UI añade el filtro visual EXPIRING_SOON) |
| Convenio · tipo de descuento | PERCENTAGE · FIXED_AMOUNT · CUSTOM |
| Liquidación · estado | DRAFT · READY · PAID · CANCELLED · ARCHIVED |
| Liquidación · método de pago | CASH · TRANSFER · CHECK · OTHER |
| Nota clínica · estado | DRAFT · FINAL · ARCHIVED |
| Odontograma de la ficha · condición | HEALTHY · CARIES · RESTORATION · MISSING · EXTRACTION_INDICATED · IMPLANT · CROWN · ROOT_CANAL · FRACTURE · PERIODONTAL_ISSUE · OBSERVATION · OTHER |
| Plan de tratamiento · estado | DRAFT · PROPOSED · ACCEPTED · IN_PROGRESS · COMPLETED · CANCELLED · ARCHIVED |
| Plan de tratamiento · tipo | DENTAL · ESTHETIC |
| Ítem de plan · estado | PENDING · IN_PROGRESS · COMPLETED · CANCELLED |
| Paciente · estado | ACTIVE · ARCHIVED |
| Consentimiento · estado | ACTIVE · REVOKED · EXPIRED |
| Consentimiento · método | IN_PERSON · DIGITAL · VERBAL · IMPORTED |
| Consentimiento · propósito | GENERAL · ESTHETIC_AI_SIMULATION |
| Simulación estética · estado | PENDING · PROCESSING · COMPLETED · FAILED · DISCARDED |
| Cita · estado | SCHEDULED · CONFIRMED · IN_PROGRESS · COMPLETED · CANCELLED · NO_SHOW |
| Recordatorio · tipo | CHECKUP · CLEANING · POST_TREATMENT · ORTHODONTIC_CONTROL · IMPLANT_CONTROL · SURGERY_FOLLOW_UP · GENERAL · QUOTE_FOLLOW_UP |
| Recordatorio · estado | PENDING · OVERDUE · CONTACTED · SCHEDULED · COMPLETED · CANCELLED |
| Recordatorio · prioridad | LOW · NORMAL · HIGH |
| Regla de recordatorio · unidad | DAYS · MONTHS |
| Cotización · estado | DRAFT · ISSUED · ACCEPTED · REJECTED · CANCELLED |
| Cotización · tipo de descuento | PERCENTAGE · FIXED_AMOUNT |
| Cotización · seguimiento de tratamiento | NOT_STARTED · IN_PROGRESS |
| Solicitud de privacidad · tipo | DATA_EXPORT · DATA_CORRECTION · DATA_RESTRICTION · DATA_ANONYMIZATION |
| Solicitud de privacidad · estado | PENDING · IN_REVIEW · APPROVED · REJECTED · COMPLETED · CANCELLED |
| Acceso a módulo · efecto | ALLOW · DENY |

**Vocabularios fijos en código (no son enums de BD)**

| Entidad · campo | Valores |
|---|---|
| Paciente · alergias | fluoruro · penicilina · anestesicos_locales · latex · yodo · niquel_metales · aines · sulfitos · otro |
| Paciente · género (UI) | FEMALE · MALE · OTHER |
| Prestación · modo de odontograma | session · tooth · surface · extraction · cuadrante · sextante · arcada |
| Odontograma de planes · piezas | 1.8–1.1, 2.1–2.8, 4.8–4.1, 3.1–3.8; temporales 5.5–5.1, 6.1–6.5, 8.5–8.1, 7.1–7.5 |
| Odontograma de planes · caras | top · right · bottom · left · center |
| Odontograma de la ficha · piezas / superficies | 18–11, 21–28, 31–38, 48–41 / GENERAL · O · M · D · V · L · P · MOD |
| Clínica · tipo | DENTAL · ESTHETIC · BOTH |
| Plan · género facial | hombre · mujer |
| Plan · forma de pago | Contado · Cuotas |
| Mapa facial · zonas | frente · entrecejo · sienes · parpados · patas_gallo · ojeras · pomulos · nariz · nasogenianos · codigo_barras · labios · menton · mandibula · cuello (perfil: 11, sin entrecejo, párpados, ojeras) |
| Consultorios (insumos, horarios) | Consultorio 1 · 2 · 3 · 4 · 5 · Sala RX · Pabellón menor |
| Consultorios de agenda (box) | Box 1 · Box 2 · Box 3 · Box 4 · Box 5 · Sala RX · Pabellón menor |
| Agenda · servicios sugeridos | Limpieza dental · Ortodoncia · Extraccion · Blanqueamiento · Endodoncia · Radiografia · Consulta inicial · Control post-op |
| Agenda · duraciones | 15 · 30 · 45 · 60 · 90 · 120 min |
| Cita · motivos de cancelación | PATIENT_CANCELLED · DOCTOR_UNAVAILABLE · RESCHEDULED · SCHEDULING_ERROR · ADMINISTRATIVE_ISSUE · CLINIC_CLOSED · OTHER |
| Cita · motivos de no asistencia | FORGOT_APPOINTMENT · COULD_NOT_CONTACT · TRANSPORT_ISSUE · PERSONAL_EMERGENCY · HEALTH_ISSUE · UNKNOWN · OTHER |
| Simulación estética · tipo de tratamiento | FACIAL_HARMONIZATION · LIP_AUGMENTATION · BOTULINUM_TOXIN · DERMAL_FILLER · FACIAL_CONTOURING · SMILE_DESIGN · TEETH_WHITENING · OTHER_ESTHETIC |
| Liquidación · tipo de cálculo | PERCENTAGE · FIXED |
| Módulos de menú (visibilidad por usuario) | AGENDA · REPORTS · QUOTES · FINANCE · COLLECTIONS · INVENTORY · EQUIPMENT · ESTHETIC_SIMULATION · STAFF · PRESTACIONES · PREVISIONES · MARKETING |
| Features contratables (FeatureModule) | MARKETING_AI · ADVANCED_FINANCE · CLINICAL_RECORD · TREATMENT_PLANS · ESTHETIC_TREATMENTS · AGREEMENTS · LIQUIDATIONS · MULTI_LOCATION · ADVANCED_REPORTS · API_ACCESS · ESTHETIC_AI_SIMULATION |
| Plantilla de consentimiento · categorías de datos | identificacion · contacto · salud · historial_clinico · agenda · facturacion · comunicaciones |
| Plantilla de consentimiento · canales | email · phone · whatsapp · sms |
| Ingreso · categorías (UI) | Consulta · Tratamiento · Limpieza dental · Ortodoncia · Estetica dental · Urgencia · Convenio · Abono · Otro |
| Ingreso · tipos de documento sugeridos | Boleta electronica · Factura electronica · Boleta manual · Comprobante interno · Nota de credito |
| Gasto · categorías (UI) | Arriendo · Servicios básicos · Sueldos · Insumos · Laboratorio · Marketing · Mantención · Equipamiento · Administración · Otros |
| Inventario · categorías | Desechables · Bioseguridad · Anestesia · Restauracion · Ortodoncia · Higiene dental · Instrumental · Radiologia · Laboratorio · Otros |
| Inventario · unidades (UI) | unidad · caja · paquete · frasco · tubo · ml · kit |
| Lote · estado de vencimiento | ACTIVE · EXPIRING · EXPIRED · NO_EXPIRATION |
| Cotización de compra / recepción / cotización / cobro · numeración | CPC-AAAA-000001 · REC-AAAA-000001 · COT-AAAA-000001 · COB-AAAA-000001 (por clínica y año) |
| Marketing · tono | PROFESSIONAL · FRIENDLY · EDUCATIONAL · PROMOTIONAL |
| Marketing · plataforma de texto | INSTAGRAM · FACEBOOK · BOTH |
| Marketing · formato de imagen | SQUARE (1024×1024) · INSTAGRAM_STORY (1024×1536) · FACEBOOK_POST (1536×1024) · INSTAGRAM_POST |
| Marketing · calidad | low · medium · high |
| Marketing · modo visual | PHOTO · POST_BACKGROUND · FLYER_BACKGROUND |
| Marketing · plantillas de diseño | clean-modern · dental-tips · badge-promo · diagonal-panel · premium-flyer · benefits-focus · offer-highlight · before-booking · clinic-card · educational-post · split-ad |
| Marketing · estilo visual | clean · premium · commercial · educational · impact |
| Marketing · paleta | dental-teal · professional-blue · premium-navy · health-green · esthetic-purple · premium-gold |
| Marketing · densidad | light · balanced · complete |
| Marketing · plantilla antigua | minimal · bottom-band · split-flyer · modern-promo · side-card · center-hero |
| Marketing · overlay | dark · light (0–0,7) |
| Clínica · países (UI plataforma) | Chile · España · Colombia · Perú · México · Estados Unidos · Venezuela · Francia · Otro |
| Clínica · monedas | CLP · EUR · USD · COP · PEN · MXN · VES |
| Clínica · zonas horarias | America/Santiago · Europe/Madrid · America/Bogota · America/Lima · America/Mexico_City · America/New_York · America/Los_Angeles · America/Caracas · Europe/Paris |
| Solicitud de módulos · moneda | CLP · USD · EUR |
| Stripe · ciclo | MONTHLY · YEARLY |
| Auditoría · categorías | AUTH · CLINICAL_RECORD · ODONTOGRAM · CONSENT · TREATMENT_PLAN · STAFF · PATIENT · DOCUMENT · AGENDA · FINANCE · EQUIPMENT · INVENTORY · ESTHETIC_SIMULATION · PLATFORM · SYSTEM · PRIVACY · QUOTE · MARKETING |
| Auditoría · resultado | SUCCESS · DENIED · FAILED |
| Cola de federación · tipo de entidad | CLINIC · CLINIC_STATUS · PATIENT · USER · LOCATION · APPOINTMENT · TREATMENT_PLAN · TREATMENT_ITEM · TREATMENT_ITEM_REMOVAL · CONVENIO · PRESTACION · PREVISION |
| Preferencias · idioma / moneda visual | es · en / CLP · USD · EUR |

### 7.3 Correspondencias entre plataformas (federación)

| Concepto | DentalCloud | Dental-Demo |
|---|---|---|
| Tipo de clínica | dental / estetica / ambas | DENTAL / ESTHETIC / BOTH |
| Rol de usuario | admin / odontologo / radiologo / operador | CLINIC_OWNER / PROFESSIONAL (DENTIST) / PROFESSIONAL (OTHER) / RECEPTIONIST (y LOCATION_MANAGER, MARKETING_MANAGER, ASSISTANT → operador) |
| Estado de cita | agendada / llego / en_atencion / finalizada / cancelada | SCHEDULED / CONFIRMED / IN_PROGRESS / COMPLETED / CANCELLED (NO_SHOW → cancelada) |
| Estado de presupuesto/plan | sin_iniciar / en_tratamiento / terminado / alta | DRAFT / IN_PROGRESS / COMPLETED / COMPLETED (Demo → DentalCloud: solo COMPLETED/ARCHIVED se fuerzan a "alta") |
| Ítem eliminado | eliminación | CANCELLED |
| Sillón de citas espejadas | "Sillón externo" (n° 1) | — (box = número de sillón) |
| Sede de entidades espejadas | Sucursal "Clínica federada" | Sede "Sede federada" |
| Descuento de convenio | % (0–100) | PERCENTAGE (otros tipos viajan como 0 %) |
