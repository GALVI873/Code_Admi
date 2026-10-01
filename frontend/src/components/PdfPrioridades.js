// Informe PDF del cronograma de Prioridades (a pedido de Álvaro,
// 2026-10-01) — mismo formato que su planilla original: por cada obra un
// encabezado con su fin previsto, sus fachadas y tareas con Categoría /
// Acción / Tarea / Responsable / Estado / Inicio / Fin, y a la derecha una
// cuadrícula de días con la duración de cada tarea pintada del color de su
// categoría. jsPDF + jspdf-autotable (ya usados en Facturación), cargados
// solo al pedir el PDF. A3 apaisado para que entren las columnas de días.
//
// Imagen corporativa (a pedido de Álvaro, 2026-10-01): la misma de las
// facturas del panel (ver FacturacionObra.jsx) — logo de GALVI, fuente
// Carlito, turquesa corporativo #21AEB1 y gris #808080, con los datos de la
// empresa en la cabecera y en el pie.
import logoGalvi from '../assets/logo_galvi_factura.png'
import carlitoRegularUrl from '../assets/carlito-regular.ttf'
import carlitoBoldUrl from '../assets/carlito-bold.ttf'

const TEAL = [0x21, 0xae, 0xb1]
const TEAL_SUAVE = [224, 244, 244]
const TEAL_OSCURO = [20, 110, 112]
const GRIS = [0x80, 0x80, 0x80]
const TEXTO = [60, 60, 60]
const EMPRESA = 'Gestión de Aluminio y Vidrio, S.L.'
const PIE = 'GALVI · C/Juan Ramón Jiménez, 2 - Bajo 1 · 28036 Madrid · Tlf: 91 344 04 62 · administracion@galvi.es'

function arrayBufferABase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binario = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binario)
}

async function prepararMarca(doc) {
  const [regular, negrita, logo] = await Promise.all([
    fetch(carlitoRegularUrl).then((r) => r.arrayBuffer()),
    fetch(carlitoBoldUrl).then((r) => r.arrayBuffer()),
    fetch(logoGalvi).then((r) => r.arrayBuffer()),
  ])
  doc.addFileToVFS('Carlito-Regular.ttf', arrayBufferABase64(regular))
  doc.addFont('Carlito-Regular.ttf', 'Carlito', 'normal')
  doc.addFileToVFS('Carlito-Bold.ttf', arrayBufferABase64(negrita))
  doc.addFont('Carlito-Bold.ttf', 'Carlito', 'bold')
  doc.setFont('Carlito', 'normal')
  return `data:image/png;base64,${arrayBufferABase64(logo)}`
}

const MS_DIA = 86400000
const LETRAS = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

function aNumero(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  return Math.round(Date.UTC(a, m - 1, d) / MS_DIA)
}

function aIso(n) {
  return new Date(n * MS_DIA).toISOString().slice(0, 10)
}

function corto(iso) {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function largo(iso) {
  if (!iso) return ''
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function rgb(hex) {
  const h = (hex || '#dde2e7').replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function hoyIso() {
  const h = new Date()
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`
}

function resumen(obra, tareas) {
  const pendientes = tareas.filter((t) => t.estado !== 'Terminado')
  const conFecha = pendientes.filter((t) => t.fecha_inicio)
  const partes = [`${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'} de ${tareas.length}`]
  if (conFecha.length) {
    const fin = Math.max(...conFecha.map((t) => aNumero(t.fecha_fin || t.fecha_inicio)))
    partes.push(`Fin previsto: ${largo(aIso(fin))}`)
    if (obra.fecha_objetivo) {
      const diff = fin - aNumero(obra.fecha_objetivo)
      partes.push(diff > 0 ? `${diff} día(s) por encima del objetivo (${largo(obra.fecha_objetivo)})` : diff === 0 ? 'justo en el objetivo' : `${-diff} día(s) antes del objetivo (${largo(obra.fecha_objetivo)})`)
    }
  }
  return { texto: partes.join(' · '), tarde: obra.fecha_objetivo && conFecha.length && Math.max(...conFecha.map((t) => aNumero(t.fecha_fin || t.fecha_inicio))) > aNumero(obra.fecha_objetivo) }
}

export async function descargarPdfPrioridades(datos, { verTerminadas = true } = {}) {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const tareasIncluidas = datos.tareas.filter((t) => verTerminadas || t.estado !== 'Terminado')
  const conFecha = tareasIncluidas.filter((t) => t.fecha_inicio)
  const hoy = aNumero(hoyIso())
  let ini = conFecha.length ? Math.min(...conFecha.map((t) => aNumero(t.fecha_inicio))) : hoy
  let fin = conFecha.length ? Math.max(...conFecha.map((t) => aNumero(t.fecha_fin || t.fecha_inicio))) : hoy + 27
  // Arranca el lunes de esa semana y nunca muestra menos de 4 semanas.
  ini -= (new Date(ini * MS_DIA).getUTCDay() + 6) % 7
  fin = Math.max(fin, ini + 27)
  const dias = []
  for (let n = ini; n <= fin; n++) dias.push(n)

  const doc = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' })
  const logo = await prepararMarca(doc)
  const anchoPagina = doc.internal.pageSize.getWidth()
  const altoPagina = doc.internal.pageSize.getHeight()
  const margen = 12
  const anchosFijos = [26, 24, 92, 32, 18, 14, 14]
  const anchoDias = anchoPagina - margen * 2 - anchosFijos.reduce((a, b) => a + b, 0)
  const anchoDia = Math.max(anchoDias / dias.length, 2.2)
  const fuenteDia = anchoDia >= 5 ? 6 : 4.5

  // Cabecera corporativa: logo a la izquierda (misma proporción que en la
  // factura, 32 x 16,6), título y datos a la derecha, línea turquesa debajo.
  doc.addImage(logo, 'PNG', margen, 7, 36, 18.7)
  doc.setFont('Carlito', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...GRIS)
  doc.text('CRONOGRAMA DE OBRA', anchoPagina - margen, 14, { align: 'right' })
  doc.setFontSize(11)
  doc.setTextColor(...TEAL)
  doc.text('Prioridades · Obras en fase de finalización', anchoPagina - margen, 20, { align: 'right' })
  doc.setFont('Carlito', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GRIS)
  doc.text(`${EMPRESA} · Generado el ${largo(hoyIso())} · ${datos.obras.length} obra(s) · ${tareasIncluidas.length} tarea(s)${verTerminadas ? '' : ' (sin terminadas)'}`, anchoPagina - margen, 25, { align: 'right' })
  doc.setDrawColor(...TEAL)
  doc.setLineWidth(0.8)
  doc.line(margen, 29, anchoPagina - margen, 29)
  doc.setTextColor(0)

  const cabecera = [
    'Categoría', 'Acción', 'Tarea', 'Responsable', 'Estado', 'Inicio', 'Fin',
    ...dias.map((n) => {
      const f = new Date(n * MS_DIA)
      return anchoDia >= 4 ? `${LETRAS[f.getUTCDay()]}\n${f.getUTCDate()}` : `${f.getUTCDate()}`
    }),
  ]
  const totalColumnas = cabecera.length
  const filas = []
  // Metadatos por fila para pintar en didParseCell (mismo índice que filas).
  const meta = []

  for (const obra of datos.obras) {
    const categorias = new Map(datos.categorias.filter((c) => c.obra_id === obra.id).map((c) => [c.id, c]))
    const acciones = new Map((datos.acciones || []).filter((a) => a.obra_id === obra.id).map((a) => [a.id, a]))
    const zonas = (datos.zonas || []).filter((z) => z.obra_id === obra.id)
    const todas = datos.tareas.filter((t) => t.obra_id === obra.id)
    const visibles = tareasIncluidas
      .filter((t) => t.obra_id === obra.id)
      .sort((a, b) => (a.fecha_inicio || '9999').localeCompare(b.fecha_inicio || '9999') || a.id - b.id)
    const r = resumen(obra, todas)

    filas.push([{ content: `${(obra.alias || obra.obra).toUpperCase()}${obra.nota ? `  (${obra.nota})` : ''}`, colSpan: totalColumnas }])
    meta.push({ tipo: 'obra' })
    filas.push([{ content: r.texto, colSpan: totalColumnas }])
    meta.push({ tipo: 'resumen', tarde: r.tarde })

    const filaTarea = (t) => {
      const cat = categorias.get(t.categoria_id)
      const acc = acciones.get(t.accion_id)
      filas.push([
        cat?.nombre || '', acc?.nombre || '', t.descripcion || '', t.responsable || '', t.estado,
        corto(t.fecha_inicio), corto(t.fecha_fin || t.fecha_inicio), ...dias.map(() => ''),
      ])
      meta.push({
        tipo: 'tarea',
        colorCat: cat?.color,
        colorAcc: acc?.color,
        destacada: !!t.destacada,
        terminada: t.estado === 'Terminado',
        ini: t.fecha_inicio ? aNumero(t.fecha_inicio) : null,
        fin: t.fecha_inicio ? aNumero(t.fecha_fin || t.fecha_inicio) : null,
      })
    }

    for (const t of visibles.filter((x) => !x.zona_id || !zonas.some((z) => z.id === x.zona_id))) filaTarea(t)
    for (const z of zonas) {
      const deZona = visibles.filter((t) => t.zona_id === z.id)
      if (deZona.length === 0) continue
      filas.push([{ content: z.nombre, colSpan: totalColumnas }])
      meta.push({ tipo: 'zona' })
      for (const t of deZona) filaTarea(t)
    }
    if (visibles.length === 0) {
      filas.push([{ content: 'Sin tareas', colSpan: totalColumnas }])
      meta.push({ tipo: 'vacia' })
    }
  }

  const estilosColumnas = {}
  anchosFijos.forEach((w, i) => { estilosColumnas[i] = { cellWidth: w } })
  dias.forEach((_, i) => { estilosColumnas[7 + i] = { cellWidth: anchoDia, halign: 'center', cellPadding: 0.2, fontSize: fuenteDia } })

  autoTable(doc, {
    startY: 33,
    margin: { left: margen, right: margen, bottom: 16 },
    head: [cabecera],
    body: filas,
    theme: 'grid',
    styles: { font: 'Carlito', fontSize: 8, cellPadding: 1.2, lineColor: [222, 228, 232], lineWidth: 0.1, textColor: TEXTO, valign: 'middle', overflow: 'linebreak' },
    headStyles: { font: 'Carlito', fillColor: TEAL, textColor: 255, fontStyle: 'bold', fontSize: 8, halign: 'center' },
    columnStyles: estilosColumnas,
    didParseCell: (h) => {
      if (h.section === 'head') {
        if (h.column.index >= 7) {
          h.cell.styles.fontSize = fuenteDia
          h.cell.styles.cellPadding = 0.3
          const n = dias[h.column.index - 7]
          const d = new Date(n * MS_DIA).getUTCDay()
          if (n === hoy) h.cell.styles.fillColor = [229, 115, 115]
          else if (d === 0 || d === 6) h.cell.styles.fillColor = TEAL_OSCURO
        }
        return
      }
      const m = meta[h.row.index]
      if (!m) return
      if (m.tipo === 'obra') {
        Object.assign(h.cell.styles, { fillColor: TEAL_SUAVE, fontStyle: 'bold', fontSize: 10.5, textColor: TEAL_OSCURO })
        return
      }
      if (m.tipo === 'resumen') {
        Object.assign(h.cell.styles, { fontStyle: 'normal', fontSize: 8, textColor: m.tarde ? [192, 80, 77] : GRIS })
        return
      }
      if (m.tipo === 'zona') {
        Object.assign(h.cell.styles, { fillColor: [245, 247, 248], fontStyle: 'bold', textColor: TEXTO })
        return
      }
      if (m.tipo === 'vacia') {
        Object.assign(h.cell.styles, { textColor: [140, 140, 140], fontStyle: 'italic' })
        return
      }
      if (m.terminada) h.cell.styles.textColor = [150, 158, 170]
      const c = h.column.index
      if (c === 0 && m.colorCat) h.cell.styles.fillColor = rgb(m.colorCat)
      if (c === 1 && m.colorAcc) h.cell.styles.fillColor = rgb(m.colorAcc)
      if (c === 2 && m.destacada) h.cell.styles.fillColor = [255, 243, 168]
      if (c >= 7) {
        const n = dias[c - 7]
        const d = new Date(n * MS_DIA).getUTCDay()
        if (m.ini !== null && n >= m.ini && n <= m.fin) {
          h.cell.styles.fillColor = m.terminada ? [226, 230, 235] : rgb(m.colorCat)
        } else if (d === 0 || d === 6) {
          h.cell.styles.fillColor = [242, 244, 247]
        }
      }
    },
  })

  // Pie corporativo en todas las páginas: línea turquesa, datos de la
  // empresa y número de página.
  const paginas = doc.getNumberOfPages()
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i)
    doc.setDrawColor(...TEAL)
    doc.setLineWidth(0.4)
    doc.line(margen, altoPagina - 11, anchoPagina - margen, altoPagina - 11)
    doc.setFont('Carlito', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRIS)
    doc.text(PIE, margen, altoPagina - 6.5)
    doc.text(`Página ${i} de ${paginas}`, anchoPagina - margen, altoPagina - 6.5, { align: 'right' })
  }
  doc.save(`Cronograma_Prioridades_${hoyIso()}.pdf`)
}
