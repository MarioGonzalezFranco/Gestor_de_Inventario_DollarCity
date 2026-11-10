import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_URL } from '../config/constantes';
import { AlertaStock, MovimientoKardex, ResumenInventario, StockItem } from '../models/inventario.model';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class InventarioService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private peticionActual = 0;

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
  }

  /** Vuelve a pedir a la API el stock, las alertas y el resumen de la ubicación activa. */
  async recargar(): Promise<void> {
    const ubicacionId = this.auth.ubicacionActiva()?.ubicacionId;
    if (!ubicacionId) return;

    const numero = ++this.peticionActual;
    const params = { ubicacionId };
    // El cajero solo puede consultar stock; alertas y resumen son de los demás roles
    const veAlertas = this.auth.rol() !== 'CAJERO';

    this.cargando.set(true);
    this.error.set(null);
    try {
      const [stock, alertas, resumen] = await Promise.all([
        firstValueFrom(this.http.get<StockItem[]>(`${API_URL}/inventario/stock`, { params })),
        veAlertas ? firstValueFrom(this.http.get<AlertaStock[]>(`${API_URL}/inventario/alertas`, { params })) : Promise.resolve([]),
        veAlertas ? firstValueFrom(this.http.get<ResumenInventario>(`${API_URL}/inventario/resumen`, { params })) : Promise.resolve(null)
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

  private limpiar(): void {
    this.peticionActual++;
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