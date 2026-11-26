import { createHash, randomUUID } from 'node:crypto';
import { defaultMemorySettings } from './memory.mjs';

export function makeId() {
  return randomUUID();
}

export function makeChapter(title = '未命名章节') {
  return { id: makeId(), title, text: '' };
}

export function makeProject(title, description = '') {
  const now = new Date().toISOString();
  const chapter = makeChapter('第一章');
  return {
    id: makeId(), title, description, createdAt: now, updatedAt: now,
    chapters: [chapter], activeChapterId: chapter.id,
    planning: '', cards: [], scenes: [], references: [], memories: [],
    memorySettings: { ...defaultMemorySettings }, memoryState: {},
  };
}

// The v0.1.0 sample used fresh IDs on each installation. Compare its contents
// and the order and links of its records before removing it from an old workspace.
const legacyDemoHash = '5ee6df7495b85136e6a61fe2f5bf9cc3486edadd77eaa03330fbc84293a5fb50';

function hasLegacyDemoContent(project) {
  if (!project || project.title !== '暮色来信') return false;
  const { title, description, planning, chapters, cards, scenes, references } = project;
  if (chapters?.length !== 3 || cards?.length !== 4 || scenes?.length !== 4 || references?.length !== 0 ||
      ![chapters, cards, scenes, references].every(Array.isArray)) return false;
  if ([...chapters, ...cards, ...scenes].some(item => !item) || scenes.some(scene => !Array.isArray(scene.cardIds))) return false;

  const chapterIndices = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  const cardIndices = new Map(cards.map((card, index) => [card.id, index]));
  const content = [
    title, description, planning,
    chapters.map(chapter => [chapter.title, chapter.text]),
    cards.map(card => [card.title, card.type, card.description]),
    scenes.map(scene => [
      scene.title, scene.act, scene.description, chapterIndices.get(scene.chapterId) ?? -1,
      scene.cardIds.map(id => cardIndices.get(id) ?? -1),
    ]),
  ];
  return createHash('sha256').update(JSON.stringify(content)).digest('hex') === legacyDemoHash;
}

export function isUntouchedLegacyDemo(project) {
  return hasLegacyDemoContent(project) &&
    !project.memoryState?.changedCharacters &&
    Object.entries(defaultMemorySettings).every(([name, value]) => project.memorySettings?.[name] === value) &&
    Array.isArray(project.memories) &&
    project.memories.every(memory =>
      memory?.reasons?.length === 1 && memory.reasons[0] === 'weekly' && hasLegacyDemoContent(memory.snapshot),
    );
}
