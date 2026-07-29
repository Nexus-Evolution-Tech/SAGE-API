const XLSX = require('xlsx');

describe('dependência de planilhas em produção', () => {
  it('usa SheetJS corrigido e preserva o contrato de importação/exportação', () => {
    // O registry público parou em 0.18.5, afetado por prototype pollution e ReDoS. A versão
    // oficial corrigida é distribuída pelo CDN do próprio SheetJS e vendorizada neste repositório.
    expect(XLSX.version).toBe('0.20.3');

    const original = [
      { Nome: 'Aluno de teste', RA: '000123', Nascimento: new Date('2010-05-20T00:00:00Z') }
    ];
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(original);
    XLSX.utils.book_append_sheet(workbook, sheet, 'ALUNO');

    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const relido = XLSX.read(bytes, { type: 'buffer', cellDates: true });
    const linhas = XLSX.utils.sheet_to_json(relido.Sheets.ALUNO, { defval: '' });

    expect(relido.SheetNames).toEqual(['ALUNO']);
    expect(linhas[0].Nome).toBe('Aluno de teste');
    expect(linhas[0].RA).toBe('000123');
    expect(linhas[0].Nascimento).toBeInstanceOf(Date);
  });
});
