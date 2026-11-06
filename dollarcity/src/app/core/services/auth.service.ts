import { Injectable, computed, signal } from '@angular/core';

import { NOMBRE_ROL } from '../config/constantes';
import { CLAVE_DEMO, UBICACIONES, USUARIOS } from '../data/mock-data';
import { ResultadoLogin, Rol, Sesion, Ubicacion } from '../models/usuario.model';

const CLAVE_STORAGE = 'dc_sesion';
const MAX_INTENTOS = 3;
const MINUTOS_BLOQUEO = 15;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _sesion = signal<Sesion | null>(this.leerSesion());
  private readonly intentos = new Map<string, { fallidos: number; bloqueadoHasta?: number }>();

  // Estado de solo lectura para componentes y guards
  readonly sesion = this._sesion.asReadonly();
  readonly estaAutenticado = computed(() => this._sesion() !== null);
  readonly usuario = computed(() => this._sesion()?.usuario ?? null);
  readonly rol = computed<Rol | null>(() => this._sesion()?.usuario.rol ?? null);
  readonly nombreRol = computed(() => { const r = this.rol(); return r ? NOMBRE_ROL[r] : ''; });
  readonly esAdmin = computed(() => this.rol() === 'ADMINISTRADOR');
  readonly ubicacionActiva = computed<Ubicacion | null>(() => {
    const id = this._sesion()?.ubicacionActivaId;
    return UBICACIONES.find(u => u.ubicacionId === id) ?? null;
  });
  readonly iniciales = computed(() => {
    const nombre = this.usuario()?.nombreCompleto ?? '';
    return nombre.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  });

  /** Ubicaciones que el usuario puede elegir en el menú lateral. */
  readonly ubicacionesPermitidas = computed<Ubicacion[]>(() => {
    const u = this.usuario();
    if (!u) return [];
    return u.ubicacionId === null ? UBICACIONES : UBICACIONES.filter(x => x.ubicacionId === u.ubicacionId);
  });

  /**
   * Modo simulado: valida contra USUARIOS y CLAVE_DEMO.
   * Con backend: reemplazar por POST {API_URL}/auth/login que devuelve { token, usuario }.
   */
  async login(identificador: string, clave: string, recordar: boolean): Promise<ResultadoLogin> {
    await new Promise(r => setTimeout(r, 400)); // simula la latencia de red

    const texto = identificador.trim().toLowerCase();
    if (!texto || !clave) {
      return { ok: false, titulo: 'Faltan datos', mensaje: 'Ingresa tu usuario y tu contraseña.' };
    }

    const clavePorUsuario = texto.includes('@') ? texto.split('@')[0] : texto;
    const registro = this.intentos.get(clavePorUsuario) ?? { fallidos: 0 };

    if (registro.bloqueadoHasta && registro.bloqueadoHasta > Date.now()) {
      const minutos = Math.ceil((registro.bloqueadoHasta - Date.now()) / 60000);
      return { ok: false, titulo: 'Cuenta bloqueada', mensaje: `Superaste los ${MAX_INTENTOS} intentos. Intenta de nuevo en ${minutos} min o contacta al administrador.` };
    }

    const usuario = USUARIOS.find(u => u.nombreUsuario === clavePorUsuario || u.correo === texto);

    if (!usuario || clave !== CLAVE_DEMO) {
      registro.fallidos += 1;
      if (registro.fallidos >= MAX_INTENTOS) {
        registro.bloqueadoHasta = Date.now() + MINUTOS_BLOQUEO * 60000;
        registro.fallidos = 0;
        this.intentos.set(clavePorUsuario, registro);
        return { ok: false, titulo: 'Cuenta bloqueada', mensaje: `La cuenta quedó bloqueada por ${MINUTOS_BLOQUEO} minutos.` };
      }
      this.intentos.set(clavePorUsuario, registro);
      const quedan = MAX_INTENTOS - registro.fallidos;
      return { ok: false, titulo: 'Usuario o contraseña incorrectos', mensaje: `Te ${quedan === 1 ? 'queda 1 intento' : `quedan ${quedan} intentos`}.` };
    }

    if (!usuario.activo) {
      return { ok: false, titulo: 'Usuario inactivo', mensaje: 'Tu cuenta está desactivada. Contacta al administrador.' };
    }

    this.intentos.delete(clavePorUsuario);
    const sesion: Sesion = {
      usuario,
      token: 'token-simulado',
      ubicacionActivaId: usuario.ubicacionId ?? UBICACIONES[0].ubicacionId,
      inicio: new Date().toISOString()
    };
    this.guardarSesion(sesion, recordar);
    this._sesion.set(sesion);
    return { ok: true };
  }

  logout(): void {
    this.borrarSesion();
    this._sesion.set(null);
  }

  /** Solo el administrador cambia de ubicación; el resto queda fijo en la suya. */
  cambiarUbicacion(ubicacionId: number): void {
    const s = this._sesion();
    if (!s || !this.ubicacionesPermitidas().some(u => u.ubicacionId === ubicacionId)) return;
    const nueva = { ...s, ubicacionActivaId: ubicacionId };
    this._sesion.set(nueva);
    this.guardarSesion(nueva, this.estaEnLocalStorage());
  }

  tieneRol(roles: Rol[]): boolean {
    const r = this.rol();
    return r !== null && roles.includes(r);
  }

  /** Pantalla a la que se envía al usuario después de entrar. */
  rutaInicio(): string {
    return this.rol() === 'CAJERO' ? '/inventario' : '/dashboard';
  }

  // localStorage si marca "mantener sesión"; si no, sessionStorage
  private leerSesion(): Sesion | null {
    try {
      const raw = localStorage.getItem(CLAVE_STORAGE) ?? sessionStorage.getItem(CLAVE_STORAGE);
      return raw ? (JSON.parse(raw) as Sesion) : null;
    } catch {
      return null;
    }
  }

  private guardarSesion(sesion: Sesion, recordar: boolean): void {
    try {
      this.borrarSesion();
      (recordar ? localStorage : sessionStorage).setItem(CLAVE_STORAGE, JSON.stringify(sesion));
    } catch {
      /* sin almacenamiento: la sesión vive solo en memoria */
    }
  }

  private borrarSesion(): void {
    try {
      localStorage.removeItem(CLAVE_STORAGE);
      sessionStorage.removeItem(CLAVE_STORAGE);
    } catch { /* sin almacenamiento */ }
  }

  private estaEnLocalStorage(): boolean {
    try { return localStorage.getItem(CLAVE_STORAGE) !== null; } catch { return false; }
  }
}