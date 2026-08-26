// Busca el presupuesto enviado más reciente de una obra. Dos fuentes, en
// orden de prioridad:
// 1. Una subcarpeta de envíos dentro de la propia carpeta de la obra (ej.
//    ".../Pasaje del Sur/Enviados/") — confiable, no depende de adivinar
//    nombres.
// 2. Si no existe esa subcarpeta (obras que todavía no migraron a esa
//    convención), la carpeta global "Presupuestos Enviados", cruzando por
//    coincidencia de palabras con el nombre de la obra.
// Sirve para dos cosas:
// 1. Respaldo de Cliente/RAL/Vidrio/Persiana cuando la hoja "Ficha" del
//    Excel interno viene vacía.
// 2. La fecha de envío (siempre, independientemente de si el resto de los
//    campos ya venían completos), para saber la antigüedad del presupuesto.
//
// Cuando la carpeta de la obra trae varias "opciones" (alternativas, no
// revisiones: PDFs con "Opción A"/"Opción B" en el nombre), resolverEnviosDeObra
// devuelve un resultado por opción para que sync_all.js las suba como filas
// separadas del panel ("Obra — Opción A", "Obra — Opción B").
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

// Cruce por palabras en vez de substring exacto: desde que "obra" se resuelve
// por carpeta (ver resolver_obra.js) puede traer texto que el PDF enviado no
// tiene (ej. carpeta "IESO Amalia Avia 20" vs PDF "...IESO Amalia Avia,
// Ejuca.pdf") o al revés. Cuenta como match si casi todas las palabras
// significativas (>2 letras) de la obra aparecen en el nombre del PDF.
function normalizarPalabras(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos para comparar
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 2);
}

const UMBRAL_COINCIDENCIA_PALABRAS = 0.7;

function coincideConObra(obra, nombreArchivo) {
  const palabrasObra = normalizarPalabras(obra);
  if (palabrasObra.length === 0) return nombreArchivo.toLowerCase().includes(obra.toLowerCase());
  const palabrasArchivo = new Set(normalizarPalabras(nombreArchivo));
  const coincidentes = palabrasObra.filter((p) => palabrasArchivo.has(p));
  return coincidentes.length / palabrasObra.length >= UMBRAL_COINCIDENCIA_PALABRAS;
}

async function buscarPdfEnviado(drive, enviadosFolderId, obra) {
  const indice = await obtenerIndicePdfsEnviados(drive, enviadosFolderId);
  const coincidencias = indice
    .filter((f) => coincideConObra(obra, f.name))
    .sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
  return coincidencias[0] || null;
}

// Prioridad alternativa: si dentro de la propia carpeta de la obra hay una
// subcarpeta de envíos (cualquier nombre que contenga "enviad-", ej.
// "Enviados", "Presupuestos Enviados"), se usa el PDF más reciente de ahí en
// vez de la búsqueda por nombre en la carpeta global — es más confiable
// porque no depende de adivinar el nombre, está guardado a propósito junto
// a la obra. Recorrido acotado a la carpeta de la obra, no al árbol
// completo de Drive.
async function pdfsEnCarpetaObra(drive, obraFolderId) {
  const res = await drive.files.list({
    q: `'${obraFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 1000,
  });
  const subcarpetasEnviados = res.data.files.filter((f) => /envia/i.test(f.name));
  if (subcarpetasEnviados.length === 0) return [];

  const pdfs = [];
  for (const carpeta of subcarpetasEnviados) {
    await listarPdfsRecursivo(drive, carpeta.id, pdfs);
  }
  return pdfs;
}

// Distingue "opciones" (alternativas del mismo proyecto: distinto material,
// distinto precio) de simples revisiones cronológicas. Convención: el
// nombre del PDF incluye "Opción A", "Opción B"... — quien no lleve esa
// etiqueta se trata como revisión normal (se queda solo la más reciente).
function extraerEtiquetaOpcion(nombreArchivo) {
  const m = nombreArchivo.match(/opci[oó]n\s*([a-z0-9]+)/i);
  return m ? m[1].toUpperCase() : null;
}

// Devuelve una "variante" por resultado: { etiqueta, archivo }. etiqueta es
// null cuando no hay opciones (un solo resultado, el PDF más reciente entre
// todos). Si hay al menos un PDF etiquetado, se ignoran los que no lo están
// (se asume que son borradores previos a separar en opciones) y se devuelve
// un resultado por etiqueta distinta, con el más reciente de cada una.
async function buscarVariantesEnCarpetaObra(drive, obraFolderId) {
  const pdfs = await pdfsEnCarpetaObra(drive, obraFolderId);
  if (pdfs.length === 0) return [];

  const etiquetados = pdfs
    .map((archivo) => ({ archivo, etiqueta: extraerEtiquetaOpcion(archivo.name) }))
    .filter((p) => p.etiqueta !== null);

  if (etiquetados.length === 0) {
    const masReciente = [...pdfs].sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime))[0];
    return [{ etiqueta: null, archivo: masReciente }];
  }

  const porEtiqueta = new Map();
  for (const { archivo, etiqueta } of etiquetados) {
    const actual = porEtiqueta.get(etiqueta);
    if (!actual || new Date(archivo.modifiedTime) > new Date(actual.modifiedTime)) {
      porEtiqueta.set(etiqueta, archivo);
    }
  }
  return Array.from(porEtiqueta.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([etiqueta, archivo]) => ({ etiqueta, archivo }));
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

// Fabricante -> material de carpintería. No hay una etiqueta explícita en
// el PDF para esto, así que se infiere del fabricante. Ir completando a
// medida que aparezcan fabricantes nuevos que no estén acá (quedan en
// blanco, no se inventa un valor).
const MATERIAL_POR_FABRICANTE = {
  deceuninck: 'PVC',
  deceunick: 'PVC', // así aparece escrito en los PDF de Galvi (con typo)
  alugom: 'PVC',
  kommerling: 'PVC',
  rehau: 'PVC',
  veka: 'PVC',
  salamander: 'PVC',
  cortizo: 'Aluminio',
  technal: 'Aluminio',
  schuco: 'Aluminio',
  reynaers: 'Aluminio',
  hydro: 'Aluminio',
};

function normalizarClave(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Campos para la hoja "Ficha" del Excel de cálculo (distinto de
// parseTextoPresupuestoEnviado, que es lo que ya se usa para completar el
// panel). Mismo documento fuente (el PDF enviado), pero acá se extrae todo
// el detalle técnico: proveedor, serie, colores, tipo de apertura, motor,
// etc. Basado en el bloque repetido por cada ventana en el PDF:
//   ⦁ Fabricante: DECEUNICK
//   ⦁ Serie: PASIV PLUS THERMOFIBRA
//   ⦁ Color: LACADO BLANCO
//   ⦁ Ral: .
//   ⦁ Superficie: 4 MATE /20/4
//   Compacto: Cajón monobloc pvc 200mm, lama térmica de aluminio ...
//     con color de cajón lacado blanco -9010 con color de lamas
//     lacado blanco -9010, motor via radio
function extraerCamposFicha(text) {
  // "A / 202600140 - 1": el "-1" es la versión del presupuesto (un mismo
  // número puede tener varias versiones), hay que conservarlo — no es un
  // número puro entonces, se guarda como texto "202600140-1".
  const numeroMatch = text.match(/PRESUPUESTO\s*N[ºo]:\s*[^\d]*(\d{5,})\s*-\s*(\d+)/i);
  const numeroPpto = numeroMatch ? `${numeroMatch[1]}-${numeroMatch[2]}` : null;

  const proveedorMatch = text.match(/Fabricante:\s*(.+)/i);
  const proveedor = proveedorMatch ? proveedorMatch[1].trim() : null;

  const series = (text.match(/Serie:\s*(.+)/i) || [])[1]?.trim() || null;
  const colorCarpinteria = (text.match(/Color:\s*(.+)/i) || [])[1]?.trim() || null;

  const ralMatch = text.match(/Ral:\s*(.+)/i);
  const ralTexto = ralMatch ? ralMatch[1].trim() : null;
  const ralSilicona = ralTexto && ralTexto !== '.' ? ralTexto : null;

  const compactoMatch = text.match(/Compacto:\s*([\s\S]*?)Metros Cuadrados:/i);
  const compactoTexto = compactoMatch ? compactoMatch[1].replace(/\s+/g, ' ').trim() : null;

  const persianas = compactoTexto ? 'SI' : null;
  const colorPersianas =
    (compactoTexto || '').match(/color de lamas\s+([^,]+)/i)?.[1]?.trim() ||
    (compactoTexto || '').match(/color de caj[oó]n\s+([^,]+)/i)?.[1]?.trim() ||
    null;
  // Corta antes del patrón de medidas ("0,480 × 1,180 m"), no en la primera
  // coma — los números en español usan coma decimal, así que cortar en la
  // coma partía "aluminio 0,480" a la mitad.
  const modeloLamas = (compactoTexto || '').match(/lama\s+([^\d]+?)\s*[\d.,]+\s*[×x]\s*[\d.,]+\s*m\b/i)?.[1]?.trim() || null;
  const motorRadio = /motor\s+v[ií]a?\s*radio/i.test(compactoTexto || '') ? 'SI' : null;
  const motorMecanico = /motor\s+mec[aá]nico/i.test(compactoTexto || '') ? 'SI' : null;
  const composite = /composite/i.test(text) ? 'SI' : null;

  // El presupuesto trae un ítem por tipo de ventana, cada uno cerrando con
  // "Metros Cuadrados:" — se cuenta por ítem (línea del presupuesto), no por
  // unidad física exacta: un código "V1 - V5" puede representar varias
  // ventanas iguales agrupadas en un solo ítem, y el texto del PDF no trae
  // ese desglose de forma parseable.
  const items = text.split(/Metros Cuadrados:/i).slice(0, -1);
  let correderasCount = 0;
  let abatiblesCount = 0;
  const vidriosPorTipo = new Map();
  for (const item of items) {
    if (/corredera/i.test(item)) correderasCount++;
    if (/oscilobatiente|abatible|practicable/i.test(item)) abatiblesCount++;
    const vidrioItem = item.match(/Superficie:\s*([^\n⦁]+)/i)?.[1]?.trim();
    if (vidrioItem) vidriosPorTipo.set(vidrioItem, (vidriosPorTipo.get(vidrioItem) || 0) + 1);
  }
  const correderas = correderasCount > 0 ? String(correderasCount) : null;
  const abatibles = abatiblesCount > 0 ? String(abatiblesCount) : null;
  const vidrio =
    vidriosPorTipo.size > 0
      ? Array.from(vidriosPorTipo.entries())
          .map(([tipo, cant]) => `${tipo} (x${cant})`)
          .join(', ')
      : null;

  const carpinteria = proveedor ? MATERIAL_POR_FABRICANTE[normalizarClave(proveedor)] || null : null;

  return {
    numeroPpto,
    proveedor,
    series,
    colorCarpinteria,
    ralSilicona,
    vidrio,
    carpinteria,
    correderas,
    abatibles,
    persianas,
    colorPersianas,
    modeloLamas,
    motorRadio,
    motorMecanico,
    composite,
  };
}

async function extraerRellenoDePdf(archivo, camposFaltantes) {
  const drive = getDrive();
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

async function completarDesdeEnviado(obra, camposFaltantes, obraFolderId) {
  const drive = getDrive();

  let archivo = null;
  if (obraFolderId) {
    const variantes = await buscarVariantesEnCarpetaObra(drive, obraFolderId);
    archivo = variantes[0] ? variantes[0].archivo : null;
  }
  if (!archivo) {
    const enviadosFolderId = process.env.GOOGLE_DRIVE_ENVIADOS_FOLDER_ID;
    if (enviadosFolderId) {
      archivo = await buscarPdfEnviado(drive, enviadosFolderId, obra);
    }
  }
  if (!archivo) return {};

  return extraerRellenoDePdf(archivo, camposFaltantes);
}

// Como completarDesdeEnviado, pero devuelve una entrada por cada "opción"
// encontrada en la carpeta de la obra (ver buscarVariantesEnCarpetaObra) en
// vez de una sola. Cada entrada trae su propio sufijo para el nombre de
// obra en el panel ("" si no hay opciones, " — Opción A" / " — Opción B" si
// las hay) y sus propios campos extraídos de ESE PDF puntual.
async function resolverEnviosDeObra(obra, camposFaltantes, obraFolderId) {
  const drive = getDrive();

  let variantes = [];
  if (obraFolderId) {
    variantes = await buscarVariantesEnCarpetaObra(drive, obraFolderId);
  }
  if (variantes.length === 0) {
    const enviadosFolderId = process.env.GOOGLE_DRIVE_ENVIADOS_FOLDER_ID;
    if (enviadosFolderId) {
      const archivo = await buscarPdfEnviado(drive, enviadosFolderId, obra);
      if (archivo) variantes = [{ etiqueta: null, archivo }];
    }
  }
  if (variantes.length === 0) return [{ sufijo: '', campos: {} }];

  const resultados = [];
  for (const { etiqueta, archivo } of variantes) {
    const campos = await extraerRellenoDePdf(archivo, camposFaltantes);
    resultados.push({ sufijo: etiqueta ? ` — Opción ${etiqueta}` : '', campos });
  }
  return resultados;
}

module.exports = {
  completarDesdeEnviado,
  resolverEnviosDeObra,
  parseTextoPresupuestoEnviado,
  coincideConObra,
  extraerEtiquetaOpcion,
  extraerCamposFicha,
};
