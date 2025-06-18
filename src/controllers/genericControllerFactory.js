const crud = require('../utils/generic-db-utils');

function gerarController(tabela, campos, entidadeNome) {
  return {
    async listar(req, res) {
      try {
        const registros = await crud.buscarTodos(tabela, campos);
        res.json(registros);
      } catch (error) {
        console.error(`Erro ao listar ${entidadeNome}:`, error);
        res.status(500).json({ message: `Erro ao listar ${entidadeNome}` });
      }
    },

    async listarPorId(req, res) {
      const id = req.params.id;
      try {
        const registros = await crud.buscarPorId(id, tabela, campos);
        res.json(registros);
      } catch (error) {
        console.error(`Erro ao listar ${entidadeNome}:`, error);
        res.status(500).json({ message: `Erro ao listar ${entidadeNome}` });
      }
    },

    async criar(req, res) {
      try {
        const novoRegistro = await crud.criarRegistro(tabela, req.body);
        res.status(201).json({ message: `${entidadeNome} criado com sucesso`, data: novoRegistro });
      } catch (error) {
        console.error(`Erro ao criar ${entidadeNome}:`, error);
        res.status(500).json({ message: `Erro ao criar ${entidadeNome}` });
      }
    },

    async editar(req, res) {
      try {
        const id = req.params.id;
        await crud.atualizarRegistro(tabela, id, req.body);
        res.json({ message: `${entidadeNome} atualizado com sucesso` });
      } catch (error) {
        console.error(`Erro ao atualizar ${entidadeNome}:`, error);
        res.status(500).json({ message: `Erro ao atualizar ${entidadeNome}` });
      }
    },

    async deletar(req, res) {
      try {
        const id = req.params.id;
        await crud.removerRegistro(tabela, id);
        res.json({ message: `${entidadeNome} removido com sucesso` });
      } catch (error) {
        console.error(`Erro ao remover ${entidadeNome}:`, error);
        res.status(500).json({ message: `Erro ao remover ${entidadeNome}` });
      }
    }
  };
}

module.exports = gerarController;
