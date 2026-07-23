<?php
declare(strict_types=1);

return [
    'db' => [
        'host' => getenv('DB_HOST') ?: '127.0.0.1',
        'name' => getenv('DB_NAME') ?: '',
        'user' => getenv('DB_USER') ?: '',
        'pass' => getenv('DB_PASS') ?: '',
    ],
    'jwt' => [
        'secret' => getenv('JWT_SECRET') ?: '',
        'access_ttl' => 900,                 // 15 minutos
        'refresh_ttl' => 60 * 60 * 24 * 30,   // 30 días
    ],
    'cors' => [
        'allowed_origins' => array_filter(array_map('trim', explode(',', getenv('CORS_ALLOWED_ORIGINS') ?: ''))),
    ],
];
