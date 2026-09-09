// Escenas del video de presentación de fordentcloud.
// Cada escena tiene: id, sección, título, "screen" (qué se ve, para el guion escrito),
// narration (texto literal de la voz) y run(ctx) con las acciones sobre la web real.
// ctx: { page, data, dc, dd, login(role), goto(url), tab(label), card(id, {...}), scroll(px), pause(ms), clickFirst(locator) }

export function buildScenes() {
  return [
    {
      id: 'S01',
      section: 'Apertura',
      title: 'Qué es fordentcloud',
      screen: 'Tarjeta de título con el nombre del producto y sus dos plataformas.',
      narration:
        'Bienvenidos a fordentcloud. Es una solución completa para clínicas dentales y estéticas, formada por dos plataformas que trabajan conectadas. DentalCloud es el sistema del holding: desde ahí se crean las clínicas, se configuran sus equipos y se lleva toda la atención de los pacientes, desde la agenda hasta la cartola. Dental-Demo es el sistema de la clínica: recibe automáticamente esa información y suma inventario, radiografías y finanzas. En los próximos minutos veremos el recorrido completo: crear una clínica, configurarla, atender a un paciente y comprobar cómo todo aparece sincronizado en la otra plataforma, sin volver a cargar nada.',
      run: (ctx) =>
        ctx.card('S01', {
          kicker: 'Presentación del sistema',
          title: 'fordentcloud',
          subtitle: 'Dos plataformas conectadas para administrar clínicas dentales y estéticas: DentalCloud para el holding y Dental-Demo para la clínica.',
        }),
    },
    {
      id: 'S02',
      section: 'Parte 1 · DentalCloud',
      title: 'El sistema del holding',
      screen: 'Tarjeta de sección "DentalCloud: el sistema del holding".',
      narration: 'Empezamos por DentalCloud, la plataforma del holding. Aquí entra el super administrador, la persona que administra todas las clínicas del grupo.',
      run: (ctx) =>
        ctx.card('S02', {
          kicker: 'Parte 1',
          title: 'DentalCloud: el sistema del holding',
          subtitle: 'Crear clínicas, activar su conexión con Dental-Demo y habilitar sus módulos.',
        }),
    },
    {
      id: 'S03',
      section: 'Parte 1 · DentalCloud',
      title: 'Inicio de sesión y listado de holdings',
      screen: 'Pantalla de inicio de sesión de DentalCloud; luego la página Holdings con la tabla de clínicas y el botón "Crear holding".',
      narration:
        'Al iniciar sesión como super administrador, lo primero que vemos es el listado de holdings, es decir, todas las clínicas registradas en la plataforma. Para cada una se muestra su tipo, dental, estética o mixta, su RUT, su estado, la cantidad de pacientes y el monto total de presupuestos. Con el botón Crear holding se agrega una clínica nueva: se indica el nombre, el RUT, el tipo, el país, y se crea de inmediato su primer administrador.',
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
      section: 'Parte 1 · DentalCloud',
      title: 'Ficha del holding y conexión con Dental-Demo',
      screen: 'Detalle del holding "Demo Dental Las Palmas": sección "Federación con Dental-Demo" con el interruptor de conexión y las conexiones individuales.',
      narration:
        'Abrimos la clínica Demo Dental Las Palmas. En su ficha aparece la sección Federación con Dental-Demo. Este interruptor conecta la clínica con la segunda plataforma. Cuando está activo, cada paciente, cada cita, cada presupuesto, los profesionales, las sucursales y el catálogo se copian automáticamente a Dental-Demo. Las conexiones individuales permiten decidir exactamente qué información se comparte.',
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
      section: 'Parte 1 · DentalCloud',
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
          subtitle: 'Sillones, sucursales, previsiones, convenios, prestaciones y profesionales con su horario.',
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
      title: 'Catálogo: prestaciones, convenios, previsiones y sucursales',
      screen: 'Página "Catálogo" recorriendo las pestañas Prestaciones, Convenios, Previsiones y Clínicas (sucursales).',
      narration:
        'En Catálogo está todo lo que la clínica ofrece. Las prestaciones, con su código, nombre, precio y la forma en que se marcan en el odontograma: por pieza, por cara, por cuadrante o por sesión. Los convenios, con su porcentaje de descuento. Las previsiones de salud, como Fonasa, isapres o particular. Y las sucursales físicas de la clínica, cada una con su dirección.',
      run: async (ctx) => {
        await ctx.goto(`${ctx.dc}/catalogo`);
        await ctx.page.getByRole('heading', { name: 'Catálogo' }).waitFor({ timeout: 60000 });
        await ctx.pause(7000);
        for (const tab of ['Convenios', 'Previsiones', 'Clínicas']) {
          await ctx.tab(tab);
          await ctx.pause(4500);
        }
      },
    },
    {
      id: 'S09',
      section: 'Parte 2 · Configurar la clínica',
      title: 'Profesionales y horarios',
      screen: 'Página "Profesionales" con el equipo de la clínica; se abre el modal "Horario" de un odontólogo con sus bloques por día y sillón.',
      narration:
        'En Profesionales se administra el equipo: odontólogos, radiólogos, operadores de recepción y administradores. Cada profesional tiene su correo de acceso, su RUT y su firma para los documentos. Con el botón Horario se define en qué días, en qué horas y en qué sillón atiende cada uno. Esa información alimenta la agenda.',
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
      after: async (ctx) => {
        if (ctx.openModal) {
          await ctx.page.locator('button[aria-label="Cerrar"]').last().click().catch(() => undefined);
          ctx.openModal = false;
        }
      },
    },
    {
      id: 'S10',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'El recorrido de un paciente',
      screen: 'Tarjeta de sección "El recorrido de un paciente".',
      narration: 'Con la clínica lista, seguimos el recorrido completo de un paciente, tal como ocurre en el día a día, con cada rol haciendo su parte.',
      run: (ctx) =>
        ctx.card('S10', {
          kicker: 'Parte 3',
          title: 'El recorrido de un paciente',
          subtitle: 'Desde el pago de consulta hasta los documentos clínicos, con recepción, odontólogo y administración.',
        }),
    },
    {
      id: 'S11',
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
      id: 'S12',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'Recepción: pacientes y ficha completa',
      screen: 'Página "Pacientes" con el buscador; se busca a la paciente por RUT y se abre su ficha en la pestaña "Datos paciente".',
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
      id: 'S13',
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
      id: 'S14',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'Las citas del paciente',
      screen: 'Pestaña "Horas" de la ficha con las citas pasadas y futuras, y el botón "Nueva cita".',
      narration:
        'En la pestaña Horas están las citas del paciente: pasadas y futuras, con su sillón, su profesional y su estado. Desde el botón Nueva cita, recepción agenda directamente desde la ficha, sin salir de ella.',
      run: async (ctx) => {
        await ctx.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await ctx.pause(800);
        await ctx.tab('Horas');
        await ctx.pause(1500);
        await ctx.scroll(250);
      },
    },
    {
      id: 'S15',
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
      id: 'S16',
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
      after: async (ctx) => {
        if (ctx.openModal) {
          await ctx.page.locator('button[aria-label="Cerrar"]').last().click().catch(() => undefined);
          ctx.openModal = false;
        }
      },
    },
    {
      id: 'S17',
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
      id: 'S18',
      section: 'Parte 3 · El recorrido de un paciente',
      title: 'Administración: cartola',
      screen: 'Inicio de sesión del administrador; pestaña "Cartola" de la paciente con abonos, saldo y presupuestos asociados.',
      narration:
        'Volvemos al administrador para ver la cartola, la cuenta corriente del paciente. Aquí se registran los abonos, con su forma de pago y número de documento, los intereses y los ajustes. Cada movimiento puede asociarse a un presupuesto, y el saldo se actualiza al instante. Si el paciente tiene deuda, la ficha lo avisa al abrirla.',
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
      id: 'S19',
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
      id: 'S20',
      section: 'Parte 4 · Dental-Demo',
      title: 'El sistema de la clínica',
      screen: 'Tarjeta de sección "Dental-Demo: el sistema de la clínica".',
      narration: 'Hasta aquí, todo lo cargamos en DentalCloud. Ahora abrimos la segunda plataforma, Dental-Demo, para comprobar qué pasó con esa información.',
      run: (ctx) =>
        ctx.card('S20', {
          kicker: 'Parte 4',
          title: 'Dental-Demo: el sistema de la clínica',
          subtitle: 'La misma información, ya sincronizada, más inventario, radiografías y finanzas.',
        }),
    },
    {
      id: 'S21',
      section: 'Parte 4 · Dental-Demo',
      title: 'Panel de plataforma',
      screen: 'Inicio de sesión en Dental-Demo; panel de plataforma con el resumen de clínicas y actividad.',
      narration:
        'Ingresamos a Dental-Demo con la cuenta de super administrador. El panel de plataforma muestra el resumen general: clínicas activas, suscripciones y actividad. Ninguna de estas clínicas se creó aquí: llegaron solas desde DentalCloud gracias a la conexión que activamos al inicio.',
      run: async (ctx) => {
        await ctx.login('demo');
        await ctx.goto(`${ctx.dd}/admin-plataforma/resumen`);
        await ctx.pause(4000);
        await ctx.scroll(300);
      },
    },
    {
      id: 'S22',
      section: 'Parte 4 · Dental-Demo',
      title: 'La clínica reflejada',
      screen: 'Listado de clínicas de Dental-Demo; se abre "Demo Dental Las Palmas" con sus datos sincronizados.',
      narration:
        'En el listado de clínicas encontramos Demo Dental Las Palmas, la misma que configuramos en DentalCloud. Su ficha ya trae las sucursales, los profesionales, el catálogo de prestaciones, las previsiones, los convenios, los pacientes y sus citas. La sincronización es automática y funciona en ambos sentidos: lo que se corrige en una plataforma se refleja en la otra.',
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
      id: 'S23',
      section: 'Parte 4 · Dental-Demo',
      title: 'Lo que agrega Dental-Demo',
      screen: 'Vista de Dental-Demo (inventario o panel) mientras se describen inventario, radiografías, mapa facial y finanzas.',
      narration:
        'Dental-Demo agrega lo que la clínica necesita en su operación diaria: el inventario de insumos con lotes, vencimientos y movimientos, que DentalCloud usa cuando una prestación exige registrar el producto aplicado; las órdenes de radiografías; el mapa facial para tratamientos estéticos; y la parte financiera con cotizaciones, cobros y liquidaciones.',
      run: async (ctx) => {
        await ctx.goto(`${ctx.dd}/operaciones/inventario`);
        await ctx.pause(4000);
        if (/sin-autorizacion|login/.test(ctx.page.url())) await ctx.goto(`${ctx.dd}/admin-plataforma/resumen`);
        await ctx.scroll(300);
      },
    },
    {
      id: 'S24',
      section: 'Cierre',
      title: 'Todo conectado, sin doble trabajo',
      screen: 'Tarjeta de cierre con el resumen de beneficios.',
      narration:
        'En resumen: con fordentcloud el holding crea y controla sus clínicas, cada clínica se configura en minutos, recepción y odontólogos trabajan sobre la misma ficha, y toda la información viaja sola a Dental-Demo, donde se completa con inventario, radiografías y finanzas. Una sola carga, dos plataformas siempre al día, y trazabilidad completa de cada paciente. Gracias por acompañarnos. Esto es fordentcloud.',
      run: (ctx) =>
        ctx.card('S24', {
          kicker: 'Cierre',
          title: 'Todo conectado, sin doble trabajo',
          bullets: [
            'Una sola carga de datos, dos plataformas siempre al día',
            'Roles claros: holding, administración, recepción y equipo clínico',
            'Trazabilidad completa: agenda, presupuesto, evolución, cartola y documentos',
          ],
        }),
    },
  ];
}
