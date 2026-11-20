import { Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { debounceTime, filter } from 'rxjs';

import { Venta, VentasDelDia } from '../../core/models/venta.model';
import { AuthService } from '../../core/services/auth.service';
import { TicketService } from '../../core/services/ticket.service';
import { TiempoRealService } from '../../core/services/tiempo-real.service';
import { VentasService } from '../../core/services/ventas.service';

/** Fecha de hoy en El Salvador con formato AAAA-MM-DD. */
function hoy(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador' }).format(new Date());
}

type Vista = 'dia' | 'revision';

@Component({
    selector: 'app-ventas',
    imports: [CurrencyPipe, DatePipe, RouterLink],
    templateUrl: './ventas.html',
    styleUrls: ['../pagina.css', './ventas.css']
})
export class Ventas {
    protected readonly auth = inject(AuthService);
    private readonly ventas = inject(VentasService);
    private readonly tiempoReal = inject(TiempoRealService);
    private readonly tickets = inject(TicketService);
    private peticionActual = 0;
    private peticionRevision = 0;

    protected readonly hoy = hoy();
    protected readonly fecha = signal(this.hoy);
    protected readonly datos = signal<VentasDelDia | null>(null);
    protected readonly cargando = signal(false);
    protected readonly error = signal<string | null>(null);

    // Vista del día o de ventas sin conexión por revisar (cualquier fecha)
    protected readonly vista = signal<Vista>('dia');
    protected readonly listaRevision = signal<Venta[] | null>(null);
    protected readonly filas = computed(() =>
        this.vista() === 'dia' ? (this.datos()?.ventas ?? []) : (this.listaRevision() ?? [])
    );

    // Detalle desplegado
    protected readonly abierta = signal<number | null>(null);
    protected readonly detalle = signal<Venta | null>(null);
    protected readonly ticketEnProceso = signal<number | null>(null);

    // Anulación
    protected readonly porAnular = signal<Venta | null>(null);
    protected readonly motivo = signal('');
    protected readonly anulando = signal(false);
    protected readonly errorAnulacion = signal<string | null>(null);

    // Revisión de ventas sin conexión
    protected readonly porRevisar = signal<Venta | null>(null);
    protected readonly observacion = signal('');
    protected readonly revisando = signal(false);
    protected readonly errorRevision = signal<string | null>(null);

    protected readonly esSupervisor = computed(() => this.auth.rol() === 'SUPERVISOR');
    protected readonly puedeVender = computed(() => this.auth.tieneRol(['CAJERO', 'SUPERVISOR']));
    protected readonly esCedi = computed(() => this.auth.ubicacionActiva()?.tipo === 'CEDI');
    protected readonly titulo = computed(() => {
        if (this.vista() === 'revision') return 'Ventas por revisar';
        return this.auth.rol() === 'CAJERO' ? 'Mis ventas' : 'Ventas del día';
    });
    protected readonly pendientesRevision = computed(() => this.datos()?.resumen.porRevisar ?? 0);

    constructor() {
        effect(() => {
            const ubicacionId = this.auth.ubicacionActiva()?.ubicacionId;
            const fecha = this.fecha();
            untracked(() => {
                this.abierta.set(null);
                if (ubicacionId && !this.esCedi()) void this.cargar(fecha);
                else this.datos.set(null);
                if (this.vista() === 'revision') void this.cargarRevision();
            });
        });

        // Un ticket nuevo, sincronizado o anulado en esta tienda actualiza las listas
        this.tiempoReal.eventos$
            .pipe(
                filter((e) =>
                    e.tipo === 'reconectado' ||
                    (e.tipo === 'venta' && e.ubicacionId === this.auth.ubicacionActiva()?.ubicacionId)
                ),
                debounceTime(800),
                takeUntilDestroyed()
            )
            .subscribe(() => {
                if (this.fecha() === this.hoy) void this.cargar(this.fecha(), true);
                if (this.vista() === 'revision') void this.cargarRevision(true);
            });
    }

    protected cambiarFecha(evento: Event): void {
        const valor = (evento.target as HTMLInputElement).value;
        if (valor) this.fecha.set(valor);
    }

    protected verRevision(): void {
        this.vista.set('revision');
        this.abierta.set(null);
        void this.cargarRevision();
    }

    protected verDia(): void {
        this.vista.set('dia');
        this.abierta.set(null);
    }

    protected necesitaRevision(venta: Venta): boolean {
        return (venta.conFaltante || venta.conDiferenciaPrecio) && !venta.revisadaEn;
    }

    protected async alternarDetalle(venta: Venta): Promise<void> {
        if (this.abierta() === venta.ventaId) {
            this.abierta.set(null);
            return;
        }
        this.abierta.set(venta.ventaId);
        this.detalle.set(null);
        try {
            const completo = await this.ventas.detalle(venta.ventaId);
            if (this.abierta() === venta.ventaId) this.detalle.set(completo);
        } catch (error) {
            this.error.set(this.ventas.mensajeDeError(error, 'No se pudo cargar el detalle del ticket.'));
        }
    }

    /** Descarga el ticket; si el detalle no está cargado, lo pide primero. */
    protected async descargarTicket(venta: Venta): Promise<void> {
        if (this.ticketEnProceso()) return;
        this.ticketEnProceso.set(venta.ventaId);
        try {
            const abierto = this.detalle();
            const completo = abierto?.ventaId === venta.ventaId && abierto.lineas ? abierto : await this.ventas.detalle(venta.ventaId);
            await this.tickets.descargar(completo);
        } catch (error) {
            this.error.set(this.ventas.mensajeDeError(error, 'No se pudo generar el ticket.'));
        } finally {
            this.ticketEnProceso.set(null);
        }
    }

    // ---------- Anulación ----------

    protected pedirAnulacion(venta: Venta): void {
        this.porAnular.set(venta);
        this.motivo.set('');
        this.errorAnulacion.set(null);
    }

    protected cerrarAnulacion(): void {
        if (!this.anulando()) this.porAnular.set(null);
    }

    protected escribirMotivo(evento: Event): void {
        this.motivo.set((evento.target as HTMLTextAreaElement).value);
    }

    protected async confirmarAnulacion(): Promise<void> {
        const venta = this.porAnular();
        const motivo = this.motivo().trim();
        if (!venta) return;
        if (motivo.length < 5) {
            this.errorAnulacion.set('Escribe un motivo de al menos 5 caracteres.');
            return;
        }

        this.anulando.set(true);
        this.errorAnulacion.set(null);
        try {
            await this.ventas.anular(venta.ventaId, motivo);
            this.porAnular.set(null);
            if (this.abierta() === venta.ventaId) this.abierta.set(null);
            await this.cargar(this.fecha(), true);
            if (this.vista() === 'revision') await this.cargarRevision(true);
        } catch (error) {
            this.errorAnulacion.set(this.ventas.mensajeDeError(error, 'No se pudo anular el ticket.'));
        } finally {
            this.anulando.set(false);
        }
    }

    // ---------- Revisión de ventas sin conexión ----------

    protected pedirRevision(venta: Venta): void {
        this.porRevisar.set(venta);
        this.observacion.set('');
        this.errorRevision.set(null);
    }

    protected cerrarRevision(): void {
        if (!this.revisando()) this.porRevisar.set(null);
    }

    protected escribirObservacion(evento: Event): void {
        this.observacion.set((evento.target as HTMLTextAreaElement).value);
    }

    protected async confirmarRevision(): Promise<void> {
        const venta = this.porRevisar();
        const observacion = this.observacion().trim();
        if (!venta) return;
        if (observacion.length < 5) {
            this.errorRevision.set('Escribe una observación de al menos 5 caracteres.');
            return;
        }

        this.revisando.set(true);
        this.errorRevision.set(null);
        try {
            const revisada = await this.ventas.revisar(venta.ventaId, observacion);
            this.porRevisar.set(null);
            if (this.abierta() === venta.ventaId) this.detalle.set(revisada);
            await this.cargar(this.fecha(), true);
            if (this.vista() === 'revision') await this.cargarRevision(true);
        } catch (error) {
            this.errorRevision.set(this.ventas.mensajeDeError(error, 'No se pudo registrar la revisión.'));
        } finally {
            this.revisando.set(false);
        }
    }

    @HostListener('document:keydown.escape')
    protected cerrarDialogos(): void {
        this.cerrarAnulacion();
        this.cerrarRevision();
    }

    protected nombreMetodo(metodo: string): string {
        return metodo === 'EFECTIVO' ? 'Efectivo' : metodo === 'TARJETA' ? 'Tarjeta' : 'Mixto';
    }

    private async cargar(fecha: string, silencioso = false): Promise<void> {
        const numero = ++this.peticionActual;
        if (!silencioso) this.cargando.set(true);
        this.error.set(null);
        try {
            const datos = await this.ventas.delDia(fecha);
            if (numero === this.peticionActual) this.datos.set(datos);
        } catch (error) {
            if (numero === this.peticionActual) this.error.set(this.ventas.mensajeDeError(error, 'No se pudieron cargar las ventas.'));
        } finally {
            if (numero === this.peticionActual) this.cargando.set(false);
        }
    }

    private async cargarRevision(silencioso = false): Promise<void> {
        if (!this.esSupervisor()) return;
        const numero = ++this.peticionRevision;
        if (!silencioso) this.listaRevision.set(null);
        try {
            const lista = await this.ventas.porRevisar();
            if (numero === this.peticionRevision) this.listaRevision.set(lista);
        } catch (error) {
            if (numero === this.peticionRevision) {
                this.listaRevision.set([]);
                this.error.set(this.ventas.mensajeDeError(error, 'No se pudieron cargar las ventas por revisar.'));
            }
        }
    }
}