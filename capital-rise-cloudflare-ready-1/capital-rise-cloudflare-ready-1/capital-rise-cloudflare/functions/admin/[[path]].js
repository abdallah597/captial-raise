async function sha256(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function onRequest(ctx){
 const url=new URL(ctx.request.url), path=url.pathname;
 // Public login screen and its styles/scripts remain reachable.
 if(path==='/admin/login.html'||path==='/admin/assets/login.js'||path==='/admin/assets/admin.css') return ctx.next();
 const raw=(ctx.request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('cr_admin='))?.slice(9);
 if(!raw)return Response.redirect(new URL('/admin/login.html',url),302);
 const row=await ctx.env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').bind(await sha256(decodeURIComponent(raw))).first();
 if(!row||row.expires_at<Date.now())return Response.redirect(new URL('/admin/login.html',url),302);
 return ctx.next();
}
