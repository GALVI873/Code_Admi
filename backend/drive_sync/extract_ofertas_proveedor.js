// Extrae ofertas de proveedor de los PDF en la carpeta "Valoración" de cada
// obra (dentro de "1.Organización"/"1.Organizacion"). A diferencia de los
// PDF de "Enviados" (que Galvi manda al cliente, formato propio y
// conocido), estos son cotizaciones QUE GALVI RECIBE de cada proveedor —
// un formato distinto por cada uno, sin control sobre el diseño. La carpeta
// también mezcla documentos que no son ofertas (mediciones, planos,
// comparativos, fichas técnicas, PDF escaneados sin texto) — por eso se
// filtra primero por esDocumentoDeOferta() antes de intentar extraer nada,
// y se acepta que algunas ofertas reales no se detecten (mejor no mostrar
// nada que mostrar un dato inventado).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// pdf-parse (motor pdfjs muy viejo) deja algún estado global corrupto entre
// documentos con estructura rara (XRef roto, fuentes atípicas) — un PDF
// sano leído justo después de uno así falla con "bad XRef entry" aunque su
// propio archivo esté perfecto. Se confirmó reproduciéndolo: mismo archivo,
// solo siempre funciona, después de otro siempre falla igual. Limpiar el
// caché de require no alcanzó (sí crea una instancia nueva del módulo y aun
// así fallaba, señal de que el estado corrupto no es a nivel de módulo) —
// la única garantía real es un proceso de Node nuevo por archivo. El
// resultado se pasa por un archivo temporal, no por stdout, porque pdfjs a
// veces manda avisos directo a stdout y eso rompería el JSON de salida.
function parsearPdfAislado(rutaArchivo) {
  const rutaSalida = path.join(os.tmpdir(), `pdf_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  try {
    execFileSync(
      process.execPath,
      [path.join(__dirname, 'parse_pdf_aislado.js'), rutaArchivo, rutaSalida],
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
    );
    const resultado = JSON.parse(fs.readFileSync(rutaSalida, 'utf8'));
    if (resultado.error) throw new Error(resultado.error);
    return resultado.text;
  } finally {
    fs.rmSync(rutaSalida, { force: true });
  }
}

const MESES = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};

// No hay una plantilla común entre proveedores (cada uno manda su propio
// PDF). "TOTAL" solo no sirve de ancla: en presupuestos con varios ítems
// aparece una vez POR ÍTEM ("Total: 362,91 €") antes del total final, así
// que buscar la primera ocurrencia agarra un total parcial. "I.V.A." en
// cambio, cuando aparece con un cálculo real (no solo el aviso "no incluye
// IVA"), casi siempre está pegado al desglose final — se ancla ahí, en la
// ÚLTIMA ocurrencia (la más cercana al cierre del documento), y de los
// números con formato de moneda española cerca se toma el más grande (es
// la suma de base imponible + IVA, nunca al revés). Documentos que solo
// avisan "no incluye IVA" sin desglosar nada quedan fuera a propósito — no
// hay un total real que extraer ahí.
const PATRON_NUMERO_MONEDA = /\d{1,3}(?:\.\d{3})*,\d{2}/g;

function numerosMonedaCerca(text, indice, antes = 150, despues = 500) {
  const fragmento = text.slice(Math.max(0, indice - antes), indice + despues);
  return [...fragmento.matchAll(PATRON_NUMERO_MONEDA)].map((m) => m[0]);
}

// Un simple aviso ("No está incluido el I.V.A.") no trae porcentaje al
// lado; el desglose real de un total sí ("I.V.A. (21,00%)", "I.V.A. 21,0
// %") — exigir el porcentaje es lo que separa un total de verdad de un
// aviso o de un recargo cualquiera que casualmente cae cerca del texto IVA.
function ultimoIndiceIva(text) {
  const matches = [...text.matchAll(/I\.?\s?V\.?\s?A\.?\s*\(?\d{1,2}[.,]\d{1,2}\s*%\)?/gi)];
  return matches.length > 0 ? matches[matches.length - 1].index : -1;
}

function aNumero(texto) {
  const num = parseFloat(texto.replace(/\./g, '').replace(',', '.'));
  return Number.isNaN(num) ? null : num;
}

// Respaldo para proveedores que no desglosan IVA cerca del total: "TOTAL"
// en MAYÚSCULA COMPLETA seguido de inmediato (sin otra palabra en medio) por
// un número. Se probó antes un "TOTAL" más laxo (cualquier mayúscula/
// minúscula, número en cualquier punto cercano) y agarraba falsos positivos
// reales: "Total m² de vidrios: 132,42 m²", "Peso total del parte...",
// "Total CAPÍTULO 09..." — todos con mayúscula solo en la T, o con una
// palabra entre "TOTAL" y el número. Exigir mayúscula completa PEGADA a un
// número separa el total de verdad ("TOTAL\n3.330,84 €") de esos casos, y
// de los "Total: 362,91 €" por ítem (esos van con mayúscula inicial nomás).
// Se usa como respaldo, no como primera opción, porque el ancla de IVA es
// más específica cuando está disponible.
function ultimoIndiceTotalMayusculas(text) {
  const matches = [...text.matchAll(/TOTAL\s*\n?\s*€?\s*\d/g)];
  return matches.length > 0 ? matches[matches.length - 1].index : -1;
}

function extraerNumeroTotal(text) {
  const idxIva = ultimoIndiceIva(text);
  if (idxIva !== -1) {
    const numeros = numerosMonedaCerca(text, idxIva).map(aNumero).filter((n) => n !== null);
    if (numeros.length > 0) return Math.max(...numeros);
  }
  const idxTotal = ultimoIndiceTotalMayusculas(text);
  if (idxTotal !== -1) {
    // Máximo, no el primero: "TOTAL 30   111,15   28.049,82" (cantidad,
    // precio unitario, total) es una fila de tabla real vista en un
    // proveedor — el total de verdad es siempre el número más grande.
    const numeros = numerosMonedaCerca(text, idxTotal, 0, 60).map(aNumero).filter((n) => n !== null);
    if (numeros.length > 0) return Math.max(...numeros);
  }
  return null;
}

function esDocumentoDeOferta(text) {
  return extraerNumeroTotal(text) !== null;
}

function extraerValorTotal(text) {
  return extraerNumeroTotal(text);
}

function extraerFecha(text) {
  const m = text.match(/Fecha:?\s*\n?\s*(\d{1,2})\s*-\s*([a-záéíóú]{3})\s*-\s*(\d{4})/i);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return null;
  return `${m[3]}-${String(mes).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

// En varios PDF el nombre de la empresa está metido como logo/imagen en el
// membrete, no como texto — ahí no hay nada que un regex pueda leer. Pero
// según la entrevista de Presupuestos, Geraldinne siempre pide precios a
// los MISMOS proveedores de confianza por tipo de material (no cambian de
// un presupuesto a otro) — así que en vez de perseguir un parser genérico
// de logos, se identifica cada plantilla "sin nombre" por su CIF (que sí
// suele venir en texto aunque el nombre no) y se mapea a mano una sola vez.
// Agregar acá cuando aparezca un CIF nuevo sin identificar.
const PROVEEDOR_POR_CIF = {
  B72862899: 'Persyvex',
};

// CIF de Galvi (aparece en todas las ofertas recibidas, como cliente) —
// hay que descartarlo antes de buscar el del proveedor.
const CIF_GALVI = 'B84530955';

function normalizarCif(cif) {
  return cif.replace(/-/g, '').toUpperCase();
}

function extraerCifProveedor(text) {
  const matches = [...text.matchAll(/C\.?I\.?F\.?:?\s*([A-Z]-?\d{7,8}[0-9A-Z]?)/gi)];
  for (const m of matches) {
    const cif = normalizarCif(m[1]);
    if (cif !== CIF_GALVI) return cif;
  }
  return null;
}

// Nombre de la empresa proveedora — primero se busca junto al CIF en el
// propio texto (funciona cuando el proveedor sí escribe su nombre, ej.
// "ALUMINIOS VILLAR, SL. | CIF: ..."); si no aparece, se cae al mapeo por
// CIF de proveedores conocidos.
function extraerProveedor(text) {
  const m = text.match(/([A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 .,&'-]{2,50}?),?\s*S\.?\s?[LA]\.?U?\.?\s*\|?\s*CIF/);
  if (m) return m[1].trim().replace(/,$/, '');

  const cif = extraerCifProveedor(text);
  return cif && PROVEEDOR_POR_CIF[cif] ? PROVEEDOR_POR_CIF[cif] : null;
}

function listarDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
}

// Encuentra la carpeta "Valoración" de una obra. No está siempre en el
// mismo lugar: unas veces cuelga directo de la obra (ej. "2. Valoracion"),
// otras dentro de "1.Organización", otras dentro de una carpeta "Doc" —
// depende de quién la haya creado. En vez de asumir una ubicación fija, se
// busca recursivamente (acotado a 3 niveles) cualquier carpeta cuyo nombre
// contenga "valoraci", tolerando además la falta de tilde.
function carpetaValoracion(rutaObra, profundidad = 0) {
  if (profundidad > 3) return null;
  const subdirs = listarDirs(rutaObra);
  const directa = subdirs.find((d) => /valoraci/i.test(d.name));
  if (directa) return path.join(rutaObra, directa.name);
  // "Enviados" es una fuente de datos distinta (los PDF que Galvi manda al
  // cliente) — no baja ahí para no perder tiempo ni confundir origenes.
  for (const dir of subdirs) {
    if (/^enviad/i.test(dir.name)) continue;
    const encontrada = carpetaValoracion(path.join(rutaObra, dir.name), profundidad + 1);
    if (encontrada) return encontrada;
  }
  return null;
}

async function extraerOfertasDeObra(rutaObra) {
  const rutaVal = carpetaValoracion(rutaObra);
  if (!rutaVal) return [];

  let archivos;
  try {
    archivos = fs.readdirSync(rutaVal).filter((n) => /\.pdf$/i.test(n) && !n.startsWith('~$'));
  } catch {
    return [];
  }

  const ofertas = [];
  for (const nombreArchivo of archivos) {
    const rutaArchivo = path.join(rutaVal, nombreArchivo);
    let text;
    try {
      text = parsearPdfAislado(rutaArchivo);
    } catch {
      continue;
    }
    if (!text || !esDocumentoDeOferta(text)) continue;

    // "fecha_llegada" es la fecha en que el archivo apareció en la carpeta
    // "Valoración" (mtime del propio PDF) — no depende de que el documento
    // traiga fecha en su texto, a diferencia de "fecha" (que sí y muchas
    // veces no se detecta). Es lo que el panel usa como fecha de recepción
    // de la oferta.
    let fechaLlegada = null;
    try {
      fechaLlegada = fs.statSync(rutaArchivo).mtime.toISOString().slice(0, 10);
    } catch {
      // sin acceso al mtime, se deja sin fecha de llegada
    }

    ofertas.push({
      proveedor: extraerProveedor(text),
      valor: extraerValorTotal(text),
      fecha: extraerFecha(text),
      archivo: nombreArchivo,
      fecha_llegada: fechaLlegada,
    });
  }
  return ofertas;
}

module.exports = {
  esDocumentoDeOferta,
  extraerValorTotal,
  extraerFecha,
  extraerProveedor,
  carpetaValoracion,
  extraerOfertasDeObra,
};
