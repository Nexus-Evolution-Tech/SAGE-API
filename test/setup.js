const { assertTestDatabaseName } = require('../scripts/setup-test-database');

if (process.env.REQUIRE_TEST_DB === 'true') {
  assertTestDatabaseName(process.env.DB_NAME);
}
