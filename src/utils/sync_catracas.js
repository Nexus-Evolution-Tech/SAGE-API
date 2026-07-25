const db = require('../config/database');
const { criarNovaPessoaNasCatracas, editarPessoaNasCatracas, deletarPessoaDasCatracas } = require('../services/controlIdService'); // DEPENDÊNCIA CIRCULAR?

async function sincronizarTodasPessoasNasCatracas() {
  try {
    const [pessoas] = await db.query('SELECT * FROM Pessoa') // ou `await db.query(...)` se for mysql2


    for (const pessoa of pessoas) {
      try {
        await criarNovaPessoaNasCatracas(pessoa);
      } catch (erroPessoa) {
        // Ignora erros de sincronização individual
      }
    }

  } catch (erroGeral) {
  }
}

async function verificarSyncPendentes(dispositivo) {
  try {
    // Verifica se a sincronização está ativa para este dispositivo
    if (dispositivo.sync_enabled === false || dispositivo.sync_enabled === 0) {
      return; // Não sincroniza se estiver desativado
    }
    
    // 1. Obter registros da tabela sync_pendente
    const pendentes = await global.db('sync_pendente').select('*').where('dispositivo_id', dispositivo.id).get();

    // 2. Para cada registro pendente, chama a função correspondente
    for (const registro of pendentes) {
      try {
        // A consulta agora retorna um array, então acessamos o primeiro item diretamente
        const pessoa = await global.db('Pessoa')
          .select('*')
          .where('id', registro.pessoa_id)
          .first();
        
        // Checar a ação (CREATE, UPDATE, DELETE)
        if (registro.operation === 'CREATE') {
          await criarNovaPessoaNasCatracas(pessoa, { dispositivoId: dispositivo.id });
        } else if (registro.operation === 'UPDATE') {
          await editarPessoaNasCatracas(pessoa.id, pessoa.nome, pessoa.cartao_rfid, { dispositivoId: dispositivo.id });
        } else if (registro.operation === 'DELETE') {
          await deletarPessoaDasCatracas(pessoa.id, { dispositivoId: dispositivo.id });
        }

        // Após a sincronização bem-sucedida, removemos da tabela de pendentes
        await global.db('sync_pendente').where('id', registro.id).del();
      } catch (erro) {
      }
    }
  } catch (error) {
  }
}

module.exports = {
  sincronizarTodasPessoasNasCatracas,
  verificarSyncPendentes
};
