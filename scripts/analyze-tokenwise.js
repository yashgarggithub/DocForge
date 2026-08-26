const { analyzeProject } = require('../src/analyzer');
const { openApiDocument, markdownDocument } = require('../src/generators');

analyzeProject('/Users/yashgarg/TokenWise')
  .then(result => {
    console.log(JSON.stringify({ summary: result.summary, routes: result.routes.map(route => `${route.method} ${route.path}`), openapi: openApiDocument(result), markdownPreview: markdownDocument(result).slice(0, 500) }, null, 2));
  })
  .catch(error => { console.error(error.message); process.exitCode = 1; });
