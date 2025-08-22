// PESSOA N TEM COMO GENERALIZAR, ELA TEM FUNCOES MTO ESPECIFICAS EM SEU CRUD
const peopleService = require('../services/peopleService');
const controlIdService = require('../services/controlIdService');
const { buscarTodasPessoas, buscarPorId, atualizarPessoaCompleta, removerPessoa } = require('../utils/people-db-utils');
const ajustarFusoHorarioBrasil = require('../utils/ajustaFusoHorario');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');

const listar = async (req, res) => {
  try {
    const pessoas = await buscarTodasPessoas();
    res.json(ajustarFusoHorarioBrasil(pessoas));
  } catch (error) {
    console.error('Erro ao listar pessoas:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas', error: error.message });
  }
};

// SE NÃO CRIAR NA CATRACA TAMBÉM NÃO CRIA NO BANCO - ID NÃO ESTÁ SENDO PASSADO POIS É AUTOINCREMENT, SO É GERADO QUANDO É CRIADO NO BANCO
// PORTANTO, PRECISA CRIAR NO BANCO PRIMEIRO E DEPOIS NA CATRACA
const criar = async (req, res) => {
  try {
    const novaPessoa = req.body; // aqui só pega os dados para enviar à catraca
    const resultados = await controlIdService.criarNovaPessoaNaCatraca(novaPessoa);

    // Se chegou aqui, deu certo em todas as catracas → agora salva no banco
    const pessoaCriada = await peopleService.criarPessoaCompleta(novaPessoa);

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
      detalhes: error.detalhes // aqui mostra em qual catraca deu problema
    });
  }
};

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
  try {
    const pessoas = await peopleService.buscarPessoasPorTipo(tipo);
    res.json(ajustarFusoHorarioBrasil(pessoas));
  } catch (error) {
    console.error('Erro ao listar pessoas por tipo:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas por tipo', error: error.message });
  }
}

const editar = async (req, res) => {
  try {
    const id = req.params.id;
    const resultados = await controlIdService.editarNomePessoaNaCatraca(id, req.body.nome);
    await atualizarPessoaCompleta(id, req.body);
    res.json({ message: 'Pessoa atualizada com sucesso', catracas: resultados });
  } catch (error) {
    console.error('Erro ao atualizar pessoa:', error);
    res.status(500).json({ message: 'Erro ao editar pessoa', error: error.message, detalhes: error.detalhes });
  }
};

const deletar = async (req, res) => {
  try {
    const id = req.params.id;
    
    const query = `SELECT * FROM Pessoa WHERE id = ?`;
    const [pessoa] = await db.query(query, [id]);
    if(!pessoa) return "Pessoa não encontrada";

    const resultados = await controlIdService.deletarPessoaDaCatraca(id, pessoa[0].nome);
    await removerPessoa(id);
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
    await peopleService.uploadFotoPessoa(req, res);
    res.status(201).json({ message: 'Foto enviada com sucesso' });
  } catch (error) {
    console.error('Erro ao enviar foto:', error);
    res.status(500).json({ message: 'Erro ao enviar foto', error: error.message });
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
  uploadFoto
};
