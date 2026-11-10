/** Error con código HTTP; el middleware de errores lo convierte en respuesta JSON. */
class HttpError extends Error {
  constructor(estado, mensaje, titulo) {
    super(mensaje);
    this.estado = estado;
    this.titulo = titulo;
  }
}

module.exports = { HttpError };