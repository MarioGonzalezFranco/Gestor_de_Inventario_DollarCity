const { consultar, enTransaccion } = require('../../db/pool');
const { HttpError } = require('../../utils/http-error');

const ZONA = 'America/El_Salvador';
const METODOS_PAGO = ['EFECTIVO', 'TARJETA'];
const MAX_LINEAS = 100;
const MAX_CANTIDAD = 999;

// Ventas sin conexión
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATRON_PROVISIONAL = /^[A-Z0-9-]{3,24}$/;
const MAX_DIAS_ATRAS = 30;               // una venta más vieja toma la hora de llegada
const TOLERANCIA_FUTURO_MS = 5 * 60000;  // reloj de la caja adelantado

// Estado del stock calculado igual que en v_stock_actual
const ESTADO_STOCK = `
  CASE WHEN i.cantidad = 0 THEN 'AGOTADO'
       WHEN i.cantidad <= i.stock_minimo THEN 'BAJO'
       WHEN i.cantidad > i.stock_maximo THEN 'SOBRESTOCK'
       ELSE 'NORMAL' END`;

const COLUMNAS_PRODUCTO = `
  p.producto_id      AS "productoId",
  p.sku,
  p.codigo_barras    AS "codigoBarras",
  p.nombre           AS producto,
  d.departamento_id  AS "departamentoId",
  d.nombre           AS departamento,
  pp.precio,
  i.cantidad,
  i.stock_minimo     AS "stockMinimo",
  i.stock_maximo     AS "stockMaximo",
  ${ESTADO_STOCK}    AS "estadoStock"`;

const FROM_PRODUCTO = `
  FROM productos p
  JOIN categorias c     ON c.categoria_id = p.categoria_id
  JOIN departamentos d  ON d.departamento_id = c.departamento_id
  JOIN puntos_precio pp ON pp.punto_precio_id = p.punto_precio_id
  JOIN inventario i     ON i.producto_id = p.producto_id AND i.ubicacion_id = $1`;

// Unidades vendidas por producto en los últimos 30 días (orden del catálogo)
const VENDIDOS_30 = `
  LEFT JOIN (
       SELECT vd.producto_id, SUM(vd.cantidad) AS unidades
         FROM ventas ve
         JOIN ventas_detalle vd ON vd.venta_id = ve.venta_id
        WHERE ve.ubicacion_id = $1 AND ve.estado = 'COMPLETADA'
          AND ve.fecha >= now() - interval '30 days'
        GROUP BY vd.producto_id
  ) v ON v.producto_id = p.producto_id`;

// ---------------------------------------------------------------------
// Catálogo del punto de venta
// ---------------------------------------------------------------------

function listarDepartamentos() {
  return consultar(
    `SELECT departamento_id AS "departamentoId", nombre
       FROM departamentos
      WHERE activo
      ORDER BY nombre`
  );
}

/** Productos de la tienda ordenados por lo más vendido en 30 días; filtro opcional. */
function listarCatalogo(ubicacionId, { departamentoId, buscar, limite }) {
  const texto = buscar?.trim() ? `%${buscar.trim()}%` : null;
  return consultar(
    `SELECT ${COLUMNAS_PRODUCTO},
            COALESCE(v.unidades, 0) AS "vendidos30"
       ${FROM_PRODUCTO}
       ${VENDIDOS_30}
      WHERE p.activo
        AND ($2::int IS NULL OR d.departamento_id = $2)
        AND ($3::text IS NULL OR p.sku ILIKE $3 OR p.codigo_barras ILIKE $3 OR p.nombre ILIKE $3)
      ORDER BY COALESCE(v.unidades, 0) DESC, p.nombre
      LIMIT $4`,
    [ubicacionId, departamentoId ?? null, texto, limite]
  );
}

/** Búsqueda exacta por código de barras o SKU (lector de código de barras). */
async function buscarPorCodigo(ubicacionId, codigo) {
  const [producto] = await consultar(
    `SELECT ${COLUMNAS_PRODUCTO}
       ${FROM_PRODUCTO}
      WHERE p.activo
        AND (p.codigo_barras = $2 OR upper(p.sku) = upper($2))
      LIMIT 1`,
    [ubicacionId, codigo.trim()]
  );
  if (!producto) {
    throw new HttpError(404, `No hay ningún producto con el código ${codigo}.`, 'Código no encontrado');
  }
  return producto;
}

/**
 * Copia completa del catálogo de la tienda para la caja.
 * La caja la guarda en el navegador y la usa cuando la API no responde.
 */
async function catalogoLocal(ubicacionId) {
  const [tienda] = await consultar(
    `SELECT ubicacion_id AS "ubicacionId", codigo, nombre, direccion, municipio, telefono, tipo
       FROM ubicaciones
      WHERE ubicacion_id = $1 AND activa`,
    [ubicacionId]
  );
  if (!tienda || tienda.tipo !== 'TIENDA') {
    throw new HttpError(400, 'Solo las tiendas tienen punto de venta.', 'Ubicación no válida');
  }

  const [departamentos, productos, [{ generado }]] = await Promise.all([
    listarDepartamentos(),
    consultar(
      `SELECT ${COLUMNAS_PRODUCTO},
              COALESCE(v.unidades, 0) AS "vendidos30"
         ${FROM_PRODUCTO}
         ${VENDIDOS_30}
        WHERE p.activo
        ORDER BY COALESCE(v.unidades, 0) DESC, p.nombre`,
      [ubicacionId]
    ),
    consultar('SELECT now() AS generado'),
  ]);

  const { tipo, ...datosTienda } = tienda;
  return { generado, tienda: datosTienda, departamentos, productos };
}

/**
 * Supervisores de la tienda con PIN asignado.
 * La caja verifica el PIN sin conexión, por eso recibe el hash (nunca el PIN).
 */
function listarAutorizadores(ubicacionId) {
  return consultar(
    `SELECT u.usuario_id       AS "usuarioId",
            u.nombre_completo  AS nombre,
            u.pin_autorizacion AS pin
       FROM usuarios u
       JOIN roles r ON r.rol_id = u.rol_id
      WHERE r.nombre = 'SUPERVISOR'
        AND u.activo
        AND u.ubicacion_id = $1
        AND u.pin_autorizacion IS NOT NULL
      ORDER BY u.nombre_completo`,
    [ubicacionId]
  );
}

// ---------------------------------------------------------------------
// Registro de una venta en línea
// ---------------------------------------------------------------------

/**
 * Registra el ticket completo en una sola transacción.
 * El precio sale de la base de datos, nunca del navegador.
 * Los triggers descuentan el stock y escriben el kardex.
 * Si la venta trae un uuid ya registrado, devuelve la existente (no la duplica).
 */
async function registrarVenta(usuario, ubicacionId, datos) {
  const metodoPago = String(datos?.metodoPago ?? '').toUpperCase();
  if (!METODOS_PAGO.includes(metodoPago)) {
    throw new HttpError(400, 'Selecciona efectivo o tarjeta.', 'Método de pago no válido');
  }

  const uuid = leerUuid(datos?.uuid, false);
  const lineas = agruparLineas(datos?.lineas);
  const efectivoRecibido = datos?.efectivoRecibido == null ? null : Number(datos.efectivoRecibido);
  if (efectivoRecibido !== null && (!Number.isFinite(efectivoRecibido) || efectivoRecibido < 0)) {
    throw new HttpError(400, 'El efectivo recibido no es válido.', 'Datos inválidos');
  }

  const resultado = await enTransaccion(usuario.usuarioId, async (cliente) => {
    // Un solo cobro a la vez por tienda mientras se asigna el número de ticket
    await cliente.query('SELECT pg_advisory_xact_lock(1001, $1)', [ubicacionId]);

    if (uuid) {
      const existente = await buscarPorUuid(cliente, uuid, ubicacionId);
      if (existente) return { ventaId: existente, duplicada: true };
    }

    const tienda = await siguienteTicket(cliente, ubicacionId);

    // Bloquea las filas de inventario de los productos del ticket
    const ids = lineas.map((l) => l.productoId);
    const { rows: productos } = await cliente.query(
      `SELECT p.producto_id, p.nombre, p.activo, pp.precio, i.cantidad
         FROM productos p
         JOIN puntos_precio pp ON pp.punto_precio_id = p.punto_precio_id
         JOIN inventario i     ON i.producto_id = p.producto_id AND i.ubicacion_id = $2
        WHERE p.producto_id = ANY ($1::int[])
        ORDER BY p.producto_id
          FOR UPDATE OF i`,
      [ids, ubicacionId]
    );
    validarStock(lineas, productos);

    const total = lineas.reduce((suma, l) => {
      const p = productos.find((x) => x.producto_id === l.productoId);
      return suma + Number(p.precio) * l.cantidad;
    }, 0);
    if (metodoPago === 'EFECTIVO' && efectivoRecibido !== null && efectivoRecibido + 0.001 < total) {
      throw new HttpError(400, `El efectivo recibido no cubre el total de $${total.toFixed(2)}.`, 'Pago incompleto');
    }

    const { rows: [nueva] } = await cliente.query(
      `INSERT INTO ventas (numero_ticket, ubicacion_id, usuario_id, metodo_pago, uuid_venta)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING venta_id`,
      [tienda.numeroTicket, ubicacionId, usuario.usuarioId, metodoPago, uuid]
    );

    await cliente.query(
      `INSERT INTO ventas_detalle (venta_id, producto_id, cantidad, precio_unitario)
       SELECT $1, x.producto_id, x.cantidad, pp.precio
         FROM unnest($2::int[], $3::int[]) AS x (producto_id, cantidad)
         JOIN productos p      ON p.producto_id = x.producto_id
         JOIN puntos_precio pp ON pp.punto_precio_id = p.punto_precio_id`,
      [nueva.venta_id, ids, lineas.map((l) => l.cantidad)]
    );

    return { ventaId: nueva.venta_id, duplicada: false };
  });

  const registrada = await leerVenta(resultado.ventaId, ubicacionId);
  const cambio = metodoPago === 'EFECTIVO' && efectivoRecibido !== null
    ? redondear(efectivoRecibido - registrada.total)
    : null;
  return { ...registrada, efectivoRecibido, cambio, duplicada: resultado.duplicada };
}

// ---------------------------------------------------------------------
// Sincronización de una venta hecha sin conexión
// ---------------------------------------------------------------------

/**
 * Graba una venta que la caja cobró sin conexión. Reglas acordadas:
 * - Solo efectivo.
 * - Se respeta el precio cobrado en caja; si difiere del catálogo, la venta
 *   queda marcada para revisión y se guarda el precio del catálogo.
 * - Si no hay stock suficiente, la diferencia entra como ajuste FALTANTE_VENTA
 *   y la venta queda marcada como "venta con faltante" para el supervisor.
 * - El uuid evita grabarla dos veces si la caja la reenvía.
 */
async function sincronizarVenta(usuario, ubicacionId, datos) {
  const uuid = leerUuid(datos?.uuid, true);

  const metodoPago = String(datos?.metodoPago ?? '').toUpperCase();
  if (metodoPago !== 'EFECTIVO') {
    throw new HttpError(400, 'Sin conexión solo se aceptan ventas en efectivo.', 'Método de pago no válido');
  }

  const ticketProvisional = String(datos?.ticketProvisional ?? '').trim().toUpperCase();
  if (!PATRON_PROVISIONAL.test(ticketProvisional)) {
    throw new HttpError(400, 'El número de ticket provisional no es válido.', 'Datos inválidos');
  }

  const lineas = agruparLineasConPrecio(datos?.lineas);
  const fechaVenta = leerFechaCaja(datos?.fechaVenta);
  const cajeroId = enteroPositivo(datos?.usuarioId);
  const autorizadorId = enteroPositivo(datos?.autorizadaPor);

  const resultado = await enTransaccion(usuario.usuarioId, async (cliente) => {
    await cliente.query('SELECT pg_advisory_xact_lock(1001, $1)', [ubicacionId]);

    const existente = await buscarPorUuid(cliente, uuid, ubicacionId);
    if (existente) return { ventaId: existente, duplicada: true };

    const tienda = await siguienteTicket(cliente, ubicacionId);

    // Cajero que hizo la venta: debe ser de esta tienda; si no, queda quien sincroniza
    const { rows: personas } = await cliente.query(
      `SELECT u.usuario_id, r.nombre AS rol
         FROM usuarios u
         JOIN roles r ON r.rol_id = u.rol_id
        WHERE u.usuario_id = ANY ($1::int[]) AND u.ubicacion_id = $2`,
      [[cajeroId, autorizadorId].filter(Boolean), ubicacionId]
    );
    const vendedor = personas.find((p) => p.usuario_id === cajeroId && ['CAJERO', 'SUPERVISOR'].includes(p.rol));
    const autorizador = personas.find((p) => p.usuario_id === autorizadorId && p.rol === 'SUPERVISOR');
    const usuarioVenta = vendedor ? vendedor.usuario_id : usuario.usuarioId;

    // El precio cobrado debe ser uno de los puntos de precio de la empresa
    const { rows: puntos } = await cliente.query('SELECT precio FROM puntos_precio');
    const preciosValidos = new Set(puntos.map((p) => centavos(p.precio)));
    const invalidos = lineas.filter((l) => !preciosValidos.has(centavos(l.precioUnitario)));
    if (invalidos.length) {
      throw new HttpError(
        400,
        `Precio no reconocido en los productos ${invalidos.map((l) => l.productoId).join(', ')}.`,
        'Precio no válido'
      );
    }

    // Garantiza la fila de inventario y la bloquea
    const ids = lineas.map((l) => l.productoId);
    await cliente.query(
      `INSERT INTO inventario (producto_id, ubicacion_id, cantidad)
       SELECT p.producto_id, $2, 0
         FROM productos p
        WHERE p.producto_id = ANY ($1::int[])
       ON CONFLICT (producto_id, ubicacion_id) DO NOTHING`,
      [ids, ubicacionId]
    );
    const { rows: productos } = await cliente.query(
      `SELECT p.producto_id, pp.precio, i.cantidad
         FROM productos p
         JOIN puntos_precio pp ON pp.punto_precio_id = p.punto_precio_id
         JOIN inventario i     ON i.producto_id = p.producto_id AND i.ubicacion_id = $2
        WHERE p.producto_id = ANY ($1::int[])
        ORDER BY p.producto_id
          FOR UPDATE OF i`,
      [ids, ubicacionId]
    );
    const faltan = ids.filter((id) => !productos.some((p) => p.producto_id === id));
    if (faltan.length) {
      throw new HttpError(400, `No existen los productos ${faltan.join(', ')}.`, 'Producto no válido');
    }

    const detalle = lineas.map((l) => {
      const p = productos.find((x) => x.producto_id === l.productoId);
      return {
        ...l,
        precioCatalogo: Number(p.precio),
        faltante: Math.max(0, l.cantidad - p.cantidad),
      };
    });
    const conFaltante = detalle.some((d) => d.faltante > 0);
    const conDiferencia = detalle.some((d) => centavos(d.precioUnitario) !== centavos(d.precioCatalogo));

    const { rows: [nueva] } = await cliente.query(
      `INSERT INTO ventas (numero_ticket, ubicacion_id, usuario_id, metodo_pago, fecha,
                           uuid_venta, origen, ticket_provisional, sincronizada_en, sincronizada_por,
                           autorizada_por, con_faltante, con_diferencia_precio)
       VALUES ($1, $2, $3, 'EFECTIVO', COALESCE($4::timestamptz, now()),
               $5, 'SIN_CONEXION', $6, now(), $7, $8, $9, $10)
       RETURNING venta_id`,
      [tienda.numeroTicket, ubicacionId, usuarioVenta, fechaVenta, uuid, ticketProvisional,
      usuario.usuarioId, autorizador ? autorizador.usuario_id : null, conFaltante, conDiferencia]
    );

    // Entrada por las unidades que el sistema no tenía, antes de la salida de la venta
    if (conFaltante) {
      const { rows: [ajuste] } = await cliente.query(
        `INSERT INTO ajustes_inventario (ubicacion_id, usuario_id, motivo, venta_id, observacion)
         VALUES ($1, $2, 'FALTANTE_VENTA', $3, $4)
         RETURNING ajuste_id`,
        [ubicacionId, usuario.usuarioId, nueva.venta_id, `Faltante de la venta sin conexión ${ticketProvisional}`]
      );
      const conDiferenciaStock = detalle.filter((d) => d.faltante > 0);
      await cliente.query(
        `INSERT INTO ajustes_detalle (ajuste_id, producto_id, direccion, cantidad)
         SELECT $1, x.producto_id, 'ENTRADA', x.cantidad
           FROM unnest($2::int[], $3::int[]) AS x (producto_id, cantidad)`,
        [ajuste.ajuste_id, conDiferenciaStock.map((d) => d.productoId), conDiferenciaStock.map((d) => d.faltante)]
      );
    }

    await cliente.query(
      `INSERT INTO ventas_detalle (venta_id, producto_id, cantidad, precio_unitario, cantidad_faltante, precio_catalogo)
       SELECT $1, x.producto_id, x.cantidad, x.precio, x.faltante, x.catalogo
         FROM unnest($2::int[], $3::int[], $4::numeric[], $5::int[], $6::numeric[])
              AS x (producto_id, cantidad, precio, faltante, catalogo)`,
      [
        nueva.venta_id,
        detalle.map((d) => d.productoId),
        detalle.map((d) => d.cantidad),
        detalle.map((d) => d.precioUnitario),
        detalle.map((d) => d.faltante),
        detalle.map((d) => d.precioCatalogo),
      ]
    );

    return { ventaId: nueva.venta_id, duplicada: false };
  });

  const venta = await leerVenta(resultado.ventaId, ubicacionId);
  return { ...venta, duplicada: resultado.duplicada };
}

// ---------------------------------------------------------------------
// Validaciones compartidas
// ---------------------------------------------------------------------

/** Une líneas repetidas del mismo producto y valida cantidades. */
function agruparLineas(lineas) {
  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw new HttpError(400, 'El ticket no tiene productos.', 'Ticket vacío');
  }
  const porProducto = new Map();
  for (const linea of lineas) {
    const productoId = Number(linea?.productoId);
    const cantidad = Number(linea?.cantidad);
    if (!Number.isInteger(productoId) || productoId <= 0 || !Number.isInteger(cantidad) || cantidad <= 0) {
      throw new HttpError(400, 'Cada línea necesita un producto y una cantidad entera mayor a cero.', 'Datos inválidos');
    }
    porProducto.set(productoId, (porProducto.get(productoId) ?? 0) + cantidad);
  }
  if (porProducto.size > MAX_LINEAS) {
    throw new HttpError(400, `Un ticket admite hasta ${MAX_LINEAS} productos distintos.`, 'Ticket muy grande');
  }
  return [...porProducto].map(([productoId, cantidad]) => {
    if (cantidad > MAX_CANTIDAD) {
      throw new HttpError(400, `La cantidad máxima por producto es ${MAX_CANTIDAD}.`, 'Cantidad no válida');
    }
    return { productoId, cantidad };
  });
}

/** Igual que agruparLineas, pero cada línea trae el precio cobrado en caja. */
function agruparLineasConPrecio(lineas) {
  const agrupadas = agruparLineas(lineas);
  const precios = new Map();
  for (const linea of lineas) {
    const productoId = Number(linea.productoId);
    const precio = Number(linea?.precioUnitario);
    if (!Number.isFinite(precio) || precio < 0 || precio > 9999.99) {
      throw new HttpError(400, `El precio del producto ${productoId} no es válido.`, 'Datos inválidos');
    }
    const anterior = precios.get(productoId);
    if (anterior !== undefined && centavos(anterior) !== centavos(precio)) {
      throw new HttpError(400, `El producto ${productoId} aparece con dos precios distintos.`, 'Datos inválidos');
    }
    precios.set(productoId, redondear(precio));
  }
  return agrupadas.map((l) => ({ ...l, precioUnitario: precios.get(l.productoId) }));
}

function validarStock(lineas, productos) {
  const problemas = [];
  for (const linea of lineas) {
    const p = productos.find((x) => x.producto_id === linea.productoId);
    if (!p || !p.activo) {
      problemas.push(`El producto ${linea.productoId} no está disponible en esta tienda`);
    } else if (p.cantidad < linea.cantidad) {
      problemas.push(`${p.nombre}: hay ${p.cantidad}, se pidieron ${linea.cantidad}`);
    }
  }
  if (problemas.length) {
    throw new HttpError(409, problemas.join('. ') + '.', 'Stock insuficiente');
  }
}

function leerUuid(valor, obligatorio) {
  if (valor == null || valor === '') {
    if (obligatorio) throw new HttpError(400, 'La venta no trae su identificador único.', 'Datos inválidos');
    return null;
  }
  const texto = String(valor).trim().toLowerCase();
  if (!PATRON_UUID.test(texto)) {
    throw new HttpError(400, 'El identificador único de la venta no es válido.', 'Datos inválidos');
  }
  return texto;
}

/** Hora real de la venta en la caja. Si no es creíble, se usa la hora de llegada. */
function leerFechaCaja(valor) {
  const fecha = new Date(valor ?? '');
  const ms = fecha.getTime();
  if (!Number.isFinite(ms)) return null;
  const ahora = Date.now();
  if (ms > ahora + TOLERANCIA_FUTURO_MS || ms < ahora - MAX_DIAS_ATRAS * 86400000) return null;
  return fecha.toISOString();
}

function enteroPositivo(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

async function buscarPorUuid(cliente, uuid, ubicacionId) {
  const { rows: [fila] } = await cliente.query(
    'SELECT venta_id, ubicacion_id FROM ventas WHERE uuid_venta = $1',
    [uuid]
  );
  if (!fila) return null;
  if (fila.ubicacion_id !== ubicacionId) {
    throw new HttpError(409, 'Esa venta ya está registrada en otra tienda.', 'Venta duplicada');
  }
  return fila.venta_id;
}

/** Número de ticket definitivo: CODIGO-000123. Requiere el candado de la tienda. */
async function siguienteTicket(cliente, ubicacionId) {
  const { rows: [tienda] } = await cliente.query(
    `SELECT u.codigo, u.tipo,
            COALESCE(MAX(substring(v.numero_ticket FROM '\\d+$')::int), 0) + 1 AS siguiente
       FROM ubicaciones u
       LEFT JOIN ventas v ON v.ubicacion_id = u.ubicacion_id
      WHERE u.ubicacion_id = $1 AND u.activa
      GROUP BY u.codigo, u.tipo`,
    [ubicacionId]
  );
  if (!tienda || tienda.tipo !== 'TIENDA') {
    throw new HttpError(400, 'Solo las tiendas registran ventas.', 'Ubicación no válida');
  }
  return { numeroTicket: `${tienda.codigo}-${String(tienda.siguiente).padStart(6, '0')}` };
}

// ---------------------------------------------------------------------
// Consulta, revisión y anulación
// ---------------------------------------------------------------------

const COLUMNAS_VENTA = `
  v.venta_id               AS "ventaId",
  v.numero_ticket          AS "numeroTicket",
  v.fecha,
  v.total,
  v.metodo_pago            AS "metodoPago",
  v.estado,
  v.usuario_id             AS "usuarioId",
  u.nombre_completo        AS cajero,
  (SELECT COALESCE(SUM(d.cantidad), 0) FROM ventas_detalle d WHERE d.venta_id = v.venta_id) AS articulos,
  v.motivo_anulacion       AS "motivoAnulacion",
  v.anulada_en             AS "anuladaEn",
  ua.nombre_completo       AS "anuladaPor",
  (v.fecha AT TIME ZONE '${ZONA}')::date = (now() AT TIME ZONE '${ZONA}')::date AS "esDeHoy",
  v.origen,
  v.ticket_provisional     AS "ticketProvisional",
  v.sincronizada_en        AS "sincronizadaEn",
  uz.nombre_completo       AS "autorizadaPor",
  v.con_faltante           AS "conFaltante",
  v.con_diferencia_precio  AS "conDiferenciaPrecio",
  v.revisada_en            AS "revisadaEn",
  ur.nombre_completo       AS "revisadaPor",
  v.observacion_revision   AS "observacionRevision",
  json_build_object(
    'codigo',    ub.codigo,
    'nombre',    ub.nombre,
    'direccion', ub.direccion,
    'municipio', ub.municipio,
    'telefono',  ub.telefono
  )                        AS tienda`;

const FROM_VENTA = `
  FROM ventas v
  JOIN ubicaciones ub   ON ub.ubicacion_id = v.ubicacion_id
  JOIN usuarios u       ON u.usuario_id = v.usuario_id
  LEFT JOIN usuarios ua ON ua.usuario_id = v.anulada_por
  LEFT JOIN usuarios uz ON uz.usuario_id = v.autorizada_por
  LEFT JOIN usuarios ur ON ur.usuario_id = v.revisada_por`;

const POR_REVISAR = `(v.con_faltante OR v.con_diferencia_precio) AND v.revisada_en IS NULL`;

/** Tickets de un día. El cajero solo ve los suyos. */
async function listarVentasDelDia(usuario, ubicacionId, fecha) {
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new HttpError(400, 'La fecha debe tener el formato AAAA-MM-DD.', 'Fecha no válida');
  }
  const soloCajero = usuario.rol === 'CAJERO' ? usuario.usuarioId : null;

  const ventas = await consultar(
    `SELECT ${COLUMNAS_VENTA}
       ${FROM_VENTA}
      WHERE v.ubicacion_id = $1
        AND (v.fecha AT TIME ZONE '${ZONA}')::date = COALESCE($2::date, (now() AT TIME ZONE '${ZONA}')::date)
        AND ($3::int IS NULL OR v.usuario_id = $3)
      ORDER BY v.fecha DESC`,
    [ubicacionId, fecha || null, soloCajero]
  );

  // Pendientes de revisión de cualquier fecha (el cajero no revisa)
  const [{ porRevisar }] = soloCajero
    ? [{ porRevisar: 0 }]
    : await consultar(
      `SELECT count(*)::int AS "porRevisar" FROM ventas v WHERE v.ubicacion_id = $1 AND ${POR_REVISAR}`,
      [ubicacionId]
    );

  const completadas = ventas.filter((v) => v.estado === 'COMPLETADA');
  const sumar = (lista) => redondear(lista.reduce((s, v) => s + v.total, 0));
  const totalVendido = sumar(completadas);

  return {
    fecha: fecha || null,
    resumen: {
      totalVendido,
      tickets: completadas.length,
      ticketPromedio: completadas.length ? redondear(totalVendido / completadas.length) : 0,
      articulos: completadas.reduce((s, v) => s + v.articulos, 0),
      efectivo: sumar(completadas.filter((v) => v.metodoPago === 'EFECTIVO')),
      tarjeta: sumar(completadas.filter((v) => v.metodoPago !== 'EFECTIVO')),
      anuladas: ventas.length - completadas.length,
      montoAnulado: sumar(ventas.filter((v) => v.estado === 'ANULADA')),
      sinConexion: ventas.filter((v) => v.origen === 'SIN_CONEXION').length,
      porRevisar,
    },
    ventas,
  };
}

/** Ventas sin conexión con faltante o diferencia de precio que el supervisor no ha revisado. */
function listarPorRevisar(ubicacionId) {
  return consultar(
    `SELECT ${COLUMNAS_VENTA}
       ${FROM_VENTA}
      WHERE v.ubicacion_id = $1 AND ${POR_REVISAR}
      ORDER BY v.fecha DESC
      LIMIT 200`,
    [ubicacionId]
  );
}

/** Ticket con sus líneas. Valida que sea de la ubicación y, para el cajero, que sea suyo. */
async function obtenerVenta(usuario, ubicacionId, ventaId) {
  const venta = await leerVenta(ventaId, ubicacionId);
  if (usuario.rol === 'CAJERO' && venta.usuarioId !== usuario.usuarioId) {
    throw new HttpError(404, 'El ticket no existe en esta tienda.', 'Ticket no encontrado');
  }
  return venta;
}

/** Ticket con sus líneas, sin filtro por cajero (uso interno). */
async function leerVenta(ventaId, ubicacionId) {
  const id = Number(ventaId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, 'El número de venta no es válido.', 'Datos inválidos');
  }

  const [venta] = await consultar(
    `SELECT ${COLUMNAS_VENTA}
       ${FROM_VENTA}
      WHERE v.venta_id = $1 AND v.ubicacion_id = $2`,
    [id, ubicacionId]
  );
  if (!venta) {
    throw new HttpError(404, 'El ticket no existe en esta tienda.', 'Ticket no encontrado');
  }

  venta.lineas = await consultar(
    `SELECT d.producto_id       AS "productoId",
            p.sku,
            p.nombre            AS producto,
            d.cantidad,
            d.precio_unitario   AS "precioUnitario",
            d.subtotal,
            d.cantidad_faltante AS "cantidadFaltante",
            d.precio_catalogo   AS "precioCatalogo"
       FROM ventas_detalle d
       JOIN productos p ON p.producto_id = d.producto_id
      WHERE d.venta_id = $1
      ORDER BY d.detalle_id`,
    [id]
  );
  return venta;
}

/** El supervisor confirma que revisó el faltante o la diferencia de precio. */
async function revisarVenta(usuario, ubicacionId, ventaId, observacion) {
  const texto = String(observacion ?? '').trim();
  if (texto.length < 5 || texto.length > 200) {
    throw new HttpError(400, 'Escribe la observación de la revisión (entre 5 y 200 caracteres).', 'Falta la observación');
  }

  const venta = await leerVenta(ventaId, ubicacionId);
  if (!venta.conFaltante && !venta.conDiferenciaPrecio) {
    throw new HttpError(400, `El ticket ${venta.numeroTicket} no tiene nada que revisar.`, 'Sin revisión');
  }
  if (venta.revisadaEn) {
    throw new HttpError(409, `El ticket ${venta.numeroTicket} ya fue revisado por ${venta.revisadaPor}.`, 'Ticket revisado');
  }

  const actualizadas = await enTransaccion(usuario.usuarioId, async (cliente) => {
    const { rows } = await cliente.query(
      `UPDATE ventas
          SET revisada_por = $2, revisada_en = now(), observacion_revision = $3
        WHERE venta_id = $1 AND revisada_en IS NULL
        RETURNING venta_id`,
      [venta.ventaId, usuario.usuarioId, texto]
    );
    return rows.length;
  });
  if (actualizadas === 0) {
    throw new HttpError(409, `Otro supervisor acaba de revisar el ticket ${venta.numeroTicket}.`, 'Ticket revisado');
  }

  return leerVenta(venta.ventaId, ubicacionId);
}

/** Solo el supervisor, solo tickets del día y con motivo. El trigger devuelve el stock. */
async function anularVenta(usuario, ubicacionId, ventaId, motivo) {
  const texto = String(motivo ?? '').trim();
  if (texto.length < 5 || texto.length > 200) {
    throw new HttpError(400, 'Escribe el motivo de la anulación (entre 5 y 200 caracteres).', 'Falta el motivo');
  }

  const venta = await obtenerVenta(usuario, ubicacionId, ventaId);
  if (venta.estado === 'ANULADA') {
    throw new HttpError(409, `El ticket ${venta.numeroTicket} ya estaba anulado.`, 'Ticket anulado');
  }
  if (!venta.esDeHoy) {
    throw new HttpError(400, 'Solo se pueden anular tickets del día.', 'Fuera de plazo');
  }

  await enTransaccion(usuario.usuarioId, (cliente) =>
    cliente.query(
      `UPDATE ventas
          SET estado = 'ANULADA', anulada_por = $2, anulada_en = now(), motivo_anulacion = $3
        WHERE venta_id = $1 AND estado = 'COMPLETADA'`,
      [venta.ventaId, usuario.usuarioId, texto]
    )
  );

  return obtenerVenta(usuario, ubicacionId, venta.ventaId);
}

function redondear(numero) {
  return Math.round(numero * 100) / 100;
}

function centavos(numero) {
  return Math.round(Number(numero) * 100);
}

module.exports = {
  listarDepartamentos,
  listarCatalogo,
  buscarPorCodigo,
  catalogoLocal,
  listarAutorizadores,
  registrarVenta,
  sincronizarVenta,
  listarVentasDelDia,
  listarPorRevisar,
  obtenerVenta,
  revisarVenta,
  anularVenta,
};