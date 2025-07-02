const gerarController = require('./genericControllerFactory');
const db = require('../config/database');
const path = require('path');
const fs = require('fs');

const tabela = 'UnidadeFoto';
const campos = ['id', 'unidade_id', 'tipo', 'caminho', 'descricao'];

const getUrlById = async (req, res) => {
  const id = req.params.id;
  const [foto] = await db.query('SELECT * FROM UnidadeFoto WHERE id = ?', [id]);
  if (!foto) {
      return res.status(404).json({ message: 'Foto não encontrada' });
  }
  const url = `http://localhost:3000/uploads/${foto[0].caminho}`;

  res.json({ url: url, descricao: foto.descricao });
};

const uploadFoto = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Arquivo não enviado' });

  const { unidade_id, tipo, descricao } = req.body;
  const ext = path.extname(req.file.filename);

  // Caminho /escolas
  const baseUploads = path.resolve(__dirname, '..', 'uploads');
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
    const antigoCaminho = path.resolve(__dirname, '..', 'uploads', req.file.filename);
    const novoCaminho = path.join(pastaDestino, novoNome);

    // Move (ou renomeia) o arquivo para a pasta correta
    fs.renameSync(antigoCaminho, novoCaminho);

    // Atualiza o caminho no banco para refletir a pasta correta
    const caminhoRelativo = path.join('escolas', novoNome).replace(/\\/g, '/');
    await db.query('UPDATE UnidadeFoto SET caminho = ? WHERE id = ?', [caminhoRelativo, result.insertId]);

    res.status(201).json({ id: result.insertId, caminho: caminhoRelativo });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erro ao salvar a foto' });
  }
};

const controllerGenerico = gerarController(tabela, campos, 'foto da escola');
module.exports = {
  ...controllerGenerico,
  getUrlById,
  uploadFoto
}
