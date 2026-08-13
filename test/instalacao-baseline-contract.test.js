const fs = require('fs');
const path = require('path');

const schema = fs.readFileSync(
  path.join(__dirname, '..', 'database', 'sage.sql'),
  'utf8'
);

describe('baseline de instalação pelo driver MySQL', () => {
  it('não contém comandos exclusivos do cliente mysql', () => {
    expect(schema).not.toMatch(/^\s*DELIMITER\b/im);
  });

  it('deixa a promoção anual sob responsabilidade do serviço Node', () => {
    expect(schema).not.toMatch(/CREATE\s+(?:PROCEDURE|EVENT)\b/i);
    expect(schema).toContain("VALUES ('ultimo_ano_promocao', '0')");
  });
});
