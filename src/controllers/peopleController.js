const peopleService = require('../services/peopleService');

const getPessoas = async (req, res) => {
  try {
    const pessoas = await peopleService.listarPessoas();
    res.json(pessoas);
  } catch (error) {
    console.error('Erro ao listar pessoas:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas' });
  }
};

const postPessoa = async (req, res) => {
  try {
    const novaPessoa = await peopleService.criarPessoaCompleta(req.body);
    res.status(201).json({ message: 'Pessoa criada com sucesso', pessoa: novaPessoa });
  } catch (error) {
    console.error('Erro ao criar pessoa:', error);
    res.status(500).json({ message: 'Erro ao criar pessoa' });
  }
};

const patchPessoa = async (req, res) => {
  try {
    const id = req.params.id;
    await peopleService.editarPessoa(id, req.body);
    res.json({ message: 'Pessoa atualizada com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar pessoa:', error);
    res.status(500).json({ message: 'Erro ao atualizar pessoa' });
  }
};

const deletePessoa = async (req, res) => {
  try {
    const id = req.params.id;
    await peopleService.deletarPessoa(id);
    res.json({ message: 'Pessoa removida com sucesso' });
  } catch (error) {
    console.error('Erro ao remover pessoa:', error);
    res.status(500).json({ message: 'Erro ao remover pessoa' });
  }
};

module.exports = {
  getPessoas,
  postPessoa,
  patchPessoa,
  deletePessoa
};
