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
  'Nº Ppto': r.celdas['Nº Ppto'] || '',
  'Fecha Ppto': r.celdas['Fecha Ppto'] ? XLSX.SSF.format('m/d/yy', r.celdas['Fecha Ppto']) : '',
  Carpintería: r.celdas.Carpinteria || '',
  Proveedor: r.celdas.Proveedores || '',
  'Color Carpintería': r.celdas['Color Carpinteria'] || '',
  Correderas: r.celdas.Correderas || '',
  Abatibles: r.celdas.Abatibles || '',
  Vidrio: r.celdas.Vidrio || '',
  Persianas: r.celdas.Persianas || '',
  'Color Persianas': r.celdas['Color Persianas'] || '',
  'Modelo de Lamas': r.celdas['Modelo de Lamas'] || '',
  'Motor Radio': r.celdas['Motor Radio'] || '',
  'Motor mecánico': r.celdas['Motor mecanico'] || '',
  Composite: r.celdas.Composite || '',
  'RAL Silicona': r.celdas['RAL Silicona'] || '',
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
