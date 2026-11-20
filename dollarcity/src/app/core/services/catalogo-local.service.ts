import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import { EstadoStock } from '../models/inventario.model';
import { CatalogoLocal, Departamento, ProductoVenta, TiendaTicket } from '../models/venta.model';
import { AlmacenLocalService } from './almacen-local.service';
import { AuthService } from './auth.service';
import { ConexionService } from './conexion.service';
import { EventoTiempoReal, TiempoRealService } from './tiempo-real.service';
import { VentasService } from './ventas.service';

const LIMITE_RESULTADOS = 48;
const ESPERA_GUARDADO_MS = 1500;
const RENOVAR_CADA_MS = 10 * 60000;

type EventoStock = Extract<EventoTiempoReal, { tipo: 'stock' }>;

/**
 * Copia del catálogo de la tienda guardada en la caja.
 * - Se descarga al entrar y se renueva al volver la conexión o cada 10 minutos.
 * - El canal en vivo actualiza el stock de cada producto al instante.
 * - Sin conexión, la búsqueda y el lector de código de barras siguen funcionando.
 */
@Injectable({ providedIn: 'root' })
export class CatalogoLocalService {
    private readonly auth = inject(AuthService);
    private readonly api = inject(VentasService);
    private readonly almacen = inject(AlmacenLocalService);
    private readonly conexion = inject(ConexionService);
    private readonly tiempoReal = inject(TiempoRealService);

    readonly productos = signal<ProductoVenta[]>([]);
    readonly departamentos = signal<Departamento[]>([]);
    readonly tienda = signal<TiendaTicket | null>(null);
    /** Hora del servidor en que se generó la copia; null si la caja no tiene catálogo. */
    readonly actualizado = signal<string | null>(null);
    readonly listo = computed(() => this.actualizado() !== null);

    private ubicacionId: number | null = null;
    private descargando: Promise<boolean> | null = null;
    private eventosDuranteDescarga: EventoStock[] = [];
    private temporizadorGuardado?: ReturnType<typeof setTimeout>;

    constructor() {
        // Solo las cajas (cajero y supervisor en una tienda) guardan el catálogo
        effect(() => {
            const token = this.auth.token();
            const ubicacion = this.auth.ubicacionActiva();
            const vende = this.auth.tieneRol(['CAJERO', 'SUPERVISOR']);
            untracked(() => {
                const id = token && vende && ubicacion?.tipo === 'TIENDA' ? ubicacion.ubicacionId : null;
                if (id !== this.ubicacionId) void this.iniciar(id);
            });
        });

        this.tiempoReal.eventos$.subscribe((evento) => {
            if (evento.tipo === 'stock') this.alCambiarStock(evento);
            else if (evento.tipo === 'catalogo' || evento.tipo === 'reconectado') void this.actualizar();
        });
        this.conexion.restablecida$.subscribe(() => void this.actualizar());
        setInterval(() => {
            if (this.ubicacionId && this.conexion.apiDisponible()) void this.actualizar();
        }, RENOVAR_CADA_MS);
    }

    /** Descarga la copia del servidor. Devuelve false si no hubo respuesta. */
    actualizar(): Promise<boolean> {
        this.descargando ??= this.descargar().finally(() => (this.descargando = null));
        return this.descargando;
    }

    /** Mismo filtro y orden que GET /api/ventas/catalogo (más vendidos primero). */
    buscar(filtro: { departamentoId: number | null; buscar: string }, limite = LIMITE_RESULTADOS): ProductoVenta[] {
        const texto = filtro.buscar.trim().toLowerCase();
        const resultado: ProductoVenta[] = [];
        for (const p of this.productos()) {
            if (filtro.departamentoId && p.departamentoId !== filtro.departamentoId) continue;
            if (texto && !(
                p.sku.toLowerCase().includes(texto) ||
                (p.codigoBarras ?? '').toLowerCase().includes(texto) ||
                p.producto.toLowerCase().includes(texto)
            )) continue;
            resultado.push(p);
            if (resultado.length >= limite) break;
        }
        return resultado;
    }

    /** Código de barras o SKU exacto. */
    porCodigo(codigo: string): ProductoVenta | undefined {
        const limpio = codigo.trim();
        const mayusculas = limpio.toUpperCase();
        return this.productos().find((p) => p.codigoBarras === limpio || p.sku.toUpperCase() === mayusculas);
    }

    /** Resta en la copia local lo vendido sin conexión (el servidor corrige al sincronizar). */
    descontar(lineas: { productoId: number; cantidad: number }[]): void {
        const vendidas = new Map(lineas.map((l) => [l.productoId, l.cantidad] as const));
        this.productos.update((lista) =>
            lista.map((p) => {
                const cantidad = vendidas.get(p.productoId);
                if (cantidad === undefined) return p;
                const nueva = Math.max(0, p.cantidad - cantidad);
                return { ...p, cantidad: nueva, estadoStock: estadoDe(nueva, p.stockMinimo, p.stockMaximo) };
            })
        );
        this.programarGuardado();
    }

    // ---------- Interno ----------

    private async iniciar(id: number | null): Promise<void> {
        clearTimeout(this.temporizadorGuardado);
        this.ubicacionId = id;
        this.productos.set([]);
        this.departamentos.set([]);
        this.tienda.set(null);
        this.actualizado.set(null);
        if (!id) return;

        // Primero la copia guardada (sirve aunque la API no responda), luego la del servidor
        const guardado = await this.almacen.leer<CatalogoLocal>(clave(id)).catch(() => null);
        if (guardado && this.ubicacionId === id && !this.listo()) this.aplicar(guardado);
        await this.actualizar();
    }

    private async descargar(): Promise<boolean> {
        const id = this.ubicacionId;
        if (!id) return false;
        this.eventosDuranteDescarga = [];
        try {
            const catalogo = await this.api.catalogoLocal();
            if (id !== this.ubicacionId || catalogo.tienda.ubicacionId !== id) return false;
            this.aplicar(catalogo);
            // Cambios de stock que llegaron mientras se descargaba la copia
            const recibidos = this.eventosDuranteDescarga;
            this.eventosDuranteDescarga = [];
            for (const evento of recibidos) this.alCambiarStock(evento);
            this.conexion.marcarDisponible();
            this.programarGuardado();
            return true;
        } catch (error) {
            await this.conexion.esCaida(error);
            return false;
        } finally {
            this.eventosDuranteDescarga = [];
        }
    }

    private aplicar(catalogo: CatalogoLocal): void {
        const t = catalogo.tienda;
        this.productos.set(catalogo.productos);
        this.departamentos.set(catalogo.departamentos);
        this.tienda.set({ codigo: t.codigo, nombre: t.nombre, direccion: t.direccion, municipio: t.municipio, telefono: t.telefono });
        this.actualizado.set(catalogo.generado);
    }

    private alCambiarStock(evento: EventoStock): void {
        if (evento.ubicacionId !== this.ubicacionId) return;
        if (this.descargando) this.eventosDuranteDescarga.push(evento);
        let cambio = false;
        this.productos.update((lista) =>
            lista.map((p) => {
                if (p.productoId !== evento.productoId) return p;
                cambio = true;
                return {
                    ...p,
                    cantidad: evento.cantidad,
                    stockMinimo: evento.stockMinimo,
                    stockMaximo: evento.stockMaximo,
                    estadoStock: evento.estadoStock
                };
            })
        );
        if (cambio) this.programarGuardado();
    }

    /** Agrupa los cambios para no escribir en disco con cada evento. */
    private programarGuardado(): void {
        const id = this.ubicacionId;
        const generado = this.actualizado();
        const tienda = this.tienda();
        if (!id || !generado || !tienda) return;
        clearTimeout(this.temporizadorGuardado);
        this.temporizadorGuardado = setTimeout(() => {
            if (id !== this.ubicacionId) return;
            const copia: CatalogoLocal = {
                generado,
                tienda: { ...tienda, ubicacionId: id },
                departamentos: this.departamentos(),
                productos: this.productos()
            };
            void this.almacen.guardar(clave(id), copia).catch(() => undefined);
        }, ESPERA_GUARDADO_MS);
    }
}

function clave(ubicacionId: number): string {
    return `catalogo:${ubicacionId}`;
}

/** Igual que el estado de stock que calcula la base de datos. */
function estadoDe(cantidad: number, minimo: number, maximo: number | null): EstadoStock {
    if (cantidad === 0) return 'AGOTADO';
    if (cantidad <= minimo) return 'BAJO';
    if (maximo !== null && cantidad > maximo) return 'SOBRESTOCK';
    return 'NORMAL';
}