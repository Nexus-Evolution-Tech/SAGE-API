const crud = require('../utils/generic-db-utils');
const { hashSenha } = require('../utils/criptografia');
const ajustarFusoHorarioBrasil = require('../utils/ajustaFusoHorario');
const db = require('../config/database');
const logger = require('../config/logger');

function capitalize(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function getGeneroTexto(classe, acao) {
  if (!classe || typeof classe !== 'string') return acao + 'o'; // Exemplo: "criado" como fallback
  if (!acao || typeof acao !== 'string') return '';

  const texto = classe.trim().toLowerCase();
  const femininas = ['aluna', 'professora', 'administradora', 'terceirizada', 'responsável', 'secretária'];

  // Determinar se é feminino
  const isFeminino = texto.endsWith('a') || femininas.includes(texto);

  // Garantir ação em minúsculo
  acao = acao.toLowerCase();

  // Montar resposta
  if (isFeminino) {
    return acao + 'a';  // Exemplo: criada, atualizada, removida
  } else {
    return acao + 'o';  // Exemplo: criado, atualizado, removido
  }
}

function gerarController(tabela, campos, entidadeNome) {
  return {
    async listar(req, res) {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const offset = (page - 1) * limit;

      try {
        // Busca paginada dos registros
        const registros = await crud.buscarTodos(tabela, campos, limit, offset);

        // Total de registros para calcular totalPages
        const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM ${tabela}`);

        res.json({
          data: ajustarFusoHorarioBrasil(registros),
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        });
      } catch (error) {
        logger.error(`Erro ao listar ${entidadeNome}: ${error.message}`);
        res.status(500).json({ message: `Erro ao listar ${entidadeNome}`, error: error.message });
      }
    },

    async listarPorId(req, res) {
      const id = req.params.id;
      try {
        const registros = await crud.buscarPorId(id, tabela, campos);
        res.json(ajustarFusoHorarioBrasil(registros));
      } catch (error) {
        logger.error(`Erro ao listar ${entidadeNome}: ${error.message}`);
        res.status(500).json({ message: `Erro ao listar ${entidadeNome}`, error: error.message });
      }
    },

    async criar(req, res) {
      try {
        const dados = { ...req.body };
        
        if (tabela === 'UnidadeEscolar') // não posso criptografar Dispositivo, pois a API da ControlID não aceita hash bcrypt
          // Verificar e hashear qualquer campo que contenha "senha" no nome
          for (const chave in dados) {
            if (chave.toLowerCase().includes('senha') && typeof dados[chave] === 'string') {
              dados[chave] = await hashSenha(dados[chave]);
            }
          }

        const novoRegistro = await crud.criarRegistro(tabela, dados);
        res.status(201).json({ 
          message: `${capitalize(entidadeNome)} ${getGeneroTexto(entidadeNome, 'criad')} com sucesso`, 
          data: novoRegistro
        });
      } catch (error) {
        logger.error(`Erro ao criar ${entidadeNome}: ${error.message}`);
        res.status(500).json({ message: `Erro ao criar ${entidadeNome}`, error: error.message });
      }
    },

    async editar(req, res) {
      try {
        const id = req.params.id;
        await crud.atualizarRegistro(tabela, id, req.body);
        res.json({ message: `${capitalize(entidadeNome)} ${getGeneroTexto(entidadeNome, 'atualizad')} com sucesso` });
      } catch (error) {
        logger.error(`Erro ao atualizar ${entidadeNome}: ${error.message}`);
        res.status(500).json({ message: `Erro ao atualizar ${entidadeNome}`, error: error.message });
      }
    },

    async deletar(req, res) {
      try {
        const id = req.params.id;
        await crud.removerRegistro(tabela, id);
        res.json({ message: `${capitalize(entidadeNome)} ${getGeneroTexto(entidadeNome, 'removid')} com sucesso` });
      } catch (error) {
        logger.error(`Erro ao remover ${entidadeNome}: ${error.message}`);
        res.status(500).json({ message: `Erro ao remover ${entidadeNome}`, error: error.message });
      }
    }
  };
}

module.exports = gerarController;
