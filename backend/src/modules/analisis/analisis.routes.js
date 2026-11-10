const { Router } = require('express');

const { permitirRoles, ubicacionPermitida, verificarToken } = require('../../middlewares/auth');
const { matrizAbc } = require('./analisis.service');

const analisisRouter = Router();

analisisRouter.use(verificarToken, permitirRoles('ADMINISTRADOR', 'SUPERVISOR'));

// GET /api/analisis/abc?ubicacionId=2&dias=30
analisisRouter.get('/abc', async (req, res) => {
  const dias = req.query.dias === undefined ? 30 : Number(req.query.dias);
  res.json(await matrizAbc(ubicacionPermitida(req, res), dias));
});

module.exports = { analisisRouter };