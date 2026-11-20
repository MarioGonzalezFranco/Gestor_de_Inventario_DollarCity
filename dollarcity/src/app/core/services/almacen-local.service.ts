import { Injectable } from '@angular/core';

import { VentaPendiente } from '../models/venta.model';

const BASE = 'dollarcity-caja';
const VERSION = 1;
const PENDIENTES = 'ventas-pendientes';
const DATOS = 'datos';
const PREFIJO_RESPALDO = 'dc_caja_';

/**
 * Almacenamiento de la caja en el navegador (IndexedDB).
 * Guarda la cola de ventas sin conexión, el catálogo y los autorizadores.
 * Si IndexedDB no está disponible, usa localStorage como respaldo.
 * Las escrituras esperan a que el navegador confirme que quedaron en disco.
 */
@Injectable({ providedIn: 'root' })
export class AlmacenLocalService {
    private readonly db: Promise<IDBDatabase | null> = this.abrir();

    // ---------- Datos generales (catálogo, autorizadores) ----------

    async leer<T>(clave: string): Promise<T | null> {
        const db = await this.db;
        if (!db) return this.leerRespaldo<T>(clave);
        const valor = await this.operar<T | undefined>(db, DATOS, 'readonly', (almacen) => almacen.get(clave));
        return valor ?? null;
    }

    async guardar(clave: string, valor: unknown): Promise<void> {
        const db = await this.db;
        if (!db) {
            this.guardarRespaldo(clave, valor);
            return;
        }
        await this.operar(db, DATOS, 'readwrite', (almacen) => almacen.put(valor, clave));
    }

    // ---------- Cola de ventas sin conexión ----------

    /** Todas las ventas de la cola, de la más antigua a la más reciente. */
    async pendientes(): Promise<VentaPendiente[]> {
        const db = await this.db;
        const lista = db
            ? await this.operar<VentaPendiente[]>(db, PENDIENTES, 'readonly', (almacen) => almacen.getAll())
            : this.leerRespaldo<VentaPendiente[]>(PENDIENTES);
        return [...(lista ?? [])].sort((a, b) => a.creadaEn - b.creadaEn);
    }

    /** Lanza un error si no se pudo guardar: la venta no debe darse por cobrada. */
    async guardarPendiente(venta: VentaPendiente): Promise<void> {
        const db = await this.db;
        if (db) {
            await this.operar(db, PENDIENTES, 'readwrite', (almacen) => almacen.put(venta));
            return;
        }
        const lista = (this.leerRespaldo<VentaPendiente[]>(PENDIENTES) ?? []).filter((v) => v.uuid !== venta.uuid);
        this.guardarRespaldo(PENDIENTES, [...lista, venta]);
    }

    async borrarPendiente(uuid: string): Promise<void> {
        const db = await this.db;
        if (db) {
            await this.operar(db, PENDIENTES, 'readwrite', (almacen) => almacen.delete(uuid));
            return;
        }
        const lista = (this.leerRespaldo<VentaPendiente[]>(PENDIENTES) ?? []).filter((v) => v.uuid !== uuid);
        this.guardarRespaldo(PENDIENTES, lista);
    }

    // ---------- IndexedDB ----------

    private abrir(): Promise<IDBDatabase | null> {
        return new Promise((resolver) => {
            try {
                if (typeof indexedDB === 'undefined') {
                    resolver(null);
                    return;
                }
                const peticion = indexedDB.open(BASE, VERSION);
                peticion.onupgradeneeded = () => {
                    const db = peticion.result;
                    if (!db.objectStoreNames.contains(PENDIENTES)) db.createObjectStore(PENDIENTES, { keyPath: 'uuid' });
                    if (!db.objectStoreNames.contains(DATOS)) db.createObjectStore(DATOS);
                };
                peticion.onsuccess = () => {
                    const db = peticion.result;
                    // Otra pestaña con una versión nueva pide cerrar esta conexión
                    db.onversionchange = () => db.close();
                    resolver(db);
                };
                peticion.onerror = () => resolver(null);
            } catch {
                resolver(null);
            }
        });
    }

    /** Ejecuta una operación y resuelve cuando la transacción termina (dato confirmado). */
    private operar<T>(
        db: IDBDatabase,
        nombre: string,
        modo: IDBTransactionMode,
        accion: (almacen: IDBObjectStore) => IDBRequest
    ): Promise<T> {
        return new Promise<T>((resolver, rechazar) => {
            let transaccion: IDBTransaction;
            try {
                transaccion = db.transaction(nombre, modo);
            } catch (error) {
                rechazar(error);
                return;
            }
            const peticion = accion(transaccion.objectStore(nombre));
            transaccion.oncomplete = () => resolver(peticion.result as T);
            transaccion.onerror = () => rechazar(transaccion.error ?? peticion.error);
            transaccion.onabort = () => rechazar(transaccion.error ?? new Error('Transacción cancelada'));
        });
    }

    // ---------- Respaldo en localStorage ----------

    private leerRespaldo<T>(clave: string): T | null {
        try {
            const texto = localStorage.getItem(PREFIJO_RESPALDO + clave);
            return texto ? (JSON.parse(texto) as T) : null;
        } catch {
            return null;
        }
    }

    /** Si tampoco hay localStorage, el error sube para que la caja no confirme la venta. */
    private guardarRespaldo(clave: string, valor: unknown): void {
        localStorage.setItem(PREFIJO_RESPALDO + clave, JSON.stringify(valor));
    }
}