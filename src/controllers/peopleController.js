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

// --- LISTAR (Sem alterações) ---
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
    res.status(500).json({ message: 'Erro ao listar pessoas', error: error.message });
  }
};

// --- CRIAR ---
const criar = async (req, res) => {
  try {
    // 1. Salva no banco
    const pessoaCriada = await peopleService.criarPessoaCompleta(req.body);
    const id = pessoaCriada.idPessoa;
    const pessoa = await buscarPessoaBase(id);

    const novaPessoaParaCatraca = {
      id: pessoa.id,
      nome: pessoa.nome,
      cartao_rfid: pessoa.cartao_rfid,
      qrcode: pessoa.qr_code
    };

    res.status(201).json({
      message: 'Pessoa criada com sucesso',
      pessoa: pessoaCriada,
      sincronizacao: { status: 'iniciada', message: 'Sincronização com catraca em background' }
    });

    // 2. Sincroniza com catraca (em background - não bloqueia resposta)
    if (pessoa.tipo !== 'RESPONSAVEL') {
      controlIdService.criarNovaPessoaNasCatracas(novaPessoaParaCatraca).catch(() => {
        // Se falhar, já está registrado em sync_pendente para retry automático
      });
    }

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
    res.status(500).json({ message: 'Erro ao listar pessoas', error: error.message });
  }
};

// --- GET STATUS ID (Sem alterações) ---
const getStatusId = async (req, res) => {
  const id = req.params.id;
  try {
    const estaPresente = await peopleService.verificarPessoaPresenteEAtrasada(id);
    res.json(estaPresente);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar pessoas', error: error.message });
  }
};

// --- LISTAR POR ID (Sem alterações) ---
const listarPorId = async (req, res) => {
  const id = req.params.id;
  try {
    const pessoas = await buscarPorId(id);
    res.json(ajustarFusoHorarioBrasil(pessoas));
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar pessoas', error: error.message });
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
    const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM Pessoa WHERE tipo = ?', [tipo]);

    res.json({
      data: ajustarFusoHorarioBrasil(pessoas),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar pessoas por tipo', error: error.message });
  }
};

// --- EDITAR ---
const editar = async (req, res) => {
  try {
    const id = req.params.id;

    // 1. Atualiza no banco de dados local
    await atualizarPessoaCompleta(id, req.body);

    // 2. Sincronização com catraca (em background - não bloqueia resposta)
    if (req.body.nome || req.body.cartao_rfid) {
      buscarPessoaBase(id).then(pessoaAtualizada => {
        return controlIdService.editarPessoaNasCatracas(id, pessoaAtualizada.nome, pessoaAtualizada.cartao_rfid);
      }).catch(() => {
        // Se falhar, já está registrado em sync_pendente para retry automático
      });
    }

    // 3. Retorna sucesso imediatamente
    res.json({ message: 'Pessoa atualizada com sucesso', sincronizacao: { status: 'iniciada', message: 'Sincronização com catraca em background' } });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao editar pessoa', error: error.message, detalhes: error.detalhes });
  }
};

// --- DELETAR ---
const deletar = async (req, res) => {
  try {
    const id = req.params.id;
    
    // 1. Remove do banco local
    await removerPessoa(id);

    // 2. Sincronização com catraca
    let resultados = { message: "Catraca não sincronizada" };
    try {
      resultados = await controlIdService.deletarPessoaDasCatracas(id);
    } catch (errorCatraca) {
      resultados = { error: errorCatraca.message };
    }

    res.json({ message: 'Pessoa removida com sucesso', catracas: resultados });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover pessoa', error: error.message });
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
      url: `${req.protocol}://${req.get('host')}/uploads/pessoas/${pessoa.foto}`,
    }));

    res.json(urls);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar URLs das pessoas', error: error.message });
  }
}

// --- GET URL BY ID (Sem alterações) ---
const getUrlById = async (req, res) => {
  const id = req.params.id;
  const [pessoa] = await db.query('SELECT * FROM Pessoa WHERE id = ?', [id]);
  if (!pessoa) {
      return res.status(404).json({ message: 'Pessoa não encontrada' });
  }
const url = `${req.protocol}://${req.get('host')}/uploads/pessoas/${pessoa[0].foto}`;

  res.json({ url: url });
};

// --- UPLOAD FOTO ---
const uploadFoto = async (req, res) => {
  try {
    await peopleService.uploadFotoPessoa(req, res); 
    
    // Sincronização com catraca
    if(req.file) {
      try {
        await criarImagemUsuario(req.params.id);
      } catch (errorCatraca) {
        // Ignora erro de sincronização
      }
    }
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ message: 'Erro ao enviar foto', error: error.message });
    }
  }
}

// --- GERAR QRCODE ---
const gerarQrCode = async (req, res) => {
  const id = req.params.id;
  try {
    const data = await generateQrCode(id);

    const query = `UPDATE Pessoa SET qr_code = ? WHERE id = ?`;
    await db.query(query, [data.qrcode, id]);

    res.json({ message: "QR Code gerado com sucesso", id, qr_code: data.qrcode });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar qrcode', error: error.message });
  }
}

// --- SINCRONIZAR BANCO ---
const sincronizarBanco = async (req, res) => {
  try {
    await sincronizarTodasPessoasNasCatracas();
    res.json({ message: "Sincronização concluída com sucesso" });
  } catch (error) {
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
