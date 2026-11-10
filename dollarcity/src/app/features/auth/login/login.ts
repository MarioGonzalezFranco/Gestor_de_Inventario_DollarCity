import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { MOSTRAR_USUARIOS_DEMO } from '../../../core/config/constantes';
import { AuthService } from '../../../core/services/auth.service';

interface Estadistica {
  valor: string;
  titulo: string;
  nota: string;
  colorValor: 'amarillo' | 'blanco' | 'ambar';
  colorNota: 'verde' | 'menta' | 'amarillo';
  conPunto?: boolean;
}

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // ---- Contenido del panel izquierdo ----
  protected readonly estadisticas: Estadistica[] = [
    { valor: 'CEDI', titulo: 'Abastece a cada tienda', nota: 'En línea', colorValor: 'amarillo', colorNota: 'verde', conPunto: true },
    { valor: '4', titulo: 'Roles de acceso', nota: 'Permisos por rol', colorValor: 'blanco', colorNota: 'menta' },
    { valor: 'Live', titulo: 'Alertas reorden', nota: 'Matriz ABC activa', colorValor: 'ambar', colorNota: 'amarillo' }
  ];

  protected readonly zonas = [
    { nombre: 'CEDI Central', color: 'verde' },
    { nombre: 'Recepción & Picking', color: 'amarillo' },
    { nombre: 'Distribución Nacional', color: 'turquesa' }
  ];

  // ---- Usuarios de prueba (solo el nombre; la contraseña se escribe a mano) ----
  protected readonly mostrarDemo = MOSTRAR_USUARIOS_DEMO;
  protected readonly rolesDemo = [
    { etiqueta: 'Admin', usuario: 'admin' },
    { etiqueta: 'Bodega', usuario: 'bodega01' },
    { etiqueta: 'Supervisor', usuario: 'super001' },
    { etiqueta: 'Cajero', usuario: 'cajero001' }
  ];

  // ---- Formulario ----
  protected readonly form = inject(FormBuilder).nonNullable.group({
    usuario: [''],
    clave: [''],
    recordar: [true]
  });

  protected readonly cargando = signal(false);
  protected readonly verClave = signal(false);
  protected readonly destello = signal(false);
  protected readonly error = signal<{ titulo: string; mensaje: string } | null>(null);

  protected async ingresar(): Promise<void> {
    if (this.cargando()) return;
    this.cargando.set(true);
    this.error.set(null);

    const { usuario, clave, recordar } = this.form.getRawValue();
    const resultado = await this.auth.login(usuario, clave, recordar);
    this.cargando.set(false);

    if (!resultado.ok) {
      this.error.set({ titulo: resultado.titulo, mensaje: resultado.mensaje });
      this.form.controls.clave.reset('');
      return;
    }

    const redirect = this.route.snapshot.queryParamMap.get('redirect');
    this.router.navigateByUrl(redirect && redirect !== '/' ? redirect : this.auth.rutaInicio());
  }

  /** Llena el usuario de prueba con un destello; la contraseña la escribe el usuario. */
  protected usarDemo(usuario: string): void {
    this.form.patchValue({ usuario, clave: '' });
    document.getElementById('clave')?.focus();
    this.error.set(null);
    this.destello.set(false);
    setTimeout(() => this.destello.set(true));
    setTimeout(() => this.destello.set(false), 650);
  }
}