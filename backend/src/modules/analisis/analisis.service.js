const { consultar } = require('../../db/pool');
const { HttpError } = require('../../utils/http-error');

// Cortes de la clasificación sobre el porcentaje acumulado del valor vendido
const CORTE_A = 0.7;
const CORTE_B = 0.9;

// Días que se pueden consultar desde la pantalla
const PERIODOS_VALIDOS = [7, 30, 60, 90];

// Frecuencia de conteo físico sugerida por clase
const POLITICA_CONTEO = {
  A: 'Cada 48 horas',
  B: 'Cada 15 días',
  C: 'Mensual',
};

/**
 * Matriz ABC de una ubicación.
 * - En una tienda se usan sus propias ventas.
 * - En el CEDI se usan las ventas de todas las tiendas, porque el CEDI no vende
 *   pero abastece a toda la red.
 * El valor de cada producto ordena la lista de mayor a menor; un producto es A
 * mientras lo acumulado antes de él no llegue al 70 %, B hasta el 90 %, y C el resto
 * (incluye los productos sin ventas en el período).
 */
async function matrizAbc(ubicacionId, dias) {
  if (!PERIODOS_VALIDOS.includes(dias)) {
    throw new HttpError(400, `El período debe ser uno de: ${PERIODOS_VALIDOS.join(', ')} días.`, 'Período no válido');
  }

  const [ubicacion] = await consultar(
    'SELECT ubicacion_id, codigo, nombre, tipo FROM ubicaciones WHERE ubicacion_id = $1',
    [ubicacionId]
  );
  if (!ubicacion) {
    throw new HttpError(404, 'La ubicación no existe.', 'Ubicación no encontrada');
  }
  const esCedi = ubicacion.tipo === 'CEDI';

  const filas = await consultar(
    `WITH ventas_periodo AS (
        SELECT vd.producto_id,
               SUM(vd.subtotal) AS valor,
               SUM(vd.cantidad) AS unidades
          FROM ventas ve
          JOIN ventas_detalle vd ON vd.venta_id = ve.venta_id
         WHERE ve.estado = 'COMPLETADA'
           AND ve.fecha >= now() - make_interval(days => $2::int)
           AND ($3::boolean OR ve.ubicacion_id = $1)
         GROUP BY vd.producto_id
     ), conteos AS (
        SELECT ad.producto_id, MAX(a.fecha) AS ultimo
          FROM ajustes_inventario a
          JOIN ajustes_detalle ad ON ad.ajuste_id = a.ajuste_id
         WHERE a.ubicacion_id = $1
           AND a.motivo = 'CONTEO_FISICO'
         GROUP BY ad.producto_id
     ), base AS (
        SELECT s.producto_id, s.sku, s.codigo_barras, s.producto, s.departamento, s.categoria,
               s.precio, s.cantidad, s.stock_minimo, s.estado_stock, i.pasillo,
               COALESCE(v.valor, 0)    AS valor,
               COALESCE(v.unidades, 0) AS unidades,
               c.ultimo
          FROM v_stock_actual s
          JOIN inventario i ON i.producto_id = s.producto_id AND i.ubicacion_id = s.ubicacion_id
          LEFT JOIN ventas_periodo v ON v.producto_id = s.producto_id
          LEFT JOIN conteos c ON c.producto_id = s.producto_id
         WHERE s.ubicacion_id = $1
     ), acumulado AS (
        SELECT base.*,
               SUM(valor) OVER () AS total,
               SUM(valor) OVER (ORDER BY valor DESC, sku
                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acum
          FROM base
     )
     SELECT producto_id   AS "productoId",
            sku,
            codigo_barras AS "codigoBarras",
            producto,
            departamento,
            categoria,
            precio,
            cantidad,
            stock_minimo  AS "stockMinimo",
            estado_stock  AS "estadoStock",
            pasillo,
            valor,
            unidades,
            CASE WHEN total = 0 OR valor = 0      THEN 'C'
                 WHEN (acum - valor) / total < $4 THEN 'A'
                 WHEN (acum - valor) / total < $5 THEN 'B'
                 ELSE 'C' END                                AS clase,
            ROUND(100 * valor / NULLIF(total, 0), 2)         AS "pctValor",
            ROUND(100 * acum  / NULLIF(total, 0), 2)         AS "pctAcumulado",
            ROUND(unidades / ($2::numeric / 7), 1)           AS "unidadesSemana",
            ultimo                                           AS "ultimoConteo"
       FROM acumulado
      ORDER BY valor DESC, sku`,
    [ubicacionId, dias, esCedi, CORTE_A, CORTE_B]
  );

  const totalValor = redondear(filas.reduce((suma, f) => suma + f.valor, 0));

  const clases = ['A', 'B', 'C'].map((clase) => {
    const grupo = filas.filter((f) => f.clase === clase);
    const valor = redondear(grupo.reduce((suma, f) => suma + f.valor, 0));
    const conStock = grupo.filter((f) => f.cantidad > 0).length;
    return {
      clase,
      skus: grupo.length,
      pctSkus: porcentaje(grupo.length, filas.length),
      valor,
      pctValor: porcentaje(valor, totalValor),
      enAlerta: grupo.filter((f) => f.estadoStock === 'AGOTADO' || f.estadoStock === 'BAJO').length,
      nivelServicio: porcentaje(conStock, grupo.length),
      politicaConteo: POLITICA_CONTEO[clase],
    };
  });

  return {
    ubicacion: { ubicacionId: ubicacion.ubicacion_id, codigo: ubicacion.codigo, nombre: ubicacion.nombre, tipo: ubicacion.tipo },
    periodo: { dias, desde: new Date(Date.now() - dias * 86_400_000).toISOString(), hasta: new Date().toISOString() },
    alcanceVentas: esCedi ? 'RED' : 'UBICACION',
    calculadoEn: new Date().toISOString(),
    cortes: { a: CORTE_A * 100, b: CORTE_B * 100 },
    totalValor,
    clases,
    productos: filas.map((f) => ({ ...f, politicaConteo: POLITICA_CONTEO[f.clase] })),
  };
}

function redondear(numero) {
  return Math.round(numero * 100) / 100;
}

function porcentaje(parte, total) {
  return total > 0 ? Math.round((1000 * parte) / total) / 10 : 0;
}

module.exports = { matrizAbc, PERIODOS_VALIDOS };