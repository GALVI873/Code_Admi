// Traspaso de Drive al aceptar un presupuesto: mueve la carpeta de la obra
// desde "HOJAS DE CALCULO (PPTOS)" (en estudio) a "SEGUIMIENTO DE OBRAS
// (Aceptadas)", dejando en la carpeta nueva solo el Excel de cálculo, el
// PDF más reciente de "Enviados" (el presupuesto aprobado) y la carpeta
// "1.Organización" completa (con "Valoración" adentro) — el resto de lo
// que había en el origen (la propia carpeta "Enviados" con lo que le
// quede, otros archivos sueltos) se archiva en una subcarpeta "_Archivo"
// DENTRO del origen, nunca se borra. También copia la plantilla
// MEDYSEG.xlsx (vive directo en la raíz de GOOGLE_DRIVE_OBRAS_ACEPTADAS_
// FOLDER_ID) a la carpeta nueva, renombrada con el nombre de la obra.
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

async function localizarPlantillaMedyseg(drive) {
  const rootId = process.env.GOOGLE_DRIVE_OBRAS_ACEPTADAS_FOLDER_ID;
  const res = await drive.files.list({
    q: `'${rootId}' in parents and name = 'MEDYSEG.xlsx' and trashed = false`,
    fields: 'files(id, name)',
  });
  return res.data.files[0] || null;
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

async function procesarObra(drive, plantillaMedysegId, p) {
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
    console.log(`  AVISO: ${organizacion.error} — se traspasa igual sin ella`);
  }

  const destino = await obtenerOCrearCarpetaDestino(drive, origen.categoriaFolderName, origen.contactoFolderName, p.obra);
  if (destino.error) {
    console.log(`  OMITIDA: ${destino.error}`);
    return { ok: false };
  }

  console.log(`  Origen: ${origen.categoriaFolderName}${origen.contactoFolderName ? '/' + origen.contactoFolderName : ''}/${p.obra}`);
  console.log(`  Destino: mismo camino en "SEGUIMIENTO DE OBRAS (Aceptadas)"`);

  const idsMovidosDeOrigen = [excel.archivo.id];
  await mover(drive, excel.archivo.id, destino.id, origen.id, `Excel "${excel.archivo.name}"`, resultados);
  // El PDF vive dentro de "Enviados" (no es hijo directo de la carpeta de
  // obra) — su carpeta contenedora sigue el flujo normal de "sobrante" más
  // abajo, así que archivar Enviados con lo que le quede es automático.
  await mover(drive, pdf.archivo.id, destino.id, pdf.carpetaEnviadosId, `PDF "${pdf.archivo.name}"`, resultados);
  if (!organizacion.error) {
    idsMovidosDeOrigen.push(organizacion.carpeta.id);
    await mover(drive, organizacion.carpeta.id, destino.id, origen.id, `carpeta "${organizacion.carpeta.name}"`, resultados);
  }

  // Lo que sobra en el origen (carpeta "Enviados" con lo que le quede,
  // otros archivos sueltos) se archiva junto, no se borra nada. Al mover
  // afuera también "Enviados" por nombre, la carpeta de origen deja de
  // tener ninguna marca de "carpeta de obra" (Enviados/Organización/
  // Valoración) y sync_all.js ya no la vuelve a descubrir.
  const hijosRestantes = await listarHijos(drive, origen.id, false);
  const sobrantes = hijosRestantes.filter((h) => !idsMovidosDeOrigen.includes(h.id) && h.name !== '_Archivo');
  if (sobrantes.length > 0) {
    const carpetaArchivo = await (APLICAR
      ? obtenerOCrearSubcarpeta(drive, origen.id, '_Archivo', /^_archivo$/i)
      : Promise.resolve({ id: '(simulado)' }));
    for (const item of sobrantes) {
      await mover(drive, item.id, carpetaArchivo.id, origen.id, `sobrante "${item.name}" -> _Archivo`, resultados);
    }
  }

  const nombreMedyseg = `${p.obra} MEDYSEG.xlsx`;
  resultados.push(`  copiar plantilla MEDYSEG como "${nombreMedyseg}"`);
  if (APLICAR) {
    if (!plantillaMedysegId) {
      console.log('  AVISO: no se encontró la plantilla MEDYSEG.xlsx, no se copió.');
    } else {
      await drive.files.copy({
        fileId: plantillaMedysegId,
        resource: { name: nombreMedyseg, parents: [destino.id] },
        fields: 'id, name',
      });
    }
  }

  resultados.forEach((r) => console.log(r));

  if (APLICAR) {
    await marcarProcesado(p.obra);
    console.log('  OK — avisado al panel.');
  } else {
    console.log('  (simulado, nada se movió — correr con --aplicar para ejecutar)');
  }

  return { ok: true };
}

async function main() {
  console.log(APLICAR ? 'MODO REAL: se van a mover archivos de verdad en Drive.' : 'MODO SIMULACIÓN (sin --aplicar) — no se toca nada.');

  const pendientes = await pedirPendientes();
  console.log(`Obras pendientes de traspaso: ${pendientes.length}`);
  if (pendientes.length === 0) return;

  const drive = getDrive();
  const plantilla = await localizarPlantillaMedyseg(drive);
  if (!plantilla) {
    console.log('AVISO: no se encontró "MEDYSEG.xlsx" en la raíz de SEGUIMIENTO DE OBRAS (Aceptadas)/2026 — se va a seguir igual, pero no se va a poder copiar la plantilla.');
  }

  let ok = 0;
  let omitidas = 0;
  for (const p of pendientes) {
    const resultado = await procesarObra(drive, plantilla ? plantilla.id : null, p);
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
