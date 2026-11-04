-- Lógica de Entre Montañas dentro de Supabase.
-- La página (GitHub Pages) solo llama a estas funciones por /rest/v1/rpc/<nombre>.
-- Las tablas tienen RLS sin políticas: la llave pública no puede tocarlas directamente.
-- Las funciones son SECURITY DEFINER, validan todo y recalculan precios.
-- Errores: RAISE con HINT = código HTTP (400, 401, 404, 409, 429).

CREATE TABLE IF NOT EXISTS limites (
  k     text PRIMARY KEY,
  n     integer NOT NULL,
  desde timestamptz NOT NULL
);
ALTER TABLE limites ENABLE ROW LEVEL SECURITY;

-- ───────────────────────── utilidades ─────────────────────────

CREATE OR REPLACE FUNCTION _falla(in_status int, in_msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING MESSAGE = in_msg, HINT = in_status::text;
END $$;

CREATE OR REPLACE FUNCTION _negocio() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT valor::jsonb FROM ajustes WHERE clave = 'negocio'
$$;

CREATE OR REPLACE FUNCTION _ahora_gt() RETURNS timestamp
LANGUAGE sql STABLE AS $$ SELECT now() AT TIME ZONE 'America/Guatemala' $$;

CREATE OR REPLACE FUNCTION _hoy() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT _ahora_gt()::date $$;

CREATE OR REPLACE FUNCTION _amin(in_hhmm text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT split_part(in_hhmm, ':', 1)::int * 60 + split_part(in_hhmm, ':', 2)::int $$;

CREATE OR REPLACE FUNCTION _ahora_min() RETURNS int
LANGUAGE sql STABLE AS $$ SELECT extract(hour FROM _ahora_gt())::int * 60 + extract(minute FROM _ahora_gt())::int $$;

CREATE OR REPLACE FUNCTION _hhmm(in_min int) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT lpad((in_min / 60)::text, 2, '0') || ':' || lpad((in_min % 60)::text, 2, '0') $$;

CREATE OR REPLACE FUNCTION _texto(in_v text, in_max int) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(left(btrim(coalesce(in_v, '')), in_max), '') $$;

/** Entero desde JSON (número o texto de dígitos); null si no es entero. */
CREATE OR REPLACE FUNCTION _entero(in_j jsonb) RETURNS int
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE t text := in_j #>> '{}';
BEGIN
  IF in_j IS NULL OR jsonb_typeof(in_j) NOT IN ('number', 'string') THEN RETURN NULL; END IF;
  IF t !~ '^-?\d{1,9}(\.0+)?$' THEN RETURN NULL; END IF;
  RETURN trunc(t::numeric)::int;
END $$;

CREATE OR REPLACE FUNCTION _fecha(in_s text) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF in_s IS NULL OR in_s !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
  RETURN in_s::date;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION _ip() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip', ''),
    nullif(btrim(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1)), ''),
    'local')
$$;

/** Cuenta un intento; falla con 429 si se pasa del máximo en la ventana. */
CREATE OR REPLACE FUNCTION _limitar(in_llave text, in_max int, in_segundos int) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v int;
BEGIN
  IF random() < 0.02 THEN DELETE FROM limites WHERE desde < now() - interval '1 day'; END IF;
  INSERT INTO limites (k, n, desde) VALUES (in_llave, 1, now())
  ON CONFLICT (k) DO UPDATE SET
    n     = CASE WHEN limites.desde < now() - make_interval(secs => in_segundos) THEN 1 ELSE limites.n + 1 END,
    desde = CASE WHEN limites.desde < now() - make_interval(secs => in_segundos) THEN now() ELSE limites.desde END
  RETURNING n INTO v;
  IF v > in_max THEN PERFORM _falla(429, 'Demasiados intentos. Espera un momento.'); END IF;
END $$;

CREATE OR REPLACE FUNCTION _sucursal(in_id text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT s FROM jsonb_array_elements(_negocio() -> 'sucursales') s WHERE s ->> 'id' = in_id
$$;

CREATE OR REPLACE FUNCTION _sesion(in_token text) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF in_token IS NULL OR NOT EXISTS (SELECT 1 FROM sesiones WHERE token = in_token) THEN
    PERFORM _falla(401, 'Sesión no válida');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION _codigo_reserva(in_prefijo text) RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT in_prefijo || '-' || string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  FROM generate_series(1, 5)
$$;

CREATE OR REPLACE FUNCTION _codigo_mesa(in_sucursal text, in_numero int) RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT left(in_sucursal, 2) || in_numero || '-' || encode(extensions.gen_random_bytes(3), 'hex')
$$;

-- ───────────────────────── menú ─────────────────────────

CREATE OR REPLACE FUNCTION _desayuno_abierto() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT _ahora_min() >= _amin(_negocio() #>> '{desayunos,desde}')
     AND _ahora_min() <  _amin(_negocio() #>> '{desayunos,hasta}')
$$;

CREATE OR REPLACE FUNCTION _platillo_json(p platillos) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'categoria', p.categoria, 'nombre', p.nombre, 'descripcion', p.descripcion, 'precio', p.precio,
    'imagen', CASE WHEN p.imagen IS NULL THEN NULL ELSE 'img/menu/' || p.imagen || '.jpg' END,
    'variantes', p.variantes, 'elegir', p.elegir, 'extras', p.extras,
    'destacado', p.destacado, 'disponible', p.disponible)
$$;

CREATE OR REPLACE FUNCTION _menu_categorias() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'nombre', c.nombre, 'servicio', c.servicio, 'nota', c.nota,
      'platillos', (SELECT coalesce(jsonb_agg(_platillo_json(p) ORDER BY p.orden), '[]') FROM platillos p WHERE p.categoria = c.id)
    ) ORDER BY c.orden), '[]')
  FROM categorias c
$$;

CREATE OR REPLACE FUNCTION info() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _negocio() || jsonb_build_object('desayunoAbierto', _desayuno_abierto(), 'hoy', _hoy())
$$;

CREATE OR REPLACE FUNCTION menu() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('categorias', _menu_categorias(), 'desayunoAbierto', _desayuno_abierto(), 'desayunos', _negocio() -> 'desayunos')
$$;

-- ───────────────────────── mesas y pedidos ─────────────────────────

CREATE OR REPLACE FUNCTION _mesa(in_codigo text) RETURNS mesas
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE m mesas;
BEGIN
  SELECT * INTO m FROM mesas WHERE codigo = coalesce(in_codigo, '') AND activa;
  IF NOT FOUND THEN PERFORM _falla(404, 'Esta mesa no existe o fue desactivada. Pide ayuda a nuestro personal.'); END IF;
  RETURN m;
END $$;

CREATE OR REPLACE FUNCTION mesa(in_codigo text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m mesas := _mesa(in_codigo); s jsonb;
BEGIN
  s := _sucursal(m.sucursal);
  RETURN jsonb_build_object('codigo', m.codigo, 'numero', m.numero, 'nombre', coalesce(m.nombre, 'Mesa ' || m.numero),
    'sucursal', m.sucursal, 'sucursalNombre', s ->> 'nombre');
END $$;

/** Pedidos completos (con mesa y líneas), ordenados por id. */
CREATE OR REPLACE FUNCTION _pedidos(in_ids int[]) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object(
      'numero', m.numero, 'mesa_nombre', m.nombre, 'mesa', coalesce(m.nombre, 'Mesa ' || m.numero),
      'lineas', (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id), '[]') FROM pedido_lineas l WHERE l.pedido_id = p.id)
    ) ORDER BY p.id), '[]')
  FROM pedidos p JOIN mesas m ON m.id = p.mesa_id
  WHERE p.id = ANY(in_ids)
$$;

CREATE OR REPLACE FUNCTION crear_pedido(in_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m mesas; p platillos; l jsonb; v jsonb; x jsonb; k text; val jsonb;
  servicio text; cantidad int; precio int; variante text; detalle text[]; suma int; n int;
  pid int; v_total int := 0; extras_vistos text[];
BEGIN
  PERFORM _limitar('pedido:' || _ip(), 20, 60);
  m := _mesa(in_datos ->> 'mesa');
  IF jsonb_typeof(in_datos -> 'lineas') IS DISTINCT FROM 'array' OR jsonb_array_length(in_datos -> 'lineas') = 0 THEN
    PERFORM _falla(400, 'Tu pedido está vacío.');
  END IF;
  IF jsonb_array_length(in_datos -> 'lineas') > 40 THEN PERFORM _falla(400, 'Pedido demasiado grande; divídelo en dos.'); END IF;

  INSERT INTO pedidos (sucursal, mesa_id, cliente, nota, total, dia)
  VALUES (m.sucursal, m.id, _texto(in_datos ->> 'cliente', 40), _texto(in_datos ->> 'nota', 300), 0, _hoy())
  RETURNING id INTO pid;

  FOR l IN SELECT e FROM jsonb_array_elements(in_datos -> 'lineas') e LOOP
    IF jsonb_typeof(l) <> 'object' THEN PERFORM _falla(400, 'Uno de los platillos ya no existe en el menú.'); END IF;
    SELECT * INTO p FROM platillos WHERE id = l ->> 'platillo';
    IF NOT FOUND THEN PERFORM _falla(400, 'Uno de los platillos ya no existe en el menú.'); END IF;
    IF NOT p.disponible THEN PERFORM _falla(409, p.nombre || ' está agotado por ahora.'); END IF;
    SELECT c.servicio INTO servicio FROM categorias c WHERE c.id = p.categoria;
    IF servicio = 'desayuno' AND NOT _desayuno_abierto() THEN
      PERFORM _falla(409, 'Los desayunos se sirven de ' || (_negocio() #>> '{desayunos,desde}') || ' a ' || (_negocio() #>> '{desayunos,hasta}') || '.');
    END IF;

    cantidad := _entero(l -> 'cantidad');
    IF cantidad IS NULL OR cantidad < 1 OR cantidad > 30 THEN PERFORM _falla(400, 'Cantidad no válida.'); END IF;

    precio := p.precio; variante := NULL; detalle := '{}';
    IF p.variantes IS NOT NULL THEN
      SELECT e INTO v FROM jsonb_array_elements(p.variantes) e WHERE e ->> 'label' = l ->> 'variante' LIMIT 1;
      IF v IS NULL THEN PERFORM _falla(400, 'Elige una opción para ' || p.nombre || '.'); END IF;
      variante := v ->> 'label';
      precio := (v ->> 'price')::int;
    END IF;

    IF p.elegir IS NOT NULL THEN
      suma := 0;
      IF jsonb_typeof(l -> 'elegir') = 'object' THEN
        FOR k, val IN SELECT key, value FROM jsonb_each(l -> 'elegir') LOOP
          n := _entero(val);
          IF NOT jsonb_exists(p.elegir -> 'options', k) OR jsonb_typeof(val) <> 'number' OR n IS NULL OR n < 0 THEN
            PERFORM _falla(400, 'Guarnición no válida.');
          END IF;
          IF n > 0 THEN
            suma := suma + n;
            detalle := detalle || CASE WHEN n > 1 THEN k || ' ×' || n ELSE k END;
          END IF;
        END LOOP;
      END IF;
      IF suma <> (p.elegir ->> 'count')::int THEN
        PERFORM _falla(400, p.nombre || ': ' || lower(p.elegir ->> 'label') || '.');
      END IF;
    END IF;

    IF jsonb_typeof(l -> 'extras') = 'array' AND jsonb_array_length(l -> 'extras') > 0 THEN
      IF p.extras IS NULL THEN PERFORM _falla(400, 'Extra no válido.'); END IF;
      extras_vistos := '{}';
      FOR k IN SELECT e #>> '{}' FROM jsonb_array_elements(l -> 'extras') e LOOP
        CONTINUE WHEN k = ANY(extras_vistos);
        extras_vistos := extras_vistos || k;
        SELECT e INTO x FROM jsonb_array_elements(p.extras) e WHERE e ->> 'label' = k LIMIT 1;
        IF x IS NULL THEN PERFORM _falla(400, 'Extra no válido.'); END IF;
        precio := precio + (x ->> 'price')::int;
        detalle := detalle || ('+ ' || (x ->> 'label'));
      END LOOP;
    END IF;

    INSERT INTO pedido_lineas (pedido_id, platillo_id, nombre, variante, detalle, precio, cantidad, nota)
    VALUES (pid, p.id, p.nombre, variante, nullif(array_to_string(detalle, ', '), ''), precio, cantidad, _texto(l ->> 'nota', 140));
    v_total := v_total + precio * cantidad;
  END LOOP;

  UPDATE pedidos SET total = v_total WHERE id = pid;
  RETURN jsonb_build_object('id', pid, 'total', v_total, 'estado', 'nuevo');
END $$;

CREATE OR REPLACE FUNCTION pedidos_mesa(in_codigo text, in_ids int[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m mesas := _mesa(in_codigo); ids int[];
BEGIN
  SELECT array_agg(id) INTO ids FROM pedidos WHERE mesa_id = m.id AND id = ANY(in_ids[1:30]);
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', e -> 'id', 'estado', e -> 'estado', 'total', e -> 'total', 'creado', e -> 'creado',
      'lineas', (SELECT coalesce(jsonb_agg(jsonb_build_object('nombre', li -> 'nombre', 'variante', li -> 'variante', 'cantidad', li -> 'cantidad')), '[]')
                 FROM jsonb_array_elements(e -> 'lineas') li))), '[]')
    FROM jsonb_array_elements(_pedidos(coalesce(ids, '{}'))) e);
END $$;

CREATE OR REPLACE FUNCTION crear_llamada(in_codigo text, in_tipo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m mesas;
BEGIN
  PERFORM _limitar('llamada:' || _ip(), 10, 60);
  m := _mesa(in_codigo);
  IF in_tipo IS NULL OR in_tipo NOT IN ('mesero', 'cuenta') THEN PERFORM _falla(400, 'Tipo no válido.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM llamadas WHERE mesa_id = m.id AND tipo = in_tipo AND estado = 'abierta') THEN
    INSERT INTO llamadas (sucursal, mesa_id, tipo) VALUES (m.sucursal, m.id, in_tipo);
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- ───────────────────────── reservas ─────────────────────────

CREATE OR REPLACE FUNCTION horarios_mesa(in_sucursal text, in_fecha text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s jsonb := _sucursal(in_sucursal); f date := _fecha(in_fecha); cfg jsonb := _negocio() -> 'reservaMesa';
  dif int; h jsonb; desde int; hasta int; horas text[] := '{}'; ahora int := _ahora_min(); mm int;
BEGIN
  IF s IS NULL THEN PERFORM _falla(400, 'Sucursal no válida.'); END IF;
  IF f IS NULL THEN PERFORM _falla(400, 'Fecha no válida.'); END IF;
  dif := f - _hoy();
  IF dif < 0 THEN RETURN jsonb_build_object('cerrado', false, 'horas', '[]'::jsonb, 'motivo', 'Esa fecha ya pasó.'); END IF;
  IF dif > (cfg ->> 'diasAnticipacion')::int THEN
    RETURN jsonb_build_object('horas', '[]'::jsonb, 'motivo', 'Reservamos con hasta ' || (cfg ->> 'diasAnticipacion') || ' días de anticipación.');
  END IF;
  h := s -> 'horario' -> extract(dow FROM f)::int::text;
  IF h IS NULL OR jsonb_typeof(h) = 'null' THEN
    RETURN jsonb_build_object('horas', '[]'::jsonb, 'cerrado', true, 'motivo', 'La sucursal ' || (s ->> 'nombre') || ' cierra ese día.');
  END IF;
  desde := _amin(h ->> 0);
  hasta := _amin(h ->> 1) - (cfg ->> 'ultimaAntesDeCierreMin')::int;
  mm := desde;
  WHILE mm <= hasta LOOP
    IF NOT (dif = 0 AND mm < ahora + 60) THEN horas := horas || _hhmm(mm); END IF;
    mm := mm + (cfg ->> 'intervaloMin')::int;
  END LOOP;
  RETURN jsonb_build_object('horas', to_jsonb(horas),
    'motivo', CASE WHEN cardinality(horas) = 0 THEN 'Ya no hay horarios disponibles para hoy.' END);
END $$;

CREATE OR REPLACE FUNCTION _contacto(b jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  nombre text := _texto(b ->> 'nombre', 80);
  telefono text := regexp_replace(coalesce(_texto(b ->> 'telefono', 20), ''), '[^0-9+]', '', 'g');
  correo text := _texto(b ->> 'correo', 120);
BEGIN
  IF nombre IS NULL OR length(nombre) < 2 THEN PERFORM _falla(400, 'Escribe tu nombre.'); END IF;
  IF length(regexp_replace(telefono, '\D', '', 'g')) < 8 THEN PERFORM _falla(400, 'Escribe un teléfono válido (8 dígitos).'); END IF;
  IF correo IS NOT NULL AND correo !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN PERFORM _falla(400, 'El correo no es válido.'); END IF;
  RETURN jsonb_build_object('nombre', nombre, 'telefono', telefono, 'correo', correo, 'nota', _texto(b ->> 'nota', 400));
END $$;

CREATE OR REPLACE FUNCTION _reserva_publica(r reservas) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('codigo', r.codigo, 'tipo', r.tipo, 'sucursal', r.sucursal, 'nombre', r.nombre,
    'fecha', r.fecha, 'hora', r.hora, 'fechaSalida', r.fecha_salida, 'personas', r.personas,
    'total', r.total, 'aPagar', r.a_pagar, 'estado', r.estado)
$$;

CREATE OR REPLACE FUNCTION _reserva_mesa(b jsonb, in_origen text, in_estado text) RETURNS reservas
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  c jsonb := _contacto(b); s jsonb := _sucursal(b ->> 'sucursal'); cfg jsonb := _negocio() -> 'reservaMesa';
  personas int := _entero(b -> 'personas'); hs jsonb; r reservas;
BEGIN
  IF s IS NULL THEN PERFORM _falla(400, 'Elige una sucursal.'); END IF;
  IF personas IS NULL OR personas < 1 OR personas > (cfg ->> 'maxPersonas')::int THEN
    PERFORM _falla(400, 'Para grupos de más de ' || (cfg ->> 'maxPersonas') || ' personas escríbenos por WhatsApp.');
  END IF;
  hs := horarios_mesa(s ->> 'id', b ->> 'fecha');
  IF NOT jsonb_exists(hs -> 'horas', coalesce(b ->> 'hora', '')) THEN
    PERFORM _falla(409, coalesce(hs ->> 'motivo', 'Ese horario no está disponible.'));
  END IF;
  INSERT INTO reservas (codigo, tipo, sucursal, nombre, telefono, correo, fecha, hora, personas, total, a_pagar, estado, nota, origen)
  VALUES (_codigo_reserva('EM'), 'mesa', s ->> 'id', c ->> 'nombre', c ->> 'telefono', c ->> 'correo', (b ->> 'fecha')::date, b ->> 'hora',
    personas, (cfg ->> 'deposito')::int, (cfg ->> 'deposito')::int, in_estado, c ->> 'nota', in_origen)
  RETURNING * INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION crear_reserva_mesa(in_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _limitar('reserva:' || _ip(), 8, 600);
  RETURN _reserva_publica(_reserva_mesa(in_datos, 'web', 'pendiente'));
END $$;

CREATE OR REPLACE FUNCTION _noches_ocupadas(in_desde date, in_hasta date, in_excluir int DEFAULT 0) RETURNS SETOF date
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT DISTINCT d::date FROM reservas r, generate_series(r.fecha, r.fecha_salida - 1, interval '1 day') d
  WHERE r.tipo = 'cabana' AND r.estado IN ('pendiente', 'confirmada')
    AND r.fecha < in_hasta AND r.fecha_salida > in_desde AND r.id <> in_excluir
$$;

CREATE OR REPLACE FUNCTION cabana_ocupado() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'hoy', _hoy(),
    'hasta', _hoy() + (_negocio() #>> '{cabana,diasAnticipacion}')::int + 1,
    'noches', (SELECT coalesce(jsonb_agg(d ORDER BY d), '[]') FROM _noches_ocupadas(_hoy(), _hoy() + (_negocio() #>> '{cabana,diasAnticipacion}')::int + 1) d),
    'precioNoche', _negocio() #> '{cabana,precioNoche}')
$$;

CREATE OR REPLACE FUNCTION cotizar_cabana(in_entrada text, in_salida text, in_excluir int DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c jsonb := _negocio() -> 'cabana'; e date := _fecha(in_entrada); s date := _fecha(in_salida);
  noches int; detalle jsonb;
BEGIN
  IF e IS NULL OR s IS NULL THEN PERFORM _falla(400, 'Fechas no válidas.'); END IF;
  IF e < _hoy() THEN PERFORM _falla(400, 'La fecha de entrada ya pasó.'); END IF;
  IF e - _hoy() > (c ->> 'diasAnticipacion')::int THEN
    PERFORM _falla(400, 'Reservamos con hasta ' || (c ->> 'diasAnticipacion') || ' días de anticipación.');
  END IF;
  noches := s - e;
  IF noches < 1 THEN PERFORM _falla(400, 'La salida debe ser al menos un día después de la entrada.'); END IF;
  IF noches > (c ->> 'maxNoches')::int THEN PERFORM _falla(400, 'Máximo ' || (c ->> 'maxNoches') || ' noches por reserva.'); END IF;
  SELECT jsonb_agg(jsonb_build_object(
      'fecha', d::date,
      'precio', (c -> 'precioNoche' ->> extract(dow FROM d)::int::text)::int,
      'ocupada', d::date IN (SELECT _noches_ocupadas(e, s, coalesce(in_excluir, 0)))) ORDER BY d)
    INTO detalle FROM generate_series(e, s - 1, interval '1 day') d;
  RETURN jsonb_build_object('noches', noches, 'detalle', detalle,
    'total', (SELECT sum((x ->> 'precio')::int) FROM jsonb_array_elements(detalle) x),
    'disponible', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(detalle) x WHERE (x ->> 'ocupada')::boolean));
END $$;

-- La restricción cabana_sin_traslape impide traslapes aunque dos personas reserven a la vez.
CREATE OR REPLACE FUNCTION _reserva_cabana(b jsonb, in_origen text, in_estado text) RETURNS reservas
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  ct jsonb := _contacto(b); c jsonb := _negocio() -> 'cabana'; personas int := _entero(b -> 'personas'); q jsonb; r reservas;
BEGIN
  IF personas IS NULL OR personas < 1 OR personas > (c ->> 'capacidadMax')::int THEN
    PERFORM _falla(400, 'La cabaña es para ' || (c ->> 'capacidadMin') || ' a ' || (c ->> 'capacidadMax') || ' personas.');
  END IF;
  q := cotizar_cabana(b ->> 'entrada', b ->> 'salida');
  IF NOT (q ->> 'disponible')::boolean THEN PERFORM _falla(409, 'Alguna de esas noches ya está reservada. Elige otras fechas.'); END IF;
  BEGIN
    INSERT INTO reservas (codigo, tipo, sucursal, nombre, telefono, correo, fecha, hora, fecha_salida, personas, total, a_pagar, estado, nota, origen)
    VALUES (_codigo_reserva('CA'), 'cabana', c ->> 'sucursal', ct ->> 'nombre', ct ->> 'telefono', ct ->> 'correo',
      (b ->> 'entrada')::date, c ->> 'checkIn', (b ->> 'salida')::date, personas, (q ->> 'total')::int, (q ->> 'total')::int,
      in_estado, ct ->> 'nota', in_origen)
    RETURNING * INTO r;
  EXCEPTION WHEN exclusion_violation THEN
    PERFORM _falla(409, 'Alguna de esas noches ya está reservada. Elige otras fechas.');
  END;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION crear_reserva_cabana(in_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _limitar('reserva:' || _ip(), 8, 600);
  RETURN _reserva_publica(_reserva_cabana(in_datos, 'web', 'pendiente'));
END $$;

-- ═════════════════════════ PERSONAL ═════════════════════════

/** No lanza error con PIN incorrecto: así el intento fallido sí queda contado. */
CREATE OR REPLACE FUNCTION entrar(in_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE fallos_ip int; fallos_total int; t text;
BEGIN
  SELECT coalesce(max(n) FILTER (WHERE k = 'login:' || _ip()), 0), coalesce(max(n) FILTER (WHERE k = 'login:*'), 0)
    INTO fallos_ip, fallos_total FROM limites
    WHERE k IN ('login:' || _ip(), 'login:*') AND desde > now() - interval '10 minutes';
  IF fallos_ip >= 8 OR fallos_total >= 40 THEN
    RETURN jsonb_build_object('error', 'Demasiados intentos. Espera unos minutos.', 'status', 429);
  END IF;
  IF in_pin IS NULL OR in_pin <> (SELECT valor FROM ajustes WHERE clave = 'pin_personal') THEN
    PERFORM _limitar('login:' || _ip(), 1000, 600);
    PERFORM _limitar('login:*', 1000, 600);
    RETURN jsonb_build_object('error', 'PIN incorrecto.', 'status', 401);
  END IF;
  t := encode(extensions.gen_random_bytes(24), 'base64');
  t := translate(t, '+/=', '-_');
  INSERT INTO sesiones (token) VALUES (t);
  RETURN jsonb_build_object('token', t);
END $$;

CREATE OR REPLACE FUNCTION salir(in_token text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM sesiones WHERE token = in_token;
  SELECT jsonb_build_object('ok', true);
$$;

CREATE OR REPLACE FUNCTION personal_pedidos(in_token text, in_sucursal text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _sesion(in_token);
  RETURN _pedidos(ARRAY(SELECT id FROM pedidos WHERE sucursal = in_sucursal
    AND (estado IN ('nuevo', 'preparando', 'listo', 'entregado') OR (dia = _hoy() AND estado IN ('pagado', 'cancelado')))));
END $$;

CREATE OR REPLACE FUNCTION personal_pedido(in_token text, in_id int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _sesion(in_token);
  RETURN _pedidos(ARRAY[in_id]) -> 0;
END $$;

CREATE OR REPLACE FUNCTION personal_pedido_estado(in_token text, in_id int, in_estado text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _sesion(in_token);
  IF in_estado IS NULL OR in_estado NOT IN ('nuevo', 'preparando', 'listo', 'entregado', 'pagado', 'cancelado') THEN
    PERFORM _falla(400, 'Estado no válido.');
  END IF;
  UPDATE pedidos SET estado = in_estado, actualizado = now() WHERE id = in_id;
  IF NOT FOUND THEN PERFORM _falla(404, 'Pedido no encontrado.'); END IF;
  RETURN _pedidos(ARRAY[in_id]) -> 0;
END $$;

CREATE OR REPLACE FUNCTION personal_cobrar(in_token text, in_mesa int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  PERFORM _sesion(in_token);
  UPDATE pedidos SET estado = 'pagado', actualizado = now()
    WHERE mesa_id = in_mesa AND estado IN ('nuevo', 'preparando', 'listo', 'entregado');
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE llamadas SET estado = 'atendida' WHERE mesa_id = in_mesa AND estado = 'abierta';
  RETURN jsonb_build_object('cobrados', n);
END $$;

CREATE OR REPLACE FUNCTION _llamadas(in_ids int[]) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object(
      'numero', m.numero, 'mesa', coalesce(m.nombre, 'Mesa ' || m.numero),
      'cuenta', (SELECT coalesce(sum(total), 0) FROM pedidos p WHERE p.mesa_id = l.mesa_id AND p.estado IN ('nuevo', 'preparando', 'listo', 'entregado')))
    ORDER BY l.id), '[]')
  FROM llamadas l JOIN mesas m ON m.id = l.mesa_id WHERE l.id = ANY(in_ids)
$$;

CREATE OR REPLACE FUNCTION personal_llamadas(in_token text, in_sucursal text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _sesion(in_token);
  RETURN _llamadas(ARRAY(SELECT id FROM llamadas WHERE sucursal = in_sucursal AND estado = 'abierta'));
END $$;

CREATE OR REPLACE FUNCTION personal_llamada(in_token text, in_id int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _sesion(in_token);
  RETURN _llamadas(ARRAY[in_id]) -> 0;
END $$;

CREATE OR REPLACE FUNCTION personal_atender(in_token text, in_id int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _sesion(in_token);
  UPDATE llamadas SET estado = 'atendida' WHERE id = in_id;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION personal_resumen(in_token text, in_sucursal text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; hoy date := _hoy();
BEGIN
  PERFORM _sesion(in_token);
  SELECT jsonb_build_object(
      'pedidos', count(*),
      'ventas', coalesce(sum(total) FILTER (WHERE estado <> 'cancelado'), 0),
      'cobrado', coalesce(sum(total) FILTER (WHERE estado = 'pagado'), 0))
    INTO r FROM pedidos WHERE sucursal = in_sucursal AND dia = hoy;
  RETURN r || jsonb_build_object(
    'mesasAbiertas', (SELECT count(DISTINCT mesa_id) FROM pedidos WHERE sucursal = in_sucursal AND estado IN ('nuevo', 'preparando', 'listo', 'entregado')),
    'reservasHoy', (SELECT count(*) FROM reservas WHERE sucursal = in_sucursal AND tipo = 'mesa' AND fecha = hoy AND estado IN ('pendiente', 'confirmada')),
    'top', (SELECT coalesce(jsonb_agg(t), '[]') FROM (
      SELECT l.nombre, sum(l.cantidad) AS n FROM pedido_lineas l JOIN pedidos p ON p.id = l.pedido_id
      WHERE p.sucursal = in_sucursal AND p.dia = hoy AND p.estado <> 'cancelado'
      GROUP BY l.nombre ORDER BY n DESC LIMIT 5) t));
END $$;

CREATE OR REPLACE FUNCTION personal_reservas(in_token text, in_tipo text DEFAULT NULL, in_desde text DEFAULT NULL,
  in_hasta text DEFAULT NULL, in_estado text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _sesion(in_token);
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.fecha, r.hora), '[]') FROM (
    SELECT * FROM reservas
    WHERE (in_tipo IS NULL OR in_tipo = '' OR tipo = in_tipo)
      AND (_fecha(in_desde) IS NULL OR coalesce(fecha_salida, fecha) >= _fecha(in_desde))
      AND (_fecha(in_hasta) IS NULL OR fecha <= _fecha(in_hasta))
      AND (in_estado IS NULL OR in_estado = '' OR estado = in_estado)
    ORDER BY fecha, hora LIMIT 500) r);
END $$;

CREATE OR REPLACE FUNCTION personal_reserva_crear(in_token text, in_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE estado text := CASE WHEN in_datos ->> 'estado' = 'confirmada' THEN 'confirmada' ELSE 'pendiente' END;
BEGIN
  PERFORM _sesion(in_token);
  IF in_datos ->> 'tipo' = 'cabana' THEN RETURN to_jsonb(_reserva_cabana(in_datos, 'personal', estado)); END IF;
  RETURN to_jsonb(_reserva_mesa(in_datos, 'personal', estado));
END $$;

CREATE OR REPLACE FUNCTION personal_reserva_editar(in_token text, in_id int, in_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r reservas; v_estado text; v_nota text;
BEGIN
  PERFORM _sesion(in_token);
  SELECT * INTO r FROM reservas WHERE id = in_id;
  IF NOT FOUND THEN PERFORM _falla(404, 'Reserva no encontrada.'); END IF;
  v_estado := coalesce(in_datos ->> 'estado', r.estado);
  IF v_estado NOT IN ('pendiente', 'confirmada', 'cancelada', 'completada', 'no_show') THEN PERFORM _falla(400, 'Estado no válido.'); END IF;
  v_nota := CASE WHEN in_datos ? 'nota_interna' THEN coalesce(_texto(in_datos ->> 'nota_interna', 500), '') ELSE r.nota_interna END;
  BEGIN
    UPDATE reservas SET estado = v_estado, nota_interna = v_nota, actualizado = now() WHERE id = r.id RETURNING * INTO r;
  EXCEPTION WHEN exclusion_violation THEN
    PERFORM _falla(409, 'Esas noches ya fueron tomadas por otra reserva.');
  END;
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION personal_mesas(in_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _sesion(in_token);
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.sucursal, m.numero), '[]') FROM mesas m);
END $$;

CREATE OR REPLACE FUNCTION personal_mesa_crear(in_token text, in_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE suc text := in_datos ->> 'sucursal'; num int := _entero(in_datos -> 'numero'); m mesas;
BEGIN
  PERFORM _sesion(in_token);
  IF _sucursal(suc) IS NULL THEN PERFORM _falla(400, 'Sucursal no válida.'); END IF;
  IF num IS NULL OR num = 0 THEN SELECT coalesce(max(numero), 0) + 1 INTO num FROM mesas WHERE sucursal = suc; END IF;
  IF num < 1 OR num > 9999 THEN PERFORM _falla(400, 'Número de mesa no válido.'); END IF;
  IF EXISTS (SELECT 1 FROM mesas WHERE sucursal = suc AND numero = num) THEN PERFORM _falla(409, 'La mesa ' || num || ' ya existe.'); END IF;
  INSERT INTO mesas (sucursal, numero, nombre, codigo) VALUES (suc, num, _texto(in_datos ->> 'nombre', 40), _codigo_mesa(suc, num))
  RETURNING * INTO m;
  RETURN to_jsonb(m);
END $$;

CREATE OR REPLACE FUNCTION personal_mesa_editar(in_token text, in_id int, in_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m mesas;
BEGIN
  PERFORM _sesion(in_token);
  SELECT * INTO m FROM mesas WHERE id = in_id;
  IF NOT FOUND THEN PERFORM _falla(404, 'Mesa no encontrada.'); END IF;
  UPDATE mesas SET
    codigo = CASE WHEN coalesce((in_datos ->> 'nuevoCodigo')::boolean, false) THEN _codigo_mesa(m.sucursal, m.numero) ELSE m.codigo END,
    activa = CASE WHEN in_datos ? 'activa' THEN coalesce((in_datos ->> 'activa')::boolean, false) ELSE m.activa END,
    nombre = CASE WHEN in_datos ? 'nombre' THEN _texto(in_datos ->> 'nombre', 40) ELSE m.nombre END
  WHERE id = m.id RETURNING * INTO m;
  RETURN to_jsonb(m);
END $$;

CREATE OR REPLACE FUNCTION personal_menu(in_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _sesion(in_token);
  RETURN _menu_categorias();
END $$;

CREATE OR REPLACE FUNCTION personal_platillo(in_token text, in_id text, in_datos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p platillos; v_precio int;
BEGIN
  PERFORM _sesion(in_token);
  SELECT * INTO p FROM platillos WHERE id = in_id;
  IF NOT FOUND THEN PERFORM _falla(404, 'Platillo no encontrado.'); END IF;
  v_precio := p.precio;
  IF in_datos ? 'precio' THEN
    v_precio := _entero(in_datos -> 'precio');
    IF v_precio IS NULL OR v_precio < 0 OR v_precio > 100000 THEN PERFORM _falla(400, 'Precio no válido.'); END IF;
  END IF;
  UPDATE platillos SET
    disponible = CASE WHEN in_datos ? 'disponible' THEN coalesce((in_datos ->> 'disponible')::boolean, false) ELSE p.disponible END,
    precio = v_precio
  WHERE id = p.id RETURNING * INTO p;
  RETURN _platillo_json(p);
END $$;

-- ═════════════════════════ AVISOS EN VIVO ═════════════════════════
-- Cada cambio manda un aviso pequeño (solo ids) al canal público "em-personal".
-- El panel recibe el aviso y pide los datos completos con su token.

CREATE OR REPLACE FUNCTION _avisar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d jsonb := jsonb_build_object('id', NEW.id, 'nuevo', TG_OP = 'INSERT');
BEGIN
  IF TG_TABLE_NAME = 'pedidos' THEN
    d := d || jsonb_build_object('sucursal', NEW.sucursal, 'estado', NEW.estado);
    -- el pedido se crea con total 0 y se completa al final; avisar solo cuando ya tiene líneas
    IF TG_OP = 'INSERT' THEN RETURN NULL; END IF;
    IF TG_OP = 'UPDATE' AND OLD.total = 0 AND NEW.total > 0 THEN d := d || jsonb_build_object('nuevo', true); END IF;
    PERFORM realtime.send(d, 'pedido', 'em-personal', false);
  ELSIF TG_TABLE_NAME = 'llamadas' THEN
    PERFORM realtime.send(d || jsonb_build_object('sucursal', NEW.sucursal, 'estado', NEW.estado), 'llamada', 'em-personal', false);
  ELSIF TG_TABLE_NAME = 'reservas' THEN
    PERFORM realtime.send(d || jsonb_build_object('sucursal', NEW.sucursal, 'tipo', NEW.tipo, 'origen', NEW.origen, 'estado', NEW.estado),
      'reserva', 'em-personal', false);
  ELSIF TG_TABLE_NAME = 'platillos' THEN
    PERFORM realtime.send(d, 'menu', 'em-personal', false);
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL; -- un aviso fallido nunca debe impedir guardar un pedido
END $$;

DROP TRIGGER IF EXISTS avisar ON pedidos;
DROP TRIGGER IF EXISTS avisar ON llamadas;
DROP TRIGGER IF EXISTS avisar ON reservas;
DROP TRIGGER IF EXISTS avisar ON platillos;
CREATE TRIGGER avisar AFTER INSERT OR UPDATE ON pedidos   FOR EACH ROW EXECUTE FUNCTION _avisar();
CREATE TRIGGER avisar AFTER INSERT OR UPDATE ON llamadas  FOR EACH ROW EXECUTE FUNCTION _avisar();
CREATE TRIGGER avisar AFTER INSERT OR UPDATE ON reservas  FOR EACH ROW EXECUTE FUNCTION _avisar();
CREATE TRIGGER avisar AFTER UPDATE ON platillos           FOR EACH ROW EXECUTE FUNCTION _avisar();

-- ═════════════════════════ PERMISOS ═════════════════════════
-- Solo las funciones públicas se pueden llamar con la llave publishable; las internas (_) no.

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS firma, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prokind = 'f' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.firma);
    IF f.proname IN ('info', 'menu', 'mesa', 'crear_pedido', 'pedidos_mesa', 'crear_llamada', 'horarios_mesa',
                     'crear_reserva_mesa', 'cabana_ocupado', 'cotizar_cabana', 'crear_reserva_cabana', 'entrar', 'salir')
       OR f.proname LIKE 'personal\_%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f.firma);
    END IF;
  END LOOP;
END $$;
