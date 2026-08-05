// Respaldo para cuando la hoja "Ficha" del Excel interno viene vacía:
// busca el presupuesto enviado más reciente con el nombre de la obra
// (carpeta "Enviados por mail") y saca Cliente/RAL/Vidrio/Persiana de ahí.
const pdfParse = require('pdf-parse');
const { getDrive, descargarComoBuffer } = require('./drive_client.js');

async function buscarPdfEnviado(drive, enviadosFolderId, obra) {
  const res = await drive.files.list({
    q: `'${enviadosFolderId}' in parents and name contains '${obra.replace(/'/g, "\\'")}' and mimeType='application/pdf' and trashed=false`,
    orderBy: 'modifiedTime desc',
    fields: 'files(id, name, modifiedTime)',
    pageSize: 5,
  });
  return res.data.files[0] || null;
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
  return relleno;
}

module.exports = { completarDesdeEnviado, parseTextoPresupuestoEnviado };
