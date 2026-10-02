<?php
declare(strict_types=1);

// Notas y fotos de medición sobre el plano de una obra aceptada — a pedido
// de Álvaro, 2026-10-02, para armar informes de medición:
//
// - NOTAS (medicion_notas): una chincheta en un punto del plano (página +
//   x_pct/y_pct, mismo sistema que las posiciones calibradas de planos.php)
//   con un texto ("pilar que reduce el hueco", "falta precerco"...) y sus
//   fotos. Se numeran por obra (N1, N2...) y el número no se reutiliza.
// - FOTOS (medicion_fotos): de una nota (ref_tipo "nota", ref = id) o de
//   una posición (ref_tipo "posicion", ref = posicion_base, la misma que
//   usa medidas_obra.php). Se guardan ya reducidas en el navegador: una
//   imagen de ~1600 px (archivo_base64) para el informe y una miniatura de
//   ~320 px (miniatura_base64) para mostrar en pantalla — el GET normal solo
//   trae miniaturas; ?fotos_completas=1 trae las grandes (para el PDF).
// - DRIVE (opcional): "Subir informe a Drive" genera el informe de medición
//   en PDF en el navegador y lo deja aquí pendiente (medicion_informes_drive,
//   uno por obra); backend/drive_sync/subir_informes_medicion.js lo sube a
//   "1.Mediciones de obras/Panel" en la próxima sincronización (mismo
//   criterio que el resto: el panel no tiene acceso directo a Drive). Solo
//   el informe: Álvaro no quiere las fotos sueltas en Drive.
//
// GET ?obra=...[&fotos_completas=1] : sesión + obras.ver_aceptadas.
// POST {accion:"agregar_nota", obra, pagina, x_pct, y_pct, texto, numero?}
// PATCH {accion:"actualizar_nota", id, texto?, pagina?, x_pct?, y_pct?}
// DELETE {accion:"eliminar_nota", id}: borra la nota y sus fotos.
// POST {accion:"agregar_foto", obra, ref_tipo, ref, archivo_base64,
//   miniatura_base64, tipo_mime?, nombre?}
// DELETE {accion:"eliminar_foto", id}
// POST {accion:"subir_informe_drive", obra, pdf_base64}: deja el informe
//   pendiente de subir (reemplaza uno anterior de la misma obra).
// Escrituras: sesión + obras.ver_aceptadas (Álvaro y Alfredo).
// POST (SYNC_TOKEN) {accion:"listar_informes_pendientes_drive"} /
//   {accion:"marcar_informe_subido", obra, solicitado_en}: para el script de
//   sincronización.

const LIMITE_FOTO_BYTES = 6_000_000;
const LIMITE_INFORME_BYTES = 60_000_000;

$config = require __DIR__ . '/../../backend/bootstrap.php';

function filaMedicion(PDO $db, string $tabla, int $id): ?array
{
    $stmt = $db->prepare("SELECT * FROM $tabla WHERE id = ?");
    $stmt->execute([$id]);
    return $stmt->fetch() ?: null;
}

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS medicion_notas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          numero INTEGER NOT NULL,
          pagina INTEGER NOT NULL,
          x_pct REAL NOT NULL,
          y_pct REAL NOT NULL,
          texto TEXT NOT NULL DEFAULT '',
          creado_por TEXT,
          creado_en TEXT NOT NULL DEFAULT (datetime('now')),
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS medicion_fotos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          ref_tipo TEXT NOT NULL,
          ref TEXT NOT NULL,
          archivo_base64 TEXT NOT NULL,
          miniatura_base64 TEXT,
          tipo_mime TEXT,
          nombre TEXT,
          subido_por TEXT,
          subido_en TEXT NOT NULL DEFAULT (datetime('now')),
          drive_estado TEXT,
          drive_subido_en TEXT
        )
    ");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_medicion_fotos_obra ON medicion_fotos(obra)');
    // El PDF se borra (pdf_base64 = NULL) una vez subido a Drive.
    $db->exec("
        CREATE TABLE IF NOT EXISTS medicion_informes_drive (
          obra TEXT PRIMARY KEY,
          pdf_base64 TEXT,
          solicitado_por TEXT,
          solicitado_en TEXT NOT NULL,
          drive_estado TEXT NOT NULL,
          drive_subido_en TEXT
        )
    ");

    // SYNC_TOKEN (sin sesión) — para el script que sube los informes a Drive.
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $bodyPost = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $token = $_GET['token'] ?? $bodyPost['token'] ?? '';
        if ($config['sync_token'] !== '' && hash_equals($config['sync_token'], (string) $token)) {
            $accionSync = (string) ($bodyPost['accion'] ?? '');
            if ($accionSync === 'listar_informes_pendientes_drive') {
                $informes = $db->query("
                    SELECT obra, pdf_base64, solicitado_en FROM medicion_informes_drive
                    WHERE drive_estado = 'pendiente' AND pdf_base64 IS NOT NULL
                    ORDER BY solicitado_en
                ")->fetchAll();
                Response::json(['informes' => $informes]);
            }
            if ($accionSync === 'marcar_informe_subido') {
                // Con solicitado_en: si mientras se subía alguien pidió otro
                // informe más nuevo, ese queda pendiente para la próxima vez.
                $db->prepare("
                    UPDATE medicion_informes_drive
                    SET drive_estado = 'subido', drive_subido_en = datetime('now'), pdf_base64 = NULL
                    WHERE obra = ? AND solicitado_en = ?
                ")->execute([(string) ($bodyPost['obra'] ?? ''), (string) ($bodyPost['solicitado_en'] ?? '')]);
                Response::json(['ok' => true]);
            }
            Response::error('Acción no reconocida', 422);
        }
    }

    $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
    AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');
    $autor = $usuario['nombre'] ?? null;

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $obra = trim((string) ($_GET['obra'] ?? ''));
        if ($obra === '') {
            Response::error('Falta "obra"', 422);
        }
        $stmtNotas = $db->prepare('SELECT * FROM medicion_notas WHERE obra = ? ORDER BY numero');
        $stmtNotas->execute([$obra]);
        $columnas = ($_GET['fotos_completas'] ?? '') === '1'
            ? 'id, ref_tipo, ref, archivo_base64, miniatura_base64, tipo_mime, nombre, subido_por, subido_en, drive_estado'
            : 'id, ref_tipo, ref, miniatura_base64, tipo_mime, nombre, subido_por, subido_en, drive_estado';
        $stmtFotos = $db->prepare("SELECT $columnas FROM medicion_fotos WHERE obra = ? ORDER BY id");
        $stmtFotos->execute([$obra]);
        $stmtInforme = $db->prepare('SELECT solicitado_por, solicitado_en, drive_estado, drive_subido_en FROM medicion_informes_drive WHERE obra = ?');
        $stmtInforme->execute([$obra]);
        Response::json([
            'notas' => $stmtNotas->fetchAll(),
            'fotos' => $stmtFotos->fetchAll(),
            'informe_drive' => $stmtInforme->fetch() ?: null,
        ]);
    }

    $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
    $accion = (string) ($body['accion'] ?? '');
    $metodo = $_SERVER['REQUEST_METHOD'];

    if ($metodo === 'POST' && $accion === 'agregar_nota') {
        $obra = trim((string) ($body['obra'] ?? ''));
        if ($obra === '' || !is_numeric($body['pagina'] ?? null) || !is_numeric($body['x_pct'] ?? null) || !is_numeric($body['y_pct'] ?? null)) {
            Response::error('Faltan "obra", "pagina", "x_pct" y/o "y_pct"', 422);
        }
        $stmtNum = $db->prepare('SELECT COALESCE(MAX(numero), 0) + 1 FROM medicion_notas WHERE obra = ?');
        $stmtNum->execute([$obra]);
        $numero = (int) $stmtNum->fetchColumn();
        // "numero" opcional: Deshacer (Ctrl+Z) vuelve a crear una nota
        // borrada con su número de antes, si sigue libre.
        if (is_numeric($body['numero'] ?? null) && (int) $body['numero'] > 0) {
            $stmtLibre = $db->prepare('SELECT COUNT(*) FROM medicion_notas WHERE obra = ? AND numero = ?');
            $stmtLibre->execute([$obra, (int) $body['numero']]);
            if ((int) $stmtLibre->fetchColumn() === 0) {
                $numero = (int) $body['numero'];
            }
        }
        $db->prepare('INSERT INTO medicion_notas (obra, numero, pagina, x_pct, y_pct, texto, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([$obra, $numero, (int) $body['pagina'], (float) $body['x_pct'], (float) $body['y_pct'], trim((string) ($body['texto'] ?? '')), $autor]);
        Response::json(['nota' => filaMedicion($db, 'medicion_notas', (int) $db->lastInsertId())]);
    }

    if ($metodo === 'PATCH' && $accion === 'actualizar_nota') {
        $id = (int) ($body['id'] ?? 0);
        $nota = filaMedicion($db, 'medicion_notas', $id);
        if (!$nota) {
            Response::error('Nota no encontrada', 404);
        }
        $texto = array_key_exists('texto', $body) ? trim((string) $body['texto']) : $nota['texto'];
        $pagina = is_numeric($body['pagina'] ?? null) ? (int) $body['pagina'] : (int) $nota['pagina'];
        $x = is_numeric($body['x_pct'] ?? null) ? (float) $body['x_pct'] : (float) $nota['x_pct'];
        $y = is_numeric($body['y_pct'] ?? null) ? (float) $body['y_pct'] : (float) $nota['y_pct'];
        $db->prepare("UPDATE medicion_notas SET texto = ?, pagina = ?, x_pct = ?, y_pct = ?, actualizado_en = datetime('now') WHERE id = ?")
            ->execute([$texto, $pagina, $x, $y, $id]);
        Response::json(['nota' => filaMedicion($db, 'medicion_notas', $id)]);
    }

    if ($metodo === 'DELETE' && $accion === 'eliminar_nota') {
        $id = (int) ($body['id'] ?? 0);
        $db->prepare("DELETE FROM medicion_fotos WHERE ref_tipo = 'nota' AND ref = ?")->execute([(string) $id]);
        $db->prepare('DELETE FROM medicion_notas WHERE id = ?')->execute([$id]);
        Response::json(['ok' => true]);
    }

    if ($metodo === 'POST' && $accion === 'agregar_foto') {
        $obra = trim((string) ($body['obra'] ?? ''));
        $refTipo = (string) ($body['ref_tipo'] ?? '');
        $ref = trim((string) ($body['ref'] ?? ''));
        $archivo = (string) ($body['archivo_base64'] ?? '');
        if ($obra === '' || !in_array($refTipo, ['nota', 'posicion'], true) || $ref === '' || $archivo === '') {
            Response::error('Faltan "obra", "ref_tipo" (nota|posicion), "ref" y/o "archivo_base64"', 422);
        }
        if (strlen($archivo) > LIMITE_FOTO_BYTES) {
            Response::error('La foto es demasiado grande', 413);
        }
        $db->prepare('INSERT INTO medicion_fotos (obra, ref_tipo, ref, archivo_base64, miniatura_base64, tipo_mime, nombre, subido_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$obra, $refTipo, $ref, $archivo, (string) ($body['miniatura_base64'] ?? '') ?: null, (string) ($body['tipo_mime'] ?? 'image/jpeg'), (string) ($body['nombre'] ?? '') ?: null, $autor]);
        $foto = filaMedicion($db, 'medicion_fotos', (int) $db->lastInsertId());
        unset($foto['archivo_base64']);
        Response::json(['foto' => $foto]);
    }

    if ($metodo === 'DELETE' && $accion === 'eliminar_foto') {
        $db->prepare('DELETE FROM medicion_fotos WHERE id = ?')->execute([(int) ($body['id'] ?? 0)]);
        Response::json(['ok' => true]);
    }

    if ($metodo === 'POST' && $accion === 'subir_informe_drive') {
        $obra = trim((string) ($body['obra'] ?? ''));
        $pdf = (string) ($body['pdf_base64'] ?? '');
        if ($obra === '' || $pdf === '') {
            Response::error('Faltan "obra" y/o "pdf_base64"', 422);
        }
        if (strlen($pdf) > LIMITE_INFORME_BYTES) {
            Response::error('El informe es demasiado grande para subirlo', 413);
        }
        $db->prepare("
            INSERT INTO medicion_informes_drive (obra, pdf_base64, solicitado_por, solicitado_en, drive_estado, drive_subido_en)
            VALUES (?, ?, ?, datetime('now'), 'pendiente', NULL)
            ON CONFLICT(obra) DO UPDATE SET pdf_base64 = excluded.pdf_base64, solicitado_por = excluded.solicitado_por,
              solicitado_en = excluded.solicitado_en, drive_estado = 'pendiente', drive_subido_en = NULL
        ")->execute([$obra, $pdf, $autor]);
        $stmt = $db->prepare('SELECT solicitado_por, solicitado_en, drive_estado, drive_subido_en FROM medicion_informes_drive WHERE obra = ?');
        $stmt->execute([$obra]);
        Response::json(['informe_drive' => $stmt->fetch()]);
    }

    Response::error('Acción no reconocida', 422);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
