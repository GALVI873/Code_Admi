// Sube a Drive el PDF de un adicional de obra ya "Aceptado" por el cliente
// — a pedido de Álvaro, 2026-09-21: cuando Geraldinne cambia el estatus de
// un adicional a "Aceptado" (ver AdicionalesDeObra.jsx / adicionales_obra.php)
// le pide el panel que cargue el PDF firmado; ese PDF queda guardado en
// base64 en la fila y este script lo recoge en la próxima sincronización y
// lo sube directo a la carpeta RAÍZ de esa obra en Drive (a pedido de
// Álvaro, 2026-09-24: al lado del PDF principal del presupuesto, sin
// subcarpeta aparte), como "Adicional de obra - <detalle>.pdf" — mismo
// patrón que enviar_medidas_taller.js (el panel no tiene acceso directo a
// Drive).
//
// Uso:
//   node enviar_adicionales_aceptados.js
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

// data:application/pdf;base64,xxxx -> Buffer.
function decodificarPdfBase64(dataUrl) {
  const m = /^data:application\/pdf;base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return Buffer.from(m[1], 'base64');
}

// Nombre de archivo válido en Drive — el detalle es texto libre (puede
// traer "/" u otros caracteres raros).
function nombreArchivoSeguro(detalle) {
  const limpio = String(detalle || '').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 120);
  return `Adicional de obra - ${limpio || 'sin detalle'}.pdf`;
}

async function subirPdf(drive, carpetaId, nombreArchivo, buffer) {
  await drive.files.create({
    resource: { name: nombreArchivo, parents: [carpetaId] },
    media: { mimeType: 'application/pdf', body: Readable.from(buffer) },
    fields: 'id',
  });
}

async function listarPendientes() {
  const url = `${process.env.PANEL_API_URL}/adicionales_obra.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'listar_pdfs_pendientes_envio' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.pendientes;
}

async function marcarEnviado(id) {
  const url = `${process.env.PANEL_API_URL}/adicionales_obra.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'marcar_pdf_enviado', id }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
}

async function main() {
  const pendientes = await listarPendientes();
  if (pendientes.length === 0) {
    console.log('No hay PDFs de adicionales pendientes de enviar.');
    return;
  }

  const drive = getDrive();
  for (const pedido of pendientes) {
    console.log(`--- Adicional #${pedido.id} (${pedido.obra}) ---`);
    try {
      const buffer = decodificarPdfBase64(pedido.pdf_base64);
      if (!buffer) {
        console.error('  El archivo cargado no es un PDF válido (data URL inesperada) — se deja pendiente para revisar.');
        continue;
      }

      const info = await buscarObra(drive, pedido.obra);
      if (!info) {
        console.error(`  No se encontró la carpeta de "${pedido.obra}" en Drive — se deja el pedido pendiente para reintentar.`);
        continue;
      }

      const nombreArchivo = nombreArchivoSeguro(pedido.detalle);
      await subirPdf(drive, info.folderId, nombreArchivo, buffer);
      await marcarEnviado(pedido.id);
      console.log(`  OK: subido "${nombreArchivo}".`);
    } catch (err) {
      console.error(`  ERROR con el adicional #${pedido.id}:`, err.message);
    }
  }
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
