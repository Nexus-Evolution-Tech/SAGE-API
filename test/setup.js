const { assertTestDatabaseName } = require('../scripts/setup-test-database');

process.env.MONITOR_CALLBACK_TOKEN = process.env.MONITOR_CALLBACK_TOKEN || 'teste-monitor-callback-token';

if (process.env.REQUIRE_TEST_DB === 'true') {
  assertTestDatabaseName(process.env.DB_NAME);
}
