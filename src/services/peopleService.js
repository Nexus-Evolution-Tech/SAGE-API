const {
  criarPessoaBase,
  criarAluno,
  criarProfessor,
  criarAdministrador,
  criarTerceirizado,
  criarProfAdm,
  buscarAluno,
  buscarProfessor,
  buscarAdministrador,
  buscarProfAdm,
  buscarTerceirizado,
} = require('../utils/people-db-utils');
const { hashSenha } = require('../utils/criptografia');
const db = require('../config/database');
const path = require('path');
const fs = require('fs');

async function criarPessoaCompleta(dados) {
  const { nome, foto, rg, cpf, telefone, email, data_nascimento, genero, tipo, ...camposExtras } = dados;
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
    genero,
    tipo
  });

  const idPessoa = pessoa.id;

  switch (tipo) {
    case 'ALUNO':
      await criarAluno(idPessoa, camposExtras);
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

async function verificarPessoaPresente(id){
  // agora preciso ir até a tabela de acesso e verificar se existe algum registro com o idPessoa e data_hora >= dataHoje
  // Definir o início e o fim do dia atual
  const inicioDia = new Date();
  inicioDia.setHours(0, 0, 0, 0);
  const fimDia = new Date();
  fimDia.setHours(23, 59, 59, 999);

  const acesso = await global.db('Acesso')
    .where('pessoa_id', id)
    .andWhere('status', 'ENTRADA')
    .andWhere('data_hora', '>=', inicioDia)
    .andWhere('data_hora', '<=', fimDia)
    .first();

  const pessoa = await global.db('Pessoa')
    .where('id', id)
    .select('nome')
    .first();

  return {
    id: id,
    nome: pessoa ? pessoa.nome : null,
    status: acesso ? "PRESENTE" : "AUSENTE",
  };
}

async function verificarTodasPessoasPresentes() {
  const inicioDia = new Date();
  inicioDia.setHours(0, 0, 0, 0);
  const fimDia = new Date();
  fimDia.setHours(23, 59, 59, 999);

  // Busca todas as pessoas
  const pessoas = await global.db('Pessoa').select('id', 'nome');

  // Busca todos os acessos de entrada do dia
  const acessos = await global.db('Acesso')
    .where('status', 'ENTRADA')
    .andWhere('data_hora', '>=', inicioDia)
    .andWhere('data_hora', '<=', fimDia)
    .select('pessoa_id');

  // Cria um Set com os IDs das pessoas presentes
  const idsPresentes = new Set(acessos.map(a => a.pessoa_id));

  // Monta o resultado para cada pessoa
  return pessoas.map(pessoa => ({
    id: pessoa.id,
    nome: pessoa.nome,
    status: idsPresentes.has(pessoa.id) ? "PRESENTE" : "AUSENTE",
  }));
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
    console.log('Pessoa encontrada:', rows[0]);

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
    const novoNome = `pessoa_${pessoa_id}.jpg`;
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
  verificarPessoaPresente,
  verificarTodasPessoasPresentes,
  buscarPessoasPorTipo,
  uploadFotoPessoa,
  removerFotoPessoa
};
