const assert = require('node:assert/strict');
const database = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ids = Array.from({length:12}, (_,i) => (i+1).toString(16).repeat(8) + '-1111-4111-8111-' + (i+1).toString(16).repeat(12));
const [published, hidden, target, text, image, nested, row, table, child, linked, synced] = ids;
const page = (id, visible, title) => ({ object:'page', id, parent:{database_id:database}, created_time:'2026-10-01T00:00:00Z', last_edited_time:'2026-10-02T00:00:00Z', properties:{
  책제목:{type:'title',title:[{plain_text:title}]}, 저자:{type:'rich_text',rich_text:[{plain_text:'저자'}]}, 분류:{type:'select',select:{name:'독서'}}, 공개:{type:'checkbox',checkbox:visible}, 개인메모:{type:'rich_text',rich_text:[{plain_text:'PROPERTY_SECRET'}]},
}});
const rt = (text) => ({type:'text',plain_text:text,text:{content:text},annotations:{bold:true}});
function upstream() {
  const pages = [page(published,true,'공개 책'),page(hidden,false,'PRIVATE_TITLE'),page(target,true,'연결 책')];
  const calls=[];
  const block = (id,type,value,has_children=false) => ({object:'block',id,type,[type]:value,has_children,created_time:'2026-10-01T00:00:00Z',last_edited_time:'2026-10-02T00:00:00Z'});
  const fetch = async (url, init={}) => {
    const u=new URL(url);assert.equal(u.hostname,'api.notion.com');
    calls.push({path:u.pathname,search:u.search,body:init.body ? JSON.parse(init.body) : undefined,init});
    if(u.pathname==='/v1/databases/'+database+'/query') return Response.json({results:pages.filter(p=>p.properties.공개.checkbox),has_more:false});
    if(u.pathname.startsWith('/v1/pages/')) {
      const p=pages.find(p=>p.id===u.pathname.split('/').pop());return p ? Response.json(p) : Response.json({code:'object_not_found'},{status:404});
    }
    if(u.pathname==='/v1/blocks/'+published+'/children') {
      if(u.searchParams.has('start_cursor')) return Response.json({results:[block(image,'image',{file:{url:'https://example.com/signed-image.png?signature=fixture'}})],has_more:false});
      return Response.json({results:[
        block(text,'paragraph',{rich_text:[rt('공개 본문'),{type:'mention',plain_text:'PRIVATE_TITLE',mention:{page:{id:hidden}}},{type:'mention',mention:{page:{id:target}},plain_text:'연결 책'}, {type:'text',plain_text:'PRIVATE_TITLE',href:'https://www.notion.so/'+hidden.replaceAll('-',''),text:{content:'PRIVATE_TITLE'}}]},true),
        block(table,'table',{table_width:2,has_column_header:true},true),
        block(hidden,'child_page',{title:'PRIVATE_TITLE'},true),
        block(child,'child_database',{title:'PRIVATE_DATABASE'},true),
        block(linked,'link_to_page',{page_id:hidden}),
        block(synced,'synced_block',{synced_from:{block_id:hidden}},true),
      ],has_more:true,next_cursor:'next'});
    }
    if(u.pathname==='/v1/blocks/'+text+'/children') return Response.json({results:[block(nested,'to_do',{rich_text:[rt('중첩된 문장')],checked:true})],has_more:false});
    if(u.pathname==='/v1/blocks/'+table+'/children') return Response.json({results:[block(row,'table_row',{cells:[[rt('표 셀')],[rt('둘째 셀')]]})],has_more:false});
    if(u.pathname==='/v1/blocks/'+target+'/children') return Response.json({results:[],has_more:false});
    throw new Error('Unexpected or unauthorized read: '+u.pathname);
  };
  return {pages,calls,fetch};
}

module.exports = { database, ids, upstream };
