const { Router } = require('express');

const { permitirRoles, ubicacionPermitida, usuarioActual, verificarToken } = require('../../middlewares/auth');
const servicio = require('./ventas.service');

const ventasRouter = Router();

const puedeVender = permitirRoles('CAJERO', 'SUPERVISOR');
const veVentas = permitirRoles('CAJERO', 'SUPERVISOR', 'ADMINISTRADOR');
const soloSupervisor = permitirRoles('SUPERVISOR');

ventasRouter.use(verificarToken);

// ---- Catálogo del punto de venta ----

// GET /api/ventas/departamentos
ventasRouter.get('/departamentos', puedeVender, async (req, res) => {
  res.json(await servicio.listarDepartamentos());
});

// GET /api/ventas/catalogo?departamentoId=7&buscar=agua&limite=24
ventasRouter.get('/catalogo', puedeVender, async (req, res) => {
  const departamentoId = req.query.departamentoId ? Number(req.query.departamentoId) : null;
  const limite = Math.min(Math.max(Number(req.query.limite) || 24, 1), 100);
  const buscar = typeof req.query.buscar === 'string' ? req.query.buscar : undefined;
  res.json(await servicio.listarCatalogo(ubicacionPermitida(req, res), { departamentoId, buscar, limite }));
});

// GET /api/ventas/catalogo-local   (copia completa para trabajar sin conexión)
ventasRouter.get('/catalogo-local', puedeVender, async (req, res) => {
  res.json(await servicio.catalogoLocal(ubicacionPermitida(req, res)));
});

// GET /api/ventas/codigo/7402000000040   (código de barras o SKU exacto)
ventasRouter.get('/codigo/:codigo', puedeVender, async (req, res) => {
  res.json(await servicio.buscarPorCodigo(ubicacionPermitida(req, res), req.params.codigo));
});

// GET /api/ventas/autorizadores   (supervisores con PIN para autorizar la caja sin conexión)
ventasRouter.get('/autorizadores', puedeVender, async (req, res) => {
  res.json(await servicio.listarAutorizadores(ubicacionPermitida(req, res)));
});

// ---- Tickets ----

// POST /api/ventas   { uuid, metodoPago, efectivoRecibido, lineas: [{ productoId, cantidad }] }
ventasRouter.post('/', puedeVender, async (req, res) => {
  const venta = await servicio.registrarVenta(usuarioActual(res), ubicacionPermitida(req, res), req.body);
  res.status(venta.duplicada ? 200 : 201).json(venta);
});

// POST /api/ventas/sincronizar
// { uuid, ticketProvisional, fechaVenta, usuarioId, autorizadaPor, metodoPago,
//   lineas: [{ productoId, cantidad, precioUnitario }] }
ventasRouter.post('/sincronizar', puedeVender, async (req, res) => {
  const venta = await servicio.sincronizarVenta(usuarioActual(res), ubicacionPermitida(req, res), req.body);
  res.status(venta.duplicada ? 200 : 201).json(venta);
});

// GET /api/ventas?fecha=2026-11-09&ubicacionId=2
ventasRouter.get('/', veVentas, async (req, res) => {
  const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : undefined;
  res.json(await servicio.listarVentasDelDia(usuarioActual(res), ubicacionPermitida(req, res), fecha));
});

// GET /api/ventas/por-revisar   (va antes de /:id)
ventasRouter.get('/por-revisar', soloSupervisor, async (req, res) => {
  res.json(await servicio.listarPorRevisar(ubicacionPermitida(req, res)));
});

// GET /api/ventas/123
ventasRouter.get('/:id', veVentas, async (req, res) => {
  res.json(await servicio.obtenerVenta(usuarioActual(res), ubicacionPermitida(req, res), req.params.id));
});

// POST /api/ventas/123/anular   { motivo }
ventasRouter.post('/:id/anular', soloSupervisor, async (req, res) => {
  res.json(await servicio.anularVenta(usuarioActual(res), ubicacionPermitida(req, res), req.params.id, req.body?.motivo));
});

// POST /api/ventas/123/revisar   { observacion }
ventasRouter.post('/:id/revisar', soloSupervisor, async (req, res) => {
  res.json(await servicio.revisarVenta(usuarioActual(res), ubicacionPermitida(req, res), req.params.id, req.body?.observacion));
});

module.exports = { ventasRouter };