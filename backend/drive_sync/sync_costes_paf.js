// Sube al panel el costo real acumulado por obra, leído de PAF.xlsx (la
// planilla donde Sandra/Alfredo/etc. cargan a mano cada pedido/albarán/
// factura) — alimenta la vista de Costes (solo admin), que compara esto
// contra el costo con el que se armó el presupuesto aceptado
// (obras_aceptadas.costo_inicial, ver sync_obras_aceptadas.js).
//
// PAF.xlsx vive en ".../1.OBRAS/3. PEDIDOS-ALBARANES-FACTURAS/PAF.xlsx"
// (GOOGLE_DRIVE_PAF_FILE_ID) — un archivo único, no una carpeta, igual
// criterio que GOOGLE_DRIVE_DIARIO_GENERAL_FILE_ID. Se lee la hoja
// "Pedido-Albaran-Factura" (año actual — hay una hoja "... 2025" aparte,
// para el histórico del año anterior, que no se toca acá): cada fila es un
// pedido/albarán/factura suelto, con una columna "Obra" de TEXTO LIBRE
// (escrito a mano, sin estandarizar). Se suma "Importe obra" — NO "Importe
// Fra. sin IVA"/"Importe Fra TOTAL" (bug real, detectado 2026-09-15
// comparando contra una suma manual de Álvaro): esas dos son el total de
// la FACTURA completa, repetido tal cual en cada fila que compartió esa
// misma factura (varios pedidos facturados juntos) — sumarlas fila por
// fila multiplica el costo real varias veces. "Importe obra" en cambio es
// el importe puntual de ESA línea, no se repite, es la que corresponde
// sumar. Se suma TODO lo que matchea cada obra, sin filtrar por la columna
// "Estado" — a pedido explícito de Álvaro, "incluir todos los gastos, no
// excluir nada".
//
// El emparejamiento obra-real -> obra-del-panel es por PALABRAS (tokens),
// no por texto completo (ver emparejarObra/tokenizar, 2026-09-15 — la
// primera versión comparaba el texto entero y se perdía casos donde algo
// queda METIDO EN EL MEDIO, ej. "Los Cerezos, 543-A / Urb. El clavín" vs la
// obra real "Los Cerezos - Urb. El Clavín": el número de parcela corta
// cualquier coincidencia de texto continuo aunque sea obviamente la misma
// obra). Comparando palabra por palabra, alcanza con que todas las palabras
// del lado más corto estén en el más largo, en cualquier posición.
// Alias cargados a mano (ver costes_alias_obra en costes_obra.php) tienen
// prioridad sobre esto — para los casos puntuales que ni así se resuelven
// (ej. "Fernando el Santo" vs una obra guardada como "Fernado el Santo",
// typo real). Lo que no logra emparejar de ninguna manera NO se descarta —
// se sube aparte como "sin_asignar" (agrupado por el texto tal cual aparece
// en el PAF) para que un admin lo revise a mano en el panel.
//
// Uso:
//   node sync_costes_paf.js
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getDrive, descargarComoBuffer } = require('./drive_client.js');

const NOMBRE_HOJA = 'Pedido-Albaran-Factura';

// Mapeo Categoría (PAF) -> categoría de la Comparativa del Excel (dado por
// Álvaro, 2026-09-15) — clave normalizada (ver normalizar()) para no
// depender de tildes/mayúsculas exactas. Persianas/Composite/Comision/
// Ingenieria no existen como categoría en la Comparativa, quedan con su
// propio nombre (esas obras van a mostrar costo real ahí sin costo inicial
// para comparar, y está bien así). "Varios" queda deliberadamente FUERA de
// este mapa — a pedido de Álvaro, informativo, no se categoriza (sigue
// sumando al total de la obra en costes_reales_obra, pero no entra en el
// desglose por categoría).
const CATEGORIA_PAF_A_COMPARATIVA = {
  material: 'Material',
  transporte: 'Transporte',
  vidrio: 'Vidrio',
  chapas: 'Chapas',
  mo: 'Colocacion',
  fabricacion: 'Colocacion',
  fabricacionysumninistro: 'Material',
  ferreteria: 'Variable',
  persianas: 'Persianas',
  composite: 'Composite',
  comision: 'Comision',
  ingenieria: 'Ingenieria',
};

function normalizar(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

// El archivo trae una leyenda de varias filas antes de la tabla real (ver
// comentario de cabecera) — se busca la fila de encabezados de verdad por
// contenido ("Solicitante" en la primera celda y "Obra" en alguna otra) en
// vez de asumir un número de fila fijo, para no romperse si el año que
// viene la leyenda cambia de tamaño.
function encontrarFilaEncabezados(rows) {
  for (let i = 0; i < rows.length; i++) {
    const fila = rows[i];
    if (String(fila[0]).trim() === 'Solicitante' && fila.some((c) => String(c).trim() === 'Obra')) {
      return i;
    }
  }
  return -1;
}

// Mismo formato que el resto de los Excel internos de Galvi (ver
// parseNumeroEs en extract_fields.js): coma de miles, punto decimal (ej.
// "35,474.83"), no el formato español habitual — alcanza con sacar las
// comas antes de parsear.
function parsearNumero(valor) {
  if (valor === '' || valor === null || valor === undefined) return 0;
  const n = parseFloat(String(valor).replace(/,/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

// Como normalizar(), pero sin juntar todo en un solo bloque — separa por
// palabra. Necesario para emparejarObra() de abajo: comparar texto entero
// (normalizar) se rompe apenas hay algo METIDO EN EL MEDIO (ej. "Los
// Cerezos, 543-A / Urb. El clavín" vs la obra real "Los Cerezos - Urb. El
// Clavín" — el número de parcela corta la coincidencia de texto continuo
// aunque, a simple vista, sea obviamente la misma obra); comparando por
// palabra sueltas, la posición ya no importa.
function tokenizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Empareja el texto libre de la columna "Obra" del PAF contra una obra real
// del panel comparando PALABRAS (tokens), no el texto entero — se pide que
// TODAS las palabras del lado más corto (la obra o el texto del PAF, el que
// tenga menos palabras) aparezcan en el lado más largo, sin importar el
// orden ni qué haya metido en el medio. Entre varios candidatos que
// cumplan, se prefiere el que tenga más letras en común (más específico,
// menos chance de ser casualidad). Un mínimo de 4 caracteres en total
// evita matchear por una sola palabra cortísima (ej. "de", "el").
function emparejarObra(textoLibre, obrasTokenizadas) {
  const tokensLibres = new Set(tokenizar(textoLibre));
  if (tokensLibres.size === 0) return null;

  let mejor = null;
  let mejorPuntaje = 0;
  for (const [obraOriginal, tokensObra] of obrasTokenizadas) {
    if (tokensObra.size === 0) continue;
    const chico = tokensObra.size <= tokensLibres.size ? tokensObra : tokensLibres;
    const grande = tokensObra.size <= tokensLibres.size ? tokensLibres : tokensObra;

    let todasPresentes = true;
    let largoChico = 0;
    for (const t of chico) {
      if (!grande.has(t)) {
        todasPresentes = false;
        break;
      }
      largoChico += t.length;
    }
    if (todasPresentes && largoChico >= 4 && largoChico > mejorPuntaje) {
      mejor = obraOriginal;
      mejorPuntaje = largoChico;
    }
  }
  return mejor;
}

// Correcciones manuales de un admin (botón "Asignar" en la vista de Costes,
// ver costes_obra.php) para textos del PAF que nunca van a cruzar solos
// contra ninguna obra conocida — se consultan ANTES de intentar el
// emparejamiento automático, por texto EXACTO (no normalizado: si el texto
// del PAF cambia aunque sea una coma, el alias viejo no aplica más y esa
// fila vuelve a "sin asignar" para que se re-asigne).
async function listarAlias() {
  const url = `${process.env.PANEL_API_URL}/costes_obra.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'listar_alias' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.alias;
}

async function listarObrasAceptadas() {
  const url = `${process.env.PANEL_API_URL}/obras_aceptadas.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'listar' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.obras;
}

async function subirCostes(costes, sinAsignar, costesCategoria) {
  const url = `${process.env.PANEL_API_URL}/costes_obra.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'reemplazar_costes_reales', costes, sin_asignar: sinAsignar, costes_categoria: costesCategoria }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function main() {
  const drive = getDrive();

  const obrasAceptadas = await listarObrasAceptadas();
  const obrasTokenizadas = new Map();
  for (const o of obrasAceptadas) {
    const tokens = new Set(tokenizar(o.obra));
    if (tokens.size > 0 && !obrasTokenizadas.has(o.obra)) obrasTokenizadas.set(o.obra, tokens);
  }
  console.log(`Obras aceptadas conocidas: ${obrasTokenizadas.size}`);

  const alias = await listarAlias();
  const aliasPorTexto = new Map(alias.map((a) => [a.texto_paf, a.obra]));
  console.log(`Alias cargados a mano: ${aliasPorTexto.size}`);

  const buffer = await descargarComoBuffer(drive, process.env.GOOGLE_DRIVE_PAF_FILE_ID);
  const tmpPath = path.join(__dirname, 'tmp_PAF.xlsx');
  fs.writeFileSync(tmpPath, buffer);

  let rows;
  try {
    const wb = XLSX.readFile(tmpPath);
    if (!wb.Sheets[NOMBRE_HOJA]) throw new Error(`No se encontró la hoja "${NOMBRE_HOJA}" en PAF.xlsx`);
    rows = XLSX.utils.sheet_to_json(wb.Sheets[NOMBRE_HOJA], { header: 1, raw: false, defval: '' });
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }

  const idxEncabezados = encontrarFilaEncabezados(rows);
  if (idxEncabezados === -1) throw new Error('No se encontró la fila de encabezados ("Solicitante"/"Obra") en PAF.xlsx');
  const encabezados = rows[idxEncabezados];
  const idxObra = encabezados.findIndex((h) => String(h).trim() === 'Obra');
  const idxImporte = encabezados.findIndex((h) => String(h).trim() === 'Importe obra');
  const idxCategoria = encabezados.findIndex((h) => String(h).trim() === 'Categoría');
  if (idxObra === -1 || idxImporte === -1) {
    throw new Error(`No se encontraron las columnas esperadas (Obra=${idxObra}, Importe obra=${idxImporte})`);
  }

  const costesPorObra = new Map(); // obra real -> { total, filas }
  const sinAsignarPorTexto = new Map(); // texto libre tal cual -> { total, filas }
  const costesPorObraCategoria = new Map(); // "obra||categoria" -> { obra, categoria, total, filas }

  for (let i = idxEncabezados + 1; i < rows.length; i++) {
    const fila = rows[i];
    const textoObra = String(fila[idxObra] || '').trim();
    if (!textoObra) continue;
    const importe = parsearNumero(fila[idxImporte]);
    if (importe === 0) continue;

    // Alias cargado a mano por un admin (ver costes_obra.php) tiene
    // prioridad sobre el emparejamiento automático — texto exacto, no
    // normalizado.
    const obraReal = aliasPorTexto.get(textoObra) || emparejarObra(textoObra, obrasTokenizadas);
    if (obraReal) {
      const actual = costesPorObra.get(obraReal) || { total: 0, filas: 0 };
      actual.total += importe;
      actual.filas += 1;
      costesPorObra.set(obraReal, actual);

      const categoriaTexto = idxCategoria === -1 ? '' : String(fila[idxCategoria] || '').trim();
      const categoriaComparativa = CATEGORIA_PAF_A_COMPARATIVA[normalizar(categoriaTexto)];
      if (categoriaComparativa) {
        const clave = `${obraReal}||${categoriaComparativa}`;
        const actualCat = costesPorObraCategoria.get(clave) || { obra: obraReal, categoria: categoriaComparativa, total: 0, filas: 0 };
        actualCat.total += importe;
        actualCat.filas += 1;
        costesPorObraCategoria.set(clave, actualCat);
      }
    } else {
      const actual = sinAsignarPorTexto.get(textoObra) || { total: 0, filas: 0 };
      actual.total += importe;
      actual.filas += 1;
      sinAsignarPorTexto.set(textoObra, actual);
    }
  }

  const costes = Array.from(costesPorObra.entries()).map(([obra, v]) => ({
    obra,
    costo_real: Math.round(v.total * 100) / 100,
    cantidad_filas: v.filas,
  }));
  const sinAsignar = Array.from(sinAsignarPorTexto.entries()).map(([obra_texto, v]) => ({
    obra_texto,
    total: Math.round(v.total * 100) / 100,
    cantidad_filas: v.filas,
  }));
  const costesCategoria = Array.from(costesPorObraCategoria.values()).map((v) => ({
    obra: v.obra,
    categoria: v.categoria,
    costo_real: Math.round(v.total * 100) / 100,
    cantidad_filas: v.filas,
  }));

  await subirCostes(costes, sinAsignar, costesCategoria);

  console.log(`\n=== Resumen ===`);
  console.log(`Filas del PAF procesadas: ${rows.length - idxEncabezados - 1}`);
  console.log(`Obras con costo real emparejado: ${costes.length}`);
  console.log(`Textos de obra sin emparejar: ${sinAsignar.length} (suma: ${sinAsignar.reduce((a, s) => a + s.total, 0).toFixed(2)})`);
  console.log(`Filas obra+categoría: ${costesCategoria.length}`);
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
