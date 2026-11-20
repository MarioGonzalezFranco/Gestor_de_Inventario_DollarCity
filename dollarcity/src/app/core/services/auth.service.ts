import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_URL, NOMBRE_ROL } from '../config/constantes';
import { ResultadoLogin, Rol, Sesion, Ubicacion, Usuario } from '../models/usuario.model';

const CLAVE_STORAGE = 'dc_sesion';

// Si la API no responde al iniciar sesión (por ejemplo, porque se está encendiendo),
// se espera a que /api/salud conteste y se reintenta antes de mostrar el error
const INTENTOS_LOGIN = 3;
const ESPERA_API_MS = 10000;
const PAUSA_SALUD_MS = 1000;

/** Respuesta de POST /api/auth/login */
interface RespuestaLogin {
  token: string;
  usuario: Usuario;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly _sesion = signal<Sesion | null>(this.leerSesion());

  // ---- Estado de solo lectura para componentes, guards e interceptor ----
  readonly sesion = this._sesion.asReadonly();
  readonly estaAutenticado = computed(() => this._sesion() !== null);
  readonly token = computed(() => this._sesion()?.token ?? null);
  readonly usuario = computed(() => this._sesion()?.usuario ?? null);
  readonly rol = computed<Rol | null>(() => this._sesion()?.usuario.rol ?? null);
  readonly nombreRol = computed(() => { const r = this.rol(); return r ? NOMBRE_ROL[r] : ''; });
  readonly esAdmin = computed(() => this.rol() === 'ADMINISTRADOR');

  /** Ubicaciones que el usuario puede elegir (vienen de GET /api/ubicaciones). */
  readonly ubicacionesPermitidas = computed<Ubicacion[]>(() => this._sesion()?.ubicaciones ?? []);

  readonly ubicacionActiva = computed<Ubicacion | null>(() => {
    const s = this._sesion();
    return s?.ubicaciones.find(u => u.ubicacionId === s.ubicacionActivaId) ?? null;
  });

  readonly iniciales = computed(() => {
    const nombre = this.usuario()?.nombreCompleto ?? '';
    return nombre.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  });

  /**
   * Inicia sesión contra la API:
   * 1. POST /api/auth/login  -> token y usuario
   * 2. GET  /api/ubicaciones -> ubicaciones permitidas para ese usuario
   * Los intentos fallidos y el bloqueo los controla el backend.
   */
  async login(identificador: string, clave: string, recordar: boolean): Promise<ResultadoLogin> {
    if (!identificador.trim() || !clave) {
      return { ok: false, titulo: 'Faltan datos', mensaje: 'Ingresa tu usuario y tu contraseña.' };
    }

    try {
      const { token, usuario } = await this.enviarLogin(identificador, clave);

      const ubicaciones = await firstValueFrom(
        this.http.get<Ubicacion[]>(`${API_URL}/ubicaciones`, { headers: { Authorization: `Bearer ${token}` } })
      );

      const sesion: Sesion = {
        usuario,
        token,
        ubicaciones,
        ubicacionActivaId: usuario.ubicacionId ?? ubicaciones[0]?.ubicacionId ?? 0,
        inicio: new Date().toISOString()
      };
      this.guardarSesion(sesion, recordar);
      this._sesion.set(sesion);
      return { ok: true };
    } catch (error) {
      return this.traducirError(error);
    }
  }

  /**
   * POST /api/auth/login con reintento solo cuando no hubo respuesta (status 0):
   * la petición no llegó al servidor, así que reintentar no suma intentos fallidos.
   */
  private async enviarLogin(identificador: string, clave: string): Promise<RespuestaLogin> {
    for (let intento = 1; ; intento++) {
      try {
        return await firstValueFrom(
          this.http.post<RespuestaLogin>(`${API_URL}/auth/login`, { usuario: identificador, clave })
        );
      } catch (error) {
        const sinRespuesta = error instanceof HttpErrorResponse && error.status === 0;
        if (!sinRespuesta || intento >= INTENTOS_LOGIN || !(await this.esperarApi())) throw error;
      }
    }
  }

  /** Espera hasta que /api/salud responda (API y base de datos listas). */
  private async esperarApi(): Promise<boolean> {
    const limite = Date.now() + ESPERA_API_MS;
    while (Date.now() < limite) {
      try {
        const respuesta = await fetch(`${API_URL}/salud`, { cache: 'no-store' });
        if (respuesta.ok) return true;
      } catch {
        /* la API todavía no responde */
      }
      await new Promise((resolver) => setTimeout(resolver, PAUSA_SALUD_MS));
    }
    return false;
  }

  logout(): void {
    this.borrarSesion();
    this._sesion.set(null);
  }

  /** Solo el administrador cambia de ubicación; el resto queda fijo en la suya. */
  cambiarUbicacion(ubicacionId: number): void {
    const s = this._sesion();
    if (!s || !s.ubicaciones.some(u => u.ubicacionId === ubicacionId)) return;
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
    return this.rol() === 'CAJERO' ? '/punto-venta' : '/dashboard';
  }

  /** Convierte la respuesta de error de la API en el mensaje que muestra el login. */
  private traducirError(error: unknown): ResultadoLogin {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return { ok: false, titulo: 'Sin conexión', mensaje: 'No se pudo conectar con el servidor. Revisa que la API esté encendida.' };
      }
      const cuerpo = error.error as { titulo?: string; mensaje?: string } | null;
      return { ok: false, titulo: cuerpo?.titulo ?? 'Error', mensaje: cuerpo?.mensaje ?? 'No se pudo iniciar sesión.' };
    }
    return { ok: false, titulo: 'Error', mensaje: 'No se pudo iniciar sesión.' };
  }

  // ---- Persistencia: localStorage si marca "mantener sesión", si no sessionStorage ----
  private leerSesion(): Sesion | null {
    try {
      const raw = localStorage.getItem(CLAVE_STORAGE) ?? sessionStorage.getItem(CLAVE_STORAGE);
      const sesion = raw ? (JSON.parse(raw) as Sesion) : null;
      // Sesiones guardadas por la versión simulada no traen token real ni ubicaciones
      return sesion?.token && Array.isArray(sesion.ubicaciones) ? sesion : null;
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