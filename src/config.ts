import os from 'os';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

interface Config {
  backendUrl: string;
  machineName: string;
  projectId: string;
  agentId: string;
  apiKey: string;
  dangerouslySkipPermissions: boolean;
}

interface GlobalConfig {
  backend_url?: string;
  machine_name?: string;
  api_key?: string;
}

interface LocalConfig {
  project_id?: string;
}

const GLOBAL_DIR = path.join(os.homedir(), '.aicp');
const GLOBAL_PATH = path.join(GLOBAL_DIR, 'config.json');
const LOCAL_DIR = '.aicp';
const LOCAL_FILENAME = 'aicp.json';
const LEGACY_LOCAL_FILENAME = '.aicp.json';

// ─── File I/O ───────────────────────────────────────────────────────

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

// ─── Public ─────────────────────────────────────────────────────────

export function readGlobalConfig(): GlobalConfig {
  return readJson<GlobalConfig>(GLOBAL_PATH) || {};
}

export function writeGlobalConfig(data: GlobalConfig): void {
  writeJson(GLOBAL_PATH, data);
}

export function readLocalConfig(): LocalConfig {
  return readJson<LocalConfig>(findLocalConfigPath() || '') || {};
}

export function writeLocalConfig(data: LocalConfig): void {
  writeJson(path.join(process.cwd(), LOCAL_DIR, LOCAL_FILENAME), data);
}

export function findLocalConfigPath(): string | null {
  let dir = process.cwd();
  while (true) {
    // Check new path first: .aicp/aicp.json
    const newCandidate = path.join(dir, LOCAL_DIR, LOCAL_FILENAME);
    if (fs.existsSync(newCandidate)) return newCandidate;
    // Fall back to legacy: .aicp.json
    const legacyCandidate = path.join(dir, LEGACY_LOCAL_FILENAME);
    if (fs.existsSync(legacyCandidate)) return legacyCandidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Returns the .aicp/ directory path for the current project (creates if needed) */
export function localAicpDir(): string {
  const configPath = findLocalConfigPath();
  if (configPath) {
    // If found at legacy location, use its parent + .aicp/
    if (configPath.endsWith(LEGACY_LOCAL_FILENAME)) {
      return path.join(path.dirname(configPath), LOCAL_DIR);
    }
    // New layout: .aicp/aicp.json → .aicp/
    return path.dirname(configPath);
  }
  // Default to cwd/.aicp/
  return path.join(process.cwd(), LOCAL_DIR);
}

function loadConfig(): Config {
  const global = readGlobalConfig();
  const local = readLocalConfig();

  // Env vars override everything
  const backendUrl = process.env.BACKEND_WS_URL || global.backend_url || '';
  const machineName = process.env.MACHINE_NAME || global.machine_name || os.hostname();
  const projectId = process.env.PROJECT_ID || local.project_id || '';
  const agentId = process.env.AGENT_ID || uuidv4();
  const apiKey = process.env.AICP_API_KEY || global.api_key || '';

  if (!backendUrl) {
    console.error('[agent] backend_url not configured. Run: aicp-agent --setup');
    process.exit(1);
  }

  if (!projectId) {
    console.error('[agent] project_id not configured. Run: aicp-agent --setup');
    process.exit(1);
  }

  if (!apiKey) {
    console.error('[agent] api_key not configured. Run: aicp-agent --setup');
    process.exit(1);
  }

  const dangerouslySkipPermissions = process.argv.includes('--dangerously-skip-permissions');

  return { backendUrl, machineName, projectId, agentId, apiKey, dangerouslySkipPermissions };
}

// Lazy singleton — only validated when first accessed (not during --setup)
let _config: Config | null = null;
function getConfig(): Config {
  if (!_config) _config = loadConfig();
  return _config;
}

export const config: Config = new Proxy({} as Config, {
  get(_, prop) {
    return getConfig()[prop as keyof Config];
  },
});
