import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { TimeoutError, firstValueFrom, timeout } from 'rxjs';

import { API_URL } from '../config/constantes';
import {
  Autorizador, CatalogoLocal, Departamento, NuevaVenta, ProductoVenta, Venta, VentaPendiente,
  VentaRegistrada, VentaSincronizada, VentasDelDia
} from '../models/venta.model';
import { AuthService } from './auth.service';

// Si el servidor no contesta en este tiempo, la caja pasa a trabajar sin conexión
const ESPERA_COBRO_MS = 12000;
const ESPERA_SINCRONIZAR_MS = 20000;
const ESPERA_CATALOGO_MS = 15000;

@Injectable({ providedIn: 'root' })
export class VentasService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly url = `${API_URL}/ventas`;

  departamentos(): Promise<Departamento[]> {
    return firstValueFrom(this.http.get<Departamento[]>(`${this.url}/departamentos`));
  }

  catalogo(filtro: { departamentoId: number | null; buscar: string }): Promise<ProductoVenta[]> {
    const params: Record<string, string | number> = { ...this.ubicacion(), limite: 48 };
    if (filtro.departamentoId) params['departamentoId'] = filtro.departamentoId;
    if (filtro.buscar) params['buscar'] = filtro.buscar;
    return firstValueFrom(this.http.get<ProductoVenta[]>(`${this.url}/catalogo`, { params }));
  }

  /** Copia completa del catálogo de la tienda para trabajar sin conexión. */
  catalogoLocal(): Promise<CatalogoLocal> {
    return firstValueFrom(
      this.http.get<CatalogoLocal>(`${this.url}/catalogo-local`, { params: this.ubicacion() }).pipe(timeout(ESPERA_CATALOGO_MS))
    );
  }

  /** Supervisores con PIN de la tienda (solo el hash del PIN). */
  autorizadores(): Promise<Autorizador[]> {
    return firstValueFrom(
      this.http.get<Autorizador[]>(`${this.url}/autorizadores`, { params: this.ubicacion() }).pipe(timeout(ESPERA_CATALOGO_MS))
    );
  }

  /** Búsqueda exacta por código de barras o SKU (lector). */
  porCodigo(codigo: string): Promise<ProductoVenta> {
    return firstValueFrom(
      this.http.get<ProductoVenta>(`${this.url}/codigo/${encodeURIComponent(codigo)}`, { params: this.ubicacion() })
    );
  }

  registrar(venta: NuevaVenta): Promise<VentaRegistrada> {
    return firstValueFrom(
      this.http.post<VentaRegistrada>(this.url, venta, { params: this.ubicacion() }).pipe(timeout(ESPERA_COBRO_MS))
    );
  }

  /** Envía una venta cobrada sin conexión. Si ya existía (mismo uuid), el servidor la devuelve. */
  sincronizar(venta: VentaPendiente): Promise<VentaSincronizada> {
    const cuerpo = {
      uuid: venta.uuid,
      ticketProvisional: venta.ticketProvisional,
      fechaVenta: venta.fechaVenta,
      usuarioId: venta.usuarioId,
      autorizadaPor: venta.autorizadaPor,
      metodoPago: venta.metodoPago,
      lineas: venta.lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, precioUnitario: l.precioUnitario }))
    };
    return firstValueFrom(
      this.http
        .post<VentaSincronizada>(`${this.url}/sincronizar`, cuerpo, { params: { ubicacionId: venta.ubicacionId } })
        .pipe(timeout(ESPERA_SINCRONIZAR_MS))
    );
  }

  delDia(fecha: string): Promise<VentasDelDia> {
    return firstValueFrom(this.http.get<VentasDelDia>(this.url, { params: { ...this.ubicacion(), fecha } }));
  }

  /** Ventas sin conexión con faltante o diferencia de precio sin revisar (cualquier fecha). */
  porRevisar(): Promise<Venta[]> {
    return firstValueFrom(this.http.get<Venta[]>(`${this.url}/por-revisar`, { params: this.ubicacion() }));
  }

  detalle(ventaId: number): Promise<Venta> {
    return firstValueFrom(this.http.get<Venta>(`${this.url}/${ventaId}`, { params: this.ubicacion() }));
  }

  anular(ventaId: number, motivo: string): Promise<Venta> {
    return firstValueFrom(this.http.post<Venta>(`${this.url}/${ventaId}/anular`, { motivo }, { params: this.ubicacion() }));
  }

  revisar(ventaId: number, observacion: string): Promise<Venta> {
    return firstValueFrom(
      this.http.post<Venta>(`${this.url}/${ventaId}/revisar`, { observacion }, { params: this.ubicacion() })
    );
  }

  /** Mensaje legible de un error de la API. */
  mensajeDeError(error: unknown, porDefecto = 'No se pudo completar la operación.'): string {
    if (error instanceof TimeoutError) return 'El servidor tardó demasiado en responder.';
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'No hay conexión con el servidor. Revisa que la API esté encendida.';
      return (error.error as { mensaje?: string } | null)?.mensaje ?? porDefecto;
    }
    return porDefecto;
  }

  // El administrador elige la ubicación; para el resto la API usa la suya
  private ubicacion(): Record<string, number> {
    const id = this.auth.ubicacionActiva()?.ubicacionId;
    return id ? { ubicacionId: id } : {};
  }
}