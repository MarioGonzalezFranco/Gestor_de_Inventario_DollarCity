import { Injectable, effect, inject, signal, untracked } from '@angular/core';

import { Autorizador } from '../models/venta.model';
import { AlmacenLocalService } from './almacen-local.service';
import { AuthService } from './auth.service';
import { ConexionService } from './conexion.service';
import { VentasService } from './ventas.service';

const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60000;
const CLAVE_BLOQUEO = 'dc_caja_pin_bloqueo';
const PATRON_PIN = /^\d{6}$/;

export type ResultadoPin =
  | { ok: true; usuarioId: number; nombre: string }
  | { ok: false; mensaje: string };

interface Bloqueo {
  fallidos: number;
  hasta: number;
}

/**
 * PIN del supervisor para que la caja siga vendiendo sin conexión
 * después de 50 ventas o 2 horas.
 * La caja guarda el hash de cada PIN (nunca el PIN) y lo compara con Web Crypto,
 * con la misma fórmula del backend (PBKDF2-SHA256).
 */
@Injectable({ providedIn: 'root' })
export class AutorizacionService {
  private readonly auth = inject(AuthService);
  private readonly api = inject(VentasService);
  private readonly almacen = inject(AlmacenLocalService);
  private readonly conexion = inject(ConexionService);

  private ubicacionId: number | null = null;
  private lista: Autorizador[] = [];
  readonly hayAutorizadores = signal(false);

  constructor() {
    effect(() => {
      const token = this.auth.token();
      const ubicacion = this.auth.ubicacionActiva();
      const vende = this.auth.tieneRol(['CAJERO', 'SUPERVISOR']);
      untracked(() => {
        const id = token && vende && ubicacion?.tipo === 'TIENDA' ? ubicacion.ubicacionId : null;
        if (id !== this.ubicacionId) void this.cargar(id);
      });
    });
    this.conexion.restablecida$.subscribe(() => void this.actualizar());
  }

  async verificar(pin: string): Promise<ResultadoPin> {
    const bloqueo = leerBloqueo();
    if (bloqueo.hasta > Date.now()) {
      const minutos = Math.ceil((bloqueo.hasta - Date.now()) / 60000);
      return { ok: false, mensaje: `Demasiados intentos. Espera ${minutos} min.` };
    }
    if (!PATRON_PIN.test(pin)) return { ok: false, mensaje: 'El PIN tiene 6 dígitos.' };
    if (!this.lista.length) {
      return { ok: false, mensaje: 'Esta caja no tiene PIN de supervisores. Debe conectarse a la API al menos una vez.' };
    }
    if (!globalThis.crypto?.subtle) {
      return { ok: false, mensaje: 'El navegador no permite verificar el PIN: abre el sistema con https o localhost.' };
    }

    for (const autorizador of this.lista) {
      if (await coincide(pin, autorizador.pin)) {
        guardarBloqueo({ fallidos: 0, hasta: 0 });
        return { ok: true, usuarioId: autorizador.usuarioId, nombre: autorizador.nombre };
      }
    }

    const fallidos = bloqueo.fallidos + 1;
    if (fallidos >= MAX_INTENTOS) {
      guardarBloqueo({ fallidos: 0, hasta: Date.now() + BLOQUEO_MS });
      return { ok: false, mensaje: 'PIN incorrecto. La autorización quedó bloqueada 5 minutos.' };
    }
    guardarBloqueo({ fallidos, hasta: 0 });
    const quedan = MAX_INTENTOS - fallidos;
    return { ok: false, mensaje: `PIN incorrecto. ${quedan === 1 ? 'Queda 1 intento' : `Quedan ${quedan} intentos`}.` };
  }

  private async cargar(id: number | null): Promise<void> {
    this.ubicacionId = id;
    this.aplicar([]);
    if (!id) return;
    const guardados = await this.almacen.leer<Autorizador[]>(clave(id)).catch(() => null);
    if (guardados && this.ubicacionId === id) this.aplicar(guardados);
    await this.actualizar();
  }

  private async actualizar(): Promise<void> {
    const id = this.ubicacionId;
    if (!id) return;
    try {
      const lista = await this.api.autorizadores();
      if (id !== this.ubicacionId) return;
      this.aplicar(lista);
      await this.almacen.guardar(clave(id), lista);
    } catch {
      /* sin conexión: se mantiene la lista guardada */
    }
  }

  private aplicar(lista: Autorizador[]): void {
    this.lista = lista;
    this.hayAutorizadores.set(lista.length > 0);
  }
}

/** Compara el PIN con el formato pbkdf2$iteraciones$sal$hash que genera el backend. */
async function coincide(pin: string, guardado: string): Promise<boolean> {
  const [algoritmo, iteraciones, sal, hash] = guardado.split('$');
  if (algoritmo !== 'pbkdf2' || !iteraciones || !sal || !hash) return false;
  try {
    const esperado = desdeBase64(hash);
    const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: desdeBase64(sal), iterations: Number(iteraciones) },
      clave,
      esperado.length * 8
    );
    const calculado = new Uint8Array(bits);
    // Comparación sin salida temprana
    let diferencia = calculado.length ^ esperado.length;
    for (let i = 0; i < esperado.length; i++) diferencia |= calculado[i] ^ esperado[i];
    return diferencia === 0;
  } catch {
    return false;
  }
}

function desdeBase64(texto: string) {
  const binario = atob(texto);
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function clave(ubicacionId: number): string {
  return `autorizadores:${ubicacionId}`;
}

function leerBloqueo(): Bloqueo {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_BLOQUEO) ?? 'null') as Bloqueo | null;
    return guardado ?? { fallidos: 0, hasta: 0 };
  } catch {
    return { fallidos: 0, hasta: 0 };
  }
}

function guardarBloqueo(bloqueo: Bloqueo): void {
  try {
    localStorage.setItem(CLAVE_BLOQUEO, JSON.stringify(bloqueo));
  } catch {
    /* sin almacenamiento */
  }
}