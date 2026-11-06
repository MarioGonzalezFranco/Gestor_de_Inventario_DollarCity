// Basado en la vista v_stock_actual
export type EstadoStock = 'AGOTADO' | 'BAJO' | 'NORMAL' | 'SOBRESTOCK';

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