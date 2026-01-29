/*
 * Script de seed rápido para gerar acessos simulados no dia atual.
 * Uso: node scripts/seed-demo-acessos.js
 */

const db = require('../src/config/database');

async function main() {
  try {
    const [pessoas] = await db.query('SELECT id FROM Pessoa LIMIT 5');
    if (!pessoas || pessoas.length === 0) {
      console.error('Nenhuma pessoa encontrada na tabela Pessoa. Cadastre pessoas antes de rodar o seed.');
      process.exit(1);
    }

    const now = new Date();
    const baseDia = now.toISOString().split('T')[0];

    const amostras = pessoas.slice(0, 5).map((p, idx) => {
      const entrada = new Date(`${baseDia}T07:30:00-03:00`);
      entrada.setMinutes(entrada.getMinutes() + idx * 7);
      return {
        pessoa_id: p.id,
        dispositivo_id: 1,
        status: 'ENTRADA',
        permitido: 1,
        metodo_auth: 'SIMULADO',
        data_hora: entrada,
      };
    });

    for (const acesso of amostras) {
      await db.query('INSERT INTO Acesso SET ?', acesso);
    }

    console.log(`✅ Inseridos ${amostras.length} acessos simulados para ${baseDia}.`);
    process.exit(0);
  } catch (err) {
    console.error('Erro ao executar seed:', err.message);
    process.exit(1);
  }
}

main();
