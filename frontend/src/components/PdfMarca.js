// Imagen corporativa común de los PDF del panel (a pedido de Álvaro,
// 2026-10-01): la misma de las facturas (ver FacturacionObra.jsx) — logo de
// GALVI, fuente Carlito, turquesa corporativo #21AEB1 y gris #808080, con
// los datos de la empresa en el pie. La usan PdfPrioridades.js y
// PdfMedicion.js.
import logoGalvi from '../assets/logo_galvi_factura.png'
import carlitoRegularUrl from '../assets/carlito-regular.ttf'
import carlitoBoldUrl from '../assets/carlito-bold.ttf'

export const TEAL = [0x21, 0xae, 0xb1]
export const TEAL_SUAVE = [224, 244, 244]
export const TEAL_OSCURO = [20, 110, 112]
export const GRIS = [0x80, 0x80, 0x80]
export const TEXTO = [60, 60, 60]
export const EMPRESA = 'Gestión de Aluminio y Vidrio, S.L.'
export const PIE = 'GALVI · C/Juan Ramón Jiménez, 2 - Bajo 1 · 28036 Madrid · Tlf: 91 344 04 62 · administracion@galvi.es'
// Proporción del logo (ancho / alto), la misma que usa la factura (32 x 16,6).
export const PROPORCION_LOGO = 32 / 16.6

export function arrayBufferABase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binario = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binario)
}

// Registra Carlito en el documento y devuelve el logo como data URL.
export async function prepararMarca(doc) {
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

// Pie corporativo en todas las páginas: línea turquesa, datos de la empresa
// y "Página X de Y".
export function pieCorporativo(doc, margen) {
  const ancho = doc.internal.pageSize.getWidth()
  const alto = doc.internal.pageSize.getHeight()
  const paginas = doc.getNumberOfPages()
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i)
    doc.setDrawColor(...TEAL)
    doc.setLineWidth(0.4)
    doc.line(margen, alto - 11, ancho - margen, alto - 11)
    doc.setFont('Carlito', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRIS)
    doc.text(PIE, margen, alto - 6.5)
    doc.text(`Página ${i} de ${paginas}`, ancho - margen, alto - 6.5, { align: 'right' })
  }
}
