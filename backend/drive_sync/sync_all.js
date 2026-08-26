// Recorre toda la carpeta de "presupuestos en estudio". La obra se identifica
// por el nombre de su carpeta (ver resolver_obra.js), no por el archivo:
// cuando hay varios Excel para la misma obra (versiones numeradas, variantes
// "- Persianas"/"- Barandillas") se sube solo uno. Excluye archivos
// temporales de bloqueo (~$) y cálculos auxiliares ("Calculo Composite").
// Omite obras cuyo último envío registrado supera los 3 meses, y al final
// reconcilia el panel borrando las que ya no aparecen en este recorrido.
// Si la carpeta "Enviados" de una obra trae PDFs etiquetados "Opción A" /
// "Opción B" (alternativas, no revisiones), sube una fila por opción
// ("Obra — Opción A", "Obra — Opción B") en vez de una sola.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { extraerCampos } = require('./extract_fields.js');
const { resolverEnviosDeObra } = require('./extract_from_sent_pdf.js');
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

// Singular para mostrar en el panel ("Arquitecto" en vez del nombre de
// carpeta "Arquitectos"). Particulares no tiene nivel de contacto propio
// (la obra cuelga directo de la categoría), así que no hay "contacto" ahí.
const CATEGORIA_SINGULAR = {
  Arquitectos: 'Arquitecto',
  Constructores: 'Constructor',
  Particulares: 'Particular',
  Proveedores: 'Proveedor',
  Reformistas: 'Reformista',
};

function categoriaYContacto(cadenaNombres) {
  const categoriaCarpeta = cadenaNombres[0];
  const categoria = CATEGORIA_SINGULAR[categoriaCarpeta] || categoriaCarpeta;
  const contacto = categoriaCarpeta === 'Particulares' ? null : cadenaNombres[1] || null;
  return { categoria, contacto };
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
        ...categoriaYContacto(cadenaNombres),
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

// Obras marcadas "Descartado" en el panel: ya no interesa mantenerlas al
// día, ni el trabajo de leer su Excel/PDF ni la escritura al panel. Trae el
// listado completo con una sola llamada (acción de solo lectura protegida
// por el mismo SYNC_TOKEN) para poder saltarlas antes de tocar Drive.
async function obtenerObrasDescartadas() {
  const url = `${process.env.PANEL_API_URL}/presupuestos_en_estudio.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'listar' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return new Set(data.presupuestos.filter((p) => p.estatus === 'Descartado').map((p) => p.obra));
}

async function main() {
  const drive = getDrive();
  const descartadas = await obtenerObrasDescartadas();
  console.log(`Obras descartadas (se omiten): ${descartadas.size}\n`);

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
  const nombresActivos = []; // obra final (con sufijo de opción si aplica) por cada variante considerada este run

  for (const archivo of encontrados) {
    const obra = archivo.obra;
    // Descartado sin variantes de opción es el caso común: se salta antes
    // de leer el Excel/PDF. Si la obra tiene opciones ("— Opción A/B"), el
    // nombre base no va a matchear acá — se filtra más abajo, por variante,
    // una vez resueltas.
    if (descartadas.has(obra)) {
      console.log(`OMITIDA (Descartado): ${obra}`);
      resultados.omitidos.push({ obra, motivo: 'Descartado' });
      continue;
    }
    const tmpPath = path.join(__dirname, `tmp_${archivo.fileId}.xlsx`);
    try {
      const buffer = await descargarComoBuffer(drive, archivo.fileId);
      fs.writeFileSync(tmpPath, buffer);
      const camposBase = extraerCampos(tmpPath);
      const faltantes = CAMPOS_RESPALDABLES.filter((c) => camposBase[c] === null || camposBase[c] === undefined);

      // Una entrada por PDF encontrado: normalmente una sola (la más
      // reciente), o varias si la carpeta de la obra tiene "opciones"
      // (alternativas del mismo proyecto, ej. "Opción A"/"Opción B") — cada
      // una sube como fila separada del panel.
      let envios;
      try {
        envios = await resolverEnviosDeObra(obra, faltantes, archivo.obraFolderId);
      } catch {
        envios = [{ sufijo: '', campos: {} }]; // sigue sin el respaldo/fecha si la búsqueda falla
      }

      for (const { sufijo, campos: relleno } of envios) {
        const obraFinal = obra + sufijo;
        // Igual que arriba, pero por variante: una obra con "Opción A/B"
        // puede tener una descartada y la otra viva.
        if (descartadas.has(obraFinal)) {
          console.log(`OMITIDA (Descartado): ${obraFinal}`);
          resultados.omitidos.push({ obra: obraFinal, motivo: 'Descartado' });
          continue;
        }
        const campos = { ...camposBase, ...relleno };
        // Si hay un envío encontrado, la obra pasa a "Pdt Aprobación"
        // automáticamente (el backend solo aplica este cambio si el estatus
        // actual sigue en una fase previa al envío — En Estudio, En
        // Valoración o En Revisión; nunca pisa Descartado/Aceptado/Pdt
        // Aprobación puestos a mano).
        if (relleno.fecha_ultimo_envio) {
          campos.estatus = 'Pdt Aprobación';
        }

        nombresActivos.push(obraFinal);

        if (envioDemasiadoAntiguo(campos.fecha_ultimo_envio)) {
          console.log(`OMITIDO (envío de hace más de ${MESES_ANTIGUEDAD_MAXIMA} meses, ${campos.fecha_ultimo_envio}): ${obraFinal}`);
          resultados.omitidos.push({ obra: obraFinal, motivo: 'envío antiguo', fecha_ultimo_envio: campos.fecha_ultimo_envio });
          continue;
        }

        const url = `${process.env.PANEL_API_URL}/presupuestos_en_estudio.php?token=${process.env.SYNC_TOKEN}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            obra: obraFinal,
            categoria: archivo.categoria,
            contacto: archivo.contacto,
            ...campos,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data));

        console.log(`OK: ${obraFinal}`);
        resultados.ok.push(obraFinal);
      }
    } catch (err) {
      console.error(`ERROR en "${obra}" (${archivo.nombreArchivo}): ${err.message}`);
      resultados.error.push({ obra, archivo: archivo.nombreArchivo, error: err.message });
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
    await esperar(250);
  }

  const omitidosPorMotivo = {};
  for (const o of resultados.omitidos) omitidosPorMotivo[o.motivo] = (omitidosPorMotivo[o.motivo] || 0) + 1;

  console.log(`\n=== Resumen ===`);
  console.log(`OK: ${resultados.ok.length}`);
  console.log(`Omitidos: ${resultados.omitidos.length}`, JSON.stringify(omitidosPorMotivo));
  console.log(`Errores: ${resultados.error.length}`);
  fs.writeFileSync('resultado_sync_all.json', JSON.stringify(resultados, null, 2));

  // Reconciliación: con el cambio de "obra = nombre de archivo" a "obra =
  // nombre de carpeta", las filas viejas quedan con un identificador que ya
  // no se vuelve a generar. Se borran del panel las que no aparecen en este
  // recorrido de Drive y siguen en un estatus previo a la decisión final
  // (En Estudio / En Valoración / En Revisión / Pdt Aprobación) —
  // Descartado/Aceptado se conservan siempre como historial, aunque su obra
  // ya no exista en Drive.
  const obrasActivas = nombresActivos;
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
