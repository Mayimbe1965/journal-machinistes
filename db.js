(function(global){
  "use strict";
  const DB_NAME="journal_machiniste_pro";
  const DB_VERSION=1;
  const STORES={
    meta:{keyPath:"key"},services:{keyPath:"id"},months:{keyPath:"period"},days:{keyPath:"date"},
    documents:{keyPath:"id",indexes:[{name:"period",keyPath:"period"},{name:"status",keyPath:"status"}]},
    incidents:{keyPath:"id"},dsp:{keyPath:"id"},settings:{keyPath:"key"},audit:{keyPath:"id",autoIncrement:true}
  };

  class Database{
    constructor(){this.db=null;}
    open(){
      if(this.db) return Promise.resolve(this.db);
      return new Promise((resolve,reject)=>{
        const req=indexedDB.open(DB_NAME,DB_VERSION);
        req.onupgradeneeded=()=>{
          const db=req.result;
          Object.entries(STORES).forEach(([name,cfg])=>{
            let store;
            if(!db.objectStoreNames.contains(name)) store=db.createObjectStore(name,{keyPath:cfg.keyPath,autoIncrement:!!cfg.autoIncrement});
            else store=req.transaction.objectStore(name);
            (cfg.indexes||[]).forEach(idx=>{if(!store.indexNames.contains(idx.name)) store.createIndex(idx.name,idx.keyPath,{unique:false});});
          });
        };
        req.onsuccess=()=>{this.db=req.result;this.db.onversionchange=()=>this.db.close();resolve(this.db);};
        req.onerror=()=>reject(req.error);
      });
    }
    tx(storeNames,mode="readonly"){return this.db.transaction(storeNames,mode);}
    request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
    async get(store,key){await this.open();return this.request(this.tx([store]).objectStore(store).get(key));}
    async getAll(store){await this.open();return this.request(this.tx([store]).objectStore(store).getAll());}
    async put(store,value){await this.open();return this.request(this.tx([store],"readwrite").objectStore(store).put(value));}
    async add(store,value){await this.open();return this.request(this.tx([store],"readwrite").objectStore(store).add(value));}
    async delete(store,key){await this.open();return this.request(this.tx([store],"readwrite").objectStore(store).delete(key));}
    async clear(store){await this.open();return this.request(this.tx([store],"readwrite").objectStore(store).clear());}
    async bulkPut(store,values){
      await this.open();
      return new Promise((resolve,reject)=>{
        const tx=this.tx([store],"readwrite"), os=tx.objectStore(store);
        values.forEach(v=>os.put(v));
        tx.oncomplete=()=>resolve(values.length);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Transaction annulée"));
      });
    }
    async replaceStore(store,values){
      await this.open();
      return new Promise((resolve,reject)=>{
        const tx=this.tx([store],"readwrite"), os=tx.objectStore(store);os.clear();values.forEach(v=>os.put(v));
        tx.oncomplete=()=>resolve(values.length);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Transaction annulée"));
      });
    }
    async count(store){await this.open();return this.request(this.tx([store]).objectStore(store).count());}
    async audit(action,details={}){return this.add("audit",{action,details,at:new Date().toISOString()});}

    async initialize(seed){
      await this.open();
      const seedMeta=await this.get("meta","seedVersion");
      const monthCount=await this.count("months");
      if(!seedMeta || monthCount===0){
        await this.replaceStore("months",seed.monthly||[]);
        await this.replaceStore("days",seed.daily||[]);
        await this.put("dsp",{id:"main",...(seed.dsp||{}),executedDays:245,updatedAt:new Date().toISOString()});
        await this.bulkPut("settings",[
          {key:"rules",value:{worked:seed.methodology?.rfWorkedDay??0.252,sunday:seed.methodology?.rfWorkedSunday??1.252,taken:seed.methodology?.rfTaken??-1,pointZero:seed.methodology?.pointZero??0.190}},
          {key:"app",value:{version:"5.0.0",seedVersion:seed.version,createdAt:new Date().toISOString()}}
        ]);
        await this.put("meta",{key:"seedVersion",value:seed.version,importedAt:new Date().toISOString(),source:seed.sourceWorkbook});
        await this.audit("seed_imported",{version:seed.version,months:(seed.monthly||[]).length,days:(seed.daily||[]).length});
      }
      await this.migrateLegacyJournal();
    }

    async migrateLegacyJournal(){
      const done=await this.get("meta","legacyMigrated");if(done) return;
      let raw=localStorage.getItem("journal_machiniste_pro_v32")||localStorage.getItem("journal_machiniste_pro_v31");
      let migrated=0;
      if(raw){
        try{
          const items=JSON.parse(raw);
          if(Array.isArray(items)){
            const records=items.map((x,i)=>({
              id:x.key||`legacy-${i}-${Date.now()}`,date:x.dateFin||"",uo:"BELLIARD",line:x.ligne||"",service:x.service||"",police:x.police||"",vehicle:x.coquille||"",
              start:x.debut||"",end:x.fin||"",split:!!x.service2x,start2:x.debut2||"",end2:x.fin2||"",delay:!!x.retard,shift:!!x.decalage,
              incident:!!x.incident,accident:!!x.accident,location:"",note:x.note||"",legacy:x,createdAt:x.ts||new Date().toISOString(),updatedAt:new Date().toISOString()
            }));
            await this.bulkPut("services",records);migrated=records.length;
          }
        }catch(e){console.warn("Migration ancien journal impossible",e);}
      }
      await this.put("meta",{key:"legacyMigrated",value:true,count:migrated,at:new Date().toISOString()});
      if(migrated) await this.audit("legacy_services_migrated",{count:migrated});
    }

    async exportData(includeDocuments=false){
      const stores=["meta","services","months","days","documents","incidents","dsp","settings","audit"];
      const out={format:"journal-machiniste-pro-backup",version:"5.0.0",exportedAt:new Date().toISOString(),stores:{}};
      for(const s of stores){
        let rows=await this.getAll(s);
        if(s==="documents"){
          rows=await Promise.all(rows.map(async d=>{
            const copy={...d};
            if(copy.file instanceof Blob){
              if(includeDocuments){copy.fileBase64=await blobToDataUrl(copy.file);copy.fileType=copy.file.type;}
              delete copy.file;
            }
            return copy;
          }));
        }
        out.stores[s]=rows;
      }
      return out;
    }

    async restoreData(payload){
      if(!payload||payload.format!=="journal-machiniste-pro-backup"||!payload.stores) throw new Error("Sauvegarde non reconnue.");
      const allowed=Object.keys(STORES);
      for(const s of allowed){
        if(!Array.isArray(payload.stores[s])) continue;
        let rows=payload.stores[s];
        if(s==="documents") rows=await Promise.all(rows.map(async d=>{
          const copy={...d};
          if(copy.fileBase64){copy.file=dataUrlToBlob(copy.fileBase64);delete copy.fileBase64;delete copy.fileType;}
          return copy;
        }));
        await this.replaceStore(s,rows);
      }
      await this.audit("backup_restored",{exportedAt:payload.exportedAt||null});
    }

    async clearAll(){for(const s of Object.keys(STORES)) await this.clear(s);}
  }

  function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
  function dataUrlToBlob(dataUrl){const [meta,data]=dataUrl.split(",");const mime=(meta.match(/data:([^;]+)/)||[])[1]||"application/octet-stream";const bin=atob(data);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);return new Blob([arr],{type:mime});}

  global.JMP_DB=new Database();
})(window);
