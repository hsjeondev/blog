import { NotionRenderer } from '../packages/notionx'
import 'katex/dist/katex.min.css'
import { useEffect } from 'react'
import { Backlinks } from '../components/Backlinks'
import { PageHead } from '../components/PageHead'
import { motion } from 'framer-motion';
import { Code, Collection, Equation, Modal, mapPublishedImageUrl } from '../utils/notion-components'
import { getNotionPage, isNotionNotFound } from '../utils/blog-data'

import { usePostMetadata } from '../hooks/usePostMetadata'
import { useReadingTime } from '../hooks/useReadingTime'
import { useDarkMode } from '../hooks/useDarkMode'

import { PostHeader } from '../components/Post/PostHeader'
import { PostActions } from '../components/Post/PostActions'

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

        const summary = null; // AI summaries will be enabled in a later step.

        return {
            props: {
                pageId,
                recordMap,
                summary
            }
        }
    } catch (error) {
        if (isNotionNotFound(error)) return { notFound: true };
        console.error('Failed to read published page');
        throw error;
    }
}

export default function Page({ pageId, recordMap, summary }) {
    if (!recordMap || !recordMap.block || Object.keys(recordMap.block).length === 0) {
        return <div>Invalid page data</div>;
    }

    const { title, category, tags, date } = usePostMetadata(pageId, recordMap);
    const readTime = useReadingTime(recordMap);
    const darkMode = useDarkMode();
    useEffect(() => {
        if (typeof window !== 'undefined') {
            if (window.location.pathname !== `/${pageId}`) {
                window.history.replaceState(null, '', `/${pageId}`);
            }
        }
    }, [pageId]);

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.15,
                delayChildren: 0.1
            }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.25 } }
    };

    return (
        <motion.main
            className="post-reading-layout"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={containerVariants}
        >
            <PageHead
                title={title || "프리머그의 Blog"}
                url={`https://blog.yuntae.in/${pageId}`}
                image={`${process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'}/api/social-image?id=${pageId}`}
            />

            <div className='page-container'>
                <PostHeader
                    title={title}
                    category={category}
                    tags={tags}
                    date={date}
                    readTime={readTime}
                    summary={summary}
                />

                <motion.div variants={itemVariants} className="post-content">
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
                        darkMode={darkMode}
                        showTableOfContents={true}
                        previewImages={!!recordMap.preview_images}
                    />
                </motion.div>

                <motion.div variants={itemVariants} className='m-16' />

                <PostActions title={title} pageId={pageId} />

                <motion.div variants={itemVariants}>
                    <Backlinks currentId={pageId} currentTitle={title} />
                </motion.div>
            </div>
        </motion.main>
    );
}
