// Modelos alineados con las tablas roles, ubicaciones y usuarios de PostgreSQL

export type Rol = 'ADMINISTRADOR' | 'SUPERVISOR' | 'BODEGUERO' | 'CAJERO';

export interface Ubicacion {
  ubicacionId: number;
  codigo: string;          // CEDI-01, TDA-001...
  nombre: string;
  tipo: 'CEDI' | 'TIENDA';
}

export interface Usuario {
  usuarioId: number;
  nombreCompleto: string;
  nombreUsuario: string;
  correo: string;
  rol: Rol;
  ubicacionId: number | null;   // null = administrador con acceso a todas
  activo: boolean;
}

export interface Sesion {
  usuario: Usuario;
  token: string;                // JWT entregado por la API
  ubicaciones: Ubicacion[];     // ubicaciones que el usuario puede ver
  ubicacionActivaId: number;
  inicio: string;               // ISO
}

export type ResultadoLogin =
  | { ok: true }
  | { ok: false; titulo: string; mensaje: string };