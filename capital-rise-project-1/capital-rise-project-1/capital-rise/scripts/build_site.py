import re,sys
src=open(sys.argv[1],encoding='utf-8').read()
L=src.split('\n')
start=next(i for i,l in enumerate(L) if l.strip()=='/* admin panel */')
end=next(i for i,l in enumerate(L) if l.strip()=='</style>')
txt='\n'.join(L[:start]+L[end:])
txt=re.sub(r'<button id="open"[^\n]*</button>\n','',txt)
txt=re.sub(r'<aside id="adm"[^\n]*</aside>\n','',txt)
txt=re.sub(r'<div id="toast"[^\n]*</div>\n','',txt)
txt=re.sub(r'<input type="file" id="fi"[^\n]*>\n','',txt)
a=txt.index('/* ---------- admin ---------- */')
b=txt.index("H.lang=LANG;H.dir=LANG==='en'")
txt=txt[:a]+txt[b:]
c=txt.index('// Admin is hidden by default.')
d=txt.index('</script>',c)
txt=txt[:c]+txt[d:]
old="let S=clone(D);try{S=merge(clone(D),JSON.parse(localStorage.getItem('cr_v1')||'null'))}catch(e){}"
assert old in txt
txt=txt.replace(old,"let S=clone(D);try{S=merge(clone(D),window.__CR__||null)}catch(e){}")
for pat in [r"let tm;const toast=[^\n]*\n",r"let sv;const save=[^\n]*\n",r"const get=\(o,p\)=>[^\n]*\n",r"const set=\(o,p,v\)=>[^\n]*\n",r"const BLANK=[^\n]*\n"]:
    txt=re.sub(pat,"",txt)
m=re.search(r"const waLink=\(\)=>[^\n]*\n",txt); assert m
new_wa=("const waNum=()=>String((S.contact&&S.contact.whatsapp)||'').replace(/\\D/g,'');\n"
        "const waLink=t=>{const n=waNum();if(!n)return '#contact';const m=t||(S.contact&&S.contact.waMsg)||'';return 'https://wa.me/'+n+(m?'?text='+encodeURIComponent(m):'')};\n")
txt=txt.replace(m.group(0),new_wa)
txt=txt.replace("if(x.key==='whatsapp')return x.url||waLink();","if(x.key==='whatsapp')return waLink();")
txt,n=re.subn(r"const link=\(\)=>\{const c=S\.contact;if\(c\.whatsapp\)return waLink\(\);","const link=()=>{const c=S.contact;if(waNum())return waLink();",txt); assert n==1
old_s='<a class="go" href="${esc(link())}">${esc(s.cta)}</a>'
assert old_s in txt
txt=txt.replace(old_s,'<a class="go" href="${esc(waLink(\'أرغب في طلب خدمة: \'+s.title))}" target="_blank" rel="noopener">${esc(s.cta)}</a>')
old_c='<a class="btn btn-p mag rv" href="${esc(link())}">${esc(S.cta.btn)}</a>'
assert old_c in txt
txt=txt.replace(old_c,'<a class="btn btn-p mag rv" href="${esc(link())}" target="_blank" rel="noopener">${esc(S.cta.btn)}</a>')
old_chip="`<a href=\"https://wa.me/${esc(c.whatsapp.replace(/\\D/g,''))}\">واتساب</a>`"
assert old_chip in txt
txt=txt.replace(old_chip,"`<a href=\"${esc(waLink())}\" target=\"_blank\" rel=\"noopener\">واتساب</a>`")
assert '<script>\nconst LOGO=' in txt
txt=txt.replace('<script>\nconst LOGO=','<!--CR_DATA-->\n<script>\nconst LOGO=',1)
open(sys.argv[2],'w',encoding='utf-8').write(txt)
print('ok',len(txt))
for k in ['localStorage','cr_v1','cr_pin','#adm','openA','claude.use','toast']:
    print(k, txt.count(k))
