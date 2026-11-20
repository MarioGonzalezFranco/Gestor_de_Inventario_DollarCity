const { EventEmitter } = require('node:events');
const { Client } = require('pg');

const { env } = require('../config/env');

// Canal que usan los triggers de 05_tiempo_real_ventas.sql
const CANAL = 'dollarcity_eventos';
const ESPERA_RECONEXION_MS = 5000;

/**
 * Emite 'evento' con el objeto que manda cada trigger:
 *   { tipo: 'stock', productoId, ubicacionId, cantidad, stockMinimo, stockMaximo, estadoStock }
 *   { tipo: 'venta', ventaId, ubicacionId, estado }
 *   { tipo: 'catalogo' }
 */
const eventos = new EventEmitter();
eventos.setMaxListeners(0); // un oyente por navegador conectado

let cliente = null;
let reconectando = false;

/** Abre una conexión dedicada (fuera del pool) que queda escuchando el canal. */
async function iniciarEscucha() {
    cliente = new Client({ ...env.db, options: '-c search_path=dollarcity' });

    cliente.on('notification', (aviso) => {
        if (aviso.channel !== CANAL || !aviso.payload) return;
        try {
            eventos.emit('evento', JSON.parse(aviso.payload));
        } catch {
            console.warn('Aviso con formato inválido:', aviso.payload);
        }
    });

    cliente.on('error', (error) => {
        console.error('Escucha de PostgreSQL con error:', error.message);
        programarReconexion();
    });
    cliente.on('end', programarReconexion);

    await cliente.connect();
    await cliente.query(`LISTEN ${CANAL}`);
    console.log('Tiempo real: escuchando cambios de la base de datos');
}

function programarReconexion() {
    if (reconectando) return;
    reconectando = true;
    cliente?.removeAllListeners();
    cliente?.end().catch(() => { });

    setTimeout(async () => {
        reconectando = false;
        try {
            await iniciarEscucha();
            // Los navegadores recargan sus datos para no perder lo ocurrido durante la caída
            eventos.emit('evento', { tipo: 'catalogo' });
        } catch (error) {
            console.error('No se pudo reconectar la escucha:', error.message);
            programarReconexion();
        }
    }, ESPERA_RECONEXION_MS);
}

module.exports = { eventos, iniciarEscucha };