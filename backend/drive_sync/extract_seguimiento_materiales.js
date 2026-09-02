// Extrae el seguimiento de pedidos de material de la hoja "BD" del Excel
// "...MEDYSEG.xlsx" que vive en cada carpeta de obra dentro de "SEGUIMIENTO
// DE OBRAS (Aceptadas)" — es el archivo que, según la entrevista de Fase 1,
// lleva Alfredo (Gestión de Obras) para trackear pedidos por proveedor,
// fecha y estado.
//
// Antes se leía la hoja "SEG" (una tabla dinámica resumida) — se cambió a
// "BD" (el detalle real por ítem) a pedido explícito: se quiere agrupar por
// Tipo (columna C, el modelo de ventana — un mismo tipo puede repetirse en
// varias posiciones físicas distintas) y dentro de cada tipo por Posición
// (columna B, la ventana física puntual), mostrando cada línea de material
// (Precerco/Carpintería/Persiana/Vidrio...) de esa posición. A diferencia
// de "SEG", acá no hace falta arrastrar Posición/Tipo entre filas: vienen
// repetidos en cada fila, no en una sola por grupo.
const XLSX = require('xlsx');

// "." es el placeholder que usa la propia plantilla para "todavía sin
// dato" (Proveedor/Fecha/Nº Orden antes de pedir) — se normaliza a null
// igual que un blanco real, no es un valor a mostrar.
function normalizarValor(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || s === '.') return null;
  return s;
}

// Las fechas llegan como serial de Excel (número de días desde 1900) leídas
// sin cellDates a propósito: con cellDates, SheetJS las devuelve como Date
// con un desfase de zona horaria que corre la fecha un día para atrás
// (confirmado comparando contra XLSX.SSF.parse_date_code, que da el
// y/m/d exacto sin pasar por Date en ningún momento).
function fechaDeSerial(valor) {
  if (typeof valor !== 'number') return null;
  const { y, m, d } = XLSX.SSF.parse_date_code(valor);
  if (!y) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function extraerMateriales(rutaArchivo) {
  const wb = XLSX.readFile(rutaArchivo);
  const ws = wb.Sheets['BD'];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

  const idxHeader = rows.findIndex(
    (r) =>
      r.some((c) => /posici[oó]n/i.test(String(c))) &&
      r.some((c) => /^material$/i.test(String(c).trim())) &&
      r.some((c) => /^tipo$/i.test(String(c).trim())),
  );
  if (idxHeader === -1) return [];

  const header = rows[idxHeader];
  const col = (regex) => header.findIndex((c) => regex.test(String(c).trim()));
  const iPosicion = col(/posici[oó]n/i);
  const iTipo = col(/^tipo$/i);
  const iMaterial = col(/^material$/i);
  const iDescripcion = col(/descripci[oó]n/i);
  const iProveedor = col(/^proveedor$/i);
  const iFechaPedido = col(/fecha\s*pedido/i);
  const iOrden = col(/n.\s*\/?\s*orden/i);
  const iFechaEstimada = col(/fecha\s*est/i);
  const iEstado = col(/^estado$/i);
  const iComentario = col(/^comentario$/i);

  const materiales = [];
  for (let i = idxHeader + 1; i < rows.length; i++) {
    const fila = rows[i];
    const material = normalizarValor(fila[iMaterial]);
    if (!material) continue; // fila vacía

    materiales.push({
      // Número de fila real en la hoja (1-indexado, como lo ve Excel) — se
      // guarda para poder ubicar la fila exacta si más adelante se escribe
      // el Estado de vuelta al Excel (no hay otra clave estable: dos filas
      // pueden tener exactamente los mismos valores, ej. dos paños de
      // vidrio idénticos en la misma posición).
      filaExcel: i + 1,
      posicion: normalizarValor(fila[iPosicion]),
      tipo: normalizarValor(fila[iTipo]),
      material,
      descripcion: normalizarValor(fila[iDescripcion]),
      proveedor: normalizarValor(fila[iProveedor]),
      fecha_pedido: fechaDeSerial(fila[iFechaPedido]),
      numero_orden: normalizarValor(fila[iOrden]),
      fecha_estimada: fechaDeSerial(fila[iFechaEstimada]),
      estado: normalizarValor(fila[iEstado]),
      comentario: normalizarValor(fila[iComentario]),
    });
  }
  return materiales;
}

module.exports = {
  extraerMateriales,
};
