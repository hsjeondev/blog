import { PageHead } from '../../components/PageHead';
import { ForestExplorer } from '../../components/Forest/ForestExplorer';
import { publishedBooks } from '../../utils/blog-data';
import { noPublicationCache } from '../../utils/notion-server';

export async function getServerSideProps({ res }) {
  noPublicationCache(res);
  const documents = (await publishedBooks()).filter((book) => book.kind === 'document');
  return { props: { documents } };
}
export default function Forest({ documents }) {
  return <><PageHead title="문서 | 프리머그의 Blog" url="https://blog.yuntae.in/forest" /><ForestExplorer documents={documents} /></>;
}
