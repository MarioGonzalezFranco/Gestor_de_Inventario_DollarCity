import { Component, inject } from '@angular/core';

import { InventarioService } from '../../core/services/inventario.service';

@Component({
  selector: 'app-alertas',
  template: `
    <section class="pagina">
      <header class="encabezado">
        <div>
          <span class="etiqueta">Motor de reorden</span>
          <h1>Alertas &amp; Reorden</h1>
        </div>
        <span class="chip chip-critico">{{ inventario.totalAlertas() }} alertas</span>
      </header>
      <div class="card pendiente">
        <span class="etiqueta">Pantalla en construcción</span>
        <p>Tarjetas de quiebre con demanda diaria, lead time, stock de seguridad y punto de reorden; camiones en ruta y reglas de automatización.</p>
      </div>
    </section>
  `,
  styleUrl: '../pagina.css'
})
export class Alertas {
  protected readonly inventario = inject(InventarioService);
}