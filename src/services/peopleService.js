const {
  criarPessoaBase,
  criarAluno,
  criarResponsavel,
  criarProfessor,
  criarAdministrador,
  criarTerceirizado,
  criarProfAdm,
  atualizarPessoaCompleta,
  buscarAluno,
  buscarResponsavel,
  buscarProfessor,
  buscarAdministrador,
  buscarProfAdm,
  buscarTerceirizado,
  criarFuncionarioBase,
} = require('../utils/people-db-utils');
const { hashSenha } = require('../utils/criptografia');
const db = require('../config/database');
const path = require('path');
const fs = require('fs');
const registrarSyncPendente = require('../services/sync');

/**
 * Verifica se já existe uma pessoa com os documentos fornecidos
 */
async function buscarPessoaExistente(dados) {
  const { cpf, rg, email, cartao_rfid, ra } = dados;
  const checks = [];
  const params = [];

  // 1. Verificação na tabela Pessoa (Prioridade para documentos únicos)
  if (cpf) { checks.push('cpf = ?'); params.push(cpf); }
  if (rg) { checks.push('rg = ?'); params.push(rg); }
  if (email) { checks.push('email = ?'); params.push(email); }
  if (cartao_rfid) { checks.push('cartao_rfid = ?'); params.push(cartao_rfid); }

  if (checks.length > 0) {
    const sqlPessoa = `SELECT id FROM Pessoa WHERE ${checks.join(' OR ')} LIMIT 1`;
    const [rowsPessoa] = await db.query(sqlPessoa, params);
    if (rowsPessoa.length > 0) return rowsPessoa[0].id;
  }

  // 2. Verificação específica de Aluno (RA) caso não tenha achado na Pessoa
  if (ra) {
    const [rowsAluno] = await db.query('SELECT id FROM Aluno WHERE ra = ? LIMIT 1', [ra]);
    if (rowsAluno.length > 0) return rowsAluno[0].id;
  }

  return null;
}

// Upsert = Update or Insert -> se ele identificar uma pessoa existente, ele atualiza, senão cria uma nova (isso é fundamental para o bot da planilha)
async function criarPessoaCompleta(dados) {
  const {
    nome, foto, rg, cpf, telefone, email, data_nascimento,
    tipo, ...camposExtras
  } = dados;

  // Tenta encontrar ID existente por CPF/RG/Email/RFID ou RA
  const idExistente = await buscarPessoaExistente({ 
    cpf, rg, email, cartao_rfid: camposExtras.cartao_rfid, ra: camposExtras.ra 
  });

  if (idExistente) {
    console.log(`Pessoa encontrada (ID: ${idExistente}). Atualizando dados...`);
    
    // Chamamos sua função de atualização enviando todos os dados recebidos
    await atualizarPessoaCompleta(idExistente, {
      nome, foto, rg, cpf, telefone, email, data_nascimento, ...camposExtras
    });

    // Registrar sincronismo de atualização (UPDATE)
    await registrarSyncPendente(idExistente, 'UPDATE');
    
    return { idPessoa: idExistente, tipoCriado: tipo, status: 'ATUALIZADO' };
  }

  // --- SE NÃO EXISTIR, SEGUE O FLUXO ORIGINAL DE CRIAÇÃO ---
  
  const pessoa = await criarPessoaBase({
    nome, foto, rg, cpf, telefone, email, tipo,
    unidade_id: camposExtras.unidade_id || null,
    qr_code: camposExtras.qr_code || null,
    cartao_rfid: camposExtras.cartao_rfid || null,
    senha_acesso: camposExtras.senha_acesso ? await hashSenha(camposExtras.senha_acesso) : null,
    data_nascimento
  });

  const idPessoa = pessoa.id;

  // Lógica de tabelas secundárias (Funcionario, Aluno, etc)
  const tiposFuncionario = ['PROFESSOR', 'ADMINISTRADOR', 'PROFADM', 'TERCEIRIZADO'];
  if (tiposFuncionario.includes(tipo)) {
    await criarFuncionarioBase(idPessoa, camposExtras);
  }

  switch (tipo) {
    case 'ALUNO': await criarAluno(idPessoa, camposExtras); break;
    case 'RESPONSAVEL': await criarResponsavel(idPessoa, camposExtras); break;
    case 'PROFESSOR': await criarProfessor(idPessoa, camposExtras); break;
    case 'ADMINISTRADOR': await criarAdministrador(idPessoa, camposExtras); break;
    case 'TERCEIRIZADO': await criarTerceirizado(idPessoa, camposExtras); break;
    case 'PROFADM': await criarProfAdm(idPessoa, camposExtras); break;
    default: throw new Error('Tipo de pessoa inválido');
  }

  await registrarSyncPendente(idPessoa, 'CREATE');
  return { idPessoa, tipoCriado: tipo, status: 'CRIADO' };
}

// Converte "HH:mm" para minutos
function horaParaMinutos(horaStr) {
  const [hora, minuto] = horaStr.split(':').map(Number);
  return hora * 60 + minuto;
}

// Define horário Date a partir de "HH:mm"
function definirHorario(horaStr) {
  const [hora, minuto] = horaStr.split(':').map(Number);
  const data = new Date();
  data.setHours(hora, minuto, 0, 0);
  return data;
}

// Formata hora para string SQL "HH:MM:SS"
function formatarHoraParaSQL(date) {
  return date.toTimeString().slice(0, 8);
}

// Formata hora para exibição em "pt-BR"
function formatarHora(date) {
  return date.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// Calcula quantas aulas foram perdidas com base na hora de entrada
function calcularAulasPerdidas(aulas, entradaDate) {
  const minutosEntrada = entradaDate.getHours() * 60 + entradaDate.getMinutes();
  return aulas.filter(aula => {
    const inicio = aula.horario.split('-')[0]; // pegar só início
    const minutosAula = horaParaMinutos(inicio);
    return minutosAula < minutosEntrada;
  }).length;
}

async function verificarPessoaPresenteEAtrasada(id) {
  const hoje = new Date();
  const diasSemanaEnum = ['DOMINGO','SEGUNDA','TERCA','QUARTA','QUINTA','SEXTA','SABADO'];
  const diaSemana = diasSemanaEnum[hoje.getDay()];
  const toleranciaMinutos = 15;

  // Pega a pessoa
  const [pessoas] = await db.query('SELECT id, nome, tipo FROM Pessoa WHERE id = ?', [id]);
  const pessoa = pessoas[0];
  if (!pessoa) throw new Error(`Pessoa com id ${id} não encontrada`);

  // Busca último acesso do dia
  const inicioDia = new Date(hoje); inicioDia.setHours(0,0,0,0);
  const fimDia = new Date(hoje); fimDia.setHours(23,59,59,999);
  const [acessos] = await db.query(
    'SELECT * FROM Acesso WHERE pessoa_id = ? AND status = "ENTRADA" AND data_hora BETWEEN ? AND ? ORDER BY data_hora ASC LIMIT 1',
    [id, inicioDia, fimDia]
  );
  const acesso = acessos[0];
  const entrada = acesso?.data_hora || null;

  // Busca aulas do dia
  let aulasHoje = [];
  if (pessoa.tipo === 'ALUNO') {
    const [alunos] = await db.query('SELECT turma_id, divisao FROM Aluno WHERE id = ?', [pessoa.id]);
    const aluno = alunos[0];
    if (aluno) {
      const [aulas] = await db.query(`
        SELECT ha.horario
        FROM HorarioAula ha
        JOIN Aula a ON a.id = ha.aula_id
        WHERE ha.turma_id = ? AND ha.dia_semana = ? AND ha.divisao IN (?, 'INT')
        ORDER BY ha.horario ASC
      `, [aluno.turma_id, diaSemana, aluno.divisao]);
      aulasHoje = aulas;
    }
  } else if (['PROFESSOR','PROFADM'].includes(pessoa.tipo)) {
    const [aulas] = await db.query(`
      SELECT ha.horario
      FROM HorarioAula ha
      JOIN Aula a ON a.id = ha.aula_id
      WHERE a.professor_id = ? AND ha.dia_semana = ?
      ORDER BY ha.horario ASC
    `, [pessoa.id, diaSemana]);
    aulasHoje = aulas;
  }

  // Define horário previsto da primeira aula
  const entradaPrevista = aulasHoje.length > 0 ? definirHorario(aulasHoje[0].horario.split('-')[0]) : null;

  // Calcula atrasado e aulas perdidas
  let atrasado = false;
  let aulasPerdidas = 0;
  if (aulasHoje.length > 0) {
    if (entrada && entradaPrevista) {
      const entradaDate = new Date(entrada);
      const tolerancia = new Date(entradaPrevista.getTime() + toleranciaMinutos * 60000);
      atrasado = entradaDate > tolerancia;
      aulasPerdidas = calcularAulasPerdidas(aulasHoje, entradaDate);
    } else {
      aulasPerdidas = calcularAulasPerdidas(aulasHoje, new Date());
    }
  }

  // Define status
  let status = 'AUSENTE';
  if (['ALUNO','PROFESSOR','PROFADM'].includes(pessoa.tipo) && aulasHoje.length === 0) status = 'SEM AULA';
  else if (entrada) status = 'PRESENTE';
  else if (pessoa.tipo === 'RESPONSAVEL') status = 'NAO SE APLICA';

  // Checa se já existe registro na tabela Atraso para hoje
  const [atrasos] = await db.query(
    'SELECT * FROM Atraso WHERE pessoa_id = ? AND data = ?',
    [pessoa.id, hoje.toISOString().split('T')[0]]
  );
  const atrasoExistente = atrasos[0];

  const dadosAtraso = {
    pessoa_id: pessoa.id,
    data: hoje.toISOString().split('T')[0],
    dia_semana: diaSemana,
    status,
    aulas_perdidas: aulasPerdidas,
    horario_previsto: entradaPrevista ? formatarHoraParaSQL(entradaPrevista) : null,
    horario_chegada: entrada ? formatarHoraParaSQL(new Date(entrada)) : null,
    atrasado: entrada && entradaPrevista ? atrasado : null
  };

  if (!atrasoExistente) {
    // Se não existe, insere
    await db.query(
      `INSERT INTO Atraso
       (pessoa_id, data, dia_semana, status, aulas_perdidas, horario_previsto, horario_chegada, atrasado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      Object.values(dadosAtraso)
    );
  } else {
    // Se existe, atualiza todos os campos
    await db.query(
      `UPDATE Atraso
       SET dia_semana = ?, status = ?, aulas_perdidas = ?, horario_previsto = ?, horario_chegada = ?, atrasado = ?
       WHERE id = ?`,
      [
        dadosAtraso.dia_semana,
        dadosAtraso.status,
        dadosAtraso.aulas_perdidas,
        dadosAtraso.horario_previsto,
        dadosAtraso.horario_chegada,
        dadosAtraso.atrasado,
        atrasoExistente.id
      ]
    );
  }

  return {
    id: pessoa.id,
    nome: pessoa.nome,
    tipo: pessoa.tipo,
    dia: hoje.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),
    dia_semana: diaSemana,
    status,
    aulas_perdidas: aulasPerdidas,
    horario_entrada_prevista: entradaPrevista ? formatarHora(entradaPrevista) : null,
    horario_entrada_real: entrada ? formatarHora(new Date(entrada)) : null,
    atrasado: entrada && entradaPrevista ? atrasado : null
  };
}

// Itera sobre todas as pessoas
async function verificarTodasPessoasPresentesEAtrasadas() {
  const [pessoas] = await db.query('SELECT id FROM Pessoa');
  const resultados = await Promise.all(pessoas.map(({id}) => verificarPessoaPresenteEAtrasada(id)));
  return resultados;
}

async function buscarPessoasPorTipo(tipo, limit = 50, offset = 0) {
  const [pessoas] = await db.query(
    'SELECT * FROM Pessoa WHERE tipo = ? AND visivel = 1 LIMIT ? OFFSET ?',
    [tipo, limit, offset]
  );

  const resultado = [];

  for (const pessoa of pessoas) {
    let dadosEspecificos = {};

    switch (pessoa.tipo) {
      case 'ALUNO':
        dadosEspecificos = await buscarAluno(pessoa.id);
        break;
      case 'RESPONSAVEL':
        dadosEspecificos = await buscarResponsavel(pessoa.id);
        break;
      case 'PROFESSOR':
        dadosEspecificos = await buscarProfessor(pessoa.id);
        break;
      case 'ADMINISTRADOR':
        dadosEspecificos = await buscarAdministrador(pessoa.id);
        break;
      case 'PROFADM':
        dadosEspecificos = await buscarProfAdm(pessoa.id);
        break;
      case 'TERCEIRIZADO':
        dadosEspecificos = await buscarTerceirizado(pessoa.id);
        break;
      default:
        break;
    }

    resultado.push({
      ...pessoa,
      ...dadosEspecificos
    });
  }

  return resultado;
}

async function uploadFotoPessoa(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: 'Arquivo de foto não enviado' });
  }

  const pessoa_id = req.params.id;
  
  if (!pessoa_id) {
    return res.status(400).json({ message: 'ID da pessoa é obrigatório' });
  }

  // Caminho /pessoas
  const baseUploads = path.resolve(__dirname, '..', 'uploads');
  const pastaDestino = path.join(baseUploads, 'pessoas');

  if (!fs.existsSync(pastaDestino)) {
    fs.mkdirSync(pastaDestino, { recursive: true });
  }

  try {
    // Verificar se a pessoa existe
    const [rows] = await db.query('SELECT * FROM Pessoa WHERE id = ?', [pessoa_id]);
    // console.log('Pessoa encontrada:', rows[0]);

    if (rows.length === 0) {
      const arquivoTemp = path.resolve(__dirname, '..', 'uploads', req.file.filename);
      if (fs.existsSync(arquivoTemp)) {
        fs.unlinkSync(arquivoTemp);
      }
      return res.status(404).json({ message: 'Pessoa não encontrada' });
    }

    // Verificar se pessoa já tem foto e remover foto antiga
    const [fotoAtual] = await db.query('SELECT foto FROM Pessoa WHERE id = ?', [pessoa_id]);
    
    if (fotoAtual.length > 0 && fotoAtual[0].foto) {
      const fotoAntigaCaminho = path.join(baseUploads, fotoAtual[0].foto);
      if (fs.existsSync(fotoAntigaCaminho)) {
        fs.unlinkSync(fotoAntigaCaminho);
      }
    }

    // Gerar nome único para a foto
    const novoNome = `pessoa_${pessoa_id}.png`;
    const antigoCaminho = path.resolve(__dirname, '..', 'uploads', req.file.filename);
    const novoCaminho = path.join(pastaDestino, novoNome);

    // Mover arquivo para pasta correta
    fs.renameSync(antigoCaminho, novoCaminho);

    // Atualizar caminho da foto na tabela Pessoa
    const caminhoRelativo = path.join(novoNome).replace(/\\/g, '/');
    await db.query('UPDATE Pessoa SET foto = ? WHERE id = ?', [caminhoRelativo, pessoa_id]);

    res.status(200).json({ 
      message: 'Foto atualizada com sucesso',
      pessoa_id: pessoa_id,
      foto: caminhoRelativo 
    });

  } catch (error) {
    
    // Tentar remover arquivo temporário em caso de erro
    try {
      const arquivoTemp = path.resolve(__dirname, '..', 'uploads', req.file.filename);
      if (fs.existsSync(arquivoTemp)) {
        fs.unlinkSync(arquivoTemp);
      }
    } catch (cleanupError) {
    }
    
    res.status(500).json({ message: 'Erro ao salvar a foto da pessoa' });
  }
}

async function removerFotoPessoa(req, res) {
  const { pessoa_id } = req.params;

  try {
    // Buscar foto atual da pessoa
    const [pessoa] = await db.query('SELECT foto FROM Pessoa WHERE id = ?', [pessoa_id]);
    
    if (pessoa.length === 0) {
      return res.status(404).json({ message: 'Pessoa não encontrada' });
    }

    if (!pessoa[0].foto) {
      return res.status(400).json({ message: 'Pessoa não possui foto para remover' });
    }

    // Remover arquivo físico
    const baseUploads = path.resolve(__dirname, '..', 'uploads');
    const caminhoFoto = path.join(baseUploads, pessoa[0].foto);
    
    if (fs.existsSync(caminhoFoto)) {
      fs.unlinkSync(caminhoFoto);
    }

    // Atualizar banco removendo referência da foto
    await db.query('UPDATE Pessoa SET foto = NULL WHERE id = ?', [pessoa_id]);

    res.status(200).json({ 
      message: 'Foto removida com sucesso',
      pessoa_id: pessoa_id 
    });

  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover a foto da pessoa' });
  }
}

module.exports = {
  criarPessoaCompleta,
  verificarPessoaPresenteEAtrasada,
  verificarTodasPessoasPresentesEAtrasadas,
  buscarPessoasPorTipo,
  uploadFotoPessoa,
  removerFotoPessoa
};
