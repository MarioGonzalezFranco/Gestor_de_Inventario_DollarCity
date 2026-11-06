import { Injectable, computed, inject } from '@angular/core';

import { STOCK } from '../data/mock-data';
import { StockItem } from '../models/inventario.model';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class InventarioService {
  private readonly auth = inject(AuthService);

  /** Stock de la ubicación activa (se recalcula al cambiar de ubicación). */
  readonly stockActual = computed<StockItem[]>(() => {
    const id = this.auth.ubicacionActiva()?.ubicacionId;
    return STOCK.filter(s => s.ubicacionId === id);
  });

  /** Equivale a la vista v_alertas_reabastecimiento. */
  readonly alertas = computed(() =>
    this.stockActual().filter(s => s.estadoStock === 'AGOTADO' || s.estadoStock === 'BAJO')
  );

  readonly totalAlertas = computed(() => this.alertas().length);
}