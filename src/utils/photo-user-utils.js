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
    console.log(`Foto do usuário ${userId} deletada com sucesso.`);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`Foto do usuário ${userId} não encontrada para deletar.`);
      return false;
    } else {
      console.error(`Erro ao deletar foto do usuário ${userId}:`, err);
      throw err; // Se for outro erro, relança para o chamador tratar
    }
  }
};

module.exports = {
  verificaSeFotoUserExiste,
  deletarFotoUserPorId
}