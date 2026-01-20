const deviceService = require('./deviceService');
const {verificarEAtribuirPresenca} = require('./presenceService');

function mapearMetodo(value) {
  if (value.length === 8) return 'QRCODE';
  else return 'CARTAO_RFID';
}

function identificarAcesso(portal_id) {
  if (portal_id === 1) return 'ENTRADA'
  else return 'SAIDA'
}

async function sincronizarAcessos(dispositivo) {
  const link = deviceService.linkCatraca(dispositivo);
  const session = await deviceService.obterSessao(link, dispositivo);

  if (!session) {
    return { sucesso: false, message: `Erro ao obter sessão com a catraca ${dispositivo.nome}` };
  }

  // Busca o último acesso sincronizado para este dispositivo
  const ultimoAcesso = await global.db('Acesso')
    .where({ dispositivo_id: dispositivo.id })
    .orderBy('data_hora', 'desc')
    .first();

  // Timestamp inicial (em segundos)
  const timestampInicial = ultimoAcesso
    ? Math.floor(new Date(ultimoAcesso.data_hora).getTime() / 1000)
    : 0;

  // Obtem logs da catraca e filtra os que são maiores que timestampInicial
  const logs = await deviceService.obterLogsCatraca(session, link, timestampInicial);

  let acessosSincronizados = 0;

  for (const log of logs) {
    if (log.time <= timestampInicial) {
      // Ignora logs antigos ou já processados (por segurança)
      continue;
    }

    const pessoa_id = /*log.user_id - 110000000*/ 1; //PARA PASSAR O ID DAS PESSOAS É PRECISO DELETAR TODOS OS OUTROS DADOS ANTERIORES
    const dispositivo_id = dispositivo.id;
    const data_hora = new Date(log.time * 1000);
    const status = identificarAcesso(log.portal_id);
    const metodo_auth = mapearMetodo(log.card_value);
    const permitido = true;

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
        data_hora,
        updated_at: new Date()
      });

      acessosSincronizados++;

      // ✅ Computa presença e atraso imediatamente
      if (!acessoExistente) {
        await global.db('Acesso').insert({
          pessoa_id,
          dispositivo_id,
          status,
          permitido,
          metodo_auth,
          data_hora,
          updated_at: new Date()
        });

        acessosSincronizados++;

        // ✅ Computa presença e atraso imediatamente
        await verificarEAtribuirPresenca(pessoa_id, data_hora);
      }
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

// OBS: A API DA CONTROLID JÁ SINCRONIZA OS LOGS EM TODAS AS CATRACAS AUTOMATICAMENTE - NÃO TEM ENTRADA E SAÍDA ESPECÍFICA - AS CATRACAS NÃO SE CONVERSAM, PRECISA VOLTAR AO SISTEMA ANTERIOR, A ESPECULAÇÃO SERÁ APENAS PELO HORÁRIO
async function sincronizarTodosAcessos() {
  const dispositivos = await global.db('Dispositivo').get();
  const resultados = [];

  // Verificar se existem dispositivos
  if (!dispositivos || dispositivos.length === 0) {
    return resultados;
  }

  const resultado = await sincronizarAcessos(dispositivos[0]);
  resultados.push(resultado);

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
  if (!pessoa) {
    return { message: 'Acesso negado: pessoa não encontrada', error: 'PESSOA_INEXISTENTE' };
  }

  const idadePessoa = calcularIdade(pessoa.data_nascimento || new Date());

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
        if (!aluno) {
          return { message: 'Acesso negado: aluno não encontrado', error: 'ALUNO_INEXISTENTE' };
        }
        switch (aluno.status) {
          case 'SUSPENSO':
            permitido = false; // Se o aluno foi suspenso, a saída é negada
            return { message: "Acesso negado: Aluno suspenso" };
          case 'TRANSFERENCIA EXPEDIDA':
            permitido = false; // Se o aluno foi transferido, a saída é negada
            return { message: "Acesso negado: Aluno transferido" };
          case 'TRANCADO':
            permitido = false; // Se o aluno trancou o curso, a saída é negada
            return { message: "Acesso negado: Aluno trancado" };
          case 'DESISTENTE':
            permitido = false; // Se o aluno desistiu do curso, a saída é negada
            return { message: "Acesso negado: Aluno desistente" };
          case 'CANCELADO':
            permitido = false; // Se o aluno foi cancelado, a saída é negada
            return { message: "Acesso negado: Aluno cancelado" };
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
      
      /*ATE PARA OS MAIORES DE IDADE É EXIGIDO PERMISSÃO*/
      // if (idadePessoa >= 18) {
      //   permitido = true;
      //   mensagem = `Acesso autorizado: Saída permitida para aluno maior de idade - ${idadePessoa} anos`;
      //   break;
      // } 

      // Verificar horários das aulas
      const hoje = new Date();
      const diaSemana = hoje.getDay(); // 0 = domingo, 1 = segunda, etc.

      const aluno = await global.db('Aluno').where('id', pessoa_id).first();
      if (!aluno) {
        return { message: 'Acesso negado: aluno não encontrado', error: 'ALUNO_INEXISTENTE' };
      }
      const turmaId = aluno.turma_id;

      if (!turmaId) {
        return { message: 'Acesso negado: aluno sem turma associada', error: 'TURMA_NAO_DEFINIDA' };
      }

      const aulasHoje = await global.db('Aula')
        .where('turma_id', turmaId)
        .where('dia_semana', diaSemana)
        .orderBy('inicio', 'asc')
        .get();

      if (!aulasHoje || aulasHoje.length === 0) {
        permitido = true;
        mensagem = "Acesso autorizado: Nenhuma aula cadastrada para hoje";
        break;
      }

      const primeiraAula = aulasHoje[0];
      const ultimaAula = aulasHoje[aulasHoje.length - 1];

      const agora = hoje.toTimeString().split(' ')[0]; // HH:MM:SS

      /*INDEPENDENTE SE COMEÇOU A PRIMEIRA AULA DO DIA OU NÃO, A PARTIR DO MOMENTO EM QUE O ALUNO ENTRA NA ESCOLA, SÓ PODERÁ SAIR NO SEU HORÁRIO DE SAÍDA*/
      // if (agora < primeiraAula.inicio) {
      //   // Antes da primeira aula, pode sair sem problemas
      //   permitido = true;
      //   mensagem = `Acesso autorizado: Ainda não começou a primeira aula - Primeira aula às ${primeiraAula.inicio}`;
      //   break;
      // }

      if (agora >= ultimaAula.fim) {
        // Após o fim da última aula, pode sair sem problemas
        permitido = true;
        mensagem = `Acesso autorizado: Aulas encerradas - Última aula terminou às ${ultimaAula.fim}`;
        break;
      }

      // Busca a solicitação existente para o aluno
      const solicitacoes = await global.db('SolicitacaoAcesso')
        .where('aluno_id', pessoa.id)
        .orderBy('data_hora_solicitacao', 'desc')
        .get(); // Pega da mais recente para a mais antiga

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
              mensagem = `Acesso autorizado: Solicitação aprovada - Aluno com ${idadePessoa} anos`;
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
  const insertedId = await global.db('Acesso').insert({
    pessoa_id,
    dispositivo_id,
    status,
    permitido,
    metodo_auth,
    data_hora: new Date(),
    updated_at: new Date()
  });

  const acesso = await global.db('Acesso')
    .where('id', insertedId)
    .first();

  return { message: mensagem, acesso };
}

module.exports = {
  sincronizarAcessos,
  sincronizarTodosAcessos,
  criarAcesso
};