const fs = require('fs');
const path = require('path');

function loadRoutes(app, routesFolder = path.join(__dirname, '../routes')) {
  const files = fs.readdirSync(routesFolder);
  const routeFiles = files.filter(
    (file) => file.endsWith('Routes.js') && file !== 'genericRoutes.js'
  );
  routeFiles.forEach((file) => {
    const routePath = path.join(routesFolder, file);
    const route = require(routePath);
    app.use('/', route);
  });
  return routeFiles;
}

module.exports = loadRoutes;
