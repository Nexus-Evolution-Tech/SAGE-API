// services/syncService.js
// Serviço de sincronização que coordena operações entre controlIdService e sync_catracas

async function verificarSyncPendentes(dispositivo) {
  try {
    // Importa dinamicamente para evitar dependência circular
    const { criarNovaPessoaNasCatracas, editarPessoaNasCatracas, deletarPessoaDasCatracas } = require('./controlIdService');
    
    // 1. Obter registros da tabela sync_pendente
    const pendentes = await global.db('sync_pendente').select('*').where('dispositivo_id', dispositivo.id);

    console.log(`🔄 Verificando ${pendentes.length} sincronizações pendentes para dispositivo ${dispositivo.nome}...`);

    // 2. Para cada registro pendente, chama a função correspondente
    for (const registro of pendentes) {
      try {
        const pessoa = await global.db('Pessoa')
          .select('*')
          .where('id', registro.pessoa_id)
          .first();
        
        if (!pessoa) {
          console.warn(`⚠️  Pessoa ID ${registro.pessoa_id} não encontrada. Removendo registro pendente.`);
          await global.db('sync_pendente').where('id', registro.id).del();
          continue;
        }

        // Checar a ação (CREATE, UPDATE, DELETE)
        if (registro.action === 'CREATE') {
          await criarNovaPessoaNasCatracas(pessoa, { dispositivoId: dispositivo.id });
          console.log(`✅ Pessoa ${pessoa.nome} criada nas catracas.`);
        } else if (registro.action === 'UPDATE') {
          await editarPessoaNasCatracas(pessoa.id, pessoa.nome, pessoa.cartao_rfid, { dispositivoId: dispositivo.id });
          console.log(`✅ Pessoa ${pessoa.nome} atualizada nas catracas.`);
        } else if (registro.action === 'DELETE') {
          await deletarPessoaDasCatracas(pessoa.id, { dispositivoId: dispositivo.id });
          console.log(`✅ Pessoa ${pessoa.nome} deletada das catracas.`);
        }

        // Após a sincronização bem-sucedida, removemos da tabela de pendentes
        await global.db('sync_pendente').where('id', registro.id).del();
        console.log(`🗑️  Registro de sincronização de ${pessoa.nome} removido da tabela sync_pendente.`);
      } catch (erro) {
        console.error(`❌ Erro ao processar o registro pendente para a pessoa ID ${registro.pessoa_id}:`, erro.message);
      }
    }

    console.log(`✅ Verificação de sincronização pendente concluída para ${dispositivo.nome}`);
  } catch (error) {
    console.error('❌ Erro ao verificar sincronização pendente:', error.message);
  }
}

async function sincronizarTodasPessoasNasCatracas() {
  try {
    const { criarNovaPessoaNasCatracas } = require('./controlIdService');
    const [pessoas] = await global.db.raw('SELECT * FROM Pessoa');

    console.log(`📋 Encontradas ${pessoas.length} pessoas para sincronizar.`);

    let sucessos = 0;
    let erros = 0;

    for (const pessoa of pessoas) {
      try {
        await criarNovaPessoaNasCatracas(pessoa);
        console.log(`✅ Pessoa ${pessoa.nome} (ID: ${pessoa.id}) sincronizada com sucesso.`);
        sucessos++;
      } catch (erroPessoa) {
        console.error(`❌ Erro ao sincronizar pessoa ${pessoa.nome} (ID: ${pessoa.id}):`, erroPessoa.message);
        erros++;
      }
    }

    console.log(`✅ Sincronização concluída. Sucessos: ${sucessos}, Erros: ${erros}`);
    return { sucessos, erros, total: pessoas.length };
  } catch (erroGeral) {
    console.error('❌ Erro ao buscar pessoas ou sincronizar:', erroGeral.message);
    throw erroGeral;
  }
}

module.exports = {
  verificarSyncPendentes,
  sincronizarTodasPessoasNasCatracas
};
