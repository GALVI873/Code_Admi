<?php
declare(strict_types=1);

return [
    'db' => [
        'path' => getenv('DB_PATH') ?: (__DIR__ . '/../data/galvi_panel.sqlite'),
    ],
    'jwt' => [
        'secret' => getenv('JWT_SECRET') ?: '',
        'access_ttl' => 900,                 // 15 minutos
        'refresh_ttl' => 60 * 60 * 24 * 30,   // 30 días
    ],
    'cors' => [
        'allowed_origins' => array_filter(array_map('trim', explode(',', getenv('CORS_ALLOWED_ORIGINS') ?: ''))),
    ],
    'setup_token' => getenv('SETUP_TOKEN') ?: '',
];
