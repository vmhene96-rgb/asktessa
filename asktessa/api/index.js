// Vercel serverless entrypoint for AskTessa
// Reuses the existing Express app defined in server.js.

const app = require('../server');

module.exports = app;
