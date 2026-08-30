const crypto = require('crypto');
const { assertTestDatabaseName } = require('../scripts/setup-test-database');

process.env.MONITOR_CALLBACK_TOKEN = process.env.MONITOR_CALLBACK_TOKEN || 'teste-monitor-callback-token';
process.env.SAGE_DEVICE_CREDENTIAL_KEY = process.env.SAGE_DEVICE_CREDENTIAL_KEY
  || crypto.randomBytes(32).toString('base64url');

if (process.env.REQUIRE_TEST_DB === 'true') {
  assertTestDatabaseName(process.env.DB_NAME);
}
