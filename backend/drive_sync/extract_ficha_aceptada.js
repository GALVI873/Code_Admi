// Lee la sección "CONFIRMACION DETALLES DE PROYECTO" de la hoja "Ficha" del
// Excel de cálculo de una obra aceptada — mismas etiquetas que ya usa
// llenar_ficha_obras.js para ESCRIBIR esos mismos campos (acá se leen,
// columna "PRESUPUESTO"; la columna "CONFIRMACIÓN" de al lado queda vacía
// siempre en el Excel — lo que Alfredo confirme desde el panel se guarda en
// su propia tabla, ver obras_aceptadas.php, y
// escribir_confirmaciones_aceptadas.js las escribe de vuelta en esa
// columna).
const XLSX = require('xlsx');

function sheetToRows(wb, sheetName) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
}

// Sin raw:false: "Fecha Ppto." sale como serial de Excel crudo, y se decodifica
// con XLSX.SSF.parse_date_code — con raw:false, SheetJS lo formatea con el
// locale del sistema (visto "10/28/25" para el 28 de octubre, mes y día al
// revés), riesgo real de leer la fecha invertida.
function sheetToRowsRaw(wb, sheetName) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
}

function findDateByLabel(rows, labelRegex) {
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i]).trim();
      if (cell && labelRegex.test(cell)) {
        for (let j = i + 1; j < row.length; j++) {
          const val = row[j];
          if (typeof val === 'number') {
            const { y, m, d } = XLSX.SSF.parse_date_code(val);
            if (!y) return null;
            return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          }
          if (String(val).trim() !== '') return null; // texto raro en vez de fecha: no se inventa nada
        }
        return null;
      }
    }
  }
  return null;
}

// Busca una celda que matchee `labelRegex` y devuelve la siguiente celda no
// vacía de esa misma fila — con la columna "Confirmación" siempre vacía en
// origen, esto encuentra la columna "Presupuesto" sin ambigüedad.
function findByLabel(rows, labelRegex) {
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i]).trim();
      if (cell && labelRegex.test(cell)) {
        for (let j = i + 1; j < row.length; j++) {
          const val = String(row[j]).trim();
          if (val !== '') return val;
        }
        return null;
      }
    }
  }
  return null;
}

// Mismo set de etiquetas (y mismas regex) que construirCampos() en
// llenar_ficha_obras.js, del lado de lectura en vez de escritura.
const CAMPOS_CONFIRMABLES = {
  proveedor: /Proveedor/i,
  color_carpinteria: /Color Carpinteria/i,
  correderas: /^Correderas/i,
  abatibles: /^Abatibles/i,
  vidrio: /^Vidrio/i,
  ral: /RAL Silicona/i,
  persiana: /^Persianas?\s*:?\s*$/i,
  color_persiana: /Color Persianas/i,
  modelo_lamas: /Modelo de Lamas/i,
  motor_radio: /Motor Radio/i,
  motor_mecanico: /Motor mec/i,
};

function leerFichaConfirmable(rutaExcel) {
  const wb = XLSX.readFile(rutaExcel);
  const ficha = sheetToRows(wb, 'Ficha');
  const resultado = {};
  for (const [campo, regex] of Object.entries(CAMPOS_CONFIRMABLES)) {
    resultado[campo] = findByLabel(ficha, regex);
  }
  // Fecha del presupuesto (no confirmable, es un dato fijo del presupuesto
  // aceptado) — se muestra junto al Nº Ppto como referencia informativa.
  resultado.fecha_ppto = findDateByLabel(sheetToRowsRaw(wb, 'Ficha'), /Fecha Ppto/i);
  return resultado;
}

module.exports = { leerFichaConfirmable, CAMPOS_CONFIRMABLES };
