// Genera un Excel con el listado de obras distintas encontradas en
// "HOJAS DE CALCULO (PPTOS)/2026" (a partir de obras_descubiertas.json, ya
// generado por descubrir_obras.js), una fila por obra.
// Uso: node generar_listado_obras.js <ruta_salida.xlsx>
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { indiceCarpetaObra } = require('./resolver_obra.js');

const salida = process.argv[2];
if (!salida) {
  console.error('Uso: node generar_listado_obras.js <ruta_salida.xlsx>');
  process.exit(1);
}

const encontrados = JSON.parse(fs.readFileSync(path.join(__dirname, 'obras_descubiertas.json'), 'utf8'));

const porObra = new Map();
for (const e of encontrados) {
  const segmentos = e.ruta.split('/');
  const nombresCarpetas = segmentos.slice(0, -1); // sin el archivo
  const categoria = segmentos[0];
  const contacto = categoria === 'Particulares' ? '' : segmentos[1];
  // Trunca en la carpeta real de la obra, no en una subcarpeta de
  // organización/versiones antiguas donde pueda vivir el archivo.
  const idx = indiceCarpetaObra(nombresCarpetas);
  const carpetaObra = nombresCarpetas.slice(0, idx + 1).join('/');

  if (!porObra.has(e.obra)) {
    porObra.set(e.obra, { categoria, contacto, obra: e.obra, carpeta: carpetaObra, archivos: 0 });
  }
  porObra.get(e.obra).archivos += 1;
}

const filas = Array.from(porObra.values()).sort((a, b) => {
  if (a.categoria !== b.categoria) return a.categoria.localeCompare(b.categoria);
  if (a.contacto !== b.contacto) return a.contacto.localeCompare(b.contacto);
  return a.obra.localeCompare(b.obra);
});

const datos = filas.map((f) => ({
  Categoría: f.categoria,
  Contacto: f.contacto,
  Obra: f.obra,
  'Carpeta (ruta relativa)': f.carpeta,
  'Nº archivos de cálculo encontrados': f.archivos,
}));

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(datos);
ws['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 40 }, { wch: 60 }, { wch: 12 }];
XLSX.utils.book_append_sheet(wb, ws, 'Obras en estudio 2026');
XLSX.writeFile(wb, salida);

console.log(`${datos.length} obras distintas -> ${salida}`);
