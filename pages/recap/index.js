import { PageHead } from "../../components/PageHead";
import { RecapViewer } from "../../components/Recap/RecapViewer";
import { getDatabase } from "../../utils/blog-data";
import { bookMetadata, publicationKind } from "../../utils/blog-data";
import { noPublicationCache } from "../../utils/notion-server";



function propertyText(property) {
  if (!property) return "";
  if (property.type === "rich_text") return property.rich_text?.map((item) => item.plain_text || item.text?.content || "").join("") || "";
  if (property.type === "title") return property.title?.map((item) => item.plain_text || item.text?.content || "").join("") || "";
  return "";
}

function parseObjects(property) {
  const text = propertyText(property).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\r?\n/g, "").trim();
  if (!text) return [];
  try {
    const value = JSON.parse(text);
    return (Array.isArray(value) ? value : [value])
      .filter((item) => item && typeof item === "object")
      .map((item) => Object.fromEntries(Object.entries(item).map(([key, itemValue]) => [key, typeof itemValue === "string" ? itemValue.trim() : itemValue])));
  } catch (error) {
    console.warn("Invalid recap property JSON:", error.message);
    return [];
  }
}

function namedProperty(properties, name) {
  const key = Object.keys(properties || {}).find((candidate) => candidate.trim().toLowerCase() === name);
  return key ? properties[key] : undefined;
}

function monthKey(value) {
  if (typeof value === "string") {
    const dateOnly = value.match(/^(\d{4})-(\d{2})-\d{2}$/);
    if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}`;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : "";
}

export async function getServerSideProps({ res }) {
  noPublicationCache(res);
  try {
    const data = await getDatabase();
    const currentMonth = monthKey(new Date());
    const posts = data.results.filter((page) => publicationKind(page) === "recap").map((page) => ({
      id: page.id,
      title: bookMetadata(page).title,
      subtitle: propertyText(namedProperty(page.properties, "subtitle")),
      date: page.properties?.["forest_날짜"]?.date?.start || page.created_time,
      properties: {
        music: parseObjects(namedProperty(page.properties, "music")),
        watching: parseObjects(namedProperty(page.properties, "watching")),
        reading: parseObjects(namedProperty(page.properties, "reading")),
      },
    }))
      .filter((post) => monthKey(post.date) !== currentMonth)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    return { props: { posts } };
  } catch (error) {
    console.error("Failed to fetch recap:", error);
    res.statusCode = 503;
    return { props: { posts: [] } };
  }
}

export default function Recap({ posts }) {
  return (
    <>
      <PageHead title="월말결산 | 프리머그의 Blog" url="https://blog.yuntae.in/recap" />
      <RecapViewer posts={posts} />
    </>
  );
}
