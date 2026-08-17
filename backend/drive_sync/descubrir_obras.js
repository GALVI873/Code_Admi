// Recorre todo el árbol de la carpeta general buscando archivos *CALCULO*.xlsx
// (a cualquier profundidad, porque Arquitectos/Constructores/Proveedores/
// Reformistas tienen una carpeta de contacto intermedia antes de la obra,
// mientras que Particulares parece ir directo). No descarga nada todavía,
// solo lista para revisar antes de correr el lote real.
const path = require('path');
const fs = require('fs');
const { getDrive } = require('./drive_client.js');
const { obraDesdeCadenaCarpetas } = require('./resolver_obra.js');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PROFUNDIDAD_MAXIMA = 6;

function obraDesdeNombreArchivo(nombreArchivo) {
  return nombreArchivo
    .replace(/\.xlsx$/i, '')
    .replace(/\s*\.?\s*CALCULO.*$/i, '')
    .trim();
}

async function recorrer(drive, folderId, cadenaCarpetas, profundidad, encontrados) {
  if (profundidad > PROFUNDIDAD_MAXIMA) return;

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 1000,
  });

  for (const file of res.data.files) {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      await recorrer(drive, file.id, [...cadenaCarpetas, file.name], profundidad + 1, encontrados);
    } else if (/CALCULO.*\.xlsx$/i.test(file.name)) {
      encontrados.push({
        obra: obraDesdeCadenaCarpetas(cadenaCarpetas),
        obraSegunArchivo: obraDesdeNombreArchivo(file.name),
        archivo: file.name,
        fileId: file.id,
        ruta: `${cadenaCarpetas.join('/')}/${file.name}`,
      });
    }
  }
}

async function main() {
  const drive = getDrive();
  const categorias = await drive.files.list({
    q: `'${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });

  const encontrados = [];
  for (const cat of categorias.data.files) {
    console.log(`Recorriendo ${cat.name}...`);
    await recorrer(drive, cat.id, [cat.name], 1, encontrados);
  }

  console.log(`\nTotal de archivos CALCULO encontrados: ${encontrados.length}\n`);
  const obrasDistintas = new Set(encontrados.map((e) => e.obra));
  console.log(`Obras distintas (por carpeta): ${obrasDistintas.size}\n`);
  encontrados.forEach((e) => {
    const marca = e.obra !== e.obraSegunArchivo ? '  [antes: ' + e.obraSegunArchivo + ']' : '';
    console.log(`${e.obra}${marca}  <-  ${e.ruta}`);
  });

  fs.writeFileSync('obras_descubiertas.json', JSON.stringify(encontrados, null, 2));
  console.log('\nGuardado en obras_descubiertas.json');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
