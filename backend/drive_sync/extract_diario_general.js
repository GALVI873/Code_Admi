// Lee la hoja "Diario General" de Z:\DRIVE GALVI\3. PUESTO TÉCNICO\1. Diario
// General Galvi.xlsx — la tabla maestra que usa Alfredo (y Álvaro) para
// trackear pedidos de material y tareas de gestión por obra, una fila por
// ítem (no por obra: una obra puede tener varias filas, una por material o
// tarea). Las hojas "Gestión" y "Estatus Categoria" del mismo archivo NO se
// leen a propósito: se confirmó que son vistas/copias de esta misma tabla
// (14 de 16 filas de "Gestión" calzan exacto con las de acá filtradas por
// Categoría="Gestión"), y no siempre están al día — Diario General es la
// única fuente de verdad de acá en más; el panel arma las dos vistas
// (Pedidos de Material / Gestión) filtrando por Categoría, no leyendo esas
// otras hojas.
//
// Alcance acotado a pedido del usuario: se deja fuera lo administrativo/
// facturación (Informacion Obra, Facturacion Activa, Facturar, Facturar
// mensual, Colores, Avanza) — solo se sincronizan las categorías operativas.
const XLSX = require('xlsx');

const CATEGORIAS_GESTION = ['Gestión'];
const CATEGORIAS_MATERIAL = ['Proveedor', 'Chapas', 'Vidrios', 'Fabricar', 'Persianas', 'Lacador', 'Medir', 'Acopio'];
const CATEGORIAS_INCLUIDAS = new Set([...CATEGORIAS_MATERIAL, ...CATEGORIAS_GESTION]);

function limpiar(valor) {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  return s === '' ? null : s;
}

// Serial de Excel crudo (no cellDates) decodificado con
// XLSX.SSF.parse_date_code — mismo motivo que en extract_ficha_aceptada.js
// y extract_seguimiento_materiales.js: cellDates corre la fecha un día para
// atrás por un problema de zona horaria. 0 (o cualquier valor no positivo)
// es "sin fecha", no el 1899 que daría decodificado literalmente.
function fechaDeSerial(valor) {
  if (typeof valor !== 'number' || valor <= 0) return null;
  const { y, m, d } = XLSX.SSF.parse_date_code(valor);
  if (!y) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function extraerDiarioGeneral(rutaExcel) {
  const wb = XLSX.readFile(rutaExcel);
  const ws = wb.Sheets['Diario General'];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

  const idxHeader = rows.findIndex((r) => r.some((c) => String(c).trim() === 'Obra'));
  if (idxHeader === -1) return [];
  const header = rows[idxHeader];
  const col = (nombre) => header.findIndex((c) => String(c).trim() === nombre);

  const iTipo = col('Tipo');
  const iCliente = col('Cliente');
  const iContacto = col('Contacto');
  const iCod = col('Cod.');
  const iObra = col('Obra');
  const iFechaAceptacion = col('Fecha Aceptacion');
  const iCategoria = col('Categoría');
  const iDescripcion = col('Descripción');
  const iColor = col('Color');
  const iMaterial = col('Material');
  const iProveedor = col('Proveedor');
  const iFechaObjetivoInicio = col('Fecha Objetivo inicio Tarea');
  const iFechaObjetivoFin = col('Fecha Objetivo fin Tarea');
  const iFechaPedido = col('Fecha Pedido ');
  const iTarea1 = col('Tarea (1)');
  const iResponsable = col('Responsable');
  const iEstatus2 = col('Estatus (2)');
  const iFechaEntregaProveedor = col('Fecha Entrega Material del Proveedor');
  const iUbicacion = col('Ubicación');
  const iTarea3 = col('Tarea (3) entrega material a obra');
  const iComentario = col('Comentario');
  const iPrioridad = col('Prioridad');

  const items = [];
  for (let i = idxHeader + 1; i < rows.length; i++) {
    const fila = rows[i];
    const obra = limpiar(fila[iObra]);
    const categoria = limpiar(fila[iCategoria]);
    if (!obra || !categoria || !CATEGORIAS_INCLUIDAS.has(categoria)) continue;

    items.push({
      tipo: limpiar(fila[iTipo]),
      cliente: limpiar(fila[iCliente]),
      contacto: limpiar(fila[iContacto]),
      cod: limpiar(fila[iCod]),
      obra,
      fecha_aceptacion: fechaDeSerial(fila[iFechaAceptacion]),
      categoria,
      descripcion: limpiar(fila[iDescripcion]),
      color: limpiar(fila[iColor]),
      material: limpiar(fila[iMaterial]),
      proveedor: limpiar(fila[iProveedor]),
      fecha_objetivo_inicio: fechaDeSerial(fila[iFechaObjetivoInicio]),
      fecha_objetivo_fin: fechaDeSerial(fila[iFechaObjetivoFin]),
      fecha_pedido: fechaDeSerial(fila[iFechaPedido]),
      tarea_1: limpiar(fila[iTarea1]),
      responsable: limpiar(fila[iResponsable]),
      estatus_2: limpiar(fila[iEstatus2]),
      fecha_entrega_proveedor: fechaDeSerial(fila[iFechaEntregaProveedor]),
      ubicacion: limpiar(fila[iUbicacion]),
      tarea_3: limpiar(fila[iTarea3]),
      comentario: limpiar(fila[iComentario]),
      prioridad: limpiar(fila[iPrioridad]),
    });
  }
  return items;
}

module.exports = { extraerDiarioGeneral, CATEGORIAS_GESTION, CATEGORIAS_MATERIAL };
