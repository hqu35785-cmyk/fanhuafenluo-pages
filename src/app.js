const CARD_VISIBILITY_MODE="open";
document.documentElement.dataset.cardVisibility=CARD_VISIBILITY_MODE;

const gallery=document.getElementById("gallery");
const toast=document.getElementById("toast");
const archiveModal=document.getElementById("archiveModal");
const archiveToast=document.getElementById("archiveToast");
let toastTimer;

function tip(text){
  const target=archiveModal.open ? archiveToast : toast;
  toast.classList.remove("show");
  archiveToast.classList.remove("show");
  target.textContent=text;
  target.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>target.classList.remove("show"),1700);
}

function safe(text){
  return String(text).replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

/** Split "李慕婉 【骚图版】" → main name + smaller annotation. */
function splitCardDisplayName(name){
  const raw=String(name||"");
  const match=raw.match(/^(.*?)(\s*[【\[][^】\]]+[】\]])\s*$/u);
  if(!match) return {main:raw,note:""};
  return {main:match[1].replace(/\s+$/u,""),note:match[2].replace(/^\s+/u,"")};
}

function cardFaceNameHTML(name){
  const {main,note}=splitCardDisplayName(name);
  if(!note) return safe(main);
  return `${safe(main)}<span class="card-name-note">${safe(note)}</span>`;
}

function cardHTML(work,index){
  const imageSensitive=Boolean(work.sensitive);
  const imageLocked=imageSensitive && CARD_VISIBILITY_MODE!=="open";
  const settingSensitive=Boolean(work.sensitiveSetting);
  const preview=work.preview || null;
  // LCP: first unlocked face loads eagerly; rest stay lazy until near viewport.
  const eagerFace=!imageLocked && index<2;
  const previewSource=!imageLocked && preview ? ` src="${preview}"` : "";
  const imgLoading=imageLocked ? "" : (eagerFace ? ' loading="eager"' : ' loading="lazy"');
  const imgPriority=imageLocked ? "" : (eagerFace ? ' fetchpriority="high"' : ' fetchpriority="low"');
  const cardLabel=work.cardLabel || work.tags?.[0] || "角色卡";
  const hint=index===0
    ? `<p class="first-hint"><span class="hint-copy">点击卡片查看设定</span></p>`
    : "";
  const tagList=(work.tags || []).slice(0,1);
  const badgeTag=tagList[0] || cardLabel;
  const cornerBadges=`<span class="card-code"><span class="card-code-text">${safe(badgeTag)}</span></span>`;
  // Shell-only back face: long copy + toolbar materialize on first flip to cut 64-card DOM cost.
  return `
  <div class="card-item${index===0 ? " has-hint" : ""}">
    <article class="card${imageSensitive ? " is-sensitive" : ""}${settingSensitive ? " is-setting-sensitive" : ""}" data-index="${index}">
      <div class="card-inner">
        <button class="face front card-flip${imageLocked ? " is-locked" : ""}" type="button" aria-label="翻转查看${safe(work.name)}的简介" aria-expanded="false" aria-controls="card-back-${index}" aria-hidden="false">
          <img${imgLoading}${imgPriority} decoding="async" width="360" height="500"${previewSource} alt="${imageLocked ? "" : safe(work.name)}"${imageLocked ? ' aria-hidden="true" hidden' : ""}>
          ${imageLocked ? '<span class="privacy-veil" aria-hidden="true"></span>' : ""}
          ${imageLocked ? '<span class="preview-status sr-only" role="status" aria-live="polite"></span>' : ""}
          <span class="card-badges" aria-label="角色标签">${cornerBadges}</span>
          <span class="card-open" aria-hidden="true">↻</span>
          <span class="card-name">
            <b>${cardFaceNameHTML(work.name)}</b>
            <span>${safe(work.alias || "")}</span>
            <span class="card-meta"><span>${safe(work.collectionLabel || "ORIGINAL CHARACTER")}</span><span>点按翻转</span></span>
          </span>
        </button>
        <section class="face back" id="card-back-${index}" aria-label="${safe(work.name)}角色简介" aria-hidden="true" inert data-back-pending="1"></section>
      </div>
      <button class="privacy-unlock" type="button" data-index="${index}" data-mode="${imageLocked ? "unlock" : "save"}" aria-label="${imageLocked ? `显示${safe(work.name)}的敏感图片，仅本次页面有效` : `保存${safe(work.name)}角色卡 PNG`}">${imageLocked ? "解锁卡面" : "保存角色卡 PNG"}</button>
    </article>
    ${hint}
  </div>`;
}

function cardBackInnerHTML(work,index){
  const imageSensitive=Boolean(work.sensitive);
  const settingSensitive=Boolean(work.sensitiveSetting);
  const cardLabel=work.cardLabel || work.tags?.[0] || "角色卡";
  const privacyLabel=imageSensitive
    ? (work.sensitiveLabel || "敏感卡面")
    : (work.sensitiveSettingLabel || "敏感设定");
  const tagList=(work.tags || []).slice(0,1);
  const tags=tagList.map(tag=>`<span class="back-tag">${safe(tag)}</span>`).join("");
  const settingLocked=isSettingLocked(index);
  return `
          <div class="back-scroll">
            <div class="back-toolbar">
              <span class="back-file">${safe(cardLabel)}</span>
              ${imageSensitive || settingSensitive ? `<span class="back-privacy">${safe(privacyLabel)}</span>` : ""}
            </div>
            <h2>${safe(work.name)}</h2>
            <p class="alias">${safe(work.alias || "ORIGINAL")}</p>
            <p class="back-role" data-field="role">${safe(work.role || "原创角色")}</p>
            <div class="back-tags">${tags}</div>
            <div class="setting">
              <div><b>性格简介</b><p data-field="personality">${safe(work.personality || "暂无性格介绍。")}</p></div>
              <div class="back-setting-content" id="card-setting-${index}" tabindex="-1"${settingLocked ? " hidden" : ""}><b>设定 · 剧情</b><p data-field="setting">${settingLocked ? "" : safe(work.setting || "暂无背景设定。")}</p></div>
            </div>
            <div class="back-setting-privacy"${settingLocked ? "" : " hidden"} aria-hidden="${settingLocked ? "false" : "true"}"${settingLocked ? "" : " inert"}>
              <span class="back-setting-mark" aria-hidden="true"></span>
              <div class="back-setting-copy"><b>卡面解锁后显示设定</b><p>解锁卡面后即可查看完整角色设定。</p></div>
            </div>
          </div>
          <div class="back-actions">
            <button class="back-return" type="button" aria-label="返回${safe(work.name)}卡面">←</button>
            <button class="back-expand" type="button" aria-haspopup="dialog" aria-controls="archiveModal"><span>展开完整档案</span><span aria-hidden="true">↗</span></button>
          </div>`;
}

const cardNodeCache=new Map();
let cardPartsCache=new Map();

function clearCardCaches(){
  cardNodeCache.clear();
  cardPartsCache.clear();
}

function getCardNode(index){
  const cached=cardNodeCache.get(index);
  if(cached && cached.isConnected) return cached;
  const card=gallery.querySelector(`.card[data-index="${index}"]`);
  if(card) cardNodeCache.set(index,card);
  return card;
}

function indexCardNodes(){
  clearCardCaches();
  gallery.querySelectorAll(".card[data-index]").forEach(card=>{
    const index=Number(card.dataset.index);
    if(Number.isInteger(index)) cardNodeCache.set(index,card);
  });
}

function workDetailsReady(work){
  return Boolean(work && (work._detailsReady || (work.personality!=null && work.setting!=null && work.opening!=null)));
}

async function ensureWorkDetailsForActive(){
  if(typeof ensureWorkDetails!=="function") return;
  await ensureWorkDetails(activeAuthor);
  works=activeAuthor.works || works;
}

function ensureCardBackContent(index){
  const work=works[index];
  const card=getCardNode(index);
  if(!work || !card) return;
  const back=card.querySelector(".back");
  if(!back || back.dataset.backPending!=="1") return;
  // If details still lazy, inject shell copy now and refresh once details arrive.
  if(!workDetailsReady(work)){
    ensureWorkDetailsForActive().then(()=>{
      if(activeAuthor.works) works=activeAuthor.works;
      const w=works[index];
      const c=getCardNode(index);
      const b=c?.querySelector(".back");
      if(!w || !b) return;
      if(b.dataset.backPending==="1"){
        b.innerHTML=cardBackInnerHTML(w,index);
        delete b.dataset.backPending;
      }else{
        // Already opened with placeholders — rewrite text fields.
        const role=b.querySelector('[data-field="role"]');
        const personality=b.querySelector('[data-field="personality"]');
        const setting=b.querySelector('[data-field="setting"]');
        if(role) role.textContent=w.role || "原创角色";
        if(personality) personality.textContent=w.personality || "暂无性格介绍。";
        if(setting && !isSettingLocked(index)) setting.textContent=w.setting || "暂无背景设定。";
      }
      void b.offsetWidth;
    }).catch(()=>{});
  }
  back.innerHTML=cardBackInnerHTML(work,index);
  delete back.dataset.backPending;
  cardPartsCache.delete(index);
  // Force layout so newly injected expand/return controls are hit-testable (Firefox).
  void back.offsetWidth;
}

const layoutRoot=document.documentElement;
const pageHeader=document.querySelector("header");
const pageMain=document.querySelector("main");
const pageFooter=document.querySelector("footer");
const authorSwitch=document.getElementById("authorSwitch");
const authorAvatar=document.getElementById("authorAvatar");
const authorNameEl=document.getElementById("authorName");
const authorSwitchHint=document.getElementById("authorSwitchHint");
const footerAuthor=document.getElementById("footerAuthor");
const workCountEl=document.getElementById("workCount");
const workTotalEl=document.getElementById("workTotal");
let previewObserver=null;
const phonePortraitQuery=window.matchMedia("(max-width:620px) and (orientation:portrait)");
let layoutFrame=0;

function authorEmptyHTML(author){
  return `<div class="author-empty" role="status">
    <img src="${safe(author.avatar)}" alt="" decoding="async" width="72" height="72">
    <b>${safe(author.name)}</b>
    <p>该分区内容正在整理中</p>
    <small>点击左上角头像可切换不同分区</small>
  </div>`;
}

function closeTransientUI(){
  try{
    if(typeof closeUnlockChoice==="function") closeUnlockChoice();
  }catch(_){}
  try{
    if(typeof closeSaveSheet==="function") closeSaveSheet();
  }catch(_){}
  if(archiveModal?.open) archiveModal.close();
  toast?.classList.remove("show");
  archiveToast?.classList.remove("show");
  document.body.classList.remove("modal-open");
}

function syncAuthorChrome(){
  if(authorAvatar){
    authorAvatar.src=activeAuthor.avatar;
    authorAvatar.alt=`${activeAuthor.name}的分区头像`;
  }
  if(authorNameEl) authorNameEl.textContent=activeAuthor.name;
  if(authorSwitchHint) authorSwitchHint.textContent=CARD_VISIBILITY_MODE==="open"
    ? "公开浏览 · 点头像切换不同分区"
    : activeAuthor.status;
  if(authorSwitch){
    authorSwitch.setAttribute("aria-label",`切换分区，当前分区为${activeAuthor.name}`);
  }
  if(footerAuthor) footerAuthor.textContent=activeAuthor.name;
  document.title=`${activeAuthor.name}｜角色档案`;
  if(workCountEl) workCountEl.textContent=String(works.length).padStart(2,"0");
  if(workTotalEl) workTotalEl.textContent="/ "+works.length;
}

function useAuthorRuntimeRefs(){
  const rt=getActiveRuntime();
  unlockedWorks=rt.unlockedWorks;
  previewLoadStates=rt.previewLoadStates;
  previewLoadQueue=rt.previewLoadQueue;
  queuedPreviewIndexes=rt.queuedPreviewIndexes;
}

/** Per-author mounted gallery DOM — switching reuses nodes instead of re-parsing HTML. */
const authorDomCache=new Map();
let mountedAuthorId=null;

function stashMountedAuthorDom(){
  if(!mountedAuthorId) return;
  const children=[];
  while(gallery.firstChild) children.push(gallery.removeChild(gallery.firstChild));
  authorDomCache.set(mountedAuthorId,{
    children,
    cardNodes:new Map(cardNodeCache),
    cardParts:new Map(cardPartsCache),
    scrollTop:gallery.scrollTop||0,
    empty:gallery.classList.contains("is-empty")
  });
  clearCardCaches();
  mountedAuthorId=null;
}

function restoreAuthorDom(authorId){
  const cached=authorDomCache.get(authorId);
  if(!cached) return false;
  gallery.textContent="";
  cached.children.forEach(node=>gallery.appendChild(node));
  cardNodeCache.clear();
  cardPartsCache.clear();
  cached.cardNodes.forEach((node,index)=>cardNodeCache.set(index,node));
  cached.cardParts.forEach((parts,index)=>cardPartsCache.set(index,parts));
  gallery.classList.toggle("is-empty",Boolean(cached.empty));
  try{gallery.scrollTop=cached.scrollTop||0;}catch(_){}
  mountedAuthorId=authorId;
  return true;
}

function buildAuthorGalleryDom(author){
  const list=author.works || [];
  if(!list.length){
    gallery.classList.add("is-empty");
    gallery.innerHTML=authorEmptyHTML(author);
    clearCardCaches();
  }else{
    gallery.classList.remove("is-empty");
    gallery.innerHTML=list.map(cardHTML).join("");
    indexCardNodes();
  }
  mountedAuthorId=author.id;
}

function bumpDecodeGeneration(authorId){
  const rt=getAuthorRuntime(authorId);
  rt.decodeGeneration=(rt.decodeGeneration||0)+1;
  rt.previewLoadQueue.length=0;
  rt.queuedPreviewIndexes.clear();
  rt.activePreviewLoads=0;
}

function renderActiveAuthor({announce=false,scrollToStart=false}={}){
  const version=++authorRenderVersion;
  const authorId=activeAuthor.id;
  works=activeAuthor.works || [];
  useAuthorRuntimeRefs();

  closeTransientUI();
  activeWork=null;
  activeIndex=null;
  modalOpener=null;

  gallery.classList.add("is-author-switching");
  const finish=()=>{
    if(version!==authorRenderVersion || authorId!==activeAuthor.id) return;
    gallery.classList.remove("is-author-switching");
  };

  const previousId=mountedAuthorId;
  if(previousId && previousId!==authorId){
    bumpDecodeGeneration(previousId);
    stashMountedAuthorDom();
  }

  const restored=previousId===authorId ? true : restoreAuthorDom(authorId);
  if(!restored){
    buildAuthorGalleryDom(activeAuthor);
  }

  works=activeAuthor.works || [];
  useAuthorRuntimeRefs();

  syncAuthorChrome();
  if(typeof syncUnlockAll==="function") syncUnlockAll();
  if(typeof bindCardInteractions==="function") bindCardInteractions();
  if(typeof observeCardPreviews==="function") observeCardPreviews();
  if(typeof scheduleGalleryFit==="function") scheduleGalleryFit();
  requestAnimationFrame(()=>{
    if(version!==authorRenderVersion || authorId!==activeAuthor.id) return;
    if(typeof fitCardFaceTitles==="function") fitCardFaceTitles({visibleOnly:true});
    if(typeof observeTitleFits==="function") observeTitleFits();
  });

  if(scrollToStart){
    try{
      gallery.scrollTo({left:0,top:0,behavior:"auto"});
    }catch(_){
      gallery.scrollLeft=0;
      gallery.scrollTop=0;
    }
    const catalog=document.querySelector(".catalog")||gallery;
    const top=catalog.getBoundingClientRect().top+window.scrollY-12;
    if(window.scrollY>top+80){
      window.scrollTo({top:Math.max(0,top),behavior:"auto"});
    }
  }

  requestAnimationFrame(()=>{
    requestAnimationFrame(finish);
  });
  setTimeout(finish,180);

  if(announce) tip(`已切换至「${activeAuthor.name}」分区`);
}

let authorSwitchBusy=false;
async function switchToNextAuthor(){
  if(authorSwitchBusy) return;
  authorSwitchBusy=true;
  try{
    const nextIndex=(activeAuthorIndex+1)%authors.length;
    const next=authors[nextIndex];
    // Ensure catalog for next author before swapping DOM (lazy-loaded partitions).
    if(typeof ensureAuthorCatalog==="function"){
      try{
        await ensureAuthorCatalog(next);
      }catch(error){
        tip(`「${next.name}」分区加载失败，请稍后重试`);
        return;
      }
    }
    activeAuthorIndex=nextIndex;
    activeAuthor=next;
    works=activeAuthor.works || [];
    renderActiveAuthor({announce:true,scrollToStart:true});
    // Prefetch details in background after switch.
    if(typeof ensureWorkDetails==="function"){
      ensureWorkDetails(activeAuthor).catch(()=>{});
    }
  }finally{
    authorSwitchBusy=false;
  }
}

let unlockedWorks=getActiveRuntime().unlockedWorks;
let previewLoadStates=getActiveRuntime().previewLoadStates;
let previewLoadQueue=getActiveRuntime().previewLoadQueue;
let queuedPreviewIndexes=getActiveRuntime().queuedPreviewIndexes;

function fitTextToWidth(el,{minPx=9}={}){
  if(!el) return;
  el.style.fontSize="";
  el.style.letterSpacing="";
  let size=parseFloat(getComputedStyle(el).fontSize);
  if(!Number.isFinite(size) || size<=0) return;
  let guard=36;
  while(el.scrollWidth>el.clientWidth+0.5 && size>minPx && guard--){
    size=Math.max(minPx,+(size-0.4).toFixed(2));
    el.style.fontSize=`${size}px`;
  }
  if(el.scrollWidth>el.clientWidth+0.5){
    el.style.letterSpacing="-0.04em";
  }
  // Final pass after tighter tracking.
  guard=12;
  while(el.scrollWidth>el.clientWidth+0.5 && size>minPx && guard--){
    size=Math.max(minPx,+(size-0.3).toFixed(2));
    el.style.fontSize=`${size}px`;
  }
}

function fitCardFaceTitleEl(el){
  if(!el || el.dataset.titleFit==="1") return;
  const note=el.querySelector(".card-name-note");
  if(note){
    note.style.fontSize="";
    let noteSize=parseFloat(getComputedStyle(note).fontSize);
    let guard=20;
    while(el.scrollWidth>el.clientWidth+0.5 && noteSize>7 && guard--){
      noteSize=Math.max(7,+(noteSize-0.4).toFixed(2));
      note.style.fontSize=`${noteSize}px`;
    }
  }
  if(el.scrollWidth>el.clientWidth+0.5) fitTextToWidth(el,{minPx:11});
  el.dataset.titleFit="1";
}

function fitCardFaceTitles({visibleOnly=true}={}){
  // Keep the main name at CSS size; only shrink when it still overflows.
  // Prefer visible cards only — measuring 64–92 titles forces full-gallery layout.
  const titles=[];
  const aliases=[];
  if(visibleOnly && "IntersectionObserver" in window){
    const margin=Math.round(window.innerHeight*.35);
    gallery.querySelectorAll(".card .card-name b").forEach(el=>{
      const rect=el.getBoundingClientRect();
      if(rect.bottom>=-margin && rect.top<=window.innerHeight+margin) titles.push(el);
    });
    gallery.querySelectorAll(".card .card-name > span:not(.card-meta)").forEach(el=>{
      const rect=el.getBoundingClientRect();
      if(rect.bottom>=-margin && rect.top<=window.innerHeight+margin) aliases.push(el);
    });
  }else{
    titles.push(...gallery.querySelectorAll(".card .card-name b"));
    aliases.push(...gallery.querySelectorAll(".card .card-name > span:not(.card-meta)"));
  }
  titles.forEach(fitCardFaceTitleEl);
  aliases.forEach(el=>{
    if(el.dataset.titleFit==="1") return;
    fitTextToWidth(el,{minPx:6.5});
    el.dataset.titleFit="1";
  });
}

let titleFitObserver=null;
function observeTitleFits(){
  if(titleFitObserver){
    titleFitObserver.disconnect();
    titleFitObserver=null;
  }
  if(!("IntersectionObserver" in window)) return;
  titleFitObserver=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(!entry.isIntersecting) return;
      const name=entry.target;
      const title=name.querySelector("b");
      const alias=name.querySelector(":scope > span:not(.card-meta)");
      if(title) fitCardFaceTitleEl(title);
      if(alias && alias.dataset.titleFit!=="1"){
        fitTextToWidth(alias,{minPx:6.5});
        alias.dataset.titleFit="1";
      }
      titleFitObserver.unobserve(name);
    });
  },{rootMargin:"120px 0px",threshold:.01});
  gallery.querySelectorAll(".card .card-name").forEach(el=>titleFitObserver.observe(el));
}

function fitGalleryToViewport(){
  layoutFrame=0;
  if(works.length===0){
    document.documentElement.classList.remove("gallery-fit","compact-landscape");
    return;
  }
  const viewportHeight=Math.round(window.visualViewport?.height || window.innerHeight);
  const phonePortrait=phonePortraitQuery.matches;
  const compactLandscape=window.innerWidth>viewportHeight && viewportHeight<=520;

  if(phonePortrait){
    layoutRoot.classList.remove("gallery-fit","compact-landscape");

    fitCardFaceTitles();
    return;
  }

  if(compactLandscape){
    layoutRoot.classList.remove("gallery-fit");
    layoutRoot.classList.add("compact-landscape");
    fitCardFaceTitles();
    return;
  }

  // Desktop: let the cards keep their aspect-ratio-driven height so the
  // first card's first hint stays below its card instead of entering the next row.
  layoutRoot.classList.remove("compact-landscape");
  // Keep gallery-fit for the explicit desktop card sizing hook; row height
  // comes from aspect-ratio CSS rather than a JS-computed value.
  layoutRoot.classList.add("gallery-fit");
  fitCardFaceTitles();
}

function scheduleGalleryFit(){
  cancelAnimationFrame(layoutFrame);
  layoutFrame=requestAnimationFrame(fitGalleryToViewport);
}

let resizeFitTimer=0;
function scheduleGalleryFitDebounced(){
  clearTimeout(resizeFitTimer);
  resizeFitTimer=setTimeout(scheduleGalleryFit,80);
}

scheduleGalleryFit();
window.addEventListener("resize",scheduleGalleryFitDebounced,{passive:true});
window.addEventListener("orientationchange",()=>{
  // iOS often reports stale metrics until after the rotation frame settles.
  scheduleGalleryFit();
  setTimeout(scheduleGalleryFit,120);
  setTimeout(scheduleGalleryFit,320);
},{passive:true});
window.visualViewport?.addEventListener("resize",()=>{
  if(!phonePortraitQuery.matches){
    scheduleGalleryFitDebounced();
  }
},{passive:true});
if(typeof phonePortraitQuery.addEventListener==="function"){
  phonePortraitQuery.addEventListener("change",scheduleGalleryFit);
}else if(typeof phonePortraitQuery.addListener==="function"){
  phonePortraitQuery.addListener(scheduleGalleryFit);
}
document.fonts?.ready.then(scheduleGalleryFit);

const saveSheet=document.getElementById("saveSheet");
const saveSheetTitle=document.getElementById("saveSheetTitle");
const saveSheetHint=document.getElementById("saveSheetHint");
const saveSheetNote=document.getElementById("saveSheetNote");
const saveSheetImage=document.getElementById("saveSheetImage");
const saveSheetLink=document.getElementById("saveSheetLink");
const saveSheetClose=document.getElementById("saveSheetClose");
const saveSheetPhoto=document.getElementById("saveSheetPhoto");

/*
 * 完整角色卡 PNG 可能较大。
 * 只缓存最近成功准备的一张 File，
 * 避免手机内存不断增长。
 */
const SHARE_PNG_CACHE_LIMIT=1;
const sharePngFileCache=new Map();

let saveSheetLastFocus=null;
let saveSheetActiveWork=null;
let saveSheetShareFile=null;
let saveSheetPrepareVersion=0;
let saveSheetPrepareController=null;
let saveSheetDownloadObjectUrl=null;

/*
 * Web Share 全局状态。
 * 即使用户关闭网页内的保存辅助层，
 * 只要系统分享 Promise 没有结束，就不能解除此锁。
 */
let webSharePending=false;
let webShareWatchdog=0;

/*
 * Full card PNGs are multi-hundred MB in aggregate and cannot ship with Pages
 * reliably. Resolve on demand with a short fallback chain (local → jsDelivr → raw).
 */
const SOURCE_PNG_RE=/^(?:\.\/)?assets\/(?:tavo|shark|wa|source)\//i;
const REPO_MAIN_REF="hqu35785-cmyk/fanhuafenluo-pages@main";
const RAW_MAIN_BASE="https://raw.githubusercontent.com/hqu35785-cmyk/fanhuafenluo-pages/main/";
const JSDELIVR_MAIN_BASE=`https://cdn.jsdelivr.net/gh/${REPO_MAIN_REF}/`;

function normalizeAssetPath(path){
  return String(path||"").replace(/^\.\//,"").replace(/^\//,"");
}

function absoluteAssetUrl(path){
  const raw=String(path||"");
  if(/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;
  const rel=normalizeAssetPath(raw);
  try{
    if(SOURCE_PNG_RE.test(rel)){
      // Prefer CDN first for full PNGs (often faster + cached vs raw.githubusercontent).
      return JSDELIVR_MAIN_BASE+rel;
    }
    return new URL(raw,window.location.href).href;
  }catch{
    return raw;
  }
}

function sourcePngCandidateUrls(path){
  const rel=normalizeAssetPath(path);
  const urls=[];
  try{
    urls.push(new URL(rel,window.location.href).href);
  }catch(_){}
  urls.push(JSDELIVR_MAIN_BASE+rel);
  urls.push(RAW_MAIN_BASE+rel);
  return [...new Set(urls)];
}

function setSaveSheetStatus(text){
  if(saveSheetNote) saveSheetNote.textContent=text;
}

function safePngFilename(name){
  const safeName=String(name || "角色卡")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,"_")
    .replace(/[. ]+$/g,"")
    .trim()
    .slice(0,100);
  return `${safeName || "角色卡"}-角色卡.png`;
}

function hasFileShareApi(){
  return Boolean(
    window.isSecureContext &&
    typeof File==="function" &&
    typeof navigator.share==="function" &&
    typeof navigator.canShare==="function"
  );
}

function canSharePngFile(file){
  if(!file || !hasFileShareApi()) return false;
  try{
    return navigator.canShare({files:[file]});
  }catch{
    return false;
  }
}

function rememberShareFile(url,file){
  sharePngFileCache.delete(url);
  sharePngFileCache.set(url,file);
  while(sharePngFileCache.size>SHARE_PNG_CACHE_LIMIT){
    const oldestUrl=sharePngFileCache.keys().next().value;
    sharePngFileCache.delete(oldestUrl);
  }
}

const PNG_FETCH_TIMEOUT_MS=12000;
const pngFailCache=new Map(); // url -> expiry timestamp
const pngInflight=new Map(); // url -> Promise<Blob>
const PNG_FAIL_TTL_MS=60000;

function pngUrlRecentlyFailed(url){
  const exp=pngFailCache.get(url);
  if(!exp) return false;
  if(Date.now()>exp){
    pngFailCache.delete(url);
    return false;
  }
  return true;
}

function markPngUrlFailed(url){
  pngFailCache.set(url,Date.now()+PNG_FAIL_TTL_MS);
}

async function fetchValidatedPngBlob(url,signal){
  if(pngUrlRecentlyFailed(url)) throw new Error("PNG recently failed");
  if(pngInflight.has(url)){
    return pngInflight.get(url);
  }
  const controller=new AbortController();
  const onAbort=()=>controller.abort();
  if(signal){
    if(signal.aborted) throw new DOMException("Aborted","AbortError");
    signal.addEventListener("abort",onAbort,{once:true});
  }
  const timer=setTimeout(()=>controller.abort(),PNG_FETCH_TIMEOUT_MS);
  const task=(async()=>{
    try{
      const response=await fetch(url,{
        credentials:"omit",
        mode:"cors",
        signal:controller.signal,
        cache:"force-cache"
      });
      if(!response.ok) throw new Error(`PNG request failed: ${response.status}`);
      const blob=await response.blob();
      if(signal?.aborted) throw new DOMException("Aborted","AbortError");
      if(!blob.size) throw new Error("PNG response is empty");
      /*
       * 只检查 PNG 文件签名。
       * 不重新编码、不修改完整文件。
       */
      const header=new Uint8Array(await blob.slice(0,8).arrayBuffer());
      const signature=[137,80,78,71,13,10,26,10];
      const validPng=header.length===signature.length && signature.every((byte,index)=>header[index]===byte);
      if(!validPng) throw new Error("Downloaded asset is not a valid PNG");
      pngFailCache.delete(url);
      return blob;
    }catch(error){
      if(error?.name!=="AbortError") markPngUrlFailed(url);
      throw error;
    }finally{
      clearTimeout(timer);
      if(signal) signal.removeEventListener("abort",onAbort);
      pngInflight.delete(url);
    }
  })();
  pngInflight.set(url,task);
  return task;
}

function revokeSaveSheetDownloadUrl(){
  if(!saveSheetDownloadObjectUrl) return;
  try{ URL.revokeObjectURL(saveSheetDownloadObjectUrl) }catch{/* 忽略旧对象 URL 回收失败 */}
  saveSheetDownloadObjectUrl=null;
}

function triggerBlobDownload(blob,filename){
  if(!blob || !blob.size) throw new Error("PNG response is empty");
  if(typeof URL?.createObjectURL!=="function") throw new Error("Blob download is unavailable");

  const objectUrl=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=objectUrl;
  link.download=filename;
  link.rel="noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();

  /* 给浏览器留出启动下载的时间，再释放临时对象 URL。 */
  window.setTimeout(()=>{
    try{ URL.revokeObjectURL(objectUrl) }catch{/* 忽略对象 URL 回收失败 */}
  },30000);
}

async function fetchOriginalPngResource(work,signal){
  const candidates=sourcePngCandidateUrls(work?.image).filter(url=>!pngUrlRecentlyFailed(url));
  for(const url of candidates){
    const cachedFile=sharePngFileCache.get(url);
    if(cachedFile){
      rememberShareFile(url,cachedFile);
      return {url,blob:cachedFile};
    }
  }

  let lastError=null;
  for(const url of candidates){
    try{
      return {url,blob:await fetchValidatedPngBlob(url,signal)};
    }catch(error){
      if(error?.name==="AbortError") throw error;
      lastError=error;
    }
  }
  throw lastError || new Error("PNG unavailable");
}

async function prepareOriginalPngFile(work,signal){
  const candidates=sourcePngCandidateUrls(work.image).filter(url=>!pngUrlRecentlyFailed(url));
  for(const url of candidates){
    const cachedFile=sharePngFileCache.get(url);
    if(cachedFile){
      rememberShareFile(url,cachedFile);
      return cachedFile;
    }
  }

  const {url,blob}=await fetchOriginalPngResource(work,signal);
  const file=new File([blob],safePngFilename(work.name),{
    type:"image/png",
    lastModified:Date.now()
  });
  rememberShareFile(url,file);
  return file;
}

async function prepareSaveSheetDownload(work,signal,version){
  if(!saveSheetLink) return;

  try{
    const {blob}=await fetchOriginalPngResource(work,signal);
    if(version!==saveSheetPrepareVersion || saveSheet.hidden || saveSheetActiveWork!==work) return;
    if(typeof URL?.createObjectURL!=="function") throw new Error("Blob download is unavailable");

    revokeSaveSheetDownloadUrl();
    saveSheetDownloadObjectUrl=URL.createObjectURL(blob);
    saveSheetLink.href=saveSheetDownloadObjectUrl;
    saveSheetLink.setAttribute("download",safePngFilename(work.name));
    saveSheetLink.removeAttribute("aria-disabled");
    saveSheetLink.removeAttribute("aria-busy");
    saveSheetLink.removeAttribute("tabindex");
    saveSheetLink.textContent="下载 PNG 原图";
  }catch(error){
    if(error?.name==="AbortError") return;
    if(version!==saveSheetPrepareVersion || saveSheet.hidden || saveSheetActiveWork!==work) return;

    /* Blob 下载失败时仍保留可手动长按保存的原图入口，并明确提示原因。 */
    saveSheetLink.href=absoluteAssetUrl(work.image);
    saveSheetLink.setAttribute("download",safePngFilename(work.name));
    saveSheetLink.removeAttribute("aria-disabled");
    saveSheetLink.removeAttribute("aria-busy");
    saveSheetLink.removeAttribute("tabindex");
    saveSheetLink.textContent="打开 PNG 原图";
    setSaveSheetStatus("文件下载准备失败。请长按上方原图保存，或检查网络后重新打开保存面板。");
  }
}

async function prepareSaveToPhotos(work,controller,version){
  if(!saveSheetPhoto) return;
  saveSheetPhoto.disabled=true;
  saveSheetPhoto.textContent="正在准备相册保存…";
  saveSheetPhoto.removeAttribute("aria-busy");

  if(!hasFileShareApi()){
    saveSheetPhoto.textContent="当前浏览器不支持保存到相册";
    setSaveSheetStatus("当前浏览器不支持 PNG 文件分享。请长按原图保存，或使用“下载 PNG 原图”。");
    return;
  }

  setSaveSheetStatus("正在准备 PNG 原图。准备完成后可打开系统保存菜单。");

  try{
    const file=await prepareOriginalPngFile(work,controller.signal);

    /*
     * 防止上一张角色卡的结果
     * 覆盖当前辅助层。
     */
    if(version!==saveSheetPrepareVersion || saveSheet.hidden || saveSheetActiveWork!==work) return;

    if(!canSharePngFile(file)){
      saveSheetPhoto.disabled=true;
      saveSheetPhoto.textContent="当前浏览器不支持保存到相册";
      setSaveSheetStatus("当前浏览器不能通过系统菜单分享此 PNG。请长按原图保存，或使用“下载 PNG 原图”。");
      return;
    }

    saveSheetShareFile=file;

    /*
     * 浏览器仍在处理上一次分享时，
     * 不能再次调用 navigator.share。
     */
    if(webSharePending){
      saveSheetPhoto.disabled=true;
      saveSheetPhoto.textContent="系统仍在处理上一次请求";
      setSaveSheetStatus("浏览器仍在处理上一次系统分享。如果系统菜单已经关闭但按钮一直不可用，请刷新页面，或直接长按原图保存。");
      return;
    }

    saveSheetPhoto.disabled=false;
    saveSheetPhoto.textContent="保存到相册";
    setSaveSheetStatus("点击“保存到相册”后，请在系统菜单中选择“存储图像”“保存到照片”或相册应用。若没有相应选项，请长按原图保存。需要保留角色卡数据时，请使用“下载 PNG 原图”。");
  }catch(error){
    if(error?.name==="AbortError") return;
    console.error("准备相册 PNG 失败：",error);
    if(version!==saveSheetPrepareVersion || saveSheet.hidden) return;
    saveSheetPhoto.disabled=true;
    saveSheetPhoto.textContent="相册保存准备失败";
    setSaveSheetStatus("原始 PNG 加载失败。请检查网络后重新打开，或尝试“下载 PNG 原图”。");
  }
}

function saveEnvironment(){
  const ua=navigator.userAgent || "";
  const wechat=/MicroMessenger/i.test(ua);
  const qq=/QQ\//i.test(ua) && !/MicroMessenger/i.test(ua);
  const ios=/iPhone|iPad|iPod/i.test(ua) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
  const android=/Android/i.test(ua);
  const coarse=window.matchMedia("(hover:none), (pointer:coarse)").matches;
  const needsAssist=wechat || qq || ios || android || coarse;
  return {wechat,qq,ios,android,mobile:needsAssist,needsAssist};
}

function saveCopyForEnv(env,name){
  if(env.wechat){
    return {
      title:`保存「${name}」`,
      hint:"微信里常无法直接下载文件。请长按下方原图，选择「保存图片」；仍不行时点右上角 ··· 用系统浏览器打开本站后再保存。",
      note:"长按上方图片保存最稳；「下载」按钮在微信里可能无效。"
    };
  }
  if(env.qq){
    return {
      title:`保存「${name}」`,
      hint:"内置浏览器可能拦截下载。请长按下方原图保存；或用系统浏览器打开本站后再试。",
      note:"优先长按图片保存，成功率更高。"
    };
  }
  if(env.ios){
    return {
      title:`保存「${name}」`,
      hint:"iPhone / iPad 请长按下方原图，选择「存储图像」或「添加到照片」。",
      note:"若点下载只打开图片，仍可长按保存；角色卡数据在原图里。"
    };
  }
  return {
    title:`保存「${name}」`,
    hint:"请先尝试下方「下载 PNG 原图」；若没有开始下载，请长按图片保存。",
    note:"原图为同源 PNG，含角色卡数据。"
  };
}

function triggerDirectDownload(work){
  return fetchOriginalPngResource(work).then(({blob})=>{
    triggerBlobDownload(blob,safePngFilename(work.name));
  });
}

function closeSaveSheet(){
  if(!saveSheet || saveSheet.hidden) return;

  /* 使旧的准备任务失效。 */
  saveSheetPrepareVersion++;

  /* 中止当前仍在进行的原始 PNG 请求。 */
  saveSheetPrepareController?.abort();
  saveSheetPrepareController=null;

  saveSheetActiveWork=null;
  saveSheetShareFile=null;
  revokeSaveSheetDownloadUrl();

  if(saveSheetPhoto){
    saveSheetPhoto.disabled=true;
    saveSheetPhoto.textContent=webSharePending ? "系统仍在处理…" : "正在准备相册保存…";
    saveSheetPhoto.removeAttribute("aria-busy");
  }

  saveSheet.hidden=true;
  saveSheetImage.removeAttribute("src");
  saveSheetLink.removeAttribute("href");
  saveSheetLink.removeAttribute("download");
  saveSheetLink.removeAttribute("aria-disabled");
  saveSheetLink.removeAttribute("aria-busy");
  saveSheetLink.removeAttribute("tabindex");
  document.removeEventListener("keydown",onSaveSheetKeydown,true);

  const restore=saveSheetLastFocus;
  saveSheetLastFocus=null;
  if(restore && typeof restore.focus==="function" && document.contains(restore)){
    try{restore.focus({preventScroll:true})}catch{/* 忽略焦点恢复失败 */}
  }
}

function onSaveSheetKeydown(event){
  if(event.key==="Escape"){
    event.preventDefault();
    event.stopPropagation();
    closeSaveSheet();
  }
}

function openSaveSheet(work){
  const url=absoluteAssetUrl(work.image);
  const env=saveEnvironment();
  const copy=saveCopyForEnv(env,work.name);

  saveSheetPrepareController?.abort();
  const controller=new AbortController();
  saveSheetPrepareController=controller;
  const version=++saveSheetPrepareVersion;
  saveSheetActiveWork=work;
  saveSheetShareFile=null;
  revokeSaveSheetDownloadUrl();

  saveSheetLastFocus=document.activeElement instanceof HTMLElement ? document.activeElement : null;
  saveSheetTitle.textContent=copy.title;
  saveSheetHint.textContent="可以使用“保存到相册”打开系统菜单，也可以长按下方原图保存。";
  setSaveSheetStatus("正在准备 PNG 原图。保存到相册由手机系统处理，部分相册可能重新处理图片并移除角色卡数据。需要导入角色卡时，请使用“下载 PNG 原图”。");
  saveSheetImage.alt=`${work.name}角色卡原图`;
  saveSheetImage.src=url;
  saveSheetLink.removeAttribute("href");
  saveSheetLink.removeAttribute("download");
  saveSheetLink.setAttribute("aria-disabled","true");
  saveSheetLink.setAttribute("aria-busy","true");
  saveSheetLink.setAttribute("tabindex","-1");
  saveSheetLink.textContent="正在准备下载…";
  saveSheet.hidden=false;
  document.addEventListener("keydown",onSaveSheetKeydown,true);

  /*
   * 先显示辅助层，再在后台准备 File。
   * 用户点击“保存到相册”后不能再 fetch。
   */
  void prepareSaveSheetDownload(work,controller.signal,version);
  void prepareSaveToPhotos(work,controller,version);
  saveSheetClose?.focus({preventScroll:true});
}

function downloadCharacterCard(work,index){
  if(!work || !fullCardAccessAllowed(index)) return;
  if(!work.image){
    tip("原图地址无效");
    return;
  }
  const env=saveEnvironment();
  // 桌面等可直接下载的环境：静默同源下载，不打断浏览。
  if(!env.needsAssist){
    tip("正在准备 PNG 下载…");
    void triggerDirectDownload(work)
      .then(()=>tip("已开始下载"))
      .catch(()=>tip("下载失败，请右键卡面图片另存为"));
    return;
  }
  // 手机 / 微信 / iOS：弹出保存辅助层，可随时关闭，不影响档案与画廊。
  try{
    openSaveSheet(work);
  }catch{
    tip("正在准备 PNG 下载…");
    void triggerDirectDownload(work)
      .then(()=>tip("已发起下载；失败请用系统浏览器打开本站"))
      .catch(()=>tip("保存失败，请用系统浏览器打开本站后重试"));
  }
}

saveSheetClose?.addEventListener("click",closeSaveSheet);
saveSheet?.addEventListener("click",event=>{
  if(event.target===saveSheet) closeSaveSheet();
});
// 面板内部点击不冒泡到遮罩关闭
saveSheet?.querySelector(".save-sheet-panel")?.addEventListener("click",event=>event.stopPropagation());

saveSheetPhoto?.addEventListener("click",()=>{
  const file=saveSheetShareFile;
  const version=saveSheetPrepareVersion;

  if(webSharePending){
    setSaveSheetStatus("系统仍在处理上一次分享请求。如果系统菜单已经关闭但按钮仍不可用，请刷新页面后重试。");
    return;
  }

  if(!canSharePngFile(file)){
    setSaveSheetStatus("当前浏览器无法打开 PNG 系统保存菜单。请长按原图保存，或使用“下载 PNG 原图”。");
    return;
  }

  webSharePending=true;
  saveSheetPhoto.disabled=true;
  saveSheetPhoto.textContent="正在打开系统菜单…";
  saveSheetPhoto.setAttribute("aria-busy","true");

  let sharePromise;
  try{
    /*
     * 必须在当前用户点击事件中立即调用。
     * 这里前面不能添加 await。
     */
    sharePromise=navigator.share({files:[file]});
  }catch(error){
    sharePromise=Promise.reject(error);
  }

  clearTimeout(webShareWatchdog);

  /*
   * 部分旧版 iOS 可能不结束分享 Promise。
   * 超时后只显示提示，不能擅自解除分享锁，
   * 因为网页无法重置浏览器内部分享状态。
   */
  webShareWatchdog=setTimeout(()=>{
    if(!webSharePending) return;
    if(version===saveSheetPrepareVersion && !saveSheet.hidden){
      saveSheetPhoto.disabled=true;
      saveSheetPhoto.textContent="系统仍在处理…";
      setSaveSheetStatus("系统没有返回分享结果。如果菜单已经关闭但按钮仍不可用，请刷新页面后重试；也可以长按原图保存。");
    }
  },20000);

  Promise.resolve(sharePromise)
    .then(()=>{
      if(version!==saveSheetPrepareVersion || saveSheet.hidden) return;
      setSaveSheetStatus("文件已交给系统菜单处理。是否保存到相册由所选系统应用决定。需要保留角色卡数据时，请使用“下载 PNG 原图”。");
    })
    .catch(error=>{
      if(version!==saveSheetPrepareVersion || saveSheet.hidden) return;

      /*
       * AbortError 可能是用户取消，
       * 也可能是没有可用分享目标。
       */
      if(error?.name==="AbortError"){
        setSaveSheetStatus("系统菜单已关闭。未完成保存时可以再次尝试。");
        return;
      }
      if(error?.name==="InvalidStateError"){
        setSaveSheetStatus("浏览器仍认为上一次分享没有结束。请刷新页面后重试，或长按原图保存。");
        return;
      }
      if(error?.name==="NotAllowedError"){
        setSaveSheetStatus("浏览器阻止了系统分享请求。请重新点击按钮，或长按原图保存。");
        return;
      }
      console.error("打开系统分享菜单失败：",error);
      setSaveSheetStatus("无法打开系统保存菜单。请长按原图保存，或使用“下载 PNG 原图”。");
    })
    .finally(()=>{
      /*
       * 只有浏览器的 Promise 真正结束后，
       * 才解除全局分享锁。
       */
      webSharePending=false;
      clearTimeout(webShareWatchdog);
      webShareWatchdog=0;

      if(version!==saveSheetPrepareVersion || saveSheet.hidden || saveSheetShareFile!==file) return;

      saveSheetPhoto.disabled=false;
      saveSheetPhoto.textContent="保存到相册";
      saveSheetPhoto.removeAttribute("aria-busy");
    });
});

const archiveClose=document.getElementById("archiveClose");
const archiveVisual=document.getElementById("archiveVisual");
const archiveImage=document.getElementById("archiveImage");
const archivePrivacy=document.getElementById("archivePrivacy");
const archivePrivacyTitle=document.getElementById("archivePrivacyTitle");
const archivePrivacyMessage=document.getElementById("archivePrivacyMessage");
const archiveUnlock=document.getElementById("archiveUnlock");
const unlockAll=document.getElementById("unlockAll");
const archiveFile=document.getElementById("archiveFile");
const archiveAlias=document.getElementById("archiveAlias");
const archiveName=document.getElementById("archiveName");
const archiveRole=document.getElementById("archiveRole");
const archiveTags=document.getElementById("archiveTags");
const archiveOpening=document.getElementById("archiveOpening");
const archivePersonality=document.getElementById("archivePersonality");
const archiveSetting=document.getElementById("archiveSetting");
const archiveSettingPrivacy=document.getElementById("archiveSettingPrivacy");
const downloadCard=document.getElementById("downloadCard");
// Cap concurrent decodes so mid-range phones stay responsive while scrolling.
// Cap concurrent image decode/network so multi-unlock stays responsive.
const PREVIEW_LOAD_CONCURRENCY=3;
const PREVIEW_DECODE_CONCURRENCY=1;
const PREVIEW_MAX_ATTEMPTS=3;
const PREVIEW_LOAD_TIMEOUT=20000;
let activePreviewDecodes=0;
const previewDecodeWaiters=[];

function acquirePreviewDecodeSlot(){
  if(activePreviewDecodes<PREVIEW_DECODE_CONCURRENCY){
    activePreviewDecodes++;
    return Promise.resolve();
  }
  return new Promise(resolve=>previewDecodeWaiters.push(resolve));
}

function releasePreviewDecodeSlot(){
  activePreviewDecodes=Math.max(0,activePreviewDecodes-1);
  const next=previewDecodeWaiters.shift();
  if(next){
    activePreviewDecodes++;
    next();
  }
}
// runtime sets rebound via useAuthorRuntimeRefs(); activePreviewLoads lives on runtime
let activeWork=null;
let activeIndex=null;
let modalOpener=null;

function isWorkLocked(index){
  if(CARD_VISIBILITY_MODE==="open") return false;
  return Boolean(works[index]?.sensitive) && !unlockedWorks.has(index);
}

function isSettingLocked(index){
  if(CARD_VISIBILITY_MODE==="open") return false;
  return Boolean(works[index]?.sensitiveSetting) && !unlockedWorks.has(index);
}

function getLockedSensitiveIndexes(){
  return works.reduce((indexes,work,index)=>{
    if(work.sensitive && isWorkLocked(index)) indexes.push(index);
    return indexes;
  },[]);
}

function getFailedPreviewIndexes(){
  return works.reduce((indexes,work,index)=>{
    if(work.sensitive && !isWorkLocked(index) && previewLoadStates.get(index)==="error") indexes.push(index);
    return indexes;
  },[]);
}

function syncUnlockAll(){
  if(!unlockAll) return;
  if(CARD_VISIBILITY_MODE==="open"){
    unlockAll.hidden=true;
    unlockAll.disabled=true;
    unlockAll.setAttribute("aria-hidden","true");
    unlockAll.setAttribute("inert","");
    if(typeof unlockChoice!=="undefined" && unlockChoice){
      unlockChoice.hidden=true;
      unlockChoice.setAttribute("aria-hidden","true");
      unlockChoice.setAttribute("inert","");
    }
    return;
  }
  const sensitiveCount=works.reduce((count,work)=>count+(work.sensitive ? 1 : 0),0);
  const lockedCount=getLockedSensitiveIndexes().length;
  const failedCount=getFailedPreviewIndexes().length;
  const complete=sensitiveCount>0 && lockedCount===0 && failedCount===0;
  unlockAll.hidden=sensitiveCount===0;
  unlockAll.disabled=complete;
  unlockAll.classList.toggle("is-complete",complete);
  unlockAll.textContent=lockedCount>0
    ? "一键解锁"
    : failedCount>0
      ? `重试 ${failedCount} 张`
      : "已全部解锁";
  unlockAll.setAttribute("aria-label",lockedCount>0
    ? `一键解锁全部 ${lockedCount} 张敏感角色卡${failedCount>0 ? `，并重试 ${failedCount} 张图片` : ""}，仅本次页面有效`
    : failedCount>0
      ? `重新加载 ${failedCount} 张失败的图片`
      : "全部敏感角色卡已解锁，图片将按查看顺序加载");
}

function previewForWork(work){
  return work.preview || null;
}

function getCardPreviewParts(index){
  const cached=cardPartsCache.get(index);
  if(cached?.card?.isConnected) return cached;
  const card=getCardNode(index);
  if(!card) return null;
  const parts={
    card,
    front:card.querySelector(".front"),
    image:card.querySelector(".front img"),
    veil:card.querySelector(".privacy-veil"),
    unlock:card.querySelector(".privacy-unlock"),
    status:card.querySelector(".preview-status")
  };
  cardPartsCache.set(index,parts);
  return parts;
}

function isPreviewNearViewport(element){
  const rect=element.getBoundingClientRect();
  // Tight prefetch band: only near-viewport faces decode on low-end devices.
  const margin=Math.min(180,Math.round(window.innerHeight*.3));
  return rect.bottom>=-margin && rect.top<=window.innerHeight+margin;
}

function queueUnlockedPreviewsNearViewport(){
  const indexes=[...gallery.querySelectorAll(".card .front")]
    .map(front=>({front,index:Number(front.closest(".card")?.dataset.index)}))
    .filter(({front,index})=>Number.isInteger(index) && !isWorkLocked(index) && isPreviewNearViewport(front))
    .map(({index})=>index);
  indexes.forEach(index=>queuePreviewLoad(index));
}

function previewAttemptUrl(source,attempt){
  if(attempt===0 || source.startsWith("data:")) return source;
  const url=new URL(source,window.location.href);
  url.searchParams.set("preview-retry",String(attempt));
  return url.href;
}

function waitForImageElement(image,source){
  return new Promise((resolve,reject)=>{
    let settled=false;
    let timeoutId=0;
    const finish=(loaded,timedOut=false)=>{
      if(settled) return;
      settled=true;
      if(timeoutId) clearTimeout(timeoutId);
      image.removeEventListener("load",onLoad);
      image.removeEventListener("error",onError);
      if(loaded && image.naturalWidth>0){
        resolve();
      }else{
        const error=new Error(timedOut ? "preview timed out" : "preview unavailable");
        if(timedOut) error.name="TimeoutError";
        reject(error);
      }
    };
    const onLoad=()=>finish(true);
    const onError=()=>finish(false);
    image.addEventListener("load",onLoad);
    image.addEventListener("error",onError);
    timeoutId=setTimeout(()=>finish(false,true),PREVIEW_LOAD_TIMEOUT);
    image.src=source;
    if(image.complete) queueMicrotask(()=>finish(image.naturalWidth>0));
  });
}

function previewRetryDelay(attempt){
  return new Promise(resolve=>setTimeout(resolve,400*(2**attempt)));
}

async function loadPreviewWithRetry(index,{generation,authorId}={}){
  const work=works[index];
  const parts=getCardPreviewParts(index);
  if(!work || !parts) return false;
  const source=previewForWork(work);
  if(!source) return false;
  const stillCurrent=()=>{
    if(authorId && authorId!==activeAuthor.id) return false;
    if(generation!=null){
      const rt=getAuthorRuntime(authorId || activeAuthor.id);
      if(rt.decodeGeneration!==generation) return false;
    }
    return true;
  };
  // Already decoded and correct — skip network/decode churn on re-queue.
  if(
    parts.image.complete &&
    parts.image.naturalWidth>0 &&
    (parts.image.currentSrc || parts.image.src).includes(source.split("/").pop().split("?")[0])
  ){
    return true;
  }
  for(let attempt=0;attempt<PREVIEW_MAX_ATTEMPTS;attempt++){
    if(!stillCurrent()) return false;
    try{
      // Avoid blanking a good paint when retrying the same URL.
      if(attempt>0 || !parts.image.getAttribute("src")){
        parts.image.removeAttribute("src");
      }
      await waitForImageElement(parts.image,previewAttemptUrl(source,attempt));
      if(!stillCurrent()) return false;
      // Serialize decode work to avoid multi-image main-thread stalls after unlock-all.
      if(typeof parts.image.decode==="function"){
        await acquirePreviewDecodeSlot();
        try{
          if(!stillCurrent()) return false;
          await parts.image.decode();
        }catch(_){
          /* decode can reject on detached nodes; naturalWidth check below is source of truth */
        }finally{
          releasePreviewDecodeSlot();
        }
      }
      return parts.image.naturalWidth>0;
    }catch(error){
      if(!stillCurrent()) return false;
      parts.image.removeAttribute("src");
      if(error?.name==="TimeoutError") break;
      if(attempt+1<PREVIEW_MAX_ATTEMPTS) await previewRetryDelay(attempt);
    }
  }
  return false;
}

function queuePreviewLoad(index,{priority=false,force=false}={}){
  if(isWorkLocked(index)) return;
  const parts=getCardPreviewParts(index);
  if(!parts) return;
  const state=previewLoadStates.get(index) || "idle";
  if(state==="loaded" && parts.image.complete && parts.image.naturalWidth>0) return;
  if(state==="loading") return;
  if(state==="error" && !force) return;
  if(state==="queued"){
    if(priority){
      const position=previewLoadQueue.indexOf(index);
      if(position>0){
        previewLoadQueue.splice(position,1);
        previewLoadQueue.unshift(index);
      }
    }
    return;
  }
  previewLoadStates.set(index,"queued");
  queuedPreviewIndexes.add(index);
  if(priority) previewLoadQueue.unshift(index);
  else previewLoadQueue.push(index);
  syncCardPrivacy(index);
  pumpPreviewLoads();
}

function pumpPreviewLoads(){
  const rtActive=getActiveRuntime();
  while(rtActive.activePreviewLoads<PREVIEW_LOAD_CONCURRENCY && previewLoadQueue.length){
    const index=previewLoadQueue.shift();
    queuedPreviewIndexes.delete(index);
    if(previewLoadStates.get(index)!=="queued" || isWorkLocked(index)) continue;
    rtActive.activePreviewLoads++;
    previewLoadStates.set(index,"loading");
    syncCardPrivacy(index);
    const loadAuthorId=activeAuthor.id;
    const loadVersion=authorRenderVersion;
    const generation=rtActive.decodeGeneration||0;
    loadPreviewWithRetry(index,{generation,authorId:loadAuthorId}).then(loaded=>{
      const rt=getAuthorRuntime(loadAuthorId);
      // Ignore results from abandoned generations (author switch / closed sheet).
      if(rt.decodeGeneration!==generation) return;
      rt.previewLoadStates.set(index,loaded ? "loaded" : "error");
      if(loadVersion!==authorRenderVersion || loadAuthorId!==activeAuthor.id) return;
      syncCardPrivacy(index);
      if(archiveModal.open && activeIndex===index) syncArchivePrivacy(index);
      syncUnlockAll();
    }).finally(()=>{
      const rt=getAuthorRuntime(loadAuthorId);
      rt.activePreviewLoads=Math.max(0,rt.activePreviewLoads-1);
      if(loadVersion===authorRenderVersion && loadAuthorId===activeAuthor.id){
        pumpPreviewLoads();
      }
    });
  }
}

function syncCardPrivacy(index,{queueIfNear=true}={}){
  const work=works[index];
  const parts=getCardPreviewParts(index);
  if(!work || !parts) return;
  const {card,front,image,veil,unlock,status}=parts;
  const locked=isWorkLocked(index);
  const state=previewLoadStates.get(index) || "idle";
  const loading=!locked && (state==="queued" || state==="loading");
  const failed=!locked && state==="error";

  card.dataset.previewState=locked ? "locked" : state;
  image.dataset.loadState=locked ? "locked" : state;
  front.classList.toggle("is-locked",locked);
  front.classList.toggle("is-loading",loading);
  front.classList.toggle("is-load-error",failed);
  front.toggleAttribute("aria-busy",loading);
  front.setAttribute("aria-label",failed
    ? `翻转查看${work.name}的简介，图片加载失败，可使用重试图片按钮重新加载`
    : `翻转查看${work.name}的简介`);
  if(status) status.textContent=failed ? `${work.name}的图片加载失败，可使用重试图片按钮重新加载。` : "";
  card.classList.toggle("is-unlocked",Boolean(work.sensitive) && !locked);
  if(locked){
    image.removeAttribute("src");
    image.alt="";
    image.hidden=true;
    image.setAttribute("aria-hidden","true");
  }else{
    image.alt=work.name;
    image.hidden=false;
    image.removeAttribute("aria-hidden");
  }
  if(veil) veil.hidden=!(locked || loading || failed);
  if(unlock){
    const flipped=card.classList.contains("flipped");
    unlock.hidden=false;
    if(locked){
      unlock.dataset.mode="unlock";
      unlock.disabled=false;
      unlock.textContent="解锁卡面";
      unlock.title="";
      unlock.setAttribute("aria-label",`显示${work.name}的敏感图片，仅本次页面有效`);
    }else if(failed){
      unlock.dataset.mode="retry";
      unlock.disabled=false;
      unlock.textContent="重试图片";
      unlock.title="";
      unlock.setAttribute("aria-label",`重新加载${work.name}的图片`);
    }else{
      unlock.dataset.mode="save";
      unlock.disabled=false;
      unlock.textContent="保存角色卡 PNG";
      unlock.title="";
      unlock.setAttribute("aria-label",`保存${work.name}角色卡 PNG`);
    }
    unlock.toggleAttribute("inert",flipped);
    unlock.setAttribute("aria-hidden",String(flipped));
  }
  if(queueIfNear && !locked && state==="idle" && isPreviewNearViewport(front)) queuePreviewLoad(index);
}

function syncCardSettingPrivacy(index){
  const work=works[index];
  const card=getCardNode(index);
  if(!work || !card) return;
  const back=card.querySelector(".back");
  // Back shell not materialized yet — state will apply on first flip.
  if(!back || back.dataset.backPending==="1"){
    card.classList.toggle("is-setting-unlocked",Boolean(work.sensitiveSetting) && !isSettingLocked(index));
    return;
  }
  const content=card.querySelector(".back-setting-content");
  const settingText=content?.querySelector('[data-field="setting"]') || content?.querySelector("p");
  const gate=card.querySelector(".back-setting-privacy");
  const locked=isSettingLocked(index);

  card.classList.toggle("is-setting-unlocked",Boolean(work.sensitiveSetting) && !locked);
  if(settingText){
    settingText.textContent=locked ? "" : (work.setting || "暂无背景设定。");
  }
  if(content){
    content.hidden=locked;
    content.setAttribute("aria-hidden",String(locked));
  }
  if(gate){
    gate.hidden=!locked;
    gate.toggleAttribute("inert",!locked);
    gate.setAttribute("aria-hidden",String(!locked));
  }
}

function cardSaveTitle(index){
  if(isWorkLocked(index) || isSettingLocked(index)) return "请先解锁卡面";
  return "";
}

function syncArchiveDownloads(index){
  const imageLocked=isWorkLocked(index);
  const settingLocked=isSettingLocked(index);
  downloadCard.disabled=imageLocked || settingLocked;
  downloadCard.title=cardSaveTitle(index);
}

function syncArchivePrivacy(index){
  const work=works[index];
  if(!work) return;
  const locked=isWorkLocked(index);
  const state=previewLoadStates.get(index) || "idle";
  const parts=getCardPreviewParts(index);
  const loaded=!locked && state==="loaded" && parts?.image.complete && parts.image.naturalWidth>0;
  const failed=!locked && state==="error";
  const loading=!locked && !loaded && !failed;

  archiveImage.removeAttribute("src");
  archiveImage.alt="";
  archiveImage.hidden=true;
  archiveVisual.classList.toggle("is-locked",locked);
  archiveVisual.classList.toggle("is-loading",loading);
  archiveVisual.classList.toggle("is-load-error",failed);
  archiveVisual.toggleAttribute("aria-busy",loading);
  archivePrivacy.hidden=loaded;

  if(loaded){
    archiveImage.src=parts.image.currentSrc || parts.image.src;
    archiveImage.alt=`${work.name}角色立绘`;
    archiveImage.hidden=false;
  }else if(locked){
    archivePrivacyTitle.textContent="敏感图片已隐藏";
    archivePrivacyMessage.textContent="确认周围环境合适后，再解锁查看本次内容。";
    archiveUnlock.textContent="解锁查看";
    archiveUnlock.hidden=false;
    archiveUnlock.disabled=false;
  }else if(failed){
    archivePrivacyTitle.textContent="图片加载失败";
    archivePrivacyMessage.textContent="网络可能不稳定，可以重新加载这张图片。";
    archiveUnlock.textContent="重试图片";
    archiveUnlock.hidden=false;
    archiveUnlock.disabled=false;
  }else{
    archivePrivacyTitle.textContent="图片加载中…";
    archivePrivacyMessage.textContent="正在按查看顺序加载轻量预览，请稍候。";
    archiveUnlock.hidden=true;
    archiveUnlock.disabled=true;
    if(state==="idle" || state==="queued") queuePreviewLoad(index,{priority:true});
  }
  syncArchiveDownloads(index);
}

function syncArchiveSettingPrivacy(index){
  const work=works[index];
  if(!work) return;
  const locked=isSettingLocked(index);

  archiveSetting.textContent="";
  archiveSetting.hidden=locked;
  archiveSetting.setAttribute("aria-hidden",String(locked));
  archiveSettingPrivacy.hidden=!locked;
  archiveSettingPrivacy.toggleAttribute("inert",!locked);
  archiveSettingPrivacy.setAttribute("aria-hidden",String(!locked));
  if(!locked) archiveSetting.textContent=work.setting || "暂无背景设定。";
  syncArchiveDownloads(index);
}

function unlockWork(index){
  const work=works[index];
  if(!work || !work.sensitive) return;
  const retrying=previewLoadStates.get(index)==="error";
  unlockedWorks.add(index);
  syncCardPrivacy(index);
  syncCardSettingPrivacy(index);
  queuePreviewLoad(index,{priority:true,force:retrying});
  if(activeIndex===index){
    syncArchivePrivacy(index);
    syncArchiveSettingPrivacy(index);
  }
  syncUnlockAll();
  tip(retrying
    ? "正在重新加载图片"
    : "敏感卡面已解锁，图片加载中；刷新页面后会重新锁定");
}

const unlockChoice=document.getElementById("unlockChoice");
const unlockChoiceTitle=document.getElementById("unlockChoiceTitle");
const unlockChoiceMessage=document.getElementById("unlockChoiceMessage");
const unlockChoiceSingle=document.getElementById("unlockChoiceSingle");
const unlockChoiceAll=document.getElementById("unlockChoiceAll");
const unlockChoiceClose=document.getElementById("unlockChoiceClose");
let unlockChoiceIndex=null;
let unlockChoiceLastFocus=null;

function closeUnlockChoice(){
  if(!unlockChoice || unlockChoice.hidden) return;
  unlockChoice.hidden=true;
  unlockChoiceIndex=null;
  const restore=unlockChoiceLastFocus;
  unlockChoiceLastFocus=null;
  if(restore && document.contains(restore)){
    requestAnimationFrame(()=>restore.focus({preventScroll:true}));
  }
}

function openUnlockChoice(index,opener){
  const work=works[index];
  if(!unlockChoice || !work || !work.sensitive || !isWorkLocked(index)) return false;
  const lockedCount=getLockedSensitiveIndexes().length;
  if(lockedCount<=1) return false;
  unlockChoiceIndex=index;
  unlockChoiceLastFocus=opener instanceof HTMLElement
    ? opener
    : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  if(unlockChoiceTitle) unlockChoiceTitle.textContent="是否要一键解锁？";
  if(unlockChoiceMessage){
    unlockChoiceMessage.textContent=`正在解锁「${work.name}」。是否一键解锁全部 ${lockedCount} 张敏感角色卡？也可以仅解锁「${work.name}」。`;
  }
  if(unlockChoiceAll) unlockChoiceAll.textContent="一键解锁全部";
  if(unlockChoiceSingle) unlockChoiceSingle.textContent=`仅${work.name}`;
  unlockChoice.hidden=false;
  requestAnimationFrame(()=>{
    (unlockChoiceAll || unlockChoiceSingle || unlockChoiceClose)?.focus({preventScroll:true});
  });
  return true;
}

function requestSingleUnlock(index,opener){
  const work=works[index];
  if(!work || !work.sensitive) return;
  if(previewLoadStates.get(index)==="error" && !isWorkLocked(index)){
    unlockWork(index);
    return;
  }
  if(isWorkLocked(index) && openUnlockChoice(index,opener)) return;
  unlockWork(index);
}

function unlockAllWorks(){
  const lockedIndexes=getLockedSensitiveIndexes();
  const failedIndexes=getFailedPreviewIndexes();
  if(!lockedIndexes.length){
    if(failedIndexes.length){
      failedIndexes.forEach(index=>queuePreviewLoad(index,{force:true}));
      syncUnlockAll();
      tip(`正在重试 ${failedIndexes.length} 张图片`);
      return;
    }
    syncUnlockAll();
    tip("全部敏感角色卡已解锁");
    return;
  }
  lockedIndexes.forEach(index=>{
    unlockedWorks.add(index);
  });
  lockedIndexes.forEach(index=>{
    syncCardPrivacy(index,{queueIfNear:false});
    syncCardSettingPrivacy(index);
  });
  failedIndexes.forEach(index=>queuePreviewLoad(index,{force:true}));
  if(activeIndex!==null && lockedIndexes.includes(activeIndex)){
    syncArchivePrivacy(activeIndex);
    syncArchiveSettingPrivacy(activeIndex);
  }
  syncUnlockAll();
  requestAnimationFrame(queueUnlockedPreviewsNearViewport);
  tip(`已一键解锁全部 ${lockedIndexes.length} 张敏感角色卡${failedIndexes.length ? `，并重试 ${failedIndexes.length} 张图片` : ""}；图片会按查看顺序加载`);
}

function fullCardAccessAllowed(index){
  const imageLocked=isWorkLocked(index);
  if(!imageLocked) return true;
  tip("请先解锁卡面");
  return false;
}

function fillArchiveFields(work,index){
  archiveFile.textContent=work.cardLabel || work.tags?.[0] || "角色卡";
  archiveAlias.textContent=work.alias || "ORIGINAL";
  archiveName.textContent=work.name;
  archiveRole.textContent=work.role || "原创角色";
  archiveOpening.textContent=work.opening || "暂无开场。";
  archivePersonality.textContent=work.personality || "暂无性格介绍。";
  archiveTags.replaceChildren(...(work.tags || []).map(tag=>{
    const span=document.createElement("span");
    span.className="archive-tag";
    span.textContent=tag;
    return span;
  }));
  syncArchivePrivacy(index);
  syncArchiveSettingPrivacy(index);
}

function openArchive(index,opener){
  const work=works[index];
  if(!work) return;
  // Re-open of the same archive while already open is a no-op (rapid double click).
  if(archiveModal.open && activeIndex===index) return;
  activeWork=work;
  activeIndex=index;
  modalOpener=opener;
  archiveImage.removeAttribute("src");
  archiveImage.alt="";
  archiveImage.hidden=true;
  archiveSetting.textContent="";
  archiveSetting.hidden=true;
  archiveSettingPrivacy.hidden=true;
  fillArchiveFields(work,index);
  document.body.classList.add("modal-open");
  if(!archiveModal.open) archiveModal.showModal();
  requestAnimationFrame(()=>archiveClose.focus());
  // Refresh long-form fields if details were still lazy when the dialog opened.
  if(!workDetailsReady(work)){
    const openVersion=authorRenderVersion;
    const openIndex=index;
    ensureWorkDetailsForActive().then(()=>{
      if(openVersion!==authorRenderVersion || activeIndex!==openIndex || !archiveModal.open) return;
      const fresh=works[openIndex];
      if(!fresh) return;
      activeWork=fresh;
      fillArchiveFields(fresh,openIndex);
    }).catch(()=>{});
  }
}

syncUnlockAll();
unlockAll?.addEventListener("click",unlockAllWorks);
unlockChoiceClose?.addEventListener("click",closeUnlockChoice);
unlockChoice?.addEventListener("click",e=>{
  if(e.target===unlockChoice) closeUnlockChoice();
});
unlockChoice?.querySelector(".unlock-choice-panel")?.addEventListener("click",e=>e.stopPropagation());
unlockChoiceSingle?.addEventListener("click",()=>{
  const index=unlockChoiceIndex;
  closeUnlockChoice();
  if(index===null) return;
  unlockWork(index);
});
unlockChoiceAll?.addEventListener("click",()=>{
  closeUnlockChoice();
  unlockAllWorks();
});
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape" || !unlockChoice || unlockChoice.hidden) return;
  e.preventDefault();
  closeUnlockChoice();
});
archiveClose.addEventListener("click",()=>archiveModal.close());
archiveUnlock.addEventListener("click",e=>{
  if(activeIndex===null) return;
  requestSingleUnlock(activeIndex,e.currentTarget);
  if(!unlockChoice || unlockChoice.hidden){
    requestAnimationFrame(()=>archiveClose.focus({preventScroll:true}));
  }
});
archiveModal.addEventListener("click",e=>{
  if(e.target===archiveModal) archiveModal.close();
});
archiveModal.addEventListener("keydown",e=>{
  if(e.key!=="Escape") return;
  e.preventDefault();
  archiveModal.close();
});
archiveModal.addEventListener("close",()=>{
  document.body.classList.remove("modal-open");
  archiveToast.classList.remove("show");
  const opener=modalOpener;
  activeWork=null;
  activeIndex=null;
  modalOpener=null;
  archiveImage.removeAttribute("src");
  archiveImage.alt="";
  archiveImage.hidden=true;
  archiveVisual.classList.remove("is-locked","is-loading","is-load-error");
  archiveVisual.removeAttribute("aria-busy");
  archivePrivacy.hidden=true;
  archiveUnlock.hidden=false;
  archiveUnlock.disabled=false;
  archiveSetting.textContent="";
  archiveSetting.hidden=false;
  archiveSetting.removeAttribute("aria-hidden");
  archiveSettingPrivacy.hidden=true;
  archiveSettingPrivacy.setAttribute("aria-hidden","true");
  archiveSettingPrivacy.setAttribute("inert","");
  downloadCard.disabled=false;
  downloadCard.title="";
  opener?.focus();
});

downloadCard.addEventListener("click",()=>{
  if(!activeWork) return;
  downloadCharacterCard(activeWork,activeIndex);
});

let flipGuardUntil=0;
function setCardFlipped(card,flipped){
  const now=performance.now();
  // Ignore rapid double-taps that would bounce face mid-animation.
  if(now<flipGuardUntil && card.classList.contains("flipped")===flipped) return;
  flipGuardUntil=now+160;
  const index=Number(card.dataset.index);
  if(flipped){
    ensureCardBackContent(index);
    // Prefetch long-form details so archive text is ready right after flip.
    if(!workDetailsReady(works[index])) ensureWorkDetailsForActive().catch(()=>{});
  }
  const flipButton=card.querySelector(".card-flip");
  const back=card.querySelector(".back");
  const returnButton=card.querySelector(".back-return");
  const faceAction=card.querySelector(".privacy-unlock");
  if(!flipButton || !back) return;
  card.classList.toggle("flipped",flipped);
  flipButton.toggleAttribute("inert",flipped);
  flipButton.setAttribute("aria-hidden",String(flipped));
  flipButton.setAttribute("aria-expanded",String(flipped));
  back.toggleAttribute("inert",!flipped);
  back.setAttribute("aria-hidden",String(!flipped));
  if(faceAction){
    faceAction.toggleAttribute("inert",flipped);
    faceAction.setAttribute("aria-hidden",String(flipped));
  }
  requestAnimationFrame(()=>{
    const target=flipped ? returnButton : flipButton;
    target?.focus({preventScroll:true});
  });
}

let cardDelegationBound=false;
let privacySyncToken=0;

function syncCardPrivacyRange(start,end,{queueIfNear=true}={}){
  const last=Math.min(end,works.length);
  for(let index=start;index<last;index++){
    syncCardPrivacy(index,{queueIfNear});
    syncCardSettingPrivacy(index);
  }
}

function scheduleCardPrivacySync(){
  const token=++privacySyncToken;
  const total=works.length;
  if(!total) return;
  // Immediate pass for near-viewport faces only — avoids 64× layout thrash on author switch.
  const near=[];
  for(let index=0;index<total;index++){
    const parts=getCardPreviewParts(index);
    if(parts?.front && isPreviewNearViewport(parts.front)) near.push(index);
  }
  near.forEach(index=>{
    syncCardPrivacy(index,{queueIfNear:true});
    syncCardSettingPrivacy(index);
  });
  // Remaining cards in idle chunks so first paint/scroll stay responsive.
  let cursor=0;
  const step=12;
  const pump=()=>{
    if(token!==privacySyncToken) return;
    const end=Math.min(cursor+step,total);
    for(let index=cursor;index<end;index++){
      if(near.includes(index)) continue;
      syncCardPrivacy(index,{queueIfNear:false});
      syncCardSettingPrivacy(index);
    }
    cursor=end;
    if(cursor<total){
      if(typeof requestIdleCallback==="function"){
        requestIdleCallback(pump,{timeout:180});
      }else{
        setTimeout(pump,0);
      }
    }
  };
  if(typeof requestIdleCallback==="function"){
    requestIdleCallback(pump,{timeout:120});
  }else{
    setTimeout(pump,0);
  }
}

function bindCardInteractions(){
  scheduleCardPrivacySync();

  if(cardDelegationBound) return;
  cardDelegationBound=true;

  gallery.addEventListener("click",e=>{
    // Firefox may target a Text node; climb to Element before closest().
    const hit=e.target instanceof Element ? e.target : e.target?.parentElement;
    if(!(hit instanceof Element) || !gallery.contains(hit)) return;

    const faceAction=hit.closest(".privacy-unlock");
    if(faceAction && gallery.contains(faceAction)){
      e.stopPropagation();
      const card=faceAction.closest(".card");
      const index=Number(card?.dataset.index);
      const work=works[index];
      if(!card || !work) return;
      const mode=faceAction.dataset.mode;
      const flipButton=card.querySelector(".card-flip");
      if(mode==="unlock" || mode==="retry"){
        requestSingleUnlock(index,faceAction);
        if(!unlockChoice || unlockChoice.hidden){
          requestAnimationFrame(()=>flipButton?.focus({preventScroll:true}));
        }
        return;
      }
      if(mode==="save") downloadCharacterCard(work,index);
      return;
    }

    const expandButton=hit.closest(".back-expand");
    if(expandButton && gallery.contains(expandButton)){
      e.preventDefault();
      const card=expandButton.closest(".card");
      const index=Number(card?.dataset.index);
      if(!Number.isInteger(index)) return;
      // Ensure face is flipped so controls stay interactive if expand was forced early.
      if(card && !card.classList.contains("flipped")) setCardFlipped(card,true);
      ensureCardBackContent(index);
      openArchive(index,expandButton);
      return;
    }

    const returnButton=hit.closest(".back-return");
    if(returnButton && gallery.contains(returnButton)){
      const card=returnButton.closest(".card");
      if(card) setCardFlipped(card,false);
      return;
    }

    const flipButton=hit.closest(".card-flip");
    if(flipButton && gallery.contains(flipButton)){
      const card=flipButton.closest(".card");
      if(card) setCardFlipped(card,true);
    }
  });
}

function observeCardPreviews(){
  if(previewObserver){
    previewObserver.disconnect();
    previewObserver=null;
  }
  const images=[...gallery.querySelectorAll(".card .front img")];
  if("IntersectionObserver" in window){
    previewObserver=new IntersectionObserver(entries=>{
      entries.forEach(entry=>{
        if(!entry.isIntersecting) return;
        const card=entry.target.closest(".card");
        const index=Number(card?.dataset.index);
        if(Number.isInteger(index) && !isWorkLocked(index)) queuePreviewLoad(index);
      });
    },{rootMargin:"160px 0px",threshold:.01});
    images.forEach(image=>previewObserver.observe(image));
    return;
  }

  let scanFrame=0;
  const scan=()=>{
    scanFrame=0;
    queueUnlockedPreviewsNearViewport();
  };
  const scheduleScan=()=>{
    if(!scanFrame) scanFrame=requestAnimationFrame(scan);
  };
  window.addEventListener("scroll",scheduleScan,{passive:true});
  window.addEventListener("resize",scheduleScan,{passive:true});
  scheduleScan();
}

renderActiveAuthor({announce:false,scrollToStart:false});
// Warm non-default catalogs + long-form details after first paint.
if(typeof scheduleIdleCatalogPrefetch==="function"){
  scheduleIdleCatalogPrefetch();
}else if(typeof ensureWorkDetails==="function"){
  const warm=()=>ensureWorkDetails(activeAuthor).catch(()=>{});
  if(typeof requestIdleCallback==="function") requestIdleCallback(warm,{timeout:1800});
  else setTimeout(warm,600);
}
authorSwitch?.addEventListener("click",switchToNextAuthor);
window.addEventListener("online",()=>{
  getFailedPreviewIndexes().forEach(index=>{
    const parts=getCardPreviewParts(index);
    if(parts && isPreviewNearViewport(parts.front)) queuePreviewLoad(index,{force:true});
  });
});
// Drop failed PNG URL cache on online recovery so retries can proceed.
window.addEventListener("online",()=>{
  try{pngFailCache.clear();}catch(_){}
});

const glowPointerMedia=window.matchMedia(
  "(hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)"
);
if(glowPointerMedia.matches){
  let glowFrame=0;
  let glowX=innerWidth*.68;
  let glowY=innerHeight*.22;
  window.addEventListener("pointermove",e=>{
    glowX=e.clientX;
    glowY=e.clientY;
    if(glowFrame) return;
    glowFrame=requestAnimationFrame(()=>{
      document.body.style.setProperty("--mx",`${glowX}px`);
      document.body.style.setProperty("--my",`${glowY}px`);
      glowFrame=0;
    });
  },{passive:true});
}
