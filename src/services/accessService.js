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

  const pessoa = await global.db('Pessoa').where('id', pessoa_id).first();
  const idadePessoa = calcularIdade(pessoa.data_nascimento);

  switch(status) {
    case 'ENTRADA':
      if (pessoa.tipo !== 'ALUNO') {
        permitido = true; // Entrada permitida para não-alunos
        return { message: "Acesso autorizado: Entrada permitida para não-alunos" };
      } else {
        const aluno = await global.db('Aluno').where('id', pessoa_id).first();
        switch (aluno.status) {
          case 'SUSPENSO':
            permitido = false; // Se o aluno foi suspenso, a saída é negada
            return { message: "Acesso negado: Aluno suspenso" };
          case 'TRANSFERIDO':
            permitido = false; // Se o aluno foi transferido, a saída é negada
            return { message: "Acesso negado: Aluno transferido" };
          case 'DESLIGADO':
            permitido = false; // Se o aluno foi desligado, a saída é negada
            return { message: "Acesso negado: Aluno desligado" };
          default:
            permitido = true; // Se o aluno está ativo, a entrada é permitida
            return { message: "Acesso autorizado: Entrada permitida para aluno ativo" };
        }
      }
    case 'SAIDA':
      if (pessoa.tipo !== 'ALUNO') {
        permitido = true; // Saída permitida para todos os tipos de pessoa, exceto aluno
        return { message: "Acesso autorizado: Saída permitida para não-alunos" };
      } else {
        if (idadePessoa >= 18) {
          permitido = true; // Saída permitida para aluno maior de idade
          return { message: "Acesso autorizado: Saída permitida para aluno maior de idade", idade_aluno: `Aluno com ${idadePessoa} anos - MAIOR DE IDADE` };
        } else {
          let permissaoResponsavel = false; // Aqui você deve implementar a lógica para verificar se o responsável deu permissão
          if (permissaoResponsavel){
            permitido = true; // Se houver permissão do responsável, a saída é permitida
            return { message: "Acesso autorizado: Saída permitida com permissão do responsável", idade_aluno: `Aluno com ${idadePessoa} anos - MENOR DE IDADE` };
          } else {
            console.log("Permissão do responsável não encontrada, negando acesso...");
            permitido = false; // Se não houver permissão, a saída é negada
            return { message: "Acesso negado: Saída sem permissão do responsável", idade_aluno: `Aluno com ${idadePessoa} - MENOR DE IDADE` };
          }
        }
      }
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