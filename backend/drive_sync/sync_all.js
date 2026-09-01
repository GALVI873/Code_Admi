// Recorre toda la carpeta de "presupuestos en estudio". Las obras se
// identifican por carpeta (Categoría/[Contacto]/Obra — Particulares no
// tiene nivel de contacto), no por archivo: la sola existencia de la
// carpeta ya es una solicitud real y sube al panel como "En Estudio",
// tenga o no todavía su Excel de cálculo (antes una obra sin Excel era
// invisible para la sincronización — caso real: una carpeta de prueba sin
// nada adentro nunca aparecía en el panel). Cuando el Excel sí existe se
// lee para completar el resto de los campos y decidir si pasa a "En
// Valoración"; puede haber varios Excel para la misma obra (versiones
// numeradas, o copias archivadas en subcarpetas tipo "Doc"/"Pptos ant") y
// se elige uno solo — ver esMejorCandidato. Excluye archivos temporales de
// bloqueo (~$) y cálculos auxiliares ("Calculo Composite"). Omite obras
// cuyo último envío registrado supera los 3 meses, y al final reconcilia
// el panel borrando las que ya no aparecen en este recorrido.
// Si la carpeta "Enviados" de una obra trae PDFs etiquetados "Opción A" /
// "Opción B" (alternativas, no revisiones), sube una fila por opción
// ("Obra — Opción A", "Obra — Opción B") en vez de una sola.
// Toda obra que aparece por primera vez (nunca estuvo antes en el panel)
// recibe automáticamente sus carpetas "Enviados" y "1.Organización/
// Valoración" si no las tiene ya (ver asegurarCarpetasNuevaObra) — así
// queda listo el lugar donde guardar el PDF/las ofertas sin que nadie
// tenga que armar la carpeta a mano.
// Cuando el mismo nombre de obra aparece en más de una carpeta del árbol
// (nombres de lugar reusados, carpetas viejas archivadas en otra
// categoría/contacto), se elige una sola — ver resolverObrasUnicas.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { extraerCampos } = require('./extract_fields.js');
const { resolverEnviosDeObra } = require('./extract_from_sent_pdf.js');
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

async function listarHijos(drive, folderId, soloCarpetas) {
  const filtroTipo = soloCarpetas ? " and mimeType = 'application/vnd.google-apps.folder'" : '';
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false${filtroTipo}`,
    fields: 'files(id, name, mimeType, modifiedTime, createdTime)',
    pageSize: 1000,
  });
  return res.data.files;
}

// No toda obra vive a la misma profundidad bajo su categoría: lo normal es
// Categoría/Contacto/Obra, pero hay casos reales de obras colgando DIRECTO
// de la categoría, sin contacto de por medio (ej. "Proveedores/La
// Sacedilla" en vez de "Proveedores/Prometall/La Sacedilla" — ambas
// carpetas "La Sacedilla" existen, la buena es la de profundidad 1). Se
// distingue mirando el contenido: una carpeta de obra tiene algún archivo
// suelto directo (el Excel, un PDF...) o ya trae alguna de las subcarpetas
// propias de una obra (Enviados/Organización/Valoración); una carpeta de
// contacto normalmente solo contiene más carpetas (las obras de ese
// contacto) y ninguna de esas marcas.
async function esCarpetaDeObra(drive, folderId) {
  const hijos = await listarHijos(drive, folderId, false);
  if (hijos.some((h) => h.mimeType !== 'application/vnd.google-apps.folder')) return true;
  return hijos.some((h) => /envia/i.test(h.name) || /^\d*\.?\s*organizaci[oó]n/i.test(h.name) || /valoraci/i.test(h.name));
}

// Enumera las carpetas de obra por su posición en el árbol, en vez de
// depender de encontrar un Excel de cálculo dentro (así se descubre igual
// una obra recién creada, sin Excel todavía).
async function listarObrasDeCategoria(drive, categoriaFolder) {
  const categoria = CATEGORIA_SINGULAR[categoriaFolder.name] || categoriaFolder.name;
  if (categoriaFolder.name === 'Particulares') {
    const obraFolders = await listarHijos(drive, categoriaFolder.id, true);
    return obraFolders.map((f) => ({
      obra: f.name.trim(),
      obraFolderId: f.id,
      categoria,
      contacto: null,
      fechaCreacionCarpeta: f.createdTime ? f.createdTime.slice(0, 10) : null,
    }));
  }
  const hijosDirectos = await listarHijos(drive, categoriaFolder.id, true);
  const obras = [];
  for (const hijo of hijosDirectos) {
    if (await esCarpetaDeObra(drive, hijo.id)) {
      // Cuelga directo de la categoría, sin contacto — igual que Particulares.
      obras.push({
        obra: hijo.name.trim(),
        obraFolderId: hijo.id,
        categoria,
        contacto: null,
        fechaCreacionCarpeta: hijo.createdTime ? hijo.createdTime.slice(0, 10) : null,
      });
      continue;
    }
    // Es un contacto: sus hijos son las obras.
    const obraFolders = await listarHijos(drive, hijo.id, true);
    for (const f of obraFolders) {
      obras.push({
        obra: f.name.trim(),
        obraFolderId: f.id,
        categoria,
        contacto: hijo.name,
        fechaCreacionCarpeta: f.createdTime ? f.createdTime.slice(0, 10) : null,
      });
    }
  }
  return obras;
}

// Puede haber varios Excel de cálculo para la misma obra (versiones
// numeradas, o copias archivadas en subcarpetas tipo "Doc"/"Pptos ant") —
// se recorre la carpeta de la obra recursivamente y se elige uno solo, en
// este orden de prioridad: el más cerca de la raíz de la obra (menos
// profundidad) desempata primero — un archivo archivado en una subcarpeta
// no debería ganarle a uno que vive directo en la obra solo por tener
// fecha de modificación más reciente (caso real: Av. Fuentelarreina 24,
// un cálculo viejo/incompleto en "Doc" con fecha más nueva le ganaba al
// bueno); luego el de mayor prefijo numérico; y por último el modificado
// más reciente.
function esMejorCandidato(nuevo, actual) {
  if (nuevo.profundidadDesdeObra !== actual.profundidadDesdeObra) {
    return nuevo.profundidadDesdeObra < actual.profundidadDesdeObra;
  }
  if (nuevo.prefijo !== actual.prefijo) {
    return nuevo.prefijo > actual.prefijo;
  }
  return nuevo.modifiedTime > actual.modifiedTime;
}

async function buscarCalculoDeObra(drive, obraFolderId) {
  const candidatos = [];
  async function recorrer(folderId, profundidad) {
    const hijos = await listarHijos(drive, folderId, false);
    for (const f of hijos) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        await recorrer(f.id, profundidad + 1);
      } else if (/CALCULO.*\.xlsx$/i.test(f.name) && esArchivoValido(f.name)) {
        candidatos.push({
          fileId: f.id,
          nombreArchivo: f.name,
          modifiedTime: f.modifiedTime,
          profundidadDesdeObra: profundidad,
          prefijo: extraerPrefijoNumerico(f.name) ?? -1,
        });
      }
    }
  }
  await recorrer(obraFolderId, 0);
  if (candidatos.length === 0) return null;
  return candidatos.reduce((mejor, actual) => (esMejorCandidato(actual, mejor) ? actual : mejor));
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Puede haber más de una carpeta con el mismo nombre de obra en ramas
// distintas del árbol — nombres de lugar comunes que se reusan entre
// clientes/años, o carpetas viejas que quedaron archivadas en otra
// categoría/contacto. Casos reales encontrados: "La Sacedilla" (una vacía,
// otra con el Excel real) y "Menendez Pelayo" (9 carpetas, solo 1 con
// Excel de cálculo — el resto son archivos sueltos de años anteriores).
// Antes esto no era un problema porque una obra solo se descubría A PARTIR
// de encontrar su Excel (una carpeta sin Excel ni existía para el
// recorrido); ahora que toda carpeta cuenta como obra desde el vamos, hace
// falta elegir UNA sola por nombre — se prefiere la que tenga Excel de
// cálculo por sobre la que no; si hay empate (varias con Excel, o ninguna
// con Excel), se deja la primera encontrada y se avisa por consola para
// que alguien revise a mano si hace falta.
async function resolverObrasUnicas(drive, obras) {
  const porNombre = new Map();
  for (const info of obras) {
    if (!porNombre.has(info.obra)) porNombre.set(info.obra, []);
    porNombre.get(info.obra).push(info);
  }

  const resueltas = [];
  for (const [obra, candidatos] of porNombre) {
    if (candidatos.length === 1) {
      const calculo = await buscarCalculoDeObra(drive, candidatos[0].obraFolderId);
      resueltas.push({ ...candidatos[0], calculo });
      continue;
    }

    let mejor = null;
    for (const candidato of candidatos) {
      const calculo = await buscarCalculoDeObra(drive, candidato.obraFolderId);
      if (!mejor || (calculo && !mejor.calculo)) {
        mejor = { ...candidato, calculo };
      }
    }
    console.log(
      `AVISO: "${obra}" tiene ${candidatos.length} carpetas con el mismo nombre en el árbol — se usó la de ` +
      `${mejor.categoria}${mejor.contacto ? '/' + mejor.contacto : ''}${mejor.calculo ? ' (con Excel de cálculo)' : ' (ninguna tenía Excel, cualquiera daba igual)'}.`,
    );
    resueltas.push(mejor);
  }
  return resueltas;
}

// Obras marcadas "Descartado" en el panel: ya no interesa mantenerlas al
// día, ni el trabajo de leer su Excel/PDF ni la escritura al panel. Trae el
// listado completo con una sola llamada (acción de solo lectura protegida
// por el mismo SYNC_TOKEN) para poder saltarlas antes de tocar Drive.
// De paso devuelve también el nombre BASE (sin "— Opción A/B") de toda obra
// que YA existía en el panel antes de esta corrida — sirve para detectar
// obras nuevas y provisionarles las carpetas de Enviados/Valoración (ver
// asegurarCarpetasNuevaObra).
async function obtenerEstadoPanel() {
  const url = `${process.env.PANEL_API_URL}/presupuestos_en_estudio.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'listar' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return {
    descartadas: new Set(data.presupuestos.filter((p) => p.estatus === 'Descartado').map((p) => p.obra)),
    basesExistentes: new Set(data.presupuestos.map((p) => p.obra.replace(/\s*—\s*Opci[oó]n\s+\w+\s*$/i, '').trim())),
  };
}

async function buscarSubcarpeta(drive, parentId, patron) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
  });
  return res.data.files.find((f) => patron.test(f.name)) || null;
}

async function crearCarpeta(drive, parentId, nombre) {
  const creada = await drive.files.create({
    resource: { name: nombre, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id, name',
  });
  return creada.data;
}

async function obtenerOCrearSubcarpeta(drive, parentId, nombre, patron) {
  const existente = await buscarSubcarpeta(drive, parentId, patron);
  if (existente) return existente;
  return crearCarpeta(drive, parentId, nombre);
}

// Provisiona en Drive lo que una obra recién descubierta necesita para
// poder avanzar sola por el flujo automático de estatus: una carpeta
// "Enviados" (ahí se guarda el PDF del presupuesto ya enviado — sin esto la
// obra nunca puede llegar a "Pdt Aprobación", ver pdfsEnCarpetaObra en
// extract_from_sent_pdf.js) y una carpeta "Valoración" dentro de
// "1.Organización" (para las ofertas de proveedor que pide Geraldinne, ver
// carpetaValoracion en extract_ofertas_proveedor.js). Idempotente: si ya
// existe una carpeta cuyo nombre matchea el patrón esperado, no crea otra
// — puede correr de nuevo sin duplicar nada.
async function asegurarCarpetasNuevaObra(drive, obraFolderId, obra) {
  await obtenerOCrearSubcarpeta(drive, obraFolderId, 'Enviados', /envia/i);
  const organizacion = await obtenerOCrearSubcarpeta(drive, obraFolderId, '1.Organización', /^\d*\.?\s*organizaci[oó]n/i);
  await obtenerOCrearSubcarpeta(drive, organizacion.id, 'Valoración', /valoraci/i);
  console.log(`Carpetas provisionadas (obra nueva): ${obra}`);
}

async function main() {
  const drive = getDrive();
  const { descartadas, basesExistentes } = await obtenerEstadoPanel();
  console.log(`Obras descartadas (se omiten): ${descartadas.size}\n`);

  const categorias = await drive.files.list({
    q: `'${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name, createdTime)',
  });

  let obras = [];
  for (const cat of categorias.data.files) {
    obras = obras.concat(await listarObrasDeCategoria(drive, cat));
  }
  const antesDeResolver = obras.length;
  obras = await resolverObrasUnicas(drive, obras);
  console.log(`Carpetas de obra encontradas: ${antesDeResolver} -> ${obras.length} obras tras resolver nombres repetidos\n`);

  const resultados = { ok: [], omitidos: [], error: [] };
  const nombresActivos = []; // obra final (con sufijo de opción si aplica) por cada variante considerada este run

  for (const info of obras) {
    const obra = info.obra;
    // Descartado sin variantes de opción es el caso común: se salta antes
    // de leer el Excel/PDF. Si la obra tiene opciones ("— Opción A/B"), el
    // nombre base no va a matchear acá — se filtra más abajo, por variante,
    // una vez resueltas.
    if (descartadas.has(obra)) {
      console.log(`OMITIDA (Descartado): ${obra}`);
      resultados.omitidos.push({ obra, motivo: 'Descartado' });
      continue;
    }

    // Obra nueva (su nombre base nunca apareció en el panel antes de esta
    // corrida): se le crean las carpetas de Enviados/Valoración de una vez,
    // para que Geraldinne/Álvaro ya tengan dónde guardar el PDF cuando lo
    // envíen, sin tener que armar la carpeta a mano.
    if (!basesExistentes.has(obra)) {
      try {
        await asegurarCarpetasNuevaObra(drive, info.obraFolderId, obra);
      } catch (err) {
        console.error(`ERROR creando carpetas para obra nueva "${obra}": ${err.message}`);
      }
    }

    let tmpPath = null;
    try {
      const calculo = info.calculo;

      // Sin Excel todavía: la sola carpeta ya es una solicitud real, sube
      // como "En Estudio" con el resto de los campos vacíos — antes se
      // quedaba completamente invisible hasta que alguien subiera el Excel.
      let camposBase = { estatus: 'En Estudio' };
      let faltantes = CAMPOS_RESPALDABLES;

      if (calculo) {
        tmpPath = path.join(__dirname, `tmp_${calculo.fileId}.xlsx`);
        const buffer = await descargarComoBuffer(drive, calculo.fileId);
        fs.writeFileSync(tmpPath, buffer);
        camposBase = extraerCampos(tmpPath);
        faltantes = CAMPOS_RESPALDABLES.filter((c) => camposBase[c] === null || camposBase[c] === undefined);
      }

      // Una entrada por PDF encontrado: normalmente una sola (la más
      // reciente), o varias si la carpeta de la obra tiene "opciones"
      // (alternativas del mismo proyecto, ej. "Opción A"/"Opción B") — cada
      // una sube como fila separada del panel. fechaCreacionCarpeta descarta
      // cualquier PDF más viejo que la propia carpeta de la obra (no puede
      // ser un envío de ESTA obra) — evita enganchar por error un
      // presupuesto de años atrás para el mismo cliente en un proyecto
      // distinto que reusa el mismo nombre de lugar (caso real: Navacerrada).
      let envios;
      try {
        envios = await resolverEnviosDeObra(obra, faltantes, info.obraFolderId, info.fechaCreacionCarpeta);
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
            categoria: info.categoria,
            contacto: info.contacto,
            fecha_creacion_carpeta: info.fechaCreacionCarpeta,
            ...campos,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data));

        console.log(`OK${calculo ? '' : ' (sin Excel de cálculo todavía)'}: ${obraFinal}`);
        resultados.ok.push(obraFinal);
      }
    } catch (err) {
      console.error(`ERROR en "${obra}": ${err.message}`);
      resultados.error.push({ obra, error: err.message });
    } finally {
      if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
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
