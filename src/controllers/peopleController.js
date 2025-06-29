// PESSOA N TEM COMO GENERALIZAR, ELA TEM FUNCOES MTO ESPECIFICAS EM SEU CRUD
const peopleService = require('../services/peopleService');
const { buscarTodasPessoas, buscarPorId, atualizarPessoaCompleta, removerPessoa } = require('../utils/people-db-utils');

const listar = async (req, res) => {
  try {
    const pessoas = await buscarTodasPessoas();
    res.json(pessoas);
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
    res.json(pessoas);
  } catch (error) {
    console.error('Erro ao listar pessoas:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas', error });
  }
};

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

module.exports = {
  listar,
  criar,
  getStatus,
  getStatusId,
  listarPorId,
  editar,
  deletar
};
