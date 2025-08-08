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
  console.log(`Sessão obtida: ${session}`);

  if (!session) {
    return { sucesso: false, message: `Erro ao obter sessão com a catraca ${dispositivo.nome}` };
  }

  const logs = await deviceService.obterLogsCatraca(session, link);
  console.log(logs);
  let acessosSincronizados = 0;

  for (const log of logs) {
    const pessoa_id = log.user_id;
    const dispositivo_id = dispositivo.id;
    const data_hora = new Date(log.time * 1000);
    const status = log.event; // ENTRADA, SAIDA, NEGADO
    const metodo_auth = mapearMetodo(log.auth_method);
    console.log(`Método de autenticação: ${metodo_auth}`);
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

  // Busca o último acesso da pessoa
  const ultimoAcesso = await global.db('Acesso')
    .where('pessoa_id', pessoa_id)
    .orderBy('data_hora', 'desc')
    .first();

  // Regra para evitar múltiplas entradas sem saída e multiplas saídas sem entrada
  if (status === 'ENTRADA') {
    if (ultimoAcesso && ultimoAcesso.status === 'ENTRADA') {
      return { message: "Acesso negado: Usuário já está dentro, não pode entrar novamente sem sair" };
    }
  } else if (status === 'SAIDA') {
    if (!ultimoAcesso || ultimoAcesso.status !== 'ENTRADA') {
      return { message: "Acesso negado: Usuário não está dentro, não pode sair sem entrar antes" };
    }
  }

  let mensagem = '';
  switch(status) {
    case 'ENTRADA':
      if (pessoa.tipo !== 'ALUNO') {
        permitido = true; // Entrada permitida para não-alunos
        mensagem = "Acesso autorizado: Entrada permitida para não-alunos";
        break;
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
            mensagem = "Acesso autorizado: Entrada permitida para aluno ativo";
            break;
        }
      }
      break;
    case 'SAIDA':
      // Preciso verificar se a aula acabou, se acabou o aluno não precisa de permissão do responsável para sair
      // Preciso fazer um sistema de atraso também
      if (pessoa.tipo !== 'ALUNO') {
        permitido = true;
        mensagem = "Acesso autorizado: Saída permitida para não-alunos";
        break;
      }

      if (idadePessoa >= 18) {
        permitido = true;
        mensagem = `Acesso autorizado: Saída permitida para aluno maior de idade - ${idadePessoa} anos`;
        break;
      }

      // Aluno menor de idade - Verificar horários das aulas
      const hoje = new Date();
      const diaSemana = hoje.getDay(); // 0 = domingo, 1 = segunda, etc.

      const aluno = await global.db('Aluno').where('id', pessoa_id).first();
      const turmaId = aluno.turma_id;

      const aulasHoje = await global.db('Aula')
        .where({ turma_id: turmaId, dia_semana: diaSemana })
        .orderBy('inicio', 'asc');

      if (!aulasHoje || aulasHoje.length === 0) {
        permitido = true;
        mensagem = "Acesso autorizado: Nenhuma aula cadastrada para hoje";
        break;
      }

      const primeiraAula = aulasHoje[0];
      const ultimaAula = aulasHoje[aulasHoje.length - 1];

      const agora = hoje.toTimeString().split(' ')[0]; // HH:MM:SS

      if (agora < primeiraAula.inicio) {
        // Antes da primeira aula, pode sair sem problemas
        permitido = true;
        mensagem = `Acesso autorizado: Ainda não começou a primeira aula - Primeira aula às ${primeiraAula.inicio}`;
        break;
      }

      if (agora >= ultimaAula.fim) {
        // Após o fim da última aula, pode sair sem problemas
        permitido = true;
        mensagem = `Acesso autorizado: Aulas encerradas - Última aula terminou às ${ultimaAula.fim}`;
        break;
      }

      // Busca a solicitação existente para o aluno
      const solicitacoes = await global.db('SolicitacaoAcesso')
        .where('aluno_id', pessoa.id)
        .orderBy('data_hora_solicitacao', 'desc'); // Pega da mais recente para a mais antiga

      const solicitacao = solicitacoes.find(s => ['APROVADA', 'NEGADA', 'PENDENTE'].includes(s.status));

      if (!solicitacao) {
        // Se não existir, cria uma nova solicitação como pendente
        await global.db('SolicitacaoAcesso').insert({
          aluno_id: pessoa.id,
          motivo: 'Saída durante o período de aula',
          status: 'PENDENTE',
          observacao_resposta: 'Aguardando autorização da secretaria',
        });

        permitido = false;
        return { message: 'Acesso negado: Solicitação de saída criada e aguardando aprovação da secretaria', idade_aluno: `Aluno com ${idadePessoa} anos - MENOR DE IDADE`, hora_atual: agora };
      } else {
        switch (solicitacao.status) {
          case 'APROVADA':
            const dataAtual = new Date();
            const hoje = new Date();
            const dataSolicitacao = new Date(solicitacao.data_hora_solicitacao);

            const mesmaData = (
              hoje.getFullYear() === dataSolicitacao.getFullYear() &&
              hoje.getMonth() === dataSolicitacao.getMonth() &&
              hoje.getDate() === dataSolicitacao.getDate()
            );

            if (mesmaData) {
              permitido = true;
              mensagem = `Acesso autorizado: Solicitação aprovada - Aluno com ${idadePessoa} anos - MENOR DE IDADE`;
              break;
            } else {
              permitido = false;
              return { message: 'Acesso negado: Solicitação aprovada, mas tempo de validez expirado', idade_aluno: `Aluno com ${idadePessoa} anos - MENOR DE IDADE`, hora_atual: agora };
            }
          case 'NEGADA':
            permitido = false;
            return { message: 'Acesso negado: Solicitação de saída foi negada pela secretaria', idade_aluno: `Aluno com ${idadePessoa} anos - MENOR DE IDADE`, hora_atual: agora };
          case 'PENDENTE':
            permitido = false;
            return { message: 'Acesso negado: Solicitação ainda não foi aprovada pela secretaria', idade_aluno: `Aluno com ${idadePessoa} anos - MENOR DE IDADE`, hora_atual: agora };
          default:
            permitido = false;
            return { message: 'Acesso negado: Solicitação de saída com status desconhecido', idade_aluno: `Aluno com ${idadePessoa} anos - MENOR DE IDADE`, hora_atual: agora };
        }
        break;
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

  return { message: mensagem, acesso: acesso[0] };
}

module.exports = {
  sincronizarAcessos,
  sincronizarTodosAcessos,
  criarAcesso
};