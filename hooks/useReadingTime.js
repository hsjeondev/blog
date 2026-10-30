import { useState, useEffect } from 'react';
import { calculateReadingTime } from '../utils/readingTime';
import { extractTextFromRecordMap } from '../utils/extract-text';

export const useReadingTime = (recordMap) => {
    const [readTime, setReadTime] = useState(0);

    useEffect(() => {
        if (!recordMap) return;
        if (Number.isFinite(recordMap.reading_minutes)) {
            setReadTime(recordMap.reading_minutes);
            return;
        }

        const text = extractTextFromRecordMap(recordMap);
        const time = calculateReadingTime(text);
        setReadTime(time);
    }, [recordMap]);

    return Number.isFinite(recordMap?.reading_minutes) ? recordMap.reading_minutes : readTime;
};
