// Runs before every test file: point the app at the dedicated test database.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(__dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must be set for tests (see .env.example).');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.STORAGE_DIR = resolve(__dirname, '../.test-storage');
process.env.PAYROLL_RULES_APPROVED = 'false';
process.env.VIEWER_ROLE_ENABLED = 'false';
process.env.SIGNUP_ENABLED = 'true';
process.env.SIGNUP_REQUIRE_APPROVAL = 'false';
process.env.SIGNUP_ALLOWED_DOMAINS = '';
process.env.SMTP_HOST = '';
