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
    console.error('Erro ao listar pessoas:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas', error: error.message });
  }
};

// --- CRIAR (Adaptado) ---
const criar = async (req, res) => {
  try {
    // 1. Salva no banco (Isso funciona)
    const pessoaCriada = await peopleService.criarPessoaCompleta(req.body);
    const id = pessoaCriada.idPessoa;
    const pessoa = await buscarPessoaBase(id);

    const novaPessoaParaCatraca = {
      id: pessoa.id,
      nome: pessoa.nome,
      cartao_rfid: pessoa.cartao_rfid,
      qrcode: pessoa.qr_code
    };

    // 2. Sincroniza com catraca (Desativado para testes)
    let resultados = { message: "Sincronização com catraca pulada (teste local)." };
    try {
      /*       // Bloco original comentado:
      if (pessoa.tipo !== 'RESPONSAVEL')
        resultados = await controlIdService.criarNovaPessoaNasCatracas(novaPessoaParaCatraca);
      */
      console.log("CRIAÇÃO: Sincronização com catraca pulada (teste local).");
    } catch (errorCatraca) {
      console.error('Erro ao sincronizar com catraca (ignorado):', errorCatraca);
    }

    res.status(201).json({
      message: 'Pessoa criada com sucesso (APENAS NO BANCO LOCAL)',
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

// --- GET STATUS (Sem alterações) ---
const getStatus = async (req, res) => {
  try {
    const estaPresenteAtrasado = await peopleService.verificarTodasPessoasPresentesEAtrasadas();
    res.json(estaPresenteAtrasado);
  } catch (error) {
    console.error('Erro ao listar pessoas:', error);
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
    console.error('Erro ao listar pessoas:', error);
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
    console.error('Erro ao listar pessoas:', error);
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
    console.error('Erro ao listar pessoas por tipo:', error);
    res.status(500).json({ message: 'Erro ao listar pessoas por tipo', error: error.message });
  }
};

// ==========================================================
// --- EDITAR (Adaptado conforme sua solicitação) ---
// ==========================================================
const editar = async (req, res) => {
  try {
    const id = req.params.id;

    // 1. Atualiza no banco de dados local (Isso irá funcionar)
    await atualizarPessoaCompleta(id, req.body);

    // 2. Bloco de sincronização com a catraca (Comentado para testes)
    /*     if (req.body.nome !== null && req.body.cartao_rfid !== null){
      // Esta linha tentaria editar na catraca, o que falharia
      const resultados = await controlIdService.editarPessoaNasCatracas(id, req.body.nome, req.body.cartao_rfid);
      res.json({ message: 'Pessoa atualizada com sucesso', catracas: resultados });
    }
    */
    console.log("EDIÇÃO: Sincronização com catraca pulada (teste local).");

    // 3. Retorna sucesso (pois a atualização local funcionou)
    res.json({ message: 'Pessoa atualizada com sucesso (APENAS NO BANCO LOCAL)'});
  } catch (error) {
    console.error('Erro ao atualizar pessoa:', error);
    res.status(500).json({ message: 'Erro ao editar pessoa', error: error.message, detalhes: error.detalhes });
  }
};
// ==========================================================
// --- FIM DA ADAPTAÇÃO ---
// ==========================================================


// --- DELETAR (Adaptado) ---
const deletar = async (req, res) => {
  try {
    const id = req.params.id;
    
    // 1. Remove do banco local (Isso funciona)
    await removerPessoa(id);

    // 2. Sincronização com catraca (Desativado para testes)
    // const resultados = await controlIdService.deletarPessoaDasCatracas(id); // Comentado
    const resultados = { message: "Sincronização com catraca pulada (teste local)." };
    console.log("DELETE: Sincronização com catraca pulada (teste local).");

    res.json({ message: 'Pessoa removida com sucesso (APENAS NO BANCO LOCAL)', catracas: resultados });
  } catch (error) {
    console.error('Erro ao remover pessoa:', error);
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
      url: `http://localhost:3000/uploads/pessoas/${pessoa.foto}`,
    }));

    res.json(urls);
  } catch (error) {
    console.error('Erro ao buscar URLs das pessoas:', error);
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
  const url = `http://localhost:3000/uploads/pessoas/${pessoa[0].foto}`;

  res.json({ url: url });
};

// --- UPLOAD FOTO (Adaptado) ---
const uploadFoto = async (req, res) => {
  try {
    // Isso já salva a foto localmente e envia a resposta
    await peopleService.uploadFotoPessoa(req, res); 
    
    // Sincronização com catraca (Desativado para testes)
    if(req.file) {
      // await criarImagemUsuario(req.params.id); // Comentado
      console.log("UPLOAD FOTO: Sincronização com catraca pulada (teste local).");
    }
    // else return res.status(400).json({ message: 'Arquivo de foto não enviado' }); // Lógica original
  } catch (error) {
    console.error('Erro ao enviar foto:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Erro ao enviar foto', error: error.message });
    }
  }
}

// --- GERAR QRCODE (Adaptado) ---
const gerarQrCode = async (req, res) => {
  const id = req.params.id;
  try {
    // 1. Sincronização com catraca (Desativado)
    // const data = await generateQrCode(id); // Comentado

    // 2. Cria um QR Code FAKE apenas para teste no banco local
    const fakeQrCode = `TEST_QR_${id}_${Date.now()}`;
    const data = { qrcode: fakeQrCode };
    console.log("QR CODE: Geração na catraca pulada (teste local).");

    // 3. Salva o QR Code fake no banco
    const query = `UPDATE Pessoa SET qr_code = ? WHERE id = ?`;
    await db.query(query, [data.qrcode, id]);

    res.json({ message: "QrCode FAKE gerado com sucesso (APENAS NO BANCO LOCAL)", id, qr_code: data.qrcode });
  } catch (error) {
    console.error('Erro ao gerar qrcode para users:', error);
    res.status(500).json({ message: 'Erro ao gerar qrcode', error: error.message });
  }
}

// --- SINCRONIZAR BANCO (Adaptado) ---
const sincronizarBanco = async (req, res) => {
  try {
    // await sincronizarTodasPessoasNasCatracas(); // Comentado
    console.log("SINCRONIZAÇÃO GERAL: Pulada (teste local).");
    res.json({ message: "Sincronização com catracas pulada (teste local)." });
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