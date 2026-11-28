import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { isUntouchedLegacyDemo } from './projects.mjs';

export async function openStore(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'workspace.json');
  const keyPath = join(directory, 'vault.key');
  let key;
  try {
    key = await readFile(keyPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    key = randomBytes(32);
    try {
      await writeFile(keyPath, key, { flag: 'wx', mode: 0o600 });
    } catch (writeError) {
      if (writeError.code !== 'EEXIST') throw writeError;
      key = await readFile(keyPath);
    }
  }
  let state;
  const writeState = async (next) => {
    const temp = join(directory, 'workspace.tmp');
    await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
    await rename(temp, file);
  };
  try {
    state = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { version: 1, projects: [], activeProjectId: '', providers: {}, activeProviderId: '' };
    await writeState(state);
  }

  const projects = state.projects.filter(project => !isUntouchedLegacyDemo(project));
  if (projects.length !== state.projects.length) {
    state.projects = projects;
    if (!projects.some(project => project.id === state.activeProjectId)) {
      state.activeProjectId = projects[0]?.id ?? '';
    }
    await writeState(state);
  }
  let queue = Promise.resolve();
  return {
    async read(select = current => current) {
      await queue;
      return structuredClone(select(state));
    },
    mutate(change) {
      const operation = queue.then(async () => {
        const next = structuredClone(state);
        const result = change(next);
        if (result !== false) {
          await writeState(next);
          state = next;
        }
        return structuredClone(result);
      });
      queue = operation.catch(() => {});
      return operation;
    },
    seal(secret) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    },
    unseal(value) {
      if (!value) return '';
      const bytes = Buffer.from(value, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}
