const YAML = require('yaml');
const nodemailer = require('nodemailer');

describe('dependências de configuração e e-mail em produção', () => {
  it('parser YAML mantido lê a especificação sem depender de API legada', () => {
    expect(YAML.parse('openapi: 3.0.0').openapi).toBe('3.0.0');
  });

  it('Nodemailer 9 preserva o envio usado pelo SAGE sem acessar SMTP real', async () => {
    const transporte = nodemailer.createTransport({ jsonTransport: true });
    const resultado = await transporte.sendMail({
      from: 'sage@localhost',
      to: 'suporte@localhost',
      subject: 'Contrato',
      text: 'Teste'
    });

    expect(resultado.messageId).toBeTruthy();
  });
});
