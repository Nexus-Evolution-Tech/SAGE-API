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

    // chama o bot Python pra ler a planilha e inserir no banco
    const python = spawn('python', ['bot/importar_dados.py', filePath]);

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
    const exportPath = path.resolve(`exports/pessoas_export_${Date.now()}.xlsx`);

    // chama o bot Python pra gerar a planilha com dados do banco
    const python = spawn('python', ['bot/exportar_dados.py', exportPath]);

    python.stdout.on('data', (data) => {
      console.log(`BOT EXPORTAR: ${data}`);
    });

    python.stderr.on('data', (data) => {
      console.error(`ERRO BOT EXPORTAR: ${data}`);
    });

    python.on('close', (code) => {
      console.log(`Bot de exportação finalizado com código ${code}`);
      res.download(exportPath, 'pessoas_exportadas.xlsx');
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao exportar dados.' });
  }
});

module.exports = router;
