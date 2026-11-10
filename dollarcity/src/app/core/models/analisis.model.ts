// Modelos de GET /api/analisis/abc

import { EstadoStock } from './inventario.model';

export type ClaseAbc = 'A' | 'B' | 'C';

/** Días que acepta la API para el cálculo. */
export type PeriodoAbc = 7 | 30 | 60 | 90;

export interface ResumenClase {
  clase: ClaseAbc;
  skus: number;
  pctSkus: number;
  valor: number;
  pctValor: number;
  enAlerta: number;
  nivelServicio: number;
  politicaConteo: string;
}

export interface ProductoAbc {
  productoId: number;
  sku: string;
  codigoBarras: string | null;
  producto: string;
  departamento: string;
  categoria: string;
  precio: number;
  cantidad: number;
  stockMinimo: number;
  estadoStock: EstadoStock;
  pasillo: string | null;
  valor: number;
  unidades: number;
  clase: ClaseAbc;
  pctValor: number | null;
  pctAcumulado: number | null;
  unidadesSemana: number;
  ultimoConteo: string | null;
  politicaConteo: string;
}

export interface MatrizAbc {
  ubicacion: { ubicacionId: number; codigo: string; nombre: string; tipo: 'CEDI' | 'TIENDA' };
  periodo: { dias: PeriodoAbc; desde: string; hasta: string };
  /** RED = el CEDI se clasifica con las ventas de todas las tiendas */
  alcanceVentas: 'UBICACION' | 'RED';
  calculadoEn: string;
  cortes: { a: number; b: number };
  totalValor: number;
  clases: ResumenClase[];
  productos: ProductoAbc[];
}