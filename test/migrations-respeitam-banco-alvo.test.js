/**
 * O instalador define DB_NAME para criar bancos isolados em testes e, no futuro, na instalação.
 * Uma migration com USE fixo abandona esse banco silenciosamente e pode alterar outra instalação.
 */
const fs = require('fs');
const path = require('path');

const DIRETORIO_DATABASE = path.join(__dirname, '..', 'database');

describe('scripts SQL respeitam o banco escolhido pelo operador ou instalador', () => {
  it('nenhum arquivo SQL troca o banco ativo com USE', () => {
    const migrationsComUseFixo = fs.readdirSync(DIRETORIO_DATABASE)
      .filter((arquivo) => arquivo.endsWith('.sql'))
      .filter((arquivo) => {
        const sql = fs.readFileSync(path.join(DIRETORIO_DATABASE, arquivo), 'utf8');
        return /^\s*USE\s+(?:`[^`]+`|[a-zA-Z0-9_]+)\s*;/im.test(sql);
      });

    expect(migrationsComUseFixo).toEqual([]);
  });
});
