// Escenas del video de presentación de fordentcloud.
// Convención de marca (pedido del cliente): en narración y tarjetas SOLO se dice
// "fordentcloud"; las dos plataformas se nombran por su función: "plataforma del
// holding" y "plataforma de la clínica". Los nombres internos no se pronuncian.
//
// Cada escena: id, section, title, screen (qué se ve, para el guion escrito),
// narration (texto literal de la voz) y run(ctx) con las acciones sobre la web real.
// ctx: { page, data, dc, dd, portal, login(role), goto(url), tab(label), card(id, {...}), scroll(px), pause(ms), dismissDebt() }

const HOLDING = 'la plataforma del holding';
const CLINICA = 'la plataforma de la clínica';

export function buildScenes() {
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
      screen: 'Detalle del holding "Demo Dental Las Palmas": sección de conexión con la plataforma de la clínica, interruptor principal y conexiones individuales.',
      narration:
        `Abrimos la clínica Demo Dental Las Palmas. En su ficha está la sección de conexión con ${CLINICA}. Este interruptor enlaza las dos plataformas. Cuando está activo, cada paciente, cada cita, cada presupuesto, los profesionales, las sucursales y el catálogo se copian automáticamente. Las conexiones individuales permiten decidir exactamente qué información se comparte, y cada sucursal puede conectarse por separado.`,
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
        await ctx.pause(3500);
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
      id: 'S22',
      section: 'Parte 4 · Plataforma de la clínica',
      title: 'La plataforma de la clínica',
      screen: 'Tarjeta de sección "fordentcloud · Plataforma de la clínica".',
      narration: `Hasta aquí, todo lo cargamos en ${HOLDING}. Ahora abrimos ${CLINICA} para comprobar qué pasó con esa información.`,
      run: (ctx) =>
        ctx.card('S22', {
          kicker: 'Parte 4',
          title: 'Plataforma de la clínica',
          subtitle: 'La misma información, ya sincronizada, más inventario, cotizaciones, cobranza y finanzas.',
        }),
    },
    {
      id: 'S23',
      section: 'Parte 4 · Plataforma de la clínica',
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
      section: 'Parte 4 · Plataforma de la clínica',
      title: 'La clínica reflejada',
      screen: 'Listado de clínicas de la plataforma; se abre "Demo Dental Las Palmas" con sus datos sincronizados.',
      narration:
        `En el listado de clínicas encontramos Demo Dental Las Palmas, la misma que configuramos en ${HOLDING}. Su ficha ya trae las sucursales, los profesionales, el catálogo de prestaciones, las previsiones, los convenios, los pacientes y sus citas. La sincronización es automática y funciona en ambos sentidos: lo que se corrige en una plataforma se refleja en la otra.`,
      run: async (ctx) => {
        await ctx.goto(`${ctx.dd}/clinicas`);
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
      section: 'Parte 4 · Plataforma de la clínica',
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

/** Escenas del portal del paciente. Requieren PORTAL_URL en el .env; si falta, se omiten. */
function portalScenes() {
  const url = (process.env.PORTAL_URL || '').trim();
  if (!url) return [];
  return [
    {
      id: 'S30',
      section: 'Parte 5 · Portal del paciente',
      title: 'El portal del paciente',
      screen: 'Tarjeta de sección "fordentcloud · Portal del paciente".',
      narration: 'Falta una pieza: el paciente. fordentcloud también le da su propio espacio, el portal del paciente, pensado para usarse desde el celular.',
      run: (ctx) =>
        ctx.card('S30', {
          kicker: 'Parte 5',
          title: 'Portal del paciente',
          subtitle: 'Reservar horas publicadas por los profesionales y revisar su información, desde cualquier dispositivo.',
        }),
    },
    {
      id: 'S31',
      section: 'Parte 5 · Portal del paciente',
      title: 'Reservar una hora desde el portal',
      screen: 'Portal del paciente: ingreso, horas disponibles publicadas por los profesionales y reserva.',
      narration:
        `En el portal, el paciente ingresa con sus datos y ve las horas que los profesionales publicaron desde su agenda diaria. Elige la que le acomoda y la reserva. Esa hora queda tomada de inmediato en la agenda de la clínica en ${HOLDING}, y la sincronización la lleva también a ${CLINICA}. Sin llamadas, sin esperas y sin riesgo de que dos personas tomen la misma hora.`,
      run: async (ctx) => {
        await ctx.goto(ctx.portal);
        await ctx.pause(6000);
        await ctx.scroll(300);
      },
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
