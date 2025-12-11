// index.js
const app = require('./src/app');
const env = require('./src/config/environment');

const PORT = env.server.port;

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
  console.log(`Ambiente: ${env.server.nodeEnv}`);
});