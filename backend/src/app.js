const cors = require('cors');
const express = require('express');

const { env } = require('./config/env');
const { consultar } = require('./db/pool');
const { manejarErrores, rutaNoEncontrada } = require('./middlewares/errores');
const { analisisRouter } = require('./modules/analisis/analisis.routes');
const { authRouter } = require('./modules/auth/auth.routes');
const { inventarioRouter } = require('./modules/inventario/inventario.routes');
const { ubicacionesRouter } = require('./modules/ubicaciones/ubicaciones.routes');

const app = express();

app.use(cors({ origin: env.corsOrigen }));
app.use(express.json());

// GET /api/salud -> comprueba que la API y la base de datos respondan
app.get('/api/salud', async (req, res) => {
  const [fila] = await consultar('SELECT now() AS hora');
  res.json({ estado: 'ok', baseDeDatos: 'conectada', hora: fila.hora });
});

app.use('/api/auth', authRouter);
app.use('/api/ubicaciones', ubicacionesRouter);
app.use('/api/inventario', inventarioRouter);
app.use('/api/analisis', analisisRouter);

app.use(rutaNoEncontrada);
app.use(manejarErrores);

module.exports = { app };