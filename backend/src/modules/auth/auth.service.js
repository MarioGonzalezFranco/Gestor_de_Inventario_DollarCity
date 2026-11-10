const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { env } = require('../../config/env');
const { consultar } = require('../../db/pool');
const { HttpError } = require('../../utils/http-error');

const MAX_INTENTOS = 3;
const MINUTOS_BLOQUEO = 15;

// Mismos nombres que el modelo Usuario de Angular
const SELECT_USUARIO = `
  SELECT u.usuario_id      AS "usuarioId",
         u.nombre_completo AS "nombreCompleto",
         u.nombre_usuario  AS "nombreUsuario",
         u.correo,
         r.nombre          AS rol,
         u.ubicacion_id    AS "ubicacionId",
         u.activo,
         u.contrasena_hash AS "contrasenaHash"
    FROM usuarios u
    JOIN roles r ON r.rol_id = u.rol_id`;

// Intentos fallidos en memoria (se reinician si el servidor se reinicia)
const intentos = new Map();

/** Quita la contraseña antes de enviar el usuario al frontend. */
function sinClave(usuario) {
    const { contrasenaHash, ...publico } = usuario;
    return publico;
}

async function iniciarSesion(identificador, clave) {
    const texto = (identificador ?? '').trim().toLowerCase();
    if (!texto || !clave) {
        throw new HttpError(400, 'Ingresa tu usuario y tu contraseña.', 'Faltan datos');
    }

    const registro = intentos.get(texto) ?? { fallidos: 0 };
    if (registro.bloqueadoHasta && registro.bloqueadoHasta > Date.now()) {
        const minutos = Math.ceil((registro.bloqueadoHasta - Date.now()) / 60000);
        throw new HttpError(429, `Superaste los ${MAX_INTENTOS} intentos. Intenta de nuevo en ${minutos} min.`, 'Cuenta bloqueada');
    }

    const [usuario] = await consultar(
        `${SELECT_USUARIO} WHERE lower(u.nombre_usuario) = $1 OR lower(u.correo) = $1`,
        [texto]
    );

    const claveCorrecta = usuario ? await bcrypt.compare(clave, usuario.contrasenaHash) : false;

    if (!usuario || !claveCorrecta) {
        registro.fallidos += 1;
        if (registro.fallidos >= MAX_INTENTOS) {
            intentos.set(texto, { fallidos: 0, bloqueadoHasta: Date.now() + MINUTOS_BLOQUEO * 60000 });
            throw new HttpError(429, `La cuenta quedó bloqueada por ${MINUTOS_BLOQUEO} minutos.`, 'Cuenta bloqueada');
        }
        intentos.set(texto, registro);
        const quedan = MAX_INTENTOS - registro.fallidos;
        throw new HttpError(401, quedan === 1 ? 'Te queda 1 intento.' : `Te quedan ${quedan} intentos.`, 'Usuario o contraseña incorrectos');
    }

    if (!usuario.activo) {
        throw new HttpError(403, 'Tu cuenta está desactivada. Contacta al administrador.', 'Usuario inactivo');
    }

    intentos.delete(texto);
    await consultar('UPDATE usuarios SET ultimo_acceso = now() WHERE usuario_id = $1', [usuario.usuarioId]);

    const token = jwt.sign(
        { usuarioId: usuario.usuarioId, rol: usuario.rol, ubicacionId: usuario.ubicacionId },
        env.jwt.secreto,
        { expiresIn: env.jwt.expira }
    );

    return { token, usuario: sinClave(usuario) };
}

async function obtenerUsuario(usuarioId) {
    const [usuario] = await consultar(`${SELECT_USUARIO} WHERE u.usuario_id = $1`, [usuarioId]);
    if (!usuario || !usuario.activo) {
        throw new HttpError(401, 'Tu cuenta ya no está disponible.', 'Sesión inválida');
    }
    return sinClave(usuario);
}

module.exports = { iniciarSesion, obtenerUsuario };