import { randomUUID } from 'node:crypto';
import { searchPassages } from './context-search.mjs';

function thread(state, projectId, chapterId, create = false) {
  if (!projectId) {
    if (create) state.workspaceConversation ??= [];
    return state.workspaceConversation;
  }
  const project = state.projects.find(book => book.id === projectId);
  if (!project?.chapters.some(chapter => chapter.id === chapterId)) return;
  if (Object.hasOwn(project.conversations ?? {}, chapterId)) return project.conversations[chapterId];
  if (create) {
    const turns = [];
    project.conversations = { ...project.conversations, [chapterId]: turns };
    return turns;
  }
}

export function conversationEntries(state, projectId, chapterId) {
  return (thread(state, projectId, chapterId) ?? []).flatMap(({ user, reply }) => [user, reply ?? {
    role: 'error', text: '这条消息尚未收到回复。',
  }]);
}

export function beginConversationTurn(store, { projectId, chapterId, text, attachments }) {
  const user = { role: 'user', text, attachments: attachments.filter(file => file.attached)
    .map(({ id, name, characters }) => ({ id, name, characters })) };
  const turn = { id: randomUUID(), user };
  return store.mutate(state => {
    const turns = thread(state, projectId, chapterId, true);
    if (!turns) return false;
    const completed = turns.filter(item => item.reply?.role === 'assistant');
    const recent = completed.slice(-3)
      .flatMap(({ user, reply }) => [{ role: user.role, text: user.text }, { role: reply.role, text: reply.text }]);
    const history = completed.slice(0, -3).reverse().flatMap(({ id, user, reply }) => [
      { id: id + '/user', kind: 'user', text: user.text }, { id: id + '/assistant', kind: 'assistant', text: reply.text },
    ]);
    const earlier = searchPassages(history, text, 3).map(item => ({ role: item.kind, text: item.text }));
    turns.push(turn);
    return { ...turn, projectId, chapterId, recent, earlier };
  });
}

export async function saveConversationTurn(store, turn, response, { projectId, chapterId }) {
  const { error, text, trace, pending, report, changed } = response;
  const reply = pending ? {
    role: 'error', text: '这项工具操作当时在等待确认。请在对话中重新发起操作。', trace,
  } : {
    id: turn.id, role: error ? 'error' : 'assistant', text: error || text, trace,
    report: { sections: report.sections, attachments: report.attachments, depth: report.depth, budget: report.budget,
      characters: report.characters, focused: report.focused, recalled: report.recalled },
    allowApply: !changed && Boolean(turn.projectId),
  };
  await store.mutate(state => {
    const original = thread(state, turn.projectId, turn.chapterId)?.find(item => item.id === turn.id);
    const user = error || pending ? { ...turn.user, failed: true } : turn.user;
    if (original) Object.assign(original, { user, reply });
    if (!pending && projectId && (projectId !== turn.projectId || chapterId !== turn.chapterId)) {
      const nextId = chapterId || state.projects.find(book => book.id === projectId)?.activeChapterId;
      const destination = thread(state, projectId, nextId, true);
      if (destination && !destination.some(item => item.id === turn.id)) destination.push({ id: turn.id, user, reply });
    }
  });
}
