// Menú y pedidos desde la mesa.
// mesa.html?m=<codigo>  → modo pedido (el QR/NFC de cada mesa apunta aquí)
// mesa.html             → solo consulta

const codigoMesa = new URLSearchParams(location.search).get('m') || null;
const modoPedido = !!codigoMesa;

const $ = (s, el = document) => el.querySelector(s);
const leer = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* modo privado */ } };

const K_CARRITO = `em-carrito-${codigoMesa}`;
const K_PEDIDOS = `em-pedidos-${codigoMesa}`;
const DOCE_HORAS = 12 * 3600e3;

let MESA = null;
let MENU = [];
let PLATILLOS = new Map();
let CATS = new Map();
let DESAYUNO = { abierto: true, desde: '07:30', hasta: '12:00' };

let carrito = modoPedido ? leer(K_CARRITO, []) : [];
let misPedidos = modoPedido ? leer(K_PEDIDOS, []).filter((p) => Date.now() - p.t < DOCE_HORAS) : [];
let estadoPedidos = new Map(); // id -> estado (para avisar cambios)

const ESTADOS = {
  nuevo: 'Recibido', preparando: 'En cocina', listo: 'Listo', entregado: 'Entregado', pagado: 'Pagado', cancelado: 'Cancelado',
};
const PASOS = ['nuevo', 'preparando', 'listo', 'entregado'];

// ───────── inicio ─────────

document.getElementById('marca').innerHTML = marcaHTML(modoPedido ? 'Menú de la mesa' : 'Menú');

(async function iniciar() {
  try {
    if (modoPedido) MESA = await api(`/api/mesa/${encodeURIComponent(codigoMesa)}`);
    await cargarMenu();
  } catch (e) {
    return mostrarError(e);
  }
  pintarCabecera();
  pintarMenu();
  pintarFlotante();
  if (modoPedido && misPedidos.length) consultarPedidos();
  setInterval(() => cargarMenu().then(pintarMenu).catch(() => {}), 120000);
  if (location.hash) setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView(), 100);
})();

async function cargarMenu() {
  const r = await api('/api/menu');
  MENU = r.categorias;
  DESAYUNO = { abierto: r.desayunoAbierto, ...r.desayunos };
  PLATILLOS = new Map(MENU.flatMap((c) => c.platillos).map((p) => [p.id, p]));
  CATS = new Map(MENU.map((c) => [c.id, c]));
}

function mostrarError(e) {
  document.querySelector('.tabs').remove();
  $('#menu').innerHTML = `<div class="error-mesa">
    <h1>${e.status === 404 ? 'No encontramos esta mesa' : 'No pudimos cargar el menú'}</h1>
    <p style="color:var(--tinta-suave);max-width:40ch">${esc(e.message)}</p>
    <div style="display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center">
      <button class="btn" onclick="location.reload()">Intentar de nuevo</button>
      <a class="btn btn-linea" href="mesa.html">Ver el menú</a>
    </div></div>`;
}

// ───────── cabecera ─────────

function pintarCabecera() {
  if (modoPedido) {
    document.title = `${MESA.nombre} · Entre Montañas`;
    $('#pill-mesa').innerHTML = `<span class="pill-mesa"><i></i>${esc(MESA.nombre)}</span>`;
    $('#bienvenida').innerHTML = `
      <h1>¡Bienvenidos a Entre Montañas!</h1>
      <p>${esc(MESA.nombre)} · Sucursal ${esc(MESA.sucursalNombre)}. Elige tus platillos y envíalos directo a cocina.</p>
      <div class="botones-mesa">
        <button class="btn btn-sm" id="b-mesero" type="button">${ICONOS.campana} Llamar mesero</button>
        <button class="btn btn-sm" id="b-cuenta" type="button">${ICONOS.cuenta} Pedir la cuenta</button>
        <button class="btn btn-sm" id="b-pedidos" type="button" hidden>${ICONOS.bolsa} <span>Mis pedidos</span></button>
      </div>`;
    $('#b-mesero').onclick = () => llamar('mesero');
    $('#b-cuenta').onclick = abrirCuenta;
    $('#b-pedidos').onclick = abrirPedidos;
    pintarBotonPedidos();
  } else {
    $('#bienvenida').innerHTML = `
      <h1>Nuestro menú</h1>
      <p>Para pedir desde tu mesa, escanea el código QR o acerca tu teléfono a la etiqueta NFC.</p>
      <div class="botones-mesa"><a class="btn btn-sm" href="reservar.html">Reservar mesa</a><a class="btn btn-sm" href="./">Inicio</a></div>`;
  }
}

function pintarBotonPedidos() {
  const b = $('#b-pedidos');
  if (!b) return;
  const activos = misPedidos.filter((p) => !['pagado', 'cancelado'].includes(estadoPedidos.get(p.id))).length;
  b.hidden = misPedidos.length === 0;
  b.classList.toggle('con-pedidos', activos > 0);
  b.querySelector('span').textContent = activos ? `Mis pedidos (${activos})` : 'Mis pedidos';
}

// ───────── menú ─────────

const precioDesde = (p) => (p.variantes ? Math.min(...p.variantes.map((v) => v.price)) : p.precio);
const bloqueadoPorHorario = (p) => CATS.get(p.categoria)?.servicio === 'desayuno' && !DESAYUNO.abierto;
const enCarrito = (id) => carrito.filter((l) => l.platillo === id).reduce((a, l) => a + l.cantidad, 0);

function pintarMenu() {
  const visibles = MENU.filter((c) => c.platillos.length);
  $('#tabs').innerHTML = visibles.map((c) => `<a href="#${c.id}" data-cat="${c.id}">${esc(c.nombre)}</a>`).join('');

  const avisoVista = modoPedido ? '' : `<div class="aviso-vista">Estás viendo el menú. Para hacer un pedido, escanea el QR de tu mesa.</div>`;
  $('#menu').innerHTML = avisoVista + visibles.map((c) => {
    const cerradoDes = c.servicio === 'desayuno' && !DESAYUNO.abierto;
    return `<section class="categoria" id="${c.id}" aria-labelledby="h-${c.id}">
      <h2 id="h-${c.id}">${esc(c.nombre)}</h2>
      ${c.nota ? `<p>${esc(c.nota)}</p>` : ''}
      ${cerradoDes ? `<div class="aviso-desayuno">${ICONOS.reloj} Los desayunos se sirven de ${hora12(DESAYUNO.desde)} a ${hora12(DESAYUNO.hasta)}.</div>` : ''}
      <div class="lista">${c.platillos.map(itemHTML).join('')}</div>
    </section>`;
  }).join('');

  observarTabs();
}

function itemHTML(p) {
  const deshabilitado = !p.disponible || (modoPedido && bloqueadoPorHorario(p));
  const n = enCarrito(p.id);
  return `<button type="button" class="item" data-id="${p.id}" aria-disabled="${deshabilitado}">
    <span class="txt">
      <h3>${esc(p.nombre)}${n ? `<span class="cant-en-carrito" aria-label="${n} en tu pedido">${n}</span>` : ''}</h3>
      ${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : p.variantes ? `<p>${esc(p.variantes.map((v) => v.label).join(' · '))}</p>` : ''}
      <span class="abajo">
        ${!p.disponible ? '<span class="agotado">Agotado</span>' : `<span class="precio">${p.variantes ? '<small>desde </small>' : ''}${fmtQ(precioDesde(p))}</span>`}
        ${modoPedido && !deshabilitado ? '<span class="mas" aria-hidden="true">+</span>' : ''}
      </span>
    </span>
    ${p.imagen ? `<img class="foto" src="${p.imagen}" alt="" loading="lazy">` : ''}
  </button>`;
}

$('#menu').addEventListener('click', (e) => {
  const b = e.target.closest('.item');
  if (!b) return;
  const p = PLATILLOS.get(b.dataset.id);
  if (!p.disponible) return aviso(`${p.nombre} está agotado por ahora.`);
  abrirPlatillo(p);
});

let observador;
function observarTabs() {
  observador?.disconnect();
  const tabs = new Map([...document.querySelectorAll('#tabs a')].map((a) => [a.dataset.cat, a]));
  observador = new IntersectionObserver((entradas) => {
    for (const en of entradas) {
      if (!en.isIntersecting) continue;
      tabs.forEach((a) => a.classList.remove('activa'));
      const a = tabs.get(en.target.id);
      a?.classList.add('activa');
      a?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }, { rootMargin: '-80px 0px -70% 0px' });
  document.querySelectorAll('.categoria').forEach((s) => observador.observe(s));
}

// ───────── hoja de platillo ─────────

function abrirPlatillo(p) {
  const hoja = $('#hoja-platillo');
  const puedePedir = modoPedido && !bloqueadoPorHorario(p);
  const sel = {
    variante: p.variantes ? p.variantes[0].label : null,
    elegir: Object.fromEntries((p.elegir?.options || []).map((o) => [o, 0])),
    extras: new Set(),
    cantidad: 1,
  };

  hoja.innerHTML = `
    <button class="cerrar" type="button" aria-label="Cerrar">${ICONOS.cerrar}</button>
    ${p.imagen ? `<img class="cab-img" src="${p.imagen}" alt="${esc(p.nombre)}">` : '<div style="height:44px"></div>'}
    <div class="cuerpo">
      <header><h2 id="hp-titulo">${esc(p.nombre)}</h2>${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ''}
        ${CATS.get(p.categoria)?.nota ? `<p style="font-size:.88rem">${esc(CATS.get(p.categoria).nota)}</p>` : ''}</header>

      ${p.variantes ? `<div class="grupo"><h4>Elige una opción <small class="ok">Requerido</small></h4><div class="opciones">
        ${p.variantes.map((v, i) => `<label class="opcion"><span class="izq"><input type="radio" name="variante" value="${esc(v.label)}" ${i === 0 ? 'checked' : ''} ${puedePedir ? '' : 'disabled'}>${esc(v.label)}</span><span class="px">${fmtQ(v.price)}</span></label>`).join('')}
      </div></div>` : ''}

      ${p.elegir ? `<div class="grupo"><h4>${esc(p.elegir.label)} <small id="cuenta-elegir">0 de ${p.elegir.count}</small></h4><div class="opciones">
        ${p.elegir.options.map((o) => `<div class="opcion"><span>${esc(o)}</span>
          <span class="contador" data-op="${esc(o)}">
            <button type="button" data-d="-1" aria-label="Quitar ${esc(o)}" disabled>−</button><output>0</output>
            <button type="button" data-d="1" aria-label="Agregar ${esc(o)}" ${puedePedir ? '' : 'disabled'}>+</button>
          </span></div>`).join('')}
      </div></div>` : ''}

      ${p.extras ? `<div class="grupo"><h4>Extras <small>Opcional</small></h4><div class="opciones">
        ${p.extras.map((x) => `<label class="opcion"><span class="izq"><input type="checkbox" name="extra" value="${esc(x.label)}" ${puedePedir ? '' : 'disabled'}>${esc(x.label)}</span><span class="px">+${fmtQ(x.price)}</span></label>`).join('')}
      </div></div>` : ''}

      ${puedePedir ? `<label class="campo"><span>Instrucciones especiales</span>
        <textarea class="input" id="hp-nota" maxlength="140" placeholder="Ej. sin cebolla, término medio…"></textarea></label>` : ''}
    </div>
    <div class="pie-hoja">
      ${puedePedir ? `
        <span class="contador" id="hp-cant"><button type="button" data-d="-1" aria-label="Menos" disabled>−</button><output>1</output><button type="button" data-d="1" aria-label="Más">+</button></span>
        <button class="btn" type="button" id="hp-agregar"><span>Agregar</span><span id="hp-total"></span></button>`
      : `<p style="color:var(--tinta-suave);font-size:.92rem;flex:1">${modoPedido
          ? `Disponible de ${hora12(DESAYUNO.desde)} a ${hora12(DESAYUNO.hasta)}.`
          : 'Para pedir, escanea el código QR de tu mesa.'}</p>
         <button class="btn btn-linea" type="button" data-cerrar>Cerrar</button>`}
    </div>`;

  const sumaElegir = () => Object.values(sel.elegir).reduce((a, b) => a + b, 0);
  const unitario = () => {
    const base = p.variantes ? p.variantes.find((v) => v.label === sel.variante).price : p.precio;
    return base + [...sel.extras].reduce((a, e) => a + p.extras.find((x) => x.label === e).price, 0);
  };
  const actualizar = () => {
    if (!puedePedir) return;
    $('#hp-total', hoja).textContent = fmtQ(unitario() * sel.cantidad);
    const completo = !p.elegir || sumaElegir() === p.elegir.count;
    $('#hp-agregar', hoja).disabled = !completo;
    $('#hp-agregar span', hoja).textContent = completo ? 'Agregar' : `Elige ${p.elegir.count - sumaElegir()} más`;
    if (p.elegir) {
      const c = $('#cuenta-elegir', hoja);
      c.textContent = `${sumaElegir()} de ${p.elegir.count}`;
      c.classList.toggle('ok', completo);
      hoja.querySelectorAll('.contador[data-op]').forEach((el) => {
        const n = sel.elegir[el.dataset.op];
        el.querySelector('output').textContent = n;
        el.querySelector('[data-d="-1"]').disabled = n === 0;
        el.querySelector('[data-d="1"]').disabled = completo;
      });
    }
    const cc = $('#hp-cant', hoja);
    cc.querySelector('output').textContent = sel.cantidad;
    cc.querySelector('[data-d="-1"]').disabled = sel.cantidad <= 1;
    cc.querySelector('[data-d="1"]').disabled = sel.cantidad >= 30;
  };

  hoja.onclick = (e) => {
    if (e.target.closest('.cerrar, [data-cerrar]')) return cerrarHoja(hoja);
    const d = e.target.closest('button[data-d]');
    if (d) {
      const delta = Number(d.dataset.d);
      const op = d.closest('.contador').dataset.op;
      if (op) sel.elegir[op] = Math.max(0, sel.elegir[op] + delta);
      else sel.cantidad = Math.min(30, Math.max(1, sel.cantidad + delta));
      return actualizar();
    }
    if (e.target.closest('#hp-agregar')) {
      agregarAlCarrito(p, { ...sel, nota: $('#hp-nota', hoja).value.trim() });
      cerrarHoja(hoja);
    }
  };
  hoja.onchange = (e) => {
    if (e.target.name === 'variante') sel.variante = e.target.value;
    if (e.target.name === 'extra') e.target.checked ? sel.extras.add(e.target.value) : sel.extras.delete(e.target.value);
    actualizar();
  };

  actualizar();
  hoja.scrollTop = 0;
  abrirHoja(hoja);
}

// ───────── carrito ─────────

function agregarAlCarrito(p, sel) {
  const elegir = Object.fromEntries(Object.entries(sel.elegir).filter(([, n]) => n > 0));
  const extras = [...sel.extras].sort();
  const linea = { platillo: p.id, variante: sel.variante, elegir, extras, nota: sel.nota };
  const llave = JSON.stringify(linea);
  const precio = (p.variantes ? p.variantes.find((v) => v.label === sel.variante).price : p.precio)
    + extras.reduce((a, e) => a + p.extras.find((x) => x.label === e).price, 0);
  const existente = carrito.find((l) => l.llave === llave);
  if (existente) existente.cantidad = Math.min(30, existente.cantidad + sel.cantidad);
  else carrito.push({ ...linea, llave, cantidad: sel.cantidad, precio, nombre: p.nombre });
  guardarCarrito();
  aviso(`${p.nombre} agregado a tu pedido`);
}

function guardarCarrito() {
  guardar(K_CARRITO, carrito);
  pintarFlotante();
  document.querySelectorAll('.item').forEach((b) => {
    const p = PLATILLOS.get(b.dataset.id);
    const nuevo = document.createElement('div');
    nuevo.innerHTML = itemHTML(p);
    b.replaceWith(nuevo.firstElementChild);
  });
}

const totalCarrito = () => carrito.reduce((a, l) => a + l.precio * l.cantidad, 0);

function pintarFlotante() {
  const n = carrito.reduce((a, l) => a + l.cantidad, 0);
  $('#flotante').classList.toggle('visible', modoPedido && n > 0);
  $('#flot-cant').textContent = n;
  $('#flot-total').textContent = fmtQ(totalCarrito());
}
$('#btn-carrito').onclick = abrirCarrito;

function detalleLinea(l) {
  const partes = [];
  if (l.variante) partes.push(l.variante);
  for (const [op, n] of Object.entries(l.elegir || {})) partes.push(n > 1 ? `${op} ×${n}` : op);
  for (const e of l.extras || []) partes.push(`+ ${e}`);
  if (l.nota) partes.push(`“${l.nota}”`);
  return partes.join(' · ');
}

function abrirCarrito() {
  const hoja = $('#hoja-carrito');
  const pintar = () => {
    if (!carrito.length) { cerrarHoja(hoja); return; }
    hoja.innerHTML = `
      <div class="titulo-hoja"><h2 id="hc-titulo">Tu pedido</h2><button class="cerrar" type="button" aria-label="Cerrar">${ICONOS.cerrar}</button></div>
      <p style="padding:0 20px;color:var(--tinta-suave);font-size:.9rem">${esc(MESA.nombre)} · ${esc(MESA.sucursalNombre)}</p>
      <div class="lineas">${carrito.map((l, i) => `
        <div class="linea">
          <b>${esc(l.nombre)}</b><span class="px">${fmtQ(l.precio * l.cantidad)}</span>
          <span class="det">${esc(detalleLinea(l)) || '&nbsp;'}</span>
          <span class="contador" data-i="${i}"><button type="button" data-d="-1" aria-label="Quitar uno">−</button><output>${l.cantidad}</output><button type="button" data-d="1" aria-label="Agregar uno" ${l.cantidad >= 30 ? 'disabled' : ''}>+</button></span>
        </div>`).join('')}
      </div>
      <div style="padding:16px 20px 0;display:grid;gap:12px">
        <label class="campo"><span>¿A nombre de quién?</span><input class="input" id="hc-cliente" maxlength="40" placeholder="Opcional" value="${esc(leer('em-cliente', ''))}"></label>
        <label class="campo"><span>Nota para el mesero</span><input class="input" id="hc-nota" maxlength="300" placeholder="Ej. traer todo junto, cubiertos extra…"></label>
      </div>
      <div class="total"><span>Total</span><span>${fmtQ(totalCarrito())}</span></div>
      <div class="pie-hoja"><button class="btn btn-miel" type="button" id="hc-enviar"><span>Enviar a cocina</span><span>${fmtQ(totalCarrito())}</span></button></div>`;
  };
  hoja.onclick = async (e) => {
    if (e.target.closest('.cerrar, [data-cerrar]')) return cerrarHoja(hoja);
    const d = e.target.closest('button[data-d]');
    if (d) {
      const nota = $('#hc-nota', hoja)?.value;
      const i = Number(d.closest('.contador').dataset.i);
      carrito[i].cantidad += Number(d.dataset.d);
      if (carrito[i].cantidad <= 0) carrito.splice(i, 1);
      guardarCarrito();
      pintar();
      if ($('#hc-nota', hoja)) $('#hc-nota', hoja).value = nota;
      return;
    }
    if (e.target.closest('#hc-enviar')) enviarPedido(hoja, e.target.closest('#hc-enviar'));
    if (e.target.closest('#hc-ver')) { cerrarHoja(hoja); abrirPedidos(); }
  };
  pintar();
  abrirHoja(hoja);
}

async function enviarPedido(hoja, boton) {
  boton.disabled = true;
  boton.firstElementChild.textContent = 'Enviando…';
  const cliente = $('#hc-cliente', hoja).value.trim();
  guardar('em-cliente', cliente);
  try {
    const r = await api('/api/pedidos', {
      metodo: 'POST',
      datos: {
        mesa: codigoMesa, cliente, nota: $('#hc-nota', hoja).value.trim(),
        lineas: carrito.map((l) => ({ platillo: l.platillo, variante: l.variante, elegir: l.elegir, extras: l.extras, nota: l.nota, cantidad: l.cantidad })),
      },
    });
    carrito = [];
    guardarCarrito();
    misPedidos.push({ id: r.id, t: Date.now() });
    guardar(K_PEDIDOS, misPedidos);
    estadoPedidos.set(r.id, r.estado);
    pintarBotonPedidos();
    hoja.innerHTML = `<div class="exito">
      <div class="sello"><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg></div>
      <h2>¡Pedido enviado!</h2>
      <p>La cocina ya recibió tu pedido #${r.id} por ${fmtQ(r.total)}. Te avisaremos aquí cuando esté listo.</p>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center;margin-top:8px">
        <button class="btn" type="button" id="hc-ver">Ver estado</button>
        <button class="btn btn-linea" type="button" data-cerrar>Seguir viendo el menú</button>
      </div></div>`;
    consultarPedidos();
  } catch (e) {
    aviso(e.message, 'error');
    boton.disabled = false;
    boton.firstElementChild.textContent = 'Enviar a cocina';
    if (e.status === 409) cargarMenu().then(pintarMenu).catch(() => {});
  }
}

// ───────── mis pedidos ─────────

let temporizador;
async function consultarPedidos() {
  clearTimeout(temporizador);
  if (!misPedidos.length) return;
  let lista = [];
  try {
    lista = await api(`/api/mesa/${encodeURIComponent(codigoMesa)}/pedidos?ids=${misPedidos.map((p) => p.id).join(',')}`);
  } catch { temporizador = setTimeout(consultarPedidos, 15000); return; }

  for (const p of lista) {
    const antes = estadoPedidos.get(p.id);
    if (antes && antes !== p.estado) {
      if (p.estado === 'listo') { aviso(`¡Tu pedido #${p.id} está listo! Ya te lo llevamos.`); navigator.vibrate?.([120, 60, 120]); }
      if (p.estado === 'preparando') aviso(`Tu pedido #${p.id} ya está en cocina.`);
      if (p.estado === 'cancelado') aviso(`Tu pedido #${p.id} fue cancelado. Consulta con tu mesero.`, 'error');
    }
    estadoPedidos.set(p.id, p.estado);
  }
  pintarBotonPedidos();
  if ($('#hoja-pedidos').classList.contains('abierta')) pintarPedidos(lista);
  const hayActivos = lista.some((p) => PASOS.includes(p.estado));
  if (hayActivos) temporizador = setTimeout(consultarPedidos, 8000);
  return lista;
}

function pintarPedidos(lista) {
  const hoja = $('#hoja-pedidos');
  const orden = [...lista].sort((a, b) => b.id - a.id);
  hoja.innerHTML = `
    <div class="titulo-hoja"><h2 id="hpe-titulo">Mis pedidos</h2><button class="cerrar" type="button" aria-label="Cerrar">${ICONOS.cerrar}</button></div>
    <p style="padding:0 20px 14px;color:var(--tinta-suave);font-size:.9rem">Se actualiza automáticamente.</p>
    ${orden.map((p) => {
      const paso = PASOS.indexOf(p.estado);
      return `<article class="pedido">
        <header><b>Pedido #${p.id}</b><span class="estado e-${p.estado}">${ESTADOS[p.estado]}</span></header>
        <ul>${p.lineas.map((l) => `<li>${l.cantidad}× ${esc(l.nombre)}${l.variante ? ` (${esc(l.variante)})` : ''}</li>`).join('')}</ul>
        <div style="display:flex;justify-content:space-between;margin-top:10px;font-size:.9rem"><span style="color:var(--tinta-suave)">${hace(p.creado)}</span><b>${fmtQ(p.total)}</b></div>
        ${paso >= 0 ? `<div class="progreso">${PASOS.map((_, i) => `<span class="${i <= paso ? 'hecho' : ''}"></span>`).join('')}</div>
          <div class="progreso-txt">${PASOS.map((s) => `<span>${ESTADOS[s]}</span>`).join('')}</div>` : ''}
      </article>`;
    }).join('') || '<p style="padding:0 20px 20px">Aún no has hecho pedidos.</p>'}
    <div style="height:16px"></div>`;
}

async function abrirPedidos() {
  const hoja = $('#hoja-pedidos');
  hoja.onclick = (e) => { if (e.target.closest('.cerrar')) cerrarHoja(hoja); };
  hoja.innerHTML = '<p style="padding:30px 20px">Cargando…</p>';
  abrirHoja(hoja);
  const lista = await consultarPedidos();
  if (lista) pintarPedidos(lista);
}

// ───────── servicio ─────────

async function llamar(tipo) {
  try {
    await api('/api/llamadas', { metodo: 'POST', datos: { mesa: codigoMesa, tipo } });
    aviso(tipo === 'cuenta' ? 'Listo, en un momento te llevamos la cuenta.' : 'Un mesero va en camino a tu mesa.');
    return true;
  } catch (e) { aviso(e.message, 'error'); return false; }
}

async function abrirCuenta() {
  const hoja = $('#hoja-servicio');
  let lista = [];
  try { lista = misPedidos.length ? await consultarPedidos() || [] : []; } catch { /* sin datos */ }
  const vigentes = lista.filter((p) => !['cancelado', 'pagado'].includes(p.estado));
  const total = vigentes.reduce((a, p) => a + p.total, 0);
  hoja.innerHTML = `
    <div class="titulo-hoja"><h2 id="hs-titulo">Pedir la cuenta</h2><button class="cerrar" type="button" aria-label="Cerrar">${ICONOS.cerrar}</button></div>
    <div style="padding:6px 20px 0;display:grid;gap:14px">
      ${vigentes.length ? `<div class="pedido" style="margin:0"><header><span>Pedidos desde este teléfono</span><b>${vigentes.length}</b></header>
        <div style="display:flex;justify-content:space-between;font-size:1.1rem"><span>Total</span><b>${fmtQ(total)}</b></div></div>
        <p style="color:var(--tinta-suave);font-size:.88rem">Si otras personas de tu mesa pidieron desde su teléfono, también se incluirá en la cuenta.</p>`
      : '<p style="color:var(--tinta-suave)">Le avisaremos a tu mesero para que te lleve la cuenta de la mesa.</p>'}
    </div>
    <div class="pie-hoja"><button class="btn btn-miel" type="button" id="hs-pedir"><span>Pedir la cuenta</span>${ICONOS.cuenta}</button></div>`;
  hoja.onclick = async (e) => {
    if (e.target.closest('.cerrar')) return cerrarHoja(hoja);
    const b = e.target.closest('#hs-pedir');
    if (b) { b.disabled = true; if (await llamar('cuenta')) cerrarHoja(hoja); else b.disabled = false; }
  };
  abrirHoja(hoja);
}
