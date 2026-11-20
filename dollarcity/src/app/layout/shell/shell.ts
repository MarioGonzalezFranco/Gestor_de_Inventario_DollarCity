import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { APP_NOMBRE, APP_SUBTITULO, MENU } from '../../core/config/constantes';
import { AuthService } from '../../core/services/auth.service';
import { InventarioService } from '../../core/services/inventario.service';
import { Icono } from '../../shared/icono/icono';
import { EstadoConexion } from '../../shared/estado-conexion/estado-conexion';

@Component({
  selector: 'app-shell',
    imports: [RouterOutlet, RouterLink, RouterLinkActive, Icono, EstadoConexion],
  templateUrl: './shell.html',
  styleUrl: './shell.css'
})
export class Shell {
  protected readonly auth = inject(AuthService);
  protected readonly inventario = inject(InventarioService);
  private readonly router = inject(Router);

  protected readonly appNombre = APP_NOMBRE;
  protected readonly appSubtitulo = APP_SUBTITULO;
  protected readonly menuAbierto = signal(false);

  /** Opciones que el rol puede ver, agrupadas por sección (se omiten grupos vacíos). */
  protected readonly grupos = computed(() => {
    const visibles = MENU.filter(item => this.auth.tieneRol(item.roles));
    const nombres = [...new Set(visibles.map(item => item.grupo))];
    return nombres.map(nombre => ({ nombre, items: visibles.filter(item => item.grupo === nombre) }));
  });

  /** Fecha y turno de la barra superior (el turno se calcula por la hora mientras no exista la tabla turnos). */
  protected readonly fecha = new Intl.DateTimeFormat('es-SV', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  protected readonly turno = this.calcularTurno(new Date().getHours());

  protected cambiarUbicacion(evento: Event): void {
    const id = Number((evento.target as HTMLSelectElement).value);
    this.auth.cambiarUbicacion(id);
  }

  protected alternarMenu(): void {
    this.menuAbierto.update(v => !v);
  }

  protected cerrarSesion(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  private calcularTurno(hora: number): string {
    if (hora >= 6 && hora < 14) return 'Turno Matutino';
    if (hora >= 14 && hora < 22) return 'Turno Vespertino';
    return 'Turno Nocturno';
  }
}