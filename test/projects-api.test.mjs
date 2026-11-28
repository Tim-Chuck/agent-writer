import assert from 'node:assert/strict';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startWriterServer } from '../server.mjs';

test('renames projects and deletes chapters while preserving the rest of the project', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-writer-project-test-'));
  const server = await startWriterServer({ directory, port: 0 });
  t.after(async () => {
    await server.close();
    for (const file of ['workspace.json', 'vault.key', 'workspace.tmp']) {
      await rm(join(directory, file), { force: true });
    }
    await rmdir(directory);
  });

  const request = async (path, method = 'GET', payload, status = 200) => {
    const response = await fetch(server.origin + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  const project = await request('/api/projects', 'POST', { title: '初稿', description: '作品简介' }, 201);
  const path = `/api/projects/${project.id}`;
  const [first] = project.chapters;
  const second = { id: 'second', title: '站台', text: '她在站台等车。' };
  const third = { id: 'third', title: '远方', text: '列车驶过原野。' };
  const scenes = [
    { id: 'departure', act: 1, title: '候车', description: '她在雨中等待。', chapterId: second.id, cardIds: [] },
    { id: 'journey', act: 2, title: '途中', description: '', chapterId: third.id, cardIds: [] },
  ];
  await request(path, 'PATCH', { chapters: [first, second, third], scenes, activeChapterId: second.id });
  const stored = await request(`${path}/memories`, 'POST', { chapterId: second.id });
  const [memory] = stored.memories;

  await request(path, 'PATCH', { title: '    ' }, 400);
  const renamed = await request(path, 'PATCH', { title: '  雨夜列车  ' });
  assert.equal(renamed.title, '雨夜列车');
  assert.equal(renamed.id, project.id);
  assert.equal(renamed.description, project.description);
  assert.deepEqual(renamed.chapters, [first, second, third]);
  assert.equal(renamed.activeChapterId, second.id);

  const removed = await request(path, 'PATCH', { removeChapterId: second.id });
  assert.deepEqual(removed.chapters, [first, third]);
  assert.equal(removed.activeChapterId, third.id);
  assert.deepEqual(removed.scenes, [{ ...scenes[0], chapterId: '' }, scenes[1]]);
  const snapshot = await request(`${path}/memories/${memory.id}`);
  assert.deepEqual(snapshot.snapshot.chapters.find(chapter => chapter.id === second.id), second);
  await request(path, 'PATCH', { chapter: second }, 404);
  const staleSceneUpdate = await request(path, 'PATCH', { scenes });
  assert.equal(staleSceneUpdate.scenes[0].chapterId, '');

  const kept = await request(path, 'PATCH', { removeChapterId: first.id });
  assert.equal(kept.activeChapterId, third.id);
  const emptied = await request(path, 'PATCH', { removeChapterId: third.id });
  const [blank] = emptied.chapters;
  assert.equal(emptied.chapters.length, 1);
  assert.equal(blank.title, '第一章');
  assert.equal(blank.text, '');
  assert.equal(emptied.activeChapterId, blank.id);
  assert.notEqual(blank.id, third.id);
  assert.ok(emptied.scenes.every(scene => scene.chapterId === ''));
  await request(path, 'PATCH', { removeChapterId: third.id }, 404);
  const state = await request('/api/state');
  assert.equal(state.projects[0].title, '雨夜列车');
  assert.deepEqual(state.projects[0].chapters, [blank]);
});
