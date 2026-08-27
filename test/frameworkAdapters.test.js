const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { analyzeProject } = require('../src/analyzer');

async function fixture(name, source, extension) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `docforge-${name}-`));
  await fs.writeFile(path.join(root, `main.${extension}`), source);
  return root;
}

(async () => {
  const cases = [
    ['fastapi', `from fastapi import FastAPI, Query\napp=FastAPI()\n@app.get('/users/{user_id}')\ndef get_user(user_id: int, q: str = Query(None)): return {'id': user_id}\n`, 'FastAPI', 'GET', '/users/{user_id}'],
    ['flask', `from flask import Flask, jsonify\napp=Flask(__name__)\n@app.route('/users/<int:user_id>', methods=['GET'])\ndef get_user(user_id): return jsonify({'id': user_id})\n`, 'Flask', 'GET', '/users/{user_id}'],
    ['nestjs', `import { Controller, Get } from '@nestjs/common';\n@Controller('users')\nexport class UsersController { @Get(':id') get() { return { id: 1 }; } }\n`, 'NestJS', 'GET', 'users/:id'],
    ['fastify', `const fastify = require('fastify')();\nfastify.get('/health', async () => ({ status: 'ok' }));\n`, 'Fastify', 'GET', '/health'],
  ];
  for (const [name, source, framework, method, routePath] of cases) {
    const root = await fixture(name, source, ['FastAPI', 'Flask'].includes(framework) ? 'py' : 'ts');
    const analysis = await analyzeProject(root);
    assert.ok(analysis.frameworks.some(item => item.name === framework), `${framework} should be detected`);
    assert.ok(analysis.routes.some(route => route.framework.toLowerCase() === framework.toLowerCase().replace('nestjs', 'nestjs') && route.method === method && route.path === routePath), `${framework} route should be extracted`);
    await fs.rm(root, { recursive: true, force: true });
  }
  console.log('framework adapter tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
