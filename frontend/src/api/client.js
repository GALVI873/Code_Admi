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
