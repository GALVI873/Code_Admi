// Busca el presupuesto enviado más reciente con el nombre de la obra
// (carpeta "Enviados por mail"). Sirve para dos cosas:
// 1. Respaldo de Cliente/RAL/Vidrio/Persiana cuando la hoja "Ficha" del
//    Excel interno viene vacía.
// 2. La fecha de envío (siempre, independientemente de si el resto de los
//    campos ya venían completos), para saber la antigüedad del presupuesto.
const pdfParse = require('pdf-parse');
const { getDrive, descargarComoBuffer } = require('./drive_client.js');

// La carpeta de enviados no tiene los PDFs sueltos: están organizados en
// subcarpetas por año ("1.PPTOS 26 GALVI", "1.PPTOS 25 GALVI", "PPTOS
// ANTERIORES"). Por eso hace falta bajar recursivamente en vez de listar
// solo los hijos directos (bug original: nunca encontraba nada y por eso
// ninguna obra tenía fecha_ultimo_envio).
//
// Se cachea el índice completo en memoria la primera vez que se pide, para
// no repetir el recorrido del árbol una vez por cada obra (puede haber
// cientos de PDFs).
let indicePdfsEnviadosCache = null;

async function listarPdfsRecursivo(drive, folderId, encontrados) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, createdTime, modifiedTime)',
    pageSize: 1000,
  });
  for (const file of res.data.files) {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      await listarPdfsRecursivo(drive, file.id, encontrados);
    } else if (file.mimeType === 'application/pdf' && !file.name.startsWith('~$')) {
      encontrados.push(file);
    }
  }
}

async function obtenerIndicePdfsEnviados(drive, enviadosFolderId) {
  if (!indicePdfsEnviadosCache) {
    indicePdfsEnviadosCache = [];
    await listarPdfsRecursivo(drive, enviadosFolderId, indicePdfsEnviadosCache);
  }
  return indicePdfsEnviadosCache;
}

async function buscarPdfEnviado(drive, enviadosFolderId, obra) {
  const indice = await obtenerIndicePdfsEnviados(drive, enviadosFolderId);
  const coincidencias = indice
    .filter((f) => f.name.includes(obra))
    .sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
  return coincidencias[0] || null;
}

// Resume la descripción larga del "Compacto" (cajón + color + motor) a lo
// esencial: tipo de cajón y tipo de motor, sin todo el detalle de colores
// repetido línea por línea.
function resumirPersiana(texto) {
  if (!texto) return null;
  const cajonMatch = texto.match(/^([^,]+)/);
  const motorMatch = texto.match(/motor\s+(vía?\s*radio|mec[aá]nico)/i);
  const partes = [];
  if (cajonMatch) partes.push(cajonMatch[1].trim());
  if (motorMatch) partes.push(`Motor ${motorMatch[1].trim()}`);
  return partes.length > 0 ? partes.join(' — ') : texto;
}

function parseTextoPresupuestoEnviado(text) {
  const clienteMatch = text.match(/OBRA:.*\n(.+)\n/);
  const cliente = clienteMatch ? clienteMatch[1].trim() : null;

  const colorMatch = text.match(/Color:\s*(.+)/);
  const color = colorMatch ? colorMatch[1].trim() : null;

  const ralMatch = text.match(/Ral:\s*(.+)/);
  let ral = ralMatch ? ralMatch[1].trim() : null;
  // "Ral: ." es como se marca "sin RAL" en proyectos de PVC/lacado — en ese
  // caso el color (ej. "LACADO BLANCO") es el dato útil que sí existe.
  if (ral === '.' || ral === '') ral = color;

  const vidrioMatch = text.match(/Superficie:\s*(.+)/);
  const vidrio = vidrioMatch ? vidrioMatch[1].trim() : null;

  const persianaMatch = text.match(/Compacto:\s*([\s\S]*?)Metros Cuadrados:/);
  const persiana = persianaMatch ? resumirPersiana(persianaMatch[1].replace(/\s+/g, ' ').trim()) : null;

  return { cliente, ral, vidrio, persiana };
}

async function completarDesdeEnviado(obra, camposFaltantes) {
  const enviadosFolderId = process.env.GOOGLE_DRIVE_ENVIADOS_FOLDER_ID;
  if (!enviadosFolderId) return {};

  const drive = getDrive();
  const archivo = await buscarPdfEnviado(drive, enviadosFolderId, obra);
  if (!archivo) return {};

  const buffer = await descargarComoBuffer(drive, archivo.id);
  const { text } = await pdfParse(buffer);
  const extraidos = parseTextoPresupuestoEnviado(text);

  const relleno = {};
  for (const campo of camposFaltantes) {
    if (extraidos[campo] !== null && extraidos[campo] !== undefined) {
      relleno[campo] = extraidos[campo];
    }
  }
  // Fecha en que el archivo se guardó en Drive (metadato del archivo, no el
  // texto "FECHA:" del documento) — se toma siempre que se encuentre un
  // presupuesto enviado, sin importar si los otros campos ya venían
  // completos del Excel.
  relleno.fecha_ultimo_envio = archivo.createdTime.slice(0, 10); // "2026-07-31T10:23:45.000Z" -> "2026-07-31"
  return relleno;
}

module.exports = { completarDesdeEnviado, parseTextoPresupuestoEnviado };
