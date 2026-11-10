const { Router } = require('express');

const { consultar } = require('../../db/pool');
const { usuarioActual, verificarToken } = require('../../middlewares/auth');

const ubicacionesRouter = Router();

ubicacionesRouter.use(verificarToken);

// GET /api/ubicaciones -> el administrador ve todas; el resto, solo la suya
ubicacionesRouter.get('/', async (req, res) => {
    const usuario = usuarioActual(res);
    const filas = await consultar(
        `SELECT ubicacion_id AS "ubicacionId", codigo, nombre, tipo
       FROM ubicaciones
      WHERE activa AND ($1::int IS NULL OR ubicacion_id = $1)
      ORDER BY ubicacion_id`,
        [usuario.ubicacionId]
    );
    res.json(filas);
});

module.exports = { ubicacionesRouter };