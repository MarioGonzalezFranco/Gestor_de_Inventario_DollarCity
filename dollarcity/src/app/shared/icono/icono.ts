import { Component, computed, input } from '@angular/core';

export type NombreIcono =
  | 'dashboard' | 'inventario' | 'abc' | 'alertas' | 'salir' | 'buscar' | 'campana'
  | 'reloj' | 'ojo' | 'ojo-off' | 'menu' | 'ubicacion' | 'candado' | 'caja'
  | 'usuario' | 'escudo' | 'flecha';

// Cada ícono es un solo trazo SVG (viewBox 24x24)
const ICONOS: Record<NombreIcono, string> = {
  dashboard: 'M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z',
  inventario: 'M21 8l-9-5-9 5 9 5 9-5z M3 8v8l9 5 9-5V8 M12 13v8',
  caja: 'M21 8l-9-5-9 5 9 5 9-5z M3 8v8l9 5 9-5V8 M12 13v8',
  abc: 'M3 3v18h18 M7 15l4-4 3 3 5-6',
  alertas: 'M12 3l9 16H3L12 3z M12 10v4 M12 17h.01',
  salir: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4 M16 17l5-5-5-5 M21 12H9',
  buscar: 'M4 11a7 7 0 1 0 14 0a7 7 0 1 0 -14 0 M20 20l-3.5-3.5',
  campana: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 01-3.4 0',
  reloj: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M12 7v5l3 2',
  ojo: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
  'ojo-off': 'M3 3l18 18 M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.2 M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6 M9.9 9.9a3 3 0 004.2 4.2',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  ubicacion: 'M12 21s-7-6.2-7-12a7 7 0 0114 0c0 5.8-7 12-7 12z M9.5 9a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0',
  candado: 'M4 11h16v10H4z M8 11V7a4 4 0 018 0v4',
  usuario: 'M20 21a8 8 0 10-16 0 M8 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
  escudo: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z M9 12l2 2 4-4',
  flecha: 'M5 12h14 M13 6l6 6-6 6'
};

@Component({
  selector: 'app-icono',
  template: `
    <svg [attr.width]="tamano()" [attr.height]="tamano()" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" [attr.stroke-width]="grosor()" stroke-linecap="round"
         stroke-linejoin="round" aria-hidden="true">
      <path [attr.d]="trazo()"></path>
    </svg>
  `,
  styles: [':host { display: inline-flex; line-height: 0; }']
})
export class Icono {
  readonly nombre = input.required<NombreIcono>();
  readonly tamano = input(20);
  readonly grosor = input(2);
  protected readonly trazo = computed(() => ICONOS[this.nombre()]);
}