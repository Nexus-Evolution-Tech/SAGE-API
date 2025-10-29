const gerarController = require('./genericControllerFactory');
const { gerarToken } = require('../utils/jwt');
const db = require('../config/database');
const { compararHash } = require('../utils/criptografia');

const tabela = 'UnidadeEscolar';
const campos = ['id', 'nome', 'numero_unidade', 'cnpj', 'login', 'senha', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep', 'telefone_contato', 'logo'];

const login = async (req, res) => {
  try {
    const unidade_id = req.params.id;
    const { usuario, senha } = req.body;

    const query = `SELECT * FROM UnidadeEscolar WHERE id = ?`;
    const [rows] = await db.query(query, [unidade_id]);
    const unidade = rows[0];

    if (!unidade) return res.status(401).json({ message: 'Usuário não encontrado' });

    const senhaCorreta = await compararHash(senha, unidade.senha);
    if (!senhaCorreta || unidade.login !== usuario)
      return res.status(401).json({ message: 'Credenciais inválidas' });

    // gera o token válido por 1h
    const token = gerarToken({ id: unidade.id, nome: unidade.nome });

    res.status(200).json({ message: 'Logado com sucesso', token });
  } catch (error) {
    console.error('Erro ao logar na escola:', error);
    res.status(500).json({ message: 'Erro interno', error: error.message });
  }
};

const controllerGerado = gerarController(tabela, campos, 'escola');

module.exports = {
  ...controllerGerado, // espalha os métodos CRUD do genericControllerFactory
  login
};

