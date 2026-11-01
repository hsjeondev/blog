"use client";
import { PageHead } from "../components/PageHead";
import Link from "next/link";
import { motion } from 'framer-motion';
import PostGrid from '../components/PostGrid';
import { publishedBooks } from "../utils/blog-data";
import { noPublicationCache } from "../utils/notion-server";
import IonIcon from "../components/Icon";
import { useEffect } from 'react';

export async function getServerSideProps({ res }) {
  noPublicationCache(res);
  try {
    const posts = (await publishedBooks()).filter(post => post.kind === 'post');
    return { props: { books: posts.filter(post => post.source === 'books').slice(0, 6), writing: posts.filter(post => post.source === 'writing').slice(0, 6), loadError: false } };
  } catch {
    res.statusCode = 503;
    return { props: { books: [], writing: [], loadError: true } };
  }
}

export default function Home({ books, writing, loadError }) {

  useEffect(() => {
    const savedPosition = sessionStorage.getItem('indexScrollPosition');
    if (savedPosition) {
      window.scrollTo(0, parseInt(savedPosition, 10));
    }
    const handleScroll = () => {
      if (window.scrollY !== 0) {
        sessionStorage.setItem('indexScrollPosition', window.scrollY);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <motion.main
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="container mx-auto px-4 py-8"
    >
      <PageHead
        title="프리머그의 Blog"
        url="https://blog.yuntae.in"
        image={`${process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'}/api/social-image`}
      />

      <motion.h1 layoutId="page-hero" className="text-2xl text-gray-400 font-black mb-4 md:text-3xl text-balance" style={{ wordBreak: 'keep-all', overflowWrap: 'break-word' }}>
        안녕하세요, <span style={{ color: 'var(--foreground)' }}>프리머그</span>입니다.<br />
        <span style={{ color: 'var(--foreground)' }}>책</span>으로 쌓은 <span style={{ color: 'var(--foreground)' }}>지식</span>을 기록하고 연결합니다.
      </motion.h1>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="hidden text-white text-md font-extrabold py-2 px-4 rounded-2xl mb-16"
        style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
        About Me <IonIcon name="chevron-forward" className="relative top-1" />
      </motion.button>


      {loadError && <p role="alert">기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>}
      {!loadError && [
        { title: '책 이야기', path: '/books', posts: books },
        { title: '글 이야기', path: '/writing', posts: writing },
      ].map(section => <section key={section.path} className="mt-12" aria-label={section.title}>
        <h2 className="text-xl md:text-2xl font-black mb-5">
          <Link href={section.path} aria-label={`${section.title} 전체 보기`} className="inline-flex items-center gap-2 no-underline text-inherit">
            {section.title}<IonIcon name="chevron-forward" />
          </Link>
        </h2>
        {section.posts.length ? <PostGrid posts={section.posts} /> : <p>공개된 글이 아직 없습니다.</p>}
      </section>)}
    </motion.main>
  );
}
