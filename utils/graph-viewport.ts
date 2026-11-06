type Bounds = { x: number; y: number; width: number; height: number };

// Bounds include labels, not just node centers. Leave a strip for reset controls.
export function fitGraphBounds(bounds: Bounds, width: number, height: number) {
  const padding = 24;
  const controlSpace = 52;
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2 - controlSpace);
  const k = Math.min(1, usableWidth / Math.max(1, bounds.width), usableHeight / Math.max(1, bounds.height));
  return {
    k,
    x: width / 2 - k * (bounds.x + bounds.width / 2),
    y: (height - controlSpace) / 2 - k * (bounds.y + bounds.height / 2),
  };
}
