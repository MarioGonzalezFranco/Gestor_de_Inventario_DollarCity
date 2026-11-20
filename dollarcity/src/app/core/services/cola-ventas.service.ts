import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import { LineaTicket, LineaVenta, VentaPendiente, VentaRegistrada } from '../models/venta.model';
import { AlmacenLocalService } from './almacen-local.service';
import { AuthService } from './auth.service';
import { CatalogoLocalService } from './catalogo-local.service';
import { ConexionService } from './conexion.service';
import { VentasService } from './ventas.service';

// Límite acordado: 50 ventas o 2 horas sin conexión; después, PIN del supervisor
export const LIMITE_VENTAS_SIN_CONEXION = 50;
export const LIMITE_HORAS_SIN_CONEXION = 2;
const LIMITE_MS = LIMITE_HORAS_SIN_CONEXION * 3600000;

const CLAVE_VENTANA = 'dc_caja_ventana';
const CLAVE_CAJA = 'dc_caja_id';
const CLAVE_CONTADOR = 'dc_caja_contador';
const PRIMER_REINTENTO_MS = 2000;
const REINTENTO_MAXIMO_MS = 60000;
const REVISAR_CADA_MS = 30000;

/** Periodo sin conexión que cuenta para el límite. */
export interface VentanaSinConexion {
    inicio: number;
    ventas: number;
    autorizadaPor: number | null;
    autorizadaNombre: string | null;
}

export interface ResultadoSincronizacion {
    enviadas: number;
    rechazadas: number;
}

/**
 * Cola de ventas cobradas sin conexión (patrón outbox).
 * 1. La venta se guarda en IndexedDB con su UUID y un ticket provisional.
 * 2. Al volver la conexión se envía en orden, una por una, a /api/ventas/sincronizar.
 * 3. Si un envío falla por red, se reintenta con esperas crecientes (2, 4, 8… 60 s).
 * 4. Si el servidor la rechaza por sus datos, queda como RECHAZADA y visible; nunca se borra.
 */
@Injectable({ providedIn: 'root' })
export class ColaVentasService {
    private readonly auth = inject(AuthService);
    private readonly api = inject(VentasService);
    private readonly almacen = inject(AlmacenLocalService);
    private readonly conexion = inject(ConexionService);
    private readonly catalogo = inject(CatalogoLocalService);

    /** Todas las ventas de la cola en este navegador. */
    readonly ventas = signal<VentaPendiente[]>([]);
    readonly pendientes = computed(() => this.ventas().filter((v) => v.estado === 'PENDIENTE'));
    readonly rechazadas = computed(() => this.ventas().filter((v) => v.estado === 'RECHAZADA'));
    readonly sincronizando = signal(false);
    readonly ventana = signal<VentanaSinConexion | null>(leerJson<VentanaSinConexion>(CLAVE_VENTANA));

    private readonly resultado = new Subject<ResultadoSincronizacion>();
    /** Se emite al terminar cada envío de la cola con al menos una venta procesada. */
    readonly resultado$: Observable<ResultadoSincronizacion> = this.resultado.asObservable();

    private readonly cargada: Promise<void>;
    private repetir = false;
    private reintento?: ReturnType<typeof setTimeout>;
    private esperaMs = PRIMER_REINTENTO_MS;

    constructor() {
        this.cargada = this.almacen
            .pendientes()
            .then((lista) => this.ventas.set(lista))
            .catch(() => this.ventas.set([]));

        // Al iniciar sesión (o cambiar de tienda) se envía lo que haya quedado pendiente
        effect(() => {
            const token = this.auth.token();
            const ubicacionId = this.auth.ubicacionActiva()?.ubicacionId;
            untracked(() => {
                if (token && ubicacionId) void this.sincronizar();
            });
        });
        this.conexion.restablecida$.subscribe(() => void this.sincronizar());
        setInterval(() => {
            if (this.pendientes().length && this.conexion.apiDisponible()) void this.sincronizar();
        }, REVISAR_CADA_MS);
    }

    // ===================== Límite sin conexión =====================

    /** true si se llegó a 50 ventas o 2 horas desde el inicio (o desde la última autorización). */
    requiereAutorizacion(): boolean {
        const ventana = this.ventana();
        if (!ventana) return false;
        return ventana.ventas >= LIMITE_VENTAS_SIN_CONEXION || Date.now() - ventana.inicio >= LIMITE_MS;
    }

    /** El supervisor autorizó: empieza un nuevo periodo de 50 ventas o 2 horas. */
    autorizar(supervisor: { usuarioId: number; nombre: string }): void {
        this.fijarVentana({ inicio: Date.now(), ventas: 0, autorizadaPor: supervisor.usuarioId, autorizadaNombre: supervisor.nombre });
    }

    // ===================== Cola =====================

    /**
     * Guarda una venta cobrada sin conexión. Si el navegador no logra guardarla,
     * lanza un error y la venta NO debe darse por cobrada.
     */
    async encolar(datos: { uuid: string; lineas: LineaTicket[]; efectivoRecibido: number }): Promise<VentaPendiente> {
        await this.cargada;
        const usuario = this.auth.usuario();
        const ubicacion = this.auth.ubicacionActiva();
        if (!usuario || !ubicacion) throw new Error('No hay sesión activa.');

        const existente = this.ventas().find((v) => v.uuid === datos.uuid);
        if (existente) return existente;

        const lineas: LineaVenta[] = datos.lineas.map((l) => ({
            productoId: l.productoId,
            sku: l.sku,
            producto: l.producto,
            cantidad: l.cantidad,
            precioUnitario: l.precio,
            subtotal: redondear(l.precio * l.cantidad),
            cantidadFaltante: Math.max(0, l.cantidad - l.stock)
        }));
        const total = redondear(lineas.reduce((s, l) => s + l.subtotal, 0));
        if (datos.efectivoRecibido + 0.001 < total) throw new Error('El efectivo no cubre el total.');

        const ventana = this.ventana() ?? { inicio: Date.now(), ventas: 0, autorizadaPor: null, autorizadaNombre: null };
        const venta: VentaPendiente = {
            uuid: datos.uuid,
            ubicacionId: ubicacion.ubicacionId,
            usuarioId: usuario.usuarioId,
            cajero: usuario.nombreCompleto,
            ticketProvisional: this.siguienteProvisional(ubicacion.codigo),
            fechaVenta: new Date().toISOString(),
            metodoPago: 'EFECTIVO',
            efectivoRecibido: redondear(datos.efectivoRecibido),
            cambio: redondear(datos.efectivoRecibido - total),
            total,
            lineas,
            autorizadaPor: ventana.autorizadaPor,
            autorizadaNombre: ventana.autorizadaNombre,
            tienda: this.catalogo.tienda(),
            estado: 'PENDIENTE',
            intentos: 0,
            error: null,
            creadaEn: Date.now()
        };

        await this.almacen.guardarPendiente(venta);
        this.ventas.update((lista) => [...lista, venta]);
        this.fijarVentana({ ...ventana, ventas: ventana.ventas + 1 });
        return venta;
    }

    /** Forma de venta para la pantalla de confirmación y el ticket en PDF. */
    comoVenta(p: VentaPendiente): VentaRegistrada {
        return {
            ventaId: 0,
            numeroTicket: p.ticketProvisional,
            fecha: p.fechaVenta,
            total: p.total,
            metodoPago: p.metodoPago,
            estado: 'COMPLETADA',
            usuarioId: p.usuarioId,
            cajero: p.cajero,
            articulos: p.lineas.reduce((s, l) => s + l.cantidad, 0),
            motivoAnulacion: null,
            anuladaEn: null,
            anuladaPor: null,
            esDeHoy: true,
            origen: 'SIN_CONEXION',
            ticketProvisional: p.ticketProvisional,
            sincronizadaEn: null,
            autorizadaPor: p.autorizadaNombre,
            conFaltante: p.lineas.some((l) => (l.cantidadFaltante ?? 0) > 0),
            conDiferenciaPrecio: false,
            revisadaEn: null,
            revisadaPor: null,
            observacionRevision: null,
            tienda: p.tienda ?? undefined,
            lineas: p.lineas,
            efectivoRecibido: p.efectivoRecibido,
            cambio: p.cambio,
            pendiente: true
        };
    }

    /** Envía las ventas pendientes de la tienda activa, en el orden en que se cobraron. */
    async sincronizar(): Promise<void> {
        if (this.sincronizando()) {
            this.repetir = true;
            return;
        }
        await this.cargada;
        const ubicacionId = this.auth.ubicacionActiva()?.ubicacionId;
        if (!this.auth.token() || !ubicacionId || !this.auth.tieneRol(['CAJERO', 'SUPERVISOR'])) return;

        clearTimeout(this.reintento);
        this.sincronizando.set(true);
        let enviadas = 0;
        let rechazadas = 0;
        let detenido = false;

        try {
            const cola = this.pendientes().filter((v) => v.ubicacionId === ubicacionId);
            for (const venta of cola) {
                try {
                    await this.api.sincronizar(venta);
                    await this.almacen.borrarPendiente(venta.uuid);
                    this.ventas.update((lista) => lista.filter((v) => v.uuid !== venta.uuid));
                    this.conexion.marcarDisponible();
                    this.esperaMs = PRIMER_REINTENTO_MS;
                    enviadas++;
                } catch (error) {
                    if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) {
                        // Sesión vencida o sin permiso: se envía cuando alguien inicie sesión en esta caja
                        detenido = true;
                        break;
                    }
                    if (await this.conexion.esCaida(error)) {
                        await this.actualizar(venta, { intentos: venta.intentos + 1, error: 'Sin respuesta del servidor' });
                        this.programarReintento();
                        detenido = true;
                        break;
                    }
                    if (error instanceof HttpErrorResponse && error.status >= 400 && error.status < 500) {
                        // Rechazo por los datos: no se reintenta sola, queda visible para el supervisor
                        await this.actualizar(venta, {
                            estado: 'RECHAZADA',
                            intentos: venta.intentos + 1,
                            error: this.api.mensajeDeError(error, 'El servidor rechazó la venta.')
                        });
                        rechazadas++;
                        continue;
                    }
                    // Error del servidor con la API en línea: se reintenta más tarde
                    await this.actualizar(venta, { intentos: venta.intentos + 1, error: this.api.mensajeDeError(error, 'Error del servidor.') });
                    this.programarReintento();
                    detenido = true;
                    break;
                }
            }
        } finally {
            this.sincronizando.set(false);
        }

        if (enviadas || rechazadas) this.resultado.next({ enviadas, rechazadas });
        // El stock del servidor ya incluye estas ventas: se renueva la copia local
        if (enviadas) void this.catalogo.actualizar();

        // Sin pendientes y con conexión: termina el periodo sin conexión
        if (!detenido && !this.pendientes().some((v) => v.ubicacionId === ubicacionId) && this.conexion.apiDisponible()) {
            this.fijarVentana(null);
        }

        if (this.repetir) {
            this.repetir = false;
            if (!detenido) void this.sincronizar();
        }
    }

    /** Vuelve a poner en la cola una venta rechazada (por ejemplo, después de corregir un precio). */
    async reintentar(uuid: string): Promise<void> {
        const venta = this.ventas().find((v) => v.uuid === uuid);
        if (!venta) return;
        await this.actualizar(venta, { estado: 'PENDIENTE', error: null });
        await this.sincronizar();
    }

    /** Descarga la venta en JSON como respaldo para el supervisor. */
    descargarRespaldo(uuid: string): void {
        const venta = this.ventas().find((v) => v.uuid === uuid);
        if (!venta) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(venta, null, 2)], { type: 'application/json' }));
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = `venta-${venta.ticketProvisional}.json`;
        enlace.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ===================== Interno =====================

    private async actualizar(venta: VentaPendiente, cambios: Partial<VentaPendiente>): Promise<void> {
        const nueva = { ...venta, ...cambios };
        try {
            await this.almacen.guardarPendiente(nueva);
        } catch {
            /* el estado en disco queda como estaba; la venta sigue en la cola */
        }
        this.ventas.update((lista) => lista.map((v) => (v.uuid === venta.uuid ? nueva : v)));
    }

    private programarReintento(): void {
        clearTimeout(this.reintento);
        this.reintento = setTimeout(() => void this.sincronizar(), this.esperaMs);
        this.esperaMs = Math.min(this.esperaMs * 2, REINTENTO_MAXIMO_MS);
    }

    private fijarVentana(ventana: VentanaSinConexion | null): void {
        this.ventana.set(ventana);
        try {
            if (ventana) localStorage.setItem(CLAVE_VENTANA, JSON.stringify(ventana));
            else localStorage.removeItem(CLAVE_VENTANA);
        } catch {
            /* sin almacenamiento: el límite vive en memoria */
        }
    }

    /** TDA-001-P7F3A-0001: tienda, caja (4 caracteres fijos por navegador) y consecutivo. */
    private siguienteProvisional(codigoTienda: string): string {
        let caja = leerTexto(CLAVE_CAJA);
        if (!caja || !/^[0-9A-F]{4}$/.test(caja)) {
            caja = Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
            guardarTexto(CLAVE_CAJA, caja);
        }
        const anterior = Number(leerTexto(CLAVE_CONTADOR) ?? '0');
        const numero = Number.isInteger(anterior) && anterior > 0 && anterior < 9999 ? anterior + 1 : 1;
        guardarTexto(CLAVE_CONTADOR, String(numero));
        return `${codigoTienda}-P${caja}-${String(numero).padStart(4, '0')}`;
    }
}

function redondear(numero: number): number {
    return Math.round(numero * 100) / 100;
}

function leerJson<T>(clave: string): T | null {
    try {
        return JSON.parse(localStorage.getItem(clave) ?? 'null') as T | null;
    } catch {
        return null;
    }
}

function leerTexto(clave: string): string | null {
    try {
        return localStorage.getItem(clave);
    } catch {
        return null;
    }
}

function guardarTexto(clave: string, valor: string): void {
    try {
        localStorage.setItem(clave, valor);
    } catch {
        /* sin almacenamiento */
    }
}