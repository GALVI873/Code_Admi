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
// GET ?obra=... : requiere sesión + obras.ver_aceptadas. Devuelve las
// medidas confirmadas de esa obra y los dibujos por tipo disponibles.
// PATCH {obra, posicion, ancho_real, alto_real}: requiere sesión + rol admin
// (solo Álvaro confirma medidas en obra, por ahora).
// POST (SYNC_TOKEN) {accion:"guardar_dibujo_tipo", obra, tipo, imagen_base64}:
// carga/actualiza el dibujo de un tipo — usado por el script de carga única,
// no por el panel.

$config = require __DIR__ . '/../../backend/bootstrap.php';

function tieneRolMedidas(array $usuario, string $rol): bool
{
    return in_array($rol, $usuario['roles'] ?? [], true);
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

        Response::json(['medidas' => $medidas, 'dibujos' => $dibujos]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        if (!tieneRolMedidas($usuario, 'admin')) {
            Response::error('Solo Álvaro puede confirmar medidas de obra por ahora', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $obra = trim((string) ($body['obra'] ?? ''));
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

        Response::error('Acción no reconocida', 422);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
