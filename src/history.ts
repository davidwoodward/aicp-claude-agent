import fs from 'fs';
import path from 'path';
import { localAicpDir } from './config';

const MAX_ENTRIES = 500;
const HISTORY_FILE = 'history';

// Each entry is one line: JSON with { full, display? }
// display is only stored when it differs from full (paste blocks collapsed)

interface HistoryEntry {
  full: string;       // expanded text (what was sent to Claude)
  display?: string;   // collapsed text with [Pasted text #N ...] placeholders
}

let entries: HistoryEntry[] | null = null; // lazy-loaded

function historyPath(): string {
  return path.join(localAicpDir(), HISTORY_FILE);
}

function load(): HistoryEntry[] {
  if (entries) return entries;
  try {
    const raw = fs.readFileSync(historyPath(), 'utf-8');
    entries = raw
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as HistoryEntry; }
        catch { return { full: line }; }
      });
  } catch {
    entries = [];
  }
  return entries;
}

function save(): void {
  if (!entries) return;
  const dir = localAicpDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const data = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(historyPath(), data);
}

/** Add a history entry. display is the collapsed version (only stored if different from full). */
export function addHistory(full: string, display?: string): void {
  const list = load();
  const entry: HistoryEntry = { full };
  if (display && display !== full) entry.display = display;

  // Dedupe: remove the most recent identical entry
  if (list.length > 0 && list[list.length - 1].full === full) {
    list.pop();
  }

  list.push(entry);

  // Trim to max
  if (list.length > MAX_ENTRIES) {
    entries = list.slice(list.length - MAX_ENTRIES);
  }

  save();
}

/** Get history entries count */
export function historyLength(): number {
  return load().length;
}

/** Get the display text for a history entry (index 0 = oldest). Returns null if out of range. */
export function getHistoryDisplay(index: number): string | null {
  const list = load();
  if (index < 0 || index >= list.length) return null;
  const entry = list[index];
  return entry.display || entry.full;
}

/** Get the full text for a history entry (index 0 = oldest). Returns null if out of range. */
export function getHistoryFull(index: number): string | null {
  const list = load();
  if (index < 0 || index >= list.length) return null;
  return list[index].full;
}
