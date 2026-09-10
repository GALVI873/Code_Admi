<?php
declare(strict_types=1);

// Medidas confirmadas en obra — a pedido de Álvaro: la Ficha/Excel trae la
// medida de PROYECTO (lo que dice el plano), pero al medir en obra puede
// salir distinto. Se guarda por POSICIÓN completa (no por línea de material
// como Estado/Comentario en seguimiento_materiales_overrides — una misma
// posición tiene varias filas de material, Carpintería/Vidrio/Persiana, pero
// una sola medida real de ancho/alto), en su propia tabla para no mezclar
// con esa otra.
//
// "Dibujo del tipo": el recorte de la memoria de carpintería (uno por Tipo,
// ej. V1..V21) que se muestra en el panel al hacer clic en una posición del
// plano — hoy solo cargado a mano para José Abascal (cada memoria de
// carpintería viene con un diseño de plancha distinto según el arquitecto,
// no hay forma automática de extraerlo para cualquier obra nueva), ver
// backend/drive_sync/subir_dibujos_tipo.js.
//
// "Enviar medidas" (a pedido de Álvaro): botón en el panel que pide que las
// medidas confirmadas de una obra se manden al taller — NO sube el Excel al
// toque (el panel no tiene acceso directo a Drive), solo deja el pedido
// anotado en medidas_envio_taller. El envío real (armar el .xlsx y subirlo a
// la carpeta "medición" de esa obra en Drive) lo hace
// backend/drive_sync/enviar_medidas_taller.js en la próxima sincronización
// (mismo criterio que el resto de Drive: automático, corrido por cron, no al
// instante del clic).
//
// "Dibujar sobre la posición" (a pedido de Álvaro, con el lápiz de la
// tablet): a veces la forma real de una ventana cambia respecto al dibujo
// de tipo — puede dibujar encima (lápiz + borrador) para corregirlo. Es por
// POSICIÓN (no pisa el dibujo del tipo, que es compartido por todas las
// posiciones de ese mismo tipo) — el trazo se aplana junto con la imagen de
// base en el propio navegador y se guarda como una imagen nueva en
// medidas_dibujo_obra; borrar el dibujo (limpiar) vuelve a mostrar el del
// tipo. También se manda embebido en el Excel del taller.
//
// GET ?obra=... : requiere sesión + obras.ver_aceptadas. Devuelve las
// medidas confirmadas de esa obra, los dibujos por tipo disponibles, los
// dibujos corregidos por posición, y el estado del último pedido de envío
// (si hay uno).
// PATCH {obra, posicion, ancho_real, alto_real, comentario}: requiere sesión
// + rol admin (solo Álvaro confirma medidas en obra, por ahora).
// PATCH {obra, posicion, guardar_dibujo_posicion:true, imagen_base64}:
// requiere sesión + rol admin — guarda el dibujo corregido de esa posición;
// imagen_base64 vacío borra la corrección (vuelve a mostrarse el del tipo).
// PATCH {obra, solicitar_envio:true}: requiere sesión + obras.ver_aceptadas
// (Álvaro o Alfredo) — anota el pedido de envío; si ya se había mandado
// antes, volver a pedirlo lo marca de nuevo como pendiente (para mandar una
// versión actualizada).
// POST (SYNC_TOKEN) {accion:"guardar_dibujo_tipo", obra, tipo, imagen_base64}:
// carga/actualiza el dibujo de un tipo — usado por el script de carga única,
// no por el panel.
// POST (SYNC_TOKEN) {accion:"listar_pendientes_envio"}: obras con un pedido
// de envío todavía no procesado.
// POST (SYNC_TOKEN) {accion:"listar_medidas_para_envio", obra}: medidas
// confirmadas de esa obra con su Tipo (cruzado con seguimiento_materiales) y
// el dibujo a usar (el corregido por posición si existe, si no el del tipo),
// para armar el Excel con la imagen embebida.
// POST (SYNC_TOKEN) {accion:"marcar_envio_hecho", obra}: marca el pedido
// como procesado — usado por enviar_medidas_taller.js al terminar.

$config = require __DIR__ . '/../../backend/bootstrap.php';

function tieneRolMedidas(array $usuario, string $rol): bool
{
    return in_array($rol, $usuario['roles'] ?? [], true);
}

// El Tipo real de la obra suele venir con cero de relleno ("V01", "V09"),
// pero plano_dibujo_tipo se carga con el código tal cual lo escribe la
// propia plancha de la memoria ("V1", "V9", ver subir_dibujos_tipo.js) —
// mismo criterio que normalizarTipoDibujo() en ObrasAceptadasPage.jsx (el
// panel ya lo resuelve bien al mostrar el dibujo en pantalla; acá hacía
// falta lo mismo para que el Excel del taller también lo encuentre).
function normalizarTipoDibujo(?string $tipo): ?string
{
    if ($tipo === null || $tipo === '') {
        return $tipo;
    }
    if (preg_match('/^V0*(\d+)$/i', trim($tipo), $m)) {
        return 'V' . $m[1];
    }
    return $tipo;
}

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS medidas_confirmadas_obra (
          obra TEXT NOT NULL,
          posicion TEXT NOT NULL,
          ancho_real REAL,
          alto_real REAL,
          comentario TEXT,
          confirmado_por TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (obra, posicion)
        )
    ");
    $columnasMedidas = array_column($db->query('PRAGMA table_info(medidas_confirmadas_obra)')->fetchAll(), 'name');
    if (!in_array('comentario', $columnasMedidas, true)) {
        $db->exec('ALTER TABLE medidas_confirmadas_obra ADD COLUMN comentario TEXT');
    }
    $db->exec("
        CREATE TABLE IF NOT EXISTS plano_dibujo_tipo (
          obra TEXT NOT NULL,
          tipo TEXT NOT NULL,
          imagen_base64 TEXT NOT NULL,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (obra, tipo)
        )
    ");
    // Ya la crea seguimiento_materiales.php con más columnas — esto es solo
    // para que el JOIN de "listar_medidas_para_envio" no falle si este
    // endpoint corriera antes que ese alguna vez (no debería pasar en la
    // práctica, mismo criterio del resto del proyecto).
    $db->exec("
        CREATE TABLE IF NOT EXISTS seguimiento_materiales (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          posicion TEXT,
          tipo TEXT
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS medidas_dibujo_obra (
          obra TEXT NOT NULL,
          posicion TEXT NOT NULL,
          imagen_base64 TEXT NOT NULL,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (obra, posicion)
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS medidas_envio_taller (
          obra TEXT PRIMARY KEY,
          solicitado_por TEXT,
          solicitado_en TEXT,
          enviado_en TEXT
        )
    ");

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $obra = trim((string) ($_GET['obra'] ?? ''));
        if ($obra === '') {
            Response::error('Falta "obra"', 422);
        }

        $stmtMedidas = $db->prepare('SELECT posicion, ancho_real, alto_real, comentario, confirmado_por, actualizado_en FROM medidas_confirmadas_obra WHERE obra = ?');
        $stmtMedidas->execute([$obra]);
        $medidas = $stmtMedidas->fetchAll();

        $stmtDibujos = $db->prepare('SELECT tipo, imagen_base64 FROM plano_dibujo_tipo WHERE obra = ?');
        $stmtDibujos->execute([$obra]);
        $dibujos = [];
        foreach ($stmtDibujos->fetchAll() as $d) {
            $dibujos[$d['tipo']] = $d['imagen_base64'];
        }

        $stmtDibujosPos = $db->prepare('SELECT posicion, imagen_base64 FROM medidas_dibujo_obra WHERE obra = ?');
        $stmtDibujosPos->execute([$obra]);
        $dibujosPosicion = [];
        foreach ($stmtDibujosPos->fetchAll() as $d) {
            $dibujosPosicion[$d['posicion']] = $d['imagen_base64'];
        }

        $stmtEnvio = $db->prepare('SELECT solicitado_por, solicitado_en, enviado_en FROM medidas_envio_taller WHERE obra = ?');
        $stmtEnvio->execute([$obra]);
        $envio = $stmtEnvio->fetch() ?: null;

        Response::json(['medidas' => $medidas, 'dibujos' => $dibujos, 'dibujos_posicion' => $dibujosPosicion, 'envio' => $envio]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $obra = trim((string) ($body['obra'] ?? ''));

        // "Enviar medidas" — cualquiera con acceso a la obra puede pedirlo
        // (no hace falta ser admin, es solo un pedido, no cambia ninguna
        // medida). El envío real lo hace enviar_medidas_taller.js más tarde.
        if (($body['solicitar_envio'] ?? false) === true) {
            AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');
            if ($obra === '') {
                Response::error('Falta "obra"', 422);
            }
            $db->prepare("
                INSERT INTO medidas_envio_taller (obra, solicitado_por, solicitado_en, enviado_en)
                VALUES (?, ?, datetime('now'), NULL)
                ON CONFLICT(obra) DO UPDATE SET
                    solicitado_por = excluded.solicitado_por,
                    solicitado_en = datetime('now'),
                    enviado_en = NULL
            ")->execute([$obra, $usuario['nombre']]);
            Response::json(['ok' => true]);
        }

        if (!tieneRolMedidas($usuario, 'admin')) {
            Response::error('Solo Álvaro puede confirmar medidas de obra por ahora', 403);
        }

        // Dibujo corregido a mano sobre la posición — ver comentario de
        // cabecera. imagen_base64 vacío borra la corrección (se vuelve a
        // mostrar el dibujo del tipo).
        if (($body['guardar_dibujo_posicion'] ?? false) === true) {
            $posicion = trim((string) ($body['posicion'] ?? ''));
            if ($obra === '' || $posicion === '') {
                Response::error('Faltan "obra" y/o "posicion"', 422);
            }
            $imagen = (string) ($body['imagen_base64'] ?? '');
            if ($imagen === '') {
                $db->prepare('DELETE FROM medidas_dibujo_obra WHERE obra = ? AND posicion = ?')->execute([$obra, $posicion]);
            } else {
                $db->prepare("
                    INSERT INTO medidas_dibujo_obra (obra, posicion, imagen_base64, actualizado_en)
                    VALUES (?, ?, ?, datetime('now'))
                    ON CONFLICT(obra, posicion) DO UPDATE SET imagen_base64 = excluded.imagen_base64, actualizado_en = datetime('now')
                ")->execute([$obra, $posicion, $imagen]);
            }
            Response::json(['ok' => true]);
        }

        $posicion = trim((string) ($body['posicion'] ?? ''));
        if ($obra === '' || $posicion === '') {
            Response::error('Faltan "obra" y/o "posicion"', 422);
        }
        $anchoReal = array_key_exists('ancho_real', $body) && $body['ancho_real'] !== '' ? (float) $body['ancho_real'] : null;
        $altoReal = array_key_exists('alto_real', $body) && $body['alto_real'] !== '' ? (float) $body['alto_real'] : null;
        $comentario = trim((string) ($body['comentario'] ?? ''));
        $comentarioGuardado = $comentario === '' ? null : $comentario;

        $db->prepare("
            INSERT INTO medidas_confirmadas_obra (obra, posicion, ancho_real, alto_real, comentario, confirmado_por, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(obra, posicion) DO UPDATE SET
                ancho_real = excluded.ancho_real,
                alto_real = excluded.alto_real,
                comentario = excluded.comentario,
                confirmado_por = excluded.confirmado_por,
                actualizado_en = datetime('now')
        ")->execute([$obra, $posicion, $anchoReal, $altoReal, $comentarioGuardado, $usuario['nombre']]);

        Response::json(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_GET['token'] ?? $_POST['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? $_POST;

        if (($body['accion'] ?? '') === 'guardar_dibujo_tipo') {
            $obra = trim((string) ($body['obra'] ?? ''));
            $tipo = trim((string) ($body['tipo'] ?? ''));
            $imagen = (string) ($body['imagen_base64'] ?? '');
            if ($obra === '' || $tipo === '' || $imagen === '') {
                Response::error('Faltan "obra", "tipo" y/o "imagen_base64"', 422);
            }
            $db->prepare("
                INSERT INTO plano_dibujo_tipo (obra, tipo, imagen_base64, actualizado_en)
                VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(obra, tipo) DO UPDATE SET imagen_base64 = excluded.imagen_base64, actualizado_en = datetime('now')
            ")->execute([$obra, $tipo, $imagen]);
            Response::json(['ok' => true]);
        }

        if (($body['accion'] ?? '') === 'listar_pendientes_envio') {
            $pendientes = $db->query("SELECT obra, solicitado_por, solicitado_en FROM medidas_envio_taller WHERE enviado_en IS NULL")->fetchAll();
            Response::json(['pendientes' => $pendientes]);
        }

        if (($body['accion'] ?? '') === 'listar_medidas_para_envio') {
            $obra = trim((string) ($body['obra'] ?? ''));
            if ($obra === '') {
                Response::error('Falta "obra"', 422);
            }
            // Tipo no vive en esta tabla (ver comentario de cabecera) — se
            // cruza con seguimiento_materiales por posición, tomando un tipo
            // cualquiera de esa posición (todas sus filas de material
            // comparten el mismo Tipo).
            $stmt = $db->prepare("
                SELECT
                    m.posicion,
                    (SELECT sm.tipo FROM seguimiento_materiales sm WHERE sm.obra = m.obra AND sm.posicion = m.posicion AND sm.tipo IS NOT NULL LIMIT 1) AS tipo,
                    m.ancho_real, m.alto_real, m.comentario, m.confirmado_por, m.actualizado_en
                FROM medidas_confirmadas_obra m
                WHERE m.obra = ?
            ");
            $stmt->execute([$obra]);
            $medidas = $stmt->fetchAll();

            $stmtDibujosPos = $db->prepare('SELECT posicion, imagen_base64 FROM medidas_dibujo_obra WHERE obra = ?');
            $stmtDibujosPos->execute([$obra]);
            $dibujosPorPosicion = [];
            foreach ($stmtDibujosPos->fetchAll() as $d) {
                $dibujosPorPosicion[$d['posicion']] = $d['imagen_base64'];
            }
            $stmtDibujosTipo = $db->prepare('SELECT tipo, imagen_base64 FROM plano_dibujo_tipo WHERE obra = ?');
            $stmtDibujosTipo->execute([$obra]);
            $dibujosPorTipo = [];
            foreach ($stmtDibujosTipo->fetchAll() as $d) {
                $dibujosPorTipo[normalizarTipoDibujo($d['tipo'])] = $d['imagen_base64'];
            }

            // El dibujo corregido a mano (ver "Dibujar sobre la posición" en
            // el comentario de cabecera) pisa al del tipo — es el que mejor
            // refleja la forma real de esa ventana puntual.
            foreach ($medidas as &$m) {
                $m['dibujo_base64'] = $dibujosPorPosicion[$m['posicion']] ?? ($dibujosPorTipo[normalizarTipoDibujo($m['tipo'])] ?? null);
            }
            unset($m);

            Response::json(['medidas' => $medidas]);
        }

        if (($body['accion'] ?? '') === 'marcar_envio_hecho') {
            $obra = trim((string) ($body['obra'] ?? ''));
            if ($obra === '') {
                Response::error('Falta "obra"', 422);
            }
            $db->prepare("UPDATE medidas_envio_taller SET enviado_en = datetime('now') WHERE obra = ?")->execute([$obra]);
            Response::json(['ok' => true]);
        }

        // TEMPORAL — limpia las medidas/dibujos/pedido de envío de prueba de
        // una obra, sin tocar plano_dibujo_tipo (esos 21 dibujos sí son
        // reales). Se saca apenas se use.
        if (($body['accion'] ?? '') === 'debug_limpiar_obra') {
            $obra = trim((string) ($body['obra'] ?? ''));
            if ($obra === '') {
                Response::error('Falta "obra"', 422);
            }
            $borradasMedidas = $db->prepare('DELETE FROM medidas_confirmadas_obra WHERE obra = ?');
            $borradasMedidas->execute([$obra]);
            $borradasDibujos = $db->prepare('DELETE FROM medidas_dibujo_obra WHERE obra = ?');
            $borradasDibujos->execute([$obra]);
            $borradoEnvio = $db->prepare('DELETE FROM medidas_envio_taller WHERE obra = ?');
            $borradoEnvio->execute([$obra]);
            Response::json([
                'ok' => true,
                'medidas_borradas' => $borradasMedidas->rowCount(),
                'dibujos_posicion_borrados' => $borradasDibujos->rowCount(),
                'envio_borrado' => $borradoEnvio->rowCount(),
            ]);
        }

        Response::error('Acción no reconocida', 422);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
