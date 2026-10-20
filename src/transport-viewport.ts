/** Presentation-only clipping. A route can cross the viewport without sampled stations on-screen. */
export type ScreenPoint = Readonly<{ x: number; y: number }>;

export function polylineTouchesViewport(points: readonly ScreenPoint[], width: number, height: number, margin = 40) {
  const left = -margin, right = width + margin, top = -margin, bottom = height + margin;
  let previous: ScreenPoint | undefined;
  for (const point of points) {
    if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return true;
    if (previous) {
      const dx = point.x - previous.x, dy = point.y - previous.y;
      let enter = 0, exit = 1;
      const clip = (p: number, q: number) => {
        if (p === 0) return q >= 0;
        const t = q / p;
        if (p < 0) enter = Math.max(enter, t);
        else exit = Math.min(exit, t);
        return enter <= exit;
      };
      if (clip(-dx, previous.x - left) && clip(dx, right - previous.x) &&
          clip(-dy, previous.y - top) && clip(dy, bottom - previous.y)) return true;
    }
    previous = point;
  }
  return false;
}
