// Traspaso de Drive al aceptar un presupuesto: mueve la carpeta de la obra
// desde "HOJAS DE CALCULO (PPTOS)" (en estudio) a "SEGUIMIENTO DE OBRAS
// (Aceptadas)", dejando en la carpeta nueva el Excel de cálculo, el PDF más
// reciente de "Enviados" (el presupuesto aprobado), la carpeta
// "1.Organización" (con "Valoración" adentro, si el origen ya tenía una —
// si no, se crea una nueva vacía) y la carpeta "Doc" del origen si existe
// (ver más abajo). Ya NO copia ninguna plantilla MEDYSEG.xlsx — a pedido de
// Alfredo (2026-09-21), prefiere armar ese archivo él mismo a mano en vez de
// que el traspaso le deje uno en blanco (ver "Sin MEDYSEG" en Obras
// Aceptadas, sync_obras_aceptadas.js, para saber en qué obras todavía
// falta).
//
// A pedido de Álvaro (2026-09-15), tres cambios sobre la versión anterior:
//
// 1. La carpeta de origen se ELIMINA (a la papelera de Drive, no un borrado
//    permanente — recuperable ahí por un tiempo) una vez que ya se movió
//    todo lo necesario, en vez de quedar con un "_Archivo" adentro. El
//    panel sigue mostrando la obra igual, como "Aceptado", aunque su
//    carpeta de origen ya no exista con ese nombre — presupuestos_en_
//    estudio.php nunca borra una fila en estatus Aceptado o Descartado por
//    reconciliación (son decisiones finales, se conservan como historial).
//    Lo que quedaba suelto en el origen sin moverse a ningún lado (la
//    propia carpeta "Enviados" con el resto de PDFs, archivos sueltos) se
//    va con la carpeta a la papelera, ya no se preserva aparte.
// 2. Dentro de "1.Organización" del destino se crean (si no existen ya)
//    las subcarpetas: "Planos", "Fabricación", "Vidrios" y "Medición" —
//    esta última con "Chapas" y "Carpintería" adentro. "Medición/
//    Carpintería" es donde enviar_medidas_taller.js sube el Excel con las
//    medidas que Álvaro manda desde el panel (antes subía directo a
//    "Medición" — ver ese script para el cambio correspondiente).
// 3. Si el origen tiene una carpeta "Doc" (ubicación históricamente
//    inconsistente, no todas las obras la tienen — ver
//    extract_ofertas_proveedor.js), lo que tenga suelto adentro se mueve
//    primero a una subcarpeta "Origen" dentro de la propia "Doc" (si esa
//    subcarpeta ya existe de una corrida anterior, no se duplica), y
//    después la carpeta "Doc" entera (ya con "Origen" adentro) se traspasa
//    al destino igual que "1.Organización".
//
// Todo esto aplica solo a obras que se acepten de acá en adelante — no es
// retroactivo para las que ya estaban en "SEGUIMIENTO DE OBRAS (Aceptadas)"
// antes de este cambio.
//
// A diferencia de la primera versión, esta lee y mueve todo por la API de
// Drive (OAuth, mismo mecanismo que sync_all.js/sync_obras_aceptadas.js) —
// no depende del mount Z:\ de Drive Desktop, así que puede correr sola en
// GitHub Actions (ver .github/workflows/sync_drive.yml) sin que nadie la
// tenga que ejecutar a mano.
//
// Qué obra está pendiente lo decide el panel: presupuestos_en_estudio con
// estatus "Aceptado" y traspaso_estado "pendiente" (se pone solo al marcar
// Aceptado desde el panel — ver presupuestos_en_estudio.php). Al terminar
// cada obra, este script avisa al panel (marcar_traspaso_procesado) — la
// próxima corrida de sync_obras_aceptadas.js ya la encuentra en su nueva
// carpeta y la sube a obras_aceptadas.php con la insignia "Nueva" para
// Alfredo.
//
// Uso:
//   node traspasar_obras_aceptadas.js            (simula, no toca nada)
//   node traspasar_obras_aceptadas.js --aplicar   (ejecuta el traspaso real)
//
// Mismo criterio que limpiar_obras_viejas.js: sin --aplicar es un dry-run
// completo (imprime qué haría con cada obra) — en el cron nocturno
// (sync_drive.yml) se corre siempre con --aplicar; corrida a mano sin el
// flag sirve para revisar antes.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getDrive } = require('./drive_client.js');

const APLICAR = process.argv.includes('--aplicar');

const CARPETA_FOLDER = 'application/vnd.google-apps.folder';

// La obra guarda la categoría en singular ("Arquitecto"), la carpeta de
// Drive existe en plural ("Arquitectos") — mismo mapeo que sync_all.js /
// sync_obras_aceptadas.js, invertido.
const CATEGORIA_A_CARPETA = {
  Arquitecto: 'Arquitectos',
  Constructor: 'Constructores',
  Particular: 'Particulares',
  Proveedor: 'Proveedores',
  Reformista: 'Reformistas',
};

function exactRegex(nombre) {
  return new RegExp(`^${String(nombre).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

async function listarHijos(drive, folderId, soloCarpetas) {
  const filtroTipo = soloCarpetas ? ` and mimeType = '${CARPETA_FOLDER}'` : '';
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false${filtroTipo}`,
    fields: 'files(id, name, mimeType, modifiedTime)',
    pageSize: 1000,
  });
  return res.data.files;
}

async function buscarSubcarpeta(drive, parentId, patron) {
  const hijos = await listarHijos(drive, parentId, true);
  return hijos.find((f) => patron.test(f.name)) || null;
}

async function crearCarpeta(drive, parentId, nombre) {
  const creada = await drive.files.create({
    resource: { name: nombre, mimeType: CARPETA_FOLDER, parents: [parentId] },
    fields: 'id, name',
  });
  return creada.data;
}

async function obtenerOCrearSubcarpeta(drive, parentId, nombre, patron) {
  const existente = await buscarSubcarpeta(drive, parentId, patron);
  if (existente) return existente;
  return crearCarpeta(drive, parentId, nombre);
}

// Como obtenerOCrearSubcarpeta, pero respeta el modo simulación (no crea
// nada real sin --aplicar, solo dice qué haría) y propaga esa simulación
// hacia abajo: si el padre ya es una carpeta simulada (id que arranca con
// "(simulado", porque a su vez no existía y tampoco se creó de verdad), no
// hace falta ni intentar buscar/crear adentro — se devuelve otro id
// simulado directamente, sin llamar a la API con un parentId inválido.
async function obtenerOCrearSubcarpetaSimulable(drive, parentId, nombre, patron, resultados) {
  if (String(parentId).startsWith('(simulado')) {
    resultados.push(`  crear subcarpeta "${nombre}"`);
    return { id: `(simulado:${nombre})` };
  }
  const existente = await buscarSubcarpeta(drive, parentId, patron);
  if (existente) return existente;
  resultados.push(`  crear subcarpeta "${nombre}"`);
  if (!APLICAR) return { id: `(simulado:${nombre})` };
  return crearCarpeta(drive, parentId, nombre);
}

// Ubica la carpeta de la obra en el origen usando categoría/contacto de la
// fila del panel, con dos niveles de tolerancia (igual espíritu que
// sync_all.js): si no está bajo el contacto esperado, se prueba directo
// bajo la categoría (Particulares, o el caso real de una obra que cuelga
// sin contacto); si tampoco, se recorre cada contacto de la categoría
// buscando el nombre exacto, por si el contacto guardado en el panel no
// coincide con el de la carpeta real.
async function localizarCarpetaObraOrigen(drive, categoria, contacto, obra) {
  const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const nombreCategoria = CATEGORIA_A_CARPETA[categoria] || categoria;
  const categoriaFolder = await buscarSubcarpeta(drive, rootId, exactRegex(nombreCategoria));
  if (!categoriaFolder) return { error: `categoría "${categoria}" no encontrada en el origen` };

  if (contacto) {
    const contactoFolder = await buscarSubcarpeta(drive, categoriaFolder.id, exactRegex(contacto));
    if (contactoFolder) {
      const obraFolder = await buscarSubcarpeta(drive, contactoFolder.id, exactRegex(obra));
      if (obraFolder) {
        return { id: obraFolder.id, categoriaFolderName: categoriaFolder.name, contactoFolderName: contactoFolder.name };
      }
    }
  }

  const obraDirecta = await buscarSubcarpeta(drive, categoriaFolder.id, exactRegex(obra));
  if (obraDirecta) {
    return { id: obraDirecta.id, categoriaFolderName: categoriaFolder.name, contactoFolderName: null };
  }

  const contactos = await listarHijos(drive, categoriaFolder.id, true);
  for (const c of contactos) {
    const obraFolder = await buscarSubcarpeta(drive, c.id, exactRegex(obra));
    if (obraFolder) {
      return { id: obraFolder.id, categoriaFolderName: categoriaFolder.name, contactoFolderName: c.name };
    }
  }

  return { error: 'no se encontró la carpeta de la obra en el origen' };
}

// Crea (si hace falta) la misma ruta Categoría/[Contacto]/Obra del lado de
// "SEGUIMIENTO DE OBRAS (Aceptadas)" — usa los nombres de carpeta REALES
// encontrados en el origen (no el texto del panel), para no crear una
// carpeta con mayúsculas/tildes distintas a la de siempre.
async function obtenerOCrearCarpetaDestino(drive, categoriaFolderName, contactoFolderName, obra) {
  const rootId = process.env.GOOGLE_DRIVE_OBRAS_ACEPTADAS_FOLDER_ID;
  const categoriaFolder = await obtenerOCrearSubcarpeta(drive, rootId, categoriaFolderName, exactRegex(categoriaFolderName));
  let parentId = categoriaFolder.id;
  if (contactoFolderName) {
    const contactoFolder = await obtenerOCrearSubcarpeta(drive, parentId, contactoFolderName, exactRegex(contactoFolderName));
    parentId = contactoFolder.id;
  }

  const existente = await buscarSubcarpeta(drive, parentId, exactRegex(obra));
  if (existente) {
    const hijos = await listarHijos(drive, existente.id, false);
    if (hijos.length > 0) return { error: 'ya existe una carpeta con contenido en el destino — revisar a mano' };
    return { id: existente.id };
  }
  const creada = await crearCarpeta(drive, parentId, obra);
  return { id: creada.id };
}

function esExcelCalculo(nombre) {
  if (!/\.xlsx?$/i.test(nombre)) return false;
  if (nombre.startsWith('~$')) return false;
  if (/calculo\s*composite/i.test(nombre)) return false;
  return true;
}

async function localizarExcelCalculo(drive, obraFolderId) {
  const hijos = await listarHijos(drive, obraFolderId, false);
  const candidatos = hijos.filter((f) => f.mimeType !== CARPETA_FOLDER && esExcelCalculo(f.name));
  if (candidatos.length === 0) return { error: 'no se encontró ningún Excel suelto en la carpeta de la obra' };
  candidatos.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
  return { archivo: candidatos[0], avisoVariosCandidatos: candidatos.length > 1 ? candidatos.map((c) => c.name) : null };
}

async function localizarPdfEnviado(drive, obraFolderId) {
  const dirEnviados = await buscarSubcarpeta(drive, obraFolderId, /envia/i);
  if (!dirEnviados) return { error: 'no se encontró la carpeta "Enviados"' };
  const hijos = await listarHijos(drive, dirEnviados.id, false);
  const pdfs = hijos.filter((f) => /\.pdf$/i.test(f.name));
  if (pdfs.length === 0) return { error: 'la carpeta "Enviados" no tiene ningún PDF', carpetaEnviadosId: dirEnviados.id };
  pdfs.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
  return { archivo: pdfs[0], carpetaEnviadosId: dirEnviados.id };
}

async function localizarOrganizacion(drive, obraFolderId) {
  const dir = await buscarSubcarpeta(drive, obraFolderId, /^\d*\.?\s*organizaci[oó]n/i);
  if (!dir) return { error: 'no se encontró la carpeta "1.Organización"' };
  return { carpeta: dir };
}

// "Doc" es opcional y de ubicación inconsistente (no todas las obras la
// tienen — ver extract_ofertas_proveedor.js) — se busca solo como hijo
// directo de la carpeta de la obra, igual profundidad que "1.Organización".
async function localizarCarpetaDoc(drive, obraFolderId) {
  const dir = await buscarSubcarpeta(drive, obraFolderId, /^docs?$/i);
  if (!dir) return { error: 'no se encontró la carpeta "Doc"' };
  return { carpeta: dir };
}

// Mueve lo que "Doc" tenga suelto (todo lo que no sea ya la propia
// subcarpeta "Origen") adentro de una subcarpeta "Origen" — así, cuando
// "Doc" se traspasa entera al destino, queda claro que ese contenido es lo
// que Geraldinne ya tenía ahí desde el presupuesto, distinto de lo que se
// vaya agregando de acá en más.
async function reorganizarDocEnOrigen(drive, docFolderId, resultados) {
  const hijos = await listarHijos(drive, docFolderId, false);
  const yaOrigen = hijos.find((h) => /^origen$/i.test(h.name));
  const aMover = hijos.filter((h) => !yaOrigen || h.id !== yaOrigen.id).filter((h) => !/^origen$/i.test(h.name));
  if (aMover.length === 0) return;

  let carpetaOrigen = yaOrigen;
  if (!carpetaOrigen) {
    resultados.push(`  crear subcarpeta "Origen" dentro de "Doc"`);
    carpetaOrigen = APLICAR ? await crearCarpeta(drive, docFolderId, 'Origen') : { id: '(simulado:Origen)' };
  }
  for (const item of aMover) {
    await mover(drive, item.id, carpetaOrigen.id, docFolderId, `"${item.name}" -> Doc/Origen`, resultados);
  }
}

async function mover(drive, fileId, nuevoParentId, viejoParentId, descripcion, resultados) {
  resultados.push(`  mover: ${descripcion}`);
  if (APLICAR) {
    await drive.files.update({ fileId, addParents: nuevoParentId, removeParents: viejoParentId, fields: 'id, parents' });
  }
}

async function pedirPendientes() {
  const url = `${process.env.PANEL_API_URL}/presupuestos_en_estudio.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'listar_pendientes_traspaso' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.presupuestos;
}

async function marcarProcesado(obra) {
  const url = `${process.env.PANEL_API_URL}/presupuestos_en_estudio.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ obra, accion: 'marcar_traspaso_procesado' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
}

async function procesarObra(drive, p) {
  const resultados = [];
  console.log(`\n=== ${p.obra} ===`);

  const origen = await localizarCarpetaObraOrigen(drive, p.categoria, p.contacto, p.obra);
  if (origen.error) {
    console.log(`  OMITIDA: ${origen.error}`);
    return { ok: false };
  }

  const excel = await localizarExcelCalculo(drive, origen.id);
  if (excel.error) {
    console.log(`  OMITIDA: ${excel.error}`);
    return { ok: false };
  }
  if (excel.avisoVariosCandidatos) {
    console.log(`  AVISO: hay ${excel.avisoVariosCandidatos.length} Excel en la carpeta, se toma el más reciente: ${excel.avisoVariosCandidatos.join(', ')}`);
  }

  const pdf = await localizarPdfEnviado(drive, origen.id);
  if (pdf.error) {
    console.log(`  OMITIDA: ${pdf.error}`);
    return { ok: false };
  }

  const organizacion = await localizarOrganizacion(drive, origen.id);
  if (organizacion.error) {
    console.log(`  AVISO: ${organizacion.error} — se crea una "1.Organización" nueva en el destino`);
  }

  const doc = await localizarCarpetaDoc(drive, origen.id);

  const destino = await obtenerOCrearCarpetaDestino(drive, origen.categoriaFolderName, origen.contactoFolderName, p.obra);
  if (destino.error) {
    console.log(`  OMITIDA: ${destino.error}`);
    return { ok: false };
  }

  console.log(`  Origen: ${origen.categoriaFolderName}${origen.contactoFolderName ? '/' + origen.contactoFolderName : ''}/${p.obra}`);
  console.log(`  Destino: mismo camino en "SEGUIMIENTO DE OBRAS (Aceptadas)"`);

  await mover(drive, excel.archivo.id, destino.id, origen.id, `Excel "${excel.archivo.name}"`, resultados);
  // El PDF vive dentro de "Enviados" (no es hijo directo de la carpeta de
  // obra) — esa carpeta contenedora se queda en el origen y se va entera a
  // la papelera con el resto (ver más abajo), ya no se archiva aparte.
  await mover(drive, pdf.archivo.id, destino.id, pdf.carpetaEnviadosId, `PDF "${pdf.archivo.name}"`, resultados);

  // "1.Organización": se mueve la que ya existía en el origen, o se crea
  // una nueva vacía en el destino si el origen no tenía ninguna — de
  // cualquier manera, el destino termina siempre con una.
  let organizacionDestinoId;
  if (!organizacion.error) {
    await mover(drive, organizacion.carpeta.id, destino.id, origen.id, `carpeta "${organizacion.carpeta.name}"`, resultados);
    organizacionDestinoId = organizacion.carpeta.id;
  } else {
    const nueva = await obtenerOCrearSubcarpetaSimulable(drive, destino.id, '1.Organización', /^\d*\.?\s*organizaci[oó]n/i, resultados);
    organizacionDestinoId = nueva.id;
  }

  // Estructura fija dentro de "1.Organización" (a pedido de Álvaro):
  // Planos, Fabricación, Vidrios y Medición — esta última con Chapas y
  // Carpintería adentro (Carpintería es donde enviar_medidas_taller.js
  // sube las medidas que Álvaro manda desde el panel).
  await obtenerOCrearSubcarpetaSimulable(drive, organizacionDestinoId, 'Planos', /^planos?$/i, resultados);
  await obtenerOCrearSubcarpetaSimulable(drive, organizacionDestinoId, 'Fabricación', /fabricaci[oó]n/i, resultados);
  await obtenerOCrearSubcarpetaSimulable(drive, organizacionDestinoId, 'Vidrios', /^vidrios?$/i, resultados);
  const medicion = await obtenerOCrearSubcarpetaSimulable(drive, organizacionDestinoId, 'Medición', /medici[oó]n/i, resultados);
  await obtenerOCrearSubcarpetaSimulable(drive, medicion.id, 'Chapas', /^chapas?$/i, resultados);
  await obtenerOCrearSubcarpetaSimulable(drive, medicion.id, 'Carpintería', /carpinter[ií]a/i, resultados);

  // "Doc" (opcional): si existe en el origen, primero se reorganiza lo que
  // tenga suelto dentro de una subcarpeta "Origen", y recién ahí se
  // traspasa entera al destino — igual que "1.Organización".
  if (!doc.error) {
    await reorganizarDocEnOrigen(drive, doc.carpeta.id, resultados);
    await mover(drive, doc.carpeta.id, destino.id, origen.id, `carpeta "${doc.carpeta.name}" (con "Origen" adentro)`, resultados);
  }

  // Antes acá se copiaba una plantilla MEDYSEG.xlsx al destino — a pedido
  // de Alfredo, 2026-09-21: prefiere armarlo él mismo a mano, no que el
  // traspaso le deje uno en blanco (ver "Sin MEDYSEG" en Obras Aceptadas,
  // sync_obras_aceptadas.js, para saber en qué obras todavía falta).

  // Una vez movido todo lo necesario, la carpeta de origen (con lo que le
  // haya quedado adentro: "Enviados" con el resto de PDFs, archivos
  // sueltos) se manda a la papelera de Drive — no un borrado permanente,
  // sigue recuperable ahí por un tiempo. El panel sigue mostrando la obra
  // igual, como "Aceptado" (ver comentario de cabecera).
  resultados.push(`  eliminar (papelera de Drive) la carpeta de origen completa`);

  resultados.forEach((r) => console.log(r));

  if (APLICAR) {
    await drive.files.update({ fileId: origen.id, resource: { trashed: true }, fields: 'id, trashed' });
    await marcarProcesado(p.obra);
    console.log('  OK — avisado al panel.');
  } else {
    console.log('  (simulado, nada se movió/creó/eliminó — correr con --aplicar para ejecutar)');
  }

  return { ok: true };
}

async function main() {
  console.log(APLICAR ? 'MODO REAL: se van a mover archivos de verdad en Drive.' : 'MODO SIMULACIÓN (sin --aplicar) — no se toca nada.');

  const pendientes = await pedirPendientes();
  console.log(`Obras pendientes de traspaso: ${pendientes.length}`);
  if (pendientes.length === 0) return;

  const drive = getDrive();

  let ok = 0;
  let omitidas = 0;
  for (const p of pendientes) {
    const resultado = await procesarObra(drive, p);
    if (resultado.ok) ok++;
    else omitidas++;
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Procesadas: ${ok}`);
  console.log(`Omitidas (revisar a mano): ${omitidas}`);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
