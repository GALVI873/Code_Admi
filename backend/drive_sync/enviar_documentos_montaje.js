// Sube a Drive los documentos que se adjuntaron desde la pestaña "Montaje"
// de una obra aceptada (ver MontajeObra.jsx / montaje_obra.php) — a pedido
// de Álvaro, 2026-09-21. Cada documento (PDF, Planos, Medición, Fotos o el
// de referencia de Tareas) queda en base64 en la fila y este script lo
// sube en la próxima sincronización a "1.Organización/Montaje/<Categoría>"
// de esa obra en Drive — mismo patrón que enviar_adicionales_aceptados.js
// (el panel no tiene acceso directo a Drive).
//
// Uso:
//   node enviar_documentos_montaje.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getDrive } = require('./drive_client.js');
const { Readable } = require('stream');

const CARPETA_FOLDER = 'application/vnd.google-apps.folder';
const CATEGORIA_SINGULAR = {
  Arquitectos: 'Arquitecto',
  Constructores: 'Constructor',
  Particulares: 'Particular',
  Proveedores: 'Proveedor',
  Reformistas: 'Reformista',
};

const EXTENSION_POR_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

async function listarHijos(drive, folderId, soloCarpetas) {
  const filtroTipo = soloCarpetas ? ` and mimeType = '${CARPETA_FOLDER}'` : '';
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

// Mismo typo tolerado que el resto de scripts de Drive ("1.Orgazanización"
// real en Drive).
async function buscarOCrearCarpetaMontaje(drive, obraFolderId, categoriaDocumento) {
  const hijos = await listarHijos(drive, obraFolderId, true);
  let organizacion = hijos.find((f) => /orga.{0,3}ni/i.test(f.name));
  if (!organizacion) {
    const creada = await drive.files.create({
      resource: { name: '1.Organización', mimeType: CARPETA_FOLDER, parents: [obraFolderId] },
      fields: 'id, name',
    });
    organizacion = creada.data;
  }

  const nietos = await listarHijos(drive, organizacion.id, true);
  let montaje = nietos.find((f) => /montaje/i.test(f.name));
  if (!montaje) {
    const creada = await drive.files.create({
      resource: { name: 'Montaje', mimeType: CARPETA_FOLDER, parents: [organizacion.id] },
      fields: 'id, name',
    });
    montaje = creada.data;
  }

  const bisnietos = await listarHijos(drive, montaje.id, true);
  const sub = bisnietos.find((f) => f.name.toLowerCase() === categoriaDocumento.toLowerCase());
  if (sub) return sub;

  const creada = await drive.files.create({
    resource: { name: categoriaDocumento, mimeType: CARPETA_FOLDER, parents: [montaje.id] },
    fields: 'id, name',
  });
  return creada.data;
}

// data:<mime>;base64,xxxx -> { mime, buffer }.
function decodificarArchivoBase64(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}

function nombreArchivoSeguro(nombreOriginal, mime, idDocumento) {
  const limpio = String(nombreOriginal || '').replace(/[\\/:*?"<>|]/g, ' ').trim();
  if (limpio) return limpio;
  const extension = EXTENSION_POR_MIME[mime] || 'bin';
  return `documento-${idDocumento}.${extension}`;
}

async function subirArchivo(drive, carpetaId, nombreArchivo, mime, buffer) {
  await drive.files.create({
    resource: { name: nombreArchivo, parents: [carpetaId] },
    media: { mimeType: mime, body: Readable.from(buffer) },
    fields: 'id',
  });
}

async function listarPendientes() {
  const url = `${process.env.PANEL_API_URL}/montaje_obra.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'listar_documentos_pendientes_envio' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.pendientes;
}

async function marcarEnviado(id) {
  const url = `${process.env.PANEL_API_URL}/montaje_obra.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'marcar_documento_enviado', id }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
}

async function main() {
  const pendientes = await listarPendientes();
  if (pendientes.length === 0) {
    console.log('No hay documentos de Montaje pendientes de enviar.');
    return;
  }

  const drive = getDrive();
  for (const doc of pendientes) {
    console.log(`--- Documento #${doc.id} (${doc.obra} / ${doc.categoria}) ---`);
    try {
      const archivo = decodificarArchivoBase64(doc.archivo_base64);
      if (!archivo) {
        console.error('  El archivo cargado no tiene el formato esperado (data URL inválida) — se deja pendiente para revisar.');
        continue;
      }

      const info = await buscarObra(drive, doc.obra);
      if (!info) {
        console.error(`  No se encontró la carpeta de "${doc.obra}" en Drive — se deja el pedido pendiente para reintentar.`);
        continue;
      }

      const carpetaCategoria = await buscarOCrearCarpetaMontaje(drive, info.folderId, doc.categoria);
      const nombreArchivo = nombreArchivoSeguro(doc.nombre_original, archivo.mime, doc.id);
      await subirArchivo(drive, carpetaCategoria.id, nombreArchivo, archivo.mime, archivo.buffer);
      await marcarEnviado(doc.id);
      console.log(`  OK: subido "${nombreArchivo}".`);
    } catch (err) {
      console.error(`  ERROR con el documento #${doc.id}:`, err.message);
    }
  }
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
