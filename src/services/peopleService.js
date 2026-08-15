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
  filtrarDadosPessoa,
} = require('../utils/people-db-utils');
const { hashSenha } = require('../utils/criptografia');
const db = require('../config/database');
const logger = require('../config/logger');
const path = require('path');
const fs = require('fs');
const { paths } = require('../config/paths');
const registrarSyncPendente = require('../services/sync');
const gerarNumero8Digitos = require('../utils/gerarNumero8Digitos');

function erroCaminhoFotoForaUploads() {
  const erro = new Error('Caminho de foto fora de uploads');
  erro.code = 'PESSOA_FOTO_CAMINHO_FORA_UPLOADS';
  return erro;
}

function estaDentroDeUploads(raizUploads, alvo) {
  const relativo = path.relative(raizUploads, alvo);
  return relativo === '' || (!relativo.startsWith(`..${path.sep}`) && relativo !== '..' && !path.isAbsolute(relativo));
}

function resolverPastaFotos(baseUploads = paths.uploads) {
  const raizUploads = fs.realpathSync(baseUploads);
  const pastaFotos = path.resolve(raizUploads, 'pessoas');
  fs.mkdirSync(pastaFotos, { recursive: true });
  const pastaReal = fs.realpathSync(pastaFotos);
  if (!estaDentroDeUploads(raizUploads, pastaReal)) throw erroCaminhoFotoForaUploads();
  return pastaReal;
}

function resolverFotoExistente(foto, baseUploads = paths.uploads) {
  const raizUploads = fs.realpathSync(baseUploads);
  const candidato = path.resolve(raizUploads, 'pessoas', String(foto));
  if (!estaDentroDeUploads(raizUploads, candidato)) throw erroCaminhoFotoForaUploads();

  try {
    fs.lstatSync(candidato);
    const caminhoReal = fs.realpathSync(candidato);
    if (!estaDentroDeUploads(raizUploads, caminhoReal)) throw erroCaminhoFotoForaUploads();
    return caminhoReal;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'PESSOA_FOTO_CAMINHO_FORA_UPLOADS') throw error;
    throw erroCaminhoFotoForaUploads();
  }
}

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
  const filtrado = filtrarDadosPessoa(dados);
  dados = filtrado.dados;
  const {
    nome, foto, rg, cpf, telefone, email, data_nascimento,
    tipo, ...camposExtras
  } = dados;

  // Tenta encontrar ID existente por CPF/RG/Email/RFID ou RA
  const idExistente = await buscarPessoaExistente({ 
    cpf, rg, email, cartao_rfid: camposExtras.cartao_rfid, ra: camposExtras.ra 
  });

  if (idExistente) {
    
    // Chamamos sua função de atualização enviando todos os dados recebidos
    const atualizacao = await atualizarPessoaCompleta(idExistente, {
      nome, foto, rg, cpf, telefone, email, data_nascimento, ...camposExtras
    });

    // Registrar sincronismo de atualização (UPDATE)
    await registrarSyncPendente(idExistente, 'UPDATE');
    
    return { idPessoa: idExistente, tipoCriado: tipo, status: 'ATUALIZADO', ignorados: [...filtrado.ignorados, ...(atualizacao?.ignorados || [])] };
  }

  // --- SE NÃO EXISTIR, SEGUE O FLUXO ORIGINAL DE CRIAÇÃO ---
  
  const pessoa = await criarPessoaBase({
    nome, foto, orgao_emissor_rg: camposExtras.orgao_emissor_rg, rg, cpf, telefone, email, tipo,
    unidade_id: camposExtras.unidade_id || null,
    qr_code: camposExtras.qr_code || gerarNumero8Digitos(),
    cartao_rfid: camposExtras.cartao_rfid || null,
    senha_acesso: camposExtras.senha_acesso ? await hashSenha(camposExtras.senha_acesso) : null,
    data_nascimento, visivel: camposExtras.visivel
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
  return { idPessoa, tipoCriado: tipo, status: 'CRIADO', ignorados: filtrado.ignorados };
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
  const baseUploads = paths.uploads;
  try {
    const pastaDestino = resolverPastaFotos(baseUploads);
    // Verificar se a pessoa existe
    const [rows] = await db.query('SELECT * FROM Pessoa WHERE id = ?', [pessoa_id]);
    // console.log('Pessoa encontrada:', rows[0]);

    if (rows.length === 0) {
      const arquivoTemp = path.join(baseUploads, req.file.filename);
      if (fs.existsSync(arquivoTemp)) {
        fs.unlinkSync(arquivoTemp);
      }
      return res.status(404).json({ message: 'Pessoa não encontrada' });
    }

    // Verificar se pessoa já tem foto e remover foto antiga
    const [fotoAtual] = await db.query('SELECT foto FROM Pessoa WHERE id = ?', [pessoa_id]);
    
    if (fotoAtual.length > 0 && fotoAtual[0].foto) {
      const fotoAntigaCaminho = resolverFotoExistente(fotoAtual[0].foto, baseUploads);
      if (fotoAntigaCaminho) fs.unlinkSync(fotoAntigaCaminho);
    }

    // Gerar nome único para a foto
    const novoNome = `pessoa_${pessoa_id}.png`;
    const antigoCaminho = path.join(baseUploads, req.file.filename);
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
    logger.error(`[PESSOA-FOTO] codigo=${error.code || 'UPLOAD_FALHOU'} pessoa_id=${pessoa_id}`);
    
    // Tentar remover arquivo temporário em caso de erro
    try {
      const arquivoTemp = path.join(baseUploads, req.file.filename);
      if (fs.existsSync(arquivoTemp)) {
        fs.unlinkSync(arquivoTemp);
      }
    } catch (cleanupError) {
      logger.warn('[PESSOA-FOTO] codigo=ARQUIVO_TEMPORARIO_NAO_REMOVIDO');
    }
    
    res.status(error.code === 'PESSOA_FOTO_CAMINHO_FORA_UPLOADS' ? 400 : 500)
      .json({ message: 'Erro ao salvar a foto da pessoa' });
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
    const baseUploads = paths.uploads;
    const caminhoFoto = resolverFotoExistente(pessoa[0].foto, baseUploads);
    if (caminhoFoto) fs.unlinkSync(caminhoFoto);

    // Atualizar banco removendo referência da foto
    await db.query('UPDATE Pessoa SET foto = NULL WHERE id = ?', [pessoa_id]);

    res.status(200).json({ 
      message: 'Foto removida com sucesso',
      pessoa_id: pessoa_id 
    });

  } catch (error) {
    logger.error(`[PESSOA-FOTO] codigo=${error.code || 'REMOCAO_FALHOU'} pessoa_id=${pessoa_id}`);
    res.status(error.code === 'PESSOA_FOTO_CAMINHO_FORA_UPLOADS' ? 400 : 500)
      .json({ message: 'Erro ao remover a foto da pessoa' });
  }
}

module.exports = {
  criarPessoaCompleta,
  buscarPessoasPorTipo,
  uploadFotoPessoa,
  removerFotoPessoa,
  resolverFotoExistente
};
