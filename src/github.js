const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function normalizeGithubUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a valid GitHub URL.'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') throw new Error('Only https://github.com repository URLs are supported.');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 2) throw new Error('Use a repository URL such as https://github.com/owner/repository.');
  return `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/, '')}.git`;
}

async function cloneGithubRepository(repositoryUrl) {
  const normalizedUrl = normalizeGithubUrl(repositoryUrl);
  const checkoutPath = await fs.mkdtemp(path.join(os.tmpdir(), 'docforge-github-'));
  try {
    await execFileAsync('git', ['clone', '--depth', '1', normalizedUrl, checkoutPath], { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    return { projectPath: checkoutPath, repositoryUrl: normalizedUrl.replace(/\.git$/, ''), temporary: true };
  } catch (error) {
    await fs.rm(checkoutPath, { recursive: true, force: true });
    const details = String(error.stderr || error.message || '').trim();
    throw new Error(`Unable to clone GitHub repository. ${details.includes('Authentication') ? 'Private repositories require a configured GitHub credential.' : details}`.trim());
  }
}

module.exports = { cloneGithubRepository, normalizeGithubUrl };
