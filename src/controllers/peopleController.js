// PESSOA N TEM COMO GENERALIZAR, ELA TEM FUNCOES MTO ESPECIFICAS EM SEU CRUD
const peopleService = require('../services/peopleService');
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
    res.status(500).json({ message: 'Erro ao listar pessoas', error });
  }
};

const criar = async (req, res) => {
  try {
    const novaPessoa = await peopleService.criarPessoaCompleta(req.body);
    res.status(201).json({ message: 'Pessoa criada com sucesso', pessoa: novaPessoa });
  } catch (error) {
    console.error('Erro ao criar pessoa:', error);
    res.status(500).json({ message: 'Erro ao criar pessoa:', error });
  }
};

const getStatus = async (req, res) => {
  try {
    const estaPresente = await peopleService.verificarTodasPessoasPresentes();
    res.json(estaPresente);
  } catch (error) {
    console.error('Erro ao listar pessoas:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas', error });
  }
};

const getStatusId = async (req, res) => {
  const id = req.params.id;
  try {
    const estaPresente = await peopleService.verificarPessoaPresente(id);
    res.json(estaPresente);
  } catch (error) {
    console.error('Erro ao listar pessoas:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas', error });
  }
};

const listarPorId = async (req, res) => {
  const id = req.params.id;
  try {
    const pessoas = await buscarPorId(id);
    res.json(ajustarFusoHorarioBrasil(pessoas));
  } catch (error) {
    console.error('Erro ao listar pessoas:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas', error });
  }
};

const listarPorTipo = async (req, res) => {
  const tipo = req.params.tipo;
  try {
    const pessoas = await peopleService.buscarPessoasPorTipo(tipo);
    res.json(ajustarFusoHorarioBrasil(pessoas));
  } catch (error) {
    console.error('Erro ao listar pessoas por tipo:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas por tipo', error });
  }
}

const editar = async (req, res) => {
  try {
    const id = req.params.id;
    await atualizarPessoaCompleta(id, req.body);
    res.json({ message: 'Pessoa atualizada com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar pessoa:', error);
    res.status(500).json({ message: 'Erro ao atualizar pessoa', error });
  }
};

const deletar = async (req, res) => {
  try {
    const id = req.params.id;
    await removerPessoa(id);
    res.json({ message: 'Pessoa removida com sucesso' });
  } catch (error) {
    console.error('Erro ao remover pessoa:', error);
    res.status(500).json({ message: 'Erro ao remover pessoa', error });
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
    res.status(500).json({ message: 'Erro ao buscar URLs das pessoas', error });
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
    res.status(500).json({ message: 'Erro ao enviar foto', error });
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
