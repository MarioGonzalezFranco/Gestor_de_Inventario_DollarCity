// Lee y valida las variables del archivo .env (Node las carga con --env-file)

function requerida(nombre) {
    const valor = process.env[nombre];
    if (!valor) {
        throw new Error(`Falta la variable ${nombre} en el archivo .env`);
    }
    return valor;
}

const env = {
    puerto: Number(process.env.PORT ?? 3000),
    corsOrigen: process.env.CORS_ORIGIN ?? 'http://localhost:4200',
    db: {
        host: requerida('DB_HOST'),
        port: Number(process.env.DB_PORT ?? 5432),
        database: requerida('DB_NAME'),
        user: requerida('DB_USER'),
        password: requerida('DB_PASSWORD')
    },
    jwt: {
        secreto: requerida('JWT_SECRET'),
        expira: process.env.JWT_EXPIRA ?? '8h'
    }
};

module.exports = { env };