/**
 * Datos de la empresa: única fuente de verdad para el login, los tickets y los
 * reportes PDF. Antes estaban hardcodeados en cada archivo (y correspondían a
 * otra empresa), así que cualquier cambio de razón social, dirección o teléfono
 * se hace acá y se propaga solo.
 */
export const EMPRESA = {
  /** Nombre comercial, el que se muestra en grande. */
  nombre: "KULMAN",
  /** Rubro, se muestra como bajada del nombre. */
  rubro: "Alquiler y Venta de Trajes",
  /** Inicial para el monograma de la marca. */
  inicial: "K",
  telefono: "+595 972 173052",
  /** Dirección del local, se imprime en el ticket y en los reportes. */
  direccion: "Tte. Gutiérrez casi Mcal. Estigarribia - Itauguá",
} as const;

/** Nombre completo en una línea, para títulos y encabezados de reportes. */
export const EMPRESA_NOMBRE_COMPLETO = `${EMPRESA.nombre} — ${EMPRESA.rubro}`;
