import { Component, computed, inject, signal } from '@angular/core';
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
          <h1>Productos y stock</h1>
          <p>{{ filtrados().length }} de {{ inventario.stockActual().length }} productos</p>
        </div>
        <div class="acciones">
          @if (auth.rol() === 'CAJERO') {
            <span class="chip chip-alerta">Solo consulta</span>
          }
          <label class="filtro">
            <span class="visually-hidden">Filtrar productos</span>
            <input type="search" class="input" placeholder="Filtrar por SKU, código o nombre"
                   [value]="filtro()" (input)="filtro.set($any($event.target).value)">
          </label>
        </div>
      </header>

      @if (inventario.error(); as mensaje) {
        <div class="card aviso-error" role="alert">{{ mensaje }}</div>
      }

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
            @for (s of filtrados(); track s.productoId) {
              <tr>
                <td><span class="mono sku">{{ s.sku }}</span><br><span class="mono ean">{{ s.codigoBarras }}</span></td>
                <td><strong>{{ s.producto }}</strong><br><span class="detalle">{{ s.departamento }} · {{ s.categoria }}</span></td>
                <td class="mono">{{ s.precio | currency: 'USD' }}</td>
                <td class="mono">{{ s.cantidad }}</td>
                <td class="mono">{{ s.stockMinimo }}</td>
                <td><span class="chip" [class]="claseEstado(s.estadoStock)">{{ s.estadoStock }}</span></td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="vacio">
                  {{ inventario.cargando() ? 'Cargando productos…' : 'No hay productos que coincidan.' }}
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
export class Inventario {
  protected readonly auth = inject(AuthService);
  protected readonly inventario = inject(InventarioService);

  protected readonly filtro = signal('');

  /** Filtro local sobre los productos ya cargados de la API. */
  protected readonly filtrados = computed(() => {
    const texto = this.filtro().trim().toLowerCase();
    const stock = this.inventario.stockActual();
    if (!texto) return stock;
    return stock.filter(s =>
      s.sku.toLowerCase().includes(texto) ||
      s.codigoBarras.includes(texto) ||
      s.producto.toLowerCase().includes(texto)
    );
  });

  protected claseEstado(estado: EstadoStock): string {
    switch (estado) {
      case 'AGOTADO': return 'chip-critico';
      case 'BAJO': return 'chip-alerta';
      case 'SOBRESTOCK': return 'chip-alerta';
      default: return 'chip-ok';
    }
  }
}