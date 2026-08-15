const gerarController = require('./genericControllerFactory');
const db = require('../config/database');
const path = require('path');
const fs = require('fs');
const { get } = require('http');
const { paths } = require('../config/paths');
const { responderErroInterno } = require('../utils/responderErroInterno');

const tabela = 'UnidadeFoto';
const campos = ['id', 'unidade_id', 'tipo', 'caminho', 'descricao'];

const getUrls = async (req, res) => {
  const [fotos] = await db.query('SELECT * FROM UnidadeFoto');

  if (!fotos || fotos.length === 0) {
    return res.status(404).json({ message: 'Nenhuma foto encontrada para esta unidade' });
  }

  const urls = fotos.map(foto => ({
    id: foto.id,
    url: `${req.protocol}://${req.get('host')}/uploads/escolas/${foto.caminho}`,
    descricao: foto.descricao
  }));

  res.json(urls);
}

const getUrlById = async (req, res) => {
  const id = req.params.id;
  const [foto] = await db.query('SELECT * FROM UnidadeFoto WHERE id = ?', [id]);
  if (!foto) {
      return res.status(404).json({ message: 'Foto não encontrada' });
  }
  const url = `${req.protocol}://${req.get('host')}/uploads/escolas/${foto[0].caminho}`;

  res.json({ url: url, descricao: foto.descricao });
};

const uploadFoto = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Arquivo não enviado' });

  const { unidade_id, tipo, descricao } = req.body;
  const ext = path.extname(req.file.filename);

  // Caminho /escolas
  const baseUploads = paths.uploads;
  const pastaDestino = path.join(baseUploads, 'escolas');

  if (!fs.existsSync(pastaDestino)) {
    fs.mkdirSync(pastaDestino, { recursive: true });
  }

  try {
    // Insere no banco com nome temporário e caminho relativo à pasta temp (antes de mover)
    const [result] = await db.query(
      'INSERT INTO UnidadeFoto (unidade_id, tipo, caminho, descricao) VALUES (?, ?, ?, ?)',
      [unidade_id, tipo, req.file.filename, descricao]
    );

    const novoNome = `escola_${result.insertId}${ext}`;
    const antigoCaminho = path.join(baseUploads, req.file.filename);
    const novoCaminho = path.join(pastaDestino, novoNome);

    // Move (ou renomeia) o arquivo para a pasta correta
    fs.renameSync(antigoCaminho, novoCaminho);

    // Atualiza o caminho no banco para refletir a pasta correta
    const caminhoRelativo = path.join(novoNome).replace(/\\/g, '/');
    await db.query('UPDATE UnidadeFoto SET caminho = ? WHERE id = ?', [caminhoRelativo, result.insertId]);

    res.status(201).json({ id: result.insertId, caminho: caminhoRelativo });
  } catch (error) {
    responderErroInterno(res, error, 'Erro ao salvar a foto');
  }
};

const controllerGenerico = gerarController(tabela, campos, 'foto da escola');
module.exports = {
  ...controllerGenerico,
  getUrls,
  getUrlById,
  uploadFoto
}
