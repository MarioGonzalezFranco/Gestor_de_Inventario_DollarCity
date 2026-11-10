import { Component, inject } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { InventarioService } from '../../core/services/inventario.service';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, CurrencyPipe, DecimalPipe],
  template: `
    <section class="pagina">
      <header class="encabezado">
        <div>
          <h1>{{ auth.usuario()?.nombreCompleto }}</h1>
          <p>{{ auth.nombreRol() }} · {{ auth.ubicacionActiva()?.nombre }}</p>
        </div>
        <button type="button" class="btn btn-secundario" (click)="inventario.recargar()" [disabled]="inventario.cargando()">
          {{ inventario.cargando() ? 'Actualizando…' : 'Actualizar' }}
        </button>
      </header>

      @if (inventario.error(); as mensaje) {
        <div class="card aviso-error" role="alert">{{ mensaje }}</div>
      }

      @if (inventario.resumen(); as r) {
        <div class="kpis">
          <article class="card kpi">
            <span class="etiqueta">SKUs en esta ubicación</span>
            <strong>{{ r.totalSkus | number }}</strong>
          </article>
          <article class="card kpi">
            <span class="etiqueta">Alertas activas</span>
            <strong class="rojo">{{ r.agotados + r.bajoMinimo }}</strong>
            <span class="detalle-kpi">{{ r.agotados }} agotados · {{ r.bajoMinimo }} bajo mínimo</span>
            <a routerLink="/alertas">Ver alertas</a>
          </article>
          <article class="card kpi">
            <span class="etiqueta">Unidades en stock</span>
            <strong>{{ r.unidades | number }}</strong>
          </article>
          <article class="card kpi">
            <span class="etiqueta">Valor a precio de venta</span>
            <strong>{{ r.valorVenta | currency: 'USD' }}</strong>
            <span class="detalle-kpi">Costo: {{ r.valorCosto | currency: 'USD' }}</span>
          </article>
        </div>
      } @else if (inventario.cargando()) {
        <div class="card pendiente"><p>Cargando indicadores…</p></div>
      }

      <div class="card pendiente">
        <span class="etiqueta">Próximamente</span>
        <p>Flujo de mercancía semanal, desglose por pasillo y acciones operativas del prototipo.</p>
      </div>
    </section>
  `,
  styleUrl: '../pagina.css'
})
export class Dashboard {
  protected readonly auth = inject(AuthService);
  protected readonly inventario = inject(InventarioService);
}