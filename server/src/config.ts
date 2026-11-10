import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface RecentProject {
  path: string;
  title: string;
  openedAt: string;
}

export interface Config {
  recent: RecentProject[];
}

const CONFIG_DIR = process.env.FLOW_CONFIG_DIR ?? path.join(homedir(), ".config", "flow");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const MAX_RECENT = 30;

export async function loadConfig(): Promise<Config> {
  try {
    const raw = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
    return { recent: Array.isArray(raw.recent) ? raw.recent : [] };
  } catch {
    return { recent: [] };
  }
}

async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export async function touchRecent(projectPath: string, title: string): Promise<void> {
  const config = await loadConfig();
  config.recent = [
    { path: projectPath, title, openedAt: new Date().toISOString() },
    ...config.recent.filter((r) => r.path !== projectPath),
  ].slice(0, MAX_RECENT);
  await saveConfig(config);
}

export async function removeRecent(projectPath: string): Promise<void> {
  const config = await loadConfig();
  config.recent = config.recent.filter((r) => r.path !== projectPath);
  await saveConfig(config);
}
