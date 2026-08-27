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

// Un PDF no puede ser el envío de una obra si se creó en Drive ANTES de que
// la carpeta de esa obra existiera — caso real: "Navacerrada" (Arq. Silvia
// San Martín) no tiene carpeta "Enviados" propia, así que se cae a la
// búsqueda global por nombre; ahí "Navacerrada" (una sola palabra
// significativa, coincide con casi cualquier cosa) enganchó un presupuesto
// de 2024 de la MISMA arquitecta para un proyecto distinto que reusa el
// mismo nombre de lugar — el archivo es real, pero no es de esta obra. Sin
// esta fecha de corte, cualquier obra con nombre corto/común y sin carpeta
// de Enviados propia corre el mismo riesgo.
function esPosterior(archivo, fechaCreacionCarpeta) {
  if (!fechaCreacionCarpeta) return true;
  return archivo.createdTime.slice(0, 10) >= fechaCreacionCarpeta;
}

async function buscarPdfEnviado(drive, enviadosFolderId, obra, fechaCreacionCarpeta) {
  const indice = await obtenerIndicePdfsEnviados(drive, enviadosFolderId);
  const coincidencias = indice
    .filter((f) => coincideConObra(obra, f.name))
    .filter((f) => esPosterior(f, fechaCreacionCarpeta))
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
async function pdfsEnCarpetaObra(drive, obraFolderId, fechaCreacionCarpeta) {
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
  return pdfs.filter((f) => esPosterior(f, fechaCreacionCarpeta));
}

// Distingue "opciones" (alternativas del mismo proyecto: distinto material,
// distinto precio) de simples revisiones cronológicas. Dos convenciones en
// uso: "Opción A"/"Opción B" (letra) y la abreviada "Op.1"/"Op.2" (número,
// ej. "(Alfonso XIII, Bajo 2) Op.1 Inox."). Quien no lleve ninguna se trata
// como revisión normal (se queda solo la más reciente).
function extraerEtiquetaOpcion(nombreArchivo) {
  const mPalabra = nombreArchivo.match(/\bopci[oó]n\s*([a-z0-9]+)/i);
  if (mPalabra) return mPalabra[1].toUpperCase();
  // \b...\d+\b evita falsos positivos con palabras que empiezan "op" sin
  // ser la abreviatura (ej. "Operacion123" no matchea: after "op" no hay
  // "." ni espacio ni dígito inmediato).
  const mAbrev = nombreArchivo.match(/\bop\.?\s*(\d+)\b/i);
  return mAbrev ? mAbrev[1] : null;
}

// Descarga y parsea cada PDF una sola vez acá — se reutiliza tanto para
// distinguir carpintería/complementario como para extraer campos más abajo,
// en vez de bajar el mismo archivo dos veces.
async function pdfsConTexto(drive, archivos) {
  const resultado = [];
  for (const archivo of archivos) {
    const buffer = await descargarComoBuffer(drive, archivo.id);
    const { text } = await pdfParse(buffer);
    resultado.push({ archivo, text });
  }
  return resultado;
}

// Devuelve una "variante" por resultado: { etiqueta, archivo, text }, más el
// total combinado de los PDF complementarios de la carpeta (motorización de
// persianas, barandillas, etc. — cualquiera que no sea de carpintería), que
// se muestra aparte en el panel y nunca se mezcla con el precio de
// carpintería. etiqueta es null cuando no hay opciones (un solo resultado,
// el PDF de carpintería más reciente). Si hay al menos un PDF etiquetado
// ("Opción A"/"Opción B"), se ignoran los que no lo están entre los de
// carpintería (se asume que son borradores previos a separar en opciones) y
// se devuelve un resultado por etiqueta distinta, con el más reciente de
// cada una.
async function buscarVariantesEnCarpetaObra(drive, obraFolderId, fechaCreacionCarpeta) {
  const archivos = await pdfsEnCarpetaObra(drive, obraFolderId, fechaCreacionCarpeta);
  if (archivos.length === 0) return { variantes: [], precioComplementario: null };

  const pdfs = await pdfsConTexto(drive, archivos);

  // Si NINGÚN pdf de la carpeta es de carpintería (obra rara, solo
  // complementos) se tratan todos como candidatos igual, para no perder el
  // envío completo.
  const deCarpinteria = pdfs.filter((p) => esPdfDeCarpinteria(p.text));
  const complementarios = pdfs.filter((p) => !esPdfDeCarpinteria(p.text));
  const candidatos = deCarpinteria.length > 0 ? deCarpinteria : pdfs;

  const precioComplementario = complementarios.length > 0
    ? complementarios.reduce((suma, p) => suma + (extraerTotalPresupuesto(p.text) || 0), 0)
    : null;

  const etiquetados = candidatos
    .map((p) => ({ ...p, etiqueta: extraerEtiquetaOpcion(p.archivo.name) }))
    .filter((p) => p.etiqueta !== null);

  if (etiquetados.length === 0) {
    const masReciente = [...candidatos].sort((a, b) => new Date(b.archivo.modifiedTime) - new Date(a.archivo.modifiedTime))[0];
    return {
      variantes: [{ etiqueta: null, archivo: masReciente.archivo, text: masReciente.text }],
      precioComplementario,
    };
  }

  const porEtiqueta = new Map();
  for (const p of etiquetados) {
    const actual = porEtiqueta.get(p.etiqueta);
    if (!actual || new Date(p.archivo.modifiedTime) > new Date(actual.archivo.modifiedTime)) {
      porEtiqueta.set(p.etiqueta, p);
    }
  }
  const variantes = Array.from(porEtiqueta.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([etiqueta, p]) => ({ etiqueta, archivo: p.archivo, text: p.text }));

  return { variantes, precioComplementario };
}

// Arma un resumen de una línea (tipo de lama + motor) a partir de los
// campos YA extraídos por extraerCamposFicha (ver más abajo), que delimita
// cada ítem del presupuesto en vez de tomar la primera coincidencia de
// "Compacto:"/"Metros Cuadrados:" de todo el documento.
function resumenPersiana(campos) {
  if (!campos.persianas) return null;
  const partes = [];
  if (campos.modeloLamas) partes.push(campos.modeloLamas);
  if (campos.motorRadio) partes.push('Motor vía radio');
  if (campos.motorMecanico) partes.push('Motor mecánico');
  return partes.length > 0 ? partes.join(' — ') : 'SI';
}

// Campos para el panel (distinto de extraerCamposFicha, que es lo que llena
// la hoja "Ficha" del Excel — ver más abajo). Antes esta función tenía su
// propia extracción con un solo regex por campo tomando la PRIMERA
// coincidencia en todo el documento (no por ítem) — en presupuestos con
// varios tipos de ventana eso podía mezclar Vidrio con Serie de carpintería,
// o el vidrio de un ítem con la persiana de otro. Ahora reutiliza
// extraerCamposFicha, que sí delimita cada ítem, y solo agrega lo que le es
// propio (Cliente, que sale de la cabecera "OBRA:", no de un ítem).
function parseTextoPresupuestoEnviado(text) {
  const clienteMatch = text.match(/OBRA:.*\n(.+)\n/);
  const cliente = clienteMatch ? clienteMatch[1].trim() : null;

  const campos = extraerCamposFicha(text);
  // "Ral de carpintería si existe, si no el color" — mismo criterio pedido
  // para el panel, ya resuelto por extraerCamposFicha vía ralSilicona (Ral:
  // real) con este mismo respaldo a colorCarpinteria (Color:) acá.
  const ral = campos.ralSilicona || campos.colorCarpinteria || null;

  return { cliente, ral, vidrio: campos.vidrio, persiana: resumenPersiana(campos) };
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
// "A / 202600140 - 1": el "-1" es la versión del presupuesto (un mismo
// número puede tener varias versiones), hay que conservarlo — no es un
// número puro entonces, se guarda como texto "202600140-1".
function extraerNumeroPpto(text) {
  const numeroMatch = text.match(/PRESUPUESTO\s*N[ºo]:\s*[^\d]*(\d{5,})\s*-\s*(\d+)/i);
  return numeroMatch ? `${numeroMatch[1]}-${numeroMatch[2]}` : null;
}

// Un PDF de presupuesto Galvi puede ser un presupuesto de carpintería
// (ventanas/puertas, con Fabricante/Serie/Superficie por ítem) o un
// complemento de otro tipo de producto (ej. "incorporación de motor a
// persianas propiedad del cliente" — sin ninguna de esas etiquetas). Sirve
// para no elegir por error un PDF complementario como el principal de la
// obra (se pisaría el Nº Ppto/Fecha con el del complemento) y para saber
// cuándo una obra necesita llenado manual (ningún PDF de carpintería).
function esPdfDeCarpinteria(text) {
  return /Fabricante:/i.test(text) && /Serie:/i.test(text);
}

// Plantilla propia de Galvi (a diferencia de las ofertas de proveedor, que
// no tienen una plantilla común): siempre cierra con "Suma total" (sin IVA),
// "Total presupuesto" (con IVA) y el desglose del IVA. Se ancla a "Suma
// total", no a "Total presupuesto": precio_ultimo_presupuesto para TODAS las
// demás obras del panel sale de la hoja "Comparativa" del Excel de cálculo
// (ver extract_fields.js), que también es sin IVA (columna "Suma de Total
// Presupesto") — hay que usar la misma base acá para que el valor de una
// obra con varias opciones sea comparable con el de cualquier otra. En el
// texto extraído por pdf-parse el valor queda antes que su etiqueta por el
// orden de columnas del PDF, no al revés.
function extraerTotalPresupuesto(text) {
  const m = text.match(/([\d.]+,\d{2})\s*€\s*Suma total/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
  return Number.isNaN(num) ? null : num;
}

function extraerCamposFicha(text) {
  const numeroPpto = extraerNumeroPpto(text);

  const proveedorMatch = text.match(/Fabricante:\s*(.+)/i);
  const proveedor = proveedorMatch ? proveedorMatch[1].trim() : null;

  const colorCarpinteria = (text.match(/Color:\s*(.+)/i) || [])[1]?.trim() || null;

  const ralMatch = text.match(/Ral:\s*(.+)/i);
  const ralTexto = ralMatch ? ralMatch[1].trim() : null;
  const ralSilicona = ralTexto && ralTexto !== '.' ? ralTexto : null;

  const composite = /composite/i.test(text) ? 'SI' : null;

  // El presupuesto trae un ítem por tipo de ventana. Se separa por el
  // comienzo de cada ítem ("Ventana .../Puerta ...oscilobatiente/corredera/
  // abatible/practicable"), no por el cierre — hay al menos dos plantillas
  // distintas en uso (una cierra cada ítem con "Metros Cuadrados:", otra con
  // "Tapajunta:" y sin línea de m²), y el comienzo es lo único consistente
  // entre ambas. "Correderas"/"Abatibles" no son un conteo: llevan la(s)
  // Serie(s) que se usó para ese tipo de apertura (pueden diferir, ej.
  // "PASIV PLUS THERMOFIBRA" para las abatibles y "ISLIDE PVC" para las
  // correderas del mismo presupuesto). "Vidrio" lista los tipos que
  // aparecen, sin cantidades.
  const items = text.split(/(?=\b(?:Ventana|Puerta)\s+(?:oscilobatiente|corredera|abatible|practicable))/i).slice(1);
  const seriesCorrederas = new Set();
  const seriesAbatibles = new Set();
  // Map en vez de Set: dos ítems pueden describir el mismo vidrio con
  // distinta may/minúscula ("Luna de 4 mm" / "luna de 4 mm") — se dedupe
  // ignorando mayúsculas pero conservando la primera forma vista.
  const tiposVidrioVistos = new Map();
  function agregarTipoVidrio(texto) {
    const clave = texto.toLowerCase();
    if (!tiposVidrioVistos.has(clave)) tiposVidrioVistos.set(clave, texto);
  }
  const coloresPersianas = new Set();
  const modelosLamas = new Set();
  let hayPersiana = false;
  let hayMotorRadio = false;
  let hayMotorMecanico = false;

  // Etiqueta siguiente conocida — corta ahí en vez de en el primer salto de
  // línea. Varios valores (Serie, Superficie, Compacto) envuelven a la línea
  // siguiente según el formato de PDF, y no todas las etiquetas llevan ":"
  // ni aparecen siempre (ej. "Premarco"/"Cremona" solo en algunos ítems) —
  // sin incluirlas acá se colaban dentro del valor anterior.
  const HASTA_SIGUIENTE_ETIQUETA =
    '(?=\\s*⦁?\\s*(?:Fabricante\\s*:|Serie\\s*:|Color\\s*:|Ral\\s*:|Medida\\s*:|Superficie\\s*:|Compacto\\s*:|Premarco\\s*:?|Cremona\\s*:?|Maneta\\s*:?|Tapajunta\\s*:|Metros Cuadrados\\s*:|$))';

  // Algunos PDF traen en "Superficie:" solo la composición del vidrio (ej.
  // "4 MATE /20/4"), otros la medida y cantidad pegadas a continuación (ej.
  // "Luna de 4 mm 1,491 × 2,145 m (1 u.)") — mismo texto real del PDF, no un
  // error de parseo. Solo interesa la composición para ver qué tipos de
  // vidrio hay, así que se recorta cualquier "NNN × NNN m (N u.)" que
  // aparezca (y la coma que lo separaba de la composición).
  const PATRON_MEDIDA_CANTIDAD = /\s*[\d.,]+\s*[×x]\s*[\d.,]+\s*m\.?\s*\(\s*\d+\s*u\.?\)/gi;
  function soloComposicionVidrio(texto) {
    return texto
      .replace(PATRON_MEDIDA_CANTIDAD, ' ')
      .split(',')
      .map((parte) => parte.trim().replace(/[()]/g, ''))
      .filter(Boolean);
  }

  for (const item of items) {
    const serieItem = item
      .match(new RegExp(`Serie:\\s*([\\s\\S]*?)${HASTA_SIGUIENTE_ETIQUETA}`, 'i'))?.[1]
      ?.replace(/\s+/g, ' ')
      .trim();
    if (/corredera/i.test(item) && serieItem) seriesCorrederas.add(serieItem);
    if (/oscilobatiente|abatible|practicable/i.test(item) && serieItem) seriesAbatibles.add(serieItem);

    const vidrioItem = item
      .match(new RegExp(`Superficie:\\s*([\\s\\S]*?)${HASTA_SIGUIENTE_ETIQUETA}`, 'i'))?.[1]
      ?.replace(/\s+/g, ' ')
      .trim();
    if (vidrioItem) soloComposicionVidrio(vidrioItem).forEach(agregarTipoVidrio);

    const compactoItem = item
      .match(new RegExp(`Compacto:\\s*([\\s\\S]*?)${HASTA_SIGUIENTE_ETIQUETA}`, 'i'))?.[1]
      ?.replace(/\s+/g, ' ')
      .trim();
    if (compactoItem) {
      hayPersiana = true;
      const color =
        // Corta en la coma si hay, o antes de " con " (ej. "...-9010 con
        // motor via radio") — no siempre hay coma después del color.
        compactoItem.match(/color de lamas\s+([^,]+?)(?=,|\s+con\s|$)/i)?.[1]?.trim() ||
        compactoItem.match(/color de caj[oó]n\s+([^,]+?)(?=,|\s+con\s|$)/i)?.[1]?.trim();
      if (color) coloresPersianas.add(color);
      // Corta antes del patrón de medidas ("0,480 × 1,180 m"), no en la
      // primera coma — los números en español usan coma decimal, así que
      // cortar en la coma partía "aluminio 0,480" a la mitad.
      const modelo = compactoItem.match(/lama\s+([^\d]+?)\s*[\d.,]+\s*[×x]\s*[\d.,]+\s*m\b/i)?.[1]?.trim();
      if (modelo) modelosLamas.add(modelo);
      if (/motor\s+v[ií]a?\s*radio/i.test(compactoItem)) hayMotorRadio = true;
      if (/motor\s+mec[aá]nico/i.test(compactoItem)) hayMotorMecanico = true;
    }
  }

  const correderas = seriesCorrederas.size > 0 ? Array.from(seriesCorrederas).join(', ') : null;
  const abatibles = seriesAbatibles.size > 0 ? Array.from(seriesAbatibles).join(', ') : null;
  const vidrio = tiposVidrioVistos.size > 0 ? Array.from(tiposVidrioVistos.values()).join(', ') : null;
  const persianas = hayPersiana ? 'SI' : null;
  const colorPersianas = coloresPersianas.size > 0 ? Array.from(coloresPersianas).join(', ') : null;
  const modeloLamas = modelosLamas.size > 0 ? Array.from(modelosLamas).join(', ') : null;
  const motorRadio = hayMotorRadio ? 'SI' : null;
  const motorMecanico = hayMotorMecanico ? 'SI' : null;

  const carpinteria = proveedor ? MATERIAL_POR_FABRICANTE[normalizarClave(proveedor)] || null : null;

  return {
    numeroPpto,
    proveedor,
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

function construirRelleno(archivo, text, camposFaltantes) {
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

async function extraerRellenoDePdf(archivo, camposFaltantes) {
  const drive = getDrive();
  const buffer = await descargarComoBuffer(drive, archivo.id);
  const { text } = await pdfParse(buffer);
  return construirRelleno(archivo, text, camposFaltantes);
}

async function completarDesdeEnviado(obra, camposFaltantes, obraFolderId, fechaCreacionCarpeta) {
  const drive = getDrive();

  let archivo = null;
  if (obraFolderId) {
    const { variantes } = await buscarVariantesEnCarpetaObra(drive, obraFolderId, fechaCreacionCarpeta);
    archivo = variantes[0] ? variantes[0].archivo : null;
  }
  if (!archivo) {
    const enviadosFolderId = process.env.GOOGLE_DRIVE_ENVIADOS_FOLDER_ID;
    if (enviadosFolderId) {
      archivo = await buscarPdfEnviado(drive, enviadosFolderId, obra, fechaCreacionCarpeta);
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
async function resolverEnviosDeObra(obra, camposFaltantes, obraFolderId, fechaCreacionCarpeta) {
  const drive = getDrive();

  let variantes = [];
  let precioComplementario = null;
  if (obraFolderId) {
    ({ variantes, precioComplementario } = await buscarVariantesEnCarpetaObra(drive, obraFolderId, fechaCreacionCarpeta));
  }
  if (variantes.length === 0) {
    const enviadosFolderId = process.env.GOOGLE_DRIVE_ENVIADOS_FOLDER_ID;
    if (enviadosFolderId) {
      const archivo = await buscarPdfEnviado(drive, enviadosFolderId, obra, fechaCreacionCarpeta);
      if (archivo) {
        const buffer = await descargarComoBuffer(drive, archivo.id);
        const { text } = await pdfParse(buffer);
        variantes = [{ etiqueta: null, archivo, text }];
      }
    }
  }
  if (variantes.length === 0) return [{ sufijo: '', campos: {} }];

  // Hay más de una opción de verdad (no un simple envío único): el precio
  // del Excel compartido (camposBase en sync_all.js) es el mismo para todas
  // porque hay un solo Excel de cálculo por carpeta de obra — acá se
  // reemplaza por el total propio de CADA presupuesto enviado, que sí es
  // distinto entre opciones (ej. Alfonso XIII, Bajo 2: Opción A en blanco
  // vs Opción B en inox, precios distintos). En el caso normal de una sola
  // opción no se toca: el valor del Excel sigue siendo la fuente.
  const esMultiOpcion = variantes.some((v) => v.etiqueta !== null);

  const resultados = [];
  for (const { etiqueta, archivo, text } of variantes) {
    const campos = construirRelleno(archivo, text, camposFaltantes);
    if (esMultiOpcion) {
      const precioPropio = extraerTotalPresupuesto(text);
      if (precioPropio !== null) campos.precio_ultimo_presupuesto = precioPropio;
    }
    if (precioComplementario !== null) campos.precio_complementario = precioComplementario;
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
  extraerNumeroPpto,
  esPdfDeCarpinteria,
  extraerTotalPresupuesto,
};
