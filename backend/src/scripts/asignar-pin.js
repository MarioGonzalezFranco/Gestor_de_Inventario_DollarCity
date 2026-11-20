// Asigna el PIN de autorización a un supervisor.
// La caja lo pide cuando opera sin conexión más de 50 ventas o 2 horas.
// Uso:  npm run pin -- super001 482913
//
// El PIN se guarda como pbkdf2$iteraciones$sal$hash (PBKDF2-SHA256).
// El navegador lo verifica con la misma fórmula usando Web Crypto.
const crypto = require('node:crypto');

const { pool } = require('../db/pool');

const ITERACIONES = 210000;
const PATRON_PIN = /^\d{6}$/;

function generarHash(pin) {
    const sal = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(pin, sal, ITERACIONES, 32, 'sha256');
    return `pbkdf2$${ITERACIONES}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

async function asignar() {
    const [nombreUsuario, pin] = process.argv.slice(2);
    if (!nombreUsuario || !PATRON_PIN.test(pin ?? '')) {
        throw new Error('Uso: npm run pin -- <usuario> <PIN de 6 dígitos>');
    }
    if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
        throw new Error('Elige un PIN que no sea repetido ni consecutivo (por ejemplo, 111111 o 123456).');
    }

    const { rows: [usuario] } = await pool.query(
        `SELECT u.usuario_id, u.nombre_completo, r.nombre AS rol
    FROM usuarios u
    JOIN roles r ON r.rol_id = u.rol_id
    WHERE lower(u.nombre_usuario) = lower($1)`,
        [nombreUsuario]
    );
    if (!usuario) throw new Error(`No existe el usuario ${nombreUsuario}.`);
    if (usuario.rol !== 'SUPERVISOR') throw new Error(`${nombreUsuario} es ${usuario.rol}; solo los supervisores tienen PIN.`);

    await pool.query('UPDATE usuarios SET pin_autorizacion = $1 WHERE usuario_id = $2', [generarHash(pin), usuario.usuario_id]);
    console.log(`PIN asignado a ${usuario.nombre_completo} (${nombreUsuario}).`);
    console.log('Las cajas lo reciben la próxima vez que se conecten a la API.');
}

asignar()
    .catch((error) => {
        console.error('Error:', error.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());