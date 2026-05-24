const fs = require('fs');
const path = require('path');
process.chdir(__dirname);

function decode(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&#x([0-9a-fA-F]+);/g,(_,h)=>String.fromCodePoint(parseInt(h,16)))
    .replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(+d));
}

const slugs = ['dev-stack','network','account-abstraction','defi','oracle','indexing','security'];
for (const slug of slugs) {
  let s = fs.readFileSync(`handbook-raw/${slug}.html`,'utf8');
  const m = s.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  let body = m ? m[1] : s;
  body = body.replace(/<script[\s\S]*?<\/script>/g,'')
             .replace(/<style[\s\S]*?<\/style>/g,'')
             .replace(/<\/(h[1-6]|p|li|div|section|article|tr)>/g,'\n')
             .replace(/<br\s*\/?>/g,'\n')
             .replace(/<[^>]+>/g,' ');
  body = decode(body)
    .replace(/[ \t]+/g,' ')
    .replace(/\n\s*\n+/g,'\n\n')
    .trim();
  fs.writeFileSync(`handbook-text/${slug}.txt`, body);
  console.log(slug, body.length);
}
