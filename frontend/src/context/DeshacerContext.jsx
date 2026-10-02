import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// Deshacer común a todo el panel (a pedido de Álvaro, 2026-10-02: "muchas
// veces se confunde y prefiere Ctrl+Z"). Cada sección, al guardar algo,
// registra cómo volver atrás con registrar(descripcion, fn); Ctrl+Z (fuera
// de un campo de texto, donde sigue deshaciendo lo escrito) o el botón
// flotante "↶ Deshacer" aplican el último paso, esté en la página que esté.
// La pila vive mientras la sesión está abierta en esa pestaña (máx. 50).
//
// Lo que ya salió del panel (enviar a taller, a Alfredo, subir a Drive,
// facturas emitidas) no se registra: eso sigue pidiendo confirmación.

const DeshacerContext = createContext(null)
const MAX_PASOS = 50

// Un elemento borrado y vuelto a crear con Deshacer cambia de id: los pasos
// más viejos que lo nombran tienen que usar el id nuevo. Cada sección usa su
// propio espacio ("plan-tarea", "prio-categoria"...).
const idsRecreados = new Map()
export function marcarRecreado(espacio, idViejo, idNuevo) {
  idsRecreados.set(`${espacio}:${idViejo}`, idNuevo)
}
export function idVigente(espacio, id) {
  let x = id
  while (idsRecreados.has(`${espacio}:${x}`)) x = idsRecreados.get(`${espacio}:${x}`)
  return x
}

export function DeshacerProvider({ children }) {
  const pila = useRef([])
  const ocupado = useRef(false)
  const [pasos, setPasos] = useState([])
  const [aviso, setAviso] = useState(null) // { texto, error }

  const registrar = useCallback((descripcion, deshacerPaso) => {
    pila.current = [...pila.current.slice(-(MAX_PASOS - 1)), { descripcion, deshacer: deshacerPaso }]
    setPasos(pila.current)
    setAviso(null)
  }, [])

  const deshacer = useCallback(async () => {
    if (ocupado.current) return
    const paso = pila.current[pila.current.length - 1]
    if (!paso) return
    pila.current = pila.current.slice(0, -1)
    setPasos(pila.current)
    ocupado.current = true
    setAviso({ texto: `Deshaciendo: ${paso.descripcion}…` })
    try {
      await paso.deshacer()
      setAviso({ texto: `Deshecho: ${paso.descripcion}` })
    } catch (err) {
      setAviso({ texto: `No se pudo deshacer "${paso.descripcion}": ${err.message}`, error: true })
    } finally {
      ocupado.current = false
    }
  }, [])

  useEffect(() => {
    function alPulsarTecla(e) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      deshacer()
    }
    window.addEventListener('keydown', alPulsarTecla)
    return () => window.removeEventListener('keydown', alPulsarTecla)
  }, [deshacer])

  // El aviso de "Deshecho" se va solo; el de error queda hasta cerrarlo.
  useEffect(() => {
    if (!aviso || aviso.error || aviso.texto.endsWith('…')) return undefined
    const t = setTimeout(() => setAviso(null), 5000)
    return () => clearTimeout(t)
  }, [aviso])

  const valor = useMemo(() => ({ registrar, deshacer, pasos }), [registrar, deshacer, pasos])
  const ultimo = pasos[pasos.length - 1]

  return (
    <DeshacerContext.Provider value={valor}>
      {children}
      {(ultimo || aviso) && (
        <div className="deshacer-flotante">
          {aviso && (
            <span className={`deshacer-aviso${aviso.error ? ' deshacer-aviso-error' : ''}`}>
              {aviso.texto}
              {aviso.error && <button type="button" className="deshacer-cerrar" onClick={() => setAviso(null)} title="Cerrar">✕</button>}
            </span>
          )}
          {ultimo && (
            <button type="button" className="deshacer-boton" onClick={deshacer} title={`Deshacer: ${ultimo.descripcion} (Ctrl+Z)`}>
              ↶ Deshacer <span className="deshacer-que">{ultimo.descripcion}</span>
            </button>
          )}
        </div>
      )}
    </DeshacerContext.Provider>
  )
}

// Fuera del proveedor (ej. login) no hace nada.
const SIN_PROVEEDOR = { registrar: () => {}, deshacer: () => {}, pasos: [] }
export function useDeshacer() {
  return useContext(DeshacerContext) || SIN_PROVEEDOR
}
