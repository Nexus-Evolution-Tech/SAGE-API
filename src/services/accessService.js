const deviceService = require('./deviceService');
const verificarEAtribuirPresenca = require('./presenceService');
const db = require('../config/database')

function formatarUserId(user_id) {
  // Converte para string, remove todos os zeros à esquerda, depois pega os últimos 7 dígitos
  const str = String(user_id).replace(/^0+/, ''); // remove zeros à esquerda
  return parseInt(str.slice(-7), 10); // pega no máximo os 7 últimos dígitos
}


// Determina o tipo de autenticação pelo valor lido
function mapearMetodo(value) {
  return value.length === 8 ? 'QRCODE' : 'CARTAO_RFID';
}

// Determina se é entrada ou saída
function identificarAcesso(portal_id) {
  return portal_id === 1 ? 'ENTRADA' : 'SAIDA';
}

// Converte timestamp Unix para Date e adiciona +3 horas
function timestampParaData(time) {
  const data = new Date(time * 1000); // timestamp Unix em segundos
  data.setHours(data.getHours() + 3); // adiciona 3 horas
  return data;
}

// Calcula idade
function calcularIdade(dataNascimento) {
  const hoje = new Date();
  const nascimento = new Date(dataNascimento);
  let idade = hoje.getFullYear() - nascimento.getFullYear();
  const mes = hoje.getMonth() - nascimento.getMonth();
  if (mes < 0 || (mes === 0 && hoje.getDate() < nascimento.getDate())) idade--;
  return idade;
}

// Sincroniza acessos de um dispositivo
async function sincronizarAcessos(dispositivo) {
  const MIN_ID = 73975; // ID mínimo do log a ser processado

  const link = deviceService.linkCatraca(dispositivo);
  const session = await deviceService.obterSessao(link, dispositivo);

  if (!session) {
    return { sucesso: false, message: `Erro ao obter sessão com a catraca ${dispositivo.nome}` };
  }

  // Último acesso sincronizado
  const [ultimoAcessoResult] = await db.query(
    'SELECT * FROM Acesso WHERE dispositivo_id = ? ORDER BY data_hora DESC LIMIT 1',
    [dispositivo.id]
  );
  const ultimoAcesso = ultimoAcessoResult[0];
  const timestampInicial = ultimoAcesso ? Math.floor(new Date(ultimoAcesso.data_hora).getTime() / 1000) : 0;

  // Obtem logs da catraca
  const logs = await deviceService.obterLogsCatraca(session, link, timestampInicial);

  let acessosSincronizados = 0;

  for (const log of logs) {
    // Ignora logs antigos ou abaixo do MIN_ID
    if (log.id <= MIN_ID || log.time <= timestampInicial) continue;

    // Ajusta user_id para 7 dígitos, descartando zeros à esquerda
    const userId = parseInt(log.user_id.toString().slice(-7), 10);

    // Verifica se pessoa existe
    const [pessoaResult] = await db.query('SELECT * FROM Pessoa WHERE id = ? LIMIT 1', [userId]);
    const pessoa = pessoaResult[0];
    if (!pessoa) {
      console.log(`Ignorando log: pessoa_id ${userId} não existe`);
      continue;
    }

    // Ignora logs de pessoas anteriores a 73975 (inclusive)
    if (log.id <= MIN_ID) continue;

    const pessoa_id = formatarUserId(log.user_id); //PARA PASSAR O ID DAS PESSOAS É PRECISO DELETAR TODOS OS OUTROS DADOS ANTERIORES
    const dispositivo_id = dispositivo.id;
    const data_hora = timestampParaData(log.time);
    const status = identificarAcesso(log.portal_id);
    const metodo_auth = mapearMetodo(log.card_value);
    const permitido = true;

    // Verifica se já existe
    const [acessoExistenteResult] = await db.query(
      'SELECT * FROM Acesso WHERE pessoa_id = ? AND dispositivo_id = ? AND data_hora = ? LIMIT 1',
      [pessoa_id, dispositivo_id, data_hora]
    );
    const acessoExistente = acessoExistenteResult[0];

    if (!acessoExistente) {
      await db.query(
        `INSERT INTO Acesso (pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora, new Date()]
      );
      acessosSincronizados++;

      // Computa presença
      await verificarEAtribuirPresenca(pessoa_id, data_hora);
    }
  }

  return {
    message: `${acessosSincronizados} acessos sincronizados para ${dispositivo.nome}`,
    dispositivo_id: dispositivo.id,
    nome: dispositivo.nome,
    sucesso: true,
    acessosSincronizados
  };
}

// Sincroniza todos os dispositivos
async function sincronizarTodosAcessos() {
  const [dispositivos] = await db.query('SELECT * FROM Dispositivo');
  const resultados = [];

  if (!dispositivos || dispositivos.length === 0) return resultados;

  for (const dispositivo of dispositivos) {
    const resultado = await sincronizarAcessos(dispositivo);
    resultados.push(resultado);
  }

  return resultados;
}

// Criar acesso manual
async function criarAcesso(dados) {
  let { pessoa_id, dispositivo_id, status, permitido, metodo_auth } = dados;

  // Pessoa existe?
  const [pessoaResult] = await db.query('SELECT * FROM Pessoa WHERE id = ? LIMIT 1', [pessoa_id]);
  const pessoa = pessoaResult[0];
  if (!pessoa) return { message: 'Pessoa não encontrada', error: 'PESSOA_INEXISTENTE' };

  // Calcula idade
  const idadePessoa = calcularIdade(pessoa.data_nascimento || new Date());

  // Último acesso
  const [ultimoAcessoResult] = await db.query(
    'SELECT * FROM Acesso WHERE pessoa_id = ? ORDER BY data_hora DESC LIMIT 1',
    [pessoa.id]
  );
  const ultimoAcesso = ultimoAcessoResult[0];

  if (status === 'ENTRADA' && ultimoAcesso?.status === 'ENTRADA') {
    return { message: 'Usuário já está dentro, não pode entrar novamente sem sair' };
  }
  if (status === 'SAIDA' && (!ultimoAcesso || ultimoAcesso.status !== 'ENTRADA')) {
    return { message: 'Usuário não está dentro, não pode sair sem entrar antes' };
  }

  // Permissão básica
  permitido = true;
  let mensagem = `Acesso autorizado para ${pessoa.nome}`;

  // Insere acesso
  await db.query(
    `INSERT INTO Acesso (pessoa_id, dispositivo_id, status, permitido, metodo_auth, data_hora, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [pessoa_id, dispositivo_id, status, permitido, metodo_auth, new Date(), new Date()]
  );

  const [acessoResult] = await db.query('SELECT * FROM Acesso WHERE id = LAST_INSERT_ID() LIMIT 1');
  const acesso = acessoResult[0];

  return { message: mensagem, acesso };
}

module.exports = {
  sincronizarAcessos,
  sincronizarTodosAcessos,
  criarAcesso
};
