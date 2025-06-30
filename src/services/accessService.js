const deviceService = require('./deviceService');

function mapearMetodo(metodoOriginal) {
  switch (metodoOriginal) {
    case 'QRCODE':
      return 'QR_CODE';
    case 'RFID':
      return 'CARTAO_RFID';
    case 'PASSWORD':
      return 'SENHA';
    case 'FINGERPRINT':
      return 'BIOMETRIA';
    default:
      return 'QR_CODE';
  }
}

async function sincronizarAcessos(dispositivo) {
  const link = deviceService.linkCatraca(dispositivo);
  const session = await deviceService.obterSessao(link, dispositivo);

  if (!session) {
    return { sucesso: false, message: `Erro ao obter sessão com a catraca ${dispositivo.nome}` };
  }

  const logs = await deviceService.obterLogsCatraca(session, link);
  let acessosSincronizados = 0;

  for (const log of logs) {
    const pessoa_id = log.user_id;
    const dispositivo_id = dispositivo.id;
    const data_hora = new Date(log.time * 1000);
    const status = log.event; // ENTRADA, SAIDA, NEGADO
    const metodo_auth = mapearMetodo(log.auth_method);
    const permitido = status !== 'NEGADO';

    // Verifica se já existe um registro com esses dados
    const acessoExistente = await global.db('Acesso')
      .where({ pessoa_id, dispositivo_id, data_hora })
      .first();

    if (!acessoExistente) {
      await global.db('Acesso').insert({
        pessoa_id,
        dispositivo_id,
        status,
        permitido,
        metodo_auth,
        data_hora
      });

      acessosSincronizados++;
    }
  }

  return {
    message: `${acessosSincronizados} acessos sincronizados com sucesso para ${dispositivo.nome}`,
    dispositivo_id: dispositivo.id,
    nome: dispositivo.nome,
    sucesso: true,
    acessosSincronizados
  };
}

async function sincronizarTodosAcessos() {
  const dispositivos = await global.db('Dispositivo');
  const resultados = [];

  for (const dispositivo of dispositivos) {
    const resultado = await sincronizarAcessos(dispositivo);
    resultados.push(resultado);
  }

  return resultados;
}

function calcularIdade(dataNascimento) {
  const hoje = new Date();
  const nascimento = new Date(dataNascimento);

  let idade = hoje.getFullYear() - nascimento.getFullYear();
  const mes = hoje.getMonth() - nascimento.getMonth();

  // Ajusta se ainda não fez aniversário este ano
  if (mes < 0 || (mes === 0 && hoje.getDate() < nascimento.getDate())) {
    idade--;
  }

  return idade;
}

async function criarAcesso(dados) {
  let { pessoa_id, dispositivo_id, status, permitido, metodo_auth } = dados;

  if (status == 'ENTRADA') permitido = true;
  else {
    const pessoa = await global.db('Pessoa').where('id', pessoa_id).first();
    const idadePessoa = calcularIdade(pessoa.data_nascimento);
    if (pessoa.tipo == 'ALUNO') {
        if (idadePessoa >= 18) permitido = true;
        else {
            let permissaoResponsavel = false; // Aqui você deve implementar a lógica para verificar se o responsável deu permissão
            if (permissaoResponsavel) permitido = true; // Se houver permissão do responsável, a saída é permitida
            else permitido = false; // Se não houver permissão, a saída é negada
        }
    } else permitido = true; // Para outros tipos de pessoa, assume-se que a saída é sempre permitida
  }

  // Cria o registro de acesso
  const acesso = await global.db('Acesso').insert({
    pessoa_id,
    dispositivo_id,
    status,
    permitido,
    metodo_auth,
    data_hora: new Date()
  }).returning('*');

  return { message: "Acesso efetuado com sucesso", acesso: acesso[0] };
}

module.exports = {
  sincronizarAcessos,
  sincronizarTodosAcessos,
  criarAcesso
};