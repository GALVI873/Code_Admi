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
const path = require('path');
const pdfParse = require('pdf-parse');

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

// Se probó un respaldo más laxo (última vez que aparece "TOTAL" solo, sin
// exigir el IVA cerca) para cubrir proveedores que no desglosan el IVA —
// pero "total" también aparece en frases sin relación a dinero ("Total m²
// de vidrios: 132,42 m²", "Peso total del parte") y eso generaba datos
// falsos. Mejor no mostrar una oferta que mostrar un valor inventado: se
// descartó el respaldo y se deja solo el ancla de IVA+porcentaje, que en
// todas las pruebas reales no dio ningún falso positivo.
function extraerNumeroTotal(text) {
  const idx = ultimoIndiceIva(text);
  if (idx === -1) return null;
  const numeros = numerosMonedaCerca(text, idx).map(aNumero).filter((n) => n !== null);
  return numeros.length > 0 ? Math.max(...numeros) : null;
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

// Nombre de la empresa proveedora — se busca junto al CIF, que es el único
// ancla que se repitió igual en los ejemplos reales (el membrete y el
// formato de cabecera cambian de un proveedor a otro).
function extraerProveedor(text) {
  const m = text.match(/([A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 .,&'-]{2,50}?),?\s*S\.?\s?[LA]\.?U?\.?\s*\|?\s*CIF/);
  return m ? m[1].trim().replace(/,$/, '') : null;
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
      const buffer = fs.readFileSync(rutaArchivo);
      ({ text } = await pdfParse(buffer));
    } catch {
      continue;
    }
    if (!text || !esDocumentoDeOferta(text)) continue;

    ofertas.push({
      proveedor: extraerProveedor(text),
      valor: extraerValorTotal(text),
      fecha: extraerFecha(text),
      archivo: nombreArchivo,
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
