const fs = require('fs');
const path = require('path');

function loadRoutes(app, routesFolder = path.join(__dirname, '../routes')) {
  const files = fs.readdirSync(routesFolder);
  console.log('[BOOT-ROUTES] arquivos:', files);
  files.forEach((file) => {
    if (file.endsWith('Routes.js') && file !== 'genericRoutes.js') {
      const routePath = path.join(routesFolder, file);
      console.log(`[BOOT-ROUTES] carregando ${file}...`);
      const route = require(routePath);
      console.log(`[BOOT-ROUTES] ${file} carregado`);
      app.use('/', route);
    }
  });
}

module.exports = loadRoutes;
