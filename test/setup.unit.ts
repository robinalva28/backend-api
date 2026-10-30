import 'reflect-metadata';

delete process.env['DATABASE_URL'];
delete process.env['PGSSLROOTCERT'];
delete process.env['PGSSLMODE'];
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] ??= 'error';
