const path = require('path');
const { findForbiddenMigrations } = require('../scripts/check-expand-only-migrations');

describe('política expand-only', () => {
  it('recusa DDL que remove ou renomeia coluna', async () => {
    const findings = await findForbiddenMigrations(path.join(__dirname, '..', 'database'));
    expect(findings).toEqual([]);
  });
});
