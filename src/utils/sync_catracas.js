const db = require('../config/database');
const { criarNovaPessoaNasCatracas, editarPessoaNasCatracas, deletarPessoaDasCatracas } = require('../services/controlIdService');

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

async function verificarSyncPendentes(dispositivo) {
  try {
    // 1. Obter registros da tabela sync_pendente
    const pendentes = await db.query('SELECT * FROM sync_pendente WHERE dispositivo_id = ?', [dispositivo.id]);

    // 2. Para cada registro pendente, chama a função correspondente
    for (const registro of pendentes) {
      try {
        // A consulta agora retorna um array, então acessamos o primeiro item diretamente
        const pessoa = (await db.query('SELECT * FROM Pessoa WHERE id = ?', [registro.pessoa_id]))[0];
        
        // Checar a ação (CREATE, UPDATE, DELETE)
        if (registro.action === 'CREATE') {
          await criarNovaPessoaNasCatracas(pessoa, { dispositivoId: dispositivo.id });
          console.log(`Pessoa ${pessoa.nome} criada nas catracas.`);
        } else if (registro.action === 'UPDATE') {
          await editarPessoaNasCatracas(pessoa.id, pessoa.nome, pessoa.cartao_rfid, { dispositivoId: dispositivo.id });
          console.log(`Pessoa ${pessoa.nome} atualizada nas catracas.`);
        } else if (registro.action === 'DELETE') {
          await deletarPessoaDasCatracas(pessoa.id, { dispositivoId: dispositivo.id });
          console.log(`Pessoa ${pessoa.nome} deletada das catracas.`);
        }

        // Após a sincronização bem-sucedida, removemos da tabela de pendentes
        await db('sync_pendente').where('id', registro.id).del();
        console.log(`Registro de sincronização de ${pessoa.nome} removido da tabela sync_pendente.`);
      } catch (erro) {
        console.error(`Erro ao processar o registro pendente para a pessoa ID ${registro.pessoa_id}:`, erro.message);
      }
    }
  } catch (error) {
    console.error('Erro ao verificar sincronização pendente:', error.message);
  }
}

// Função de obtenção da sessão
async function obterSessao(linkCatraca, dispositivo) {
  try {
    const response = await axios.post(`http://${linkCatraca}/login.fcgi`, {
      login: dispositivo.usuario,
      password: dispositivo.senha
    });
    console.log(`Sessão obtida para ${dispositivo.nome}:`, response.data.session);
    return response.data.session;
  } catch (error) {
    console.error(`Erro ao obter sessão para ${dispositivo?.nome}:`, error.message);
    return null;
  }
}

module.exports = {
  sincronizarTodasPessoasNasCatracas,
  verificarSyncPendentes
};
