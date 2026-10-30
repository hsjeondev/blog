export function notionImageLayout(format: any, preview?: { originalWidth?: number; originalHeight?: number }) {
  const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;
  if (positive(preview?.originalWidth) && positive(preview?.originalHeight)) return { width: preview!.originalWidth!, height: preview!.originalHeight! };
  if (positive(format?.block_aspect_ratio)) return { width: 1, height: format.block_aspect_ratio };
  if (positive(format?.block_width) && positive(format?.block_height)) return { width: format.block_width, height: format.block_height };
  return { width: 16, height: 9 };
}

export function notionImageThumbnail(src: string, blockId: string) {
  try {
    const url = new URL(src);
    if (!['https:', 'http:'].includes(url.protocol)) return;
    if (url.hostname === 'images.unsplash.com') {
      url.searchParams.set('w', '64'); url.searchParams.set('q', '25');
      return url.toString();
    }
    // Never route stored or external images back through Notion's image API.
    return;
  } catch { return; }
}
