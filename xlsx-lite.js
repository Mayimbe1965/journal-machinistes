(function(global){
  "use strict";
  const NS={r:"http://schemas.openxmlformats.org/officeDocument/2006/relationships"};
  const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
  const colName=n=>{let s="";for(n++;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
  const colIndex=ref=>{const m=String(ref).match(/^([A-Z]+)/i);if(!m)return 0;let n=0;for(const c of m[1].toUpperCase())n=n*26+c.charCodeAt(0)-64;return n-1;};
  const isoFromExcel=v=>{const d=new Date(Date.UTC(1899,11,30)+Number(v)*86400000);return d.toISOString().slice(0,10);};
  const number=v=>v==null||v===""?0:Number(v);
  const els=(root,local)=>[...(root.getElementsByTagNameNS?root.getElementsByTagNameNS("*",local):root.getElementsByTagName(local))];

  async function readWorkbook(buffer){
    if(!global.JSZip) throw new Error("Le composant ZIP local n’est pas disponible.");
    const zip=await JSZip.loadAsync(buffer);
    const text=async path=>{const f=zip.file(path);if(!f)throw new Error(`Fichier interne absent : ${path}`);return f.async("text").then(s=>s.replace(/^\uFEFF/,""));};
    const parser=new DOMParser();
    const workbookDoc=parser.parseFromString(await text("xl/workbook.xml"),"application/xml");
    const relDoc=parser.parseFromString(await text("xl/_rels/workbook.xml.rels"),"application/xml");
    const rels={};
    els(relDoc,"Relationship").forEach(r=>rels[r.getAttribute("Id")]=r.getAttribute("Target"));
    let shared=[];
    if(zip.file("xl/sharedStrings.xml")){
      const sdoc=parser.parseFromString(await text("xl/sharedStrings.xml"),"application/xml");
      shared=els(sdoc,"si").map(si=>els(si,"t").map(t=>t.textContent||"").join(""));
    }
    const sheets={};
    for(const s of els(workbookDoc,"sheet")){
      const name=s.getAttribute("name");
      const rid=s.getAttributeNS(NS.r,"id")||s.getAttribute("r:id");
      let target=rels[rid];
      if(!target)continue;
      target=target.replace(/^\//,"");
      if(!target.startsWith("xl/"))target="xl/"+target.replace(/^\.\//,"");
      const doc=parser.parseFromString(await text(target),"application/xml");
      const rows=[];
      for(const row of els(doc,"row")){
        const ri=(Number(row.getAttribute("r"))||rows.length+1)-1;
        if(!rows[ri])rows[ri]=[];
        for(const c of els(row,"c")){
          const ci=colIndex(c.getAttribute("r")||"A1");
          const t=c.getAttribute("t")||"n";
          let value="";
          if(t==="inlineStr") value=els(c,"t").map(x=>x.textContent||"").join("");
          else{
            const v=els(c,"v")[0]?.textContent??"";
            if(t==="s")value=shared[Number(v)]??"";
            else if(t==="b")value=v==="1";
            else if(t==="str"||t==="e")value=v;
            else value=v===""?null:Number(v);
          }
          rows[ri][ci]=value;
        }
      }
      sheets[name]=rows.map(r=>r||[]);
    }
    return sheets;
  }

  function parseReconstruction(sheets){
    const analysis=sheets["Analyse CPMA"];
    if(!analysis)throw new Error("La feuille « Analyse CPMA » est absente.");
    const headerIndex=analysis.findIndex(r=>String(r?.[0]||"").trim()==="Période" && r.some(v=>String(v||"").includes("CPMA")));
    if(headerIndex<0)throw new Error("En-têtes de la feuille « Analyse CPMA » non reconnus.");
    const monthly=[];
    for(const row of analysis.slice(headerIndex+1)){
      const period=String(row?.[0]||"").trim();
      if(!/^20\d{2}-\d{2}$/.test(period))continue;
      const opening=number(row[4]),movement=number(row[5]),adjustment=number(row[6]),cpma=number(row[7]),closing=number(row[8]);
      monthly.push({
        id:period,period,year:Number(row[1])||Number(period.slice(0,4)),monthName:String(row[2]||""),uo:String(row[3]||""),
        officialOpening:opening,movementRF:movement,recognizedAdjustment:adjustment,theoreticalBeforeCPMA:opening+movement+adjustment,
        cpma,officialClosing:closing,personalCumulative:number(row[9]),cumulativeGap:number(row[10]),gapVariation:number(row[11]),
        control:opening+movement+cpma-closing,normalMinutes:Math.round(number(row[12])*1440),supplementaryMinutes:Math.round(number(row[13])*1440),
        presumedRTDays:Number(row[14])||0,presumedRTMinutes:Math.round(number(row[15])*1440),assimilatedTSMinutes:Math.round(number(row[16])*1440),
        source:String(row[17]||""),status:"pending",origin:"import_xlsx",note:"Import à valider."
      });
    }
    if(!monthly.length)throw new Error("Aucune période mensuelle exploitable n’a été trouvée.");
    const byPeriod=Object.fromEntries(monthly.map(m=>[m.period,m]));
    const daily=[];
    Object.entries(sheets).filter(([name])=>/^20\d{2}$/.test(name)).forEach(([name,rows])=>{
      for(let i=0;i<rows.length-9;i++){
        const title=String(rows[i]?.[0]||"");
        if(!title.includes("—")||String(rows[i+1]?.[0]||"")!=="Jour")continue;
        const dateRow=rows[i+2]||[],prev=rows[i+3]||[],acq=rows[i+4]||[],taken=rows[i+5]||[],net=rows[i+6]||[],normal=rows[i+7]||[],supp=rows[i+8]||[],classification=rows[i+9]||[];
        const first=dateRow.slice(1,32).find(v=>typeof v==="number");if(!first)continue;
        const period=isoFromExcel(first).slice(0,7),m=byPeriod[period];if(!m)continue;
        for(let c=1;c<=31;c++){
          const serial=dateRow[c];if(typeof serial!=="number")continue;
          const date=isoFromExcel(serial),day=Number(date.slice(-2));
          const val=(r)=>r[c]==null||r[c]===""?null:Number(r[c]);
          daily.push({id:date,date,period,year:Number(date.slice(0,4)),month:Number(date.slice(5,7)),day,
            uo:period==="2025-06"?(day<=23?"AUBER":"BELLIARD"):m.uo,plannedCode:String(prev[c]||""),rfAcquisition:val(acq),rfTaken:val(taken),rfNet:val(net),
            normalMinutes:val(normal)==null?null:Math.round(val(normal)*1440),supplementaryMinutes:val(supp)==null?null:Math.round(val(supp)*1440),
            supplementaryClass:String(classification[c]||""),source:m.source,origin:"import_xlsx"});
        }
        i+=9;
      }
    });
    const warnings=[];
    for(const m of monthly){const sum=daily.filter(d=>d.period===m.period).reduce((a,d)=>a+(d.rfNet||0),0);if(Math.abs(sum-m.movementRF)>.0005)warnings.push(`${m.period} : somme quotidienne ${sum.toFixed(3)} ≠ mouvement mensuel ${m.movementRF.toFixed(3)}`);}
    return {monthly,daily,warnings,summary:{months:monthly.length,days:daily.length,first:monthly[0].period,last:monthly.at(-1).period}};
  }

  function cell(value,r,c,style=0){
    const ref=colName(c)+(r+1);
    if(value&&typeof value==="object"&&Object.prototype.hasOwnProperty.call(value,"v"))return cell(value.v,r,c,value.s??style);
    if(value==null||value==="")return `<c r="${ref}" s="${style}"/>`;
    if(typeof value==="number"&&Number.isFinite(value))return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    if(typeof value==="boolean")return `<c r="${ref}" t="b" s="${style}"><v>${value?1:0}</v></c>`;
    return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  }
  function sheetXml(rows,widths=[]){
    const maxCols=Math.max(1,...rows.map(r=>r.length));
    const cols=widths.length?`<cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join("")}</cols>`:"";
    const body=rows.map((row,r)=>`<row r="${r+1}">${row.map((v,c)=>cell(v,r,c,r===0?1:0)).join("")}</row>`).join("");
    const dim=`A1:${colName(maxCols-1)}${Math.max(rows.length,1)}`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dim}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${body}</sheetData><autoFilter ref="A1:${colName(maxCols-1)}${Math.max(rows.length,1)}"/></worksheet>`;
  }
  function minutesCell(minutes){return minutes==null?null:{v:Number(minutes)/1440,s:3};}
  function decimalCell(v){return v==null?null:{v:Number(v),s:2};}

  async function exportWorkbook(data){
    if(!global.JSZip)throw new Error("Le composant ZIP local n’est pas disponible.");
    const months=[...(data.months||[])].sort((a,b)=>a.period.localeCompare(b.period));
    const days=[...(data.days||[])].sort((a,b)=>a.date.localeCompare(b.date));
    const services=[...(data.services||[])].sort((a,b)=>(a.date||"").localeCompare(b.date||""));
    const incidents=[...(data.incidents||[])].sort((a,b)=>(a.date||"").localeCompare(b.date||""));
    const documents=[...(data.documents||[])];
    const sheets=[];
    sheets.push({name:"Synthèse RF",widths:[12,13,16,16,17,20,12,16,22,14,12,42],rows:[
      ["Période","UO","Solde RF début mois","Somme RF du mois","Ajustement reconnu","Solde théorique avant CPMA","CPMA","Solde RF bulletin","Cumul RF théorique personnel","Écart cumulé","Contrôle","Source"],
      ...months.map(m=>[m.period,m.uo,decimalCell(m.officialOpening),decimalCell(m.movementRF),decimalCell(m.recognizedAdjustment),decimalCell(m.theoreticalBeforeCPMA),decimalCell(m.cpma),decimalCell(m.officialClosing),decimalCell(m.personalCumulative),decimalCell(m.cumulativeGap),decimalCell(m.control),m.source])
    ]});
    sheets.push({name:"Données quotidiennes",widths:[12,12,13,15,13,12,12,12,16,16,18,42],rows:[
      ["Date","Période","UO","Prévisionnel","RF acquisition","RF prise","RF net","Travail normal","Travail supplémentaire","Classement suppl.","Origine","Source"],
      ...days.map(d=>[d.date,d.period,d.uo,d.plannedCode,decimalCell(d.rfAcquisition),decimalCell(d.rfTaken),decimalCell(d.rfNet),minutesCell(d.normalMinutes),minutesCell(d.supplementaryMinutes),d.supplementaryClass,d.origin,d.source])
    ]});
    sheets.push({name:"Journal services",widths:[12,13,10,12,12,12,10,10,10,10,12,12,12,20,55],rows:[
      ["Date","UO","Ligne","Service","Police","Coquille","Début","Fin","Début 2","Fin 2","Retard","Décalage","Incident/Accident","Lieu","Note"],
      ...services.map(s=>[s.date,s.uo,s.line,s.service,s.police,s.vehicle,s.start,s.end,s.start2,s.end2,s.delay?"Oui":"",s.shift?"Oui":"",[s.incident&&"Incident",s.accident&&"Accident"].filter(Boolean).join(" / "),s.location,s.note])
    ]});
    sheets.push({name:"Incidents",widths:[12,20,10,12,28,55,55,14,22],rows:[
      ["Date","Nature","Ligne","Service","Lieu","Description","Mesures prises","Statut","Référence"],
      ...incidents.map(i=>[i.date,i.type,i.line,i.service,i.location,i.description,i.actions,i.status,i.reference])
    ]});
    sheets.push({name:"Documents",widths:[12,42,16,16,16,25],rows:[
      ["Période","Nom du fichier","Statut","Confiance extraction","Taille","Importé le"],
      ...documents.map(d=>[d.period,d.name,d.status,d.extraction?.confidence??"",d.size,d.importedAt])
    ]});
    sheets.push({name:"Méthodologie",widths:[25,95],rows:[
      ["Point","Convention"],["Période","Du 1er février 2023 au 31 mai 2026 — 40 mois consécutifs."],["Mouvement RF","Somme quotidienne des acquisitions RF moins les prises RF."],["CPMA","Écriture mensuelle figurant sur la ligne REPOS FIXE du bulletin."],["Ajustement connu","−12 RF en février 2024, correspondant au transfert identifié vers le CET."],["Contrôle","Ouverture officielle + mouvement RF + CPMA = clôture officielle."],["Confidentialité","Application locale : les données ne sont pas transmises à un serveur."]
    ]});

    const zip=new JSZip();
    const overrides=sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
    zip.file("[Content_Types].xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
    zip.folder("_rels").file(".rels",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
    const sheetTags=sheets.map((s,i)=>`<sheet name="${esc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("");
    zip.folder("xl").file("workbook.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheetTags}</sheets></workbook>`);
    zip.folder("xl").folder("_rels").file("workbook.xml.rels",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    zip.folder("xl").file("styles.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0.000;[Red]-0.000;0.000"/><numFmt numFmtId="165" formatCode="[h]:mm"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B2F53"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
    const wsFolder=zip.folder("xl").folder("worksheets");sheets.forEach((s,i)=>wsFolder.file(`sheet${i+1}.xml`,sheetXml(s.rows,s.widths)));
    const now=new Date().toISOString();
    zip.folder("docProps").file("core.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Journal Machiniste PRO</dc:title><dc:creator>Journal Machiniste PRO</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
    zip.folder("docProps").file("app.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Journal Machiniste PRO</Application></Properties>`);
    return zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",compression:"DEFLATE"});
  }

  global.JMPXLSX={readWorkbook,parseReconstruction,exportWorkbook};
})(window);
