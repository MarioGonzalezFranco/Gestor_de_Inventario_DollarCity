const { app } = require('./app');
const { env } = require('./config/env');
const { iniciarEscucha } = require('./db/escucha');
const { pool } = require('./db/pool');

async function iniciar() {
  // Falla rápido si no hay conexión con PostgreSQL
  await pool.query('SELECT 1');
  // Conexión dedicada que recibe los avisos de los triggers (tiempo real)
  await iniciarEscucha();

  const servidor = app.listen(env.puerto, () => {
    console.log(`API lista en http://localhost:${env.puerto}/api`);
  });

  // Node cierra las conexiones inactivas a los 5 s; el navegador puede reutilizar
  // una que el servidor está cerrando y un POST (como el login) falla sin respuesta.
  // Con un tiempo mayor, el navegador siempre cierra primero.
  servidor.keepAliveTimeout = 65000;
  servidor.headersTimeout = 66000;
}

iniciar().catch((error) => {
  console.error('No se pudo iniciar la API:', error.message);
  process.exit(1);
});