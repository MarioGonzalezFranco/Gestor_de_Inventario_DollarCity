const { app } = require('./app');
const { env } = require('./config/env');
const { pool } = require('./db/pool');

async function iniciar() {
    // Falla rápido si no hay conexión con PostgreSQL
    await pool.query('SELECT 1');
    app.listen(env.puerto, () => {
        console.log(`API lista en http://localhost:${env.puerto}/api`);
    });
}

iniciar().catch((error) => {
    console.error('No se pudo iniciar la API:', error.message);
    process.exit(1);
});