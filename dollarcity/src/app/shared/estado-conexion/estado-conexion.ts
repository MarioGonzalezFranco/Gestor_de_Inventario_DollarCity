import { Component, computed, inject } from '@angular/core';

import { ColaVentasService } from '../../core/services/cola-ventas.service';
import { ConexionService } from '../../core/services/conexion.service';
import { TiempoRealService } from '../../core/services/tiempo-real.service';

type Estado = 'en-vivo' | 'conectando' | 'reconectando' | 'desconectado';

const TEXTOS: Record<Estado, string> = {
  'en-vivo': 'En vivo',
  conectando: 'Conectando…',
  reconectando: 'Reconectando…',
  desconectado: 'Sin conexión',
};

/**
 * Indicador de conexión. Reemplaza los botones de "Actualizar".
 * Prioridad: API caída > ventas por sincronizar > estado del canal en vivo.
 */
@Component({
  selector: 'app-estado-conexion',
  template: `
    <span class="estado" [attr.data-estado]="estado()" role="status" aria-live="polite" [title]="ayuda()">
      <span class="luz" aria-hidden="true"></span>{{ texto() }}
    </span>
  `,
  styles: [`
    .estado {
      display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px;
      border-radius: 999px; border: 1px solid var(--borde); background: var(--superficie);
      font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--texto-2); white-space: nowrap;
    }
    .luz { width: 8px; height: 8px; border-radius: 50%; background: var(--texto-3); }
    [data-estado="en-vivo"] { color: var(--verde-700); border-color: #BBE5C8; background: var(--verde-100); }
    [data-estado="en-vivo"] .luz { background: #16A34A; animation: latido 2s ease-in-out infinite; }
    [data-estado="conectando"] .luz, [data-estado="reconectando"] .luz { background: #CA8A04; }
    [data-estado="reconectando"] { color: #854D0E; background: var(--amarillo-100); border-color: #F5E08A; }
    [data-estado="desconectado"] { color: var(--rojo-700); background: var(--rojo-100); border-color: var(--rojo-borde); }
    [data-estado="desconectado"] .luz { background: var(--rojo-700); }
    @keyframes latido { 0%, 100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.45); } 50% { box-shadow: 0 0 0 5px rgba(22, 163, 74, 0); } }
    @media (prefers-reduced-motion: reduce) { [data-estado="en-vivo"] .luz { animation: none; } }
  `]
})
export class EstadoConexion {
  private readonly tiempoReal = inject(TiempoRealService);
  private readonly conexion = inject(ConexionService);
  private readonly cola = inject(ColaVentasService);

  private readonly pendientes = computed(() => this.cola.pendientes().length);

  protected readonly estado = computed<Estado>(() => {
    if (!this.conexion.apiDisponible()) return 'desconectado';
    if (this.pendientes() > 0) return 'reconectando';
    return this.tiempoReal.estado();
  });

  protected readonly texto = computed(() => {
    const n = this.pendientes();
    const pendientes = n === 1 ? '1 pendiente' : `${n} pendientes`;
    if (!this.conexion.apiDisponible()) return n ? `Sin conexión · ${pendientes}` : TEXTOS.desconectado;
    if (n) return `Sincronizando · ${pendientes}`;
    return TEXTOS[this.tiempoReal.estado()];
  });

  protected readonly ayuda = computed(() => {
    if (!this.conexion.apiDisponible()) return 'La API no responde. Las ventas se guardan en esta caja y se envían al volver la conexión.';
    if (this.pendientes()) return 'Enviando al servidor las ventas cobradas sin conexión.';
    return this.tiempoReal.estado() === 'en-vivo' ? 'Los datos se actualizan solos' : 'Intentando recuperar la conexión con el servidor';
  });
}