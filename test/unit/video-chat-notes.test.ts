import assert from "node:assert/strict";
import test from "node:test";
import { appendChatMessages, chatNotePath } from "../../src/video-chat-notes";
import { validateVideoChatRecords, type VideoChatMessage } from "../../src/video-chat";
const question: VideoChatMessage = { id: "q1", role: "user", text: "Question", time: 3, createdAt: 1 };
const answer: VideoChatMessage = { id: "a1", role: "assistant", text: "Answer", time: 3, createdAt: 2 };
const render = (m: VideoChatMessage) => `## ${m.role}\n\n${m.text}`;
const append = (text: string, messages: VideoChatMessage[], source = "video1") => appendChatMessages(text, source, messages, "# Video\n\nSource: video1", render);

test("full export, retry, subsequent answers and manual edits remain append-only", () => {
  const first = append("My notes\n", [question, answer]);
  assert.equal(first.count, 2);
  assert.equal(append(first.text, [question, answer]).text, first.text);
  const edited = first.text.replace("Answer", "My edited answer");
  const next = append(edited, [question, answer, { ...answer, id: "a2", text: "Next answer" }]);
  assert.equal(next.count, 1);
  assert.ok(next.text.startsWith(edited));
  assert.equal(next.text.split("Next answer").length, 2);
});
test("save one answer then save all adds the question but never duplicates the answer", () => {
  const selected = append("", [answer]);
  assert.doesNotMatch(selected.text, /Question/);
  const full = append(selected.text, [question, answer]);
  assert.equal(full.count, 1);
  assert.equal(full.text.split("Answer").length, 2);
  assert.equal(append(full.text, [answer]).count, 0);
});
test("identity survives reload and distinguishes identical replies and different videos", () => {
  const loaded = validateVideoChatRecords({ a: { messages: [answer] } }).a.messages;
  assert.equal(loaded[0].id, answer.id);
  const saved = append("", loaded);
  assert.equal(append(saved.text, loaded).count, 0);
  assert.equal(append(saved.text, [{ ...answer, id: "a2" }]).count, 1);
  assert.equal(append(saved.text, [answer], "video2").count, 1);
});
test("old messages without IDs deduplicate after validation and old exports are adopted", () => {
  const legacy = { ...answer, id: undefined };
  const oldNote = `# Video\n\nSource: video1\n\n${render(legacy)}\n`;
  const migrated = append(oldNote, [legacy]);
  assert.equal(migrated.count, 0);
  assert.ok(migrated.text.startsWith(oldNote));
  assert.equal(append(migrated.text, [legacy]).text, migrated.text);
});
test("vault paths support templates, fixed existing files and root, rejecting traversal", () => {
  assert.equal(chatNotePath("Notes", "{video} AI Chat", "A/B"), "Notes/A B AI Chat.md");
  assert.equal(chatNotePath("", "Existing.md", "Ignored"), "Existing.md");
  assert.throws(() => chatNotePath("../outside", "Note", "Video"));
  assert.throws(() => chatNotePath(".obsidian", "data.json", "Video"));
  assert.throws(() => chatNotePath("", "C:\\notes", "Video"));
});

test("saving one old answer then the old full chat adopts both without duplicates", () => {
  const q = { ...question, id: undefined };
  const a = { ...answer, id: undefined };
  const old = `# Video\n\nSource: video1\n\n${render(q)}\n\n${render(a)}\n`;
  const single = append(old, [a]);
  const all = append(single.text, [q, a]);
  assert.equal(all.count, 0);
  assert.equal(all.text.split("Question").length, 2);
  assert.equal(all.text.split("Answer").length, 2);
});
