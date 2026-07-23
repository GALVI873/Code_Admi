<?php
declare(strict_types=1);

// Uso (por SSH en el hosting): php crear_usuario.php "Nombre Apellido" email@galvi.es rol
// Pide la contraseña por STDIN para no dejarla en el historial de la shell.

$config = require __DIR__ . '/../bootstrap.php';

[, $nombre, $email, $rolNombre] = $argv + [null, null, null, null];
if (!$nombre || !$email || !$rolNombre) {
    fwrite(STDERR, "Uso: php crear_usuario.php \"Nombre\" email@galvi.es rol\n");
    exit(1);
}

fwrite(STDOUT, 'Contraseña: ');
system('stty -echo');
$password = trim((string) fgets(STDIN));
system('stty echo');
fwrite(STDOUT, "\n");

$db = Database::connection($config);

$stmt = $db->prepare('SELECT id FROM roles WHERE nombre = ?');
$stmt->execute([$rolNombre]);
$rol = $stmt->fetch();
if (!$rol) {
    fwrite(STDERR, "Rol '$rolNombre' no existe.\n");
    exit(1);
}

$db->beginTransaction();
$stmt = $db->prepare('INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)');
$stmt->execute([$nombre, $email, password_hash($password, PASSWORD_BCRYPT)]);
$usuarioId = (int) $db->lastInsertId();

$db->prepare('INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (?, ?)')
    ->execute([$usuarioId, $rol['id']]);
$db->commit();

fwrite(STDOUT, "Usuario #$usuarioId creado con rol '$rolNombre'.\n");
