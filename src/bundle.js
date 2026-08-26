const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { openApiDocument, markdownDocument } = require('./generators');

const execFileAsync = promisify(execFile);

async function createDocumentationBundle(analysis) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'docforge-bundle-'));
  const baseName = (analysis.project?.name || 'project').replace(/[^a-zA-Z0-9._-]/g, '-');
  const files = {
    'product-documentation.md': markdownDocument(analysis),
    'openapi.json': JSON.stringify(openApiDocument(analysis), null, 2),
    'analysis.json': JSON.stringify(analysis, null, 2),
    'architecture.md': `# ${analysis.project?.name || 'Project'} architecture\n\n## Stack\n\n${(analysis.stack || []).map(item => `- ${item}`).join('\n')}\n\n## Frontend consumers\n\n${(analysis.frontendCalls || []).map(call => `- ${call.method} ${call.path} — ${call.sourceFile}:${call.sourceLine}`).join('\n') || 'None detected.'}\n`,
    'configuration.md': `# Configuration\n\nThe following environment variable names were detected. Values are intentionally excluded.\n\n${(analysis.environmentVariables || []).map(name => '- `' + name + '`').join('\n') || 'No environment variables detected.'}\n`,
  };
  const filePaths = [];
  try {
    for (const [name, content] of Object.entries(files)) { const target = path.join(directory, name); await fs.writeFile(target, content, 'utf8'); filePaths.push(target); }
    const archive = path.join(os.tmpdir(), `${baseName}-docforge-documentation.zip`);
    await fs.rm(archive, { force: true });
    await execFileAsync('zip', ['-q', '-j', archive, ...filePaths], { timeout: 30000, maxBuffer: 1_000_000 });
    const content = await fs.readFile(archive);
    await fs.rm(archive, { force: true });
    return { filename: `${baseName}-docforge-documentation.zip`, content };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

module.exports = { createDocumentationBundle };
