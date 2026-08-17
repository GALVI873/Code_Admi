// Resuelve el nombre de "obra" a partir de la cadena de carpetas de Drive
// (categoria/contacto/obra/...) en vez del nombre del archivo Excel: el
// archivo trae prefijos de versión y variantes ("1.", "Segunda
// modificaciones...", "- Persianas") que no identifican la obra real,
// mientras que la carpeta es el nombre estable que también usan los PDFs
// de presupuestos enviados.
//
// Excepción: subcarpetas de organización/versiones antiguas dentro de la
// carpeta de la obra (ej. ".../Pasaje del Sur/1.Organización/Pptos ant/
// archivo.xlsx") no son la obra — hay que subir por la cadena hasta la
// primera carpeta que no matchee este patrón.
function esCarpetaOrganizativa(nombre) {
  return /^\d*\.?\s*(organizaci[oó]n|pptos?\.?\s*ant)/i.test(nombre.trim());
}

function obraDesdeCadenaCarpetas(cadenaCarpetas) {
  for (let i = cadenaCarpetas.length - 1; i >= 0; i--) {
    if (!esCarpetaOrganizativa(cadenaCarpetas[i])) return cadenaCarpetas[i].trim();
  }
  return cadenaCarpetas[cadenaCarpetas.length - 1].trim();
}

module.exports = { esCarpetaOrganizativa, obraDesdeCadenaCarpetas };
