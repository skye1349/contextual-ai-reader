import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chooseLocalCaptionTrack, inspectLocalVideo, localVideoResourceUrl, localVideoTimestampUri, normalizeLocalVideoPath, parseLocalCaptions, readLocalCaptionTrack } from "../../src/local-video";

test("reads SRT and VTT cue times, multiline text, tags and entities without turning text into markup", () => {
  assert.deepEqual(parseLocalCaptions('\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\n<i>Hello</i> &amp; welcome\r\nSecond line\r\n\r\n2\r\n00:00:05,000 --> 00:00:04,000\r\ninvalid'), [
    { start: 1.25, duration: 2.25, text: 'Hello & welcome\nSecond line' }
  ]);
  assert.deepEqual(parseLocalCaptions('WEBVTT\n\nNOTE ignore --> this\n\ncue-id\n01:02.100 --> 01:03.900 align:start\n<v Alice>你好 &lt;world&gt;</v>'), [
    { start: 62.1, duration: 63.9 - 62.1, text: '你好 <world>' }
  ]);
});

test("local timestamps round-trip paths with Unicode, spaces, hashes and percent signs", () => {
  const path = '/tmp/课程 #1 50% & video.mp4';
  const uri = new URL(localVideoTimestampUri(path, 12.75));
  assert.equal(uri.searchParams.get('path'), path);
  assert.equal(uri.searchParams.get('t'), '12.75');
  assert.equal(new URL(localVideoTimestampUri(path, NaN)).searchParams.get('t'), '0');
});

test("discovers only matching sidecars, embedded text tracks and language preference", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'local-video-test-'));
  try {
    const path = join(dir, 'lesson.mp4');
    await writeFile(path, 'fixture');
    await writeFile(join(dir, 'lesson.en.srt'), '1\n00:00:00,000 --> 00:00:02,000\nHello\n');
    await writeFile(join(dir, 'lessons.srt'), 'unrelated');
    const run = async () => ({ code: 0, stderr: '', stdout: JSON.stringify({ streams: [
      { index: 2, codec_type: 'subtitle', codec_name: 'mov_text', tags: { language: 'jpn' }, disposition: { default: 1 } },
      { index: 3, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle' }
    ] }) });
    const source = await inspectLocalVideo(path, '/tools/ffmpeg', run);
    assert.equal(source.tracks.length, 2);
    assert.equal(chooseLocalCaptionTrack(source.tracks, 'en')?.id, 'file:lesson.en.srt');
    assert.equal(chooseLocalCaptionTrack(source.tracks, 'ja')?.streamIndex, 2);
    assert.equal(chooseLocalCaptionTrack(source.tracks, 'auto')?.streamIndex, 2);
    assert.match(source.warning!, /Image-based/);
    assert.equal((await readLocalCaptionTrack(path, source.tracks[0], 'ffmpeg', run))[0].text, 'Hello');
    assert.equal(await normalizeLocalVideoPath(path), await normalizeLocalVideoPath(source.url));
    const unavailable = await inspectLocalVideo(path, 'ffmpeg', async () => { throw new Error('missing ffprobe'); });
    assert.equal(unavailable.tracks.length, 1);
    assert.match(unavailable.warning!, /ffprobe/);
    await assert.rejects(normalizeLocalVideoPath('https://example.com/video.mp4'), /absolute/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("uses the vault resource authority for external local media and escapes file names", () => {
  const resource = new URL(localVideoResourceUrl('/tmp/课程 #1 50%.mp4', 'app://vault-token/notes/'));
  assert.equal(resource.host, 'vault-token');
  assert.equal(decodeURIComponent(resource.pathname), '/tmp/课程 #1 50%.mp4');
  assert.equal(resource.hash, '');
});
