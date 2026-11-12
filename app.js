import {validateBoard,equal,mergeChanges} from './core.mjs';
const $=id=>document.getElementById(id),clone=x=>JSON.parse(JSON.stringify(x));
let room=new URLSearchParams(location.hash.slice(1)).get('room')||'';
let key=`game-notes:room:${room||'draft'}`;
let board={version:1,cards:[]},pending={},busy=false,conflicts=[],lastSync=null,toastTimer,saveTimer,ready=false,paused=false;
let author='Участник';try{author=localStorage.getItem('game-notes:author')||author;}catch{}
function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
function persist(){try{localStorage.setItem(key,JSON.stringify({board,pending}));return true;}catch{toast('Не удалось сохранить в браузере. Скачайте копию записей.');return false;}}
function hasPending(){return Object.keys(pending).length>0;}
async function api(method,payload,token=room){
  const response=await fetch(`${window.NOTES_API_ORIGIN||''}/api/room`,{method,cache:'no-store',headers:{Authorization:`Bearer ${token}`,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(20000)});
  let data;try{data=await response.json();}catch{throw new Error('Сервер не ответил. Проверьте соединение.');}
  if(!response.ok){const e=new Error(data.error||'Ошибка соединения');e.status=response.status;throw e;}
  if(data.board)data.board=validateBoard(data.board);return data;
}
function syncUI(){
  $('sync-message').textContent=!ready?'Загружаем записи…':!room?'Текст пока сохранён в браузере. Создайте общий блокнот и отправьте ссылку другу.':paused?'Вы оба изменили запись. Нужно выбрать версию.':busy?'Сохраняем…':hasPending()?'Есть локальные правки · ждут отправки':'Сохранено в общем блокноте'+(lastSync?' · '+lastSync.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'');
  $('sync').textContent=!room?'Создать общий блокнот':paused?'Сравнить версии':hasPending()?'Сохранить сейчас':'Обновить';$('sync').disabled=busy||!ready;$('share').disabled=busy||!ready;$('add').disabled=!ready;
}
function schedule(){clearTimeout(saveTimer);if(room&&ready&&!paused)saveTimer=setTimeout(()=>sync(),3000);}
function changed(id,value){
  const previous=board.cards.find(c=>c.id===id)??null,base=Object.hasOwn(pending,id)?pending[id].base:clone(previous);
  if(equal(base,value))delete pending[id];else pending[id]={base,value};
  const index=board.cards.findIndex(c=>c.id===id);
  if(value){if(index<0)board.cards.push(value);else board.cards[index]=value;}else if(index>=0)board.cards.splice(index,1);
  persist();syncUI();schedule();
}
function resize(el){el.style.height='auto';el.style.height=`${Math.max(el.scrollHeight,90)}px`;}
function render(){
  const active=document.activeElement,activeNote=active?.closest('.note'),focusId=activeNote?.dataset.id,field=active?.classList.contains('note-title')?'input':'textarea';
  const selection=focusId?[active.selectionStart,active.selectionEnd]:null;
  $('notes').replaceChildren();$('empty').hidden=board.cards.length>0;
  for(const c of board.cards){
    const article=node('article','note');article.dataset.id=c.id;
    const title=node('input','note-title');title.value=c.name;title.maxLength=120;title.placeholder='Название записи';title.setAttribute('aria-label','Название записи');
    const text=node('textarea','note-text');text.value=c.text;text.maxLength=50000;text.rows=3;text.placeholder='Напишите идею, описание башни или вопрос…';text.setAttribute('aria-label',`Текст записи: ${c.name}`);
    const footer=node('div','note-footer'),meta=node('span','',c.author||'Участник'),del=node('button','delete-note','Удалить');del.setAttribute('aria-label',`Удалить запись: ${c.name}`);footer.append(meta,del);
    const edit=()=>{const previous=board.cards.find(x=>x.id===c.id);if(!previous)return;changed(c.id,{...previous,name:title.value.trim()||'Без названия',text:text.value,author,updatedAt:new Date().toISOString()});meta.textContent=author;};
    title.oninput=edit;title.onblur=()=>{if(!title.value.trim())title.value='Без названия';};text.oninput=()=>{resize(text);edit();};
    del.onclick=()=>{if(confirm('Удалить эту запись у вас обоих?')){changed(c.id,null);render();}};
    article.append(title,text,footer);$('notes').append(article);resize(text);
    if(c.id===focusId){const el=field==='input'?title:text;el.focus({preventScroll:true});if(selection)el.setSelectionRange(...selection);}
  }
  syncUI();
}
async function createRoom(){
  if(busy||!ready)return;busy=true;syncUI();
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
  try{const result=await api('POST',{board},token);room=token;location.hash=new URLSearchParams({room}).toString();key=`game-notes:room:${room}`;board=result.board;pending={};lastSync=new Date();persist();render();openShare();toast('Блокнот создан. Отправьте эту ссылку другу.');}
  catch(e){toast(e.message+' Записи остались в браузере.');}finally{busy=false;syncUI();}
}
function openShare(){if(!room){createRoom();return;}$('author').value=author==='Участник'?'':author;$('room-link').value=location.href;$('share-dialog').showModal();}
function showConflicts(items){
  conflicts=items;paused=true;$('conflicts-list').replaceChildren();
  for(const [i,c] of items.entries()){
    const container=node('section','conflict');container.append(node('h3','',c.mine?.name??c.theirs?.name??'Удалённая запись'));const options=node('div','conflict-options');
    for(const [choice,title,value] of [['theirs','Общая версия',c.theirs],['mine','Моя версия',c.mine]]){
      const label=node('label','version'),radio=node('input');radio.type='radio';radio.name=`conflict-${i}`;radio.value=choice;radio.checked=choice==='theirs';label.append(radio,document.createTextNode(' '+title),node('pre','',value?`${value.name}\nАвтор: ${value.author}\n\n${value.text}`:'Запись удалена'));options.append(label);
    }
    container.append(options);$('conflicts-list').append(container);
  }
  $('conflicts-dialog').showModal();syncUI();
}
async function sync({background=false}={}){
  if(!room){if(!background)await createRoom();return;}if(!ready||busy)return;if(paused){if(!background)showConflicts(conflicts);return;}
  // Background reads don't replace a note while somebody is writing in it.
  if(background&&!hasPending()&&(document.activeElement?.closest('.note')||document.querySelector('dialog[open]')))return;
  const sent=clone(pending);busy=true;syncUI();
  try{
    for(let attempt=0;attempt<4;attempt++){
      const remote=await api('GET');
      if(!Object.keys(sent).length){if(!hasPending()){board=remote.board;persist();render();}lastSync=new Date();return;}
      const merged=mergeChanges(remote.board,sent);
      if(merged.conflicts.length){showConflicts(merged.conflicts.map(c=>({...c,mine:Object.hasOwn(pending,c.id)?pending[c.id].value:c.mine})));return;}
      try{
        await api('PUT',{board:merged.board,revision:remote.revision});
        for(const [id,op] of Object.entries(sent)){
          const desired=board.cards.find(c=>c.id===id)??null;
          if(equal(desired,op.value))delete pending[id];
          else pending[id]={base:op.value,value:desired};
        }
        board=mergeChanges(merged.board,pending).board;
        // Keep edits made while a request was in flight visible, including conflicts.
        for(const [id,op] of Object.entries(pending)){board.cards=board.cards.filter(c=>c.id!==id);if(op.value)board.cards.push(op.value);}
        lastSync=new Date();persist();render();return;
      }catch(e){if(e.status===409&&attempt<3)continue;throw e;}
    }
  }catch(e){toast(e.message+' Локальные правки сохранены.');}
  finally{busy=false;syncUI();if(hasPending()&&!paused&&JSON.stringify(sent)!==JSON.stringify(pending))schedule();}
}
$('add').onclick=()=>{if(!ready)return;const id=crypto.randomUUID();changed(id,{id,name:'Новая запись',category:'ideas',status:'idea',text:'',author,updatedAt:new Date().toISOString()});render();const title=$('notes').lastElementChild.querySelector('input');title.focus();title.select();};
$('share').onclick=openShare;$('sync').onclick=()=>sync();$('share-close').onclick=()=>$('share-dialog').close();
$('copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);toast('Ссылка скопирована.');}catch{$('room-link').focus();$('room-link').select();toast('Скопируйте выделенную ссылку.');}};
$('author').oninput=()=>{author=$('author').value.trim()||'Участник';try{localStorage.setItem('game-notes:author',author);}catch{}};
$('resolve').onclick=()=>{
  for(const [i,c] of conflicts.entries()){
    const choice=document.querySelector(`input[name="conflict-${i}"]:checked`).value;
    if(choice==='theirs'){delete pending[c.id];board.cards=board.cards.filter(x=>x.id!==c.id);if(c.theirs)board.cards.push(c.theirs);}else pending[c.id]={base:c.theirs,value:Object.hasOwn(pending,c.id)?pending[c.id].value:c.mine};
  }
  paused=false;conflicts=[];persist();render();$('conflicts-dialog').close();sync();
};
$('conflicts-close').onclick=()=>$('conflicts-dialog').close();
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(board,null,2)+'\n'],{type:'application/json'}));const a=node('a');a.href=url;a.download=`game-notes-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>900000)throw new Error('Файл должен быть меньше 900 КБ.');const imported=validateBoard(JSON.parse(await file.text()));if(!confirm(`Загрузить ${imported.cards.length} записей? Совпадающие по ID заменятся. Изменения будут доступны другу.`))return;for(const c of imported.cards)if(!equal(board.cards.find(x=>x.id===c.id),c))changed(c.id,c);render();}catch(e){toast(e.message);}finally{e.target.value='';}};
document.querySelector('.import-label').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('import').click();}};
window.addEventListener('storage',e=>{if(e.key===key)toast('Другая вкладка изменила записи. Для одного блокнота используйте одну вкладку на устройстве.');});
window.addEventListener('resize',()=>{for(const el of document.querySelectorAll('.note-text'))resize(el);});
window.addEventListener('online',()=>sync({background:true}));
window.addEventListener('hashchange',()=>{const next=new URLSearchParams(location.hash.slice(1)).get('room')||'';if(next!==room)location.reload();});
window.addEventListener('beforeunload',e=>{if(room&&hasPending()){e.preventDefault();e.returnValue='';}});
async function init(){
  try{
    if(room&&!/^[a-f0-9]{64}$/.test(room))throw new Error('Ссылка неполная или повреждена. Попросите друга скопировать её целиком.');
    let cache=null;try{cache=JSON.parse(localStorage.getItem(key)||'null');}catch{}
    if(cache){board=validateBoard(cache.board);pending=cache.pending||{};
      for(const [id,op] of Object.entries(pending)){if(!op||!Object.hasOwn(op,'base')||!Object.hasOwn(op,'value'))throw new Error('Повреждён черновик');for(const value of [op.base,op.value])if(value){validateBoard({version:1,cards:[value]});if(value.id!==id)throw new Error('Неверный ID черновика');}}
    }
    if(room){
      try{const remote=await api('GET');const merged=mergeChanges(remote.board,pending);board=merged.board;
        for(const c of merged.conflicts){board.cards=board.cards.filter(x=>x.id!==c.id);if(c.mine)board.cards.push(c.mine);}
        if(merged.conflicts.length)showConflicts(merged.conflicts);lastSync=new Date();
      }catch(e){if(!cache)throw e;toast(e.message+' Показан локальный черновик.');}
    }else if(!cache){const result=await fetch('./data.json');board=validateBoard(await result.json());}
    ready=true;persist();render();if(hasPending())schedule();
  }catch(e){render();$('sync-message').textContent=e.message;toast(e.message);}
}
setInterval(()=>{if(document.visibilityState==='visible')sync({background:true});},10000);
await init();
