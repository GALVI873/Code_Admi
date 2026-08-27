<?php
declare(strict_types=1);

// Uso (por SSH en el hosting): php asignar_rol.php email@galvi.es rol
// Para un usuario que ya existe (login funciona) pero le falta el rol —
// a diferencia de crear_usuario.php, este no crea la cuenta ni toca la
// contraseña, solo agrega el rol si todavía no lo tiene.

$config = require __DIR__ . '/../bootstrap.php';

[, $email, $rolNombre] = $argv + [null, null, null];
if (!$email || !$rolNombre) {
    fwrite(STDERR, "Uso: php asignar_rol.php email@galvi.es rol\n");
    exit(1);
}

$db = Database::connection($config);

$stmt = $db->prepare('SELECT id FROM usuarios WHERE email = ?');
$stmt->execute([$email]);
$usuario = $stmt->fetch();
if (!$usuario) {
    fwrite(STDERR, "Usuario '$email' no existe — usá crear_usuario.php para darlo de alta.\n");
    exit(1);
}

$stmt = $db->prepare('SELECT id FROM roles WHERE nombre = ?');
$stmt->execute([$rolNombre]);
$rol = $stmt->fetch();
if (!$rol) {
    fwrite(STDERR, "Rol '$rolNombre' no existe.\n");
    exit(1);
}

$db->prepare('INSERT OR IGNORE INTO usuario_roles (usuario_id, rol_id) VALUES (?, ?)')
    ->execute([(int) $usuario['id'], (int) $rol['id']]);

fwrite(STDOUT, "Rol '$rolNombre' asignado a '$email'.\n");
