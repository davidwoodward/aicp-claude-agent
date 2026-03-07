import readline from 'readline';
import os from 'os';
import http from 'http';
import https from 'https';
import {
  readGlobalConfig,
  writeGlobalConfig,
  readLocalConfig,
  writeLocalConfig,
  findLocalConfigPath,
} from './config';

interface ProjectSummary {
  id: string;
  name: string;
}

// ─── I/O helpers ────────────────────────────────────────────────────

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const opts: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: headers || {},
    };
    client.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON from ${url}`));
        }
      });
    }).on('error', reject).end();
  });
}

function wsUrlToHttpUrl(wsUrl: string): string {
  return wsUrl
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:')
    .replace(/\/ws\/?$/, '');
}

// ─── Setup flow ─────────────────────────────────────────────────────

export async function runSetup(): Promise<void> {
  const rl = createPrompt();
  const global = readGlobalConfig();

  console.log('\n  AICP Agent Setup\n');

  // Step 1: Backend URL
  const defaultUrl = global.backend_url || 'ws://localhost:8080/ws';
  const backendUrl = (await ask(rl, `  Backend WebSocket URL [${defaultUrl}]: `)) || defaultUrl;

  // Step 2: Machine name
  const defaultMachine = global.machine_name || os.hostname();
  const machineName = (await ask(rl, `  Machine name [${defaultMachine}]: `)) || defaultMachine;

  // Step 3: API key
  const defaultApiKey = global.api_key || '';
  const apiKeyDisplay = defaultApiKey ? `[${defaultApiKey.slice(0, 13)}...]` : '[none]';
  const apiKeyInput = await ask(rl, `  API Key ${apiKeyDisplay}: `);
  const apiKey = apiKeyInput || defaultApiKey;

  if (!apiKey) {
    console.error('\n  API key is required. Generate one in the AICP web UI (Avatar → API Keys).');
    rl.close();
    return;
  }

  if (!apiKey.startsWith('aicp_')) {
    console.error('\n  Invalid API key format. Keys start with "aicp_".');
    rl.close();
    return;
  }

  // Save global config
  writeGlobalConfig({ backend_url: backendUrl, machine_name: machineName, api_key: apiKey });
  console.log('\n  Global config saved to ~/.aicp/config.json');

  // Step 4: Project selection
  const httpBase = wsUrlToHttpUrl(backendUrl);
  let projects: ProjectSummary[] = [];

  console.log(`\n  Fetching projects from ${httpBase}...`);
  try {
    projects = await fetchJson<ProjectSummary[]>(`${httpBase}/api/projects`, {
      Authorization: `Bearer ${apiKey}`,
    });
  } catch (err) {
    console.error(`  Could not fetch projects: ${(err as Error).message}`);
    console.error('  Check that your API key is valid.');
    rl.close();
    return;
  }

  if (projects.length === 0) {
    console.log('  No projects found. Create one in the AICP web UI first.');
    rl.close();
    return;
  }

  const local = readLocalConfig();
  console.log('');
  for (let i = 0; i < projects.length; i++) {
    const current = projects[i].id === local.project_id ? ' (current)' : '';
    console.log(`  ${i + 1}. ${projects[i].name}${current}`);
  }
  console.log('');

  const choice = await ask(rl, `  Select project [1-${projects.length}]: `);
  const index = parseInt(choice, 10) - 1;

  if (isNaN(index) || index < 0 || index >= projects.length) {
    console.error('  Invalid selection.');
    rl.close();
    return;
  }

  const selected = projects[index];
  writeLocalConfig({ project_id: selected.id });

  const localPath = findLocalConfigPath() || `${process.cwd()}/.aicp.json`;
  console.log(`\n  Project "${selected.name}" saved to ${localPath}`);
  console.log('\n  Setup complete. Run aicp-agent to start.\n');

  rl.close();
}
