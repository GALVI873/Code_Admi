// Sube al panel los planos (plantas) de una obra aceptada, rasterizados a
// imagen — el PDF de planos ("1.Organización/Planos" dentro de la carpeta
// de la obra) no tiene texto embebido, es un escaneo con la numeración de
// posición escrita a mano, así que no hay forma de leerlo como texto (ver
// extract_seguimiento_materiales.js para el resto de datos, que sí vienen
// del Excel). Usa pdftoppm (poppler) para convertir cada página del PDF en
// un PNG, uno por planta, y los sube a planos.php.
//
// Piloto: por ahora solo se corre a mano para "Manipa, 89" (ver
// ObrasAceptadasPage.jsx, pestaña "Planos"), no está enganchado todavía al
// cron de sync_all.js/sync_obras_aceptadas.js. Recibe el nombre de obra
// como argumento para poder repetirlo con otras obras sin tocar el código.
//
// Uso:
//   node sync_planos.js "Manipa, 89"
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getDrive, descargarComoBuffer } = require('./drive_client.js');

const CATEGORIA_SINGULAR = {
  Arquitectos: 'Arquitecto',
  Constructores: 'Constructor',
  Particulares: 'Particular',
  Proveedores: 'Proveedor',
  Reformistas: 'Reformista',
};

async function listarHijos(drive, folderId, soloCarpetas) {
  const filtroTipo = soloCarpetas
    ? " and mimeType = 'application/vnd.google-apps.folder'"
    : " and mimeType != 'application/vnd.google-apps.folder'";
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false${filtroTipo}`,
    fields: 'files(id, name, mimeType)',
    pageSize: 1000,
  });
  return res.data.files;
}

async function buscarObra(drive, nombreObra) {
  const categorias = await listarHijos(drive, process.env.GOOGLE_DRIVE_OBRAS_ACEPTADAS_FOLDER_ID, true);
  for (const cat of categorias) {
    const categoria = CATEGORIA_SINGULAR[cat.name] || cat.name;
    const nivelesAExplorar = cat.name === 'Particulares' ? [cat] : await listarHijos(drive, cat.id, true);
    for (const nivel of nivelesAExplorar) {
      const candidatos = cat.name === 'Particulares' ? await listarHijos(drive, cat.id, true) : await listarHijos(drive, nivel.id, true);
      const obraFolder = candidatos.find((f) => f.name === nombreObra);
      if (obraFolder) return { folderId: obraFolder.id, categoria };
    }
  }
  return null;
}

// La carpeta de organización tiene un typo real en Drive
// ("1.Orgazanización" en vez de "1.Organización") — se tolera con una
// regex laxa en vez de un nombre exacto. Si no aparece a ese nivel (obras
// con estructura distinta), se busca "Planos" directo bajo la obra también.
async function buscarCarpetaPlanos(drive, obraFolderId) {
  const hijos = await listarHijos(drive, obraFolderId, true);
  const directa = hijos.find((f) => /planos/i.test(f.name));
  if (directa) return directa;

  const organizacion = hijos.find((f) => /orga.{0,3}ni/i.test(f.name));
  if (organizacion) {
    const nietos = await listarHijos(drive, organizacion.id, true);
    const planos = nietos.find((f) => /planos/i.test(f.name));
    if (planos) return planos;
  }
  return null;
}

function resolverPdftoppm() {
  try {
    execFileSync('pdftoppm', ['-v']);
    return 'pdftoppm';
  } catch {
    // pdftoppm no está en PATH todavía en esta sesión de shell (recién
    // instalado con winget) — se busca el binario directo en la carpeta
    // de instalación de WinGet.
    const base = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
    if (!fs.existsSync(base)) {
      throw new Error('pdftoppm no está instalado. Instalar poppler-utils (Windows: "winget install oschwartz10612.Poppler").');
    }
    const paquete = fs.readdirSync(base).find((n) => /poppler/i.test(n));
    if (!paquete) {
      throw new Error('pdftoppm no está instalado. Instalar poppler-utils (Windows: "winget install oschwartz10612.Poppler").');
    }
    const versiones = fs.readdirSync(path.join(base, paquete)).filter((n) => /^poppler-/i.test(n));
    const binPath = path.join(base, paquete, versiones[0], 'Library', 'bin', 'pdftoppm.exe');
    if (!fs.existsSync(binPath)) {
      throw new Error(`No se encontró pdftoppm.exe en ${binPath}`);
    }
    return binPath;
  }
}

async function subirPaginas(obra, paginas) {
  const url = `${process.env.PANEL_API_URL}/planos.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'reemplazar_paginas', obra, paginas }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function main() {
  const nombreObra = process.argv[2];
  if (!nombreObra) {
    console.error('Uso: node sync_planos.js "Nombre de la obra"');
    process.exit(1);
  }

  const drive = getDrive();
  console.log(`Buscando "${nombreObra}"...`);
  const obra = await buscarObra(drive, nombreObra);
  if (!obra) {
    console.error(`No se encontró la obra "${nombreObra}" dentro de SEGUIMIENTO DE OBRAS (Aceptadas).`);
    process.exit(1);
  }

  const carpetaPlanos = await buscarCarpetaPlanos(drive, obra.folderId);
  if (!carpetaPlanos) {
    console.error(`"${nombreObra}" no tiene una carpeta "Planos" (buscada directo y dentro de Organización).`);
    process.exit(1);
  }
  console.log(`Carpeta de planos: ${carpetaPlanos.name} (${carpetaPlanos.id})`);

  const archivos = await listarHijos(drive, carpetaPlanos.id, false);
  const pdfs = archivos.filter((f) => f.mimeType === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (pdfs.length === 0) {
    console.error(`La carpeta de planos de "${nombreObra}" no tiene ningún PDF.`);
    process.exit(1);
  }

  const pdftoppm = resolverPdftoppm();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'galvi-planos-'));
  const paginas = [];
  let numeroPagina = 0;

  try {
    for (const pdf of pdfs) {
      console.log(`Descargando "${pdf.name}"...`);
      const buffer = await descargarComoBuffer(drive, pdf.id);
      const tmpPdf = path.join(tmpDir, 'plano.pdf');
      fs.writeFileSync(tmpPdf, buffer);

      const prefijo = path.join(tmpDir, 'pagina');
      execFileSync(pdftoppm, ['-png', '-r', '150', tmpPdf, prefijo]);

      const generadas = fs.readdirSync(tmpDir).filter((n) => /^pagina-\d+\.png$/.test(n)).sort();
      for (const nombre of generadas) {
        numeroPagina += 1;
        const imagenBase64 = fs.readFileSync(path.join(tmpDir, nombre)).toString('base64');
        paginas.push({ pagina: numeroPagina, imagen_base64: `data:image/png;base64,${imagenBase64}` });
        fs.unlinkSync(path.join(tmpDir, nombre));
      }
      fs.unlinkSync(tmpPdf);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`Subiendo ${paginas.length} página(s) al panel...`);
  const resultado = await subirPaginas(nombreObra, paginas);
  console.log('OK:', resultado);
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
