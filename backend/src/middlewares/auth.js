const jwt = require('jsonwebtoken');

const { env } = require('../config/env');
const { HttpError } = require('../utils/http-error');

// Roles: ADMINISTRADOR, SUPERVISOR, BODEGUERO, CAJERO
// El token guarda: { usuarioId, rol, ubicacionId }  (ubicacionId null = administrador)

/** Exige un token válido en el encabezado Authorization: Bearer <token>. */
function verificarToken(req, res, next) {
    const encabezado = req.headers.authorization ?? '';
    const [tipo, token] = encabezado.split(' ');

    if (tipo !== 'Bearer' || !token) {
        throw new HttpError(401, 'Inicia sesión para continuar.', 'Sesión requerida');
    }

    try {
        const datos = jwt.verify(token, env.jwt.secreto);
        res.locals.usuario = { usuarioId: datos.usuarioId, rol: datos.rol, ubicacionId: datos.ubicacionId };
        next();
    } catch {
        throw new HttpError(401, 'Tu sesión expiró. Vuelve a iniciar sesión.', 'Sesión vencida');
    }
}

/** Permite el paso solo a los roles indicados. Se usa después de verificarToken. */
function permitirRoles(...roles) {
    return (req, res, next) => {
        const usuario = res.locals.usuario;
        if (!usuario || !roles.includes(usuario.rol)) {
            throw new HttpError(403, 'Tu rol no tiene acceso a esta sección.', 'Sin permiso');
        }
        next();
    };
}

/** Usuario autenticado de la petición actual. */
function usuarioActual(res) {
    return res.locals.usuario;
}

/**
 * Ubicación sobre la que se consulta:
 * - el administrador puede pedir cualquiera con ?ubicacionId=
 * - el resto siempre usa la suya, aunque mande otra.
 */
function ubicacionPermitida(req, res) {
    const usuario = usuarioActual(res);
    if (usuario.ubicacionId !== null) {
        return usuario.ubicacionId;
    }
    const pedida = Number(req.query.ubicacionId);
    if (!Number.isInteger(pedida) || pedida <= 0) {
        throw new HttpError(400, 'Indica la ubicación con ?ubicacionId=', 'Falta la ubicación');
    }
    return pedida;
}

module.exports = { verificarToken, permitirRoles, usuarioActual, ubicacionPermitida };