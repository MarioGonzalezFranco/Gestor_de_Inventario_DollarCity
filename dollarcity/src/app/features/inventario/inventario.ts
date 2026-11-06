import { Component, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';

import { EstadoStock } from '../../core/models/inventario.model';
import { AuthService } from '../../core/services/auth.service';
import { InventarioService } from '../../core/services/inventario.service';

@Component({
  selector: 'app-inventario',
  imports: [CurrencyPipe],
  template: `
    <section class="pagina">
      <header class="encabezado">
        <div>
          <span class="etiqueta">Catálogo activo · {{ auth.ubicacionActiva()?.codigo }}</span>
          <h1>Gestión de Catálogo &amp; Stock Físico</h1>
        </div>
        @if (auth.rol() === 'CAJERO') {
          <span class="chip chip-alerta">Solo consulta</span>
        }
      </header>

      <div class="card tabla-caja">
        <table>
          <thead>
            <tr>
              <th scope="col">SKU / EAN-13</th>
              <th scope="col">Producto</th>
              <th scope="col">Precio</th>
              <th scope="col">Stock</th>
              <th scope="col">Mínimo</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            @for (s of inventario.stockActual(); track s.sku) {
              <tr>
                <td><span class="mono sku">{{ s.sku }}</span><br><span class="mono ean">{{ s.codigoBarras }}</span></td>
                <td><strong>{{ s.producto }}</strong><br><span class="detalle">{{ s.departamento }} · {{ s.categoria }}</span></td>
                <td class="mono">{{ s.precio | currency: 'USD' }}</td>
                <td class="mono">{{ s.cantidad }}</td>
                <td class="mono">{{ s.stockMinimo }}</td>
                <td><span class="chip" [class]="claseEstado(s.estadoStock)">{{ s.estadoStock }}</span></td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="vacio">No hay productos cargados para esta ubicación en los datos simulados.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styleUrl: '../pagina.css'
})
export class Inventario {
  protected readonly auth = inject(AuthService);
  protected readonly inventario = inject(InventarioService);

  protected claseEstado(estado: EstadoStock): string {
    switch (estado) {
      case 'AGOTADO': return 'chip-critico';
      case 'BAJO': return 'chip-alerta';
      case 'SOBRESTOCK': return 'chip-alerta';
      default: return 'chip-ok';
    }
  }
}