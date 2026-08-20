// Recorre toda la carpeta de "presupuestos en estudio". La obra se identifica
// por el nombre de su carpeta (ver resolver_obra.js), no por el archivo:
// cuando hay varios Excel para la misma obra (versiones numeradas, variantes
// "- Persianas"/"- Barandillas") se sube solo uno. Excluye archivos
// temporales de bloqueo (~$) y cálculos auxiliares ("Calculo Composite").
// Omite obras cuyo último envío registrado supera los 3 meses, y al final
// reconcilia el panel borrando las que ya no aparecen en este recorrido.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { extraerCampos } = require('./extract_fields.js');
const { completarDesdeEnviado } = require('./extract_from_sent_pdf.js');
const { getDrive, descargarComoBuffer } = require('./drive_client.js');
const { indiceCarpetaObra } = require('./resolver_obra.js');

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

function esArchivoValido(nombreArchivo) {
  if (nombreArchivo.startsWith('~$')) return false;
  if (/calculo\s*composite/i.test(nombreArchivo)) return false;
  return true;
}

function extraerPrefijoNumerico(nombreArchivo) {
  const m = nombreArchivo.match(/^(\d+)\./);
  return m ? parseInt(m[1], 10) : null;
}

async function recorrer(drive, folderId, cadenaNombres, cadenaIds, encontrados) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, modifiedTime)',
    pageSize: 1000,
  });
  for (const file of res.data.files) {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      await recorrer(drive, file.id, [...cadenaNombres, file.name], [...cadenaIds, file.id], encontrados);
    } else if (/CALCULO.*\.xlsx$/i.test(file.name) && esArchivoValido(file.name)) {
      const idx = indiceCarpetaObra(cadenaNombres);
      encontrados.push({
        fileId: file.id,
        nombreArchivo: file.name,
        modifiedTime: file.modifiedTime,
        obra: cadenaNombres[idx].trim(),
        obraFolderId: cadenaIds[idx],
      });
    }
  }
}

// La obra ahora se identifica por carpeta, no por archivo: puede haber
// varios Excel para la misma obra (versiones numeradas, variantes como
// "- Persianas"/"- Barandillas"). Se queda uno solo por obra: el de mayor
// prefijo numérico y, si no hay o hay empate, el modificado más reciente.
function deduplicarPorObra(archivos) {
  const grupos = new Map();
  for (const a of archivos) {
    const prefijo = extraerPrefijoNumerico(a.nombreArchivo) ?? -1;
    const actual = grupos.get(a.obra);
    if (
      !actual ||
      prefijo > actual.prefijo ||
      (prefijo === actual.prefijo && a.modifiedTime > actual.modifiedTime)
    ) {
      grupos.set(a.obra, { ...a, prefijo });
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
    await recorrer(drive, cat.id, [cat.name], [cat.id], encontrados);
  }
  const antesDedup = encontrados.length;
  encontrados = deduplicarPorObra(encontrados);
  console.log(`Encontrados: ${antesDedup} archivos -> ${encontrados.length} obras tras deduplicar por carpeta\n`);

  const resultados = { ok: [], omitidos: [], error: [] };

  for (const archivo of encontrados) {
    const obra = archivo.obra;
    const tmpPath = path.join(__dirname, `tmp_${archivo.fileId}.xlsx`);
    try {
      const buffer = await descargarComoBuffer(drive, archivo.fileId);
      fs.writeFileSync(tmpPath, buffer);
      const campos = extraerCampos(tmpPath);

      // Siempre se busca el presupuesto enviado (no solo si faltan campos):
      // la fecha de envío se necesita en todos los casos.
      const faltantes = CAMPOS_RESPALDABLES.filter((c) => campos[c] === null || campos[c] === undefined);
      try {
        const relleno = await completarDesdeEnviado(obra, faltantes, archivo.obraFolderId);
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

  // Reconciliación: con el cambio de "obra = nombre de archivo" a "obra =
  // nombre de carpeta", las filas viejas quedan con un identificador que ya
  // no se vuelve a generar. Se borran del panel las que no aparecen en este
  // recorrido de Drive y siguen en estatus por defecto (En Estudio /
  // Seguimiento) — Descartado/Aceptado se conservan siempre como historial,
  // aunque su obra ya no exista en Drive.
  const obrasActivas = encontrados.map((a) => a.obra);
  if (obrasActivas.length === 0) {
    console.log('Reconciliación omitida: 0 obras encontradas en Drive (posible fallo de lectura, no se borra nada por seguridad).');
    return;
  }
  try {
    const urlDelete = `${process.env.PANEL_API_URL}/presupuestos_en_estudio.php?token=${process.env.SYNC_TOKEN}`;
    const resDelete = await fetch(urlDelete, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ obras_activas: obrasActivas }),
    });
    const dataDelete = await resDelete.json();
    if (!resDelete.ok) throw new Error(JSON.stringify(dataDelete));
    console.log(`Reconciliación: ${dataDelete.eliminados ?? 0} obra(s) obsoleta(s) eliminadas del panel.`);
  } catch (err) {
    console.error('ERROR en reconciliación (no se borró nada):', err.message);
  }
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
