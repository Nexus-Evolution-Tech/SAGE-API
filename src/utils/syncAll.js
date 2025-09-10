const { criarNovaPessoaNasCatracas } = require('../services/controlIdService'); // ou onde ela estiver
const db = require('../config/database'); // ajuste para sua conexão real

async function sincronizarTodasPessoasNasCatracas() {
  try {
    const [pessoas] = await db.query('SELECT * FROM Pessoa') // ou `await db.query(...)` se for mysql2

    console.log(`Encontradas ${pessoas.length} pessoas para sincronizar.`);

    for (const pessoa of pessoas) {
      try {
        await criarNovaPessoaNasCatracas(pessoa);
        console.log(`Pessoa ${pessoa.nome} (ID: ${pessoa.id}) sincronizada com sucesso.`);
      } catch (erroPessoa) {
        console.error(`Erro ao sincronizar pessoa ${pessoa.nome} (ID: ${pessoa.id}):`, erroPessoa.message);
        if (erroPessoa.detalhes) console.error(erroPessoa.detalhes);
      }
    }

    console.log('Sincronização concluída.');
  } catch (erroGeral) {
    console.error('Erro ao buscar pessoas ou sincronizar:', erroGeral.message);
  }
}

module.exports = {
  sincronizarTodasPessoasNasCatracas
};
