const { Pool, types } = require('pg');

const { env } = require('../config/env');

// PostgreSQL devuelve NUMERIC y BIGINT como texto; los convertimos a número
types.setTypeParser(1700, (valor) => parseFloat(valor)); // NUMERIC
types.setTypeParser(20, (valor) => parseInt(valor, 10)); // BIGINT (COUNT, SUM de enteros)

// options fija el esquema "dollarcity" desde que se abre cada conexión
const pool = new Pool({
  ...env.db,
  max: 10,
  options: '-c search_path=dollarcity'
});

/** Consulta simple; devuelve las filas. */
async function consultar(sql, parametros = []) {
  const resultado = await pool.query(sql, parametros);
  return resultado.rows;
}

/**
 * Ejecuta varias operaciones en una transacción.
 * Fija app.usuario_id para que los triggers sepan quién hizo el cambio.
 */
async function enTransaccion(usuarioId, trabajo) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query("SELECT set_config('app.usuario_id', $1, true)", [String(usuarioId)]);
    const resultado = await trabajo(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

module.exports = { pool, consultar, enTransaccion };