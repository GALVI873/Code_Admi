<?php
declare(strict_types=1);

// Adicionales de obra: trabajo extra que un cliente pide sobre una obra ya
// aceptada (cambios, ampliaciones) — Geraldinne los carga a mano desde la
// pestaña "Adicionales de Obra" de Presupuesto, no viene de ninguna
// sincronización con Drive. El "cliente" de cada adicional NUNCA se guarda
// como texto propio: siempre se resuelve al vuelo contra obras_aceptadas
// (JOIN por nombre de obra), así que si ese dato cambia ahí, se refleja acá
// solo, sin quedar desactualizado.
//
// GET: lista los adicionales (con "orden_agenda", su posición manual en
// Orden del día — ver más abajo) + la lista de obras aceptadas disponibles
// para el desplegable "Nombre" (requiere sesión + presupuestos.ver_todos o
// presupuestos.ver_seguimiento — misma audiencia que la página Presupuesto,
// A PROPÓSITO no se exige obras.ver_aceptadas para no tener que abrirle a
// Geraldinne la página completa de Obras Aceptadas solo para este
// desplegable). El orden manual en sí se guarda con el mismo PATCH
// {orden_agenda:[...]} de presupuestos_en_estudio.php (tabla orden_agenda
// compartida, clave "adicional:<id>") — no tiene endpoint propio acá. No
// devuelve pdf_base64 completo (puede pesar) — solo "tiene_pdf" y los datos
// del envío a Drive.
// POST: crea un adicional {obra, fecha_solicitud, detalle, solicitado_por} —
// arranca siempre en estatus "En Valoración" y prioridad "Normal".
// PATCH: {id, estatus} cambia el estatus ("En Valoración"/"Enviado"/
// "Modificando"/"Alvarada"/"Aceptado") — Geraldinne (requiere
// presupuestos.ver_seguimiento) puede ponerlo en cualquiera de los cinco;
// Álvaro/Valentina (requiere presupuestos.gestionar_prioridad, sin
// ver_seguimiento) SOLO puede marcarlo "Alvarada" — a pedido de Álvaro,
// 2026-09-21: significa que a él el cliente ya se lo aceptó (de palabra,
// por teléfono, etc.), pero el trámite formal (el correo de aceptación y
// cargar el PDF) lo sigue llevando Geraldinne. Al marcarla se guarda el
// estatus que tenía justo antes en estatus_antes_de_alvarada, así puede
// deshacerla él mismo (a pedido de Álvaro, 2026-09-21: "devolver la acción
// de Alvarada") volviendo a mandar ESE mismo valor como "estatus" — es el
// único otro caso permitido sin ver_seguimiento, y solo mientras el
// adicional siga en "Alvarada" (si Geraldinne ya lo movió para adelante, se
// pierde la posibilidad de deshacer). Cualquier otro valor mandado por
// alguien sin ver_seguimiento se rechaza. Al ENTRAR a "Aceptado" (a pedido
// de Álvaro, 2026-09-24) se le crea a Alfredo una nota/tarea automática en
// "Notas" de esa obra (Alfredo no tiene acceso a esta pestaña ni se
// enteraba de otra forma) y, si la obra ya estaba "Terminada", se reabre a
// "Activo" — ver el bloque de más abajo. {id, prioridad} cambia la
// prioridad ("Alta"/"Normal") — esa es exclusiva de Álvaro/Valentina
// (requiere presupuestos.gestionar_prioridad), mismo criterio que la
// prioridad de Presupuesto: decide si el adicional aparece en el bloque de
// arriba de "Orden del día".
// {id, pdf_base64, pdf_nombre_original} sube el PDF del adicional ya
// aceptado por el cliente (a pedido de Álvaro, 2026-09-21: cuando un
// adicional pasa a "Aceptado", Geraldinne carga acá el PDF firmado) —
// requiere presupuestos.ver_seguimiento, no depende de que el estatus ya
// esté en "Aceptado" (puede subirse antes o después del cambio de estatus).
// No se sube a Drive al toque (el panel no tiene acceso directo, mismo
// criterio que medidas_obra.php): queda en base64 en la fila, y
// backend/drive_sync/enviar_adicionales_aceptados.js lo recoge en la
// próxima sincronización y lo sube a "1.Organización/Adicionales" de esa
// obra en Drive, con el nombre "Adicional de obra - <detalle>.pdf".
// DELETE: {id} borra un adicional puntual (por si se cargó mal).
// POST (SYNC_TOKEN) {accion:"listar_pdfs_pendientes_envio"}: adicionales con
// un PDF cargado que todavía no se mandó a Drive.
// POST (SYNC_TOKEN) {accion:"marcar_pdf_enviado", id}: marca ese PDF como ya
// subido a Drive — usado por enviar_adicionales_aceptados.js al terminar.

const ESTATUS_ADICIONAL_VALIDOS = ['En Valoración', 'Enviado', 'Modificando', 'Alvarada', 'Aceptado'];
const PRIORIDAD_ADICIONAL_VALIDOS = ['Alta', 'Normal'];

$config = require __DIR__ . '/../../backend/bootstrap.php';

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS adicionales_obra (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          estatus TEXT NOT NULL DEFAULT 'En Valoración',
          prioridad TEXT NOT NULL DEFAULT 'Normal',
          fecha_solicitud TEXT,
          detalle TEXT NOT NULL,
          solicitado_por TEXT,
          creado_por_email TEXT,
          creado_por_nombre TEXT,
          creado_en TEXT NOT NULL DEFAULT (datetime('now')),
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");
    $columnasAdicionales = array_column($db->query('PRAGMA table_info(adicionales_obra)')->fetchAll(), 'name');
    if (!in_array('estatus', $columnasAdicionales, true)) {
        $db->exec("ALTER TABLE adicionales_obra ADD COLUMN estatus TEXT NOT NULL DEFAULT 'En Valoración'");
    }
    if (!in_array('prioridad', $columnasAdicionales, true)) {
        $db->exec("ALTER TABLE adicionales_obra ADD COLUMN prioridad TEXT NOT NULL DEFAULT 'Normal'");
    }
    if (!in_array('pdf_base64', $columnasAdicionales, true)) {
        $db->exec('ALTER TABLE adicionales_obra ADD COLUMN pdf_base64 TEXT');
        $db->exec('ALTER TABLE adicionales_obra ADD COLUMN pdf_nombre_original TEXT');
        $db->exec('ALTER TABLE adicionales_obra ADD COLUMN pdf_subido_por TEXT');
        $db->exec('ALTER TABLE adicionales_obra ADD COLUMN pdf_subido_en TEXT');
        $db->exec('ALTER TABLE adicionales_obra ADD COLUMN pdf_enviado_en TEXT');
    }
    if (!in_array('estatus_antes_de_alvarada', $columnasAdicionales, true)) {
        $db->exec('ALTER TABLE adicionales_obra ADD COLUMN estatus_antes_de_alvarada TEXT');
    }

    // Misma tabla que usa "Orden del día" para el orden manual de las obras
    // de presupuesto (presupuestos_en_estudio.php) — un adicional comparte
    // ese mecanismo con la clave "adicional:<id>" en vez de un nombre de
    // obra, así puede mezclarse y reordenarse junto con las obras de
    // siempre sin pisar ninguna clave real. Se crea acá también (idempotente)
    // por si esta es la primera vez que corre cualquiera de las dos rutas.
    $db->exec("
        CREATE TABLE IF NOT EXISTS orden_agenda (
          obra_base TEXT PRIMARY KEY,
          orden INTEGER NOT NULL,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    // Envío del PDF a Drive (SYNC_TOKEN, sin sesión) — ver comentario de
    // cabecera. Se resuelve ANTES del chequeo de sesión de más abajo, mismo
    // patrón que el resto de endpoints con una pata SYNC_TOKEN (p. ej.
    // medidas_obra.php).
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $bodyPost = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $token = $_GET['token'] ?? $bodyPost['token'] ?? '';
        if ($config['sync_token'] !== '' && hash_equals($config['sync_token'], (string) $token)) {
            if (($bodyPost['accion'] ?? '') === 'listar_pdfs_pendientes_envio') {
                $pendientes = $db->query("
                    SELECT id, obra, detalle, pdf_base64, pdf_nombre_original
                    FROM adicionales_obra
                    WHERE pdf_base64 IS NOT NULL AND pdf_base64 != '' AND pdf_enviado_en IS NULL
                ")->fetchAll();
                Response::json(['pendientes' => $pendientes]);
            }

            if (($bodyPost['accion'] ?? '') === 'marcar_pdf_enviado') {
                $idEnviado = (int) ($bodyPost['id'] ?? 0);
                if ($idEnviado <= 0) {
                    Response::error('Falta "id"', 422);
                }
                $db->prepare("UPDATE adicionales_obra SET pdf_enviado_en = datetime('now') WHERE id = ?")
                    ->execute([$idEnviado]);
                Response::json(['ok' => true]);
            }

            // TEMPORAL — debug para revisar un caso real (Príncipe de
            // Vergara) sin necesitar sesión. Sacar en cuanto se confirme.
            if (($bodyPost['accion'] ?? '') === 'debug_buscar') {
                $texto = (string) ($bodyPost['texto'] ?? '');
                $stmtA = $db->prepare("SELECT id, obra, detalle, estatus, actualizado_en FROM adicionales_obra WHERE obra LIKE ? ORDER BY actualizado_en DESC");
                $stmtA->execute(['%' . $texto . '%']);
                $encontrados = $stmtA->fetchAll();
                foreach ($encontrados as &$fila) {
                    $stmtO = $db->prepare('SELECT estatus, actualizado_en FROM obras_aceptadas WHERE obra = ?');
                    $stmtO->execute([$fila['obra']]);
                    $fila['obra_info'] = $stmtO->fetch() ?: null;
                    $stmtN = $db->prepare("SELECT mensaje, creado_en FROM comentarios_obra WHERE obra = ? ORDER BY creado_en DESC LIMIT 5");
                    $stmtN->execute([$fila['obra']]);
                    $fila['ultimas_notas'] = $stmtN->fetchAll();
                }
                unset($fila);
                Response::json(['encontrados' => $encontrados]);
            }

            // TEMPORAL — aplica retroactivamente la notificación de
            // "Aceptado" (nota a Alfredo + reapertura si corresponde) a un
            // adicional puntual que ya se había marcado Aceptado ANTES de
            // que este cambio quedara desplegado (caso real: Príncipe de
            // Vergara, 185, 9ºC, id 11, aceptado 2026-09-24 06:40, minutos
            // antes del deploy). Sacar en cuanto se confirme.
            if (($bodyPost['accion'] ?? '') === 'debug_aplicar_retroactivo') {
                $idRetro = (int) ($bodyPost['id'] ?? 0);
                if ($idRetro <= 0) {
                    Response::error('Falta "id"', 422);
                }
                $stmtR = $db->prepare("SELECT obra, detalle, estatus FROM adicionales_obra WHERE id = ?");
                $stmtR->execute([$idRetro]);
                $adicionalRetro = $stmtR->fetch();
                if (!$adicionalRetro) {
                    Response::error('Adicional no encontrado', 404);
                }
                if ($adicionalRetro['estatus'] !== 'Aceptado') {
                    Response::error('Este adicional no está en estatus "Aceptado"', 422);
                }

                $obraDelAdicional = (string) $adicionalRetro['obra'];
                $detalleDelAdicional = (string) $adicionalRetro['detalle'];

                $stmtObraActual = $db->prepare('SELECT estatus FROM obras_aceptadas WHERE obra = ?');
                $stmtObraActual->execute([$obraDelAdicional]);
                $obraActual = $stmtObraActual->fetch();

                $seReabrio = false;
                if ($obraActual && $obraActual['estatus'] === 'Terminada') {
                    $db->prepare("UPDATE obras_aceptadas SET estatus = 'Activo', actualizado_en = datetime('now') WHERE obra = ?")
                        ->execute([$obraDelAdicional]);
                    $seReabrio = true;
                }

                $mensaje = $seReabrio
                    ? "Se reabre la obra (estaba \"Terminada\") por un adicional recién aceptado: \"{$detalleDelAdicional}\". El PDF firmado sube a Drive (1.Organización/Adicionales) en la próxima sincronización."
                    : "Adicional aceptado: \"{$detalleDelAdicional}\". El PDF firmado sube a Drive (1.Organización/Adicionales) en la próxima sincronización.";

                $db->prepare('INSERT INTO comentarios_obra (obra, autor_nombre, autor_email, mensaje) VALUES (?, ?, ?, ?)')
                    ->execute([$obraDelAdicional, 'Geraldinne', '', $mensaje]);

                Response::json(['ok' => true, 'se_reabrio' => $seReabrio, 'mensaje' => $mensaje]);
            }

            Response::error('Acción no reconocida', 422);
        }
    }

    $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
    AuthMiddleware::requiereAlgunPermiso($usuario, ['presupuestos.ver_todos', 'presupuestos.ver_seguimiento']);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $adicionales = $db->query("
            SELECT
                a.*,
                COALESCE(NULLIF(oa.cliente, ''), oa.contacto) AS obra_cliente
            FROM adicionales_obra a
            LEFT JOIN obras_aceptadas oa ON oa.obra = a.obra
            ORDER BY a.creado_en DESC
        ")->fetchAll();

        $ordenPorClave = [];
        foreach ($db->query("SELECT obra_base, orden FROM orden_agenda WHERE obra_base LIKE 'adicional:%'")->fetchAll() as $r) {
            $ordenPorClave[$r['obra_base']] = (int) $r['orden'];
        }
        foreach ($adicionales as &$a) {
            $a['orden_agenda'] = $ordenPorClave['adicional:' . $a['id']] ?? null;
            // El PDF completo no viaja en el listado (puede pesar) — solo si
            // hay uno cargado y si ya se mandó a Drive.
            $a['tiene_pdf'] = $a['pdf_base64'] !== null && $a['pdf_base64'] !== '';
            unset($a['pdf_base64']);
        }
        unset($a);

        $obrasDisponibles = $db->query("
            SELECT obra, COALESCE(NULLIF(cliente, ''), contacto) AS cliente
            FROM obras_aceptadas
            ORDER BY obra
        ")->fetchAll();

        Response::json(['adicionales' => $adicionales, 'obras_disponibles' => $obrasDisponibles]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        // Ya se leyó y decodificó más arriba (ver chequeo de SYNC_TOKEN) —
        // se reutiliza en vez de volver a leer php://input.
        $body = $bodyPost;

        $obra = trim((string) ($body['obra'] ?? ''));
        $detalle = trim((string) ($body['detalle'] ?? ''));
        $fechaSolicitud = trim((string) ($body['fecha_solicitud'] ?? ''));
        $solicitadoPor = trim((string) ($body['solicitado_por'] ?? ''));

        if ($obra === '' || $detalle === '') {
            Response::error('Faltan "obra" y/o "detalle"', 422);
        }
        if ($fechaSolicitud !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fechaSolicitud)) {
            Response::error('"fecha_solicitud" debe tener formato AAAA-MM-DD', 422);
        }

        $stmtObra = $db->prepare('SELECT COALESCE(NULLIF(cliente, \'\'), contacto) AS cliente FROM obras_aceptadas WHERE obra = ?');
        $stmtObra->execute([$obra]);
        $obraExistente = $stmtObra->fetch();
        if (!$obraExistente) {
            Response::error('"obra" no coincide con ninguna obra aceptada', 422);
        }

        $stmt = $db->prepare("
            INSERT INTO adicionales_obra
                (obra, fecha_solicitud, detalle, solicitado_por, creado_por_email, creado_por_nombre, creado_en, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ");
        $stmt->execute([
            $obra,
            $fechaSolicitud === '' ? null : $fechaSolicitud,
            $detalle,
            $solicitadoPor === '' ? null : $solicitadoPor,
            $usuario['email'] ?? null,
            $usuario['nombre'] ?? null,
        ]);

        $id = (int) $db->lastInsertId();
        $stmtNuevo = $db->prepare('SELECT * FROM adicionales_obra WHERE id = ?');
        $stmtNuevo->execute([$id]);
        $nuevo = $stmtNuevo->fetch();
        $nuevo['obra_cliente'] = $obraExistente['cliente'];
        $nuevo['tiene_pdf'] = false;
        unset($nuevo['pdf_base64']);

        Response::json(['ok' => true, 'adicional' => $nuevo]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            Response::error('Falta "id"', 422);
        }

        if (array_key_exists('estatus', $body)) {
            $tieneVerSeguimiento = in_array('presupuestos.ver_seguimiento', $usuario['permisos'] ?? [], true);
            $tieneGestionarPrioridad = in_array('presupuestos.gestionar_prioridad', $usuario['permisos'] ?? [], true);
            if (!$tieneVerSeguimiento && !$tieneGestionarPrioridad) {
                Response::error('No autorizado para esta acción', 403);
            }
            $estatus = trim((string) $body['estatus']);
            if (!in_array($estatus, ESTATUS_ADICIONAL_VALIDOS, true)) {
                Response::error('"estatus" debe ser una de: ' . implode(', ', ESTATUS_ADICIONAL_VALIDOS), 422);
            }

            $stmtActual = $db->prepare('SELECT obra, detalle, estatus, estatus_antes_de_alvarada FROM adicionales_obra WHERE id = ?');
            $stmtActual->execute([$id]);
            $actual = $stmtActual->fetch();
            if (!$actual) {
                Response::error('Adicional no encontrado', 404);
            }

            // Álvaro/Valentina (sin ver_seguimiento) solo puede marcar
            // "Alvarada" o deshacerla — ver comentario de cabecera.
            if (!$tieneVerSeguimiento) {
                $esMarcar = $estatus === 'Alvarada' && $actual['estatus'] !== 'Alvarada';
                $esDeshacer = $actual['estatus'] === 'Alvarada'
                    && $actual['estatus_antes_de_alvarada'] !== null
                    && $estatus === $actual['estatus_antes_de_alvarada'];
                if (!$esMarcar && !$esDeshacer) {
                    Response::error('Solo podés marcar o deshacer "Alvarada" — el resto del estatus lo maneja Geraldinne', 403);
                }
            }

            // Guarda el estatus anterior solo al ENTRAR a "Alvarada" (para
            // poder deshacerla después); cualquier otro cambio limpia ese
            // rastro, ya sea porque se deshizo o porque Geraldinne siguió
            // adelante con el trámite formal.
            $estatusAntesDeAlvarada = ($estatus === 'Alvarada' && $actual['estatus'] !== 'Alvarada') ? $actual['estatus'] : null;

            $db->prepare("UPDATE adicionales_obra SET estatus = ?, estatus_antes_de_alvarada = ?, actualizado_en = datetime('now') WHERE id = ?")
                ->execute([$estatus, $estatusAntesDeAlvarada, $id]);

            // A pedido de Álvaro (2026-09-24): en cuanto un adicional pasa a
            // "Aceptado" (recién ahí, no de nuevo si ya estaba Aceptado), se
            // le crea a Alfredo una nota/tarea automática en "Notas" de esa
            // obra — hasta ahora no se enteraba de ningún adicional (ni
            // tiene acceso a esta pestaña: pide presupuestos.ver_todos/
            // ver_seguimiento, permisos que su rol gestion_obras no tiene).
            // Si la obra ya estaba "Terminada" se reabre a "Activo" (un
            // adicional aceptado implica que sigue habiendo trabajo) y la
            // nota lo aclara. El PDF firmado en sí lo sube a Drive
            // enviar_adicionales_aceptados.js en la siguiente sincronización
            // — ya sube a la carpeta de ESA obra puntual
            // ("1.Organización/Adicionales" dentro de su propia carpeta, ver
            // ese script), no hace falta tocar nada ahí.
            if ($estatus === 'Aceptado' && $actual['estatus'] !== 'Aceptado') {
                $obraDelAdicional = (string) $actual['obra'];
                $detalleDelAdicional = (string) $actual['detalle'];

                $stmtObraActual = $db->prepare('SELECT estatus FROM obras_aceptadas WHERE obra = ?');
                $stmtObraActual->execute([$obraDelAdicional]);
                $obraActual = $stmtObraActual->fetch();

                $seReabrio = false;
                if ($obraActual && $obraActual['estatus'] === 'Terminada') {
                    $db->prepare("UPDATE obras_aceptadas SET estatus = 'Activo', actualizado_en = datetime('now') WHERE obra = ?")
                        ->execute([$obraDelAdicional]);
                    $seReabrio = true;
                }

                $mensaje = $seReabrio
                    ? "Se reabre la obra (estaba \"Terminada\") por un adicional recién aceptado: \"{$detalleDelAdicional}\". El PDF firmado sube a Drive (1.Organización/Adicionales) en la próxima sincronización."
                    : "Adicional aceptado: \"{$detalleDelAdicional}\". El PDF firmado sube a Drive (1.Organización/Adicionales) en la próxima sincronización.";

                $db->prepare('INSERT INTO comentarios_obra (obra, autor_nombre, autor_email, mensaje) VALUES (?, ?, ?, ?)')
                    ->execute([$obraDelAdicional, $usuario['nombre'] ?? 'Sistema', $usuario['email'] ?? '', $mensaje]);
            }
        }

        if (array_key_exists('prioridad', $body)) {
            AuthMiddleware::requierePermiso($usuario, 'presupuestos.gestionar_prioridad');
            $prioridad = trim((string) $body['prioridad']);
            if (!in_array($prioridad, PRIORIDAD_ADICIONAL_VALIDOS, true)) {
                Response::error('"prioridad" debe ser una de: ' . implode(', ', PRIORIDAD_ADICIONAL_VALIDOS), 422);
            }
            $db->prepare("UPDATE adicionales_obra SET prioridad = ?, actualizado_en = datetime('now') WHERE id = ?")
                ->execute([$prioridad, $id]);
        }

        if (array_key_exists('pdf_base64', $body)) {
            AuthMiddleware::requierePermiso($usuario, 'presupuestos.ver_seguimiento');
            $pdfBase64 = (string) $body['pdf_base64'];
            if ($pdfBase64 === '') {
                Response::error('Falta "pdf_base64"', 422);
            }
            $nombreOriginal = trim((string) ($body['pdf_nombre_original'] ?? ''));
            // Nueva subida vuelve a marcar el PDF como pendiente de enviar a
            // Drive, aunque ya se hubiera mandado uno antes (reemplazo).
            $db->prepare("
                UPDATE adicionales_obra SET
                    pdf_base64 = ?,
                    pdf_nombre_original = ?,
                    pdf_subido_por = ?,
                    pdf_subido_en = datetime('now'),
                    pdf_enviado_en = NULL,
                    actualizado_en = datetime('now')
                WHERE id = ?
            ")->execute([$pdfBase64, $nombreOriginal === '' ? null : $nombreOriginal, $usuario['nombre'] ?? null, $id]);
        }

        Response::json(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            Response::error('Falta "id"', 422);
        }
        $db->prepare('DELETE FROM adicionales_obra WHERE id = ?')->execute([$id]);
        Response::json(['ok' => true]);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
