import React, { createContext, useState, useEffect } from "react";
import 'prismjs/themes/prism-tomorrow.css';
import "../styles/globals.css";
import '../styles/notion.css'
import '../styles/recap.css'
import '../styles/forest.css'
import '../styles/search.css'
import '../styles/graph.css'
import '../styles/post-narration.css'
import { Header } from "../components/Header";
import { useRouter } from 'next/router';
import { Spinner } from "../components/Spinner";
import { motion } from 'framer-motion';

import { ThemeProvider } from "../hooks/useDarkMode";
import { SearchProvider } from "../components/Search/SearchProvider";

export const currentPostContext = createContext({
  title: '',
  postId: '',
  setTitle: (title) => { },
  setPostId: (postId) => { },
});

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("프리머그의 Blog");
  const [postId, setPostId] = useState('');

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    const handleStart = (_url, options = {}) => {
      if (!options.shallow) setLoading(true);
    };
    const handleComplete = () => {
      setLoading(false);
      setTitle('');
    }

    router.events.on('routeChangeStart', handleStart);
    router.events.on('routeChangeComplete', handleComplete);
    router.events.on('routeChangeError', handleComplete);

    return () => {
      router.events.off('routeChangeStart', handleStart);
      router.events.off('routeChangeComplete', handleComplete);
      router.events.off('routeChangeError', handleComplete);
    };
  }, [router]);

  return (
    <ThemeProvider>
      <SearchProvider>
      <currentPostContext.Provider value={{ title, postId, setTitle, setPostId }}>
        {loading ? title ? (
          <motion.div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              background: 'var(--background)',
              overflow: 'hidden',
              zIndex: 300,
            }}
            transition={{ layout: { duration: 0.5, ease: "easeInOut" } }}
            className="flex flex-col justify-center px-4 md:px-16"
          >
            <motion.h2
              transition={{ duration: 0.5, ease: "easeInOut" }}
              style={{
                color: 'var(--foreground)',
                wordBreak: 'keep-all',
                overflowWrap: 'break-word',
                textWrap: 'balance'
              }}
              className="shimmering w-fit text-3xl md:text-5xl font-black mt-2 -ml-1px"
            >
              {title || document.title}
            </motion.h2>
          </motion.div>
        ) : (
          <Spinner />
        ) : (
          <Component
            {...pageProps}
            key={router.pathname === '/forest' ? router.pathname : router.asPath}
          />
        )}
        {router.pathname !== '/graph' && <Header />}
      </currentPostContext.Provider>
      </SearchProvider>
    </ThemeProvider>
  );
}
