// Modelos con la misma forma que las respuestas de la API (/api/inventario/...)

export type EstadoStock = 'AGOTADO' | 'BAJO' | 'NORMAL' | 'SOBRESTOCK';

/** GET /api/inventario/stock  (vista v_stock_actual) */
export interface StockItem {
  productoId: number;
  sku: string;
  codigoBarras: string;
  producto: string;
  departamento: string;
  categoria: string;
  precio: number;
  ubicacionId: number;
  cantidad: number;
  stockMinimo: number;
  stockMaximo: number | null;
  estadoStock: EstadoStock;
}

/** GET /api/inventario/alertas  (vista v_alertas_reabastecimiento) */
export interface AlertaStock extends StockItem {
  cantidadSugerida: number;
}

/** GET /api/inventario/resumen */
export interface ResumenInventario {
  totalSkus: number;
  unidades: number;
  agotados: number;
  bajoMinimo: number;
  sobrestock: number;
  valorCosto: number;
  valorVenta: number;
}

/** GET /api/inventario/kardex/:sku */
export interface MovimientoKardex {
  movimientoId: number;
  fecha: string;
  tipo: string;
  tipoNombre: string;
  signo: 1 | -1;
  cantidad: number;
  saldoAnterior: number;
  saldoNuevo: number;
  documentoTipo: string;
  documentoId: number | null;
  usuario: string;
  observacion: string | null;
}