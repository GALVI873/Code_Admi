// Extrae los 8 campos de un presupuesto "en estudio" a partir del Excel
// interno (*.CALCULO.Base*.xlsx). Busca por etiqueta en vez de por celda fija,
// porque la fila exacta puede variar de una obra a otra.
const XLSX = require('xlsx');

function sheetToRows(wb, sheetName) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
}

// Busca una celda que matchee `labelRegex` y devuelve la siguiente celda no
// vacía de esa misma fila (o '' si la etiqueta existe pero no tiene valor).
function findByLabel(rows, labelRegex) {
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i]).trim();
      if (cell && labelRegex.test(cell)) {
        for (let j = i + 1; j < row.length; j++) {
          const val = String(row[j]).trim();
          if (val !== '') return val;
        }
        return '';
      }
    }
  }
  return null;
}

// Busca la fila cuya primera celda coincide con `rowLabelRegex`, y dentro de
// esa fila devuelve el valor bajo la columna cuyo encabezado (en `headerRow`)
// matchea `colLabelRegex`.
function valueInLabeledTable(rows, headerRowIndex, rowLabelRegex, colLabelRegex) {
  const header = rows[headerRowIndex] || [];
  const colIdx = header.findIndex((h) => colLabelRegex.test(String(h).trim()));
  if (colIdx === -1) return null;

  for (const row of rows) {
    if (colLabelRegex === headerRowIndex) continue;
    if (rowLabelRegex.test(String(row[0]).trim())) {
      return row[colIdx] !== undefined ? String(row[colIdx]).trim() : null;
    }
  }
  return null;
}

// Este libro usa formato numérico con coma de miles y punto decimal
// (ej. "8,585.37"), no el formato español habitual.
function parseNumeroEs(str) {
  if (str === null || str === undefined || str === '') return null;
  const n = parseFloat(String(str).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

function extraerCampos(filePath) {
  const wb = XLSX.readFile(filePath);

  const ficha = sheetToRows(wb, 'Ficha');
  const maestro = sheetToRows(wb, 'Maestro');
  const comparativa = sheetToRows(wb, 'Comparativa');

  const cliente = findByLabel(ficha, /^CLIENTE$/i);
  const ral = findByLabel(ficha, /RAL/i);
  const vidrio = findByLabel(ficha, /^Vidrio$/i);
  const persiana = findByLabel(ficha, /^Persianas?$/i);
  // Para saber si la Ficha ya está diligenciada (línea de tiempo de
  // seguimiento) — mismas etiquetas que ya usa el llenado automático.
  const numeroPpto = findByLabel(ficha, /N.\s*Ppto/i);
  const carpinteria = findByLabel(ficha, /^\s*Carpinteria/i);
  // Proveedor elegido para la oferta final (ej. "ALUGOM", "CORTIZO") — lo
  // que Geraldinne pidió ver en el paso "Ofertas" de su línea de tiempo.
  const proveedor = findByLabel(ficha, /Proveedor/i);

  // Maestro: fila "Totales", columna "Uds"
  const maestroHeaderIdx = maestro.findIndex((r) => r.includes('Uds'));
  const udsColIdx = maestroHeaderIdx >= 0 ? maestro[maestroHeaderIdx].indexOf('Uds') : -1;
  let noVentanas = null;
  if (udsColIdx >= 0) {
    const totalesRow = maestro.find((r) => String(r[2]).trim() === 'Totales');
    if (totalesRow) noVentanas = parseNumeroEs(totalesRow[udsColIdx]);
  }

  // Comparativa: fila "Total general"
  const compHeader = comparativa[0] || [];
  const idxTotalPpto = compHeader.findIndex((h) => /Suma de Total Presupesto/i.test(String(h)));
  const idxPTotalM2 = compHeader.findIndex((h) => /Suma de P\/Total M2/i.test(String(h)));
  const idxBeneficio = compHeader.findIndex((h) => /Beneficio/i.test(String(h)));
  const totalGeneralRow = comparativa.find((r) => /Total general/i.test(String(r[0])));

  let precioPpto = null;
  let precioM2 = null;
  let ganancia = null;
  if (totalGeneralRow) {
    precioPpto = parseNumeroEs(totalGeneralRow[idxTotalPpto]);
    precioM2 = parseNumeroEs(totalGeneralRow[idxPTotalM2]);
    const beneficio = parseNumeroEs(totalGeneralRow[idxBeneficio]);
    if (beneficio !== null && precioPpto) {
      ganancia = Math.round((beneficio / precioPpto) * 10000) / 100; // % con 2 decimales
    }
  }

  return {
    cliente: cliente || null,
    estatus: 'En Estudio',
    no_ventanas: noVentanas,
    precio_m2: precioM2,
    ral: ral || null,
    persiana: persiana || null,
    vidrio: vidrio || null,
    numero_ppto: numeroPpto || null,
    carpinteria: carpinteria || null,
    proveedor: proveedor || null,
    precio_ultimo_presupuesto: precioPpto,
    porcentaje_ganancia: ganancia,
  };
}

if (require.main === module) {
  const filePath = process.argv[2];
  console.log(JSON.stringify(extraerCampos(filePath), null, 2));
}

module.exports = { extraerCampos };
