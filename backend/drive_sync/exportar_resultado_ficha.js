// Convierte resultado_llenar_ficha.json (salida de llenar_ficha_obras.js) en
// un Excel legible para revisión humana: una fila por obra, con lo que se
// escribió en cada celda de la Ficha, más las omitidas y su motivo.
const path = require('path');
const XLSX = require('xlsx');
const resultado = require('./resultado_llenar_ficha.json');

const filasOk = resultado.ok.map((r) => ({
  Obra: r.obra,
  Estado: 'Completada',
  Motivo: '',
  'Excel usado': path.basename(r.rutaCalculo),
  'PDF usado': path.basename(r.rutaPdf),
  'Nº Ppto': r.celdas.B11 || '',
  'Fecha Ppto': r.celdas.B12 ? XLSX.SSF.format('m/d/yy', r.celdas.B12) : '',
  Carpintería: r.celdas.B13 || '',
  Proveedor: r.celdas.B14 || '',
  'Color Carpintería': r.celdas.B15 || '',
  Correderas: r.celdas.B17 || '',
  Abatibles: r.celdas.B18 || '',
  Vidrio: r.celdas.B19 || '',
  Persianas: r.celdas.B20 || '',
  'Color Persianas': r.celdas.B21 || '',
  'Modelo de Lamas': r.celdas.B22 || '',
  'Motor Radio': r.celdas.B23 || '',
  'Motor mecánico': r.celdas.B24 || '',
  Composite: r.celdas.B25 || '',
  'RAL Silicona': r.celdas.B26 || '',
}));

const filasOmitidas = resultado.omitidas.map((r) => ({
  Obra: r.obra,
  Estado: 'Omitida',
  Motivo: r.motivo,
}));

const filas = [...filasOk, ...filasOmitidas].sort((a, b) => a.Obra.localeCompare(b.Obra, 'es'));

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(filas);
ws['!cols'] = [
  { wch: 28 }, { wch: 11 }, { wch: 18 }, { wch: 32 }, { wch: 40 },
  { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 16 },
  { wch: 24 }, { wch: 24 }, { wch: 40 }, { wch: 9 }, { wch: 20 },
  { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
];
XLSX.utils.book_append_sheet(wb, ws, 'Ficha - resultado');

const salida = process.argv[2];
XLSX.writeFile(wb, salida);
console.log(`${filas.length} filas (${filasOk.length} completadas, ${filasOmitidas.length} omitidas) -> ${salida}`);
