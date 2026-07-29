const fs = require('fs');
const path = require('path');

function loadRoutes(app, routesFolder = path.join(__dirname, '../routes')) {
  const files = fs.readdirSync(routesFolder);
  const routeFiles = files.filter(
    (file) => file.endsWith('Routes.js') && file !== 'genericRoutes.js'
  );
  console.log('[BOOT-ROUTES] arquivos:', files);
  routeFiles.forEach((file) => {
    const routePath = path.join(routesFolder, file);
    console.log(`[BOOT-ROUTES] carregando ${file}...`);
    const route = require(routePath);
    console.log(`[BOOT-ROUTES] ${file} carregado`);
    app.use('/', route);
  });
  return routeFiles;
}

module.exports = loadRoutes;
