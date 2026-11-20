import { Injectable } from '@angular/core';
import type { jsPDF } from 'jspdf';

import { LineaVenta, Venta } from '../models/venta.model';

/** Datos del pago que no se guardan en la base (solo existen al cobrar). */
export interface PagoTicket {
  efectivoRecibido: number | null;
  cambio: number | null;
}

// Ticket térmico de 80 mm
const ANCHO = 80;
const MARGEN = 4;
const DERECHA = ANCHO - MARGEN;
const CENTRO = ANCHO / 2;
const LOGO = 'dollarcity.png';
const ZONA = 'America/El_Salvador';

const dinero = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fechaHora = new Intl.DateTimeFormat('es-SV', {
  timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false
});

/**
 * Genera el ticket de una venta en PDF (formato de impresora térmica de 80 mm).
 * jsPDF se carga solo cuando se pide un ticket, así no pesa en el resto del gestor.
 */
@Injectable({ providedIn: 'root' })
export class TicketService {
  private logo: Promise<HTMLImageElement | null> | null = null;

  /** Descarga el PDF: ticket-TDA-001-000845.pdf */
  async descargar(venta: Venta, pago?: PagoTicket): Promise<void> {
    const doc = await this.generar(venta, pago);
    doc.save(`ticket-${venta.numeroTicket}.pdf`);
  }

  /**
   * Abre el PDF en otra pestaña con el diálogo de impresión.
   * La pestaña se abre antes de generar el PDF para que el navegador no la bloquee.
   */
  async imprimir(venta: Venta, pago?: PagoTicket): Promise<void> {
    const ventana = window.open('', '_blank');
    const doc = await this.generar(venta, pago);
    doc.autoPrint();
    const url = String(doc.output('bloburl'));
    if (ventana) ventana.location.href = url;
    else window.open(url, '_blank');
  }

  private async generar(venta: Venta, pago?: PagoTicket): Promise<jsPDF> {
    const [{ jsPDF: Pdf }, logo] = await Promise.all([import('jspdf'), this.cargarLogo()]);

    // Primera pasada para medir el alto; la segunda dibuja en una hoja del tamaño justo
    const borrador = new Pdf({ unit: 'mm', format: [ANCHO, 1000] });
    const alto = Math.max(this.componer(borrador, venta, pago, logo) + MARGEN, 100);

    const doc = new Pdf({ unit: 'mm', format: [ANCHO, alto] });
    doc.setProperties({ title: `Ticket ${venta.numeroTicket}`, subject: 'Ticket de venta', creator: 'Dollarcity · Inventario Central' });
    this.componer(doc, venta, pago, logo);
    return doc;
  }

  /** Dibuja el ticket y devuelve la posición vertical final (mm). */
  private componer(doc: jsPDF, venta: Venta, pago: PagoTicket | undefined, logo: HTMLImageElement | null): number {
    let y = MARGEN + 2;

    // ---- Encabezado ----
    if (logo) {
      const ancho = 44;
      const alto = Math.min(ancho * (logo.naturalHeight / logo.naturalWidth), 22);
      const anchoReal = alto * (logo.naturalWidth / logo.naturalHeight);
      doc.addImage(logo, 'PNG', CENTRO - anchoReal / 2, y, anchoReal, alto);
      y += alto + 3;
    } else {
      this.texto(doc, 'DOLLARCITY', CENTRO, y + 4, { tamano: 16, negrita: true, alinear: 'center' });
      y += 9;
    }

    const tienda = venta.tienda;
    if (tienda) {
      y = this.texto(doc, tienda.nombre, CENTRO, y, { tamano: 9, negrita: true, alinear: 'center' });
      const ubicacion = [tienda.direccion, tienda.municipio].filter(Boolean).join(', ');
      if (ubicacion) y = this.parrafo(doc, ubicacion, y, { alinear: 'center' });
      if (tienda.telefono) y = this.texto(doc, `Tel. ${tienda.telefono}`, CENTRO, y, { alinear: 'center' });
    }

    y = this.separador(doc, y + 1);
    y = this.texto(doc, 'TICKET DE VENTA', CENTRO, y, { tamano: 10, negrita: true, alinear: 'center' });
    if (venta.pendiente) {
      // Venta cobrada sin conexión que todavía no llega al servidor
      y = this.texto(doc, '*** PENDIENTE DE SINCRONIZAR ***', CENTRO, y + 0.5, { tamano: 9, negrita: true, alinear: 'center' });
      y = this.fila(doc, 'Ticket provisional', venta.numeroTicket, y);
    } else {
      y = this.fila(doc, 'Ticket', venta.numeroTicket, y);
      if (venta.ticketProvisional) y = this.fila(doc, 'Ticket provisional', venta.ticketProvisional, y);
    }
    y = this.fila(doc, 'Fecha', fechaHora.format(new Date(venta.fecha)), y);
    y = this.fila(doc, 'Atendió', venta.cajero, y);
    y = this.separador(doc, y);

    // ---- Productos ----
    for (const linea of venta.lineas ?? []) {
      y = this.linea(doc, linea, y);
    }
    y = this.separador(doc, y);

    // ---- Totales ----
    y = this.fila(doc, 'Artículos', String(venta.articulos), y);
    y = this.fila(doc, 'TOTAL', dinero.format(venta.total), y + 1, { tamano: 12, negrita: true });
    y = this.fila(doc, 'IVA incluido (13 %)', dinero.format(venta.total - venta.total / 1.13), y);
    y = this.fila(doc, 'Forma de pago', this.nombreMetodo(venta.metodoPago), y + 1);
    if (pago?.efectivoRecibido != null) y = this.fila(doc, 'Efectivo recibido', dinero.format(pago.efectivoRecibido), y);
    if (pago?.cambio != null) y = this.fila(doc, 'Cambio', dinero.format(pago.cambio), y, { negrita: true });

    // ---- Anulación ----
    if (venta.estado === 'ANULADA') {
      y = this.separador(doc, y);
      y = this.texto(doc, '*** TICKET ANULADO ***', CENTRO, y + 1, { tamano: 11, negrita: true, alinear: 'center', rojo: true });
      if (venta.anuladaEn) y = this.texto(doc, fechaHora.format(new Date(venta.anuladaEn)), CENTRO, y, { alinear: 'center' });
      if (venta.motivoAnulacion) y = this.parrafo(doc, `Motivo: ${venta.motivoAnulacion}`, y, { alinear: 'center' });
    }

    // ---- Venta sin conexión ----
    if (venta.pendiente) {
      y = this.separador(doc, y);
      y = this.parrafo(doc, 'Venta registrada sin conexión. El número definitivo se asigna al recuperar la conexión con el servidor.', y, { alinear: 'center', tamano: 7.5 });
    }

    // ---- Pie ----
    y = this.separador(doc, y);
    y = this.texto(doc, '¡Gracias por su compra!', CENTRO, y + 1, { tamano: 9, negrita: true, alinear: 'center' });
    y = this.parrafo(doc, 'Conserve este ticket para cambios o devoluciones.', y, { alinear: 'center' });
    y = this.parrafo(doc, 'Comprobante interno, sin validez fiscal.', y, { alinear: 'center', tamano: 7 });
    return y;
  }

  // ---------- Piezas de dibujo ----------

  /** Nombre del producto (puede ocupar varias líneas) y debajo "cantidad x precio ... subtotal". */
  private linea(doc: jsPDF, linea: LineaVenta, y: number): number {
    y = this.parrafo(doc, linea.producto, y, { negrita: true, tamano: 8.5 });
    return this.fila(doc, `  ${linea.cantidad} x ${dinero.format(linea.precioUnitario)}   ${linea.sku}`, dinero.format(linea.subtotal), y);
  }

  private fila(doc: jsPDF, izquierda: string, derecha: string, y: number,
               estilo: { tamano?: number; negrita?: boolean } = {}): number {
    this.fuente(doc, estilo.tamano ?? 8, estilo.negrita ?? false);
    const alto = this.altoLinea(estilo.tamano ?? 8);
    doc.text(izquierda, MARGEN, y + alto);
    doc.text(derecha, DERECHA, y + alto, { align: 'right' });
    return y + alto + 0.6;
  }

  private texto(doc: jsPDF, contenido: string, x: number, y: number,
                estilo: { tamano?: number; negrita?: boolean; alinear?: 'left' | 'center' | 'right'; rojo?: boolean } = {}): number {
    this.fuente(doc, estilo.tamano ?? 8, estilo.negrita ?? false);
    if (estilo.rojo) doc.setTextColor(185, 28, 28);
    const alto = this.altoLinea(estilo.tamano ?? 8);
    doc.text(contenido, x, y + alto, { align: estilo.alinear ?? 'left' });
    doc.setTextColor(0, 0, 0);
    return y + alto + 0.6;
  }

  /** Texto que se parte en varias líneas si no cabe en el ancho del ticket. */
  private parrafo(doc: jsPDF, contenido: string, y: number,
                  estilo: { tamano?: number; negrita?: boolean; alinear?: 'left' | 'center' } = {}): number {
    this.fuente(doc, estilo.tamano ?? 8, estilo.negrita ?? false);
    const renglones = doc.splitTextToSize(contenido, ANCHO - MARGEN * 2) as string[];
    const x = estilo.alinear === 'center' ? CENTRO : MARGEN;
    for (const renglon of renglones) {
      y = this.texto(doc, renglon, x, y, estilo);
    }
    return y;
  }

  private separador(doc: jsPDF, y: number): number {
    doc.setLineDashPattern([1, 1], 0);
    doc.setLineWidth(0.2);
    doc.line(MARGEN, y + 1.5, DERECHA, y + 1.5);
    doc.setLineDashPattern([], 0);
    return y + 3;
  }

  private fuente(doc: jsPDF, tamano: number, negrita: boolean): void {
    doc.setFont('helvetica', negrita ? 'bold' : 'normal');
    doc.setFontSize(tamano);
  }

  /** Alto de una línea de texto en mm para un tamaño en puntos. */
  private altoLinea(tamano: number): number {
    return tamano * 0.3528 * 1.15;
  }

  private nombreMetodo(metodo: string): string {
    return metodo === 'EFECTIVO' ? 'Efectivo' : metodo === 'TARJETA' ? 'Tarjeta' : 'Mixto';
  }

  /** El logo se carga una sola vez; si falla, el ticket usa el nombre en texto. */
  private cargarLogo(): Promise<HTMLImageElement | null> {
    this.logo ??= new Promise((resolver) => {
      const imagen = new Image();
      imagen.onload = () => resolver(imagen);
      imagen.onerror = () => resolver(null);
      imagen.src = LOGO;
    });
    return this.logo;
  }
}