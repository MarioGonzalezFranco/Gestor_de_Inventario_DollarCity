import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, filter } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { AnalisisService } from '../../core/services/analisis.service';
import { TiempoRealService } from '../../core/services/tiempo-real.service';
import { ClaseAbc, MatrizAbc as DatosAbc, PeriodoAbc, ProductoAbc } from '../../core/models/analisis.model';

type FiltroClase = 'TODOS' | ClaseAbc;

interface PuntoCurva {
  x: number;
  y: number;
  producto: ProductoAbc;
}

// Descripción de cada clase para las tarjetas
const INFO_CLASE: Record<ClaseAbc, { titulo: string; descripcion: string }> = {
  A: { titulo: 'Alta prioridad', descripcion: 'Pocos productos que generan la mayor parte de la venta. No deben agotarse.' },
  B: { titulo: 'Prioridad media', descripcion: 'Venta estable. Se reponen con el ciclo normal del CEDI.' },
  C: { titulo: 'Baja prioridad', descripcion: 'Poco aporte a la venta. Candidatos a revisar surtido o exhibición.' },
};

// Horas máximas entre conteos físicos según la política de cada clase
const HORAS_CONTEO: Record<ClaseAbc, number> = { A: 48, B: 15 * 24, C: 30 * 24 };

// Medidas del gráfico (coordenadas del viewBox del SVG)
const ANCHO = 1000;
const ALTO = 280;
const MARGEN = { arriba: 16, derecha: 16, abajo: 34, izquierda: 48 };

// Espera tras la última venta antes de recalcular (agrupa varios tickets seguidos)
const ESPERA_RECALCULO_MS = 5000;

@Component({
  selector: 'app-matriz-abc',
  imports: [CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './matriz-abc.html',
  styleUrls: ['../pagina.css', './matriz-abc.css']
})
export class MatrizAbc {
  private readonly analisis = inject(AnalisisService);
  private readonly tiempoReal = inject(TiempoRealService);
  protected readonly auth = inject(AuthService);
  private peticionActual = 0;

  protected readonly periodos: PeriodoAbc[] = [7, 30, 60, 90];
  protected readonly filtros: FiltroClase[] = ['TODOS', 'A', 'B', 'C'];
  protected readonly info = INFO_CLASE;

  // ---- Estado ----
  protected readonly dias = signal<PeriodoAbc>(30);
  protected readonly datos = signal<DatosAbc | null>(null);
  protected readonly cargando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly filtro = signal<FiltroClase>('TODOS');
  protected readonly buscar = signal('');
  protected readonly indiceHover = signal<number | null>(null);

  // ---- Tabla ----
  protected readonly productosFiltrados = computed(() => {
    const datos = this.datos();
    if (!datos) return [];
    const clase = this.filtro();
    const texto = this.buscar().trim().toLowerCase();
    return datos.productos.filter((p) =>
      (clase === 'TODOS' || p.clase === clase) &&
      (!texto ||
        p.sku.toLowerCase().includes(texto) ||
        p.producto.toLowerCase().includes(texto) ||
        (p.codigoBarras ?? '').includes(texto))
    );
  });

  protected readonly conteoPorClase = computed(() => {
    const total: Record<FiltroClase, number> = { TODOS: 0, A: 0, B: 0, C: 0 };
    for (const p of this.datos()?.productos ?? []) {
      total.TODOS++;
      total[p.clase]++;
    }
    return total;
  });

  protected readonly conteosVencidos = computed(
    () => (this.datos()?.productos ?? []).filter((p) => p.clase === 'A' && this.conteoVencido(p)).length
  );

  // ---- Gráfico de Pareto: % de SKUs (x) contra % acumulado del valor (y) ----
  protected readonly grafico = {
    ancho: ANCHO,
    alto: ALTO,
    margen: MARGEN,
    lineasY: [0, 25, 50, 75, 100],
    marcasX: [0, 20, 40, 60, 80, 100],
  };

  protected readonly puntos = computed<PuntoCurva[]>(() => {
    const productos = this.datos()?.productos ?? [];
    const n = productos.length;
    return productos.map((producto, i) => ({
      x: this.escalaX(((i + 1) / n) * 100),
      y: this.escalaY(producto.pctAcumulado ?? 0),
      producto,
    }));
  });

  protected readonly rutaCurva = computed(() => {
    const puntos = this.puntos();
    if (!puntos.length) return '';
    const inicio = `M${this.escalaX(0)},${this.escalaY(0)}`;
    return inicio + puntos.map((p) => ` L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
  });

  protected readonly rutaArea = computed(() => {
    const ruta = this.rutaCurva();
    if (!ruta) return '';
    const base = this.escalaY(0);
    return `${ruta} L${this.escalaX(100)},${base} L${this.escalaX(0)},${base} Z`;
  });

  /** Franjas de fondo de cada clase sobre el eje X (según la cantidad de SKUs). */
  protected readonly franjas = computed(() => {
    const datos = this.datos();
    if (!datos) return [];
    const n = datos.productos.length || 1;
    let desde = 0;
    return datos.clases.map((c) => {
      const hasta = desde + (c.skus / n) * 100;
      const franja = {
        clase: c.clase,
        x: this.escalaX(desde),
        ancho: Math.max(this.escalaX(hasta) - this.escalaX(desde), 0),
        centro: this.escalaX((desde + hasta) / 2),
      };
      desde = hasta;
      return franja;
    });
  });

  /** Ancho de la zona sensible al puntero de cada producto. */
  protected readonly anchoColumna = computed(() => {
    const n = this.datos()?.productos.length ?? 0;
    return n ? (ANCHO - MARGEN.izquierda - MARGEN.derecha) / n : 0;
  });

  protected readonly puntoHover = computed(() => {
    const i = this.indiceHover();
    return i === null ? null : this.puntos()[i] ?? null;
  });

  constructor() {
    // Recalcula al entrar, al cambiar de ubicación o al cambiar el período
    effect(() => {
      const ubicacionId = this.auth.ubicacionActiva()?.ubicacionId;
      const dias = this.dias();
      untracked(() => {
        if (ubicacionId) this.cargar(ubicacionId, dias);
      });
    });

    // Cada venta o anulación cambia la clasificación; se recalcula sola y sin parpadeo.
    // En una tienda cuentan sus ventas; en el CEDI, las de toda la red.
    this.tiempoReal.eventos$
      .pipe(
        filter((e) => {
          if (e.tipo === 'reconectado') return true;
          if (e.tipo !== 'venta') return false;
          const activa = this.auth.ubicacionActiva();
          return activa?.tipo === 'CEDI' || e.ubicacionId === activa?.ubicacionId;
        }),
        debounceTime(ESPERA_RECALCULO_MS),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        const ubicacionId = this.auth.ubicacionActiva()?.ubicacionId;
        if (ubicacionId) this.cargar(ubicacionId, this.dias(), true);
      });
  }

  protected cambiarPeriodo(dias: PeriodoAbc): void {
    this.dias.set(dias);
  }

  protected cambiarBusqueda(evento: Event): void {
    this.buscar.set((evento.target as HTMLInputElement).value);
  }

  protected resumenDe(clase: ClaseAbc) {
    return this.datos()?.clases.find((c) => c.clase === clase) ?? null;
  }

  protected etiquetaFiltro(filtro: FiltroClase): string {
    return filtro === 'TODOS' ? 'Todos' : `Clase ${filtro}`;
  }

  /** El último conteo es más antiguo que lo que pide la política de su clase. */
  protected conteoVencido(p: ProductoAbc): boolean {
    if (!p.ultimoConteo) return true;
    const horas = (Date.now() - new Date(p.ultimoConteo).getTime()) / 3_600_000;
    return horas > HORAS_CONTEO[p.clase];
  }

  protected escalaX(porcentaje: number): number {
    return MARGEN.izquierda + (porcentaje / 100) * (ANCHO - MARGEN.izquierda - MARGEN.derecha);
  }

  protected escalaY(porcentaje: number): number {
    return ALTO - MARGEN.abajo - (porcentaje / 100) * (ALTO - MARGEN.arriba - MARGEN.abajo);
  }

  /** Posición del cuadro de detalle, en % del contenedor del gráfico. */
  protected posicionTooltip(p: PuntoCurva): { left: string; top: string; derecha: boolean } {
    const derecha = p.x > ANCHO * 0.65;
    return { left: `${(p.x / ANCHO) * 100}%`, top: `${(p.y / ALTO) * 100}%`, derecha };
  }

  private async cargar(ubicacionId: number, dias: PeriodoAbc, silencioso = false): Promise<void> {
    const numero = ++this.peticionActual;
    if (!silencioso) this.cargando.set(true);
    this.error.set(null);
    try {
      const datos = await this.analisis.matrizAbc(ubicacionId, dias);
      if (numero !== this.peticionActual) return;
      this.datos.set(datos);
      if (!silencioso) this.indiceHover.set(null);
    } catch (error) {
      if (numero === this.peticionActual) this.error.set(this.mensajeDeError(error));
    } finally {
      if (numero === this.peticionActual) this.cargando.set(false);
    }
  }

  private mensajeDeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'No hay conexión con el servidor. Revisa que la API esté encendida.';
      return (error.error as { mensaje?: string } | null)?.mensaje ?? 'No se pudo calcular la matriz.';
    }
    return 'No se pudo calcular la matriz.';
  }
}