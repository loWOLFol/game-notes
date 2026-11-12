import {validateBoard,equal,mergeChanges,GitHubStore} from './core.mjs';
const $=id=>document.getElementById(id),clone=x=>JSON.parse(JSON.stringify(x));
// Keep the original storage key: existing notes and unsent edits survive this redesign.
const key=`game-notes:v1:${location.pathname.replace(/index\.html$/,'')}`;
let board={version:1,cards:[]},pending={},config={},store=null,busy=false,conflicts=[],lastSync=null,toastTimer;
function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5500);}
function persist(){try{localStorage.setItem(key,JSON.stringify({board,pending,config}));return true;}catch{toast('Не удалось сохранить в браузере. Скачайте копию, чтобы не потерять записи.');return false;}}
function hasPending(){return Object.keys(pending).length>0;}
function changed(id,value){
  const previous=board.cards.find(c=>c.id===id)??null,base=Object.hasOwn(pending,id)?pending[id].base:clone(previous);
  if(equal(base,value))delete pending[id];else pending[id]={base,value};
  const index=board.cards.findIndex(c=>c.id===id);
  if(value){if(index<0)board.cards.push(value);else board.cards[index]=value;}else if(index>=0)board.cards.splice(index,1);
  persist();syncUI();
}
function syncUI(){
  const n=Object.keys(pending).length;
  $('sync-message').textContent=busy?'Синхронизация…':store?(n?`Сохранено в браузере · есть неотправленные правки (${n})`:`Все изменения отправлены · ${config.repo}${lastSync?' · '+lastSync.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):''}`):(config.repo?'Сохранено в браузере · введите токен для общей работы':'Текст сохраняется в браузере. Для работы вдвоём подключите GitHub.');
  $('sync').textContent=store?(n?'Отправить изменения':'Обновить'):'Подключить GitHub';$('sync').disabled=busy;$('add').disabled=busy;$('settings').disabled=busy;
  for(const el of document.querySelectorAll('.note input,.note textarea'))el.readOnly=busy;
  for(const el of document.querySelectorAll('.delete-note'))el.disabled=busy;
}
function resize(el){el.style.height='auto';el.style.height=`${Math.max(el.scrollHeight,90)}px`;}
function render(){
  $('notes').replaceChildren();$('empty').hidden=board.cards.length>0;
  for(const c of board.cards){
    const article=node('article','note');article.dataset.id=c.id;
    const title=node('input','note-title');title.value=c.name;title.maxLength=120;title.placeholder='Название записи';title.setAttribute('aria-label','Название записи');
    const text=node('textarea','note-text');text.value=c.text;text.maxLength=50000;text.rows=3;text.placeholder='Напишите идею, описание башни или вопрос…';text.setAttribute('aria-label',`Текст записи: ${c.name}`);
    const footer=node('div','note-footer'),meta=node('span','',c.author||'Участник'),del=node('button','delete-note','Удалить');del.setAttribute('aria-label',`Удалить запись: ${c.name}`);footer.append(meta,del);
    const edit=()=>{if(busy)return;const previous=board.cards.find(x=>x.id===c.id);changed(c.id,{...previous,name:title.value.trim()||'Без названия',text:text.value,author:config.author||'Участник',updatedAt:new Date().toISOString()});meta.textContent=`${config.author||'Участник'} · сохранено`;};
    title.oninput=edit;title.onblur=()=>{if(!title.value.trim())title.value='Без названия';};text.oninput=()=>{resize(text);edit();};
    del.onclick=()=>{if(!busy&&confirm('Удалить эту запись?')){changed(c.id,null);render();}};
    article.append(title,text,footer);$('notes').append(article);resize(text);
  }
  syncUI();
}
function openSettings(){
  $('author').value=config.author??'';$('repo').value=config.repo??'';$('branch').value=config.branch??'main';$('token').value='';$('token').placeholder=store?'Пусто — использовать текущий токен':'Личный GitHub-токен';$('token').required=!store;$('settings-error').textContent='';$('settings-dialog').showModal();
}
async function pull(){
  if(!store||busy||hasPending()||document.activeElement?.closest('.note')||document.querySelector('dialog[open]'))return false;
  busy=true;syncUI();
  try{const remote=await store.read();board=remote.board;lastSync=new Date();persist();render();return true;}
  finally{busy=false;syncUI();}
}
function showConflicts(items){
  conflicts=items;$('conflicts-list').replaceChildren();
  for(const [i,c] of items.entries()){
    const container=node('section','conflict');container.append(node('h3','',c.mine?.name??c.theirs?.name??'Удалённая запись'));const options=node('div','conflict-options');
    for(const [choice,title,value] of [['theirs','Версия на GitHub',c.theirs],['mine','Моя версия',c.mine]]){
      const label=node('label','version'),radio=node('input');radio.type='radio';radio.name=`conflict-${i}`;radio.value=choice;radio.checked=choice==='theirs';
      label.append(radio,document.createTextNode(' '+title),node('pre','',value?`${value.name}\nАвтор: ${value.author}\n\n${value.text}`:'Запись удалена'));options.append(label);
    }
    container.append(options);$('conflicts-list').append(container);
  }
  $('conflicts-dialog').showModal();
}
async function sync(){
  if(!store){openSettings();return;}if(busy)return;
  if(!hasPending()){try{if(await pull())toast('Записи обновлены.');}catch(e){toast(e.message);}return;}
  busy=true;syncUI();
  try{
    for(let attempt=0;attempt<3;attempt++){
      const remote=await store.read(),merged=mergeChanges(remote.board,pending);
      if(merged.conflicts.length){showConflicts(merged.conflicts);return;}
      try{await store.write(merged.board,remote.sha,config.author);board=merged.board;pending={};lastSync=new Date();persist();render();toast('Изменения отправлены.');return;}
      catch(e){if(e.status===409&&attempt<2)continue;throw e;}
    }
  }catch(e){toast(e.message+' Локальные правки сохранены.');}
  finally{busy=false;syncUI();}
}
$('add').onclick=()=>{
  if(busy)return;const id=crypto.randomUUID();changed(id,{id,name:'Новая запись',category:'ideas',status:'idea',text:'',author:config.author||'Участник',updatedAt:new Date().toISOString()});render();
  const title=$('notes').lastElementChild.querySelector('input');title.focus();title.select();
};
$('settings').onclick=openSettings;$('sync').onclick=sync;
$('settings-form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  const next={repo:$('repo').value.trim(),branch:$('branch').value.trim(),author:$('author').value.trim()},token=$('token').value.trim()||(store?.token??'');
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(next.repo)||!next.branch||!next.author){$('settings-error').textContent='Укажите имя, репозиторий owner/repo и ветку.';return;}
  const switching=config.repo&&(config.repo!==next.repo||config.branch!==next.branch);
  if(switching&&hasPending()&&!confirm('При смене репозитория локальные правки будут заменены. Сначала скачайте копию. Переключить репозиторий?'))return;
  const candidate=new GitHubStore({...next,token});busy=true;syncUI();$('connect-submit').disabled=true;$('settings-error').textContent='Проверяем подключение…';
  try{
    const remote=await candidate.read();if(switching)pending={};
    const merged=mergeChanges(remote.board,pending);board=merged.board;
    for(const c of merged.conflicts){board.cards=board.cards.filter(x=>x.id!==c.id);if(c.mine)board.cards.push(c.mine);}
    store=candidate;config=next;lastSync=new Date();persist();render();$('token').value='';$('settings-dialog').close();toast('GitHub подключён.');
  }catch(error){$('settings-error').textContent=error.message;}
  finally{busy=false;$('connect-submit').disabled=false;syncUI();}
};
$('disconnect').onclick=()=>{if(busy)return;store=null;$('token').value='';$('settings-dialog').close();syncUI();toast('Отключено. Текст остался в браузере.');};
$('settings-close').onclick=()=>{if(!busy){$('token').value='';$('settings-dialog').close();}};
$('settings-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();else $('token').value='';});$('settings-dialog').addEventListener('close',()=>$('token').value='');
$('resolve').onclick=()=>{
  for(const [i,c] of conflicts.entries()){
    const choice=document.querySelector(`input[name="conflict-${i}"]:checked`).value;
    if(choice==='theirs'){delete pending[c.id];board.cards=board.cards.filter(x=>x.id!==c.id);if(c.theirs)board.cards.push(c.theirs);}else pending[c.id]={base:c.theirs,value:c.mine};
  }
  persist();render();$('conflicts-dialog').close();toast('Выбор сохранён. Отправьте изменения ещё раз.');
};
$('conflicts-close').onclick=()=>$('conflicts-dialog').close();
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(board,null,2)+'\n'],{type:'application/json'}));const a=node('a');a.href=url;a.download=`game-notes-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(busy)throw new Error('Дождитесь синхронизации.');if(file.size>900000)throw new Error('Файл должен быть меньше 900 КБ.');
    const imported=validateBoard(JSON.parse(await file.text()));if(busy)throw new Error('Дождитесь синхронизации.');
    if(!confirm(`Загрузить ${imported.cards.length} записей? Совпадающие по ID записи будут заменены, остальные сохранятся.`))return;
    for(const c of imported.cards)if(!equal(board.cards.find(x=>x.id===c.id),c))changed(c.id,c);render();toast('Копия загружена в браузер.');
  }catch(error){toast(error.message);}finally{e.target.value='';}
};
document.querySelector('.import-label').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('import').click();}};
window.addEventListener('storage',e=>{if(e.key===key)toast('Другая вкладка изменила записи. Работайте в одной вкладке, чтобы не потерять локальные правки.');});
window.addEventListener('resize',()=>{for(const el of document.querySelectorAll('.note-text'))resize(el);});
async function init(){
  try{
    const cache=JSON.parse(localStorage.getItem(key)||'null');
    if(cache){board=validateBoard(cache.board);config=cache.config||{};pending=cache.pending||{};
      for(const [id,op] of Object.entries(pending)){if(!op||!Object.hasOwn(op,'base')||!Object.hasOwn(op,'value'))throw new Error('Повреждён черновик');for(const value of [op.base,op.value])if(value){validateBoard({version:1,cards:[value]});if(value.id!==id)throw new Error('Неверный ID черновика');}}
    }else{const result=await fetch('./data.json',{cache:'no-store'});if(!result.ok)throw new Error('Не найден data.json');board=validateBoard(await result.json());}
    if(!config.repo&&location.hostname.endsWith('.github.io')){const repo=location.pathname.split('/').filter(Boolean)[0];if(repo)config.repo=location.hostname.slice(0,-10)+'/'+repo;config.branch='main';}
    persist();render();
  }catch(error){render();toast('Не удалось загрузить записи: '+error.message+'. Можно загрузить копию JSON.');}
}
setInterval(()=>{if(document.visibilityState==='visible')pull().catch(error=>toast(error.message));},45000);
await init();
