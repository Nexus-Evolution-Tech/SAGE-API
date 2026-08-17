const path = require('path');
const fs = require('fs/promises');
const db = require('../config/database');
const { paths } = require('../config/paths');

const obterCaminhoFotoPessoa = async (userId) => {
  const [pessoas] = await db.query('SELECT foto FROM Pessoa WHERE id = ?', [userId]);
  if (!pessoas.length || !pessoas[0].foto) return null;
  const raiz = await fs.realpath(paths.uploads);
  const referencia = String(pessoas[0].foto).replace(/\\/g, '/').replace(/^pessoas\//i, '');
  const pasta = path.resolve(raiz, 'pessoas');
  const fotoPath = path.resolve(pasta, referencia);
  const relativo = path.relative(pasta, fotoPath);
  if (relativo === '..' || relativo.startsWith(`..${path.sep}`) || path.isAbsolute(relativo)) {
    const erro = new Error('Caminho de foto fora de uploads');
    erro.code = 'PESSOA_FOTO_CAMINHO_FORA_UPLOADS';
    throw erro;
  }
  try {
    const caminhoReal = await fs.realpath(fotoPath);
    const relativoReal = path.relative(pasta, caminhoReal);
    if (relativoReal === '..' || relativoReal.startsWith(`..${path.sep}`) || path.isAbsolute(relativoReal)) {
      const erro = new Error('Caminho de foto fora de uploads');
      erro.code = 'PESSOA_FOTO_CAMINHO_FORA_UPLOADS';
      throw erro;
    }
    return caminhoReal;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const verificaSeFotoUserExiste = async (userId) => {
  const fotoPath = await obterCaminhoFotoPessoa(userId);
  if (!fotoPath) return false;
  try {
    await fs.access(fotoPath); // tenta acessar o arquivo
    return true; // se conseguiu, o arquivo existe
  } catch {
    return false; // se deu erro, não existe
  }
};

const deletarFotoUserPorId = async (userId) => {
  const fotoPath = await obterCaminhoFotoPessoa(userId);
  if (!fotoPath) return false;

  try {
    await fs.unlink(fotoPath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    } else {
      throw err;
    }
  }
};

module.exports = {
  verificaSeFotoUserExiste,
  deletarFotoUserPorId,
  obterCaminhoFotoPessoa
}
