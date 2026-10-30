export const usePostMetadata = (pageId, recordMap) => {
    if (!recordMap || !recordMap.block || !recordMap.block[pageId]) {
        return { title: '', author: '', category: '', tags: [] };
    }

    const metadata = recordMap.block[pageId].value.blog_metadata;
    if (metadata) return { title: metadata.title, author: metadata.author || '', category: metadata.category, tags: metadata.tags.map(tag => tag.name), date: metadata.date?.slice(0, 10) || '' };
    const properties = recordMap.block[pageId].value.properties;
    let title = '';
    let category = '';
    let tags = [];

    if (properties) {
        if (properties["fVc<"]) {
            title = properties.title?.[0]?.[0] || '';
            category = properties["fVc<"]?.[0]?.[0] || '';
            tags = properties["f|n]"]?.toString().split(',') || [];
        } else {
            title = properties.title?.[0]?.[0] || '';
        }
    }

    const dateProperty = properties?.["cwqu"];
    const date = dateProperty?.[0]?.[1]?.[0]?.[1]?.start_date || '';

    return { title, author: '', category, tags, date };
};
