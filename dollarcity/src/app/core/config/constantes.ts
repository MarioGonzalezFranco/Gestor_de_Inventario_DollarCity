import { Rol } from '../models/usuario.model';

export const APP_NOMBRE = 'Dollarcity';
export const APP_SUBTITULO = 'Inventario Central';

// Mientras no exista el backend se usan datos simulados (core/data/mock-data.ts)
export const USAR_DATOS_SIMULADOS = true;
export const API_URL = 'http://localhost:3000/api';

// Muestra los usuarios de prueba en el login. Poner en false para la entrega final.
export const MOSTRAR_USUARIOS_DEMO = true;

export interface ItemMenu {
  ruta: string;
  etiqueta: string;        // nombre visible en el menú
  descripcion: string;     // línea de ayuda debajo del nombre
  grupo: 'General' | 'Inventario' | 'Análisis';
  icono: 'dashboard' | 'inventario' | 'abc' | 'alertas';
  roles: Rol[];
  conContador?: boolean;   // muestra el número de alertas
}

// Los roles deben coincidir con data.roles de app.routes.ts.
// El orden de esta lista es el orden en que aparecen grupos y opciones.
export const MENU: ItemMenu[] = [
  { ruta: '/dashboard',  etiqueta: 'Resumen general',        descripcion: 'Indicadores del día',   grupo: 'General',    icono: 'dashboard',  roles: ['ADMINISTRADOR', 'SUPERVISOR', 'BODEGUERO'] },
  { ruta: '/inventario', etiqueta: 'Productos y stock',      descripcion: 'Existencias y precios', grupo: 'Inventario', icono: 'inventario', roles: ['ADMINISTRADOR', 'SUPERVISOR', 'BODEGUERO', 'CAJERO'] },
  { ruta: '/alertas',    etiqueta: 'Alertas de stock',       descripcion: 'Por reponer',           grupo: 'Inventario', icono: 'alertas',    roles: ['ADMINISTRADOR', 'SUPERVISOR', 'BODEGUERO'], conContador: true },
  { ruta: '/matriz-abc', etiqueta: 'Prioridad de productos', descripcion: 'Clasificación ABC',     grupo: 'Análisis',   icono: 'abc',        roles: ['ADMINISTRADOR', 'SUPERVISOR'] }
];

export const NOMBRE_ROL: Record<Rol, string> = {
  ADMINISTRADOR: 'Administrador',
  SUPERVISOR: 'Supervisor',
  BODEGUERO: 'Bodeguero',
  CAJERO: 'Cajero'
};