import re, html
ROW = re.compile(
    r'(\d{4}-\s*\d{1,2}-\s*\d{1,2})\s+(\d{1,2}:\s*\d{1,2}:\s*\d{1,2})\s+'
    r'(&lt;DIR&gt;|[\d.]+\s*[KMG]?B)\s*<a\s+href="([^"]+)"[^>]*>\s*(.*?)\s*</a>', re.I|re.S)
def parse(t):
    out=[]
    for d,tm,sz,href,lbl in ROW.findall(t):
        name=html.unescape(re.sub('<[^>]+>','',lbl)).strip()
        if name in ('.','..'): continue
        out.append(dict(name=name, href=html.unescape(href),
                        mtime=f"{d.replace(' ','')} {tm.replace(' ','')}",
                        size=html.unescape(sz).strip(),
                        isdir=('DIR' in sz)))
    return out
