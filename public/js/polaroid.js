// Carrusel "tendedero de polaroids": fotos instantáneas colgadas con pinzas de
// un cordón que se curva. Al arrastrar (o con las flechas) las fotos se deslizan
// por el cordón y se columpian según la velocidad; en reposo se mecen con una
// brisa ligera. La del centro es la que se está viendo.
//
// Adaptado a JavaScript simple del componente React "Polaroid Line Carousel".
// Misma física (resorte críticamente amortiguado + péndulo por foto). Se quitó
// el pintor de paisajes de relleno porque aquí todas las fotos son reales.

(function () {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pad2 = (n) => (n < 10 ? '0' + n : String(n));

  /** Altura del cordón, que cuelga `sag` px entre (0, y0) y (w, y0), en x. */
  function cordonY(x, w, y0, sag) {
    const t = clamp(x / w, 0, 1);
    return y0 + 4 * sag * t * (1 - t);
  }
  /** Un paso de resorte críticamente amortiguado hacia el objetivo. */
  function resorte(x, v, objetivo, dt, k = 70) {
    const c = 2 * Math.sqrt(k);
    const nv = v + (k * (objetivo - x) - c * v) * dt;
    return [x + nv * dt, nv];
  }
  /** Un paso del columpio de una foto: se atrasa respecto al movimiento, la gravedad la regresa y se amortigua. */
  function columpio(a, w, velLinea, dt, ganancia) {
    const nw = w + (-38 * a - 4.2 * w + velLinea * 0.0034 * ganancia) * dt;
    return [clamp(a + nw * dt, -0.6, 0.6), nw];
  }
  const masCercana = (off, sep, n) => clamp(Math.round(off / sep), 0, Math.max(0, n - 1));

  const FLECHA = (d) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="${d}" stroke="currentColor" stroke-width="1.6"/></svg>`;

  /**
   * Monta el carrusel en `raiz`. fotos: [{ src, titulo, texto, alt }].
   * Opciones: anchoFoto (px máx.), comba (px que cuelga el cordón), columpio (0 = quietas),
   * autoplay (ms por foto; 0 lo apaga; se pausa mientras alguien interactúa).
   */
  function crearTendedero(raiz, fotos, { anchoFoto = 300, comba = 46, columpio: gan = 1, autoplay = 5000 } = {}) {
    const n = fotos.length;
    if (!n) return;
    raiz.classList.add('pl-raiz');
    raiz.tabIndex = 0;
    raiz.setAttribute('role', 'region');
    raiz.setAttribute('aria-roledescription', 'carrusel');

    raiz.innerHTML = `<svg class="pl-cordon" aria-hidden="true"><path fill="none" stroke-width="1.5" stroke-linecap="round"/></svg>
      ${fotos.map((f, i) => `<div class="pl-foto" data-i="${i}"><div class="pl-papel">
        <div class="pl-imagen"><img src="${f.src}" alt="${esc(f.alt || f.titulo || '')}" draggable="false" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async"></div>
        <div class="pl-nota">${esc(f.titulo || '')}</div></div><div class="pl-pinza"></div></div>`).join('')}
      <div class="pl-barra">
        <div class="pl-pie" aria-hidden="true"></div>
        <span class="pl-cuenta" aria-hidden="true"></span>
        <button type="button" class="pl-btn" data-paso="-1" aria-label="Foto anterior">${FLECHA('M10 3 5 8l5 5')}</button>
        <button type="button" class="pl-btn" data-paso="1" aria-label="Foto siguiente">${FLECHA('m6 3 5 5-5 5')}</button>
      </div>
      <div class="sr" aria-live="polite"></div>`;

    const camino = raiz.querySelector('.pl-cordon path');
    const cartas = [...raiz.querySelectorAll('.pl-foto')];
    const pie = raiz.querySelector('.pl-pie');
    const cuenta = raiz.querySelector('.pl-cuenta');
    const vivo = raiz.querySelector('[aria-live]');

    const S = { off: 0, vel: 0, objetivo: 0, a: [], w: [] };
    const tam = { w: 1200, h: 800, cw: anchoFoto };
    let sep = tam.cw * 1.08;
    let activa = -1;
    let arrastre = null;
    let ultimoToque = 0;

    function marcarActiva(i) {
      if (i === activa) return;
      activa = i;
      const f = fotos[i];
      cartas.forEach((c, j) => { c.dataset.on = j === i ? '1' : '0'; c.setAttribute('aria-hidden', j === i ? 'false' : 'true'); });
      // se reemplaza el contenido para que la animación de entrada vuelva a correr
      pie.innerHTML = `${f.titulo ? `<span class="pl-titulo">${esc(f.titulo)}</span>` : ''}${f.texto ? `<span class="pl-texto">${esc(f.texto)}</span>` : ''}`;
      cuenta.innerHTML = `<b>${pad2(i + 1)}</b> / ${pad2(n)}`;
      vivo.textContent = `Foto ${i + 1} de ${n}${f.titulo ? ': ' + f.titulo : ''}`;
    }
    const irA = (i) => { S.objetivo = clamp(i, 0, n - 1) * sep; };
    const paso = (dir) => { ultimoToque = performance.now(); irA(clamp(Math.max(activa, 0) + dir, 0, n - 1)); };

    new ResizeObserver(() => {
      const r = raiz.getBoundingClientRect();
      // En teléfono la foto ocupa más del ancho; las vecinas se asoman a los lados.
      const cw = Math.round(Math.max(150, Math.min(anchoFoto, r.width * (r.width < 600 ? 0.64 : 0.42), r.height * 0.5)));
      const i = Math.max(activa, 0);
      Object.assign(tam, { w: r.width, h: r.height, cw });
      sep = cw * 1.08;
      raiz.style.setProperty('--pl-cw', cw + 'px');
      S.objetivo = S.off = i * sep;
    }).observe(raiz);

    // Simulación: se escribe directo al DOM en cada cuadro, solo mientras el carrusel está a la vista.
    const reducir = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let visible = true;
    let raf = 0;
    let prev = performance.now();
    function cuadro(ahora) {
      raf = 0;
      if (!visible) return;
      const dt = Math.min(0.033, (ahora - prev) / 1000);
      prev = ahora;
      const { w, h, cw } = tam;
      const y0 = Math.max(40, h * 0.12);
      let velLinea;
      if (arrastre && arrastre.movido) velLinea = arrastre.v * 1000;
      else {
        const antes = S.off;
        [S.off, S.vel] = resorte(S.off, S.vel, S.objetivo, dt);
        velLinea = -(S.off - antes) / Math.max(dt, 1e-3);
      }
      const g = reducir ? 0 : gan;
      const cerca = masCercana(S.off, sep, n);
      for (let i = 0; i < n; i++) {
        const el = cartas[i];
        const x = w / 2 + i * sep - S.off;
        if (x < -cw * 1.5 || x > w + cw * 1.5) { el.style.visibility = 'hidden'; continue; }
        el.style.visibility = 'visible';
        let a = S.a[i] || 0;
        let av = S.w[i] || 0;
        [a, av] = columpio(a, av, velLinea, dt, g);
        if (g) a += Math.sin(ahora / 1300 + i * 1.7) * 0.0009 * g; // brisa
        S.a[i] = a;
        S.w[i] = av;
        const y = cordonY(x, w, y0, comba) - 6;
        el.style.transform = `translate(${(x - cw / 2).toFixed(1)}px,${y.toFixed(1)}px) rotate(${a.toFixed(4)}rad)`;
        el.style.zIndex = String(i === cerca ? n + 1 : n - Math.abs(i - cerca));
      }
      camino.setAttribute('d', `M0 ${y0} Q${w / 2} ${y0 + 2 * comba} ${w} ${y0}`);
      marcarActiva(cerca);
      raf = requestAnimationFrame(cuadro);
    }
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) { prev = performance.now(); raf = requestAnimationFrame(cuadro); }
    }).observe(raiz);
    raf = requestAnimationFrame(cuadro);

    // Avance automático; regresa a la primera después de la última.
    if (autoplay && n > 1 && !reducir) {
      setInterval(() => {
        if (document.hidden || !visible || arrastre || performance.now() - ultimoToque < autoplay) return;
        irA(activa >= n - 1 ? 0 : activa + 1);
      }, autoplay);
    }

    // Arrastrar
    raiz.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.pl-barra')) return;
      ultimoToque = performance.now();
      arrastre = { x: e.clientX, off: S.off, lx: e.clientX, lt: e.timeStamp, v: 0, movido: false };
    });
    raiz.addEventListener('pointermove', (e) => {
      const d = arrastre;
      if (!d) return;
      const dx = e.clientX - d.x;
      if (!d.movido && Math.abs(dx) > 5) { d.movido = true; raiz.dataset.arrastre = '1'; raiz.setPointerCapture(e.pointerId); }
      if (!d.movido) return;
      const dt = Math.max(1, e.timeStamp - d.lt);
      d.v = 0.7 * ((e.clientX - d.lx) / dt) + 0.3 * d.v;
      d.lx = e.clientX;
      d.lt = e.timeStamp;
      const max = (n - 1) * sep;
      let off = d.off - dx;
      if (off < 0) off *= 0.35; // resistencia en los extremos
      if (off > max) off = max + (off - max) * 0.35;
      S.off = off;
    });
    const soltar = (e) => {
      const d = arrastre;
      arrastre = null;
      ultimoToque = performance.now();
      if (!d) return;
      if (d.movido) {
        raiz.dataset.arrastre = '0';
        S.vel = -d.v * 1000;
        irA(masCercana(S.off - d.v * 180, sep, n));
        return;
      }
      const carta = e.target.closest('[data-i]');
      if (carta) irA(Number(carta.dataset.i));
    };
    raiz.addEventListener('pointerup', soltar);
    raiz.addEventListener('pointercancel', soltar);
    raiz.querySelectorAll('[data-paso]').forEach((b) => { b.onclick = () => paso(Number(b.dataset.paso)); });
    raiz.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') paso(1);
      else if (e.key === 'ArrowLeft') paso(-1);
      else return;
      e.preventDefault();
    });
  }

  window.crearTendedero = crearTendedero;
})();
