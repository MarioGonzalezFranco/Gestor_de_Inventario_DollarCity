const { consultar } = require('../../db/pool');

// Columnas de v_stock_actual con los nombres del modelo StockItem de Angular
const COLUMNAS_STOCK = `
  producto_id    AS "productoId",
  sku,
  codigo_barras  AS "codigoBarras",
  producto,
  departamento,
  categoria,
  precio,
  ubicacion_id   AS "ubicacionId",
  cantidad,
  stock_minimo   AS "stockMinimo",
  stock_maximo   AS "stockMaximo",
  estado_stock   AS "estadoStock"`;

/** Stock de una ubicación, con búsqueda opcional por SKU, código de barras o nombre. */
function listarStock(ubicacionId, buscar) {
  const texto = buscar?.trim() ? `%${buscar.trim()}%` : null;
  return consultar(
    `SELECT ${COLUMNAS_STOCK}
       FROM v_stock_actual
      WHERE ubicacion_id = $1
        AND ($2::text IS NULL OR sku ILIKE $2 OR codigo_barras ILIKE $2 OR producto ILIKE $2)
      ORDER BY sku`,
    [ubicacionId, texto]
  );
}

/** Productos agotados o bajo el mínimo, con la cantidad sugerida para reponer. */
function listarAlertas(ubicacionId) {
  return consultar(
    `SELECT ${COLUMNAS_STOCK},
            cantidad_sugerida AS "cantidadSugerida"
       FROM v_alertas_reabastecimiento
      WHERE ubicacion_id = $1
      ORDER BY (estado_stock = 'AGOTADO') DESC, cantidad ASC`,
    [ubicacionId]
  );
}

/** Indicadores para el dashboard de una ubicación. */
async function resumen(ubicacionId) {
  const [fila] = await consultar(
    `SELECT COUNT(*)                                              AS "totalSkus",
            COALESCE(SUM(cantidad), 0)                            AS "unidades",
            COUNT(*) FILTER (WHERE estado_stock = 'AGOTADO')      AS "agotados",
            COUNT(*) FILTER (WHERE estado_stock = 'BAJO')         AS "bajoMinimo",
            COUNT(*) FILTER (WHERE estado_stock = 'SOBRESTOCK')   AS "sobrestock"
       FROM v_stock_actual
      WHERE ubicacion_id = $1`,
    [ubicacionId]
  );
  const [valor] = await consultar(
    `SELECT valor_costo AS "valorCosto", valor_venta AS "valorVenta"
       FROM v_valor_inventario
      WHERE ubicacion_id = $1`,
    [ubicacionId]
  );
  return { ...fila, valorCosto: valor?.valorCosto ?? 0, valorVenta: valor?.valorVenta ?? 0 };
}

/** Últimos movimientos de un producto en una ubicación (kardex). */
function kardex(ubicacionId, sku, limite = 50) {
  return consultar(
    `SELECT m.movimiento_id  AS "movimientoId",
            m.fecha,
            t.codigo         AS tipo,
            t.nombre         AS "tipoNombre",
            t.signo,
            m.cantidad,
            m.saldo_anterior AS "saldoAnterior",
            m.saldo_nuevo    AS "saldoNuevo",
            m.documento_tipo AS "documentoTipo",
            m.documento_id   AS "documentoId",
            u.nombre_usuario AS usuario,
            m.observacion
       FROM movimientos_inventario m
       JOIN productos        p ON p.producto_id        = m.producto_id
       JOIN tipos_movimiento t ON t.tipo_movimiento_id = m.tipo_movimiento_id
       JOIN usuarios         u ON u.usuario_id         = m.usuario_id
      WHERE m.ubicacion_id = $1 AND p.sku = $2
      ORDER BY m.fecha DESC, m.movimiento_id DESC
      LIMIT $3`,
    [ubicacionId, sku.toUpperCase(), limite]
  );
}

module.exports = { listarStock, listarAlertas, resumen, kardex };