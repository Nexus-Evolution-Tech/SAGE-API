const path = require('path');
const fs = require('fs/promises');

const verificaSeFotoUserExiste = async (userId) => {
  const fotoPath = path.join(__dirname, '..', 'uploads', 'pessoas', `pessoa_${userId}.png`);
  try {
    await fs.access(fotoPath); // tenta acessar o arquivo
    return true; // se conseguiu, o arquivo existe
  } catch {
    return false; // se deu erro, não existe
  }
};

const deletarFotoUserPorId = async (userId) => {
  const fotoPath = path.join(__dirname, '..', 'uploads', 'pessoas', `pessoa_${userId}.png`);

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
  deletarFotoUserPorId
}