# dental-carga-diaria

Carga diaria automática de datos de prueba realistas en **DentalCloud**
(dentalcloudia.netlify.app), con federación hacia **Dental-Demo**
(dentalaicloud.netlify.app). Todo se hace **por la interfaz web** con Playwright,
exactamente como lo haría una persona: no se toca la base de datos ni la API.

## Qué hace cada día (08:45 → antes de las 18:00)

1. Genera un plan del día: 10 clínicas nuevas y 300 pacientes repartidos entre ellas,
   con datos chilenos ficticios pero con formato real (RUT válido, +56 9, comunas, isapres).
2. Genera logos, fotos de perfil (≈1 de cada 4 pacientes) y PDFs de documentos.
3. **Superadmin**: crea cada holding, lo conecta con Dental-Demo (federación completa,
   sin "Solo catálogo") y habilita todos los módulos.
4. **Administrador de cada clínica**: sillones, sucursales, previsiones, convenios,
   prestaciones, profesionales (con firma) y horarios.
5. **Operador**: pagos de consulta previos (≈45 % de los pacientes, en "Pagos de Consulta")
   y luego las fichas de paciente completas. **Administrador**: citas.
   **Odontólogos**: motivo de consulta, presupuestos con odontograma y evoluciones.
   **Administrador**: abonos en cartola, observaciones y documentos clínicos.
6. Escribe un informe técnico en `reports/<runId>/report.md` (y `reports/ULTIMO-INFORME.md`)
   y un **Word para el equipo** en `<Escritorio>\Carga Diaria Dental\Carga AAAA-MM-DD.docx`
   con clínicas y pacientes ingresados y las credenciales de los usuarios creados.
7. Sincroniza con GitHub los 4 repos del producto (solo trae cambios de los compañeros,
   nunca los modifica; ante conflicto se detiene e informa) y commitea este proyecto.
   El código del producto no se modifica jamás desde aquí.

Nada se borra ni se desactiva: las clínicas se acumulan día a día. Todas llevan el
prefijo `Demo` en el nombre y quedan anotadas en `data/registry.json`.

## Puesta en marcha

```bash
npm install
npx playwright install chromium
copy .env.example .env      # y completar credenciales (ver abajo)
```

En `.env` hay que completar **tres** valores: correo y contraseña del superadmin de
DentalCloud, y la contraseña que se asignará a todos los usuarios creados (si se deja
vacía, el script genera una y la guarda en `data/clave-usuarios.txt`). El archivo también
se acepta con el nombre `.env.txt`, que es como suele guardarlo el Bloc de notas. Nadie
más que el script lee ese archivo; ambos nombres están en `.gitignore`.

Si una corrida termina "con errores", se reintenta solo lo que faltó con
`node src/run-daily.js --resume <runId> --no-git` (el runId es el nombre de la carpeta
en `reports/`). La reanudación omite todo lo que ya se creó.

### Prueba controlada (1 clínica, 10 pacientes)

```bash
npm run test-run
```

Equivale a `node src/run-daily.js --clinics 1 --patients 10 --tag prueba`.
Para ver el navegador mientras trabaja: `HEADLESS=false` en `.env`.

### Ejecución completa

```bash
npm run daily
```

Opciones útiles: `--clinics N`, `--patients N`, `--parallel N`, `--seed N`,
`--no-git`, `--only-setup`, `--deadline HH:MM`, `--resume <runId>` (continúa un plan
interrumpido usando `reports/<runId>/plan.json`).

### Programar a las 08:45 todos los días

```powershell
powershell -ExecutionPolicy Bypass -File C:\Proyectos\dental-carga-diaria\scripts\registrar-tarea.ps1 08:45
```

Crea (o actualiza) la tarea `DentalCargaDiaria` del Programador de tareas de Windows. El
equipo debe estar encendido y con la sesión iniciada a esa hora. El lanzador
`scripts/run-daily.cmd` fuerza el modo sin ventana y, si la corrida termina con errores en
algunos ítems, la reanuda una vez automáticamente para reintentar solo lo que faltó.

## Estructura

```
src/
  run-daily.js        orquestador (fases, paralelismo, hora límite, informe, git)
  config.js           .env → configuración; secretos solo como funciones
  browser.js          navegador y sesiones por usuario (cookie guardada en storage/)
  registry.js         data/registry.json: clínicas creadas, RUT y correos usados
  report.js           report.json / report.md
  word-report.js      Word diario para el equipo (carpeta del Escritorio)
  git-sync.js         fast-forward de los repos del producto + commit de este repo
  data/
    generator.js      plan del día (CONTRACT.md) · chile.js listas · images.js logos/avatares/PDF
    rut.js random.js  RUT válido · RNG con semilla
  pages/              un módulo por pantalla de la web (superadmin, pacientes, agenda,
                      catalogo, profesionales, tratamientos, evoluciones, cartola,
                      observaciones, documentos) — Playwright sobre los formularios reales
  flows/              clinic-setup.js (admin) · clinic-populate.js (operador/odontólogos/admin)
scripts/              run-daily.cmd (lanzador) · registrar-tarea.ps1 (tarea programada)
docs/                 análisis de ambas plataformas e inventario de información
```

## Reglas de seguridad del proceso

- Solo se crean datos; nunca se edita ni borra nada que el proceso no haya creado.
- Correos con dominio inexistente (`demo-fordent.invalid`): la web no puede enviar
  correos reales.
- Repos del producto: nunca `force push`, nunca merge automático, nunca se tocan cambios
  locales ajenos. Lista opcional de archivos propios por repo en `data/our-files.json`.
- Las contraseñas nunca se escriben en logs ni informes (el logger las tacha).
