// Panel del personal: pedidos en vivo, llamadas de mesa, reservas, cabaña, mesas/QR y menú.

const $ = (s, el = document) => el.querySelector(s);
const leer = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

let TOKEN = leer('em-token', null);
let SUC = leer('em-suc', null);
let SONIDO = leer('em-sonido', true);
let INFO;
let VISTA = 'pedidos';
let PEDIDOS = new Map();
let LLAMADAS = [];

const COLUMNAS = [
  { estado: 'nuevo', titulo: 'Nuevos' },
  { estado: 'preparando', titulo: 'En cocina' },
  { estado: 'listo', titulo: 'Listos para llevar' },
  { estado: 'entregado', titulo: 'Entregados · por cobrar' },
];
const SIGUIENTE = { nuevo: ['preparando', 'Aceptar'], preparando: ['listo', 'Marcar listo'], listo: ['entregado', 'Entregado'], entregado: ['pagado', 'Cobrado'] };
const ANTERIOR = { preparando: 'nuevo', listo: 'preparando', entregado: 'listo' };
const NOMBRE_ESTADO_R = { pendiente: 'Pendiente de pago', confirmada: 'Confirmada', cancelada: 'Cancelada', completada: 'Llegó', no_show: 'No llegó' };

const papi = async (url, opts = {}) => {
  try { return await api(url, { ...opts, token: TOKEN }); }
  catch (e) { if (e.status === 401) cerrarSesion(); throw e; }
};
const fallo = (e) => aviso(e.message, 'error');

// ═════════ acceso ═════════

$('#marca-acceso').innerHTML = marcaHTML('Personal');
let pin = '';
function pintarAcceso() {
  $('#puntos').innerHTML = Array.from({ length: Math.max(6, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'lleno' : ''}"></i>`).join('');
}
$('#teclado').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓']
  .map((k) => `<button type="button" data-k="${k}" aria-label="${k === '⌫' ? 'Borrar' : k === '✓' ? 'Entrar' : k}" ${k === '✓' ? 'style="background:var(--verde-800);color:var(--crema-50)"' : ''}>${k}</button>`).join('');
$('#teclado').addEventListener('click', (e) => { const k = e.target.closest('button')?.dataset.k; if (k) tecla(k); });
document.addEventListener('keydown', (e) => {
  if ($('#acceso').hidden) return;
  if (/^\d$/.test(e.key)) tecla(e.key);
  else if (e.key === 'Backspace') tecla('⌫');
  else if (e.key === 'Enter') tecla('✓');
});
async function tecla(k) {
  if (k === '⌫') pin = pin.slice(0, -1);
  else if (k === '✓') {
    if (!pin) return;
    try {
      const r = await api('/api/personal/entrar', { metodo: 'POST', datos: { pin } });
      TOKEN = r.token; guardar('em-token', TOKEN); pin = '';
      iniciarPanel();
    } catch (e) {
      pin = '';
      $('#acceso .tarjeta').classList.remove('temblor'); void $('#acceso .tarjeta').offsetWidth; $('#acceso .tarjeta').classList.add('temblor');
      aviso(e.message, 'error');
    }
  } else if (pin.length < 12) pin += k;
  pintarAcceso();
}

function cerrarSesion() {
  if (TOKEN) api('/api/personal/salir', { metodo: 'POST', token: TOKEN }).catch(() => {});
  TOKEN = null; guardar('em-token', null);
  canal?.unsubscribe();
  $('#panel').hidden = true; $('#acceso').hidden = false; pintarAcceso();
}
$('#salir').onclick = cerrarSesion;

// ═════════ panel ═════════

(async function inicio() {
  INFO = await api('/api/info');
  if (!INFO.sucursales.some((s) => s.id === SUC)) SUC = INFO.sucursales[0].id;
  if (TOKEN) iniciarPanel(); else { $('#acceso').hidden = false; pintarAcceso(); }
})().catch(fallo);

async function iniciarPanel() {
  $('#acceso').hidden = true; $('#panel').hidden = false;
  $('#marca').innerHTML = marcaHTML('Personal');
  $('#sucursales').innerHTML = INFO.sucursales.map((s) => `<button type="button" data-s="${s.id}" aria-pressed="${s.id === SUC}">${esc(s.nombre)}</button>`).join('');
  pintarSonido();
  conectar();
}

$('#sucursales').addEventListener('click', (e) => {
  const b = e.target.closest('[data-s]');
  if (!b) return;
  SUC = b.dataset.s; guardar('em-suc', SUC);
  document.querySelectorAll('#sucursales button').forEach((x) => x.setAttribute('aria-pressed', x === b));
  recargarTodo();
});

document.querySelector('.pestanas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  VISTA = b.dataset.v;
  document.querySelectorAll('.pestanas [data-v]').forEach((x) => x.setAttribute('aria-selected', x === b));
  document.querySelectorAll('.vista').forEach((v) => { v.hidden = v.id !== `v-${VISTA}`; });
  cargarVista();
});

async function recargarTodo() {
  await Promise.all([cargarPedidos(), cargarLlamadas(), cargarResumen(), contarPendientes()]).catch(fallo);
  cargarVista();
}
function cargarVista() {
  if (VISTA === 'reservas') cargarReservas('mesa');
  if (VISTA === 'cabana') cargarReservas('cabana');
  if (VISTA === 'mesas') cargarMesas();
  if (VISTA === 'menu') cargarMenuAdmin();
}

// ═════════ tiempo real ═════════

// Supabase manda un aviso pequeño (solo ids) por cada cambio; aquí se piden los datos completos.
let canal;
const sb = supabase.createClient(SUPABASE.url, SUPABASE.llave, { auth: { persistSession: false } });
const enCurso = new Set();
function conectar() {
  canal?.unsubscribe();
  const vivo = (ok) => { $('#en-vivo').classList.toggle('ok', ok); $('#en-vivo span').textContent = ok ? 'En vivo' : 'Reconectando…'; };
  canal = sb.channel('em-personal', { config: { private: false } })
    .on('broadcast', { event: 'pedido' }, async ({ payload: a }) => {
      if (a.sucursal !== SUC || enCurso.has(a.id)) return;
      enCurso.add(a.id);
      try {
        const p = await papi(`/api/personal/pedidos/${a.id}`);
        if (!p) return;
        const nuevo = !PEDIDOS.has(p.id);
        PEDIDOS.set(p.id, p);
        if (nuevo && p.estado === 'nuevo') { sonar(); aviso(`Nuevo pedido · ${p.mesa}`); }
        pintarTablero(); resumenDiferido();
      } catch { /* se recupera en la siguiente recarga */ } finally { enCurso.delete(a.id); }
    })
    .on('broadcast', { event: 'llamada' }, async ({ payload: a }) => {
      if (a.sucursal !== SUC) return;
      if (a.nuevo && a.estado === 'abierta') {
        const l = await papi(`/api/personal/llamadas/${a.id}`).catch(() => null);
        if (!l || LLAMADAS.some((x) => x.id === l.id)) return;
        LLAMADAS.push(l); sonar(); aviso(`${l.mesa} ${l.tipo === 'cuenta' ? 'pide la cuenta' : 'llama al mesero'}`);
        pintarLlamadas();
      } else cargarLlamadas().catch(() => {});
    })
    .on('broadcast', { event: 'reserva' }, ({ payload: r }) => {
      contarPendientes();
      if (r.nuevo && r.origen === 'web' && r.estado === 'pendiente') {
        sonar(); aviso(r.tipo === 'cabana' ? 'Nueva reserva de Casa Alpina' : 'Nueva reserva de mesa');
      }
      if (VISTA === 'reservas' || VISTA === 'cabana') cargarVista();
      if (r.tipo === 'mesa' && r.sucursal === SUC) resumenDiferido();
    })
    .on('broadcast', { event: 'menu' }, () => { if (VISTA === 'menu') cargarMenuAdmin(); })
    .subscribe((estado) => {
      vivo(estado === 'SUBSCRIBED');
      // al conectar (o reconectar) se recarga todo para no perder nada de lo que pasó mientras tanto
      if (estado === 'SUBSCRIBED') recargarTodo();
    });
}

// sonido
let audio;
function sonar() {
  if (!SONIDO) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    [[880, 0], [1175, 0.16]].forEach(([f, d]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.3, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.28);
      o.connect(g).connect(audio.destination); o.start(t + d); o.stop(t + d + 0.3);
    });
  } catch { /* sin audio */ }
}
function pintarSonido() {
  $('#sonido').innerHTML = SONIDO
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5ZM22 9l-6 6M16 9l6 6"/></svg>';
  $('#sonido').setAttribute('aria-pressed', SONIDO);
}
$('#sonido').onclick = () => { SONIDO = !SONIDO; guardar('em-sonido', SONIDO); pintarSonido(); if (SONIDO) sonar(); };

// ═════════ pedidos ═════════

async function cargarPedidos() {
  const lista = await papi(`/api/personal/pedidos?sucursal=${SUC}`);
  PEDIDOS = new Map(lista.map((p) => [p.id, p]));
  pintarTablero();
}

function ticketHTML(p) {
  const min = (Date.now() - Date.parse(p.actualizado)) / 60000;
  const tarde = (p.estado === 'nuevo' && min > 5) || (p.estado === 'preparando' && min > 25);
  const sig = SIGUIENTE[p.estado];
  return `<article class="ticket ${p.estado === 'nuevo' ? 'nuevo' : ''} ${tarde ? 'tarde' : ''}">
    <header><b>${esc(p.mesa)}</b><small>#${p.id} · ${hace(p.creado)}${p.cliente ? `<br>${esc(p.cliente)}` : ''}</small></header>
    <ul>${p.lineas.map((l) => `<li><span class="q">${l.cantidad}×</span><span class="n">${esc(l.nombre)}${l.variante ? ` · ${esc(l.variante)}` : ''}</span>
      ${l.detalle ? `<span class="d">${esc(l.detalle)}</span>` : ''}${l.nota ? `<span class="d" style="color:var(--miel-600);font-weight:600">“${esc(l.nota)}”</span>` : ''}</li>`).join('')}</ul>
    ${p.nota ? `<div class="nota">${esc(p.nota)}</div>` : ''}
    <div class="pie-t"><span>Total</span><b>${fmtQ(p.total)}</b></div>
    <div class="acciones">
      ${ANTERIOR[p.estado] ? `<button class="btn btn-sm btn-linea btn-icono" data-pedido="${p.id}" data-estado="${ANTERIOR[p.estado]}" title="Regresar" aria-label="Regresar al estado anterior">↩</button>` : ''}
      ${sig ? `<button class="btn btn-sm ${p.estado === 'nuevo' ? 'btn-miel' : ''}" data-pedido="${p.id}" data-estado="${sig[0]}">${sig[1]}</button>` : ''}
      ${p.estado === 'nuevo' ? `<button class="btn btn-sm btn-peligro btn-icono" data-pedido="${p.id}" data-estado="cancelado" title="Cancelar pedido" aria-label="Cancelar pedido">✕</button>` : ''}
    </div>
  </article>`;
}

function pintarTablero() {
  const todos = [...PEDIDOS.values()];
  $('#tablero').innerHTML = COLUMNAS.map((c) => {
    const lista = todos.filter((p) => p.estado === c.estado).sort((a, b) => a.id - b.id);
    return `<section class="columna" aria-label="${c.titulo}">
      <header><h3>${c.titulo}</h3><span class="estado e-${c.estado}">${lista.length}</span></header>
      ${lista.map(ticketHTML).join('') || '<p class="vacia">Sin pedidos</p>'}
    </section>`;
  }).join('');
  const cerrados = todos.filter((p) => ['pagado', 'cancelado'].includes(p.estado)).sort((a, b) => b.id - a.id);
  $('#cerrados').innerHTML = cerrados.length ? cerrados.map((p) => `
    <div class="tarjeta" style="padding:10px 14px;margin-bottom:6px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
      <span><b>#${p.id}</b> · ${esc(p.mesa)} · ${p.lineas.reduce((a, l) => a + l.cantidad, 0)} productos</span>
      <span style="display:flex;gap:10px;align-items:center"><span class="estado e-${p.estado}">${p.estado === 'pagado' ? 'Pagado' : 'Cancelado'}</span><b>${fmtQ(p.total)}</b></span>
    </div>`).join('') : '<p style="color:var(--tinta-suave)">Aún no hay pedidos cerrados hoy.</p>';
  burbuja('#b-pedidos', todos.filter((p) => p.estado === 'nuevo').length + LLAMADAS.length);
}
setInterval(() => { if (!$('#panel').hidden && VISTA === 'pedidos') { pintarTablero(); pintarLlamadas(); } }, 30000);

$('#v-pedidos').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-pedido]');
  if (b) {
    if (b.dataset.estado === 'cancelado' && !confirm('¿Cancelar este pedido?')) return;
    b.disabled = true;
    try {
      const p = await papi(`/api/personal/pedidos/${b.dataset.pedido}`, { metodo: 'PATCH', datos: { estado: b.dataset.estado } });
      PEDIDOS.set(p.id, p); pintarTablero(); resumenDiferido();
    } catch (err) { fallo(err); b.disabled = false; }
    return;
  }
  const at = e.target.closest('[data-atender]');
  if (at) {
    await papi(`/api/personal/llamadas/${at.dataset.atender}`, { metodo: 'PATCH' }).catch(fallo);
    LLAMADAS = LLAMADAS.filter((l) => l.id !== Number(at.dataset.atender)); pintarLlamadas();
  }
  const co = e.target.closest('[data-cobrar]');
  if (co) {
    if (!confirm(`¿Marcar como pagados todos los pedidos abiertos de ${co.dataset.nombre}?`)) return;
    try {
      const r = await papi(`/api/personal/mesas/${co.dataset.cobrar}/cobrar`, { metodo: 'POST' });
      aviso(`${co.dataset.nombre}: ${r.cobrados} pedido(s) cobrados`);
      await Promise.all([cargarPedidos(), cargarLlamadas()]); resumenDiferido();
    } catch (err) { fallo(err); }
  }
});

// ═════════ llamadas ═════════

async function cargarLlamadas() {
  LLAMADAS = await papi(`/api/personal/llamadas?sucursal=${SUC}`);
  pintarLlamadas();
}
function pintarLlamadas() {
  $('#llamadas').innerHTML = LLAMADAS.map((l) => `
    <div class="llamada" role="alert">
      <span class="ic">${l.tipo === 'cuenta' ? ICONOS.cuenta : ICONOS.campana}</span>
      <span class="txt"><b>${esc(l.mesa)} ${l.tipo === 'cuenta' ? 'pide la cuenta' : 'llama al mesero'}</b>
        <small>${hace(l.creado)}${l.cuenta ? ` · Cuenta abierta ${fmtQ(l.cuenta)}` : ''}</small></span>
      ${l.tipo === 'cuenta' && l.cuenta ? `<button class="btn btn-sm" data-cobrar="${l.mesa_id}" data-nombre="${esc(l.mesa)}">Cobrar mesa · ${fmtQ(l.cuenta)}</button>` : ''}
      <button class="btn btn-sm btn-linea" data-atender="${l.id}">Atendida</button>
    </div>`).join('');
  burbuja('#b-pedidos', [...PEDIDOS.values()].filter((p) => p.estado === 'nuevo').length + LLAMADAS.length);
}

// ═════════ métricas ═════════

let tResumen;
const resumenDiferido = () => { clearTimeout(tResumen); tResumen = setTimeout(() => cargarResumen().catch(() => {}), 600); };
async function cargarResumen() {
  const r = await papi(`/api/personal/resumen?sucursal=${SUC}`);
  const m = (k, v, extra = '') => `<div class="metrica tarjeta"><small>${k}</small><b>${v}</b>${extra}</div>`;
  $('#metricas').innerHTML =
    m('Pedidos de hoy', r.pedidos) +
    m('Ventas de hoy', fmtQ(r.ventas), `<small>${fmtQ(r.cobrado)} cobrado</small>`) +
    m('Mesas con cuenta abierta', r.mesasAbiertas) +
    m('Reservas para hoy', r.reservasHoy) +
    (r.top.length ? `<div class="metrica tarjeta"><small>Lo más pedido hoy</small><div style="font-size:.88rem;margin-top:6px">${r.top.slice(0, 3).map((t) => `${esc(t.nombre)} <strong>×${t.n}</strong>`).join('<br>')}</div></div>` : '');
}

function burbuja(sel, n) { const b = $(sel); b.hidden = !n; b.textContent = n; }

// ═════════ reservas ═════════

async function contarPendientes() {
  const lista = await papi(`/api/personal/reservas?estado=pendiente&desde=${hoyGT()}`).catch(() => []);
  burbuja('#b-reservas', lista.filter((r) => r.tipo === 'mesa' && r.sucursal === SUC).length);
  burbuja('#b-cabana', lista.filter((r) => r.tipo === 'cabana').length);
}

const hoyGT = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);

async function cargarReservas(tipo) {
  const hoy = hoyGT();
  const rango = tipo === 'mesa' ? $('#r-rango').value : $('#c-rango').value;
  const q = new URLSearchParams({ tipo });
  if (rango === 'hoy') { q.set('desde', hoy); q.set('hasta', hoy); }
  else if (rango === 'pend') { q.set('estado', 'pendiente'); q.set('desde', hoy); }
  else if (rango !== 'todo') { q.set('desde', hoy); q.set('hasta', sumarDias(hoy, Number(rango))); }
  const cont = tipo === 'mesa' ? $('#lista-reservas') : $('#lista-cabana');
  try {
    let lista = await papi(`/api/personal/reservas?${q}`);
    if (tipo === 'mesa') lista = lista.filter((r) => r.sucursal === SUC);
    if (!lista.length) { cont.innerHTML = '<div class="tarjeta" style="padding:28px;text-align:center;color:var(--tinta-suave)">No hay reservas en este periodo.</div>'; return; }
    const porDia = new Map();
    for (const r of lista) { if (!porDia.has(r.fecha)) porDia.set(r.fecha, []); porDia.get(r.fecha).push(r); }
    cont.innerHTML = [...porDia].map(([f, rs]) => `
      <div class="dia-res"><h3>${f === hoy ? 'Hoy · ' : ''}${fechaLarga(f)} <span style="font-family:var(--f-texto);font-size:.85rem;color:var(--tinta-suave);font-weight:500">· ${rs.filter((r) => ['pendiente', 'confirmada'].includes(r.estado)).reduce((a, r) => a + r.personas, 0)} personas</span></h3>
      ${rs.map(reservaHTML).join('')}</div>`).join('');
  } catch (e) { fallo(e); }
}

function telWA(t) { const d = t.replace(/\D/g, ''); return d.length === 8 ? '502' + d : d; }

function reservaHTML(r) {
  const acciones = {
    pendiente: [['confirmada', 'Pago recibido', 'btn-miel'], ['cancelada', 'Cancelar', 'btn-peligro']],
    confirmada: [['completada', 'Llegó', ''], ['no_show', 'No llegó', 'btn-linea'], ['cancelada', 'Cancelar', 'btn-peligro']],
    cancelada: [['pendiente', 'Reactivar', 'btn-linea']],
    no_show: [['confirmada', 'Sí llegó', 'btn-linea']],
    completada: [],
  }[r.estado];
  const noches = r.fecha_salida ? Math.round((Date.parse(r.fecha_salida) - Date.parse(r.fecha)) / 86400000) : 0;
  const msgConf = r.tipo === 'cabana'
    ? `Hola ${r.nombre.split(' ')[0]}, tu reserva ${r.codigo} de Casa Alpina está confirmada: entrada ${fechaLarga(r.fecha)} a las 2:00 pm, salida ${fechaLarga(r.fecha_salida)} a las 12:00 pm. ¡Te esperamos!`
    : `Hola ${r.nombre.split(' ')[0]}, tu reserva ${r.codigo} en Entre Montañas está confirmada para el ${fechaLarga(r.fecha)} a las ${hora12(r.hora)}, ${r.personas} personas. ¡Te esperamos!`;
  return `<article class="reserva tarjeta">
    <span class="hora-r">${r.tipo === 'cabana' ? `${noches} ${noches === 1 ? 'noche' : 'noches'}` : hora12(r.hora)}</span>
    <span class="quien"><b>${esc(r.nombre)} · ${r.personas} ${r.personas === 1 ? 'persona' : 'personas'}</b>
      <small>${r.codigo} · <a href="https://wa.me/${telWA(r.telefono)}?text=${encodeURIComponent(r.estado === 'confirmada' ? msgConf : `Hola ${r.nombre.split(' ')[0]}, te escribimos de Entre Montañas por tu reserva ${r.codigo}.`)}" target="_blank" rel="noopener">${esc(r.telefono)}</a>
      ${r.tipo === 'cabana' ? ` · ${fechaCorta(r.fecha)} → ${fechaCorta(r.fecha_salida)}` : ''}
      · ${r.tipo === 'cabana' ? 'Total' : 'Depósito'} ${fmtQ(r.a_pagar)}${r.origen === 'personal' ? ' · registrada por personal' : ''}${r.estado === 'pendiente' ? ` · solicitada ${hace(r.creado)}` : ''}</small></span>
    <span class="der"><span class="estado e-${r.estado}">${NOMBRE_ESTADO_R[r.estado]}</span>
      <span class="acciones">${acciones.map(([e, t, c]) => `<button class="btn btn-sm ${c}" data-reserva="${r.id}" data-estado="${e}">${t}</button>`).join('')}</span></span>
    ${r.nota || r.nota_interna ? `<p class="extra">${r.nota ? `“${esc(r.nota)}”` : ''} ${r.nota_interna ? `<br><b>Nota interna:</b> ${esc(r.nota_interna)}` : ''}</p>` : ''}
  </article>`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-reserva]');
  if (!b) return;
  if (b.dataset.estado === 'cancelada' && !confirm('¿Cancelar esta reserva? Las fechas u horario quedarán libres.')) return;
  b.disabled = true;
  try {
    await papi(`/api/personal/reservas/${b.dataset.reserva}`, { metodo: 'PATCH', datos: { estado: b.dataset.estado } });
    cargarVista(); contarPendientes();
  } catch (err) { fallo(err); b.disabled = false; }
});
$('#r-rango').onchange = () => cargarReservas('mesa');
$('#c-rango').onchange = () => cargarReservas('cabana');
$('#r-nueva').onclick = () => nuevaReserva('mesa');
$('#c-nueva').onclick = () => nuevaReserva('cabana');

function nuevaReserva(tipo) {
  const hoja = $('#hoja');
  const hoy = hoyGT();
  hoja.innerHTML = `<form class="contenido" id="f-res">
    <h2>${tipo === 'cabana' ? 'Nueva reserva · Casa Alpina' : 'Nueva reserva de mesa'}</h2>
    ${tipo === 'mesa' ? `
      <div class="rejilla-2">
        <label class="campo"><span>Sucursal</span><select class="input" name="sucursal">${INFO.sucursales.map((s) => `<option value="${s.id}" ${s.id === SUC ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}</select></label>
        <label class="campo"><span>Personas</span><input class="input" name="personas" type="number" min="1" max="${INFO.reservaMesa.maxPersonas}" value="2" required></label>
        <label class="campo"><span>Fecha</span><input class="input" name="fecha" type="date" min="${hoy}" value="${hoy}" required></label>
        <label class="campo"><span>Hora</span><select class="input" name="hora" required></select></label>
      </div>` : `
      <div class="rejilla-2">
        <label class="campo"><span>Entrada</span><input class="input" name="entrada" type="date" min="${hoy}" value="${hoy}" required></label>
        <label class="campo"><span>Salida</span><input class="input" name="salida" type="date" min="${sumarDias(hoy, 1)}" value="${sumarDias(hoy, 1)}" required></label>
        <label class="campo"><span>Huéspedes</span><input class="input" name="personas" type="number" min="1" max="${INFO.cabana.capacidadMax}" value="2" required></label>
        <label class="campo"><span>Total</span><output class="input" id="f-total" style="display:flex;align-items:center">—</output></label>
      </div>`}
    <div class="rejilla-2">
      <label class="campo"><span>Nombre</span><input class="input" name="nombre" required maxlength="80"></label>
      <label class="campo"><span>Teléfono</span><input class="input" name="telefono" type="tel" required maxlength="20"></label>
    </div>
    <label class="campo"><span>Nota</span><input class="input" name="nota" maxlength="400"></label>
    <label style="display:flex;gap:.6rem;align-items:center"><input type="checkbox" name="pagado" style="width:20px;height:20px;accent-color:var(--verde-800)"> ${tipo === 'cabana' ? 'El pago ya fue recibido' : 'El depósito ya fue recibido'}</label>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
      <button type="button" class="btn btn-linea" data-cerrar>Cancelar</button>
      <button class="btn" type="submit">Guardar reserva</button>
    </div>
  </form>`;
  const f = $('#f-res', hoja);
  const horas = async () => {
    const sel = f.hora;
    try {
      const r = await papi(`/api/reservas/horarios?sucursal=${f.sucursal.value}&fecha=${f.fecha.value}`);
      sel.innerHTML = r.horas.length ? r.horas.map((h) => `<option value="${h}">${hora12(h)}</option>`).join('') : `<option value="">${esc(r.motivo || 'Sin horarios')}</option>`;
    } catch (e) { sel.innerHTML = `<option value="">${esc(e.message)}</option>`; }
  };
  const cotizar = async () => {
    try {
      const q = await papi(`/api/cabana/cotizar?entrada=${f.entrada.value}&salida=${f.salida.value}`);
      $('#f-total', hoja).textContent = q.disponible ? `${fmtQ(q.total)} · ${q.noches} noche(s)` : 'Fechas ocupadas';
    } catch (e) { $('#f-total', hoja).textContent = e.message; }
  };
  if (tipo === 'mesa') { f.sucursal.onchange = horas; f.fecha.onchange = horas; horas(); }
  else { f.entrada.onchange = () => { if (f.salida.value <= f.entrada.value) f.salida.value = sumarDias(f.entrada.value, 1); cotizar(); }; f.salida.onchange = cotizar; cotizar(); }
  hoja.onclick = (e) => { if (e.target.closest('[data-cerrar]')) cerrarHoja(hoja); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    d.tipo = tipo; d.personas = Number(d.personas); d.estado = d.pagado ? 'confirmada' : 'pendiente';
    try {
      await papi('/api/personal/reservas', { metodo: 'POST', datos: d });
      aviso('Reserva guardada'); cerrarHoja(hoja); cargarVista(); contarPendientes();
    } catch (err) { fallo(err); }
  };
  abrirHoja(hoja);
}

// ═════════ mesas ═════════

async function cargarMesas() {
  try {
    const mesas = (await papi('/api/personal/mesas')).filter((m) => m.sucursal === SUC);
    $('#mesas').innerHTML = mesas.map((m) => {
      const url = urlMesa(m.codigo);
      return `<article class="mesa-c tarjeta ${m.activa ? '' : 'inactiva'}">
        <img src="${qrImagen(url)}" alt="Código QR de ${esc(m.nombre || 'Mesa ' + m.numero)}" loading="lazy">
        <b>${esc(m.nombre || 'Mesa ' + m.numero)}</b>
        <code>${esc(url)}</code>
        ${m.activa ? '' : '<span class="estado e-cancelado">Desactivada</span>'}
        <div class="acciones">
          <button class="btn btn-sm btn-linea" data-copiar="${esc(url)}">Copiar</button>
          <a class="btn btn-sm btn-linea" href="${esc(url)}" target="_blank" rel="noopener">Abrir</a>
          <button class="btn btn-sm btn-linea" data-mesa="${m.id}" data-acc="nombre" data-actual="${esc(m.nombre || '')}">Renombrar</button>
          <button class="btn btn-sm btn-linea" data-mesa="${m.id}" data-acc="activa" data-val="${m.activa ? 0 : 1}">${m.activa ? 'Desactivar' : 'Activar'}</button>
          <button class="btn btn-sm btn-peligro" data-mesa="${m.id}" data-acc="codigo">Nuevo código</button>
        </div>
      </article>`;
    }).join('') || '<p>No hay mesas.</p>';
  } catch (e) { fallo(e); }
}
$('#mesas').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-mesa]');
  if (!b) return;
  let datos;
  if (b.dataset.acc === 'nombre') {
    const n = prompt('Nombre de la mesa (vacío = "Mesa N"). Ej: Terraza 1', b.dataset.actual);
    if (n === null) return;
    datos = { nombre: n };
  } else if (b.dataset.acc === 'activa') datos = { activa: b.dataset.val === '1' };
  else {
    if (!confirm('Se generará un código nuevo. El QR y la etiqueta NFC actuales de esta mesa dejarán de funcionar. ¿Continuar?')) return;
    datos = { nuevoCodigo: true };
  }
  try { await papi(`/api/personal/mesas/${b.dataset.mesa}`, { metodo: 'PATCH', datos }); cargarMesas(); } catch (err) { fallo(err); }
});
$('#m-nueva').onclick = async () => {
  try { const m = await papi('/api/personal/mesas', { metodo: 'POST', datos: { sucursal: SUC } }); aviso(`Mesa ${m.numero} agregada`); cargarMesas(); } catch (e) { fallo(e); }
};
$('#m-imprimir').onclick = () => window.open(`qr.html?sucursal=${SUC}`, '_blank');

// ═════════ menú ═════════

async function cargarMenuAdmin() {
  try {
    const cats = await papi('/api/personal/menu');
    $('#menu-admin').innerHTML = cats.map((c) => `<section class="tarjeta"><h3>${esc(c.nombre)}</h3>
      ${c.platillos.map((p) => `<div class="pl">
        <span><b>${esc(p.nombre)}</b>${p.variantes ? `<small>${esc(p.variantes.map((v) => `${v.label} ${fmtQ(v.price)}`).join(' · '))}</small>` : ''}</span>
        ${p.variantes ? '<small style="text-align:right">precio por opción</small>'
          : `<label><span class="sr">Precio de ${esc(p.nombre)}</span><input class="input" type="number" min="0" step="1" value="${p.precio}" data-precio="${p.id}" inputmode="numeric"></label>`}
        <label class="interruptor" title="${p.disponible ? 'Disponible' : 'Agotado'}"><input type="checkbox" data-disp="${p.id}" ${p.disponible ? 'checked' : ''} aria-label="${esc(p.nombre)} disponible"><span></span></label>
      </div>`).join('')}</section>`).join('');
  } catch (e) { fallo(e); }
}
$('#menu-admin').addEventListener('change', async (e) => {
  const t = e.target;
  try {
    if (t.dataset.disp) {
      const p = await papi(`/api/personal/menu/${t.dataset.disp}`, { metodo: 'PATCH', datos: { disponible: t.checked } });
      aviso(`${p.nombre}: ${p.disponible ? 'disponible' : 'agotado'}`);
    }
    if (t.dataset.precio) {
      const p = await papi(`/api/personal/menu/${t.dataset.precio}`, { metodo: 'PATCH', datos: { precio: Number(t.value) } });
      aviso(`${p.nombre}: ahora ${fmtQ(p.precio)}`);
    }
  } catch (err) { fallo(err); cargarMenuAdmin(); }
});
