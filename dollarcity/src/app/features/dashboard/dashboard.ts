import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { InventarioService } from '../../core/services/inventario.service';

@Component({
    selector: 'app-dashboard',
    imports: [RouterLink],
    template: `
    <section class="pagina">
      <header class="encabezado">
        <div>
          <h1>{{ auth.usuario()?.nombreCompleto }}</h1>
          <p>{{ auth.nombreRol() }} · {{ auth.ubicacionActiva()?.nombre }}</p>
        </div>
      </header>

      <div class="kpis">
        <article class="card kpi">
          <span class="etiqueta">SKUs en esta ubicación</span>
          <strong>{{ inventario.stockActual().length }}</strong>
        </article>
        <article class="card kpi">
          <span class="etiqueta">Alertas activas</span>
          <strong class="rojo">{{ inventario.totalAlertas() }}</strong>
          <a routerLink="/alertas">Ver alertas</a>
        </article>
        <article class="card kpi">
          <span class="etiqueta">Unidades en stock</span>
          <strong>{{ unidades() }}</strong>
        </article>
      </div>

      <div class="card pendiente">
        <span class="etiqueta">Pantalla en construcción</span>
        <p>Aquí irán los KPIs, el flujo de mercancía semanal, el desglose por pasillo y las acciones operativas del prototipo.</p>
      </div>
    </section>
  `,
    styleUrl: '../pagina.css'
})
export class Dashboard {
    protected readonly auth = inject(AuthService);
    protected readonly inventario = inject(InventarioService);
    protected readonly unidades = computed(() =>
        this.inventario.stockActual().reduce((total, s) => total + s.cantidad, 0)
    );
}