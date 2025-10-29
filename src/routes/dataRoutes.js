const express = require('express');
const multer = require('multer');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../config/database');
const { sincronizarTodasPessoasNasCatracas } = require('../utils/sync_catracas');

const router = express.Router();
const upload = multer({ dest: 'src/uploads/' });

// -------------------------------------------------------
// 1️⃣ Baixar planilha modelo
// -------------------------------------------------------
router.get('/dados/planilha-modelo', (req, res) => {
  const modeloPath = path.resolve('./models/PlanilhaPessoas-Modelo.xlsx');
  res.download(modeloPath, 'PlanilhaPessoas.xlsx');
});

// -------------------------------------------------------
// 2️⃣ Importar planilha preenchida
// -------------------------------------------------------
router.post('/dados/importar', upload.single('planilha'), async (req, res) => {
  try {
    const filePath = req.file.path;
    const unidade_id_default = req.body.unidade_id || 1;

    // chama o bot Python pra ler a planilha e inserir no banco
    const python = spawn('python', ['bot/importar_dados.py', filePath, unidade_id_default]); // 1 = unidade_id_default

    python.stdout.on('data', (data) => {
      console.log(`BOT IMPORTAR: ${data}`);
    });

    python.stderr.on('data', (data) => {
      console.error(`ERRO BOT IMPORTAR: ${data}`);
    });

    python.on('close', async (code) => {
      console.log(`Bot de importação finalizado com código ${code}`);

      // após inserir no banco, sincroniza pessoas nas catracas
      await sincronizarTodasPessoasNasCatracas();

      res.json({ message: 'Importação concluída e sincronização executada com sucesso!' });
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao importar planilha.' });
  }
});

// -------------------------------------------------------
// 3️⃣ Exportar dados do banco no formato da planilha
// -------------------------------------------------------
router.get('/dados/exportar', async (req, res) => {
  try {
    // define o caminho completo do arquivo de saída
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportPath = path.resolve(`exports/exportacao_${timestamp}.xlsx`);

    // chama o bot Python passando o caminho como argumento
    const python = spawn('python', ['bot/exportar_dados.py', exportPath]);

    python.stdout.on('data', (data) => {
      const text = data.toString('utf8');
      console.log(`BOT EXPORTAR: ${text}`);
    });

    python.stderr.on('data', (data) => {
      console.error(`ERRO BOT EXPORTAR: ${data.toString('utf8')}`);
    });

    python.on('close', (code) => {
      console.log(`Bot de exportação finalizado com código ${code}`);

      if (code === 0) {
        res.download(exportPath, path.basename(exportPath));
      } else {
        res.status(500).json({ error: 'Erro ao exportar os dados.' });
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao exportar dados.' });
  }
});

module.exports = router;
