import assert from "node:assert/strict";
import test from "node:test";
import { findActiveYouTubeSegmentIndex } from "../../src/youtube-timing";

const overlappingSegments = [
  { start: 260.28, duration: 15.8 },
  { start: 270.87, duration: 16.37 },
  { start: 282.45, duration: 14.13 },
  { start: 294.36, duration: 15.42 },
  { start: 307.65, duration: 14.94 }
];

test("active YouTube segment follows the latest start when caption durations overlap", () => {
  assert.equal(findActiveYouTubeSegmentIndex(overlappingSegments, 270.87), 1);
  assert.equal(findActiveYouTubeSegmentIndex(overlappingSegments, 307.65), 4);
});

test("active YouTube segment stays unset before the first caption", () => {
  assert.equal(findActiveYouTubeSegmentIndex(overlappingSegments, 260), -1);
});
