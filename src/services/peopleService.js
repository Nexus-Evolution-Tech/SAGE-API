const {
  criarPessoaBase,
  criarAluno,
  criarResponsavel,
  criarProfessor,
  criarAdministrador,
  criarTerceirizado,
  criarProfAdm,
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

async function criarPessoaCompleta(dados) {
  const {
    nome, foto, rg, cpf, telefone, email, data_nascimento,
    genero, tipo, ...camposExtras
  } = dados;

  // 1. Criar Pessoa
  const pessoa = await criarPessoaBase({
    nome,
    foto,
    rg,
    cpf,
    telefone,
    email,
    unidade_id: camposExtras.unidade_id || null,
    qr_code: camposExtras.qr_code || null,
    cartao_rfid: camposExtras.cartao_rfid || null,
    senha_acesso: camposExtras.senha_acesso ? await hashSenha(camposExtras.senha_acesso) : null,
    data_nascimento,
    tipo
  });

  const idPessoa = pessoa.id;

  // 2. Se não for aluno nem responsável, criar Funcionario
  const tiposFuncionario = ['PROFESSOR', 'ADMINISTRADOR', 'PROFADM', 'TERCEIRIZADO'];
  if (tiposFuncionario.includes(tipo)) {
    await criarFuncionarioBase(idPessoa, camposExtras)
  }

  // 3. Criar tipo específico
  switch (tipo) {
    case 'ALUNO':
      await criarAluno(idPessoa, camposExtras);
      break;
    case 'RESPONSAVEL':
      await criarResponsavel(idPessoa, camposExtras);
      break;
    case 'PROFESSOR':
      await criarProfessor(idPessoa, camposExtras);
      break;
    case 'ADMINISTRADOR':
      await criarAdministrador(idPessoa, camposExtras);
      break;
    case 'TERCEIRIZADO':
      await criarTerceirizado(idPessoa, camposExtras);
      break;
    case 'PROFADM':
      await criarProfAdm(idPessoa, camposExtras);
      break;
    default:
      throw new Error('Tipo de pessoa inválido');
  }

  return { idPessoa, tipoCriado: tipo };
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
    const [hora, minuto] = aula.inicio.split(':').map(Number);
    const minutosAula = hora * 60 + minuto;
    return minutosAula < minutosEntrada;
  }).length;
}

// Calcula quantas aulas foram perdidas com base na hora de entrada
function calcularAulasPerdidas(aulas, entradaDate) {
  const minutosEntrada = entradaDate.getHours() * 60 + entradaDate.getMinutes();
  return aulas.filter(aula => {
    const [hora, minuto] = aula.inicio.split(':').map(Number);
    const minutosAula = hora * 60 + minuto;
    return minutosAula < minutosEntrada;
  }).length;
}

async function verificarPessoaPresenteEAtrasada(id) {
  const hoje = new Date();
  const inicioDia = new Date(hoje); inicioDia.setHours(0, 0, 0, 0);
  const fimDia = new Date(hoje); fimDia.setHours(23, 59, 59, 999);
  const diasSemanaEnum = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];
  const diaSemana = diasSemanaEnum[hoje.getDay()];
  const toleranciaMinutos = 15;

  const pessoa = await global.db('Pessoa').where('id', id).first(['id', 'nome', 'tipo']);
  if (!pessoa) throw new Error(`Pessoa com id ${id} não encontrada`);

  let entrada = null;
  let entradaPrevista = null;
  let atrasado = false;
  let aulasPerdidas = 0;

  const acesso = await global.db('Acesso')
    .where('pessoa_id', id)
    .andWhere('status', 'ENTRADA')
    .andWhere('data_hora', '>=', inicioDia)
    .andWhere('data_hora', '<=', fimDia)
    .orderBy('data_hora', 'asc')
    .first();

  if (acesso) entrada = acesso.data_hora;

  let aulasHoje = [];

  if (pessoa.tipo === 'ALUNO') {
    const aluno = await global.db('Aluno').where('id', pessoa.id).first(['turma_id', 'divisao']);
    if (aluno) {
      const divisoes = aluno.divisao === 'DIV A' ? ['DIV A', 'DIV A/B'] : ['DIV B', 'DIV A/B'];
      aulasHoje = await global.db('Aula')
        .where('turma_id', aluno.turma_id)
        .andWhere('dia_semana', diaSemana)
        .whereIn('divisao', divisoes)
        .orderBy('inicio', 'asc')
        .select('inicio');
      if (aulasHoje.length > 0) entradaPrevista = definirHorario(aulasHoje[0].inicio);
    }

  } else if (['PROFESSOR', 'PROFADM'].includes(pessoa.tipo)) {
    aulasHoje = await global.db('Aula')
      .where({ professor_id: pessoa.id, dia_semana: diaSemana })
      .orderBy('inicio', 'asc')
      .select('inicio');

    if (aulasHoje.length > 0) entradaPrevista = definirHorario(aulasHoje[0].inicio);

  } else if (pessoa.tipo !== 'RESPONSAVEL') {
    const funcionario = await global.db(pessoa.tipo)
      .where('id', pessoa.id)
      .first('entrada');

    if (funcionario?.entrada) {
      entradaPrevista = definirHorario(funcionario.entrada);
    }
  }

  if (aulasHoje.length > 0) {
    if (entrada && entradaPrevista) {
      const entradaDate = new Date(entrada);
      const tolerancia = new Date(entradaPrevista.getTime() + toleranciaMinutos * 60000);
      atrasado = entradaDate > tolerancia;
      aulasPerdidas = calcularAulasPerdidas(aulasHoje, entradaDate);
    } else {
      // Pessoa não veio, usa hora atual para calcular quantas aulas ela perdeu
      const agora = new Date();
      aulasPerdidas = calcularAulasPerdidas(aulasHoje, agora);
    }
  }

  let status = 'AUSENTE';
  if (['ALUNO', 'PROFESSOR', 'PROFADM'].includes(pessoa.tipo) && aulasHoje.length === 0) {
    status = 'SEM AULA';
  } else if (entrada) {
    status = 'PRESENTE';
  } else if (pessoa.tipo === 'RESPONSAVEL') {
    status = 'NAO SE APLICA';
  }

  // Inserir no banco apenas se PRESENTE ou AUSENTE
  if (['PRESENTE', 'AUSENTE'].includes(status)) {
    await global.db('Atraso').insert({
      pessoa_id: pessoa.id,
      data: hoje.toISOString().split('T')[0],
      dia_semana: diaSemana,
      status,
      aulas_perdidas: aulasPerdidas,
      horario_previsto: entradaPrevista ? formatarHoraParaSQL(entradaPrevista) : null,
      horario_chegada: entrada ? formatarHoraParaSQL(new Date(entrada)) : null,
      atrasado: entrada && entradaPrevista ? atrasado : null
    });
  }

  return {
    id: pessoa.id,
    nome: pessoa.nome,
    tipo: pessoa.tipo,
    dia: hoje.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    dia_semana: diaSemana,
    status,
    aulas_perdidas: aulasPerdidas,
    horario_entrada_prevista: entradaPrevista ? formatarHora(entradaPrevista) : null,
    horario_entrada_real: entrada ? formatarHora(new Date(entrada)) : null,
    atrasado: entrada && entradaPrevista ? atrasado : null
  };
}

async function verificarTodasPessoasPresentesEAtrasadas() {
  const pessoas = await global.db('Pessoa').select('id');
  const resultados = [];

  for (const { id } of pessoas) {
    const resultado = await verificarPessoaPresenteEAtrasada(id);
    resultados.push(resultado);
  }

  return resultados;
}

async function buscarPessoasPorTipo(tipo) {
  const [pessoas] = await db.query('SELECT * FROM Pessoa WHERE tipo = ?', [tipo]);
  
  const resultado = [];

  for (const pessoa of pessoas) {
    let dadosEspecificos = {};

    switch (pessoa.tipo) {
      case 'ALUNO':
        dadosEspecificos = await buscarAluno(pessoa.id);
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
        // Tipo inválido ou desconhecido, pode logar ou apenas ignorar os extras
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
    console.error('Erro ao fazer upload da foto:', error);
    
    // Tentar remover arquivo temporário em caso de erro
    try {
      const arquivoTemp = path.resolve(__dirname, '..', 'uploads', req.file.filename);
      if (fs.existsSync(arquivoTemp)) {
        fs.unlinkSync(arquivoTemp);
      }
    } catch (cleanupError) {
      console.error('Erro ao limpar arquivo temporário:', cleanupError);
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
    console.error('Erro ao remover foto:', error);
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
