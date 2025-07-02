const gerarController = require('./genericControllerFactory');
const db = require('../config/database');

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

const controllerGenerico = gerarController(tabela, campos, 'foto da escola');
module.exports = {
  ...controllerGenerico,
  getUrlById
}
