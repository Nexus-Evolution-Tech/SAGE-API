const crud = require('../utils/generic-db-utils');
const { hashSenha } = require('../utils/criptografia');

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
      try {
        const registros = await crud.buscarTodos(tabela, campos);
        res.json(registros);
      } catch (error) {
        console.error(`Erro ao listar ${entidadeNome}:`, error);
        res.status(500).json({ message: `Erro ao listar ${entidadeNome}`, error });
      }
    },

    async listarPorId(req, res) {
      const id = req.params.id;
      try {
        const registros = await crud.buscarPorId(id, tabela, campos);
        res.json(registros);
      } catch (error) {
        console.error(`Erro ao listar ${entidadeNome}:`, error);
        res.status(500).json({ message: `Erro ao listar ${entidadeNome}`, error });
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
        console.error(`Erro ao criar ${entidadeNome}:`, error);
        res.status(500).json({ message: `Erro ao criar ${entidadeNome}`, error });
      }
    },

    async editar(req, res) {
      try {
        const id = req.params.id;
        await crud.atualizarRegistro(tabela, id, req.body);
        res.json({ message: `${capitalize(entidadeNome)} ${getGeneroTexto(entidadeNome, 'atualizad')} com sucesso` });
      } catch (error) {
        console.error(`Erro ao atualizar ${entidadeNome}:`, error);
        res.status(500).json({ message: `Erro ao atualizar ${entidadeNome}`, error });
      }
    },

    async deletar(req, res) {
      try {
        const id = req.params.id;
        await crud.removerRegistro(tabela, id);
        res.json({ message: `${capitalize(entidadeNome)} ${getGeneroTexto(entidadeNome, 'removid')} com sucesso` });
      } catch (error) {
        console.error(`Erro ao remover ${entidadeNome}:`, error);
        res.status(500).json({ message: `Erro ao remover ${entidadeNome}`, error });
      }
    }
  };
}

module.exports = gerarController;
