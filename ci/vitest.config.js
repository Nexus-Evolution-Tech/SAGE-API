const base = require('../vitest.config');

module.exports = {
  ...base,
  test: {
    ...base.test,
    include: ['ci/r1-05f-websocket-proxy.test.js']
  }
};
