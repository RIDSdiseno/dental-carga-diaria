// Escenas del video de presentación de fordentcloud.
// Convención de marca (pedido del cliente): en narración y tarjetas SOLO se dice
// "fordentcloud"; las dos plataformas se nombran por su función: "plataforma del
// holding" y "plataforma de la clínica". Los nombres internos no se pronuncian.
//
// Cada escena: id, section, title, screen (qué se ve, para el guion escrito),
// narration (texto literal de la voz) y run(ctx) con las acciones sobre la web real.
// ctx: { page, data, dc, dd, portal, login(role), goto(url), tab(label), card(id, {...}), scroll(px), pause(ms), dismissDebt() }

import { writeEmailCard } from './titles.js';
import { escapeRegExp } from '../pages/_helpers.js';

const HOLDING = 'la plataforma del holding';
const CLINICA = 'la plataforma de la clínica';

export function buildScenes(data = {}) {
  const CLINIC_NAME = data.clinic?.name || 'Demo Dental Las Palmas';
  const scenes = [
    {
      id: 'S01',
      section: 'Apertura',
      title: 'Qué es fordentcloud',
      screen: 'Tarjeta de título con el nombre del producto y sus dos plataformas.',
      narration:
        `Bienvenidos a fordentcloud. Es una solución completa para clínicas dentales y estéticas, formada por dos plataformas que trabajan conectadas. ${cap(HOLDING)} es donde el grupo crea sus clínicas, configura sus equipos y lleva toda la atención de los pacientes: agenda, presupuestos, evoluciones, cartola, documentos y radiografías. ${cap(CLINICA)} recibe automáticamente esa información y suma inventario, cotizaciones, cobranza y finanzas. Y el portal del paciente permite que cada persona reserve sus horas y revise su información desde su celular. En los próximos minutos veremos el recorrido completo: crear una clínica, configurarla, atender a un paciente y comprobar cómo todo aparece sincronizado, sin volver a cargar nada.`,
      run: (ctx) =>
        ctx.card('S01', {
          kicker: 'Presentación del sistema',
          title: 'fordentcloud',
          subtitle: 'Una plataforma para el holding, una para cada clínica y un portal para el paciente. Todo conectado.',
        }),
    },
    {
      id: 'S02',
      section: 'Parte 1 · Plataforma del holding',
      title: 'La plataforma del holding',
      screen: 'Tarjeta de sección "fordentcloud · Plataforma del holding".',
      narration: `Empezamos por ${HOLDING}. Aquí entra el super administrador, la persona que administra todas las clínicas del grupo.`,
      run: (ctx) =>
        ctx.card('S02', {
          kicker: 'Parte 1',
          title: 'Plataforma del holding',
          subtitle: 'Crear clínicas, activar su conexión con la plataforma de la clínica y habilitar sus módulos.',
        }),
    },
    {
      id: 'S03',
      section: 'Parte 1 · Plataforma del holding',
      title: 'Inicio de sesión y listado de holdings',
      screen: 'Pantalla de inicio de sesión; luego la página Holdings con la tabla de clínicas y el botón "Crear holding".',
      narration:
        'Al iniciar sesión como super administrador, lo primero que vemos es el listado de holdings, es decir, todas las clínicas registradas. Para cada una se muestra su tipo, dental, estética o mixta, su RUT, su estado, la cantidad de pacientes y el monto total de presupuestos. Con el botón Crear holding se agrega una clínica nueva: se indica el nombre, el RUT, el tipo y el país, se crean sus sucursales, cada una con su propio interruptor de conexión, y se define de inmediato su primer administrador.',
      run: async (ctx) => {
        await ctx.login('superadmin');
        await ctx.goto(`${ctx.dc}/admin/clinicas`);
        await ctx.page.getByRole('heading', { name: 'Holdings' }).waitFor();
        await ctx.pause(2500);
        await ctx.scroll(300);
      },
    },
    {
      id: 'S04',
      section: 'Parte 1 · Plataforma del holding',
      title: 'Ficha del holding y conexión entre plataformas',
      screen: `Detalle del holding "${CLINIC_NAME}": sección de conexión con la plataforma de la clínica, interruptor principal y conexiones individuales.`,
      narration:
        `Abrimos la clínica ${CLINIC_NAME}. En su ficha está la sección de conexión con ${CLINICA}. Este interruptor enlaza las dos plataformas. Cuando está activo, cada paciente, cada cita, cada presupuesto, los profesionales, las sucursales y el catálogo se copian automáticamente. Las conexiones individuales permiten decidir exactamente qué información se comparte, y cada sucursal puede conectarse por separado.`,
      run: async (ctx) => {
        await ctx.goto(`${ctx.dc}/admin/clinicas`);
        const row = ctx.page.locator('tr').filter({ has: ctx.page.getByText(ctx.data.clinic.name, { exact: true }) }).first();
        await row.scrollIntoViewIfNeeded();
        await ctx.pause(800);
        await row.click();
        await ctx.page.getByRole('heading', { name: 'Federación con Dental-Demo' }).waitFor({ timeout: 60000 });
        await ctx.pause(1500);
        await ctx.page.getByRole('heading', { name: 'Federación con Dental-Demo' }).scrollIntoViewIfNeeded();
      },
    },
    {
      id: 'S05',
      section: 'Parte 1 · Plataforma del holding',
      title: 'Módulos habilitados',
      screen: 'Sección "Módulos habilitados" del holding con los interruptores de cada módulo.',
      narration:
        'Más abajo están los módulos habilitados. El holding decide qué funciones tiene cada clínica: pacientes, agenda y citas, planes de tratamiento, documentos clínicos, cartola, evoluciones, observaciones, consentimientos y el módulo de radiografías. Cada uno se activa o desactiva con un clic.',
      run: async (ctx) => {
        await ctx.page.getByRole('heading', { name: 'Módulos habilitados' }).scrollIntoViewIfNeeded();
        await ctx.pause(500);
        await ctx.scroll(200);
      },
    },
    {
      id: 'S06',
      section: 'Parte 2 · Configurar la clínica',
      title: 'Configurar la clínica',
      screen: 'Tarjeta de sección "Configurar la clínica".',
      narration: 'Ahora entramos como administrador de la clínica. Antes de atender al primer paciente, la clínica se configura en pocos minutos.',
      run: (ctx) =>
        ctx.card('S06', {
          kicker: 'Parte 2',
          title: 'Configurar la clínica',
          subtitle: 'Sillones, agenda, catálogo, profesionales y horarios.',
        }),
    },
    {
      id: 'S07',
      section: 'Parte 2 · Configurar la clínica',
      title: 'Agenda general y sillones',
      screen: 'Inicio de sesión del administrador; página "Agenda general" con las columnas de sillones y las citas del día.',
      narration:
        'En Agenda general se ven los sillones o boxes de la clínica, cada uno con su columna de horas. Desde aquí se agregan sillones nuevos, se agendan citas y se atienden urgencias. La agenda muestra las citas del día por sillón y por profesional, y permite moverse entre fechas.',
      run: async (ctx) => {
        await ctx.login('admin');
        await ctx.goto(`${ctx.dc}/agenda`);
        await ctx.page.getByRole('heading', { name: 'Agenda general' }).waitFor({ timeout: 60000 });
        await ctx.pause(2500);
        // Ir a un día de la semana con citas (las pestañas dicen "Lun 10 Sep").
        const day = ctx.data.agendaDay;
        if (day && day.offsetDays !== 0) {
          const tab = ctx.page.getByRole('button', { name: new RegExp(`^[A-Za-zÁÉÍÓÚáéíóú]{3} ${day.day} `) }).first();
          if (await tab.count()) {
            await tab.click();
            await ctx.pause(2500);
          }
        }
        await ctx.scroll(350);
      },
    },
    {
      id: 'S08',
      section: 'Parte 2 · Configurar la clínica',
      title: 'Agenda diaria y horas publicadas',
      screen: 'Página "Agenda diaria" del profesional, con la línea de tiempo de citas y el botón "Agregar horas disponibles".',
      narration:
        'La Agenda diaria muestra la jornada de cada profesional. Y trae una función nueva: Agregar horas disponibles. El profesional publica horas sueltas, sin paciente todavía, y esas horas quedan a disposición de recepción y del portal del paciente, donde la propia persona puede tomarlas. Si dos personas intentan la misma hora a la vez, el sistema solo permite una reserva.',
      run: async (ctx) => {
        await ctx.goto(`${ctx.dc}/agenda/diaria`);
        await ctx.pause(2500);
        // Mover la agenda al día de la semana con citas, con los botones "Día siguiente" / "Día anterior".
        const day = ctx.data.agendaDay;
        const steps = day ? Math.min(6, Math.abs(day.offsetDays)) : 0;
        const label = day && day.offsetDays < 0 ? 'Día anterior' : 'Día siguiente';
        for (let i = 0; i < steps; i++) {
          await ctx.page.getByRole('button', { name: label, exact: true }).click().catch(() => undefined);
          await ctx.pause(700);
        }
        await ctx.pause(2000);
        await ctx.scroll(250);
      },
    },
    {
      id: 'S09',
      section: 'Parte 2 · Configurar la clínica',
      title: 'Catálogo: prestaciones, convenios, previsiones y sucursales',
      screen: 'Página "Catálogo" recorriendo las pestañas Prestaciones, Convenios, Previsiones y Clínicas (sucursales); botones de carga y descarga por Excel.',
      narration:
        'En Catálogo está todo lo que la clínica ofrece. Las prestaciones, con su código, nombre, precio y la forma en que se marcan en el odontograma: por pieza, por cara, por cuadrante o por sesión, y con carga y descarga masiva por Excel. Los convenios, con su porcentaje de descuento. Las previsiones de salud, como Fonasa, isapres o particular. Y las sucursales físicas de la clínica, cada una con su dirección.',
      run: async (ctx) => {
        await ctx.goto(`${ctx.dc}/catalogo`);
        await ctx.page.getByRole('heading', { name: 'Catálogo' }).waitFor({ timeout: 60000 });
        await ctx.pause(8000);
        for (const tab of ['Convenios', 'Previsiones', 'Clínicas']) {
          await ctx.tab(tab);
          await ctx.pause(4500);
        }
      },
    },
    {
      id: 'S10',
      section: 'Parte 2 · Configurar la clínica',
      title: 'Profesionales y horarios',
      screen: 'Página "Profesionales" con el equipo; se abre el modal "Horario" de un odontólogo con sus bloques por día y sillón.',
      narration:
        'En Profesionales se administra el equipo: odontólogos, radiólogos, operadores de recepción y administradores. Cada profesional tiene su correo de acceso, su RUT, su firma para los documentos y sus permisos. Con el botón Horario se define en qué días, en qué horas y en qué sillón atiende cada uno. Esa información alimenta la agenda.',
      run: async (ctx) => {
        await ctx.goto(`${ctx.dc}/profesionales`);
        await ctx.page.getByRole('heading', { name: 'Profesionales' }).waitFor({ timeout: 60000 });
        await ctx.pause(6000);
        const pro = ctx.data.professionalWithSchedule;
        const row = ctx.page.locator('tr').filter({ hasText: pro.email }).first();
        if (await row.count()) {
          await row.getByRole('button', { name: 'Horario' }).click();
          await ctx.page.getByRole('heading', { level: 2, name: /^Horario de / }).waitFor();
          ctx.openModal = true;
        }
      },
      after: closeModal,
    },
    {
      id: 'S11',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'El recorrido de un paciente',
      screen: 'Tarjeta de sección "El recorrido de un paciente".',
      narration: 'Con la clínica lista, seguimos el recorrido completo de un paciente, tal como ocurre en el día a día, con cada rol haciendo su parte.',
      run: (ctx) =>
        ctx.card('S11', {
          kicker: 'Parte 3',
          title: 'El recorrido de un paciente',
          subtitle: 'Desde el pago de consulta hasta los documentos clínicos, con recepción, odontólogo y administración.',
        }),
    },
    {
      id: 'S12',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'Recepción: pagos de consulta',
      screen: 'Inicio de sesión del operador; página "Pagos de Consulta" con el formulario de registro y la tabla de pagos.',
      narration:
        'Entramos como recepción. Cuando una persona paga su consulta antes de ser atendida, se registra en Pagos de Consulta: RUT, nombre, correo, monto y método de pago. Es una lista informativa que permite saber quién ya pagó. Y tiene un beneficio: al crear la ficha de ese paciente, el sistema reconoce su RUT y completa sus datos automáticamente.',
      run: async (ctx) => {
        await ctx.login('operador');
        await ctx.goto(`${ctx.dc}/pagos-consulta`);
        await ctx.page.getByRole('heading', { name: 'Pagos de Consulta' }).waitFor({ timeout: 60000 });
        await ctx.pause(4000);
        await ctx.scroll(350);
      },
    },
    {
      id: 'S13',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'Recepción: pacientes y ficha completa',
      screen: 'Página "Pacientes" con el buscador; se busca a la paciente y se abre su ficha en la pestaña "Datos paciente".',
      narration:
        'En Pacientes está el listado con búsqueda por nombre, apellido o RUT. Al crear una ficha nueva se registra todo: datos personales, teléfono, correo, dirección, género, estado civil, ocupación, previsión y plan, contacto de emergencia, altura, peso, grupo sanguíneo, alergias, condiciones médicas, medicamentos, enfermedades crónicas, antecedentes dentales y etiquetas. Abrimos la ficha de una paciente para verla completa.',
      run: async (ctx) => {
        await ctx.goto(`${ctx.dc}/pacientes`);
        await ctx.page.getByPlaceholder('Buscar por nombre, apellido o RUT...').waitFor({ timeout: 60000 });
        await ctx.pause(3500);
        await ctx.page.getByPlaceholder('Buscar por nombre, apellido o RUT...').pressSequentially(ctx.data.patient.lastName.split(' ')[0], { delay: 90 });
        await ctx.pause(1800);
        const row = ctx.page.locator('tr').filter({ hasText: ctx.data.patient.rut }).first();
        await row.click();
        await ctx.page.getByRole('button', { name: 'Datos paciente' }).waitFor({ timeout: 60000 });
        await ctx.dismissDebt();
      },
    },
    {
      id: 'S14',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'La ficha del paciente',
      screen: 'Recorrido por la pestaña "Datos paciente": identificación, datos personales, antecedentes médicos, alergias y etiquetas.',
      narration:
        'La ficha reúne toda esa información en un solo lugar: identificación y contacto, datos personales, antecedentes médicos con las alergias destacadas, y las etiquetas de seguimiento. Cualquier profesional autorizado ve lo mismo, desde cualquier sucursal.',
      run: async (ctx) => {
        await ctx.scroll(300);
        await ctx.pause(3000);
        await ctx.scroll(400);
        await ctx.pause(3000);
        await ctx.scroll(400);
      },
    },
    {
      id: 'S15',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'Las citas del paciente',
      screen: 'Pestaña "Horas" de la ficha con las citas pasadas y futuras, y el botón "Nueva cita".',
      narration:
        'En la pestaña Horas están las citas del paciente: pasadas y futuras, con su sillón, su profesional y su estado. Desde el botón Nueva cita, recepción agenda directamente desde la ficha, eligiendo sillón, fecha y hora, o tomando una de las horas ya publicadas por el profesional.',
      run: async (ctx) => {
        await ctx.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await ctx.pause(800);
        await ctx.tab('Horas');
        await ctx.pause(1500);
        await ctx.scroll(250);
      },
    },
    {
      id: 'S16',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'Odontólogo: motivo de consulta',
      screen: 'Inicio de sesión del odontólogo; ficha de la paciente con la tarjeta "Motivo de consulta" y la opción de grabar con voz.',
      narration:
        'Ahora entra el odontólogo. En la ficha registra el motivo de consulta, escribiéndolo o grabándolo con su voz, siempre que el paciente haya firmado el consentimiento correspondiente. Ese motivo queda visible para todo el equipo clínico.',
      run: async (ctx) => {
        await ctx.login('odontologo');
        await ctx.goto(`${ctx.dc}/pacientes/${ctx.data.patient.id}`);
        await ctx.page.getByRole('button', { name: 'Datos paciente' }).waitFor({ timeout: 60000 });
        await ctx.dismissDebt();
        await ctx.pause(1000);
        await ctx.page.getByRole('heading', { name: 'Motivo de consulta' }).scrollIntoViewIfNeeded();
      },
    },
    {
      id: 'S17',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'Odontólogo: presupuestos con odontograma',
      screen: 'Pestaña "Tratamientos": lista de presupuestos de la paciente; se abre el detalle de uno con sus prestaciones, piezas y total.',
      narration:
        'En Tratamientos se crean los presupuestos. El asistente guía en tres pasos: la sucursal, la previsión y el convenio; luego las prestaciones, marcadas directamente en el odontograma, pieza por pieza o por cara; y finalmente la forma de pago y las observaciones. El presupuesto queda con su número, su detalle por prestación y su total. Cuando el paciente lo acepta, pasa a estar en tratamiento, y al terminar se da de alta con un informe.',
      run: async (ctx) => {
        await ctx.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await ctx.pause(600);
        await ctx.tab('Tratamientos');
        await ctx.page.getByRole('heading', { name: 'Presupuestos' }).waitFor({ timeout: 60000 });
        await ctx.pause(5000);
        const plan = ctx.page.getByText(/^N° \d+/).first();
        if (await plan.count()) {
          await plan.click().catch(() => undefined);
          await ctx.pause(1500);
          ctx.openModal = (await ctx.page.locator('button[aria-label="Cerrar"]').count()) > 0;
        }
      },
      after: closeModal,
    },
    {
      id: 'S18',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'Odontólogo: evoluciones',
      screen: 'Pestaña "Evoluciones" con el historial de atenciones firmadas por el profesional y el editor para crear una nueva.',
      narration:
        'En Evoluciones el odontólogo documenta cada atención: qué se hizo, con qué producto y lote si corresponde, y fotos del procedimiento. Cada evolución puede asociarse a una prestación del presupuesto, y queda firmada por el profesional que la registró.',
      run: async (ctx) => {
        await ctx.tab('Evoluciones');
        await ctx.pause(2500);
        await ctx.scroll(300);
      },
    },
    {
      id: 'S19',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'Consentimientos y radiografías',
      screen: 'Pestaña "Consentimientos" con los tipos de consentimiento y su estado; luego la pestaña "Módulo Rx" con las órdenes de radiografías.',
      narration:
        'En Consentimientos se gestionan los consentimientos informados del paciente: se envían por correo para firma electrónica o se firman en la clínica, y cada uno queda con su fecha, su firma y su documento. Y en el módulo de radiografías el odontólogo solicita exámenes al centro radiológico, indicando las piezas, y recibe las imágenes y los informes directamente en la ficha.',
      run: async (ctx) => {
        await ctx.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await ctx.pause(500);
        await ctx.tab('Consentimientos');
        await ctx.pause(9000);
        const rx = ctx.page.getByRole('button', { name: 'Módulo Rx', exact: true });
        if (await rx.count()) {
          await rx.click();
          await ctx.pause(1500);
        }
      },
    },
    {
      id: 'S20',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'Administración: cartola',
      screen: 'Inicio de sesión del administrador; pestaña "Cartola" de la paciente con abonos, saldo y presupuestos asociados.',
      narration:
        `Volvemos al administrador para ver la cartola, la cuenta corriente del paciente. Aquí se registran los abonos, con su forma de pago y número de documento, los intereses y los ajustes. Cada movimiento puede asociarse a un presupuesto, y el saldo se actualiza al instante. Los abonos que se registren en ${CLINICA} también llegan aquí automáticamente. Si el paciente tiene deuda, la ficha lo avisa al abrirla.`,
      run: async (ctx) => {
        await ctx.login('admin');
        await ctx.goto(`${ctx.dc}/pacientes/${ctx.data.patient.id}`);
        await ctx.page.getByRole('button', { name: 'Datos paciente' }).waitFor({ timeout: 60000 });
        await ctx.pause(1200);
        await ctx.dismissDebt();
        await ctx.tab('Cartola');
        await ctx.pause(2000);
        await ctx.scroll(250);
      },
    },
    {
      id: 'S21',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'Documentos clínicos',
      screen: 'Pestaña "Documentos clínicos" con las categorías (recetas, derivaciones, imágenes, altas, etc.) y los archivos subidos.',
      narration:
        'En Documentos clínicos se guardan recetas, derivaciones, imágenes, altas, solicitudes de laboratorio y documentos de pabellón, organizados por categoría y disponibles para descargar en cualquier momento.',
      run: async (ctx) => {
        await ctx.tab('Documentos clínicos');
        await ctx.pause(2500);
        await ctx.scroll(200);
      },
    },
    {
      id: 'S26',
      section: 'Parte 4 · Dental, estética o ambas',
      title: 'Una plataforma por tipo de clínica',
      screen: 'Tarjeta de sección "Dental, estética o ambas".',
      narration:
        'Hasta aquí vimos una clínica dental. Pero fordentcloud se adapta al tipo de cada clínica: puede ser dental, de estética facial, o las dos cosas a la vez. Según lo que sea, la plataforma cambia: cambia el catálogo, cambian las pantallas de la ficha y cambia la forma de armar un presupuesto.',
      run: (ctx) =>
        ctx.card('S26', {
          kicker: 'Parte 4',
          title: 'Dental, estética o ambas',
          subtitle: 'Cada clínica se crea con su tipo y la plataforma se adapta: catálogo, ficha y presupuestos.',
        }),
    },
    {
      id: 'S27',
      section: 'Parte 4 · Dental, estética o ambas',
      title: 'El tipo se elige al crear la clínica',
      screen: 'Listado de holdings mostrando la columna Tipo (Dental, Estética facial, Dental y estética); se abre "Crear holding" y se despliega el selector Tipo con sus tres opciones.',
      narration:
        'El tipo se define al crear la clínica, con tres opciones: Dental, Estética facial, o Dental y estética. En el listado del holding se ve de inmediato qué es cada una. Y no es solo una etiqueta: de esa elección depende todo lo que el equipo verá después.',
      run: async (ctx) => {
        await ctx.login('superadmin');
        await ctx.goto(`${ctx.dc}/admin/clinicas`);
        await ctx.page.getByRole('heading', { name: 'Holdings' }).waitFor({ timeout: 60000 });
        await ctx.pause(3500);
        await ctx.page.getByRole('button', { name: 'Crear holding' }).click();
        const dlg = ctx.page.locator('div.fixed.inset-0').filter({ has: ctx.page.getByRole('heading', { level: 2, name: 'Crear holding' }) }).last();
        await dlg.waitFor();
        await ctx.pause(2500);
        const tipo = dlg.locator('#clinica-tipo');
        await tipo.scrollIntoViewIfNeeded();
        for (const value of ['estetica', 'ambas', 'dental']) {
          await tipo.selectOption(value);
          await ctx.pause(1600);
        }
        ctx.openModal = true;
      },
      after: closeModal,
    },
    {
      id: 'S28',
      section: 'Parte 4 · Dental, estética o ambas',
      title: 'Clínica de estética: catálogo y examen estético',
      screen: `Clínica "${data.extra?.estetica?.clinic?.name || 'de estética'}": catálogo con tratamientos faciales, y ficha del paciente en la pestaña "Examen Estético" con evaluación, registro fotográfico y diagnóstico.`,
      narration:
        'Esta es una clínica de estética facial. Su catálogo no tiene obturaciones ni endodoncias: tiene toxina botulínica, ácido hialurónico, bioestimuladores e hilos tensores, cada uno con su precio. Y la ficha del paciente suma una pestaña propia, Examen Estético: tipo de piel, fototipo, arrugas, flacidez, volumen, asimetrías y otros hallazgos. Debajo, el registro fotográfico con cuatro tomas, frontal, perfil y las dos de cuarenta y cinco grados, y el diagnóstico, que el profesional puede dictar con su voz.',
      run: async (ctx) => {
        const b = ctx.data.extra?.estetica;
        if (!b) return;
        await ctx.login('admin-estetica');
        await ctx.goto(`${ctx.dc}/catalogo`);
        await ctx.page.getByRole('heading', { name: 'Catálogo' }).waitFor({ timeout: 60000 });
        await ctx.pause(6000);
        await ctx.scroll(300);
        await ctx.pause(2500);
        await ctx.goto(`${ctx.dc}/pacientes/${b.patient.id}`);
        await ctx.page.getByRole('button', { name: 'Datos paciente' }).waitFor({ timeout: 60000 });
        await ctx.dismissDebt();
        await ctx.tab('Examen Estético');
        await ctx.page.getByRole('heading', { name: 'Evaluación estética' }).waitFor({ timeout: 60000 });
        await ctx.pause(2500);
        // Se completa la evaluación en vivo: así la pantalla no queda en "No especificado".
        const campos = [
          ['Tipo de piel', 'mixta'],
          ['Fototipo Fitzpatrick', 'III'],
          ['Arrugas', 'dinamicas'],
          ['Flacidez', 'leve'],
          ['Volumen', 'deficit'],
          ['Asimetrías', 'si'],
        ];
        for (const [label, value] of campos) {
          await ctx.page.getByLabel(label, { exact: true }).selectOption(value).catch(() => undefined);
          await ctx.pause(700);
        }
        const hallazgos = ctx.page.getByLabel('Otros hallazgos', { exact: true });
        if (await hallazgos.count()) await hallazgos.pressSequentially('Leve asimetría de comisura labial derecha.', { delay: 35 });
        await ctx.pause(1200);
        // Registro fotográfico y diagnóstico. Los recuadros de foto NO se pulsan:
        // abren el selector de archivos del sistema y arruinarían la grabación.
        await ctx.page.getByRole('heading', { name: 'Registro fotográfico' }).scrollIntoViewIfNeeded();
        await ctx.pause(3000);
        await ctx.page.getByRole('heading', { name: 'Diagnóstico' }).scrollIntoViewIfNeeded();
        const diag = ctx.page.getByPlaceholder('Escribe o dicta el diagnóstico con el micrófono...');
        if (await diag.count()) await diag.pressSequentially('Envejecimiento facial leve. Tercio superior con arrugas dinámicas y déficit de volumen malar.', { delay: 22 });
        // El micrófono solo se señala: el dictado por voz no funciona en el navegador de grabación.
        await ctx.page.getByRole('button', { name: 'Dictar diagnóstico por voz' }).hover().catch(() => undefined);
        await ctx.pause(1500);
        await ctx.page.getByRole('button', { name: 'Guardar examen', exact: true }).click().catch(() => undefined);
        await ctx.pause(2000);
      },
    },
    {
      id: 'S29',
      section: 'Parte 4 · Dental, estética o ambas',
      title: 'Clínica de estética: presupuesto con mapa facial',
      screen: 'Asistente "Nuevo presupuesto" de la clínica de estética: en el paso de prestaciones aparece el mapa facial del rostro en vez del odontograma; se elige un tratamiento y se marca la zona.',
      narration:
        'Y al armar un presupuesto, en lugar del odontograma aparece el mapa facial. El profesional elige el tratamiento, por ejemplo ácido hialurónico en labios, y marca directamente la zona del rostro: frente, entrecejo, pómulos, labios, mentón o cuello. El mapa tiene acercamiento, capas, vista de perfil y deshacer. Cada zona queda en el presupuesto con su precio, y se pueden adjuntar las fotos de antes y después.',
      run: async (ctx) => {
        const b = ctx.data.extra?.estetica;
        if (!b) return;
        if (b.dentist) await ctx.login('odontologo-estetica');
        await ctx.goto(`${ctx.dc}/pacientes/${b.patient.id}`);
        await ctx.page.getByRole('button', { name: 'Datos paciente' }).waitFor({ timeout: 60000 });
        await ctx.dismissDebt();
        await ctx.tab('Tratamientos');
        await ctx.page.getByRole('heading', { name: 'Presupuestos' }).waitFor({ timeout: 60000 });
        await ctx.pause(2000);
        await ctx.page.getByRole('button', { name: 'Nuevo presupuesto', exact: true }).click();
        const dlg = ctx.page.locator('div.fixed.inset-0').filter({ has: ctx.page.getByRole('heading', { level: 2, name: 'Nuevo presupuesto' }) }).last();
        await dlg.waitFor();
        ctx.openModal = true;
        await ctx.pause(4000);
        // Paso 1 → paso 2 (prestaciones sobre el mapa facial).
        await dlg.getByRole('button', { name: 'Siguiente', exact: true }).first().click().catch(() => undefined);
        await ctx.pause(3500);
        // Elegir una prestación estética y marcar una zona del rostro.
        const search = dlg.getByPlaceholder(/destartraje|prestaci|buscar/i).first();
        if (await search.count()) {
          await search.pressSequentially(b.estheticPrestacion?.name?.slice(0, 18) || 'Ácido hialurónico', { delay: 70 });
          await ctx.pause(1800);
          const option = dlg.getByRole('button', { name: new RegExp(escapeRegExp(b.estheticPrestacion?.name || 'Ácido'), 'i') }).first();
          if (await option.count()) {
            await option.click().catch(() => undefined);
            await ctx.pause(2500);
          }
        }
        for (const zone of ['Labios', 'Nasogenianos', 'Pómulos']) {
          const z = dlg.getByRole('button', { name: zone, exact: true }).first();
          if (await z.count()) {
            await z.click().catch(() => undefined);
            await ctx.pause(1600);
          }
        }
        await ctx.pause(2000);
      },
      after: closeModal,
    },
    {
      id: 'S30',
      section: 'Parte 4 · Dental, estética o ambas',
      title: 'Clínica mixta: lo dental y lo estético juntos',
      screen: `Clínica "${data.extra?.ambas?.clinic?.name || 'mixta'}": catálogo con prestaciones dentales y estéticas, y el asistente de presupuesto con el selector Odontograma / Mapa facial.`,
      narration:
        'Y si la clínica atiende las dos cosas, tiene todo junto. Su catálogo mezcla prestaciones dentales y estéticas, y cada una se clasifica al crearla. En el presupuesto, el profesional decide con qué diagrama trabajar: odontograma para lo dental, mapa facial para lo estético, en el mismo asistente y para el mismo paciente. Una sola ficha, una sola cuenta corriente, y cada tratamiento registrado donde corresponde.',
      run: async (ctx) => {
        const b = ctx.data.extra?.ambas;
        if (!b) return;
        await ctx.login('admin-ambas');
        await ctx.goto(`${ctx.dc}/catalogo`);
        await ctx.page.getByRole('heading', { name: 'Catálogo' }).waitFor({ timeout: 60000 });
        await ctx.pause(5500);
        await ctx.scroll(300);
        await ctx.pause(2000);
        // Asistente de presupuesto: selector Odontograma / Mapa facial (solo en clínicas mixtas).
        await ctx.goto(`${ctx.dc}/pacientes/${b.patient.id}`);
        await ctx.page.getByRole('button', { name: 'Datos paciente' }).waitFor({ timeout: 60000 });
        await ctx.dismissDebt();
        await ctx.tab('Tratamientos');
        await ctx.page.getByRole('heading', { name: 'Presupuestos' }).waitFor({ timeout: 60000 });
        await ctx.pause(1500);
        await ctx.page.getByRole('button', { name: 'Nuevo presupuesto', exact: true }).click();
        const dlg = ctx.page.locator('div.fixed.inset-0').filter({ has: ctx.page.getByRole('heading', { level: 2, name: 'Nuevo presupuesto' }) }).last();
        await dlg.waitFor();
        ctx.openModal = true;
        await ctx.pause(3000);
        for (const label of ['Mapa facial', 'Odontograma']) {
          const btn = dlg.getByRole('button', { name: label, exact: true }).first();
          if (await btn.count()) {
            await btn.click().catch(() => undefined);
            await ctx.pause(2600);
          }
        }
        await ctx.pause(1500);
      },
      after: closeModal,
    },
    {
      id: 'S22',
      section: 'Parte 5 · Plataforma de la clínica',
      title: 'La plataforma de la clínica',
      screen: 'Tarjeta de sección "fordentcloud · Plataforma de la clínica".',
      narration: `Hasta aquí, todo lo cargamos en ${HOLDING}. Ahora abrimos ${CLINICA} para comprobar qué pasó con esa información.`,
      run: (ctx) =>
        ctx.card('S22', {
          kicker: 'Parte 5',
          title: 'Plataforma de la clínica',
          subtitle: 'La misma información, ya sincronizada, más inventario, cotizaciones, cobranza y finanzas.',
        }),
    },
    {
      id: 'S23',
      section: 'Parte 5 · Plataforma de la clínica',
      title: 'Panel de plataforma',
      screen: 'Inicio de sesión en la plataforma de la clínica; panel de plataforma con el resumen de clínicas y actividad.',
      narration:
        `Ingresamos a ${CLINICA} con la cuenta de super administrador. El panel de plataforma muestra el resumen general: clínicas activas, suscripciones y actividad. Ninguna de estas clínicas se creó aquí: llegaron solas desde ${HOLDING} gracias a la conexión que activamos al inicio.`,
      run: async (ctx) => {
        await ctx.login('demo');
        await ctx.goto(`${ctx.dd}/admin-plataforma/resumen`);
        await ctx.pause(4000);
        await ctx.scroll(300);
      },
    },
    {
      id: 'S24',
      section: 'Parte 5 · Plataforma de la clínica',
      title: 'La clínica reflejada',
      screen: `Listado de clínicas de la plataforma; se abre "${CLINIC_NAME}" con sus datos sincronizados.`,
      narration:
        `En el listado de clínicas encontramos ${CLINIC_NAME}, la misma que configuramos en ${HOLDING}. Su ficha ya trae las sucursales, los profesionales, el catálogo de prestaciones, las previsiones, los convenios, los pacientes y sus citas. La sincronización es automática y funciona en ambos sentidos: lo que se corrige en una plataforma se refleja en la otra.`,
      run: async (ctx) => {
        await ctx.goto(`${ctx.dd}/admin-plataforma/clinicas`);
        await ctx.pause(3500);
        const search = ctx.page.getByPlaceholder(/buscar/i).first();
        if (await search.count()) {
          await search.fill(ctx.data.clinic.name);
          await ctx.pause(1500);
        }
        const link = ctx.page.getByText(ctx.data.clinic.name, { exact: true }).first();
        if (await link.count()) {
          await link.scrollIntoViewIfNeeded();
          await ctx.pause(700);
          await link.click().catch(() => undefined);
          await ctx.pause(3000);
          await ctx.scroll(300);
        }
      },
    },
    {
      id: 'S25',
      section: 'Parte 5 · Plataforma de la clínica',
      title: 'Lo que agrega la plataforma de la clínica',
      screen: 'Inicio de sesión como administrador de la clínica; listado de pacientes reflejados y página de Inventario con insumos y lotes.',
      narration:
        `Ahora entramos a ${CLINICA} como administrador de la clínica. Sus pacientes ya están aquí, con la misma información que se cargó en ${HOLDING}. Y esta plataforma agrega lo que la clínica necesita en su operación diaria: el inventario de insumos con lotes, vencimientos y movimientos, que ${HOLDING} usa cuando una prestación exige registrar el producto aplicado; el mapa facial y la simulación estética; las cotizaciones y la cobranza; y las liquidaciones, los reportes y el marketing.`,
      run: async (ctx) => {
        await ctx.login('demo-admin');
        if (/\/login/.test(ctx.page.url())) {
          await ctx.login('demo');
          await ctx.goto(`${ctx.dd}/admin-plataforma/resumen`);
          await ctx.pause(3000);
          return;
        }
        await ctx.goto(`${ctx.dd}/agenda/pacientes`);
        await ctx.pause(9000);
        await ctx.scroll(250);
        await ctx.pause(2000);
        await ctx.goto(`${ctx.dd}/operaciones/inventario`);
        await ctx.pause(3000);
        if (/sin-autorizacion|login/.test(ctx.page.url())) await ctx.goto(`${ctx.dd}/dashboard`);
        await ctx.scroll(250);
      },
    },
  ];

  // Parte 5 · Portal del paciente (se activa cuando se conoce la URL: variable PORTAL_URL o config).
  scenes.push(...portalScenes());

  scenes.push({
    id: 'S99',
    section: 'Cierre',
    title: 'Todo conectado, sin doble trabajo',
    screen: 'Tarjeta de cierre con el resumen de beneficios.',
    narration:
      `En resumen: con fordentcloud el holding crea y controla sus clínicas, cada clínica se configura en minutos, recepción y odontólogos trabajan sobre la misma ficha, toda la información viaja sola a ${CLINICA}, donde se completa con inventario, cotizaciones, cobranza y finanzas, y el paciente participa desde su propio portal. Una sola carga, todas las plataformas siempre al día, y trazabilidad completa de cada paciente. Gracias por acompañarnos. Esto es fordentcloud.`,
    run: (ctx) =>
      ctx.card('S99', {
        kicker: 'Cierre',
        title: 'Todo conectado, sin doble trabajo',
        bullets: [
          'Una sola carga de datos, todas las plataformas siempre al día',
          'Roles claros: holding, administración, recepción, equipo clínico y paciente',
          'Trazabilidad completa: agenda, presupuesto, evolución, cartola y documentos',
        ],
      }),
  });

  return scenes;
}

/**
 * Escenas del portal del paciente. Requieren PORTAL_URL (variable de entorno); si falta, se omiten.
 * El portal exige verificar el correo antes de entrar, así que se muestran sus pantallas de acceso y
 * registro, el correo real que recibe el paciente al agendar, y un resumen de lo que ve una vez dentro.
 */
function portalScenes() {
  const url = (process.env.PORTAL_URL || '').trim();
  if (!url) return [];
  return [
    {
      id: 'S40',
      section: 'Parte 6 · Portal del paciente',
      title: 'El portal del paciente',
      screen: 'Tarjeta de sección "fordentcloud · Portal del paciente".',
      narration:
        'Falta una pieza: el paciente. fordentcloud también le da su propio espacio, el portal del paciente, pensado para usarse desde el celular. Desde ahí reserva sus horas, revisa sus citas, su presupuesto y sus pagos, sin llamar a la clínica.',
      run: (ctx) =>
        ctx.card('S40', {
          kicker: 'Parte 6',
          title: 'Portal del paciente',
          subtitle: 'Reservar horas, ver citas, presupuesto y pagos, desde cualquier dispositivo.',
        }),
    },
    {
      id: 'S41',
      section: 'Parte 6 · Portal del paciente',
      title: 'Crear la cuenta del paciente',
      screen: 'Portal del paciente: pantalla de ingreso y formulario "Registrarse" con RUT, correo y contraseña; se completa con los datos de la paciente sin enviarlo.',
      narration:
        `El paciente entra al portal y crea su cuenta con tres datos: su RUT, su correo y una contraseña. El sistema comprueba que ese RUT y ese correo coincidan con la ficha que la clínica creó en ${HOLDING}: no se puede registrar nadie que no sea paciente. Luego le llega un correo para confirmar su dirección, y con eso queda activo. Si olvida la contraseña, la recupera también por correo.`,
      run: async (ctx) => {
        await ctx.goto(ctx.portal);
        await ctx.pause(5000);
        await ctx.goto(`${ctx.portal.replace(/\/$/, '')}/registrarse`);
        await ctx.pause(1500);
        const rut = ctx.page.locator('#rut');
        if (await rut.count()) {
          await rut.pressSequentially(ctx.data.patient.rut, { delay: 60 });
          await ctx.page.locator('#email').pressSequentially(ctx.data.patient.email, { delay: 30 });
          await ctx.page.locator('#password').fill('Paciente2026!');
        }
      },
    },
    {
      id: 'S42',
      section: 'Parte 6 · Portal del paciente',
      title: 'Reservar una hora y recibir la confirmación',
      screen: 'Correo real de confirmación que recibe el paciente al agendar desde el portal: clínica, profesional, fecha y hora.',
      narration:
        `Una vez dentro, en Agendar hora el paciente elige el profesional y el día, y ve solo las horas que ese profesional publicó desde su agenda. Toma la que le acomoda y la reserva. En ese instante la hora queda ocupada en la agenda de la clínica en ${HOLDING}, se refleja en ${CLINICA}, y el paciente recibe este correo de confirmación con la clínica, el profesional, la fecha y la hora. Nadie más puede tomar esa misma hora.`,
      run: async (ctx) => {
        // Correo con los datos reales de la paciente, su odontólogo y su clínica.
        const p = ctx.data.patient;
        const appt = (ctx.data.clinic.appointments || []).find((a) => a.patientKey === p.key && a.done);
        const when = appt ? new Date(`${appt.date}T${appt.time}:00`) : new Date(Date.now() + 2 * 86400000);
        const url = writeEmailCard(ctx.cardsDir, {
          patientFirstName: p.firstName.split(' ')[0],
          professionalName: ctx.data.dentist?.name || 'Odontólogo tratante',
          clinicaNombre: ctx.data.clinic.name,
          dateLabel: when.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
          timeLabel: appt ? appt.time : '10:30',
          to: p.email,
        });
        await ctx.page.goto(url);
        await ctx.pause(1000);
      },
    },
    {
      id: 'S43',
      section: 'Parte 6 · Portal del paciente',
      title: 'Lo que el paciente ve en su portal',
      screen: 'Tarjeta resumen con las secciones del portal: Mis citas, Agendar hora, Mi perfil con Mi presupuesto, historial de pagos y descarga en PDF.',
      narration:
        'En Mis citas revisa sus atenciones pasadas y las próximas. En Mi perfil ve a los doctores de su clínica y su presupuesto: lo que debe, lo que ha abonado y lo que le falta por pagar, con cada abono registrado en la cartola, y puede descargar su presupuesto en PDF. Una campanita le avisa cuando se publican horas nuevas. Todo eso sale de la misma información que el equipo de la clínica ya cargó: el paciente no llena nada dos veces.',
      run: (ctx) =>
        ctx.card('S43', {
          kicker: 'Portal del paciente',
          title: 'Lo que el paciente ve',
          bullets: [
            'Mis citas: historial y próximas atenciones',
            'Agendar hora: solo las horas publicadas por cada profesional',
            'Mi perfil: doctores de la clínica y Mi presupuesto con historial de pagos',
            'Descarga del presupuesto en PDF y avisos de horas nuevas',
          ],
        }),
    },
  ];
}

async function closeModal(ctx) {
  if (ctx.openModal) {
    await ctx.page.locator('button[aria-label="Cerrar"]').last().click().catch(() => undefined);
    ctx.openModal = false;
  }
}

function cap(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
