"use client";
import { PageHead } from "../components/PageHead";
import Link from "next/link";
import { motion, AnimatePresence } from 'framer-motion';
import { ArticleCard } from '../components/ArticleCard';
import { publishedBooks } from "../utils/published-notion";
import { noPublicationCache } from "../utils/notion-server";
import IonIcon from "@reacticons/ionicons";
import { useRouter } from 'next/router';
import { useEffect } from 'react';

export async function getServerSideProps({ res }) {
  noPublicationCache(res);
  try {
    return { props: { list: (await publishedBooks()).filter((post) => post.kind === 'post'), loadError: false } };
  } catch {
    res.statusCode = 503;
    return { props: { list: [], loadError: true } };
  }
}

export default function Home({ list, loadError }) {
  const router = useRouter();

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
      initial={{ opacity: 0 }}
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
      {!loadError && !list.length && <p>공개된 기록이 아직 없습니다.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
        <AnimatePresence>
          {list.map((post) => (
            <div key={post.id} className="no-underline">
              <ArticleCard
                post={post}
                onClick={() => router.push(`/${post.id}`)}
              />
            </div>
          ))}
        </AnimatePresence>
      </div>
    </motion.main>
  );
}
