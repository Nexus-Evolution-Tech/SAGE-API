// PESSOA N TEM COMO GENERALIZAR, ELA TEM FUNCOES MTO ESPECIFICAS EM SEU CRUD
const peopleService = require('../services/peopleService');
const controlIdService = require('../services/controlIdService');
const { buscarTodasPessoas, buscarPorId, atualizarPessoaCompleta, removerPessoa } = require('../utils/people-db-utils');
const ajustarFusoHorarioBrasil = require('../utils/ajustaFusoHorario');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { criarImagemUsuario, generateQrCode } = require('../services/controlIdService');
const { buscarPessoaBase } = require('../utils/people-db-utils');
const { sincronizarTodasPessoasNasCatracas } = require('../utils/sync_catracas');

const listar = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  try {
    const pessoas = await buscarTodasPessoas(limit, offset);
    const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM Pessoa');

    res.json({
      data: ajustarFusoHorarioBrasil(pessoas),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Erro ao listar pessoas:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas', error: error.message });
  }
};

// SE NÃO CRIAR NA CATRACA TAMBÉM NÃO CRIA NO BANCO - ID NÃO ESTÁ SENDO PASSADO POIS É AUTOINCREMENT, SO É GERADO QUANDO É CRIADO NO BANCO
// PORTANTO, PRECISA CRIAR NO BANCO PRIMEIRO E DEPOIS NA CATRACA
const criar = async (req, res) => {
  try {
    // 1. Salva no banco
    const pessoaCriada = await peopleService.criarPessoaCompleta(req.body);

    const id = pessoaCriada.idPessoa;
    //buscar no banco a pessoa criada
    const pessoa = await buscarPessoaBase(id);

    // 2. Monta o objeto completo para a catraca
    const novaPessoaParaCatraca = {
      id: pessoa.id,
      nome: pessoa.nome,
      cartao_rfid: pessoa.cartao_rfid,
      qrcode: pessoa.qr_code
      // outros campos que a catraca espera
    };

    // 3. Sincroniza com catraca
    let resultados = [];
    try {
      if (pessoa.tipo !== 'RESPONSAVEL')
        resultados = await controlIdService.criarNovaPessoaNasCatracas(novaPessoaParaCatraca);
    } catch (errorCatraca) {
      console.error('Erro ao sincronizar com catraca:', errorCatraca);
    }

    res.status(201).json({
      message: 'Pessoa criada com sucesso',
      pessoa: pessoaCriada,
      sincronizacao: resultados
    });

  } catch (error) {
    console.error('Erro ao criar pessoa:', error);
    res.status(400).json({
      message: 'Falha ao criar pessoa',
      erro: error.message,
      detalhes: error.detalhes
    });
  }
};

//AQUI SERÁ ONDE ESTARÁ A LÓGICA DE ATRASOS
const getStatus = async (req, res) => {
  try {
    const estaPresenteAtrasado = await peopleService.verificarTodasPessoasPresentesEAtrasadas();
    res.json(estaPresenteAtrasado);
  } catch (error) {
    console.error('Erro ao listar pessoas:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas', error: error.message });
  }
};

const getStatusId = async (req, res) => {
  const id = req.params.id;
  try {
    const estaPresente = await peopleService.verificarPessoaPresenteEAtrasada(id);
    res.json(estaPresente);
  } catch (error) {
    console.error('Erro ao listar pessoas:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas', error: error.message });
  }
};

const listarPorId = async (req, res) => {
  const id = req.params.id;
  try {
    const pessoas = await buscarPorId(id);
    res.json(ajustarFusoHorarioBrasil(pessoas));
  } catch (error) {
    console.error('Erro ao listar pessoas:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas', error: error.message });
  }
};

const listarPorTipo = async (req, res) => {
  const tipo = req.params.tipo;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  try {
    const pessoas = await peopleService.buscarPessoasPorTipo(tipo, limit, offset);
    const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM Pessoa WHERE tipo = ?', [tipo]);

    res.json({
      data: ajustarFusoHorarioBrasil(pessoas),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Erro ao listar pessoas por tipo:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas por tipo', error: error.message });
  }
};

const editar = async (req, res) => {
  try {
    const id = req.params.id;
    await atualizarPessoaCompleta(id, req.body);
    if (req.body.nome !== null && req.body.cartao_rfid !== null){
      const resultados = await controlIdService.editarPessoaNasCatracas(id, req.body.nome, req.body.cartao_rfid);
      res.json({ message: 'Pessoa atualizada com sucesso', catracas: resultados });
    }
    res.json({ message: 'Pessoa atualizada com sucesso'});
  } catch (error) {
    console.error('Erro ao atualizar pessoa:', error);
    res.status(500).json({ message: 'Erro ao editar pessoa', error: error.message, detalhes: error.detalhes });
  }
};

const deletar = async (req, res) => {
  try {
    const id = req.params.id;
    
    // const query = `SELECT * FROM Pessoa WHERE id = ?`;
    // const [pessoa] = await db.query(query, [id]);
    // if(!pessoa) return "Pessoa não encontrada";

    await removerPessoa(id);
    const resultados = await controlIdService.deletarPessoaDasCatracas(id/*, pessoa[0].nome*/);
    res.json({ message: 'Pessoa removida com sucesso', catracas: resultados });
  } catch (error) {
    console.error('Erro ao remover pessoa:', error);
    res.status(500).json({ message: 'Erro ao remover pessoa', error: error.message });
  }
};

const getUrls = async (req, res) => {
  try {
    const pessoas = await buscarTodasPessoas();

    if (!pessoas || pessoas.length === 0) {
      return res.status(404).json({ message: 'Nenhuma pessoa encontrada para esta unidade' });
    }
    
    const urls = pessoas.map(pessoa => ({
      id: pessoa.id,
      url: `http://localhost:3000/uploads/pessoas/${pessoa.foto}`,
    }));

    res.json(urls);
  } catch (error) {
    console.error('Erro ao buscar URLs das pessoas:', error);
    res.status(500).json({ message: 'Erro ao buscar URLs das pessoas', error: error.message });
  }
}

const getUrlById = async (req, res) => {
  const id = req.params.id;
  const [pessoa] = await db.query('SELECT * FROM Pessoa WHERE id = ?', [id]);
  if (!pessoa) {
      return res.status(404).json({ message: 'Pessoa não encontrada' });
  }
  const url = `http://localhost:3000/uploads/pessoas/${pessoa[0].foto}`;

  res.json({ url: url });
};

const uploadFoto = async (req, res) => {
  try {
    await peopleService.uploadFotoPessoa(req, res); // o service envia a resposta
    if(req.file) await criarImagemUsuario(req.params.id)
    else return res.status(400).json({ message: 'Arquivo de foto não enviado' });
  } catch (error) {
    console.error('Erro ao enviar foto:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Erro ao enviar foto', error: error.message });
    }
  }
}

const gerarQrCode = async (req, res) => {
  const id = req.params.id;
  try {
    const data = await generateQrCode(id);

    const query = `UPDATE Pessoa SET qr_code = ? WHERE id = ?`;
    await db.query(query, [data.qrcode, id]);

    res.json({ message: "QrCode gerado com sucesso para a pessoa", id });
  } catch (error) {
    console.error('Erro ao gerar qrcode para users:', error);
    res.status(500).json({ message: 'Erro ao gerar qrcode', error: error.message });
  }
}

const sincronizarBanco = async (req, res) => {
  try {
    await sincronizarTodasPessoasNasCatracas();
    res.json({ message: "Banco sincronizado com sucesso", id });
  } catch (error) {
    console.error('Erro ao sincronizar banco:', error);
    res.status(500).json({ message: 'Erro ao sincronizar banco', error: error.message });
  }
}

module.exports = {
  listar,
  criar,
  getStatus,
  getStatusId,
  listarPorTipo,
  listarPorId,
  editar,
  deletar,
  getUrls,
  getUrlById,
  uploadFoto,
  gerarQrCode,
  sincronizarBanco
};
