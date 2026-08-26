// Proceso aparte para leer UN solo PDF con pdf-parse. Se invoca uno por
// archivo (ver parsearPdfAislado en extract_ofertas_proveedor.js) porque la
// librería deja algún estado global corrupto entre documentos con
// estructura rara (XRef roto, fuentes atípicas) — un PDF sano leído justo
// después de uno así falla con "bad XRef entry" aunque su propio archivo
// esté perfecto. Limpiar el caché de require no alcanzó (sí crea una
// instancia nueva del módulo y aun así fallaba), así que la garantía real
// es un proceso nuevo por archivo.
//
// El resultado se escribe a un ARCHIVO, no por stdout: pdfjs a veces manda
// avisos ("Warning: Could not find a preferred cmap table") directo a
// stdout, no a stderr, y eso mezclado con el JSON de salida lo rompe.
const fs = require('fs');
const pdfParse = require('pdf-parse');

const rutaArchivo = process.argv[2];
const rutaSalida = process.argv[3];

pdfParse(fs.readFileSync(rutaArchivo))
  .then(({ text }) => {
    fs.writeFileSync(rutaSalida, JSON.stringify({ text }));
  })
  .catch((err) => {
    fs.writeFileSync(rutaSalida, JSON.stringify({ error: err.message }));
  });
