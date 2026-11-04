// Utilidades compartidas por todas las páginas.

const LOGO_SVG = `<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
  <circle cx="35" cy="7" r="4.2" fill="currentColor" stroke="none"/>
  <path d="M7 33 21.5 12 31 25.5 37.5 17 55 33"/>
  <path d="M4 39.5c5-3 9.5-3 14 0s9 3 14 0 9.5-3 14 0 9 3 14 0"/>
  <path d="M12 45c4-2 7.5-2 11 0s7.5 2 11 0 7.5-2 11 0"/>
</svg>`;

function marcaHTML(sub = 'Restaurante') {
  return `<a class="marca" href="./">${LOGO_SVG}<span><b>Entre Montañas</b><small>${sub}</small></span></a>`;
}

const fmtQ = (n) => 'Q' + Number(n).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ───────── Supabase ─────────
// La llave publishable es pública por diseño: solo puede llamar a las funciones de
// supabase/funciones.sql, que validan todo. Las tablas no son accesibles con ella.
const SUPABASE = {
  url: 'https://zignlhbgpysgtrhhrwxv.supabase.co',
  llave: 'sb_publishable_1GR4-FDSdsw2AAb8pQ9kEQ_cSpjqxQF',
};

/** Llama a una función de Supabase. Los errores traen el código HTTP en `status`. */
async function rpc(funcion, args = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE.url}/rest/v1/rpc/${funcion}`, {
      method: 'POST',
      headers: { apikey: SUPABASE.llave, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch { throw Object.assign(new Error('Sin conexión. Revisa tu internet e intenta de nuevo.'), { status: 0 }); }
  const cuerpo = await res.json().catch(() => null);
  if (!res.ok) {
    // Los errores propios llevan el código HTTP en "hint"; los demás se muestran genéricos.
    const propio = /^\d{3}$/.test(cuerpo?.hint || '');
    throw Object.assign(new Error(propio ? cuerpo.message : 'Ocurrió un error. Intenta de nuevo.'),
      { status: propio ? Number(cuerpo.hint) : res.status });
  }
  if (cuerpo && typeof cuerpo === 'object' && cuerpo.error && cuerpo.status)
    throw Object.assign(new Error(cuerpo.error), { status: cuerpo.status });
  return cuerpo;
}

// Las páginas piden datos con rutas tipo "/api/…"; aquí cada ruta se traduce a su función.
// p = parámetros de la ruta, q = query string, d = datos enviados, t = token del personal.
const ids30 = (s) => String(s || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 2147483647).slice(0, 30);
const RUTAS_API = [
  ['GET', '/api/info', () => ['info']],
  ['GET', '/api/menu', () => ['menu']],
  ['GET', '/api/mesa/:c', (p) => ['mesa', { in_codigo: p.c }]],
  ['GET', '/api/mesa/:c/pedidos', (p, q) => ['pedidos_mesa', { in_codigo: p.c, in_ids: ids30(q.get('ids')) }]],
  ['POST', '/api/pedidos', (p, q, d) => ['crear_pedido', { in_datos: d }]],
  ['POST', '/api/llamadas', (p, q, d) => ['crear_llamada', { in_codigo: d.mesa, in_tipo: d.tipo }]],
  ['GET', '/api/reservas/horarios', (p, q) => ['horarios_mesa', { in_sucursal: q.get('sucursal'), in_fecha: q.get('fecha') }]],
  ['POST', '/api/reservas/mesa', (p, q, d) => ['crear_reserva_mesa', { in_datos: d }]],
  ['GET', '/api/cabana/ocupado', () => ['cabana_ocupado']],
  ['GET', '/api/cabana/cotizar', (p, q) => ['cotizar_cabana', { in_entrada: q.get('entrada'), in_salida: q.get('salida') }]],
  ['POST', '/api/reservas/cabana', (p, q, d) => ['crear_reserva_cabana', { in_datos: d }]],
  ['POST', '/api/personal/entrar', (p, q, d) => ['entrar', { in_pin: String(d.pin || '') }]],
  ['POST', '/api/personal/salir', (p, q, d, t) => ['salir', { in_token: t }]],
  ['GET', '/api/personal/pedidos', (p, q, d, t) => ['personal_pedidos', { in_token: t, in_sucursal: q.get('sucursal') }]],
  ['GET', '/api/personal/pedidos/:id', (p, q, d, t) => ['personal_pedido', { in_token: t, in_id: +p.id }]],
  ['PATCH', '/api/personal/pedidos/:id', (p, q, d, t) => ['personal_pedido_estado', { in_token: t, in_id: +p.id, in_estado: d.estado }]],
  ['POST', '/api/personal/mesas/:id/cobrar', (p, q, d, t) => ['personal_cobrar', { in_token: t, in_mesa: +p.id }]],
  ['GET', '/api/personal/llamadas', (p, q, d, t) => ['personal_llamadas', { in_token: t, in_sucursal: q.get('sucursal') }]],
  ['GET', '/api/personal/llamadas/:id', (p, q, d, t) => ['personal_llamada', { in_token: t, in_id: +p.id }]],
  ['PATCH', '/api/personal/llamadas/:id', (p, q, d, t) => ['personal_atender', { in_token: t, in_id: +p.id }]],
  ['GET', '/api/personal/resumen', (p, q, d, t) => ['personal_resumen', { in_token: t, in_sucursal: q.get('sucursal') }]],
  ['GET', '/api/personal/reservas', (p, q, d, t) => ['personal_reservas', {
    in_token: t, in_tipo: q.get('tipo'), in_desde: q.get('desde'), in_hasta: q.get('hasta'), in_estado: q.get('estado') }]],
  ['POST', '/api/personal/reservas', (p, q, d, t) => ['personal_reserva_crear', { in_token: t, in_datos: d }]],
  ['PATCH', '/api/personal/reservas/:id', (p, q, d, t) => ['personal_reserva_editar', { in_token: t, in_id: +p.id, in_datos: d || {} }]],
  ['GET', '/api/personal/mesas', (p, q, d, t) => ['personal_mesas', { in_token: t }]],
  ['POST', '/api/personal/mesas', (p, q, d, t) => ['personal_mesa_crear', { in_token: t, in_datos: d || {} }]],
  ['PATCH', '/api/personal/mesas/:id', (p, q, d, t) => ['personal_mesa_editar', { in_token: t, in_id: +p.id, in_datos: d || {} }]],
  ['GET', '/api/personal/menu', (p, q, d, t) => ['personal_menu', { in_token: t }]],
  ['PATCH', '/api/personal/menu/:id', (p, q, d, t) => ['personal_platillo', { in_token: t, in_id: p.id, in_datos: d || {} }]],
].map(([metodo, patron, armar]) => {
  const nombres = [];
  const re = new RegExp('^' + patron.replace(/:(\w+)/g, (_, n) => { nombres.push(n); return '([^/]+)'; }) + '$');
  return { metodo, re, nombres, armar };
});

async function api(url, { metodo = 'GET', datos, token } = {}) {
  const u = new URL(url, 'https://x');
  for (const r of RUTAS_API) {
    const m = r.metodo === metodo && u.pathname.match(r.re);
    if (!m) continue;
    const p = Object.fromEntries(r.nombres.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    const [funcion, args] = r.armar(p, u.searchParams, datos || {}, token || null);
    return rpc(funcion, args);
  }
  throw Object.assign(new Error('Ruta desconocida: ' + metodo + ' ' + u.pathname), { status: 404 });
}

/** Dirección base del sitio (funciona en GitHub Pages dentro de /<repo>/). */
const URL_SITIO = new URL('.', location.href).href;
const urlMesa = (codigo) => `${URL_SITIO}mesa.html?m=${encodeURIComponent(codigo)}`;

/** Código QR como imagen SVG (requiere la librería qrcode-generator). */
function qrImagen(texto) {
  const q = qrcode(0, 'M');
  q.addData(texto);
  q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 1} ${r + 1}h1v1h-1z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2} ${n + 2}" shape-rendering="crispEdges"><path fill="#2b3524" d="${d}"/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function aviso(msg, tipo = '') {
  let cont = document.querySelector('.avisos');
  if (!cont) { cont = document.createElement('div'); cont.className = 'avisos'; cont.setAttribute('role', 'status'); document.body.append(cont); }
  const el = document.createElement('div');
  el.className = 'aviso ' + tipo;
  el.textContent = msg;
  cont.append(el);
  setTimeout(() => el.remove(), tipo === 'error' ? 5000 : 3200);
}

// Hoja inferior / modal
function abrirHoja(hoja) {
  let velo = document.querySelector('.velo');
  if (!velo) {
    velo = document.createElement('div');
    velo.className = 'velo';
    velo.addEventListener('click', () => document.querySelectorAll('.hoja.abierta').forEach(cerrarHoja));
    document.body.append(velo);
  }
  velo.classList.add('abierto');
  hoja.classList.add('abierta');
  hoja.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => hoja.querySelector('[autofocus], button, input')?.focus({ preventScroll: true }), 50);
}
function cerrarHoja(hoja) {
  hoja.classList.remove('abierta');
  hoja.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.hoja.abierta')) {
    document.querySelector('.velo')?.classList.remove('abierto');
    document.body.style.overflow = '';
  }
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.hoja.abierta').forEach(cerrarHoja);
});

// Fechas (las fechas YYYY-MM-DD se tratan como días de calendario, sin zona horaria)
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaD = (s) => new Date(s + 'T12:00:00Z');
function fechaLarga(s) {
  const d = fechaD(s);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}
function fechaCorta(s) {
  const d = fechaD(s);
  return `${DIAS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MESES[d.getUTCMonth()].slice(0, 3)}`;
}
function hora12(hhmm) {
  if (!hhmm) return '';
  let [h, m] = hhmm.split(':').map(Number);
  const suf = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${suf}`;
}
function sumarDias(s, n) {
  const d = fechaD(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function hace(iso) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h ${min % 60} min` : `hace ${Math.floor(h / 24)} d`;
}

// Bloque con los datos de transferencia y botones para copiar
function pagoHTML(pago, monto, codigo) {
  const fila = (k, v, copiar) => `<div><dt>${k}</dt><dd>${esc(v)}${copiar ? ` <button type="button" class="copiar" data-copiar="${esc(copiar)}">Copiar</button>` : ''}</dd></div>`;
  return `<div class="pago">
    <h3>Datos para la transferencia</h3>
    <dl>
      ${fila('Banco', pago.banco)}
      ${fila(pago.tipo, pago.cuenta, pago.cuenta)}
      ${fila('A nombre de', pago.titular)}
      ${fila('Monto', fmtQ(monto))}
      ${fila('Referencia', codigo, codigo)}
    </dl></div>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copiar]');
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copiar); b.textContent = 'Copiado'; }
  catch { b.textContent = 'Mantén presionado para copiar'; }
  setTimeout(() => { b.textContent = 'Copiar'; }, 1800);
});

const linkWhatsApp =(numero, texto) => `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;

const ICONOS = {
  waze: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  wa: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>',
  reloj: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  cerrar: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  campana: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  cuenta: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2Z"/><path d="M9 8h6M9 12h6"/></svg>',
  bolsa: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l1 14H5L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
};
