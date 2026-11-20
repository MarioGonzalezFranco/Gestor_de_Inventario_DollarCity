const { Router } = require('express');

const { eventos } = require('../../db/escucha');
const { ubicacionPermitida, verificarToken } = require('../../middlewares/auth');

const tiempoRealRouter = Router();
const LATIDO_MS = 20000;

/**
 * GET /api/tiempo-real?ubicacionId=2
 * Canal Server-Sent Events: la conexión queda abierta y el servidor envía
 * cada cambio en cuanto PostgreSQL lo confirma.
 * - stock: solo los de la ubicación consultada
 * - venta y catalogo: a todos (el CEDI clasifica con las ventas de toda la red)
 */
tiempoRealRouter.get('/', verificarToken, (req, res) => {
    const ubicacionId = ubicacionPermitida(req, res);

    res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const enviar = (evento) => res.write(`event: ${evento.tipo}\ndata: ${JSON.stringify(evento)}\n\n`);

    const alRecibir = (evento) => {
        if (evento.tipo === 'stock' && evento.ubicacionId !== ubicacionId) return;
        enviar(evento);
    };

    eventos.on('evento', alRecibir);
    enviar({ tipo: 'conectado', ubicacionId });

    // Comentario vacío periódico: mantiene viva la conexión y permite detectar caídas
    const latido = setInterval(() => res.write(': latido\n\n'), LATIDO_MS);

    req.on('close', () => {
        clearInterval(latido);
        eventos.off('evento', alRecibir);
    });
});

module.exports = { tiempoRealRouter };