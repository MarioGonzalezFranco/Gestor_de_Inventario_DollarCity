// Asigna la contraseña de prueba "Demo123" a todos los usuarios.
// Uso: npm run claves:demo
const bcrypt = require('bcryptjs');

const { pool } = require('../db/pool');

const CLAVE_DEMO = 'Demo123';

async function asignar() {
  const hash = await bcrypt.hash(CLAVE_DEMO, 10);
  const resultado = await pool.query('UPDATE usuarios SET contrasena_hash = $1', [hash]);
  console.log(`Contraseña "${CLAVE_DEMO}" asignada a ${resultado.rowCount} usuarios.`);
  await pool.end();
}

asignar().catch(async (error) => {
  console.error('Error:', error.message);
  await pool.end();
  process.exit(1);
});