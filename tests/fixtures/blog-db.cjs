const assert=require('node:assert/strict');
const {database}=require('./notion-api.cjs');
function rowFromPage(page){
 const p=page.properties||{},title=p.책제목||p.이름||Object.values(p).find(x=>x.type==='title');
 const text=x=>(x?.title||x?.rich_text||[]).map(v=>v.plain_text||v.text?.content||'').join('');
 const kind=p.유형?.select?.name||p.forest_분류?.select?.name;
 return {id:page.id,notion_database_id:page.parent?.database_id||database,title:text(title),author:text(p.저자),category:p.분류?.select?.name||'독서',tags:p.태그?.multi_select||[],
  kind:kind==='문서'?'document':kind==='프로젝트'?'project':kind==='월말결산'?'recap':'post',description:text(p.설명),folder_path:text(p.forest_폴더)||p.forest_폴더?.select?.name||'',
  written_at:p.작성일?.date?.start||page.created_time,notion_created_at:page.created_time,notion_edited_at:page.last_edited_time,
  is_published:!!p.공개?.checkbox,deleted_at:null,sync_status:'ready',assets_ready:true,icon:page.icon||null,cover:page.cover||null};
}
function blogFixture(rows=[]){
 const state={rows:structuredClone(rows),calls:[],links:[],texts:new Map(),maps:new Map(),assets:[]};
 const visible=source=>state.rows.filter(p=>p.notion_database_id===source&&p.is_published&&!p.deleted_at&&p.sync_status==='ready'&&p.assets_ready);
 state.fetch=async(url,init={})=>{
  const u=new URL(url);assert.ok(u.hostname.endsWith('.supabase.co'),'UI must only read Supabase: '+u.hostname);
  const name=u.pathname.split('/').pop(),args=init.body?JSON.parse(init.body):{};
  state.calls.push({name,args,init,path:u.pathname});const posts=visible(args.p_database),post=posts.find(p=>p.id===args.p_page);
  if(name==='blog_read_catalog')return Response.json(posts);
  if(name==='blog_read_post')return Response.json(post||null);
  if(name==='blog_read_page'){
   if(!post)return Response.json(null);
   const map=state.maps.get(post.id)||{block:{[post.id]:{value:{id:post.id,type:'page',properties:{title:[[post.title]]},format:{},content:['body']}},body:{value:{id:'body',type:'text',properties:{title:[[state.texts.get(post.id)||'공개 본문']]}}}}};
   return Response.json({post,recordMap:map,readingMinutes:3,references:posts.filter(p=>p.id!==post.id)});
  }
  if(name==='blog_read_graph'){
   const ids=new Set(posts.map(p=>p.id));return Response.json({posts,links:state.links.filter(e=>ids.has(e.source)&&ids.has(e.target))});
  }
  if(name==='blog_search_public'){
   const q=args.p_query.normalize('NFKC').toLowerCase();return Response.json(posts.filter(p=>args.p_ids.includes(p.id)&&(state.texts.get(p.id)||'').normalize('NFKC').toLowerCase().includes(q)).map(p=>({id:p.id,revision:p.notion_edited_at,excerpt:state.texts.get(p.id).slice(0,240)})));
  }
  if(name==='blog_read_asset')return Response.json(post?state.assets.find(a=>a.post_id===post.id&&a.asset_key===args.p_asset)||null:null);
  throw new Error('Unexpected database read: '+name);
 };
 return state;
}
module.exports={rowFromPage,blogFixture};
