import dynamic from 'next/dynamic'

const Code = dynamic(() =>
    import('../packages/notionx/third-party/code').then(m => m.Code)
);
const Collection = dynamic(() =>
    import('../packages/notionx/third-party/collection').then(
        (m) => m.Collection
    )
)
const Equation = dynamic(() =>
    import('../packages/notionx/third-party/equation').then((m) => m.Equation)
)
const Pdf = dynamic(
    () => import('../packages/notionx/third-party/pdf').then((m) => m.Pdf),
    {
        ssr: false
    }
)
const Modal = dynamic(
    () => import('../packages/notionx/third-party/modal').then((m) => m.Modal) as any,
    {
        ssr: false
    }
)

export { Code, Collection, Equation, Pdf, Modal }
// Stored media paths are authorized by the blog media proxy on every request.
export function mapPublishedImageUrl(url: string | undefined) {
    if (!url) return undefined;
    if (/^\/api\/blog-media\/[a-f0-9-]{36}\/[a-f0-9]{64}$/.test(url)) return url;
    try { return ['https:', 'http:'].includes(new URL(url).protocol) ? url : undefined; } catch { return undefined; }
}
