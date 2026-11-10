import { Component, inject } from '@angular/core';

import { InventarioService } from '../../core/services/inventario.service';

@Component({
  selector: 'app-alertas',
  template: `
    <section class="pagina">
      <header class="encabezado">
        <div>
          <span class="etiqueta">Motor de reorden</span>
          <h1>Alertas de stock</h1>
          <p>Productos agotados o por debajo del mínimo, con la cantidad sugerida para reponer.</p>
        </div>
        <span class="chip chip-critico">{{ inventario.totalAlertas() }} alertas</span>
      </header>

      @if (inventario.error(); as mensaje) {
        <div class="card aviso-error" role="alert">{{ mensaje }}</div>
      }

      <div class="card tabla-caja">
        <table>
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col">Producto</th>
              <th scope="col">Stock</th>
              <th scope="col">Mínimo</th>
              <th scope="col">Sugerido reponer</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            @for (a of inventario.alertas(); track a.productoId) {
              <tr>
                <td><span class="mono sku">{{ a.sku }}</span></td>
                <td><strong>{{ a.producto }}</strong><br><span class="detalle">{{ a.departamento }} · {{ a.categoria }}</span></td>
                <td class="mono">{{ a.cantidad }}</td>
                <td class="mono">{{ a.stockMinimo }}</td>
                <td class="mono"><strong>+{{ a.cantidadSugerida }}</strong></td>
                <td>
                  <span class="chip" [class]="a.estadoStock === 'AGOTADO' ? 'chip-critico' : 'chip-alerta'">{{ a.estadoStock }}</span>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="vacio">
                  {{ inventario.cargando() ? 'Cargando alertas…' : 'No hay productos por reponer en esta ubicación.' }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styleUrl: '../pagina.css'
})
export class Alertas {
  protected readonly inventario = inject(InventarioService);
}