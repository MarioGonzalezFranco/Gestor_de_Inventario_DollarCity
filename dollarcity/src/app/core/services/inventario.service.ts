import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';

import { API_URL } from '../config/constantes';
import { AlertaStock, MovimientoKardex, ResumenInventario, StockItem } from '../models/inventario.model';
import { AuthService } from './auth.service';
import { EventoTiempoReal, TiempoRealService } from './tiempo-real.service';

// Espera para agrupar varios cambios seguidos (un ticket con 3 productos = 3 avisos)
const ESPERA_INDICADORES_MS = 600;

@Injectable({ providedIn: 'root' })
export class InventarioService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly tiempoReal = inject(TiempoRealService);
  private peticionActual = 0;
  private temporizadorIndicadores?: ReturnType<typeof setTimeout>;

  // ---- Estado que leen las pantallas ----
  readonly stockActual = signal<StockItem[]>([]);
  readonly alertas = signal<AlertaStock[]>([]);
  readonly resumen = signal<ResumenInventario | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);

  readonly totalAlertas = computed(() => this.alertas().length);

  constructor() {
    // Cada vez que cambia la ubicación activa (o se inicia/cierra sesión) se recargan los datos
    effect(() => {
      const ubicacionId = this.auth.ubicacionActiva()?.ubicacionId;
      untracked(() => (ubicacionId ? this.recargar() : this.limpiar()));
    });

    // Cambios en vivo desde la base de datos
    this.tiempoReal.eventos$.pipe(takeUntilDestroyed()).subscribe((evento) => this.alRecibir(evento));
  }

  /** Pide a la API el stock, las alertas y el resumen de la ubicación activa. */
  async recargar(silencioso = false): Promise<void> {
    const ubicacionId = this.auth.ubicacionActiva()?.ubicacionId;
    if (!ubicacionId) return;

    const numero = ++this.peticionActual;
    const params = { ubicacionId };

    if (!silencioso) this.cargando.set(true);
    this.error.set(null);
    try {
      const [stock, alertas, resumen] = await Promise.all([
        firstValueFrom(this.http.get<StockItem[]>(`${API_URL}/inventario/stock`, { params })),
        this.veIndicadores() ? firstValueFrom(this.http.get<AlertaStock[]>(`${API_URL}/inventario/alertas`, { params })) : Promise.resolve([]),
        this.veIndicadores() ? firstValueFrom(this.http.get<ResumenInventario>(`${API_URL}/inventario/resumen`, { params })) : Promise.resolve(null)
      ]);

      // Si mientras tanto se cambió de ubicación, se descarta esta respuesta
      if (numero !== this.peticionActual) return;
      this.stockActual.set(stock);
      this.alertas.set(alertas);
      this.resumen.set(resumen);
    } catch (error) {
      if (numero === this.peticionActual) this.error.set(this.mensajeDeError(error));
    } finally {
      if (numero === this.peticionActual) this.cargando.set(false);
    }
  }

  /** Últimos movimientos de un producto en la ubicación activa. */
  kardex(sku: string): Promise<MovimientoKardex[]> {
    const ubicacionId = this.auth.ubicacionActiva()?.ubicacionId ?? 0;
    return firstValueFrom(
      this.http.get<MovimientoKardex[]>(`${API_URL}/inventario/kardex/${encodeURIComponent(sku)}`, { params: { ubicacionId } })
    );
  }

  private alRecibir(evento: EventoTiempoReal): void {
    switch (evento.tipo) {
      case 'stock': {
        if (evento.ubicacionId !== this.auth.ubicacionActiva()?.ubicacionId) return;
        // Solo cambia la fila del producto; la tabla no se vuelve a pedir
        this.stockActual.update((lista) =>
          lista.map((item) =>
            item.productoId === evento.productoId
              ? { ...item, cantidad: evento.cantidad, stockMinimo: evento.stockMinimo, stockMaximo: evento.stockMaximo, estadoStock: evento.estadoStock }
              : item
          )
        );
        this.programarIndicadores();
        return;
      }
      case 'catalogo':
      case 'reconectado':
        void this.recargar(true);
        return;
    }
  }

  /** Alertas y resumen se recalculan en el servidor, agrupando los avisos seguidos. */
  private programarIndicadores(): void {
    if (!this.veIndicadores()) return;
    clearTimeout(this.temporizadorIndicadores);
    this.temporizadorIndicadores = setTimeout(() => void this.recargarIndicadores(), ESPERA_INDICADORES_MS);
  }

  private async recargarIndicadores(): Promise<void> {
    const ubicacionId = this.auth.ubicacionActiva()?.ubicacionId;
    if (!ubicacionId) return;
    const numero = this.peticionActual;
    const params = { ubicacionId };
    try {
      const [alertas, resumen] = await Promise.all([
        firstValueFrom(this.http.get<AlertaStock[]>(`${API_URL}/inventario/alertas`, { params })),
        firstValueFrom(this.http.get<ResumenInventario>(`${API_URL}/inventario/resumen`, { params }))
      ]);
      if (numero !== this.peticionActual) return;
      this.alertas.set(alertas);
      this.resumen.set(resumen);
    } catch {
      /* el próximo aviso o la reconexión lo vuelven a intentar */
    }
  }

  // El cajero solo puede consultar stock; alertas y resumen son de los demás roles
  private veIndicadores(): boolean {
    return this.auth.rol() !== 'CAJERO';
  }

  private limpiar(): void {
    this.peticionActual++;
    clearTimeout(this.temporizadorIndicadores);
    this.stockActual.set([]);
    this.alertas.set([]);
    this.resumen.set(null);
    this.cargando.set(false);
    this.error.set(null);
  }

  private mensajeDeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'No hay conexión con el servidor. Revisa que la API esté encendida.';
      return (error.error as { mensaje?: string } | null)?.mensaje ?? 'No se pudieron cargar los datos.';
    }
    return 'No se pudieron cargar los datos.';
  }
}