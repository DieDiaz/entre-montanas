// Instala o actualiza la base de datos en Supabase.
// Uso: node scripts/instalar-supabase.js   (lee DATABASE_URL del archivo .env)
// Es seguro correrlo varias veces: crea lo que falte, actualiza funciones y datos del negocio,
// y solo carga menú y mesas si las tablas están vacías.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('pg');

const RAIZ = path.join(__dirname, '..');
try { process.loadEnvFile(path.join(RAIZ, '.env')); } catch { /* sin .env */ }
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en .env (Supabase → Connect → Session pooler).');
  process.exit(1);
}

const negocio = require('../data/negocio');
const menu = require('../data/menu');

(async () => {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL);
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } });
  await db.connect();

  console.log('Tablas…');
  await db.query(fs.readFileSync(path.join(RAIZ, 'supabase', 'schema.sql'), 'utf8'));

  console.log('Datos del negocio…');
  await db.query(`INSERT INTO ajustes (clave, valor) VALUES ('negocio', $1)
    ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [JSON.stringify(negocio)]);

  console.log('Funciones…');
  await db.query(fs.readFileSync(path.join(RAIZ, 'supabase', 'funciones.sql'), 'utf8'));

  const { rows: [{ n: cats }] } = await db.query('SELECT count(*)::int AS n FROM categorias');
  if (!cats) {
    console.log('Cargando menú…');
    const json = (v) => (v ? JSON.stringify(v) : null);
    await db.query('BEGIN');
    for (const [ci, c] of menu.entries()) {
      await db.query('INSERT INTO categorias (id, nombre, servicio, nota, orden) VALUES ($1,$2,$3,$4,$5)',
        [c.id, c.name, c.service || null, c.note || null, ci]);
      for (const [pi, p] of c.items.entries())
        await db.query(`INSERT INTO platillos (id, categoria, nombre, descripcion, precio, imagen, variantes, elegir, extras, destacado, orden)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [p.id, c.id, p.name, p.desc || null, p.price, p.img || null, json(p.variants), json(p.choose), json(p.addons), !!p.featured, pi]);
    }
    await db.query('COMMIT');
  }

  const { rows: [{ n: mesas }] } = await db.query('SELECT count(*)::int AS n FROM mesas');
  if (!mesas) {
    console.log('Creando mesas…');
    for (const s of negocio.sucursales)
      for (let n = 1; n <= s.mesas; n++)
        await db.query('INSERT INTO mesas (sucursal, numero, codigo) VALUES ($1,$2,$3)',
          [s.id, n, `${s.id.slice(0, 2)}${n}-${crypto.randomBytes(3).toString('hex')}`]);
  }

  if (process.env.STAFF_PIN) {
    await db.query(`INSERT INTO ajustes (clave, valor) VALUES ('pin_personal', $1)
      ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [process.env.STAFF_PIN]);
  } else {
    await db.query(`INSERT INTO ajustes (clave, valor) VALUES ('pin_personal', $1) ON CONFLICT (clave) DO NOTHING`,
      [String(crypto.randomInt(100000, 1000000))]);
  }
  const { rows: [{ valor: pin }] } = await db.query(`SELECT valor FROM ajustes WHERE clave = 'pin_personal'`);

  await db.end();
  console.log(`\nListo. PIN del personal: ${pin}`);
})().catch((e) => { console.error('\nError:', e.message, e.where ? `\n${e.where}` : ''); process.exit(1); });
