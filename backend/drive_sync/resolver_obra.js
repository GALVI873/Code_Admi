// Resuelve el nombre de "obra" a partir de la cadena de carpetas de Drive
// (categoria/contacto/obra/...) en vez del nombre del archivo Excel: el
// archivo trae prefijos de versión y variantes ("1.", "Segunda
// modificaciones...", "- Persianas") que no identifican la obra real,
// mientras que la carpeta es el nombre estable que también usan los PDFs
// de presupuestos enviados.
//
// La obra vive siempre a una profundidad fija bajo la categoría: sin
// contacto para Particulares (Categoria/Obra), con contacto para el resto
// (Categoria/Contacto/Obra) — mismo criterio que categoriaYContacto() en
// sync_all.js. Cualquier carpeta más abajo (versiones viejas archivadas en
// "1.Organización"/"Pptos ant", o cualquier otra subcarpeta como "Doc"/
// "Valoracion" donde a veces queda un cálculo viejo o incompleto) no es la
// obra, sin importar cómo se llame — antes se intentaba reconocer esas
// subcarpetas por nombre con una lista de patrones, pero cualquier nombre
// no contemplado (ej. "Doc") se colaba como si fuera la obra misma. Usar la
// profundidad fija evita tener que enumerar cada patrón posible.

// Índice (no el nombre) de la carpeta-obra dentro de la cadena, para que
// quien la llame pueda resolver también el id de esa carpeta (necesario
// para buscar una subcarpeta "Enviados" propia de la obra), no solo su
// nombre.
function indiceCarpetaObra(cadenaCarpetas) {
  const idx = cadenaCarpetas[0] === 'Particulares' ? 1 : 2;
  return idx < cadenaCarpetas.length ? idx : cadenaCarpetas.length - 1;
}

function obraDesdeCadenaCarpetas(cadenaCarpetas) {
  return cadenaCarpetas[indiceCarpetaObra(cadenaCarpetas)].trim();
}

module.exports = { obraDesdeCadenaCarpetas, indiceCarpetaObra };
