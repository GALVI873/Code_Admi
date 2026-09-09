const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || 'Error de red')
  }
  return data
}

export function login(email, password) {
  return request('/login.php', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function me(accessToken) {
  return request('/me.php', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function refresh() {
  return request('/refresh.php', { method: 'POST' })
}

export function logout() {
  return request('/logout.php', { method: 'POST' })
}

export function presupuestosEnEstudio(accessToken) {
  return request('/presupuestos_en_estudio.php', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function actualizarPresupuestoEnEstudio(accessToken, id, cambios) {
  return request('/presupuestos_en_estudio.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ id, ...cambios }),
  })
}

export function guardarOrdenAgenda(accessToken, ordenBasesObra) {
  return request('/presupuestos_en_estudio.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ orden_agenda: ordenBasesObra }),
  })
}

export function agregarSolicitudOferta(accessToken, obra, proveedor, fechaSolicitud) {
  return request('/presupuestos_en_estudio.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ accion: 'agregar_solicitud_oferta', obra, proveedor, fecha_solicitud: fechaSolicitud }),
  })
}

export function eliminarOferta(accessToken, ofertaId) {
  return request('/presupuestos_en_estudio.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ accion: 'eliminar_oferta', oferta_id: ofertaId }),
  })
}

export function cambiarEstatusOferta(accessToken, ofertaId, estatus) {
  return request('/presupuestos_en_estudio.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ accion: 'cambiar_estatus_oferta', oferta_id: ofertaId, estatus }),
  })
}

export function seguimientoMateriales(accessToken) {
  return request('/seguimiento_materiales.php', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function actualizarMaterialObraAceptada(accessToken, obra, material, campo, valor) {
  return request('/seguimiento_materiales.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      obra,
      posicion: material.posicion,
      tipo: material.tipo,
      material: material.material,
      descripcion: material.descripcion,
      campo,
      valor,
    }),
  })
}

export function obrasAceptadas(accessToken) {
  return request('/obras_aceptadas.php', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function confirmarCampoObraAceptada(accessToken, obra, campo, valor) {
  return request('/obras_aceptadas.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ obra, campo, valor }),
  })
}

export function quitarConfirmacionObraAceptada(accessToken, obra, campo) {
  return request('/obras_aceptadas.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ obra, campo, eliminar: true }),
  })
}

export function cambiarEstatusObraAceptada(accessToken, obra, estatus) {
  return request('/obras_aceptadas.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ obra, estatus }),
  })
}

export function marcarObraAceptadaVista(accessToken, obra) {
  return request('/obras_aceptadas.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ obra, marcar_vista: true }),
  })
}

export function guardarDireccionObra(accessToken, obra, datos) {
  return request('/obras_aceptadas.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ obra, guardar_direccion: true, ...datos }),
  })
}

export function planosObra(accessToken, obra) {
  return request(`/planos.php?obra=${encodeURIComponent(obra)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function guardarPosicionPlano(accessToken, obra, posicionBase, pagina, xPct, yPct) {
  return request('/planos.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ obra, posicion_base: posicionBase, pagina, x_pct: xPct, y_pct: yPct }),
  })
}

export function quitarPosicionPlano(accessToken, obra, posicionBase) {
  return request('/planos.php', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ obra, posicion_base: posicionBase }),
  })
}

export function diarioGeneral(accessToken) {
  return request('/diario_general.php', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function actualizarUbicacionDiarioGeneral(accessToken, id, ubicacion) {
  return request('/diario_general.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ id, ubicacion }),
  })
}

export function comentariosObra(accessToken, obra) {
  return request(`/comentarios_obra.php?obra=${encodeURIComponent(obra)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function agregarComentarioObra(accessToken, obra, mensaje) {
  return request('/comentarios_obra.php', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ obra, mensaje }),
  })
}

export function marcarComentarioHecho(accessToken, id, hecho) {
  return request('/comentarios_obra.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ id, hecho }),
  })
}

export function pendientesObrasAceptadas(accessToken) {
  return request('/comentarios_obra.php?pendientes=1', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

// TEMPORAL — botón de prueba para vaciar una conversación (solo admin, ver
// comentarios_obra.php). Sacar cuando ya no haga falta reiniciar
// conversaciones de prueba.
export function eliminarConversacionObra(accessToken, obra) {
  return request(`/comentarios_obra.php?obra=${encodeURIComponent(obra)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function adicionalesObra(accessToken) {
  return request('/adicionales_obra.php', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function agregarAdicionalObra(accessToken, { obra, fecha_solicitud, detalle, solicitado_por }) {
  return request('/adicionales_obra.php', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ obra, fecha_solicitud, detalle, solicitado_por }),
  })
}

export function cambiarEstatusAdicionalObra(accessToken, id, estatus) {
  return request('/adicionales_obra.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ id, estatus }),
  })
}

export function cambiarPrioridadAdicionalObra(accessToken, id, prioridad) {
  return request('/adicionales_obra.php', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ id, prioridad }),
  })
}

export function eliminarAdicionalObra(accessToken, id) {
  return request('/adicionales_obra.php', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ id }),
  })
}
