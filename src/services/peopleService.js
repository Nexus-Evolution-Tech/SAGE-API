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
  buscarPessoasPorTipo,
  uploadFotoPessoa,
  removerFotoPessoa
};
