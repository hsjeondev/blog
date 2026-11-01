import Link from 'next/link';
import { useRouter } from 'next/router';
import PostGrid from './PostGrid';
import { PageHead } from './PageHead';

export default function PostCollection({ title, path, list, loadError }) {
  const router = useRouter();
  const category = typeof router.query.category === 'string' ? router.query.category : '';
  const counts = new Map();
  for (const post of list) if (post.category) counts.set(post.category, (counts.get(post.category) || 0) + 1);
  const categories = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  const visible = category ? list.filter(post => post.category === category) : list;
  const tabs = [{ name: '전체', category: '', count: list.length }, ...categories.map(name => ({ name, category: name, count: counts.get(name) }))];

  return <main className="container mx-auto px-4 py-8">
    <PageHead title={`${title} | 프리머그의 Blog`} url={`${process.env.NEXT_PUBLIC_URL || 'https://blog.jeonhongshik.com'}${path}`} />
    <h1 className="text-2xl md:text-3xl font-black mb-8">{title}</h1>
    <nav aria-label={`${title} 카테고리`} className="flex gap-5 overflow-x-auto mb-8 pb-1">
      {tabs.map(tab => <Link key={tab.category} href={{ pathname: path, query: tab.category ? { category: tab.category } : {} }} shallow scroll={false}
        aria-current={category === tab.category ? 'page' : undefined}
        className="shrink-0 whitespace-nowrap no-underline font-bold py-3 border-b-2"
        style={{ color: category === tab.category ? 'var(--foreground)' : 'var(--text-tertiary, #888)', borderColor: category === tab.category ? 'var(--foreground)' : 'transparent' }}>
        {tab.name} <span className="text-sm font-normal">({tab.count})</span>
      </Link>)}
    </nav>
    {loadError ? <p role="alert">글을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
      : !visible.length ? <p>{category ? '선택한 카테고리에 공개된 글이 없습니다.' : '공개된 글이 아직 없습니다.'}</p>
        : <PostGrid posts={visible} />}
  </main>;
}
