import { publishedBooks, siteUrl } from '../utils/published-notion';
import { noPublicationCache } from '../utils/notion-server';
import type { GetServerSideProps } from 'next';
export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  noPublicationCache(res);
  try {
    const books = await publishedBooks();
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const origin = escape(siteUrl());
    const xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' + origin + '</loc></url>'
      + books.map((book) => '<url><loc>' + origin + '/' + book.id + '</loc><lastmod>' + new Date(book.lastEditedTime).toISOString() + '</lastmod></url>').join('') + '</urlset>';
    res.setHeader('Content-Type', 'application/xml; charset=utf-8'); res.write(xml); res.end();
  } catch { res.statusCode = 503; res.end('Sitemap unavailable'); }
  return { props: {} };
};
export default function Sitemap() { return null; }
