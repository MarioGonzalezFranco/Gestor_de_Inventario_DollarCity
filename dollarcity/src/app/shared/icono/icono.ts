import { Component, computed, input } from '@angular/core';

export type NombreIcono =
  | 'dashboard' | 'inventario' | 'abc' | 'alertas' | 'salir' | 'buscar' | 'campana'
  | 'reloj' | 'ojo' | 'ojo-off' | 'menu' | 'ubicacion' | 'candado' | 'caja'
  | 'usuario' | 'escudo' | 'flecha' | 'recibo' | 'escaner' | 'efectivo' | 'tarjeta'
  | 'mas' | 'menos' | 'basura' | 'check' | 'cerrar' | 'descargar' | 'imprimir'
  | 'sin-conexion' | 'sincronizar';

// Cada ícono es un solo trazo SVG (viewBox 24x24)
const ICONOS: Record<NombreIcono, string> = {
  dashboard: 'M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z',
  inventario: 'M21 8l-9-5-9 5 9 5 9-5z M3 8v8l9 5 9-5V8 M12 13v8',
  caja: 'M3 10h18v10H3z M6 10V4h12v6 M7 14h2 M11 14h2 M15 14h2 M7 17h10',
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
  flecha: 'M5 12h14 M13 6l6 6-6 6',
  recibo: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3z M9 8h6 M9 12h6 M9 16h3',
  escaner: 'M3 7V4h3 M18 4h3v3 M21 17v3h-3 M6 20H3v-3 M7 8v8 M10 8v8 M13 8v8 M17 8v8',
  efectivo: 'M2 7h20v10H2z M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M5 10v4 M19 10v4',
  tarjeta: 'M2 6h20v12H2z M2 10h20 M6 15h4',
  mas: 'M12 5v14 M5 12h14',
  menos: 'M5 12h14',
  basura: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  check: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M8 12l3 3 5-6',
  cerrar: 'M6 6l12 12 M18 6L6 18',
  descargar: 'M12 3v12 M7 10l5 5 5-5 M4 17v3h16v-3',
  imprimir: 'M6 9V3h12v6 M6 18H4v-7h16v7h-2 M7 14h10v7H7z',
  'sin-conexion': 'M3 3l18 18 M8.5 16.4a5 5 0 017 0 M5 12.9a10 10 0 015-2.8 M16.7 11.4A10 10 0 0119 12.9 M2 8.8a15 15 0 014.3-2.6 M10.7 5A15 15 0 0122 8.8 M12 20h.01',
  sincronizar: 'M21 12a9 9 0 01-15.4 6.4 M3 12a9 9 0 0115.4-6.4 M19 2v4h-4 M5 22v-4h4'
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