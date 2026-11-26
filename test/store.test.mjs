import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureMemory } from '../lib/memory.mjs';
import { makeProject } from '../lib/projects.mjs';
import { openStore } from '../lib/store.mjs';

function legacyDemo() {
  const project = makeProject('暮色来信', '一封从未寄出的信，把林岚带回了海岬镇。');
  project.chapters = [
    {
      id: 'old-first', title: '港口来信',
      text: '收拾父亲遗物的那天，林岚在皮箱夹层里找到一个信封。信上没有贴邮票，落款比她出生还早。她认出父亲的字，收件人那一栏却空着，只在信封背面写了三个字：海岬镇。\n\n她把信翻来覆去看了两遍，没有拆。窗外有人收鱼网，铅坠磕在码头上，一声比一声远。',
    },
    {
      id: 'old-second', title: '站台',
      text: '雨从清晨就没有停过。站台遮棚漏水，隔一会儿便往林岚脚边滴一声。她把皮箱挪到干一点的地方，广播刚好响起来，说车还要晚十分钟。\n\n皮箱锁扣上的漆掉了一半。小时候她嫌它难开，父亲就教她用拇指压住左边，往上一挑。箱子放在家里那么多年，她只见父亲在搬家的时候碰过一次。\n\n对面长椅坐着一个穿雨衣的人，手里捏着根没点的烟。林岚抬头时，那人正看她的箱子。她下意识把脚往回收了一点，鞋跟碰在箱角上。\n\n列车进站前，站台忽然安静下来。那人把烟掰断了，起身往另一头走。林岚看着他的背影，直到他绕过告示牌，才想起父亲原来也有这个习惯。',
    },
    { id: 'old-third', title: '无人应答', text: '' },
  ];
  project.activeChapterId = 'old-second';
  project.cards = [
    { id: 'old-character', type: 'character', title: '林岚', description: '主人公。习惯先观察周围的人，再决定要问什么。知道信的目的地，目前还没有拆开信。' },
    { id: 'old-prop', type: 'prop', title: '旧信', description: '从父亲的皮箱夹层找到。信封未封严、未贴邮票，背面写着「海岬镇」。' },
    { id: 'old-location', type: 'location', title: '站台', description: '通向海岬镇的小站。遮棚漏雨，只有一张对着铁轨的长椅。' },
    { id: 'old-group', type: 'organization', title: '港务会', description: '海岬镇过去负责登记进出港船只的地方机构，旧记录仍然有人在保管。' },
  ];
  project.planning = '近距离第三人称。第一幕保持林岚的视角，不交代信的内容。写到她第一次走进海岬镇时，一处细节应让她意识到父亲曾在这里待过。';
  project.scenes = [
    { id: 'scene-1', act: 1, title: '港口来信', description: '林岚在父亲的皮箱里发现一封未寄出的信，决定去信封背面的海岬镇。', cardIds: ['old-character', 'old-prop'], chapterId: 'old-first' },
    { id: 'scene-2', act: 1, title: '站台', description: '陌生人留意到林岚的皮箱。一个熟悉的小动作，让林岚第一次怀疑他认识父亲。', cardIds: ['old-location'], chapterId: 'old-second' },
    { id: 'scene-3', act: 2, title: '无人应答', description: '林岚在海岬镇找到旧地址，里面的人隔着门问她从哪里得到那只箱子。', cardIds: ['old-character'], chapterId: 'old-third' },
    { id: 'scene-4', act: 3, title: '潮退之后', description: '回到港口后，林岚终于决定怎么处置那封信。', cardIds: ['old-prop'], chapterId: '' },
  ];
  return project;
}

async function temporaryWorkspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-writer-store-test-'));
  t.after(async () => {
    await Promise.all(['workspace.json', 'workspace.tmp', 'vault.key'].map(name =>
      rm(join(directory, name), { force: true }),
    ));
    await rmdir(directory);
  });
  return directory;
}

test('opens a new workspace with zero projects', async t => {
  const directory = await temporaryWorkspace(t);
  const store = await openStore(directory);
  const state = await store.read();
  assert.deepEqual(state.projects, []);
  assert.equal(state.activeProjectId, '');
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')), state);
});

test('removes only the untouched legacy sample and keeps writing and model connections', async t => {
  const directory = await temporaryWorkspace(t);
  const firstStore = await openStore(directory);
  const demo = legacyDemo();
  captureMemory(demo, { reasons: ['weekly'] });
  const sameTitle = makeProject(demo.title);
  const edited = legacyDemo();
  edited.chapters[0].text += '我的文字。';
  const archivedDraft = legacyDemo();
  archivedDraft.chapters[0].text += '只存于记忆的草稿。';
  captureMemory(archivedDraft, { reasons: ['weekly'] });
  archivedDraft.chapters[0].text = demo.chapters[0].text;
  const secret = firstStore.seal('test-key');
  const oldState = {
    version: 1, projects: [demo, sameTitle, edited, archivedDraft], activeProjectId: demo.id,
    providers: { custom: { name: '我的模型', secret } }, activeProviderId: 'custom',
  };
  const file = join(directory, 'workspace.json');
  await writeFile(file, JSON.stringify(oldState));

  const reopened = await openStore(directory);
  const state = await reopened.read();
  assert.deepEqual(state.projects, [sameTitle, edited, archivedDraft]);
  assert.equal(state.activeProjectId, sameTitle.id);
  assert.deepEqual(state.providers, oldState.providers);
  assert.equal(state.activeProviderId, 'custom');
  assert.equal(reopened.unseal(state.providers.custom.secret), 'test-key');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), state);
});

test('clears the active project when the legacy sample was the only project', async t => {
  const directory = await temporaryWorkspace(t);
  const demo = legacyDemo();
  await writeFile(join(directory, 'workspace.json'), JSON.stringify({
    version: 1, projects: [demo], activeProjectId: demo.id, providers: {}, activeProviderId: '',
  }));
  const store = await openStore(directory);
  const state = await store.read();
  assert.deepEqual(state.projects, []);
  assert.equal(state.activeProjectId, '');
});
