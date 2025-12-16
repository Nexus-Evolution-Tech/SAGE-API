const fs = require('fs');
const path = require('path');

function loadRoutes(app, routesFolder = path.join(__dirname, '../routes')) {
  fs.readdirSync(routesFolder).forEach((file) => {
    if (file.endsWith('Routes.js') && file !== 'genericRoutes.js') {
      const routePath = path.join(routesFolder, file);
      const route = require(routePath);
      app.use('/', route);
    }
  });
}

module.exports = loadRoutes;
