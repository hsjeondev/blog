import PostCollection from '../../components/PostCollection';
import { sectionPosts } from '../../utils/blog-data';
import { noPublicationCache } from '../../utils/notion-server';

export async function getServerSideProps({ res }) {
  noPublicationCache(res);
  try { return { props: { list: await sectionPosts('books'), loadError: false } }; }
  catch { res.statusCode = 503; return { props: { list: [], loadError: true } }; }
}

export default function Books(props) {
  return <PostCollection {...props} title="책 이야기" path="/books" />;
}
