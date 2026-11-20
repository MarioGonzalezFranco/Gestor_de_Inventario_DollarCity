import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Observable, Subject, TimeoutError } from 'rxjs';

import { API_URL } from '../config/constantes';
import { TiempoRealService } from './tiempo-real.service';

const ESPERA_PRUEBA_MS = 4000;     // tiempo máximo de /api/salud
const PRIMER_REINTENTO_MS = 3000;
const REINTENTO_MAXIMO_MS = 15000;

/**
 * Sabe si la API y la base de datos responden.
 * - Una petición que falla por red, tiempo o servidor caído marca la caída.
 * - Mientras está caída, consulta /api/salud cada pocos segundos.
 * - Al volver, avisa por restablecida$ para sincronizar las ventas pendientes.
 */
@Injectable({ providedIn: 'root' })
export class ConexionService {
    private readonly tiempoReal = inject(TiempoRealService);

    readonly apiDisponible = signal(true);

    private readonly restablecida = new Subject<void>();
    readonly restablecida$: Observable<void> = this.restablecida.asObservable();

    private temporizador?: ReturnType<typeof setTimeout>;
    private esperaMs = PRIMER_REINTENTO_MS;
    private comprobando: Promise<boolean> | null = null;

    constructor() {
        window.addEventListener('offline', () => this.marcarCaida());
        window.addEventListener('online', () => void this.comprobar());

        // Si el canal en vivo se cae, se confirma de inmediato si la API sigue respondiendo
        effect(() => {
            const estado = this.tiempoReal.estado();
            untracked(() => {
                if (estado === 'reconectando') void this.comprobar();
            });
        });
    }

    marcarCaida(): void {
        if (this.apiDisponible()) {
            this.apiDisponible.set(false);
            this.esperaMs = PRIMER_REINTENTO_MS;
        }
        this.programarPrueba();
    }

    marcarDisponible(): void {
        clearTimeout(this.temporizador);
        this.esperaMs = PRIMER_REINTENTO_MS;
        if (!this.apiDisponible()) {
            this.apiDisponible.set(true);
            this.restablecida.next();
        }
    }

    /** Consulta /api/salud. true si la API y la base de datos responden. */
    comprobar(): Promise<boolean> {
        this.comprobando ??= this.probarSalud().finally(() => (this.comprobando = null));
        return this.comprobando;
    }

    /** Error de red, de tiempo o de un servidor que no responde (no un rechazo de datos). */
    esFallaDeConexion(error: unknown): boolean {
        if (error instanceof TimeoutError) return true;
        return error instanceof HttpErrorResponse && [0, 502, 503, 504].includes(error.status);
    }

    /**
     * Decide si un error al cobrar o sincronizar significa que no hay servicio.
     * Un 500 puede ser la base de datos caída o un error del programa:
     * se distingue preguntando a /api/salud.
     */
    async esCaida(error: unknown): Promise<boolean> {
        if (this.esFallaDeConexion(error)) {
            this.marcarCaida();
            return true;
        }
        if (error instanceof HttpErrorResponse && error.status >= 500) {
            return !(await this.comprobar());
        }
        return false;
    }

    private async probarSalud(): Promise<boolean> {
        const control = new AbortController();
        const limite = setTimeout(() => control.abort(), ESPERA_PRUEBA_MS);
        try {
            const respuesta = await fetch(`${API_URL}/salud`, { cache: 'no-store', signal: control.signal });
            const cuerpo = respuesta.ok ? ((await respuesta.json()) as { estado?: string }) : null;
            if (cuerpo?.estado === 'ok') {
                this.marcarDisponible();
                return true;
            }
        } catch {
            /* sin respuesta */
        } finally {
            clearTimeout(limite);
        }
        this.marcarCaida();
        return false;
    }

    private programarPrueba(): void {
        clearTimeout(this.temporizador);
        this.temporizador = setTimeout(() => void this.comprobar(), this.esperaMs);
        this.esperaMs = Math.min(this.esperaMs * 2, REINTENTO_MAXIMO_MS);
    }
}