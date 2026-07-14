(function(global){
  "use strict";
  const latin=new TextDecoder("windows-1252");
  const utf8=new TextDecoder("utf-8");
  const months={janvier:"01",février:"02",fevrier:"02",mars:"03",avril:"04",mai:"05",juin:"06",juillet:"07",août:"08",aout:"08",septembre:"09",octobre:"10",novembre:"11",décembre:"12",decembre:"12"};

  function indexOfBytes(haystack,needle,start=0){outer:for(let i=start;i<=haystack.length-needle.length;i++){for(let j=0;j<needle.length;j++)if(haystack[i+j]!==needle[j])continue outer;return i;}return-1;}
  function bytes(s){return new TextEncoder().encode(s);}
  async function inflate(data){
    if(!global.DecompressionStream)throw new Error("Décompression non prise en charge par ce navigateur.");
    let last;
    for(const mode of ["deflate","deflate-raw"]){try{const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream(mode));return new Uint8Array(await new Response(stream).arrayBuffer());}catch(e){last=e;}}
    throw last||new Error("Flux PDF non décompressable.");
  }
  function decodePdfLiteral(s){
    let out="";
    for(let i=0;i<s.length;i++){
      if(s[i]!=="\\"){out+=s[i];continue;}
      const n=s[++i];if(n==null)break;
      const map={n:"\n",r:"\r",t:"\t",b:"\b",f:"\f","(":"(",")":")","\\":"\\"};
      if(map[n]!=null){out+=map[n];continue;}
      if(/[0-7]/.test(n)){let oct=n;for(let k=0;k<2&&/[0-7]/.test(s[i+1]||"");k++)oct+=s[++i];out+=String.fromCharCode(parseInt(oct,8));continue;}
      if(n==="\r"&&s[i+1]==="\n")i++;
    }
    return out;
  }
  function unicodeFromHex(hex){
    hex=hex.replace(/\s/g,"");if(!hex)return"";
    const arr=new Uint8Array(Math.floor(hex.length/2));for(let i=0;i<arr.length;i++)arr[i]=parseInt(hex.slice(i*2,i*2+2),16);
    if(arr.length>=2&&(arr[0]===0xFE&&arr[1]===0xFF)){let s="";for(let i=2;i+1<arr.length;i+=2)s+=String.fromCharCode((arr[i]<<8)|arr[i+1]);return s;}
    const zeros=[...arr].filter((v,i)=>i%2===0&&v===0).length;
    if(arr.length%2===0&&zeros>arr.length/5){let s="";for(let i=0;i+1<arr.length;i+=2)s+=String.fromCharCode((arr[i]<<8)|arr[i+1]);return s;}
    return latin.decode(arr);
  }
  function buildCMap(text){
    const map=new Map();
    for(const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const p of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g))map.set(p[1].toUpperCase(),unicodeFromHex(p[2]));
    for(const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)){
      for(const p of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)){
        const a=parseInt(p[1],16),b=parseInt(p[2],16),dst=parseInt(p[3],16),width=p[1].length,dw=p[3].length;
        if(b-a<1000)for(let i=a;i<=b;i++)map.set(i.toString(16).toUpperCase().padStart(width,"0"),unicodeFromHex((dst+i-a).toString(16).toUpperCase().padStart(dw,"0")));
      }
      for(const p of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]+)\]/g)){
        const a=parseInt(p[1],16),b=parseInt(p[2],16),width=p[1].length,vals=[...p[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map(x=>x[1]);
        for(let i=a;i<=b&&i-a<vals.length;i++)map.set(i.toString(16).toUpperCase().padStart(width,"0"),unicodeFromHex(vals[i-a]));
      }
    }
    return map;
  }
  function decodeHexWithMap(hex,map){
    hex=hex.replace(/\s/g,"").toUpperCase();if(!map.size)return unicodeFromHex(hex);
    const lengths=[...new Set([...map.keys()].map(k=>k.length))].sort((a,b)=>b-a);let out="",i=0;
    while(i<hex.length){let found=false;for(const len of lengths){const key=hex.slice(i,i+len);if(map.has(key)){out+=map.get(key);i+=len;found=true;break;}}if(!found){out+=unicodeFromHex(hex.slice(i,i+2));i+=2;}}
    return out;
  }
  function extractTextOperators(content,cmap){
    const lines=[];const blocks=content.match(/BT[\s\S]*?ET/g)||[content];
    for(const block of blocks){
      const parts=[];
      for(const m of block.matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g))parts.push({i:m.index,t:decodePdfLiteral(m[1])});
      for(const m of block.matchAll(/<([0-9A-Fa-f\s]+)>\s*(?:Tj|'|")/g))parts.push({i:m.index,t:decodeHexWithMap(m[1],cmap)});
      for(const m of block.matchAll(/\[([\s\S]*?)\]\s*TJ/g)){
        let t="";for(const x of m[1].matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>/g))t+=x[1]!=null?decodePdfLiteral(x[1]):decodeHexWithMap(x[2],cmap);parts.push({i:m.index,t});
      }
      parts.sort((a,b)=>a.i-b.i);const line=parts.map(p=>p.t).join(" ").replace(/\s+/g," ").trim();if(line)lines.push(line);
    }
    return lines.join("\n");
  }
  function detectPeriod(name,text){
    let m=String(name).match(/(20\d{2})[-_ .]?(0[1-9]|1[0-2])/);if(m)return`${m[1]}-${m[2]}`;
    const low=text.toLowerCase();for(const [month,num] of Object.entries(months)){const r=new RegExp(`${month}\\s+(20\\d{2})`);m=low.match(r);if(m)return`${m[1]}-${num}`;}return"";
  }
  function analyzeText(text,name,fallback=false){
    const clean=text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g," ").replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim();
    const lines=clean.split(/\n/).map(s=>s.trim()).filter(Boolean);
    const relevant=lines.filter(l=>/(REPOS\s*FIXE|CPMA|RF\b|CET|SOLDE|OUVERTURE|CLOTURE|CLÔTURE)/i.test(l)).slice(0,80);
    const decimals=[...clean.matchAll(/[-+]?\d{1,4}[,.]\d{1,3}/g)].map(m=>Number(m[0].replace(",","."))).filter(Number.isFinite);
    let cpmaCandidate=null;const cm=clean.match(/CPMA[^\d+-]{0,80}([-+]?\d{1,4}[,.]\d{1,3})/i);if(cm)cpmaCandidate=Number(cm[1].replace(",","."));
    const wordCount=(clean.match(/[A-Za-zÀ-ÿ]{3,}/g)||[]).length;
    const confidence=fallback?"faible":clean.length>1500&&wordCount>80?"élevée":clean.length>350&&wordCount>20?"moyenne":"faible";
    return{period:detectPeriod(name,clean),text:clean,relevantLines:relevant,decimals:decimals.slice(0,300),cpmaCandidate,confidence,charCount:clean.length,wordCount,method:fallback?"flux imprimables":"opérateurs texte"};
  }

  async function extract(file){
    const data=new Uint8Array(await file.arrayBuffer());
    if(latin.decode(data.slice(0,5))!=="%PDF-")throw new Error("Le fichier ne semble pas être un PDF valide.");
    const streamToken=bytes("stream"),endToken=bytes("endstream");const decoded=[];let pos=0,failed=0;
    while(true){const idx=indexOfBytes(data,streamToken,pos);if(idx<0)break;let start=idx+streamToken.length;if(data[start]===13&&data[start+1]===10)start+=2;else if(data[start]===10||data[start]===13)start++;const end=indexOfBytes(data,endToken,start);if(end<0)break;let chunk=data.slice(start,end);const dictStart=Math.max(0,idx-800),dict=latin.decode(data.slice(dictStart,idx));try{if(/\/FlateDecode/.test(dict))chunk=await inflate(chunk);decoded.push(latin.decode(chunk));}catch(e){failed++;}pos=end+endToken.length;}
    const joined=decoded.join("\n");const cmap=buildCMap(joined);let text=extractTextOperators(joined,cmap),fallback=false;
    if(text.length<120){fallback=true;const printable=(joined.match(/[\x20-\x7EÀ-ÿ]{5,}/g)||[]).map(x=>x.trim()).filter(x=>/[A-Za-zÀ-ÿ]{3,}/.test(x)&&!/^[/%%]/.test(x)&&((x.match(/[A-Za-zÀ-ÿ]/g)||[]).length/Math.max(x.length,1)>.25));text=printable.join("\n");}
    const result=analyzeText(text,file.name,fallback);result.streams=decoded.length;result.failedStreams=failed;result.warning=result.charCount<120?"La couche texte est absente ou fortement encodée. Le PDF est conservé, mais les champs devront être contrôlés manuellement.":"Extraction locale à contrôler avant validation.";return result;
  }

  global.JMPPDF={extract};
})(window);
