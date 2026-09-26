export interface YouTubeTimedSegment {
  start: number;
}

export function findActiveYouTubeSegmentIndex(
  segments: readonly YouTubeTimedSegment[],
  time: number
): number {
  if (!Number.isFinite(time) || segments.length === 0) return -1;

  let low = 0;
  let high = segments.length - 1;
  let activeIndex = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (segments[middle].start <= time) {
      activeIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return activeIndex;
}
