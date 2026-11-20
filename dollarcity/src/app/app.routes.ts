import { inject } from '@angular/core';
import { Routes } from '@angular/router';

import { authGuard, guestGuard, roleGuard } from './core/guards/auth.guard';
import { AuthService } from './core/services/auth.service';
import { Shell } from './layout/shell/shell';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login/login').then(m => m.Login)
  },
  // Pantalla completa del cajero (sin menú lateral)
  {
    path: 'punto-venta',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['CAJERO', 'SUPERVISOR'] },
    loadComponent: () => import('./features/punto-venta/punto-venta').then(m => m.PuntoVenta)
  },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    canActivateChild: [roleGuard],
    children: [
      // La pantalla de inicio depende del rol (el cajero no ve el dashboard)
      { path: '', pathMatch: 'full', redirectTo: () => inject(AuthService).rutaInicio() },
      {
        path: 'dashboard',
        data: { roles: ['ADMINISTRADOR', 'SUPERVISOR', 'BODEGUERO'] },
        loadComponent: () => import('./features/dashboard/dashboard').then(m => m.Dashboard)
      },
      {
        path: 'ventas',
        data: { roles: ['ADMINISTRADOR', 'SUPERVISOR', 'CAJERO'] },
        loadComponent: () => import('./features/ventas/ventas').then(m => m.Ventas)
      },
      {
        path: 'inventario',
        data: { roles: ['ADMINISTRADOR', 'SUPERVISOR', 'BODEGUERO', 'CAJERO'] },
        loadComponent: () => import('./features/inventario/inventario').then(m => m.Inventario)
      },
      {
        path: 'matriz-abc',
        data: { roles: ['ADMINISTRADOR', 'SUPERVISOR'] },
        loadComponent: () => import('./features/matriz-abc/matriz-abc').then(m => m.MatrizAbc)
      },
      {
        path: 'alertas',
        data: { roles: ['ADMINISTRADOR', 'SUPERVISOR', 'BODEGUERO'] },
        loadComponent: () => import('./features/alertas/alertas').then(m => m.Alertas)
      },
      {
        path: 'sin-acceso',
        loadComponent: () => import('./features/sin-acceso/sin-acceso').then(m => m.SinAcceso)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];