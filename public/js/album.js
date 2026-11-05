// Álbum "baraja que cae": fotos de pie, una detrás de otra. La de enfrente se
// inclina sobre su borde inferior y cae al piso, la baraja avanza y sigue la
// siguiente. Es infinito en ambos sentidos.
//
// Adaptado a JavaScript simple del componente React "Tumble Deck Showcase".
// La matemática de la caída es la misma; cambia la forma de manejarlo:
// deslizar a los lados, clic, flechas del teclado y botones. La rueda vertical
// del mouse sigue desplazando la página (solo el deslizamiento horizontal del
// trackpad mueve las fotos), para que el álbum no atrape el scroll.

(function () {
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  /** Módulo euclidiano: la carta k de la baraja infinita muestra la foto wrap(k, n). */
  const wrap = (k, n) => (n ? ((k % n) + n) % n : 0);

  /** Ángulo de la carta (grados, rotateX) cuando va `t` de su caída: cae con gravedad, rebota una vez y se asienta. */
  function anguloCaida(t) {
    const u = clamp01(t);
    const toca = 0.78;
    if (u <= toca) { const k = u / toca; return -90 * k * k * k; }
    const k = (u - toca) / (1 - toca);
    return -90 + 6 * Math.sin(Math.PI * k) * (1 - k);
  }

  /** Cuánto ha avanzado la baraja (en separaciones) en la posición `pos`. */
  function avance(pos) {
    const i = Math.floor(pos);
    const k = clamp01((pos - i - 0.28) / 0.6);
    return i + k * k * (3 - 2 * k);
  }

  /** Pose de la carta virtual `k` con la baraja en `pos` (la carta k está al frente cuando pos = k). */
  function pose(k, pos, fondo) {
    const t = pos - k;
    const alza = (k - Math.floor(pos) + 3) * 0.6;
    if (t >= 1) return { angulo: -90, z: 0, alza, opacidad: t < 3 ? 1 : 0, plana: true };
    if (t > 0) return { angulo: anguloCaida(t), z: 0, alza, opacidad: 1, plana: false };
    const rel = k - avance(pos);
    return { angulo: 0, z: -Math.max(rel, 0), alza: 0, opacidad: clamp01(fondo + 1 - rel), plana: false };
  }

  /**
   * Monta el álbum dentro de `raiz`.
   * fotos: [{ src, alt }]. Opciones: aspecto (ancho ÷ alto), fondo (cartas visibles detrás),
   * alCambiar(indice) cuando cambia la foto del frente.
   * Devuelve { siguiente(), anterior() }.
   */
  function crearAlbum(raiz, fotos, { aspecto = 0.8, fondo = 4, alCambiar = () => {} } = {}) {
    const n = fotos.length;
    if (!n) return { siguiente() {}, anterior() {} };
    const poolTam = fondo + 5; // dos en el piso, la que cae, la del frente, `fondo` detrás y una que aparece
    const escena = document.createElement('div');
    escena.className = 'td-escena';
    const cartas = [];
    const imgs = [];
    const ranura = [];
    for (let j = 0; j < poolTam; j++) {
      const c = document.createElement('div');
      c.className = 'td-carta';
      const im = document.createElement('img');
      im.alt = '';
      im.draggable = false;
      im.decoding = 'async';
      c.append(im);
      escena.append(c);
      cartas.push(c);
      imgs.push(im);
    }
    raiz.append(escena);

    const estado = { pos: 0 };
    const geo = { h: 200, sep: 44 };
    let ultimoIndice = -1;

    function pintar() {
      const { pos } = estado;
      const base = Math.floor(pos) - 2;
      for (let j = 0; j < poolTam; j++) {
        const k = base + wrap(j - base, poolTam);
        if (ranura[j] !== k) {
          ranura[j] = k;
          const f = fotos[wrap(k, n)];
          imgs[j].src = f.src;
          imgs[j].alt = f.alt || '';
          imgs[j].style.objectPosition = f.enfoque || '50% 50%';
        }
        const p = pose(k, pos, fondo);
        const el = cartas[j];
        el.style.transform = `translate3d(0, ${-p.alza}px, ${p.z * geo.sep}px) rotateX(${p.angulo}deg)`;
        el.style.opacity = String(p.opacidad);
        el.style.visibility = p.opacidad > 0 ? 'visible' : 'hidden';
        el.style.setProperty('--td-sombra', String(p.plana ? 0.06 : (-p.angulo / 90) * 0.06));
      }
      const i = wrap(Math.round(pos), n);
      if (i !== ultimoIndice) { ultimoIndice = i; alCambiar(i); }
    }

    // Ajuste: la carta, la baraja encima y la carta caída abajo caben en la raíz.
    function ajustar() {
      const W = raiz.clientWidth;
      const H = raiz.clientHeight;
      const h = Math.max(60, Math.min((W * (W < 420 ? 0.86 : 0.7)) / aspecto, H * 0.5, 620));
      const w = h * aspecto;
      const arriba = H / 2 - 0.66 * h;
      geo.h = h;
      geo.sep = 0.24 * h;
      escena.style.perspective = `${6 * h}px`;
      escena.style.perspectiveOrigin = `50% ${arriba - 1.66 * h}px`;
      raiz.style.setProperty('--td-w', `${w}px`);
      raiz.style.setProperty('--td-h', `${h}px`);
      raiz.style.setProperty('--td-top', `${arriba}px`);
      pintar();
    }
    new ResizeObserver(ajustar).observe(raiz);

    // La baraja sigue a una posición objetivo y al final se asienta en una foto entera.
    const reducir = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let objetivo = 0;
    let corriendo = false;
    let anterior = 0;
    let quieto;
    function cuadro(t) {
      const dt = Math.min(0.1, (t - (anterior || t)) / 1000);
      anterior = t;
      estado.pos += (objetivo - estado.pos) * (1 - Math.exp(-dt * 9));
      if (Math.abs(objetivo - estado.pos) < 2e-3) { estado.pos = objetivo; corriendo = false; anterior = 0; pintar(); return; }
      pintar();
      requestAnimationFrame(cuadro);
    }
    function empujar(a) {
      // Un empujón fuerte avanza carta por carta, sin saltarse la baraja.
      objetivo = Math.max(Math.round(estado.pos) - 3, Math.min(Math.round(estado.pos) + 3, a));
      if (reducir) { estado.pos = objetivo; pintar(); }
      else if (!corriendo) { corriendo = true; requestAnimationFrame(cuadro); }
    }
    const asentar = (dir = 0) =>
      empujar(dir > 0 ? Math.floor(objetivo + 0.7) : dir < 0 ? Math.ceil(objetivo - 0.7) : Math.round(objetivo));
    const paso = (dir) => empujar(Math.round(objetivo) + dir);

    // Deslizamiento horizontal del trackpad
    raiz.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (reducir) return;
      empujar(objetivo + e.deltaX / 240);
      clearTimeout(quieto);
      quieto = setTimeout(() => asentar(Math.sign(e.deltaX)), 140);
    }, { passive: false });

    // Arrastrar a los lados (dedo o mouse): a la izquierda = siguiente
    let arrastre = null;
    let arrastrado = false;
    raiz.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      arrastre = { id: e.pointerId, x: e.clientX, y: e.clientY, recorrido: 0, ultimo: 0 };
      arrastrado = false;
      clearTimeout(quieto);
    });
    raiz.addEventListener('pointermove', (e) => {
      if (!arrastre || e.pointerId !== arrastre.id) return;
      const dx = arrastre.x - e.clientX;
      arrastre.recorrido += Math.abs(dx);
      arrastre.x = e.clientX;
      if (dx) arrastre.ultimo = Math.sign(dx);
      if (arrastre.recorrido > 8 && !arrastrado) { arrastrado = true; raiz.setPointerCapture(e.pointerId); }
      if (arrastrado && !reducir) empujar(objetivo + dx / (geo.h * aspecto * 1.1));
    });
    const soltar = (e) => {
      if (!arrastre || e.pointerId !== arrastre.id) return;
      if (arrastrado) { if (reducir) paso(arrastre.ultimo || 0); else asentar(arrastre.ultimo); }
      arrastre = null;
    };
    raiz.addEventListener('pointerup', soltar);
    raiz.addEventListener('pointercancel', soltar);
    raiz.addEventListener('click', () => { if (!arrastrado) paso(1); });
    raiz.addEventListener('keydown', (e) => {
      if (['ArrowRight', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); paso(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); paso(-1); }
    });

    // Precargar todas las fotos para que no parpadeen al llegar
    setTimeout(() => fotos.forEach((f) => { const i = new Image(); i.decoding = 'async'; i.src = f.src; }), 800);

    ajustar();
    return { siguiente: () => paso(1), anterior: () => paso(-1) };
  }

  window.crearAlbum = crearAlbum;
})();
