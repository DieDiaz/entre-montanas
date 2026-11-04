# Entre Montañas: pedidos por mesa y reservas

Web para el Restaurante Entre Montañas (Amatitlán y Villa Canales) y la cabaña Casa Alpina.
Es un sitio estático publicado en **GitHub Pages**; los datos y toda la lógica viven en **Supabase**.

| Página | Para quién | Qué hace |
|---|---|---|
| `index.html` | Público | Inicio: favoritos, sucursales, horarios, Waze, Casa Alpina |
| `mesa.html` | Público | Menú completo con fotos (solo consulta) |
| `mesa.html?m=<código>` | Cliente en la mesa | Lo abre el QR/NFC de cada mesa: pedir, ver estado, llamar mesero, pedir la cuenta |
| `reservar.html` | Público | Reserva de mesa con depósito de Q250 (saldo a favor) |
| `cabana.html` | Público | Calendario y reserva de Casa Alpina (Q500 lun–jue, Q650 vie–dom) |
| `personal.html` | Personal (PIN) | Pedidos en vivo, llamadas de mesa, reservas, cabaña, mesas/QR, menú |
| `qr.html` | Personal | Carteles con QR para imprimir |

## Cómo está armado

```
GitHub Pages (public/)  ──fetch──▶  Supabase /rest/v1/rpc/<función>  ──▶  Postgres
                        ◀─aviso──   Realtime, canal "em-personal"   ◀──  triggers
```

- **Las páginas solo llaman funciones** (`supabase/funciones.sql`) con la llave *publishable*, que es pública por diseño.
- **Las tablas tienen RLS sin políticas**, así que esa llave no puede leer ni escribir ninguna tabla directamente. Cada función valida los datos, recalcula precios y revisa la sesión del personal.
- **Avisos en vivo:** cada pedido, llamada, reserva o cambio de menú manda un aviso con solo el id por Supabase Realtime. El panel recibe el aviso y pide los datos completos con su token.
- **Cabaña:** la restricción `cabana_sin_traslape` impide que dos reservas activas compartan una noche, aunque lleguen en el mismo segundo.
- **Límites:** máximo 20 pedidos y 10 llamadas por minuto, y 8 reservas cada 10 minutos, por IP. Después de 8 PIN incorrectos por IP (o 40 en total) el acceso se bloquea 10 minutos.

`public/js/comun.js` tiene la URL del proyecto y la llave publishable (`SUPABASE`), y traduce las rutas internas (`/api/...`) a cada función.

## Instalar o actualizar la base de datos

Requiere Node.js 20.12 o superior.

1. En Supabase pulsa **Connect** y copia la URI del **Session pooler**.
2. Copia `.env.example` como `.env`, pega la URI en `DATABASE_URL` y pon la contraseña de la base.
3. Ejecuta:

```bash
npm install
npm run instalar
```

El script crea las tablas y funciones, guarda los datos del negocio (`data/negocio.js`) y carga el menú y las mesas si están vacíos. Al final muestra el **PIN del personal**. Puedes correrlo cuantas veces quieras.

- **Cambiar el PIN:** `STAFF_PIN=123456 npm run instalar`.
- **Cambiar horarios, precios de la cabaña o datos de pago:** edita `data/negocio.js` y vuelve a correr `npm run instalar`.

## Probar en tu computadora

```bash
npm run dev
```

Abre http://localhost:3000. Usa la misma base de Supabase que el sitio publicado.

## Publicar

Cada `git push` a `main` publica la carpeta `public/` en GitHub Pages (`.github/workflows/pages.yml`).
Los QR apuntan a la dirección desde donde abres el panel. **Imprímelos desde el sitio publicado**, no desde localhost.

## Cómo funciona

**Pedidos.** Cada mesa tiene un código único (p. ej. `am5-ad80bc`). El QR y la etiqueta NFC llevan a `mesa.html?m=<código>`. El cliente arma su pedido (variantes, guarniciones, extras y notas) y lo envía. La función `crear_pedido` recalcula los precios; nunca confía en los del teléfono. El pedido aparece al instante en el panel con un sonido, y avanza así: **Nuevo → En cocina → Listo → Entregado → Pagado**.

**Desayunos.** Solo se pueden pedir de 7:30 a 12:00, hora de Guatemala.

**Llamadas.** "Llamar mesero" y "Pedir la cuenta" aparecen en el panel con el total abierto de la mesa. "Cobrar mesa" marca como pagados todos sus pedidos.

**Reservas de mesa.** Los horarios salen de cada sucursal. Amatitlán no recibe reservas los lunes. Cada reserva queda *pendiente* hasta que el personal marca "Pago recibido".

**Casa Alpina.** Las noches *pendientes* y *confirmadas* bloquean el calendario. Si alguien no paga, cancela la reserva desde el panel y las fechas se liberan.

**NFC.** En el panel, en "Mesas y QR", copia la dirección de cada mesa. Grábala como registro URL en una etiqueta NTAG213/215 con una app como *NFC Tools*. "Nuevo código" invalida el QR y la etiqueta anteriores de esa mesa.

## Dónde editar

- `data/negocio.js`: horarios, depósito, precios de la cabaña, cuenta bancaria, WhatsApp. Después corre `npm run instalar`.
- `data/menu.js`: el menú transcrito del PDF. Solo se carga cuando la tabla `categorias` está vacía; lo demás se cambia desde el panel. Para recargarlo todo, ejecuta `TRUNCATE platillos, categorias;` en el SQL Editor y corre `npm run instalar`.
- `supabase/funciones.sql`: toda la lógica (validaciones, precios, reservas, sesiones).
- `scripts/extraer-imagenes.py`: recorta las fotos de los PDF originales (requiere PyMuPDF).

**Nunca subas `.env`** ni la llave secreta de Supabase: dan acceso total a la base.
