import { NotionRenderer } from '../../packages/notionx'
import 'katex/dist/katex.min.css'
import { useEffect, useState } from 'react'
import { calculateReadingTime } from '../../utils/readingTime'
import { Code, Collection, Equation, Pdf, Modal, mapPublishedImageUrl } from '../../utils/notion-components'
import { getNotionPage, isNotionNotFound } from '../../utils/blog-data'

export async function getServerSideProps({ params, res }) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    const { pageId: rawPageId } = params;
    if (!rawPageId) {
        return {
            notFound: true
        };
    }

    const pageIdMatch = rawPageId.match(
        /([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i
    );

    if (!pageIdMatch) {
        return {
            notFound: true
        };
    }

    const compactPageId = pageIdMatch[1].replace(/-/g, '');
    const pageId = compactPageId.replace(
        /(.{8})(.{4})(.{4})(.{4})(.{12})/,
        '$1-$2-$3-$4-$5'
    );

    try {
        const recordMap = await getNotionPage(pageId)

        return {
            props: {
                pageId,
                recordMap
            }
        }
    } catch (error) {
        if (isNotionNotFound(error)) return { notFound: true };
        console.error('Failed to read published page');
        throw error;
    }
}

export default function Page({ pageId, recordMap }) {
    if (!recordMap || !recordMap.block || Object.keys(recordMap.block).length === 0) {
        return <div>Invalid page data</div>;
    }

    const [content, setContent] = useState('');
    const [readTime, setReadTime] = useState(0);
    const [darkmode, setDarkmode] = useState(false);

    useEffect(() => {
        const notionPage = document.querySelector(".notion-page");
        const codeBlocks = notionPage?.querySelectorAll('.notion-code');
        let body = notionPage?.innerText || '';

        // Remove text content from code blocks
        codeBlocks?.forEach(codeBlock => {
            body = body.replace(codeBlock.innerText, '');
        });

        const text = body
            // 이미지 제거
            .replaceAll(/!\[([^\]]+?)\]\([^)]+?\)/g, '')
            // 링크는 텍스트만 남기고 제거
            .replaceAll(/\[([^\]]+?)\]\([^)]+?\)/g, '$1')
            // 코드 블록 제거
            .replaceAll(/```[^\n]+?\n([\s\S]+?)\n```/g, '')
            // 불렛 제거
            .replaceAll(/- ([^\n]+?)\n/g, '$1\n')
            // 특수문자 제거
            .replaceAll(/([*_`~#>])/g, '')
            // '출처 : <링크>' 형태 제거
            .replaceAll(/출처\s*:\s*https?:\/\/[^\s]+/g, '')
            // 좌우 공백 제거
            .replaceAll("<", " ")
            .trim();
        setContent(text);

        const time = calculateReadingTime(text);
        setReadTime(time);

        const checkDarkMode = () => {
            try {
                const params = new URLSearchParams(window.location.search);
                const queryTheme = params.get('theme') || params.get('mode');
                const queryDark = params.get('dark');
                if (queryTheme === 'dark' || queryDark === 'true' || queryDark === '1') {
                    return true;
                }
                if (queryTheme === 'light' || queryDark === 'false' || queryDark === '0') {
                    return false;
                }
            } catch (e) {}
            return window.matchMedia('(prefers-color-scheme: dark)').matches;
        };

        const isDark = checkDarkMode();
        setDarkmode(isDark);

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleColorSchemeChange = () => {
            setDarkmode(checkDarkMode());
        };

        mediaQuery.addEventListener('change', handleColorSchemeChange);

        const handleMessage = (event) => {
            if (!event.data) return;
            const data = event.data;
            if (data.theme === 'dark' || data === 'dark' || data.darkMode === true || data.mode === 'dark') {
                setDarkmode(true);
            } else if (data.theme === 'light' || data === 'light' || data.darkMode === false || data.mode === 'light') {
                setDarkmode(false);
            }
        };
        window.addEventListener('message', handleMessage);

        const contentContainer = document.querySelector(".custom-content");
        if (contentContainer) {
            const links = contentContainer.querySelectorAll('a');
            links.forEach(link => {
                if (!link.getAttribute('href')?.startsWith('#')) {
                    link.setAttribute('target', '_blank');
                }
            });
        }

        let initialMessage = { height: document.body.scrollHeight };
        window.top.postMessage(initialMessage, "*");

        const intervalId = setInterval(() => {
            let message = { height: document.body.scrollHeight };
            window.top.postMessage(message, "*");
        }, 1000);

        return () => {
            mediaQuery.removeEventListener('change', handleColorSchemeChange);
            window.removeEventListener('message', handleMessage);
            clearInterval(intervalId);
        };
    }, []);

    useEffect(() => {
        const root = document.documentElement;
        if (darkmode) {
            root.classList.add('dark');
            root.classList.remove('light');
            root.style.colorScheme = 'dark';
        } else {
            root.classList.add('light');
            root.classList.remove('dark');
            root.style.colorScheme = 'light';
        }
    }, [darkmode]);

    return (
        <div className="custom-content">
            <NotionRenderer
                recordMap={recordMap}
                        mapImageUrl={mapPublishedImageUrl}
                components={{
                    Code,
                    Collection,
                    Equation,
                    Modal
                }}
                fullPage={false}
                darkMode={darkmode}
                showTableOfContents={true}
                previewImages={!!recordMap.preview_images}
            />
            <style jsx global>{`
            html, body {
                background: transparent !important;
                background-color: transparent !important;
                color: var(--foreground) !important;
                overflow: hidden !important;
            }

            .custom-content,
            .notion,
            .notion-page,
            .notion-page-content,
            .notion-page-content-inner {
                background: transparent !important;
                background-color: transparent !important;
            }

    header, aside {
        display: none !important;
    }

    .custom-content {
        width: 100dvw;
        max-width: 100dvw;
    }

    img {
        pointer-events: none;
    }
    `}
            </style>
        </div>
    );
}
