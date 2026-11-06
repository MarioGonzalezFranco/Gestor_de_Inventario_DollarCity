import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Rol } from '../models/usuario.model';
import { AuthService } from '../services/auth.service';

/** Exige sesión; si no hay, manda al login recordando la ruta pedida. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.estaAutenticado()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { redirect: state.url } });
};

/** Evita volver al login con la sesión ya iniciada. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (!auth.estaAutenticado()) return true;
  return inject(Router).parseUrl(auth.rutaInicio());
};

/** Revisa data.roles de la ruta. Sin roles declarados, entra cualquiera con sesión. */
export const roleGuard: CanActivateFn = (route) => {
  const roles = route.data?.['roles'] as Rol[] | undefined;
  if (!roles || inject(AuthService).tieneRol(roles)) return true;
  return inject(Router).parseUrl('/sin-acceso');
};