// Datos simulados con la misma forma que la base de datos.
// Se reemplazan por llamadas HTTP cuando el backend esté listo.
import { StockItem } from '../models/inventario.model';
import { Ubicacion, Usuario } from '../models/usuario.model';

export const UBICACIONES: Ubicacion[] = [
  { ubicacionId: 1, codigo: 'CEDI-01', nombre: 'Centro de Distribución Central', tipo: 'CEDI' },
  { ubicacionId: 2, codigo: 'TDA-001', nombre: 'Tienda San Salvador Centro',     tipo: 'TIENDA' },
  { ubicacionId: 3, codigo: 'TDA-002', nombre: 'Tienda Santa Ana',               tipo: 'TIENDA' },
  { ubicacionId: 4, codigo: 'TDA-003', nombre: 'Tienda San Miguel',              tipo: 'TIENDA' },
  { ubicacionId: 5, codigo: 'TDA-004', nombre: 'Tienda Soyapango',               tipo: 'TIENDA' }
];

// Solo para el modo simulado. Con backend, la contraseña la valida bcrypt.
export const CLAVE_DEMO = 'Demo123';

export const USUARIOS: Usuario[] = [
  { usuarioId: 1,  nombreCompleto: 'Administrador General', nombreUsuario: 'admin',           correo: 'admin@dollarcity.test',           rol: 'ADMINISTRADOR', ubicacionId: null, activo: true },
  { usuarioId: 2,  nombreCompleto: 'Bodeguero CEDI',        nombreUsuario: 'bodega01',        correo: 'bodega01@dollarcity.test',        rol: 'BODEGUERO',     ubicacionId: 1,    activo: true },
  { usuarioId: 3,  nombreCompleto: 'Supervisor Tienda 001', nombreUsuario: 'super001',        correo: 'super001@dollarcity.test',        rol: 'SUPERVISOR',    ubicacionId: 2,    activo: true },
  { usuarioId: 4,  nombreCompleto: 'Cajero Tienda 001',     nombreUsuario: 'cajero001',       correo: 'cajero001@dollarcity.test',       rol: 'CAJERO',        ubicacionId: 2,    activo: true },
  { usuarioId: 13, nombreCompleto: 'Usuario Inactivo',      nombreUsuario: 'cajero_inactivo', correo: 'cajero_inactivo@dollarcity.test', rol: 'CAJERO',        ubicacionId: 3,    activo: false }
];

export const STOCK: StockItem[] = [
  { productoId: 43, sku: 'DC-0043', codigoBarras: '7402000000043', producto: 'Extensión eléctrica 3 m',  departamento: 'Ferretería', categoria: 'Electricidad',      precio: 5.00, ubicacionId: 2, cantidad: 0,   stockMinimo: 15,  stockMaximo: 120,  estadoStock: 'AGOTADO' },
  { productoId: 31, sku: 'DC-0031', codigoBarras: '7402000000031', producto: 'Muñeca articulada',        departamento: 'Juguetes',   categoria: 'Muñecas y figuras', precio: 5.00, ubicacionId: 2, cantidad: 8,   stockMinimo: 15,  stockMaximo: 120,  estadoStock: 'BAJO' },
  { productoId: 47, sku: 'DC-0047', codigoBarras: '7402000000047', producto: 'Luces navideñas LED x100', departamento: 'Temporada',  categoria: 'Navidad',           precio: 4.00, ubicacionId: 2, cantidad: 200, stockMinimo: 15,  stockMaximo: 120,  estadoStock: 'SOBRESTOCK' },
  { productoId: 21, sku: 'DC-0021', codigoBarras: '7402000000021', producto: 'Taza cerámica 11 oz',      departamento: 'Cocina',     categoria: 'Vasos y tazas',     precio: 2.00, ubicacionId: 2, cantidad: 46,  stockMinimo: 15,  stockMaximo: 120,  estadoStock: 'NORMAL' },
  { productoId: 43, sku: 'DC-0043', codigoBarras: '7402000000043', producto: 'Extensión eléctrica 3 m',  departamento: 'Ferretería', categoria: 'Electricidad',      precio: 5.00, ubicacionId: 3, cantidad: 0,   stockMinimo: 15,  stockMaximo: 120,  estadoStock: 'AGOTADO' },
  { productoId: 31, sku: 'DC-0031', codigoBarras: '7402000000031', producto: 'Muñeca articulada',        departamento: 'Juguetes',   categoria: 'Muñecas y figuras', precio: 5.00, ubicacionId: 3, cantidad: 8,   stockMinimo: 15,  stockMaximo: 120,  estadoStock: 'BAJO' },
  { productoId: 17, sku: 'DC-0017', codigoBarras: '7402000000017', producto: 'Cortina de baño PEVA',     departamento: 'Hogar',      categoria: 'Baño',              precio: 4.00, ubicacionId: 1, cantidad: 0,   stockMinimo: 100, stockMaximo: 1000, estadoStock: 'AGOTADO' },
  { productoId: 43, sku: 'DC-0043', codigoBarras: '7402000000043', producto: 'Extensión eléctrica 3 m',  departamento: 'Ferretería', categoria: 'Electricidad',      precio: 5.00, ubicacionId: 1, cantidad: 40,  stockMinimo: 100, stockMaximo: 1000, estadoStock: 'BAJO' },
  { productoId: 31, sku: 'DC-0031', codigoBarras: '7402000000031', producto: 'Muñeca articulada',        departamento: 'Juguetes',   categoria: 'Muñecas y figuras', precio: 5.00, ubicacionId: 1, cantidad: 60,  stockMinimo: 100, stockMaximo: 1000, estadoStock: 'BAJO' }
];