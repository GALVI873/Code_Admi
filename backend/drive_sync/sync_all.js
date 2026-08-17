// Recorre toda la carpeta de "presupuestos en estudio", deduplica versiones
// numeradas (se queda con la más alta por dirección/carpeta) y sube cada
// obra al panel. Excluye archivos temporales de bloqueo (~$) y cálculos
// auxiliares (ej. "Calculo Composite") que no son el presupuesto principal.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { extraerCampos } = require('./extract_fields.js');
const { completarDesdeEnviado } = require('./extract_from_sent_pdf.js');
const { getDrive, descargarComoBuffer } = require('./drive_client.js');

const CAMPOS_RESPALDABLES = ['cliente', 'ral', 'persiana', 'vidrio'];
const MESES_ANTIGUEDAD_MAXIMA = 3;

// Solo aplica a obras con envío registrado: si nunca se envió no hay fecha
// contra la que comparar, así que se sincroniza igual (sigue activa en
// estudio). Las que sí tienen envío pero de hace más de 3 meses se omiten,
// se asumen cerradas/abandonadas.
function envioDemasiadoAntiguo(fechaUltimoEnvio) {
  if (!fechaUltimoEnvio) return false;
  const limite = new Date();
  limite.setMonth(limite.getMonth() - MESES_ANTIGUEDAD_MAXIMA);
  return new Date(fechaUltimoEnvio) < limite;
}

function limpiarNombreObra(nombreArchivo) {
  return nombreArchivo
    .replace(/\.xlsx$/i, '')
    .replace(/\s*\.?\s*CALCULO.*$/i, '')
    .replace(/^\d+\.\s*/, '')
    .trim();
}

function esArchivoValido(nombreArchivo) {
  if (nombreArchivo.startsWith('~$')) return false;
  if (/calculo\s*composite/i.test(nombreArchivo)) return false;
  return true;
}

function extraerPrefijoNumerico(nombreArchivo) {
  const m = nombreArchivo.match(/^(\d+)\./);
  return m ? parseInt(m[1], 10) : null;
}

async function recorrer(drive, folderId, encontrados) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 1000,
  });
  for (const file of res.data.files) {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      await recorrer(drive, file.id, encontrados);
    } else if (/CALCULO.*\.xlsx$/i.test(file.name) && esArchivoValido(file.name)) {
      encontrados.push({ fileId: file.id, nombreArchivo: file.name, parentId: folderId });
    }
  }
}

function deduplicarPorVersion(archivos) {
  const grupos = new Map();
  for (const a of archivos) {
    const sinPrefijo = a.nombreArchivo.replace(/^\d+\.\s*/, '');
    const clave = `${a.parentId}::${sinPrefijo}`;
    const prefijo = extraerPrefijoNumerico(a.nombreArchivo) ?? -1;
    const actual = grupos.get(clave);
    if (!actual || prefijo > actual.prefijo) {
      grupos.set(clave, { ...a, prefijo });
    }
  }
  return Array.from(grupos.values());
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const drive = getDrive();
  const categorias = await drive.files.list({
    q: `'${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });

  let encontrados = [];
  for (const cat of categorias.data.files) {
    await recorrer(drive, cat.id, encontrados);
  }
  const antesDedup = encontrados.length;
  encontrados = deduplicarPorVersion(encontrados);
  console.log(`Encontrados: ${antesDedup} archivos -> ${encontrados.length} obras tras deduplicar versiones\n`);

  const resultados = { ok: [], omitidos: [], error: [] };

  for (const archivo of encontrados) {
    const obra = limpiarNombreObra(archivo.nombreArchivo);
    const tmpPath = path.join(__dirname, `tmp_${archivo.fileId}.xlsx`);
    try {
      const buffer = await descargarComoBuffer(drive, archivo.fileId);
      fs.writeFileSync(tmpPath, buffer);
      const campos = extraerCampos(tmpPath);

      // Siempre se busca el presupuesto enviado (no solo si faltan campos):
      // la fecha de envío se necesita en todos los casos.
      const faltantes = CAMPOS_RESPALDABLES.filter((c) => campos[c] === null || campos[c] === undefined);
      try {
        const relleno = await completarDesdeEnviado(obra, faltantes);
        Object.assign(campos, relleno);
        // Si hay un envío encontrado, la obra pasa de "En Estudio" a
        // "Seguimiento" automáticamente (el backend solo aplica este cambio
        // si el estatus actual sigue siendo el default; nunca pisa
        // Descartado/Aceptado/Seguimiento puestos a mano).
        if (relleno.fecha_ultimo_envio) {
          campos.estatus = 'Seguimiento';
        }
      } catch {
        // sigue sin el respaldo/fecha si la búsqueda del enviado falla
      }

      if (envioDemasiadoAntiguo(campos.fecha_ultimo_envio)) {
        console.log(`OMITIDO (envío de hace más de ${MESES_ANTIGUEDAD_MAXIMA} meses, ${campos.fecha_ultimo_envio}): ${obra}`);
        resultados.omitidos.push({ obra, fecha_ultimo_envio: campos.fecha_ultimo_envio });
        continue;
      }

      const url = `${process.env.PANEL_API_URL}/presupuestos_en_estudio.php?token=${process.env.SYNC_TOKEN}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obra, ...campos }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));

      console.log(`OK: ${obra}`);
      resultados.ok.push(obra);
    } catch (err) {
      console.error(`ERROR en "${obra}" (${archivo.nombreArchivo}): ${err.message}`);
      resultados.error.push({ obra, archivo: archivo.nombreArchivo, error: err.message });
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
    await esperar(250);
  }

  console.log(`\n=== Resumen ===`);
  console.log(`OK: ${resultados.ok.length}`);
  console.log(`Omitidos (envío > ${MESES_ANTIGUEDAD_MAXIMA} meses): ${resultados.omitidos.length}`);
  console.log(`Errores: ${resultados.error.length}`);
  fs.writeFileSync('resultado_sync_all.json', JSON.stringify(resultados, null, 2));
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
