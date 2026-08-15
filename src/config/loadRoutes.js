const fs = require('fs');
const path = require('path');

function loadRoutes(app, routesFolder = path.join(__dirname, '../routes')) {
  const files = fs.readdirSync(routesFolder);
  const routeFiles = files.filter(
    (file) => file.endsWith('Routes.js') && file !== 'genericRoutes.js'
  );
  const failures = [];
  routeFiles.forEach((file) => {
    const routePath = path.join(routesFolder, file);
    try {
      const route = require(routePath);
      app.use('/', route);
    } catch (error) {
      failures.push({ file, error });
    }
  });
  routeFiles.failures = failures;
  return routeFiles;
}

module.exports = loadRoutes;
