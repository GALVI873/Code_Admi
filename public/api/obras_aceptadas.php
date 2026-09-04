<?php
declare(strict_types=1);

// Lista de obras en "SEGUIMIENTO DE OBRAS (Aceptadas)" para el espacio de
// trabajo de Alfredo (Gestión de Obras) — ver
// backend/drive_sync/sync_obras_aceptadas.js.
//
// Independiente de presupuestos_en_estudio a propósito: se confirmó que esa
// tabla NO sigue a la obra una vez que Geraldinne la mueve fuera de "en
// estudio" — esta es su propia fuente de verdad, leída directo del Excel de
// cálculo que vive en la carpeta de la obra ya aceptada.
//
// El Excel trae, en la hoja "Ficha", dos columnas: "PRESUPUESTO" (el dato
// original, columna B — lo que guarda obras_aceptadas) y "CONFIRMACIÓN"
// (columna C, vacía siempre — nadie la usa desde Excel). Alfredo confirma o
// corrige cada campo desde el panel; cada confirmación es su propia fila en
// obra_aceptada_confirmaciones (no una columna más en obras_aceptadas,
// porque son datos de origen distinto: uno lo trae la sincronización con
// Drive, el otro lo decide una persona) y
// backend/drive_sync/escribir_confirmaciones_aceptadas.js las escribe de
// vuelta en la columna "Confirmación" del Excel real.
//
// Cada obra trae además "tiene_mensajes_sin_leer" (bool), calculado igual
// que en presupuestos_en_estudio.php contra comentarios_obra/
// comentarios_obra_leido (el mismo hilo de mensajes entre Álvaro/Geraldinne/
// Alfredo — ver comentarios_obra.php) — alimenta la pestaña "Notas" del
// detalle de obra y la insignia de "sin leer" en la tarjeta.
//
// GET: lista obras + confirmaciones (requiere sesión + obras.ver_aceptadas).
// PATCH: {obra, campo, valor} — Alfredo confirma/corrige un campo puntual de
// una obra (requiere sesión + obras.ver_aceptadas). "campo" tiene que ser
// uno de los confirmables (ver CAMPOS_CONFIRMABLES); cualquier otro se
// rechaza. Con {obra, campo, eliminar:true} se deshace la confirmación
// (vuelve el campo a sin confirmar, por si se tocó ✓ sin querer).
// POST: {accion:"listar"} lectura administrativa para el script de
// escritura (protegido por SYNC_TOKEN, sin sesión). Upsert de una obra
// puntual, usado por la sincronización con Drive (mismo token).
// Reconciliación: {accion:"reconciliar", obras:[...]} borra las que ya no
// están en el recorrido (la obra pudo pasar a facturación/cierre y salir de
// la carpeta) — incluidas sus confirmaciones.

$config = require __DIR__ . '/../../backend/bootstrap.php';

const CAMPOS_CONFIRMABLES = [
    'proveedor', 'color_carpinteria', 'correderas', 'abatibles', 'vidrio',
    'ral', 'persiana', 'color_persiana', 'modelo_lamas', 'motor_radio', 'motor_mecanico',
];

// Mismo hilo de comentarios que usa Presupuestos en Estudio
// (comentarios_obra.php) — acá alimenta la pestaña "Notas" del detalle de
// obra aceptada. Se identifica por nombre BASE de la obra por consistencia
// con el resto (una obra aceptada normalmente no trae sufijo "— Opción
// A/B", pero si arrastra el mismo nombre que tenía en estudio, la
// conversación sigue siendo la misma).
function nombreBaseObra(string $obra): string
{
    return trim((string) preg_replace('/\s*—\s*Opci[oó]n\s+\w+\s*$/iu', '', $obra));
}

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS obras_aceptadas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL UNIQUE,
          categoria TEXT,
          contacto TEXT,
          cliente TEXT,
          no_ventanas INTEGER,
          numero_ppto TEXT,
          fecha_ppto TEXT,
          proveedor TEXT,
          color_carpinteria TEXT,
          correderas TEXT,
          abatibles TEXT,
          vidrio TEXT,
          ral TEXT,
          persiana TEXT,
          color_persiana TEXT,
          modelo_lamas TEXT,
          motor_radio TEXT,
          motor_mecanico TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    // Migraciones idempotentes: la tabla original (primera versión de esta
    // página) solo tenía carpinteria/ral/persiana/vidrio/proveedor y un
    // confirmado_en a nivel de obra — se suman las columnas nuevas sin
    // tocar filas existentes. carpinteria/confirmado_en quedan sin usar
    // (no se borran, esa columna nunca se elimina en SQLite sin recrear la
    // tabla) pero ya no las lee ni las escribe nada.
    $columnas = array_column($db->query('PRAGMA table_info(obras_aceptadas)')->fetchAll(), 'name');
    foreach (['fecha_ppto', 'color_carpinteria', 'correderas', 'abatibles', 'color_persiana', 'modelo_lamas', 'motor_radio', 'motor_mecanico'] as $columna) {
        if (!in_array($columna, $columnas, true)) {
            $db->exec("ALTER TABLE obras_aceptadas ADD COLUMN $columna TEXT");
        }
    }

    $db->exec("
        CREATE TABLE IF NOT EXISTS obra_aceptada_confirmaciones (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          campo TEXT NOT NULL,
          valor TEXT,
          confirmado_en TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(obra, campo)
        )
    ");

    // Definidas también acá (no solo en comentarios_obra.php) porque el GET
    // de abajo necesita leerlas para marcar qué obras tienen mensajes sin
    // leer — mismo criterio del resto del proyecto: cada archivo asegura las
    // tablas que toca, sin depender de qué endpoint las creó primero.
    $db->exec("
        CREATE TABLE IF NOT EXISTS comentarios_obra (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          autor_nombre TEXT NOT NULL,
          autor_email TEXT NOT NULL,
          mensaje TEXT NOT NULL,
          creado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS comentarios_obra_leido (
          obra TEXT NOT NULL,
          usuario_email TEXT NOT NULL,
          ultima_lectura TEXT NOT NULL,
          PRIMARY KEY (obra, usuario_email)
        )
    ");

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $obras = $db->query('SELECT * FROM obras_aceptadas ORDER BY obra')->fetchAll();
        $confirmaciones = $db->query('SELECT * FROM obra_aceptada_confirmaciones')->fetchAll();

        // Insignia de "hay mensajes sin leer" por obra — mismo criterio que
        // presupuestos_en_estudio.php: último mensaje de la conversación
        // contra la última vez que ESTE usuario la abrió.
        $ultimoMensajePorObra = [];
        foreach ($db->query('SELECT obra, MAX(creado_en) AS ultimo FROM comentarios_obra GROUP BY obra')->fetchAll() as $r) {
            $ultimoMensajePorObra[$r['obra']] = $r['ultimo'];
        }
        $lecturaPorObra = [];
        $stmtLectura = $db->prepare('SELECT obra, ultima_lectura FROM comentarios_obra_leido WHERE usuario_email = ?');
        $stmtLectura->execute([$usuario['email']]);
        foreach ($stmtLectura->fetchAll() as $r) {
            $lecturaPorObra[$r['obra']] = $r['ultima_lectura'];
        }
        foreach ($obras as &$o) {
            $base = nombreBaseObra($o['obra']);
            $ultimo = $ultimoMensajePorObra[$base] ?? null;
            $leido = $lecturaPorObra[$base] ?? null;
            // "tiene_mensajes" (con o sin leer) alimenta el filtro rápido de
            // la lista ("obras con Notas"); "tiene_mensajes_sin_leer" sigue
            // siendo la insignia/punto rojo de notificación.
            $o['tiene_mensajes'] = $ultimo !== null;
            $o['tiene_mensajes_sin_leer'] = $ultimo !== null && ($leido === null || $ultimo > $leido);
        }
        unset($o);

        Response::json(['obras' => $obras, 'confirmaciones' => $confirmaciones]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $obra = trim((string) ($body['obra'] ?? ''));
        $campo = trim((string) ($body['campo'] ?? ''));
        if ($obra === '' || $campo === '') {
            Response::error('Faltan "obra" y/o "campo"', 422);
        }
        if (!in_array($campo, CAMPOS_CONFIRMABLES, true)) {
            Response::error('"campo" debe ser uno de: ' . implode(', ', CAMPOS_CONFIRMABLES), 422);
        }

        // Deshacer una confirmación (por si se tocó ✓ sin querer): vuelve el
        // campo a su estado sin confirmar, no deja un valor vacío guardado.
        if ($body['eliminar'] ?? false) {
            $db->prepare('DELETE FROM obra_aceptada_confirmaciones WHERE obra = ? AND campo = ?')
                ->execute([$obra, $campo]);
            Response::json(['ok' => true]);
        }

        $valor = trim((string) ($body['valor'] ?? ''));

        $db->prepare("
            INSERT INTO obra_aceptada_confirmaciones (obra, campo, valor, confirmado_en)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(obra, campo) DO UPDATE SET
                valor = excluded.valor,
                confirmado_en = datetime('now')
        ")->execute([$obra, $campo, $valor === '' ? null : $valor]);

        Response::json(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_GET['token'] ?? $_POST['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? $_POST;

        if (($body['accion'] ?? '') === 'listar') {
            $obras = $db->query('SELECT * FROM obras_aceptadas')->fetchAll();
            $confirmaciones = $db->query('SELECT * FROM obra_aceptada_confirmaciones')->fetchAll();
            Response::json(['obras' => $obras, 'confirmaciones' => $confirmaciones]);
        }

        if (($body['accion'] ?? '') === 'reconciliar') {
            $obras = $body['obras'] ?? null;
            if (!is_array($obras)) {
                Response::error('Falta "obras" (array)', 422);
            }
            if (count($obras) === 0) {
                Response::json(['ok' => true, 'eliminadas' => 0]);
            }
            $marcadores = implode(',', array_fill(0, count($obras), '?'));
            $stmt = $db->prepare("DELETE FROM obras_aceptadas WHERE obra NOT IN ($marcadores)");
            $stmt->execute($obras);
            $db->prepare("DELETE FROM obra_aceptada_confirmaciones WHERE obra NOT IN ($marcadores)")->execute($obras);
            Response::json(['ok' => true, 'eliminadas' => $stmt->rowCount()]);
        }

        $obra = trim((string) ($body['obra'] ?? ''));
        if ($obra === '') {
            Response::error('Falta "obra"', 422);
        }

        // Todos los campos se actualizan siempre con lo último que traiga
        // Drive — a diferencia de otras tablas del panel, acá no hace falta
        // proteger nada del lado del UPSERT: lo que Alfredo confirma vive
        // en obra_aceptada_confirmaciones, una tabla aparte que esta
        // sincronización ni toca.
        $stmt = $db->prepare("
            INSERT INTO obras_aceptadas
                (obra, categoria, contacto, cliente, no_ventanas, numero_ppto, fecha_ppto, proveedor, color_carpinteria, correderas, abatibles, vidrio, ral, persiana, color_persiana, modelo_lamas, motor_radio, motor_mecanico, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(obra) DO UPDATE SET
                categoria = excluded.categoria,
                contacto = excluded.contacto,
                cliente = excluded.cliente,
                no_ventanas = excluded.no_ventanas,
                numero_ppto = excluded.numero_ppto,
                fecha_ppto = excluded.fecha_ppto,
                proveedor = excluded.proveedor,
                color_carpinteria = excluded.color_carpinteria,
                correderas = excluded.correderas,
                abatibles = excluded.abatibles,
                vidrio = excluded.vidrio,
                ral = excluded.ral,
                persiana = excluded.persiana,
                color_persiana = excluded.color_persiana,
                modelo_lamas = excluded.modelo_lamas,
                motor_radio = excluded.motor_radio,
                motor_mecanico = excluded.motor_mecanico,
                actualizado_en = datetime('now')
        ");
        $stmt->execute([
            $obra,
            $body['categoria'] ?? null,
            $body['contacto'] ?? null,
            $body['cliente'] ?? null,
            $body['no_ventanas'] ?? null,
            $body['numero_ppto'] ?? null,
            $body['fecha_ppto'] ?? null,
            $body['proveedor'] ?? null,
            $body['color_carpinteria'] ?? null,
            $body['correderas'] ?? null,
            $body['abatibles'] ?? null,
            $body['vidrio'] ?? null,
            $body['ral'] ?? null,
            $body['persiana'] ?? null,
            $body['color_persiana'] ?? null,
            $body['modelo_lamas'] ?? null,
            $body['motor_radio'] ?? null,
            $body['motor_mecanico'] ?? null,
        ]);

        Response::json(['ok' => true]);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
