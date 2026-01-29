const deviceService = require('./deviceService');
const {verificarEAtribuirAtraso} = require('../utils/computarAtrasos');

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
  console.log(`Sessão obtida: ${session}`);

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

      // await verificarEAtribuirAtraso(pessoa_id, data_hora);
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
  const dispositivos = await global.db('Dispositivo');
  const resultados = [];

  const resultado = await sincronizarAcessos(dispositivos[0]);
  resultados.push(resultado);

  return resultados;
}

// async function sincronizarTodosAcessos() {
//   const dispositivos = await global.db('Dispositivo');
//   const resultados = [];

//   for (const dispositivo of dispositivos) {
//     const resultado = await sincronizarAcessos(dispositivo);
//     resultados.push(resultado);
//   }

//   return resultados;
// }

// ESSE SINCRONIZA AS DUAS CATRACAS PELA ORDEM CASO CADA UMA TIVESSE UM LOG INDIVIDUAL
// async function sincronizarTodasCatracas() {
//   // 1. Pega todas as catracas do banco
//   const dispositivos = await global.db('Dispositivo');

//   // 2. Para cada dispositivo, pega o último timestamp sincronizado na tabela Acesso
//   const promessasLogs = dispositivos.map(async (dispositivo) => {
//     const ultimoAcesso = await global.db('Acesso')
//       .where({ dispositivo_id: dispositivo.id })
//       .orderBy('data_hora', 'desc')
//       .first();

//     const timestampInicial = ultimoAcesso
//       ? Math.floor(new Date(ultimoAcesso.data_hora).getTime() / 1000)
//       : 0;

//     // Obtém sessão e logs incrementais
//     const link = deviceService.linkCatraca(dispositivo);
//     const session = await deviceService.obterSessao(link, dispositivo);

//     if (!session) {
//       console.log(`Erro ao obter sessão para a catraca ${dispositivo.nome}`);
//       return [];
//     }

//     const logs = await deviceService.obterLogsCatraca(session, link, timestampInicial);

//     // Acrescenta info do dispositivo para cada log
//     return logs.map(log => ({
//       ...log,
//       dispositivo_id: dispositivo.id,
//       dispositivo_nome: dispositivo.nome
//     }));
//   });

//   // 3. Aguarda todos os logs serem buscados em paralelo
//   const resultados = await Promise.all(promessasLogs);

//   // 4. Junta tudo em uma lista só
//   let todosLogs = resultados.flat();

//   // 5. Ordena os logs por timestamp
//   todosLogs.sort((a, b) => a.time - b.time);

//   // 6. Insere os logs ordenados na tabela Acesso
//   let acessosSincronizados = 0;

//   for (const log of todosLogs) {
//     const pessoa_id = /* log.user_id - 110000000 */ 1; // ajuste conforme sua regra
//     const dispositivo_id = log.dispositivo_id;
//     const data_hora = new Date(log.time * 1000);
//     const status = identificarAcesso(log.portal_id);
//     const metodo_auth = mapearMetodo(log.card_value);
//     const permitido = true;

//     // Evita duplicidade
//     const acessoExistente = await global.db('Acesso')
//       .where({ pessoa_id, dispositivo_id, data_hora })
//       .first();

//     if (!acessoExistente) {
//       await global.db('Acesso').insert({
//         pessoa_id,
//         dispositivo_id,
//         status,
//         permitido,
//         metodo_auth,
//         data_hora,
//         updated_at: new Date()
//       });

//       acessosSincronizados++;
//     }
//   }

//   return {
//     sucesso: true,
//     acessosSincronizados,
//     message: `${acessosSincronizados} acessos sincronizados com sucesso, em ordem cronológica global.`
//   };
// }

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
      const turmaId = aluno.turma_id;

<<<<<<< Updated upstream
      const aulasHoje = await global.db('Aula')
        .where({ turma_id: turmaId, dia_semana: diaSemana })
        .orderBy('inicio', 'asc');
=======
      if (!turmaId) {
        return { message: 'Acesso negado: aluno sem turma associada', error: 'TURMA_NAO_DEFINIDA' };
      }

      // Mapa de dias da semana (JS: 0=domingo -> DB: DOMINGO) 
      const diasDasemana = ['DOMINGO','SEGUNDA','TERCA','QUARTA','QUINTA','SEXTA','SABADO'];
      const diaSemanaDb = diasDasemana[diaSemana];
<<<<<<< Updated upstream
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes

      console.log(`[ACCESS-DEBUG] Consultando aulas: turma=${turmaId}, dia=${diaSemanaDb}`);
      const aulasHoje = await global.db('HorarioAula')
        .where('turma_id', turmaId)
        .where('dia_semana', diaSemanaDb)
        .orderBy('horario', 'asc')
        .select();
      
      console.log(`[ACCESS-DEBUG] Aulas encontradas: ${JSON.stringify(aulasHoje)}`);

      // Verificação defensiva: se não há aulas, autoriza saída
      if (!aulasHoje || !Array.isArray(aulasHoje) || aulasHoje.length === 0) {
        permitido = true;
        mensagem = "Acesso autorizado: Nenhuma aula cadastrada para hoje";
        break;
      }

      // Verifica se a primeira aula tem dados válidos
      const primeiraAula = aulasHoje[0];
      const ultimaAula = aulasHoje[aulasHoje.length - 1];
      
      if (!primeiraAula || !primeiraAula.horario || !ultimaAula || !ultimaAula.horario) {
        permitido = true;
        mensagem = "Acesso autorizado: Nenhuma aula válida cadastrada para hoje";
        break;
      }

      // Extrai os horários (formato "07:30-08:20")
      const primeiroHorario = primeiraAula.horario.split('-')[0]; // "07:30"
      const ultimoHorario = ultimaAula.horario.split('-')[1]; // "08:20"

      const agora = hoje.toTimeString().split(' ')[0]; // HH:MM:SS

      /*INDEPENDENTE SE COMEÇOU A PRIMEIRA AULA DO DIA OU NÃO, A PARTIR DO MOMENTO EM QUE O ALUNO ENTRA NA ESCOLA, SÓ PODERÁ SAIR NO SEU HORÁRIO DE SAÍDA*/
      // if (agora < primeiroHorario) {
      //   // Antes da primeira aula, pode sair sem problemas
      //   permitido = true;
      //   mensagem = `Acesso autorizado: Ainda não começou a primeira aula - Primeira aula às ${primeiroHorario}`;
      //   break;
      // }

      if (agora >= ultimoHorario) {
        // Após o fim da última aula, pode sair sem problemas
        permitido = true;
        mensagem = `Acesso autorizado: Aulas encerradas - Última aula terminou às ${ultimoHorario}`;
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