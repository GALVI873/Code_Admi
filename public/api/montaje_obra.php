<?php
declare(strict_types=1);

// Pestaña "Montaje" de una obra aceptada — a pedido de Álvaro, 2026-09-21:
// todo lo relacionado a la instalación en sí (quién va, con qué materiales,
// qué falta documentar, qué queda pendiente en el sitio), separado de
// "Planos"/"Seguimiento" (que son sobre el pedido/fabricación) y de
// "Bitácora"/"Notas" (registro y pendientes generales, no específicos de
// montaje). Se organiza en tres bloques, todos bajo el mismo endpoint:
//
// 1) DETALLE DE OBRA (montaje_detalle_obra, una fila por obra):
//    - montador/ayudante: nombre de una lista manejable (montaje_personas)
//      — no hay rol de usuario "montador" en el sistema, es una lista
//      simple que crece a medida que se escribe un nombre nuevo (no hace
//      falta una pantalla de administración aparte).
//    - tiempo_estimado: texto libre (ej. "3 días") — no se fuerza una
//      unidad, cada obra puede necesitar describirlo distinto.
//    - carpinteria_acristalada: si la carpintería llega ya acristalada de
//      fábrica o no (booleano).
//    - Fecha estimada de llegada por material (montaje_material_fecha, una
//      fila por obra+material) — categorías fijas: Vidrio, Carpintería,
//      Precercos, Persianas, Composite.
//
// 2) DOCUMENTACIÓN DE MONTAJE (montaje_documentos): lista de archivos
//    adjuntos por categoría (PDF, Planos, Medición, Fotos, Tareas — esta
//    última es el PDF de referencia opcional para el punto 3). Mismo
//    patrón que adicionales_obra.php/medidas_obra.php: el panel no tiene
//    acceso directo a Drive, así que el archivo queda en base64 acá y
//    backend/drive_sync/enviar_documentos_montaje.js lo sube en la próxima
//    sincronización a "1.Organización/Montaje/<Categoría>" de esa obra.
//
// 3) TAREAS PENDIENTES (montaje_tareas): checklist manual (texto + hecho),
//    igual que Notas/Pendientes — Álvaro pidió las dos cosas: la lista
//    tildable Y la posibilidad de adjuntar un PDF de referencia si ya lo
//    tiene armado así (ver categoría "Tareas" del punto 2).
//
// GET ?obra=... : requiere sesión + obras.ver_aceptadas. Devuelve detalle,
// materiales (las 5 categorías siempre, con fecha_estimada null si no se
// cargó), personas (lista completa para el desplegable), documentos y
// tareas.
// PATCH {accion:"actualizar_detalle", obra, montador?, ayudante?,
//   tiempo_estimado?, carpinteria_acristalada?}: upsert de
//   montaje_detalle_obra — solo pisa los campos mandados, el resto queda
//   como estaba.
// PATCH {accion:"actualizar_material", obra, material, fecha_estimada}:
//   upsert de montaje_material_fecha.
// PATCH {accion:"marcar_tarea", id, hecho}: tilda/destilda una tarea.
// POST {accion:"agregar_persona", nombre}: agrega un nombre nuevo a la
//   lista de montadores/ayudantes (no distingue rol — la misma persona
//   puede ser montador en una obra y ayudante en otra).
// POST {accion:"agregar_tarea", obra, texto}: crea una tarea pendiente.
// POST {accion:"agregar_documento", obra, categoria, archivo_base64,
//   nombre_original, tipo_mime}: adjunta un documento.
// DELETE {accion:"eliminar_tarea", id} / {accion:"eliminar_documento", id}.
// POST (SYNC_TOKEN) {accion:"listar_documentos_pendientes_envio"} /
//   {accion:"marcar_documento_enviado", id}: usado por
//   enviar_documentos_montaje.js.
// Todo lo de sesión requiere obras.ver_aceptadas (mismo permiso que el
// resto de la obra aceptada — Alfredo y admin) — a diferencia de Bitácora,
// esto es trabajo de coordinación operativa, no un registro personal de
// Álvaro.

const MATERIALES_MONTAJE = ['Vidrio', 'Carpintería', 'Precercos', 'Persianas', 'Composite'];
const CATEGORIAS_DOCUMENTO_MONTAJE = ['PDF', 'Planos', 'Medición', 'Fotos', 'Tareas'];

$config = require __DIR__ . '/../../backend/bootstrap.php';

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS montaje_detalle_obra (
          obra TEXT PRIMARY KEY,
          montador TEXT,
          ayudante TEXT,
          tiempo_estimado TEXT,
          carpinteria_acristalada INTEGER NOT NULL DEFAULT 0,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
          actualizado_por TEXT
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS montaje_material_fecha (
          obra TEXT NOT NULL,
          material TEXT NOT NULL,
          fecha_estimada TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (obra, material)
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS montaje_personas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre TEXT NOT NULL UNIQUE,
          creado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS montaje_documentos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          categoria TEXT NOT NULL,
          nombre_original TEXT,
          archivo_base64 TEXT NOT NULL,
          tipo_mime TEXT,
          subido_por TEXT,
          subido_en TEXT NOT NULL DEFAULT (datetime('now')),
          enviado_en TEXT
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS montaje_tareas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          texto TEXT NOT NULL,
          hecho INTEGER NOT NULL DEFAULT 0,
          creado_por TEXT,
          creado_en TEXT NOT NULL DEFAULT (datetime('now')),
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    // SYNC_TOKEN (sin sesión) — ver comentario de cabecera. Se resuelve
    // ANTES del chequeo de sesión, mismo patrón que adicionales_obra.php.
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $bodyPost = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $token = $_GET['token'] ?? $bodyPost['token'] ?? '';
        if ($config['sync_token'] !== '' && hash_equals($config['sync_token'], (string) $token)) {
            if (($bodyPost['accion'] ?? '') === 'listar_documentos_pendientes_envio') {
                $pendientes = $db->query("
                    SELECT id, obra, categoria, nombre_original, archivo_base64, tipo_mime
                    FROM montaje_documentos
                    WHERE enviado_en IS NULL
                ")->fetchAll();
                Response::json(['pendientes' => $pendientes]);
            }

            if (($bodyPost['accion'] ?? '') === 'marcar_documento_enviado') {
                $idEnviado = (int) ($bodyPost['id'] ?? 0);
                if ($idEnviado <= 0) {
                    Response::error('Falta "id"', 422);
                }
                $db->prepare("UPDATE montaje_documentos SET enviado_en = datetime('now') WHERE id = ?")
                    ->execute([$idEnviado]);
                Response::json(['ok' => true]);
            }

            Response::error('Acción no reconocida', 422);
        }
    }

    $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
    AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $obra = trim((string) ($_GET['obra'] ?? ''));
        if ($obra === '') {
            Response::error('Falta "obra"', 422);
        }

        $stmtDetalle = $db->prepare('SELECT * FROM montaje_detalle_obra WHERE obra = ?');
        $stmtDetalle->execute([$obra]);
        $detalle = $stmtDetalle->fetch() ?: [
            'obra' => $obra, 'montador' => null, 'ayudante' => null,
            'tiempo_estimado' => null, 'carpinteria_acristalada' => 0,
        ];

        $stmtMateriales = $db->prepare('SELECT material, fecha_estimada FROM montaje_material_fecha WHERE obra = ?');
        $stmtMateriales->execute([$obra]);
        $fechasPorMaterial = [];
        foreach ($stmtMateriales->fetchAll() as $m) {
            $fechasPorMaterial[$m['material']] = $m['fecha_estimada'];
        }
        $materiales = [];
        foreach (MATERIALES_MONTAJE as $m) {
            $materiales[] = ['material' => $m, 'fecha_estimada' => $fechasPorMaterial[$m] ?? null];
        }

        $personas = $db->query('SELECT id, nombre FROM montaje_personas ORDER BY nombre')->fetchAll();

        $stmtDocs = $db->prepare('SELECT * FROM montaje_documentos WHERE obra = ? ORDER BY subido_en DESC, id DESC');
        $stmtDocs->execute([$obra]);
        $documentos = $stmtDocs->fetchAll();

        $stmtTareas = $db->prepare('SELECT * FROM montaje_tareas WHERE obra = ? ORDER BY creado_en ASC, id ASC');
        $stmtTareas->execute([$obra]);
        $tareas = $stmtTareas->fetchAll();

        Response::json([
            'detalle' => $detalle,
            'materiales' => $materiales,
            'personas' => $personas,
            'documentos' => $documentos,
            'tareas' => $tareas,
        ]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $accion = (string) ($body['accion'] ?? '');

        if ($accion === 'actualizar_detalle') {
            $obra = trim((string) ($body['obra'] ?? ''));
            if ($obra === '') {
                Response::error('Falta "obra"', 422);
            }

            $stmtActual = $db->prepare('SELECT * FROM montaje_detalle_obra WHERE obra = ?');
            $stmtActual->execute([$obra]);
            $actual = $stmtActual->fetch() ?: ['montador' => null, 'ayudante' => null, 'tiempo_estimado' => null, 'carpinteria_acristalada' => 0];

            $montador = array_key_exists('montador', $body) ? trim((string) $body['montador']) : ($actual['montador'] ?? '');
            $ayudante = array_key_exists('ayudante', $body) ? trim((string) $body['ayudante']) : ($actual['ayudante'] ?? '');
            $tiempoEstimado = array_key_exists('tiempo_estimado', $body) ? trim((string) $body['tiempo_estimado']) : ($actual['tiempo_estimado'] ?? '');
            $carpinteriaAcristalada = array_key_exists('carpinteria_acristalada', $body)
                ? ($body['carpinteria_acristalada'] ? 1 : 0)
                : (int) ($actual['carpinteria_acristalada'] ?? 0);

            $db->prepare("
                INSERT INTO montaje_detalle_obra (obra, montador, ayudante, tiempo_estimado, carpinteria_acristalada, actualizado_en, actualizado_por)
                VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
                ON CONFLICT(obra) DO UPDATE SET
                    montador = excluded.montador,
                    ayudante = excluded.ayudante,
                    tiempo_estimado = excluded.tiempo_estimado,
                    carpinteria_acristalada = excluded.carpinteria_acristalada,
                    actualizado_en = datetime('now'),
                    actualizado_por = excluded.actualizado_por
            ")->execute([
                $obra,
                $montador === '' ? null : $montador,
                $ayudante === '' ? null : $ayudante,
                $tiempoEstimado === '' ? null : $tiempoEstimado,
                $carpinteriaAcristalada,
                $usuario['nombre'] ?? null,
            ]);

            Response::json(['ok' => true]);
        }

        if ($accion === 'actualizar_material') {
            $obra = trim((string) ($body['obra'] ?? ''));
            $material = trim((string) ($body['material'] ?? ''));
            if ($obra === '' || !in_array($material, MATERIALES_MONTAJE, true)) {
                Response::error('"material" debe ser uno de: ' . implode(', ', MATERIALES_MONTAJE), 422);
            }
            $fechaEstimada = trim((string) ($body['fecha_estimada'] ?? ''));
            if ($fechaEstimada !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fechaEstimada)) {
                Response::error('"fecha_estimada" debe tener formato AAAA-MM-DD', 422);
            }

            $db->prepare("
                INSERT INTO montaje_material_fecha (obra, material, fecha_estimada, actualizado_en)
                VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(obra, material) DO UPDATE SET fecha_estimada = excluded.fecha_estimada, actualizado_en = datetime('now')
            ")->execute([$obra, $material, $fechaEstimada === '' ? null : $fechaEstimada]);

            Response::json(['ok' => true]);
        }

        if ($accion === 'marcar_tarea') {
            $id = (int) ($body['id'] ?? 0);
            if ($id <= 0 || !array_key_exists('hecho', $body)) {
                Response::error('Faltan "id" y/o "hecho"', 422);
            }
            $db->prepare("UPDATE montaje_tareas SET hecho = ?, actualizado_en = datetime('now') WHERE id = ?")
                ->execute([$body['hecho'] ? 1 : 0, $id]);
            Response::json(['ok' => true]);
        }

        Response::error('Acción no reconocida', 422);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $accion = (string) ($body['accion'] ?? '');

        if ($accion === 'agregar_persona') {
            $nombre = trim((string) ($body['nombre'] ?? ''));
            if ($nombre === '') {
                Response::error('Falta "nombre"', 422);
            }
            $db->prepare('INSERT OR IGNORE INTO montaje_personas (nombre) VALUES (?)')->execute([$nombre]);
            $personas = $db->query('SELECT id, nombre FROM montaje_personas ORDER BY nombre')->fetchAll();
            Response::json(['personas' => $personas]);
        }

        if ($accion === 'agregar_tarea') {
            $obra = trim((string) ($body['obra'] ?? ''));
            $texto = trim((string) ($body['texto'] ?? ''));
            if ($obra === '' || $texto === '') {
                Response::error('Faltan "obra" y/o "texto"', 422);
            }
            $db->prepare('INSERT INTO montaje_tareas (obra, texto, creado_por) VALUES (?, ?, ?)')
                ->execute([$obra, $texto, $usuario['nombre'] ?? null]);
            $id = (int) $db->lastInsertId();
            $stmt = $db->prepare('SELECT * FROM montaje_tareas WHERE id = ?');
            $stmt->execute([$id]);
            Response::json(['tarea' => $stmt->fetch()]);
        }

        if ($accion === 'agregar_documento') {
            $obra = trim((string) ($body['obra'] ?? ''));
            $categoria = trim((string) ($body['categoria'] ?? ''));
            $archivoBase64 = (string) ($body['archivo_base64'] ?? '');
            if ($obra === '' || !in_array($categoria, CATEGORIAS_DOCUMENTO_MONTAJE, true) || $archivoBase64 === '') {
                Response::error('Faltan "obra", "categoria" (una de: ' . implode(', ', CATEGORIAS_DOCUMENTO_MONTAJE) . ') y/o "archivo_base64"', 422);
            }
            $nombreOriginal = trim((string) ($body['nombre_original'] ?? ''));
            $tipoMime = trim((string) ($body['tipo_mime'] ?? ''));

            $db->prepare('INSERT INTO montaje_documentos (obra, categoria, nombre_original, archivo_base64, tipo_mime, subido_por) VALUES (?, ?, ?, ?, ?, ?)')
                ->execute([$obra, $categoria, $nombreOriginal === '' ? null : $nombreOriginal, $archivoBase64, $tipoMime === '' ? null : $tipoMime, $usuario['nombre'] ?? null]);
            $id = (int) $db->lastInsertId();
            $stmt = $db->prepare('SELECT * FROM montaje_documentos WHERE id = ?');
            $stmt->execute([$id]);
            Response::json(['documento' => $stmt->fetch()]);
        }

        Response::error('Acción no reconocida', 422);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $accion = (string) ($body['accion'] ?? '');
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            Response::error('Falta "id"', 422);
        }

        if ($accion === 'eliminar_tarea') {
            $db->prepare('DELETE FROM montaje_tareas WHERE id = ?')->execute([$id]);
            Response::json(['ok' => true]);
        }

        if ($accion === 'eliminar_documento') {
            $db->prepare('DELETE FROM montaje_documentos WHERE id = ?')->execute([$id]);
            Response::json(['ok' => true]);
        }

        Response::error('Acción no reconocida', 422);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
