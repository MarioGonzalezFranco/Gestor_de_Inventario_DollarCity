const { HttpError } = require('../utils/http-error');

/** Ruta que no existe. */
function rutaNoEncontrada(req, res, next) {
    next(new HttpError(404, `No existe la ruta ${req.method} ${req.originalUrl}`, 'Ruta no encontrada'));
}

/**
 * Convierte cualquier error en una respuesta JSON { titulo, mensaje }.
 * Express 5 envía aquí también los errores de funciones async.
 * Los 4 parámetros son obligatorios para que Express lo reconozca como manejador de errores.
 */
// eslint-disable-next-line no-unused-vars
function manejarErrores(error, req, res, next) {
    if (error instanceof HttpError) {
        res.status(error.estado).json({ titulo: error.titulo ?? 'Error', mensaje: error.message });
        return;
    }

    // Errores de PostgreSQL que vienen de las reglas de la base de datos
    switch (error?.code) {
        case '23514': // CHECK y "Stock insuficiente" del trigger
        case 'P0001': // RAISE EXCEPTION de los triggers
            res.status(400).json({ titulo: 'Operación no permitida', mensaje: error.message });
            return;
        case '23505':
            res.status(409).json({ titulo: 'Registro duplicado', mensaje: error.detail ?? error.message });
            return;
        case '23503':
            res.status(400).json({ titulo: 'Referencia inválida', mensaje: error.detail ?? error.message });
            return;
    }

    console.error(error);
    res.status(500).json({ titulo: 'Error del servidor', mensaje: 'Ocurrió un error inesperado. Intenta de nuevo.' });
}

module.exports = { rutaNoEncontrada, manejarErrores };