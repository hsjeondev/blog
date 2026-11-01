import { AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/router';
import { ArticleCard } from './ArticleCard';

export default function PostGrid({ posts }) {
  const router = useRouter();
  return <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
    <AnimatePresence>{posts.map((post, index) => <div key={post.id} className="min-w-0">
      <ArticleCard post={post} coverPriority={post.source === 'books' && index < 6} onClick={() => router.push(`/${post.id}`)} />
    </div>)}</AnimatePresence>
  </div>;
}
