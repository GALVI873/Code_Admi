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
// (escrito a mano, sin estandarizar) y una "Importe Fra. sin IVA" (el
// importe SIN IVA, a pedido de Álvaro — se compara contra el costo del
// presupuesto, que tampoco lleva IVA). Se suma TODO lo que matchea cada
// obra, sin filtrar por la columna "Estado" — a pedido explícito de Álvaro,
// "incluir todos los gastos, no excluir nada".
//
// El emparejamiento obra-real -> obra-del-panel es por normalización +
// "empieza con" (ver emparejarObra): "Duque de Tamames 3, 4ºA" en el PAF
// matchea contra la obra real "Duque de Tamames". Lo que no logra
// emparejar con ninguna obra aceptada conocida NO se descarta — se sube
// aparte como "sin_asignar" (agrupado por el texto tal cual aparece en el
// PAF) para que un admin lo revise a mano en el panel.
//
// Uso:
//   node sync_costes_paf.js
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getDrive, descargarComoBuffer } = require('./drive_client.js');

const NOMBRE_HOJA = 'Pedido-Albaran-Factura';

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

// Empareja el texto libre de la columna "Obra" del PAF contra una obra real
// del panel: primero exacto (normalizado); si no, la obra conocida más
// larga tal que UNA CONTIENE A LA OTRA (en cualquier sentido) — hace falta
// en los dos sentidos porque el texto del PAF a veces trae menos que el
// nombre real ("Jose Abascal,57" -> obra real "8 Viv. Jose Abascal, 57") y
// a veces más, incluso con algo antepuesto ("Ronda de la Avutarda, 38 -
// Persianas" -> obra real "Avutarda, 38"). "length >= 4" para no matchear
// por una obra de 2-3 letras que casualmente aparezca en cualquier lado; de
// haber varios candidatos, se prefiere el nombre de obra MÁS LARGO (más
// específico, menos chance de ser una coincidencia de casualidad).
function emparejarObra(textoLibre, obrasNormalizadas) {
  const norm = normalizar(textoLibre);
  if (!norm) return null;
  if (obrasNormalizadas.has(norm)) return obrasNormalizadas.get(norm);

  let mejor = null;
  let mejorLargo = 0;
  for (const [obraNorm, obraOriginal] of obrasNormalizadas) {
    const contiene = obraNorm.length >= 4 && (norm.includes(obraNorm) || obraNorm.includes(norm));
    if (contiene && obraNorm.length > mejorLargo) {
      mejor = obraOriginal;
      mejorLargo = obraNorm.length;
    }
  }
  return mejor;
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

async function subirCostes(costes, sinAsignar) {
  const url = `${process.env.PANEL_API_URL}/costes_obra.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'reemplazar_costes_reales', costes, sin_asignar: sinAsignar }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function main() {
  const drive = getDrive();

  const obrasAceptadas = await listarObrasAceptadas();
  const obrasNormalizadas = new Map();
  for (const o of obrasAceptadas) {
    const norm = normalizar(o.obra);
    if (norm && !obrasNormalizadas.has(norm)) obrasNormalizadas.set(norm, o.obra);
  }
  console.log(`Obras aceptadas conocidas: ${obrasNormalizadas.size}`);

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
  const idxImporte = encabezados.findIndex((h) => /importe fra\.?\s*sin iva/i.test(String(h)));
  if (idxObra === -1 || idxImporte === -1) {
    throw new Error(`No se encontraron las columnas esperadas (Obra=${idxObra}, Importe Fra. sin IVA=${idxImporte})`);
  }

  const costesPorObra = new Map(); // obra real -> { total, filas }
  const sinAsignarPorTexto = new Map(); // texto libre tal cual -> { total, filas }

  for (let i = idxEncabezados + 1; i < rows.length; i++) {
    const fila = rows[i];
    const textoObra = String(fila[idxObra] || '').trim();
    if (!textoObra) continue;
    const importe = parsearNumero(fila[idxImporte]);
    if (importe === 0) continue;

    const obraReal = emparejarObra(textoObra, obrasNormalizadas);
    if (obraReal) {
      const actual = costesPorObra.get(obraReal) || { total: 0, filas: 0 };
      actual.total += importe;
      actual.filas += 1;
      costesPorObra.set(obraReal, actual);
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

  await subirCostes(costes, sinAsignar);

  console.log(`\n=== Resumen ===`);
  console.log(`Filas del PAF procesadas: ${rows.length - idxEncabezados - 1}`);
  console.log(`Obras con costo real emparejado: ${costes.length}`);
  console.log(`Textos de obra sin emparejar: ${sinAsignar.length} (suma: ${sinAsignar.reduce((a, s) => a + s.total, 0).toFixed(2)})`);
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
