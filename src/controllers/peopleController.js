// PESSOA N TEM COMO GENERALIZAR, ELA TEM FUNCOES MTO ESPECIFICAS EM SEU CRUD
const peopleService = require('../services/peopleService');
const controlIdService = require('../services/controlIdService');
const { buscarTodasPessoas, buscarPorId, atualizarPessoaCompleta, removerPessoa } = require('../utils/people-db-utils');
const ajustarFusoHorarioBrasil = require('../utils/ajustaFusoHorario');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { criarImagemUsuario } = require('../services/controlIdService');
const { buscarPessoaBase } = require('../utils/people-db-utils');
const { sincronizarTodasPessoasNasCatracas } = require('../utils/sync_catracas');
const registrarSyncPendente = require('../services/sync');
const gerarNumero8Digitos = require('../utils/gerarNumero8Digitos');
const { ACOES, executarOperacaoAuditada } = require('../services/auditoriaService');
const { responderErroInterno } = require('../utils/responderErroInterno');

// --- LISTAR (Sem alterações) ---
const listar = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  try {
    const pessoas = await buscarTodasPessoas(limit, offset);
    const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM Pessoa WHERE visivel = 1');

    res.json({
      data: ajustarFusoHorarioBrasil(pessoas),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    responderErroInterno(res, error, 'Erro ao listar pessoas');
  }
};

// --- CRIAR ---
const criar = async (req, res) => {
  try {
    // 1. Salva no banco
    const pessoaCriada = await peopleService.criarPessoaCompleta(req.body);
    const id = pessoaCriada.idPessoa;
    const pessoa = await buscarPessoaBase(id);

    // const novaPessoaParaCatraca = {
    //   id: pessoa.id,
    //   nome: pessoa.nome,
    //   cartao_rfid: pessoa.cartao_rfid,
    //   qrcode: pessoa.qr_code
    // };

    res.status(201).json({
      message: 'Pessoa criada com sucesso',
      pessoa: pessoaCriada,
      ignorados: pessoaCriada.ignorados || [],
      sincronizacao: { status: 'iniciada', message: 'Sincronização com catraca em background' }
    });

    // 2. Sincroniza com catraca (em background - não bloqueia resposta)
    // if (pessoa.tipo !== 'RESPONSAVEL') {
    //   controlIdService.criarNovaPessoaNasCatracas(novaPessoaParaCatraca).catch(() => {
    //     // Se falhar, já está registrado em sync_pendente para retry automático
    //   });
    // }

  } catch (error) {
    res.status(400).json({
      message: 'Falha ao criar pessoa',
      erro: error.message,
      detalhes: error.detalhes
    });
  }
};

// --- GET STATUS (Sem alterações) ---
const getStatus = async (req, res) => {
  try {
    const estaPresenteAtrasado = await peopleService.verificarTodasPessoasPresentesEAtrasadas();
    res.json(estaPresenteAtrasado);
  } catch (error) {
    responderErroInterno(res, error, 'Erro ao listar pessoas');
  }
};

// --- GET STATUS ID (Sem alterações) ---
const getStatusId = async (req, res) => {
  const id = req.params.id;
  try {
    const estaPresente = await peopleService.verificarPessoaPresenteEAtrasada(id);
    res.json(estaPresente);
  } catch (error) {
    responderErroInterno(res, error, 'Erro ao listar pessoas');
  }
};

// --- LISTAR POR ID (Sem alterações) ---
const listarPorId = async (req, res) => {
  const id = req.params.id;
  try {
    const pessoas = await buscarPorId(id);
    res.json(ajustarFusoHorarioBrasil(pessoas));
  } catch (error) {
    responderErroInterno(res, error, 'Erro ao listar pessoas');
  }
};

// --- LISTAR POR TIPO (Sem alterações) ---
const listarPorTipo = async (req, res) => {
  const tipo = req.params.tipo;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  try {
    const pessoas = await peopleService.buscarPessoasPorTipo(tipo, limit, offset);
    const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM Pessoa WHERE tipo = ? AND visivel = 1', [tipo]);

    res.json({
      data: ajustarFusoHorarioBrasil(pessoas),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    responderErroInterno(res, error, 'Erro ao listar pessoas por tipo');
  }
};

// --- EDITAR ---
const editar = async (req, res) => {
  try {
    const id = req.params.id;

    const resultado = await executarOperacaoAuditada({
      req, acao: ACOES.REGISTRO_EDITADO, entidade: 'Pessoa', entidadeId: Number(id),
      operacao: async (connection) => {
        const atualizacao = await atualizarPessoaCompleta(id, req.body, connection);
        await registrarSyncPendente(id, 'UPDATE', connection);
        return atualizacao;
      }
    });

    // A sincronização física continua assíncrona; a fila local faz parte desta transação.
    // if (req.body.nome || req.body.cartao_rfid) {
    //   buscarPessoaBase(id).then(pessoaAtualizada => {
    //     return controlIdService.editarPessoaNasCatracas(id, pessoaAtualizada.nome, pessoaAtualizada.cartao_rfid);
    //   }).catch(() => {
    //     // Se falhar, já está registrado em sync_pendente para retry automático
    //   });
    // }
    res.json({ message: 'Pessoa atualizada com sucesso', ignorados: resultado?.ignorados || [], sincronizacao: { status: 'iniciada', message: 'Sincronização com catraca em background' } });
  } catch (error) {
    if (error.code === 'ESCRITA_CHAVE_NAO_DECLARADA' || error.code === 'ESCRITA_NENHUM_CAMPO_APLICAVEL') {
      return res.status(400).json({ message: error.message, chaves: error.chaves || [], ignorados: error.ignorados || [] });
    }
    responderErroInterno(res, error, 'Erro ao editar pessoa');
  }
};

// --- DELETAR ---
const deletar = async (req, res) => {
  try {
    const id = req.params.id;
    
    await executarOperacaoAuditada({
      req, acao: ACOES.REGISTRO_DELETADO, entidade: 'Pessoa', entidadeId: Number(id),
      operacao: async (connection) => {
        await removerPessoa(id, connection);
        await registrarSyncPendente(id, 'DELETE', connection);
      }
    });

    let resultados = { message: "Sincronização com catraca em background" };
    // 2. Sincronização com catraca
    // let resultados = { message: "Catraca não sincronizada" };
    // try {
    //   resultados = await controlIdService.deletarPessoaDasCatracas(id);
    // } catch (errorCatraca) {
    //   resultados = { error: errorCatraca.message };
    // }

    res.json({ message: 'Pessoa removida com sucesso', catracas: resultados });
  } catch (error) {
    responderErroInterno(res, error, 'Erro ao remover pessoa');
  }
};

// --- GET URLS (Sem alterações) ---
const getUrls = async (req, res) => {
  try {
    const pessoas = await buscarTodasPessoas();

    if (!pessoas || pessoas.length === 0) {
      return res.status(404).json({ message: 'Nenhuma pessoa encontrada para esta unidade' });
    }
    
    const urls = pessoas.map(pessoa => ({
      id: pessoa.id,
      url: `${req.protocol}://${req.get('host')}/pessoas/${pessoa.id}/foto`,
    }));

    res.json(urls);
  } catch (error) {
    responderErroInterno(res, error, 'Erro ao buscar URLs das pessoas');
  }
}

// --- GET URL BY ID (Sem alterações) ---
const getUrlById = async (req, res) => {
  const id = req.params.id;
  const [pessoas] = await db.query('SELECT id FROM Pessoa WHERE id = ?', [id]);
  if (!pessoas.length) {
      return res.status(404).json({ message: 'Pessoa não encontrada' });
  }
  const url = `${req.protocol}://${req.get('host')}/pessoas/${id}/foto`;

  res.json({ url: url });
};

// --- UPLOAD FOTO ---
const uploadFoto = async (req, res) => {
  try {
    await peopleService.uploadFotoPessoa(req, res); 
    
    // Sincronização com catraca
    // if(req.file) {
    //   try {
    //     await criarImagemUsuario(req.params.id);
    //   } catch (errorCatraca) {
    //     // Ignora erro de sincronização
    //   }
    // }
    // await registrarSyncPendente(req.params.id, 'UPLOAD_PHOTO'); - a partir do momento em que eu clico em salvar ja cadastra um UPDATE em sync_pendente

    res.json({ message: 'Foto enviada com sucesso', file: req.file ? req.file.filename : null, sincronizacao: { status: 'iniciada', message: 'Sincronização com catraca em background' } });
  } catch (error) {
    if (!res.headersSent) {
      responderErroInterno(res, error, 'Erro ao enviar foto');
    }
  }
}

// --- GERAR QRCODE ---
const gerarQrCode = async (req, res) => {
  const id = req.params.id;
  try {
    const qrcode = gerarNumero8Digitos();

    await executarOperacaoAuditada({
      req, acao: ACOES.REGISTRO_EDITADO, entidade: 'Pessoa', entidadeId: Number(id),
      operacao: (connection) => connection.query(
        'UPDATE Pessoa SET qr_code = ? WHERE id = ?', [qrcode, id]
      )
    });

    // await registrarSyncPendente(id, 'UPDATE'); - a partir do momento em que eu clico em salvar ja cadastra um UPDATE em sync_pendente

    res.json({ message: "QR Code gerado com sucesso", id, qr_code: qrcode });
  } catch (error) {
    responderErroInterno(res, error, 'Erro ao gerar qrcode');
  }
}

// --- SINCRONIZAR BANCO ---
const sincronizarBanco = async (req, res) => {
  try {
    await sincronizarTodasPessoasNasCatracas();
    res.json({ message: "Sincronização concluída com sucesso" });
  } catch (error) {
    responderErroInterno(res, error, 'Erro ao sincronizar banco');
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
  servirFotoPessoa: peopleService.servirFotoPessoa,
  uploadFoto,
  gerarQrCode,
  sincronizarBanco
};
