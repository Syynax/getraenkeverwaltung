import fs from 'fs/promises';

// In-memory mutex per file path — serializes concurrent read-modify-write operations
const locks = new Map<string, Promise<void>>();

export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(filePath) ?? Promise.resolve();

  let resolve: () => void;
  const current = new Promise<void>(r => { resolve = r; });
  locks.set(filePath, current);

  await previous;
  try {
    return await fn();
  } finally {
    resolve!();
    if (locks.get(filePath) === current) {
      locks.delete(filePath);
    }
  }
}

export async function loadJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function saveJsonFile(filePath: string, data: unknown): Promise<void> {
  const tmpPath = filePath + '.tmp';
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
}
