import { Component, DestroyRef, afterNextRender, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';

import { Departamento, LineaTicket, MetodoPago, ProductoVenta, VentaRegistrada } from '../../core/models/venta.model';
import { AuthService } from '../../core/services/auth.service';
import { AutorizacionService } from '../../core/services/autorizacion.service';
import { CatalogoLocalService } from '../../core/services/catalogo-local.service';
import {
  ColaVentasService, LIMITE_HORAS_SIN_CONEXION, LIMITE_VENTAS_SIN_CONEXION, ResultadoSincronizacion
} from '../../core/services/cola-ventas.service';
import { ConexionService } from '../../core/services/conexion.service';
import { EventoTiempoReal, TiempoRealService } from '../../core/services/tiempo-real.service';
import { TicketService } from '../../core/services/ticket.service';
import { VentasService } from '../../core/services/ventas.service';
import { nuevoUuid } from '../../core/utils/uuid';
import { EstadoConexion } from '../../shared/estado-conexion/estado-conexion';
import { Icono } from '../../shared/icono/icono';

type TipoAviso = 'ok' | 'error' | 'info';

/** Intento de cobro: mientras el ticket no cambie se reutiliza el mismo uuid (no se duplica). */
interface IntentoCobro {
  firma: string;
  uuid: string;
}

/** Ticket en curso guardado en el navegador por si la página se cierra. */
interface TicketGuardado {
  lineas: LineaTicket[];
  metodo: MetodoPago;
  recibido: number | null;
  intento: IntentoCobro | null;
  guardado: string;
}

const IVA = 0.13;
const MAX_CANTIDAD = 999;
const ESPERA_BUSQUEDA_MS = 300;
const DURACION_AVISO_MS = 2500;
const DURACION_AVISO_LARGO_MS = 5000;
// "3*7402000000040" o "3x DC-0040" agrega 3 unidades
const PATRON_CANTIDAD = /^(\d{1,3})\s*[*xX]\s*(.+)$/;

@Component({
  selector: 'app-punto-venta',
  imports: [CurrencyPipe, DatePipe, RouterLink, Icono, EstadoConexion],
  templateUrl: './punto-venta.html',
  styleUrl: './punto-venta.css'
})
export class PuntoVenta {
  protected readonly auth = inject(AuthService);
  private readonly ventas = inject(VentasService);
  private readonly tiempoReal = inject(TiempoRealService);
  private readonly tickets = inject(TicketService);
  private readonly router = inject(Router);
  protected readonly conexion = inject(ConexionService);
  protected readonly catalogo = inject(CatalogoLocalService);
  protected readonly cola = inject(ColaVentasService);
  private readonly autorizacion = inject(AutorizacionService);

  private readonly buscador = viewChild.required<ElementRef<HTMLInputElement>>('buscador');
  private readonly campoEfectivo = viewChild<ElementRef<HTMLInputElement>>('campoEfectivo');
  private readonly botonNuevaVenta = viewChild<ElementRef<HTMLButtonElement>>('botonNuevaVenta');
  private readonly campoPin = viewChild<ElementRef<HTMLInputElement>>('campoPin');

  private temporizadorBusqueda?: ReturnType<typeof setTimeout>;
  private temporizadorAviso?: ReturnType<typeof setTimeout>;
  private temporizadorVaciar?: ReturnType<typeof setTimeout>;
  private temporizadorSalir?: ReturnType<typeof setTimeout>;
  private peticionCatalogo = 0;
  private intento: IntentoCobro | null = null;

  protected readonly limiteVentas = LIMITE_VENTAS_SIN_CONEXION;
  protected readonly limiteHoras = LIMITE_HORAS_SIN_CONEXION;

  // ---- Catálogo ----
  private readonly departamentosServidor = signal<Departamento[]>([]);
  protected readonly departamentos = computed(() =>
    this.catalogo.listo() ? this.catalogo.departamentos() : this.departamentosServidor()
  );
  protected readonly departamentoId = signal<number | null>(null);
  protected readonly texto = signal('');
  private readonly busqueda = signal('');
  protected readonly productos = signal<ProductoVenta[]>([]);
  protected readonly cargandoCatalogo = signal(false);
  protected readonly errorCatalogo = signal<string | null>(null);

  // ---- Ticket ----
  protected readonly lineas = signal<LineaTicket[]>([]);
  protected readonly metodo = signal<MetodoPago>('EFECTIVO');
  protected readonly recibido = signal<number | null>(null);
  protected readonly procesando = signal(false);
  protected readonly confirmarVaciar = signal(false);
  protected readonly ultimoAgregado = signal<number | null>(null);
  protected readonly ventaRegistrada = signal<VentaRegistrada | null>(null);
  protected readonly generandoTicket = signal(false);
  protected readonly aviso = signal<{ texto: string; tipo: TipoAviso } | null>(null);
  protected readonly ahora = signal(new Date());

  // ---- Sin conexión ----
  protected readonly ticketRecuperable = signal<TicketGuardado | null>(null);
  protected readonly pedirPin = signal(false);
  protected readonly pin = signal('');
  protected readonly errorPin = signal<string | null>(null);
  protected readonly verificandoPin = signal(false);
  protected readonly verCola = signal(false);
  protected readonly confirmarSalir = signal(false);

  protected readonly modoSinConexion = computed(() => !this.conexion.apiDisponible());
  protected readonly totalCola = computed(() => this.cola.ventas().length);

  protected readonly esSupervisor = computed(() => this.auth.rol() === 'SUPERVISOR');
  protected readonly turno = computed(() => {
    const hora = this.ahora().getHours();
    if (hora >= 6 && hora < 14) return 'Matutino';
    if (hora >= 14 && hora < 22) return 'Vespertino';
    return 'Nocturno';
  });

  protected readonly articulos = computed(() => this.lineas().reduce((s, l) => s + l.cantidad, 0));
  protected readonly total = computed(() => redondear(this.lineas().reduce((s, l) => s + l.precio * l.cantidad, 0)));
  /** Los precios ya incluyen IVA: solo se informa la parte que corresponde. */
  protected readonly ivaIncluido = computed(() => redondear(this.total() - this.total() / (1 + IVA)));
  protected readonly enTicket = computed(() => new Map<number, number>(this.lineas().map((l) => [l.productoId, l.cantidad] as const)));
  protected readonly hayExcedidos = computed(() => this.lineas().some((l) => l.cantidad > l.stock));

  protected readonly cambio = computed(() => {
    const recibido = this.recibido();
    return this.metodo() === 'EFECTIVO' && recibido !== null ? redondear(recibido - this.total()) : null;
  });
  protected readonly faltaEfectivo = computed(() => (this.cambio() ?? 0) < 0);
  protected readonly montoCambio = computed(() => Math.abs(this.cambio() ?? 0));

  /** Billetes con los que el cliente probablemente pagará. */
  protected readonly montosRapidos = computed(() => {
    const t = this.total();
    if (t <= 0) return [];
    const opciones = new Set([Math.ceil(t), Math.ceil(t / 5) * 5, Math.ceil(t / 10) * 10, Math.ceil(t / 20) * 20]);
    return [...opciones].filter((v) => v > t + 0.001).sort((a, b) => a - b).slice(0, 3);
  });

  /** En línea no se cobra más que el stock; sin conexión solo se acepta efectivo. */
  protected readonly puedeCobrar = computed(
    () =>
      this.lineas().length > 0 &&
      !this.procesando() &&
      !this.faltaEfectivo() &&
      (this.modoSinConexion() ? this.metodo() === 'EFECTIVO' : !this.hayExcedidos())
  );

  private readonly claveTicket = computed(() => {
    const usuarioId = this.auth.usuario()?.usuarioId;
    const ubicacionId = this.auth.ubicacionActiva()?.ubicacionId;
    return usuarioId && ubicacionId ? `dc_caja_ticket_${usuarioId}_${ubicacionId}` : null;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    const reloj = setInterval(() => this.ahora.set(new Date()), 1000);
    destroyRef.onDestroy(() => {
      clearInterval(reloj);
      clearTimeout(this.temporizadorBusqueda);
      clearTimeout(this.temporizadorAviso);
      clearTimeout(this.temporizadorVaciar);
      clearTimeout(this.temporizadorSalir);
    });

    // Ticket que quedó a medias si la página se cerró o el equipo se reinició
    this.ticketRecuperable.set(this.leerTicketGuardado());

    // Cada cambio del ticket se guarda en el navegador (salvo mientras se decide recuperar el anterior)
    effect(() => {
      const lineas = this.lineas();
      const metodo = this.metodo();
      const recibido = this.recibido();
      if (this.ticketRecuperable()) return;
      untracked(() => this.guardarTicketEnCurso(lineas, metodo, recibido));
    });

    this.ventas.departamentos()
      .then((lista) => this.departamentosServidor.set(lista))
      .catch(() => this.departamentosServidor.set([]));

    // Con la copia local del catálogo se filtra en la caja; sin ella, se consulta a la API
    effect(() => {
      const filtro = { departamentoId: this.departamentoId(), buscar: this.busqueda() };
      if (this.catalogo.listo()) {
        this.catalogo.productos(); // se vuelve a filtrar con cada cambio de stock
        untracked(() => {
          this.peticionCatalogo++;
          this.cargandoCatalogo.set(false);
          this.errorCatalogo.set(null);
          this.productos.set(this.catalogo.buscar(filtro));
        });
      } else {
        untracked(() => void this.cargarCatalogo(filtro));
      }
    });

    // Sin conexión no se cobra con tarjeta
    effect(() => {
      if (!this.modoSinConexion()) return;
      untracked(() => {
        if (this.metodo() === 'TARJETA') {
          this.metodo.set('EFECTIVO');
          this.avisar('Sin conexión solo se acepta efectivo.', 'info');
        }
      });
    });

    // Al cerrar el aviso de venta registrada, el foco vuelve al botón de nueva venta
    effect(() => {
      if (this.ventaRegistrada()) queueMicrotask(() => this.botonNuevaVenta()?.nativeElement.focus());
    });

    this.tiempoReal.eventos$.pipe(takeUntilDestroyed()).subscribe((evento) => this.alRecibir(evento));
    this.cola.resultado$.pipe(takeUntilDestroyed()).subscribe((r) => this.alSincronizar(r));

    // El cursor queda listo en el buscador para usar el lector de código de barras
    afterNextRender(() => this.enfocarBuscador());
  }

  // ===================== Búsqueda y catálogo =====================

  protected escribir(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.texto.set(valor);
    clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => {
      const limpio = valor.trim();
      // Con una sola letra no se filtra; tampoco cuando lleva "3*" adelante
      this.busqueda.set(limpio.length >= 2 && !PATRON_CANTIDAD.test(limpio) ? limpio : '');
    }, ESPERA_BUSQUEDA_MS);
  }

  /** Enter en el buscador: lector de código de barras o búsqueda escrita. */
  protected async escanear(): Promise<void> {
    const entrada = this.texto().trim();
    if (!entrada) return;

    const partes = PATRON_CANTIDAD.exec(entrada);
    const cantidad = partes ? Number(partes[1]) : 1;
    const codigo = (partes ? partes[2] : entrada).trim();

    const local =
      this.catalogo.porCodigo(codigo) ??
      this.productos().find((p) => p.codigoBarras === codigo || p.sku.toUpperCase() === codigo.toUpperCase());
    if (local) {
      if (this.agregar(local, cantidad)) this.limpiarBusqueda();
      return;
    }

    // Si el texto no es un código pero la búsqueda dejó un solo producto, se agrega ese
    const visibles = this.productos();
    const unico = visibles.length === 1 ? visibles[0] : null;

    if (this.modoSinConexion() || this.catalogo.listo()) {
      if (unico) {
        if (this.agregar(unico, cantidad)) this.limpiarBusqueda();
        return;
      }
      this.avisar(`No se encontró "${codigo}" en el catálogo de la tienda.`, 'error');
      this.buscador().nativeElement.select();
      return;
    }

    try {
      const producto = await this.ventas.porCodigo(codigo);
      if (this.agregar(producto, cantidad)) this.limpiarBusqueda();
    } catch (error) {
      if (unico && !(await this.conexion.esCaida(error))) {
        if (this.agregar(unico, cantidad)) this.limpiarBusqueda();
        return;
      }
      this.avisar(this.ventas.mensajeDeError(error, `No se encontró "${codigo}".`), 'error');
      this.buscador().nativeElement.select();
    }
  }

  protected limpiarBusqueda(): void {
    clearTimeout(this.temporizadorBusqueda);
    this.texto.set('');
    this.busqueda.set('');
    this.enfocarBuscador();
  }

  protected elegirDepartamento(id: number | null): void {
    this.departamentoId.set(id);
    this.enfocarBuscador();
  }

  /** Solo se usa mientras la caja no tiene la copia local del catálogo. */
  private async cargarCatalogo(filtro: { departamentoId: number | null; buscar: string }): Promise<void> {
    const numero = ++this.peticionCatalogo;
    this.cargandoCatalogo.set(true);
    this.errorCatalogo.set(null);
    try {
      const lista = await this.ventas.catalogo(filtro);
      if (numero === this.peticionCatalogo) this.productos.set(lista);
    } catch (error) {
      if (numero !== this.peticionCatalogo) return;
      this.errorCatalogo.set(
        (await this.conexion.esCaida(error))
          ? 'Sin conexión y esta caja todavía no tiene el catálogo guardado. Se cargará al volver la conexión.'
          : this.ventas.mensajeDeError(error, 'No se pudo cargar el catálogo.')
      );
    } finally {
      if (numero === this.peticionCatalogo) this.cargandoCatalogo.set(false);
    }
  }

  // ===================== Ticket =====================

  protected agregarDesdeCatalogo(producto: ProductoVenta): void {
    this.agregar(producto, 1);
    this.enfocarBuscador();
  }

  /**
   * Devuelve false si no se pudo agregar.
   * En línea no se pasa del stock. Sin conexión se permite (el producto está en la mano
   * del cliente) y la venta quedará como "venta con faltante" para el supervisor.
   */
  private agregar(producto: ProductoVenta, cantidad: number): boolean {
    const sinConexion = this.modoSinConexion();
    if (producto.cantidad <= 0 && !sinConexion) {
      this.avisar(`${producto.producto} está agotado.`, 'error');
      return false;
    }
    const actual = this.lineas().find((l) => l.productoId === producto.productoId);
    const nueva = (actual?.cantidad ?? 0) + cantidad;
    if (nueva > MAX_CANTIDAD) {
      this.avisar(`La cantidad máxima por producto es ${MAX_CANTIDAD}.`, 'error');
      return false;
    }
    if (nueva > producto.cantidad && !sinConexion) {
      this.avisar(`Solo hay ${producto.cantidad} unidades de ${producto.producto}.`, 'error');
      return false;
    }

    this.lineas.update((lista) =>
      actual
        ? lista.map((l) => (l.productoId === producto.productoId ? { ...l, cantidad: nueva, stock: producto.cantidad } : l))
        : [
            { productoId: producto.productoId, sku: producto.sku, producto: producto.producto, precio: producto.precio, cantidad, stock: producto.cantidad },
            ...lista
          ]
    );
    this.ultimoAgregado.set(producto.productoId);
    this.cancelarVaciado();
    if (nueva > producto.cantidad) {
      this.avisar(`El sistema registra ${producto.cantidad} de ${producto.producto}: la venta quedará con faltante para revisión.`, 'info', DURACION_AVISO_LARGO_MS);
    } else {
      this.avisar(`+${cantidad} ${producto.producto}`, 'ok');
    }
    return true;
  }

  protected cambiarCantidad(linea: LineaTicket, delta: number): void {
    this.fijar(linea, linea.cantidad + delta);
  }

  protected escribirCantidad(linea: LineaTicket, evento: Event): void {
    const campo = evento.target as HTMLInputElement;
    const valor = Math.floor(Number(campo.value));
    if (!Number.isFinite(valor)) {
      campo.value = String(linea.cantidad);
      return;
    }
    this.fijar(linea, valor);
    campo.value = String(this.lineas().find((l) => l.productoId === linea.productoId)?.cantidad ?? '');
  }

  private fijar(linea: LineaTicket, cantidad: number): void {
    if (cantidad > MAX_CANTIDAD) {
      this.avisar(`La cantidad máxima por producto es ${MAX_CANTIDAD}.`, 'error');
      cantidad = MAX_CANTIDAD;
    }
    if (cantidad > linea.stock && !this.modoSinConexion()) {
      this.avisar(`Solo hay ${linea.stock} unidades de ${linea.producto}.`, 'error');
      cantidad = linea.stock;
    }
    if (cantidad <= 0) {
      this.quitar(linea);
      return;
    }
    this.lineas.update((lista) => lista.map((l) => (l.productoId === linea.productoId ? { ...l, cantidad } : l)));
  }

  protected quitar(linea: LineaTicket): void {
    this.lineas.update((lista) => lista.filter((l) => l.productoId !== linea.productoId));
    this.avisar(`${linea.producto} se quitó del ticket.`, 'info');
    this.enfocarBuscador();
  }

  /** Primer clic (o Esc) pide confirmación; el segundo vacía el ticket. */
  protected vaciar(): void {
    if (!this.lineas().length) return;
    if (!this.confirmarVaciar()) {
      this.confirmarVaciar.set(true);
      clearTimeout(this.temporizadorVaciar);
      this.temporizadorVaciar = setTimeout(() => this.confirmarVaciar.set(false), 3000);
      return;
    }
    this.reiniciarTicket();
    this.avisar('Ticket vaciado.', 'info');
  }

  private cancelarVaciado(): void {
    clearTimeout(this.temporizadorVaciar);
    this.confirmarVaciar.set(false);
  }

  // ===================== Pago =====================

  protected elegirMetodo(metodo: MetodoPago): void {
    if (metodo === 'TARJETA' && this.modoSinConexion()) {
      this.avisar('Sin conexión solo se acepta efectivo.', 'error');
      return;
    }
    this.metodo.set(metodo);
    if (metodo === 'EFECTIVO') {
      queueMicrotask(() => this.campoEfectivo()?.nativeElement.focus());
    } else {
      this.recibido.set(null);
    }
  }

  protected escribirEfectivo(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.recibido.set(valor === '' ? null : Math.max(0, Number(valor)));
  }

  protected montoRapido(monto: number | 'exacto'): void {
    this.recibido.set(monto === 'exacto' ? this.total() : monto);
  }

  protected async cobrar(): Promise<void> {
    if (!this.puedeCobrar()) {
      if (this.procesando()) return;
      if (this.faltaEfectivo()) this.avisar('El efectivo recibido no cubre el total.', 'error');
      else if (this.modoSinConexion() && this.metodo() === 'TARJETA') this.avisar('Sin conexión solo se acepta efectivo.', 'error');
      else if (this.hayExcedidos()) this.avisar('Hay productos con más unidades que el stock disponible.', 'error');
      return;
    }
    if (this.modoSinConexion()) {
      await this.cobrarSinConexion();
      return;
    }

    const metodo = this.metodo();
    const datos = {
      uuid: this.uuidDelTicket(),
      metodoPago: metodo,
      efectivoRecibido: metodo === 'EFECTIVO' ? (this.recibido() ?? this.total()) : null,
      lineas: this.lineas().map((l) => ({ productoId: l.productoId, cantidad: l.cantidad }))
    };

    this.procesando.set(true);
    let caida = false;
    try {
      const venta = await this.ventas.registrar(datos);
      this.conexion.marcarDisponible();
      if (venta.duplicada) this.avisar('Esta venta ya estaba registrada; no se cobró dos veces.', 'info', DURACION_AVISO_LARGO_MS);
      this.terminarVenta(venta);
    } catch (error) {
      caida = await this.conexion.esCaida(error);
      if (!caida) this.avisar(this.ventas.mensajeDeError(error, 'No se pudo registrar la venta.'), 'error');
    } finally {
      this.procesando.set(false);
    }

    if (!caida) return;
    if (metodo === 'TARJETA') {
      // Nunca se convierte un pago con tarjeta en efectivo sin que el cajero lo decida
      this.avisar('Se perdió la conexión. Sin conexión solo se acepta efectivo: confirma con el cliente y cobra en efectivo.', 'error', DURACION_AVISO_LARGO_MS);
      return;
    }
    await this.cobrarSinConexion();
  }

  /** Guarda la venta en la cola de la caja con un ticket provisional. */
  private async cobrarSinConexion(): Promise<void> {
    if (this.metodo() !== 'EFECTIVO') {
      this.avisar('Sin conexión solo se acepta efectivo.', 'error');
      return;
    }
    if (this.cola.requiereAutorizacion()) {
      this.abrirPin();
      return;
    }

    this.procesando.set(true);
    try {
      const lineas = this.lineas();
      const pendiente = await this.cola.encolar({
        uuid: this.uuidDelTicket(),
        lineas,
        efectivoRecibido: this.recibido() ?? this.total()
      });
      this.catalogo.descontar(lineas);
      this.terminarVenta(this.cola.comoVenta(pendiente));
    } catch {
      this.avisar('No se pudo guardar la venta en esta caja. No entregues el producto y avisa al supervisor.', 'error', DURACION_AVISO_LARGO_MS);
    } finally {
      this.procesando.set(false);
    }
  }

  private terminarVenta(venta: VentaRegistrada): void {
    this.ventaRegistrada.set(venta);
    this.reiniciarTicket();
  }

  /** Mismo ticket, mismo uuid: si el servidor ya lo grabó, no se duplica al reintentar. */
  private uuidDelTicket(): string {
    const firma = JSON.stringify([this.metodo(), this.lineas().map((l) => [l.productoId, l.cantidad, l.precio])]);
    if (this.intento?.firma !== firma) {
      this.intento = { firma, uuid: nuevoUuid() };
      this.guardarTicketEnCurso(this.lineas(), this.metodo(), this.recibido());
    }
    return this.intento.uuid;
  }

  /** Descarga o imprime el ticket de la venta recién cobrada (incluye efectivo y cambio). */
  protected async ticket(accion: 'descargar' | 'imprimir'): Promise<void> {
    const venta = this.ventaRegistrada();
    if (!venta || this.generandoTicket()) return;
    this.generandoTicket.set(true);
    try {
      const pago = { efectivoRecibido: venta.efectivoRecibido, cambio: venta.cambio };
      if (accion === 'descargar') await this.tickets.descargar(venta, pago);
      else await this.tickets.imprimir(venta, pago);
    } catch {
      this.avisar('No se pudo generar el ticket.', 'error');
    } finally {
      this.generandoTicket.set(false);
    }
  }

  protected nuevaVenta(): void {
    this.ventaRegistrada.set(null);
    this.enfocarBuscador();
  }

  private reiniciarTicket(): void {
    this.cancelarVaciado();
    this.intento = null;
    this.lineas.set([]);
    this.recibido.set(null);
    this.metodo.set('EFECTIVO');
    this.ultimoAgregado.set(null);
  }

  // ===================== Ticket en curso (respaldo local) =====================

  protected recuperarTicket(): void {
    const guardado = this.ticketRecuperable();
    if (!guardado) return;
    const stockActual = new Map(this.catalogo.productos().map((p) => [p.productoId, p.cantidad] as const));
    this.lineas.set(guardado.lineas.map((l) => ({ ...l, stock: stockActual.get(l.productoId) ?? l.stock })));
    this.metodo.set(guardado.metodo === 'TARJETA' && this.modoSinConexion() ? 'EFECTIVO' : guardado.metodo);
    this.recibido.set(guardado.recibido);
    this.intento = guardado.intento;
    this.ticketRecuperable.set(null);
    this.avisar('Ticket recuperado.', 'ok');
    this.enfocarBuscador();
  }

  protected descartarTicket(): void {
    this.intento = null;
    this.ticketRecuperable.set(null);
    this.avisar('Ticket anterior descartado.', 'info');
    this.enfocarBuscador();
  }

  private leerTicketGuardado(): TicketGuardado | null {
    const clave = this.claveTicket();
    if (!clave) return null;
    try {
      const guardado = JSON.parse(localStorage.getItem(clave) ?? 'null') as TicketGuardado | null;
      const valido =
        guardado !== null &&
        Array.isArray(guardado.lineas) &&
        guardado.lineas.length > 0 &&
        guardado.lineas.every((l) => Number.isInteger(l.productoId) && Number.isInteger(l.cantidad) && l.cantidad > 0 && typeof l.precio === 'number');
      return valido ? guardado : null;
    } catch {
      return null;
    }
  }

  private guardarTicketEnCurso(lineas: LineaTicket[], metodo: MetodoPago, recibido: number | null): void {
    const clave = this.claveTicket();
    if (!clave) return;
    try {
      if (!lineas.length) {
        localStorage.removeItem(clave);
        return;
      }
      const guardado: TicketGuardado = { lineas, metodo, recibido, intento: this.intento, guardado: new Date().toISOString() };
      localStorage.setItem(clave, JSON.stringify(guardado));
    } catch {
      /* sin almacenamiento: el ticket vive solo en pantalla */
    }
  }

  // ===================== Autorización del supervisor =====================

  private abrirPin(): void {
    this.pin.set('');
    this.errorPin.set(null);
    this.pedirPin.set(true);
    queueMicrotask(() => this.campoPin()?.nativeElement.focus());
  }

  protected escribirPin(evento: Event): void {
    const campo = evento.target as HTMLInputElement;
    const limpio = campo.value.replace(/\D/g, '').slice(0, 6);
    campo.value = limpio;
    this.pin.set(limpio);
  }

  protected cerrarPin(): void {
    if (this.verificandoPin()) return;
    this.pedirPin.set(false);
    this.enfocarBuscador();
  }

  protected async confirmarPin(): Promise<void> {
    if (this.verificandoPin()) return;
    this.verificandoPin.set(true);
    this.errorPin.set(null);
    let autorizado = false;
    try {
      const resultado = await this.autorizacion.verificar(this.pin());
      if (resultado.ok) {
        this.cola.autorizar(resultado);
        this.pedirPin.set(false);
        this.avisar(`Autorizado por ${resultado.nombre}. La caja sigue vendiendo sin conexión.`, 'ok');
        autorizado = true;
      } else {
        this.errorPin.set(resultado.mensaje);
        this.pin.set('');
        queueMicrotask(() => {
          const campo = this.campoPin()?.nativeElement;
          if (campo) {
            campo.value = '';
            campo.focus();
          }
        });
      }
    } finally {
      this.verificandoPin.set(false);
    }
    if (autorizado) await this.cobrar();
  }

  // ===================== Cola de ventas =====================

  protected sincronizarAhora(): void {
    void this.conexion.comprobar().then(() => this.cola.sincronizar());
  }

  protected reintentar(uuid: string): void {
    void this.cola.reintentar(uuid);
  }

  protected descargarRespaldo(uuid: string): void {
    this.cola.descargarRespaldo(uuid);
  }

  private alSincronizar({ enviadas, rechazadas }: ResultadoSincronizacion): void {
    if (rechazadas) {
      this.avisar(`${rechazadas} ${rechazadas === 1 ? 'venta fue rechazada' : 'ventas fueron rechazadas'} por el servidor. Revisa las pendientes.`, 'error', DURACION_AVISO_LARGO_MS);
    } else if (enviadas) {
      this.avisar(`${enviadas} ${enviadas === 1 ? 'venta sin conexión sincronizada' : 'ventas sin conexión sincronizadas'}.`, 'ok');
    }
  }

  // ===================== Tiempo real =====================

  private alRecibir(evento: EventoTiempoReal): void {
    if (evento.tipo === 'catalogo' || evento.tipo === 'reconectado') {
      if (!this.catalogo.listo()) void this.cargarCatalogo({ departamentoId: this.departamentoId(), buscar: this.busqueda() });
      return;
    }
    if (evento.tipo !== 'stock' || evento.ubicacionId !== this.auth.ubicacionActiva()?.ubicacionId) return;

    // Con la copia local, la lista visible se actualiza sola desde el catálogo local
    if (!this.catalogo.listo()) {
      this.productos.update((lista) =>
        lista.map((p) => (p.productoId === evento.productoId ? { ...p, cantidad: evento.cantidad, estadoStock: evento.estadoStock } : p))
      );
    }

    const linea = this.lineas().find((l) => l.productoId === evento.productoId);
    if (!linea) return;
    this.lineas.update((lista) => lista.map((l) => (l.productoId === evento.productoId ? { ...l, stock: evento.cantidad } : l)));
    // Otra caja vendió el mismo producto y ya no alcanza
    if (linea.cantidad > evento.cantidad && !this.modoSinConexion()) {
      this.avisar(`Quedan ${evento.cantidad} unidades de ${linea.producto}. Ajusta la cantidad.`, 'error');
    }
  }

  // ===================== Teclado =====================

  @HostListener('document:keydown', ['$event'])
  protected atajos(evento: KeyboardEvent): void {
    if (this.ticketRecuperable()) {
      if (evento.key === 'Enter' || evento.key === 'Escape') {
        evento.preventDefault();
        if (evento.key === 'Enter') this.recuperarTicket();
        else this.descartarTicket();
      }
      return;
    }
    if (this.pedirPin()) {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        this.cerrarPin();
      }
      return;
    }
    if (this.verCola()) {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        this.verCola.set(false);
        this.enfocarBuscador();
      }
      return;
    }
    if (this.ventaRegistrada()) {
      // Enter sobre "Descargar" o "Imprimir" solo activa ese botón
      if (evento.key === 'Enter' && (evento.target as HTMLElement).closest('.boton-ticket')) return;
      if (evento.key === 'Enter' || evento.key === 'Escape') {
        evento.preventDefault();
        this.nuevaVenta();
      }
      return;
    }

    switch (evento.key) {
      case 'F2':
        evento.preventDefault();
        this.enfocarBuscador();
        break;
      case 'F3':
        evento.preventDefault();
        this.elegirMetodo('EFECTIVO');
        break;
      case 'F4':
        evento.preventDefault();
        this.elegirMetodo('TARJETA');
        break;
      case 'F9':
        evento.preventDefault();
        void this.cobrar();
        break;
      case 'Escape':
        evento.preventDefault();
        if (this.texto()) this.limpiarBusqueda();
        else this.vaciar();
        break;
    }
  }

  // ===================== Otros =====================

  /** Con ventas sin sincronizar se pide confirmar: se enviarán cuando alguien vuelva a entrar. */
  protected salir(): void {
    const pendientes = this.cola.pendientes().length;
    if (pendientes && !this.confirmarSalir()) {
      this.confirmarSalir.set(true);
      clearTimeout(this.temporizadorSalir);
      this.temporizadorSalir = setTimeout(() => this.confirmarSalir.set(false), DURACION_AVISO_LARGO_MS);
      this.avisar(
        `Hay ${pendientes} ${pendientes === 1 ? 'venta' : 'ventas'} sin sincronizar en esta caja; se enviarán cuando alguien vuelva a iniciar sesión aquí. Presiona Salir otra vez.`,
        'info',
        DURACION_AVISO_LARGO_MS
      );
      return;
    }
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  private enfocarBuscador(): void {
    queueMicrotask(() => this.buscador().nativeElement.focus());
  }

  private avisar(texto: string, tipo: TipoAviso, duracion = DURACION_AVISO_MS): void {
    this.aviso.set({ texto, tipo });
    clearTimeout(this.temporizadorAviso);
    this.temporizadorAviso = setTimeout(() => this.aviso.set(null), duracion);
  }
}

function redondear(numero: number): number {
  return Math.round(numero * 100) / 100;
}