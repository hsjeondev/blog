import IonIcon from '@reacticons/ionicons';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';

interface Comment {
    id: string;
    created_by: {
        id: string;
    };
    rich_text: Array<{
        plain_text: string;
    }>;
    created_time: string;
}

interface CommentsProps {
    pageId: string;
}

export default function Comments({ pageId }: CommentsProps) {
    const [comments, setComments] = useState<Comment[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [newComment, setNewComment] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const fetchComments = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/comments/${pageId}`);
            const data = await res.json();
            setComments(res.ok && Array.isArray(data.results) ? data.results : []);
        } catch (error) {
            console.error('Failed to fetch comments:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchComments();
    }, [pageId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newComment.trim()) return;

        try {
            const res = await fetch(`/api/comments/${pageId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: newComment }),
            });

            if (res.ok) {
                setNewComment('');
                fetchComments();
            }
        } catch (error) {
            console.error('Failed to post comment:', error);
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <div className="my-8">
            <h3 className="text-lg font-bold mb-4">댓글 {comments.length}개</h3>

            <form onSubmit={handleSubmit} className="mb-8">
                <textarea
                    ref={textareaRef}
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="입력한 댓글은 수정하거나 삭제할 수 없어요"
                    className="w-full text-sm p-4 rounded-2xl border border-gray-200 dark:border-gray-700 
                   bg-transparent resize-none transition-all focus:ring-2 
                   focus:ring-blue-500 focus:border-transparent"
                    rows={1}
                />
                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="mt-1 px-6 py-2 text-sm rounded-xl 
                   hover:bg-blue-600 transition-colors float-right"
                    style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}
                    type="submit"
                >
                    댓글 남기기
                </motion.button>
            </form>

            <br /><br />

            <AnimatePresence>
                {isLoading ? (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex justify-center items-center py-8"
                    >
                        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent 
                          rounded-full animate-spin"/>
                    </motion.div>
                ) : (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="space-y-4"
                    >
                        {comments.map((comment) => (
                            <motion.div
                                key={comment.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                className="p-4 pt-1 rounded-2xl bg-gray-50 dark:bg-gray-800"
                            >

                                {comment.created_by.id == "b134fa0d-0a42-457c-be65-3fcc91bd5c0e" && (
                                    <div className="mt-3">
                                        <span className="text-gray-500 dark:text-gray-400">
                                            프리머그 <IonIcon name="checkmark-circle" className="text-blue-500" style={{ position: 'relative', top: '2px' }} />
                                        </span>
                                    </div>
                                )}
                                <p className="text-gray-800 dark:text-gray-200 m-0 mt-2">
                                    {comment.rich_text[0]?.plain_text}
                                </p>
                                <span className="text-sm text-gray-500">
                                    {formatDate(comment.created_time)}
                                </span>
                            </motion.div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
