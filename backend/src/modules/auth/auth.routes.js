const { Router } = require('express');

const { usuarioActual, verificarToken } = require('../../middlewares/auth');
const { iniciarSesion, obtenerUsuario } = require('./auth.service');

const authRouter = Router();

// POST /api/auth/login  { usuario, clave } -> { token, usuario }
authRouter.post('/login', async (req, res) => {
  const { usuario, clave } = req.body ?? {};
  res.json(await iniciarSesion(usuario, clave));
});

// GET /api/auth/yo -> datos del usuario de la sesión actual
authRouter.get('/yo', verificarToken, async (req, res) => {
  res.json(await obtenerUsuario(usuarioActual(res).usuarioId));
});

module.exports = { authRouter };