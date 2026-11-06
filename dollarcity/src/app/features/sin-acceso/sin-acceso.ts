import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { Icono } from '../../shared/icono/icono';

@Component({
  selector: 'app-sin-acceso',
  imports: [RouterLink, Icono],
  template: `
    <section class="pagina">
      <div class="card pendiente centrado">
        <app-icono nombre="candado" [tamano]="32" />
        <h1>No tienes acceso a esta sección</h1>
        <p>Tu rol ({{ auth.nombreRol() }}) no incluye este módulo. Si lo necesitas, solicítalo al administrador.</p>
        <a class="btn btn-primario" [routerLink]="auth.rutaInicio()">Volver al inicio</a>
      </div>
    </section>
  `,
  styleUrl: '../pagina.css'
})
export class SinAcceso {
  protected readonly auth = inject(AuthService);
}