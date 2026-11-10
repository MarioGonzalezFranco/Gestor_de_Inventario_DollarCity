const { Router } = require('express');

const { permitirRoles, ubicacionPermitida, verificarToken } = require('../../middlewares/auth');
const { kardex, listarAlertas, listarStock, resumen } = require('./inventario.service');

const inventarioRouter = Router();
const soloOperacion = permitirRoles('ADMINISTRADOR', 'SUPERVISOR', 'BODEGUERO');

inventarioRouter.use(verificarToken);

// GET /api/inventario/stock?ubicacionId=2&buscar=taza   (todos los roles)
inventarioRouter.get('/stock', async (req, res) => {
    const buscar = typeof req.query.buscar === 'string' ? req.query.buscar : undefined;
    res.json(await listarStock(ubicacionPermitida(req, res), buscar));
});

// GET /api/inventario/alertas?ubicacionId=2
inventarioRouter.get('/alertas', soloOperacion, async (req, res) => {
    res.json(await listarAlertas(ubicacionPermitida(req, res)));
});

// GET /api/inventario/resumen?ubicacionId=2
inventarioRouter.get('/resumen', soloOperacion, async (req, res) => {
    res.json(await resumen(ubicacionPermitida(req, res)));
});

// GET /api/inventario/kardex/DC-0021?ubicacionId=2
inventarioRouter.get('/kardex/:sku', soloOperacion, async (req, res) => {
    res.json(await kardex(ubicacionPermitida(req, res), req.params.sku));
});

module.exports = { inventarioRouter };