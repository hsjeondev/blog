import React from 'react'
import { useNotionContext } from '../context'
import useCachedImage from '../../../hooks/useCachedImage'

type Phase = 'skeleton' | 'preview' | 'ready' | 'error'
export function ProgressiveImage({ src, thumbnail, alt, width, height, zoomable }: {
  src: string; thumbnail?: string; alt: string; width: number; height: number; zoomable: boolean
}) {
  const [phase, setPhase] = React.useState<Phase>('skeleton')
  const previewRef = React.useRef<HTMLImageElement>(null)
  const mounted = React.useRef(true)
  const { zoom, recordMap } = useNotionContext()
  const owner = src?.match(/^\/api\/blog-media\/([a-f0-9-]{36})\/[a-f0-9]{64}$/)?.[1]
  const metadata = owner ? (recordMap.block[owner]?.value as any)?.blog_metadata : null
  const revision = metadata?.lastEditedTime
  const cacheable = !!(owner && revision)
  const priority = metadata?.cardCover === src
  const { imageRef, src: cachedSrc, cached } = useCachedImage(cacheable ? src : null, revision, priority)
  const displaySrc = cacheable ? cachedSrc : src
  const imageZoom = React.useMemo(() => zoomable && zoom ? zoom.clone() : null, [zoom, zoomable])
  const decoded = async (image: HTMLImageElement, full: boolean) => {
    try { await image.decode?.() } catch { /* A loaded image may not support decoding. */ }
    if (!mounted.current || !image.naturalWidth) return
    setPhase((current) => full ? 'ready' : current === 'skeleton' ? 'preview' : current)
  }
  React.useEffect(() => {
    mounted.current = true
    for (const [image, full] of [[previewRef.current, false], [imageRef.current, true]] as const) {
      if (image?.complete && image.naturalWidth) void decoded(image, full)
    }
    return () => { mounted.current = false }
  }, [displaySrc])
  React.useEffect(() => {
    const image = imageRef.current
    if (phase !== 'ready' || !imageZoom || !image) return
    imageZoom.attach(image)
    return () => { imageZoom.detach(image) }
  }, [phase, imageZoom, displaySrc])
  return <div className="notion-progressive-image" data-phase={phase} data-cached={cached || undefined} style={{ aspectRatio: `${width} / ${height}`, '--notion-image-ratio': width / height } as React.CSSProperties} aria-busy={phase === 'skeleton' || phase === 'preview'}>
    <div className="notion-image-skeleton" aria-hidden="true" />
    {thumbnail && <img ref={previewRef} className="notion-image-thumbnail" src={thumbnail} alt="" aria-hidden="true" loading="lazy" decoding="async"
      onLoad={(event) => void decoded(event.currentTarget, false)} />}
    <img ref={imageRef} className="notion-image-original" src={displaySrc} alt={alt} width={width} height={height} loading={cacheable || priority ? 'eager' : 'lazy'} decoding="async"
      onLoad={(event) => void decoded(event.currentTarget, true)} onError={() => setPhase('error')} />
    {phase === 'error' && <span className="notion-image-error" role="status">이미지를 불러오지 못했습니다.</span>}
  </div>
}
