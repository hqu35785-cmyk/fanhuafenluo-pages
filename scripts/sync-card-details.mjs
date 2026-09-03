import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const PLACEHOLDER_TEXTS = [
  '开场资料整理中。',
  '性格资料整理中。',
  '设定与剧情资料整理中。',
  '资料整理中。'
];

const GROUPS = [
  {id:'fanhuafenluo',arrays:['latestFanhuaWorks','fanhuaWorks'],output:'src/data/details-fanhua.js'},
  {id:'public',arrays:['publicWorks','legacySharkWorks','legacyWaWorks'],output:'src/data/details-public.js'}
];

const STALE_DETAIL_OUTPUTS = [
  'src/data/details-shark.js',
  'src/data/details-wa.js'
];

function fail(message){
  throw new Error(`${message}\n用法：node scripts/sync-card-details.mjs --intro-brief [--all] | --write | --check [--root <source-repo>]`);
}

function parseArgs(argv){
  const modes=['intro-brief','write','check'].filter(mode=>argv.includes(`--${mode}`));
  if(modes.length!==1) fail('必须且只能指定 --intro-brief、--write 或 --check');
  const rootIndex=argv.indexOf('--root');
  const root=rootIndex>=0?argv[rootIndex+1]:null;
  if(rootIndex>=0&&!root) fail('--root 后面缺少目录');
  return {mode:modes[0],all:argv.includes('--all'),root};
}

function readJsonBlock(source,start,openChar,closeChar){
  const open=source.indexOf(openChar,start);
  if(open<0) throw new Error('找不到 JSON 数据块起点');
  let depth=0;
  let inString=false;
  let escaped=false;
  for(let index=open;index<source.length;index+=1){
    const char=source[index];
    if(inString){
      if(escaped) escaped=false;
      else if(char==='\\') escaped=true;
      else if(char==='"') inString=false;
      continue;
    }
    if(char==='"') inString=true;
    else if(char===openChar) depth+=1;
    else if(char===closeChar){
      depth-=1;
      if(depth===0) return {value:JSON.parse(source.slice(open,index+1)),end:index+1};
    }
  }
  throw new Error('JSON 数据块不完整');
}

function extractConstArray(source,name){
  const marker=`const ${name} =`;
  const start=source.indexOf(marker);
  if(start<0) throw new Error(`works.js 中未找到 ${name}`);
  return readJsonBlock(source,start+marker.length,'[',']').value;
}

function parseDetailsFile(source,authorId){
  const marker=`window.__LAZY_DETAILS__.${authorId}=`;
  const start=source.indexOf(marker);
  if(start<0) throw new Error(`详情文件中未找到 ${authorId}`);
  return readJsonBlock(source,start+marker.length,'{','}').value;
}

function nonEmptyString(value){
  return typeof value==='string'&&value.trim()!=='';
}

function safeRelativePath(value){
  let decoded;
  try{
    decoded=decodeURIComponent(String(value||'').replace(/^\.\//,'').replace(/^\//,''));
  }catch(error){
    throw new Error(`图片路径 URL 编码无效：${value}；${error.message}`);
  }
  if(!decoded||decoded.includes('\0')) throw new Error(`非法图片路径：${value}`);
  return decoded;
}

function assertInsideRoot(root,relativePath){
  const absolute=path.resolve(root,relativePath);
  const prefix=`${path.resolve(root)}${path.sep}`;
  if(!absolute.startsWith(prefix)) throw new Error(`图片路径越过源仓库根目录：${relativePath}`);
  return absolute;
}

function decodeCharaPng(buffer,relativePath){
  const signature=Buffer.from([137,80,78,71,13,10,26,10]);
  if(!buffer.subarray(0,8).equals(signature)) throw new Error(`不是有效 PNG：${relativePath}`);
  let offset=8;
  while(offset<buffer.length){
    if(offset+12>buffer.length) throw new Error(`PNG chunk 头不完整：${relativePath}`);
    const length=buffer.readUInt32BE(offset);
    const chunkEnd=offset+12+length;
    if(chunkEnd>buffer.length) throw new Error(`PNG chunk 越过文件末尾：${relativePath}`);
    const type=buffer.toString('ascii',offset+4,offset+8);
    const data=buffer.subarray(offset+8,offset+8+length);
    if(type==='tEXt'){
      const separator=data.indexOf(0);
      if(separator>=0&&data.subarray(0,separator).toString('latin1')==='chara'){
        const encoded=data.subarray(separator+1).toString('latin1');
        try{
          const parsed=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
          if(!parsed||typeof parsed.data!=='object'||!parsed.data) throw new Error('缺少 data 对象');
          return parsed.data;
        }catch(error){
          throw new Error(`chara 元数据无法解析：${relativePath}；${error.message}`);
        }
      }
    }
    offset=chunkEnd;
    if(type==='IEND') break;
  }
  throw new Error(`PNG 中没有 chara tEXt 元数据：${relativePath}`);
}

function stableValue(value){
  if(Array.isArray(value)) return value.map(stableValue);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])]));
  }
  return value;
}

function canonicalSourceData(data){
  return stableValue({
    description:data.description??'',
    first_mes:data.first_mes??'',
    personality:data.personality??'',
    scenario:data.scenario??'',
    character_book:data.character_book??null,
    system_prompt:data.system_prompt??'',
    post_history_instructions:data.post_history_instructions??''
  });
}

function sourceHash(data){
  return crypto.createHash('sha256').update(JSON.stringify(canonicalSourceData(data)),'utf8').digest('hex');
}

function formatPreset(data){
  const sections=[];
  if(nonEmptyString(data.system_prompt)) sections.push(`【系统提示词】\n${data.system_prompt}`);
  if(nonEmptyString(data.post_history_instructions)) sections.push(`【历史后指令】\n${data.post_history_instructions}`);
  return sections.length?sections.join('\n\n'):null;
}

function formatWorldbook(book,relativePath){
  if(!book||typeof book!=='object') return null;
  const entries=Array.isArray(book.entries)?book.entries:(book.entries&&typeof book.entries==='object'?Object.values(book.entries):[]);
  if(!entries.some(entry=>nonEmptyString(entry?.content))) return null;
  const blocks=[];
  if(nonEmptyString(book.name)) blocks.push(`【世界书】\n${book.name}`);
  entries.forEach((entry,index)=>{
    if(!entry||typeof entry!=='object') throw new Error(`世界书条目不是对象：${relativePath} · ${index+1}`);
    const title=nonEmptyString(entry.name)?entry.name:(nonEmptyString(entry.comment)?entry.comment:`条目 ${String(index+1).padStart(2,'0')}`);
    const lines=[`【${title}】`];
    if(nonEmptyString(entry.comment)&&entry.comment!==title) lines.push(`备注：${entry.comment}`);
    if(Array.isArray(entry.keys)&&entry.keys.length) lines.push(`关键词：${entry.keys.join('、')}`);
    if(typeof entry.enabled==='boolean') lines.push(`状态：${entry.enabled?'启用':'停用'}`);
    if(nonEmptyString(entry.position)) lines.push(`位置：${entry.position}`);
    if(nonEmptyString(entry.content)) lines.push(entry.content);
    blocks.push(lines.join('\n'));
  });
  return blocks.join('\n\n');
}

function directDetail(data,relativePath){
  if(!nonEmptyString(data.first_mes)) throw new Error(`first_mes 为空：${relativePath}`);
  const detail={opening:data.first_mes};
  if(nonEmptyString(data.personality)) detail.personality=data.personality;
  if(nonEmptyString(data.scenario)) detail.setting=data.scenario;
  const worldbook=formatWorldbook(data.character_book,relativePath);
  if(worldbook) detail.worldbook=worldbook;
  const preset=formatPreset(data);
  if(preset) detail.preset=preset;
  return detail;
}

async function readCard(root,work){
  const relativePath=safeRelativePath(work.image);
  const absolutePath=assertInsideRoot(root,relativePath);
  let buffer;
  try{buffer=await fs.readFile(absolutePath);}catch(error){throw new Error(`PNG 读取失败：${relativePath}；${error.message}`);}
  let data;
  try{data=decodeCharaPng(buffer,relativePath);}catch(error){throw new Error(`${work.name||'未命名角色'} · ${relativePath} · ${error.message}`);}
  if(!nonEmptyString(data.description)) throw new Error(`${work.name} · description 为空：${relativePath}`);
  return {work,relativePath,data,sourceHash:sourceHash(data),direct:directDetail(data,relativePath)};
}

async function collectExpected(root){
  const worksPath=path.join(root,'src','data','works.js');
  const worksSource=await fs.readFile(worksPath,'utf8');
  const records=[];
  const groups=[];
  for(const group of GROUPS){
    const works=group.arrays.flatMap(name=>extractConstArray(worksSource,name));
    const seen=new Set();
    const groupRecords=[];
    for(const work of works){
      const key=String(work._detailKey||work.image||'');
      if(!key) throw new Error(`${group.id} 有角色卡缺少 _detailKey/image：${work.name||'未命名'}`);
      if(seen.has(key)) throw new Error(`${group.id} 存在重复详情 key：${key}`);
      seen.add(key);
      const record=await readCard(root,work);
      record.authorId=group.id;
      record.detailKey=key;
      groupRecords.push(record);
      records.push(record);
    }
    groups.push({...group,records:groupRecords,count:groupRecords.length});
  }
  if(records.length!==102) throw new Error(`角色卡总数错误：应为 102，实际为 ${records.length}`);
  return {groups,records};
}

async function loadIntros(root){
  const file=path.join(root,'src','data','card-intros.json');
  try{return JSON.parse(await fs.readFile(file,'utf8'));}
  catch(error){
    if(error.code==='ENOENT') throw new Error(`缺少 ${path.relative(root,file)}，请先写入 AI 定稿简介`);
    throw new Error(`card-intros.json 不是有效 JSON：${error.message}`);
  }
}

function visibleLength(value){
  return Array.from(String(value||'').replace(/\s/g,'')).length;
}

function validateIntro(record,entry){
  if(!entry||typeof entry!=='object') throw new Error(`${record.detailKey} 缺少简介对象`);
  if(!nonEmptyString(entry.intro)) throw new Error(`${record.work.name} · 简介为空`);
  const length=visibleLength(entry.intro);
  if(length<120||length>180) throw new Error(`${record.work.name} · 简介长度 ${length}，必须为 120–180`);
  if(entry.intro===record.data.description) throw new Error(`${record.work.name} · 简介仍是 description 原文`);
  if(entry.sourceHash!==record.sourceHash) throw new Error(`${record.work.name} · sourceHash 过期，应为 ${record.sourceHash}`);
  for(const placeholder of PLACEHOLDER_TEXTS){
    if(entry.intro.includes(placeholder)) throw new Error(`${record.work.name} · 简介包含占位文案：${placeholder}`);
  }
}

function buildDetails(records,intros){
  const seenIntro=new Map();
  const result={};
  for(const record of records){
    const copy=intros[record.detailKey];
    validateIntro(record,copy);
    const normalized=copy.intro.trim();
    if(seenIntro.has(normalized)) throw new Error(`简介重复：${record.work.name} 与 ${seenIntro.get(normalized)}`);
    seenIntro.set(normalized,record.work.name);
    result[record.detailKey]={intro:copy.intro,...record.direct};
  }
  return result;
}

function buildFile(authorId,details){
  return ['window.__LAZY_DETAILS__=window.__LAZY_DETAILS__||{};',`window.__LAZY_DETAILS__.${authorId}=${JSON.stringify(details)};`,''].join('\n');
}

async function verifyFiles(root,groups,intros){
  let total=0;
  const expectedByKey=new Map();
  for(const group of groups){
    for(const record of group.records) expectedByKey.set(record.detailKey,record);
    const filePath=path.join(root,group.output);
    const text=await fs.readFile(filePath,'utf8');
    for(const placeholder of PLACEHOLDER_TEXTS){
      if(text.includes(placeholder)) throw new Error(`${group.output} 仍包含占位文案：${placeholder}`);
    }
    const actual=parseDetailsFile(text,group.id);
    const expected=buildDetails(group.records,intros);
    if(JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error(`${group.output} 与 PNG/AI 简介重新生成结果不一致`);
    const actualKeys=Object.keys(actual);
    if(actualKeys.length!==group.count) throw new Error(`${group.output} 数量错误：应为 ${group.count}，实际为 ${actualKeys.length}`);
    total+=actualKeys.length;
  }
  const introKeys=Object.keys(intros);
  if(introKeys.length!==expectedByKey.size) throw new Error(`简介 key 数量错误：应为 ${expectedByKey.size}，实际为 ${introKeys.length}`);
  for(const key of introKeys){
    if(!expectedByKey.has(key)) throw new Error(`存在失联简介 key：${key}`);
  }
  if(total!==102) throw new Error(`详情总数错误：应为 102，实际为 ${total}`);
}

async function verifyStaleOutputsAbsent(root){
  for(const relativePath of STALE_DETAIL_OUTPUTS){
    try{
      await fs.access(path.join(root,relativePath));
      throw new Error(`旧分区详情文件仍然存在：${relativePath}`);
    }catch(error){
      if(error.code!=='ENOENT') throw error;
    }
  }
}

function summary({groups,records,intros}){
  const details=records.map(record=>({record,copy:intros?.[record.detailKey]}));
  const count=predicate=>details.filter(predicate).length;
  const presetBoth=count(({record})=>record.direct.preset?.includes('【系统提示词】')&&record.direct.preset?.includes('【历史后指令】'));
  const presetSystemOnly=count(({record})=>record.direct.preset?.includes('【系统提示词】')&&!record.direct.preset?.includes('【历史后指令】'));
  return {
    authors:Object.fromEntries(groups.map(group=>[group.id,group.count])),
    total:records.length,
    intro:count(({copy})=>nonEmptyString(copy?.intro)),
    opening:count(({record})=>nonEmptyString(record.direct.opening)),
    setting:count(({record})=>nonEmptyString(record.direct.personality)||nonEmptyString(record.direct.setting)),
    worldbook:count(({record})=>nonEmptyString(record.direct.worldbook)),
    preset:count(({record})=>nonEmptyString(record.direct.preset)),
    presetBoth,
    presetSystemOnly
  };
}

async function main(){
  const {mode,all,root:rootArg}=parseArgs(process.argv.slice(2));
  const scriptRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const root=path.resolve(rootArg||scriptRoot);
  const {groups,records}=await collectExpected(root);

  if(mode==='intro-brief'){
    let intros={};
    try{intros=await loadIntros(root);}catch{}
    const brief=records.filter(record=>all||!intros[record.detailKey]||intros[record.detailKey].sourceHash!==record.sourceHash).map(record=>({
      authorId:record.authorId,
      key:record.detailKey,
      name:record.work.name,
      creator:record.work.creator,
      role:record.work.role,
      tags:record.work.tags,
      cardLabel:record.work.cardLabel,
      sourceHash:record.sourceHash,
      fields:canonicalSourceData(record.data)
    }));
    process.stdout.write(JSON.stringify(brief,null,2));
    return;
  }

  const intros=await loadIntros(root);
  if(mode==='write'){
    const expectedDetails=groups.map(group=>({group,details:buildDetails(group.records,intros)}));
    for(const {group,details} of expectedDetails) await fs.writeFile(path.join(root,group.output),buildFile(group.id,details),'utf8');
    for(const relativePath of STALE_DETAIL_OUTPUTS) await fs.rm(path.join(root,relativePath),{force:true});
    console.log(JSON.stringify(summary({groups,records,intros}),null,2));
    console.log('write ok');
    return;
  }

  await verifyStaleOutputsAbsent(root);
  await verifyFiles(root,groups,intros);
  console.log(JSON.stringify(summary({groups,records,intros}),null,2));
  console.log('check ok');
}

main().catch(error=>{
  console.error(error.message);
  process.exitCode=1;
});



