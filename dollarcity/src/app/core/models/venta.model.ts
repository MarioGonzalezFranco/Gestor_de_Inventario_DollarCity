// Modelos de /api/ventas

import { EstadoStock } from './inventario.model';

export type MetodoPago = 'EFECTIVO' | 'TARJETA';
export type EstadoVenta = 'COMPLETADA' | 'ANULADA';
export type OrigenVenta = 'EN_LINEA' | 'SIN_CONEXION';

export interface Departamento {
  departamentoId: number;
  nombre: string;
}

/** GET /api/ventas/catalogo y /api/ventas/codigo/:codigo */
export interface ProductoVenta {
  productoId: number;
  sku: string;
  codigoBarras: string | null;
  producto: string;
  departamentoId: number;
  departamento: string;
  precio: number;
  cantidad: number;
  stockMinimo: number;
  stockMaximo: number | null;
  estadoStock: EstadoStock;
  vendidos30?: number;
}

/** Línea del ticket en pantalla (todavía no se envía) */
export interface LineaTicket {
  productoId: number;
  sku: string;
  producto: string;
  precio: number;
  cantidad: number;
  stock: number;
}

/** POST /api/ventas */
export interface NuevaVenta {
  uuid: string;
  metodoPago: MetodoPago;
  efectivoRecibido: number | null;
  lineas: { productoId: number; cantidad: number }[];
}

export interface LineaVenta {
  productoId: number;
  sku: string;
  producto: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  /** Unidades vendidas sin conexión que el sistema no tenía en stock */
  cantidadFaltante?: number;
  /** Precio del catálogo cuando se sincronizó la venta sin conexión */
  precioCatalogo?: number | null;
}

/** Datos de la tienda que se imprimen en el ticket */
export interface TiendaTicket {
  codigo: string;
  nombre: string;
  direccion: string | null;
  municipio: string | null;
  telefono: string | null;
}

export interface Venta {
  ventaId: number;
  numeroTicket: string;
  fecha: string;
  total: number;
  metodoPago: MetodoPago | 'MIXTO';
  estado: EstadoVenta;
  usuarioId: number;
  cajero: string;
  articulos: number;
  motivoAnulacion: string | null;
  anuladaEn: string | null;
  anuladaPor: string | null;
  esDeHoy: boolean;
  origen: OrigenVenta;
  ticketProvisional: string | null;
  sincronizadaEn: string | null;
  autorizadaPor: string | null;
  conFaltante: boolean;
  conDiferenciaPrecio: boolean;
  revisadaEn: string | null;
  revisadaPor: string | null;
  observacionRevision: string | null;
  tienda?: TiendaTicket;
  lineas?: LineaVenta[];
  /** Solo en la caja: venta guardada sin conexión que aún no llega al servidor */
  pendiente?: boolean;
}

export interface VentaRegistrada extends Venta {
  lineas: LineaVenta[];
  efectivoRecibido: number | null;
  cambio: number | null;
  /** true si el servidor ya tenía esa venta (mismo uuid) */
  duplicada?: boolean;
}

/** POST /api/ventas/sincronizar */
export interface VentaSincronizada extends Venta {
  lineas: LineaVenta[];
  duplicada: boolean;
}

/** GET /api/ventas?fecha= */
export interface VentasDelDia {
  fecha: string | null;
  resumen: {
    totalVendido: number;
    tickets: number;
    ticketPromedio: number;
    articulos: number;
    efectivo: number;
    tarjeta: number;
    anuladas: number;
    montoAnulado: number;
    sinConexion: number;
    porRevisar: number;
  };
  ventas: Venta[];
}

// ---------------------------------------------------------------------
// Operación sin conexión
// ---------------------------------------------------------------------

/** GET /api/ventas/catalogo-local: copia del catálogo que la caja guarda */
export interface CatalogoLocal {
  generado: string;
  tienda: TiendaTicket & { ubicacionId: number };
  departamentos: Departamento[];
  productos: ProductoVenta[];
}

/** GET /api/ventas/autorizadores: supervisores con PIN (solo el hash) */
export interface Autorizador {
  usuarioId: number;
  nombre: string;
  pin: string;
}

export type EstadoPendiente = 'PENDIENTE' | 'RECHAZADA';

/** Venta cobrada sin conexión, guardada en el navegador hasta sincronizarla */
export interface VentaPendiente {
  uuid: string;
  ubicacionId: number;
  usuarioId: number;
  cajero: string;
  ticketProvisional: string;
  fechaVenta: string;
  metodoPago: 'EFECTIVO';
  efectivoRecibido: number;
  cambio: number;
  total: number;
  lineas: LineaVenta[];
  autorizadaPor: number | null;
  autorizadaNombre: string | null;
  tienda: TiendaTicket | null;
  estado: EstadoPendiente;
  intentos: number;
  error: string | null;
  creadaEn: number;
}