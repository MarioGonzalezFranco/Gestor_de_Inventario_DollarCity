import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subject, filter } from 'rxjs';

import { API_URL } from '../config/constantes';
import { EstadoStock } from '../models/inventario.model';
import { AuthService } from './auth.service';

export type EstadoConexion = 'desconectado' | 'conectando' | 'en-vivo' | 'reconectando';

/** Eventos que envía GET /api/tiempo-real (más 'reconectado', que se genera aquí). */
export type EventoTiempoReal =
    | { tipo: 'conectado'; ubicacionId: number }
    | {
        tipo: 'stock';
        productoId: number;
        ubicacionId: number;
        cantidad: number;
        stockMinimo: number;
        stockMaximo: number | null;
        estadoStock: EstadoStock;
    }
    | { tipo: 'venta'; ventaId: number; ubicacionId: number; estado: 'COMPLETADA' | 'ANULADA' }
    | { tipo: 'catalogo' }
    | { tipo: 'reconectado' };

type TipoEvento = EventoTiempoReal['tipo'];

const SILENCIO_MAXIMO_MS = 45_000;   // el servidor manda un latido cada 20 s
const ESPERA_MAXIMA_MS = 30_000;

/**
 * Canal de tiempo real con el backend (Server-Sent Events).
 * Se usa fetch en lugar de EventSource porque EventSource no permite
 * enviar el token en el encabezado Authorization.
 */
@Injectable({ providedIn: 'root' })
export class TiempoRealService {
    private readonly auth = inject(AuthService);
    private readonly router = inject(Router);

    readonly estado = signal<EstadoConexion>('desconectado');

    private readonly flujo = new Subject<EventoTiempoReal>();
    readonly eventos$: Observable<EventoTiempoReal> = this.flujo.asObservable();

    private control: AbortController | null = null;
    private esReintento = false;
    private intentos = 0;
    private temporizadorReintento?: ReturnType<typeof setTimeout>;
    private vigilante?: ReturnType<typeof setTimeout>;

    constructor() {
        // Se conecta al iniciar sesión, cambia de canal al cambiar de ubicación y se cierra al salir
        effect(() => {
            const token = this.auth.token();
            const ubicacionId = this.auth.ubicacionActiva()?.ubicacionId;
            untracked(() => (token && ubicacionId ? this.conectar(false) : this.desconectar()));
        });
    }

    /** Eventos de un solo tipo, ya con su forma. */
    de<T extends TipoEvento>(tipo: T): Observable<Extract<EventoTiempoReal, { tipo: T }>> {
        return this.eventos$.pipe(filter((e): e is Extract<EventoTiempoReal, { tipo: T }> => e.tipo === tipo));
    }

    private conectar(esReintento: boolean): void {
        this.detener();
        const token = this.auth.token();
        const ubicacionId = this.auth.ubicacionActiva()?.ubicacionId;
        if (!token || !ubicacionId) return;

        const control = new AbortController();
        this.control = control;
        this.esReintento = esReintento;
        this.estado.set(esReintento ? 'reconectando' : 'conectando');
        void this.escuchar(token, ubicacionId, control);
    }

    private desconectar(): void {
        this.detener();
        this.intentos = 0;
        this.estado.set('desconectado');
    }

    private detener(): void {
        clearTimeout(this.temporizadorReintento);
        clearTimeout(this.vigilante);
        const anterior = this.control;
        this.control = null;
        anterior?.abort();
    }

    private async escuchar(token: string, ubicacionId: number, control: AbortController): Promise<void> {
        try {
            const respuesta = await fetch(`${API_URL}/tiempo-real?ubicacionId=${ubicacionId}`, {
                headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
                cache: 'no-store',
                signal: control.signal,
            });

            if (respuesta.status === 401) {
                this.desconectar();
                this.auth.logout();
                this.router.navigateByUrl('/login');
                return;
            }
            if (!respuesta.ok || !respuesta.body) throw new Error(`HTTP ${respuesta.status}`);

            const lector = respuesta.body.pipeThrough(new TextDecoderStream()).getReader();
            let pendiente = '';
            this.vigilar(control);

            while (true) {
                const { value, done } = await lector.read();
                if (done) break;
                this.vigilar(control);
                pendiente += value.replace(/\r\n/g, '\n');

                let corte = pendiente.indexOf('\n\n');
                while (corte >= 0) {
                    this.procesar(pendiente.slice(0, corte));
                    pendiente = pendiente.slice(corte + 2);
                    corte = pendiente.indexOf('\n\n');
                }
            }
            throw new Error('El servidor cerró la conexión');
        } catch {
            // Si la conexión fue reemplazada o cerrada a propósito, no se reintenta
            if (this.control === control) this.programarReintento();
        }
    }

    /** Cada bloque SSE: líneas "event:" y "data:"; las que empiezan con ":" son latidos. */
    private procesar(bloque: string): void {
        const datos = bloque
            .split('\n')
            .filter((linea) => linea.startsWith('data:'))
            .map((linea) => linea.slice(5).trim())
            .join('\n');
        if (!datos) return;

        let evento: EventoTiempoReal;
        try {
            evento = JSON.parse(datos) as EventoTiempoReal;
        } catch {
            return;
        }

        if (evento.tipo === 'conectado') {
            this.estado.set('en-vivo');
            this.intentos = 0;
            // Tras una caída se recargan los datos para no perder lo ocurrido mientras tanto
            if (this.esReintento) this.flujo.next({ tipo: 'reconectado' });
            return;
        }
        this.flujo.next(evento);
    }

    /** Si pasa mucho tiempo sin datos ni latidos, se da por caída la conexión. */
    private vigilar(control: AbortController): void {
        clearTimeout(this.vigilante);
        this.vigilante = setTimeout(() => control.abort(), SILENCIO_MAXIMO_MS);
    }

    private programarReintento(): void {
        clearTimeout(this.vigilante);
        this.estado.set('reconectando');
        const espera = Math.min(ESPERA_MAXIMA_MS, 1000 * 2 ** this.intentos);
        this.intentos++;
        this.temporizadorReintento = setTimeout(() => this.conectar(true), espera);
    }
}