import {validateBoard,equal,mergeChanges,IMAGE_LIMITS,validatePhoto} from './core.mjs';
import {preparePhoto} from './photos.mjs';
const $=id=>document.getElementById(id),clone=x=>JSON.parse(JSON.stringify(x));
let room=new URLSearchParams(location.hash.slice(1)).get('room')||'';
let key=`game-notes:room:${room||'draft'}`;
let board={version:1,cards:[]},pending={},busy=false,conflicts=[],lastSync=null,toastTimer,saveTimer,ready=false,paused=false;
const photoCache=new Map(),uploading=new Set();
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
function resize(el){
  // Measuring an auto height must not temporarily collapse the document and clamp scrollY.
  const x=window.scrollX,y=window.scrollY,innerScroll=el.scrollTop;
  el.style.height='auto';el.style.height=`${Math.max(el.scrollHeight,90)}px`;
  el.scrollTop=innerScroll;
  if(window.scrollX!==x||window.scrollY!==y)window.scrollTo({left:x,top:y,behavior:'instant'});
}
async function fetchPhoto(photo){
  if(photoCache.has(photo.id))return photoCache.get(photo.id);
  const promise=(async()=>{const response=await fetch(`${window.NOTES_API_ORIGIN||''}/api/photo?id=${photo.id}`,{headers:{Authorization:`Bearer ${room}`},signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Не удалось загрузить фото.');const blob=await response.blob();return {url:URL.createObjectURL(blob),blob};})();
  photoCache.set(photo.id,promise);
  try{return await promise;}catch(e){photoCache.delete(photo.id);throw e;}
}
function drawPhotos(grid,images=[],removable=true,noteId=null){
  const existing=new Map([...grid.children].map(el=>[el.dataset.id,el]));const keep=new Set(images.map(p=>p.id));
  for(const el of [...grid.children])if(!keep.has(el.dataset.id))el.remove();
  for(const photo of images){
    if(existing.has(photo.id))continue;
    const fig=node('figure','photo-card');fig.dataset.id=photo.id;
    const link=node('a','photo-open'),image=node('img');image.alt=photo.name||'Фото к записи';image.width=photo.width;image.height=photo.height;link.target='_blank';link.rel='noopener';link.append(image);
    const caption=node('figcaption','photo-caption');caption.append(node('span','',photo.name));
    if(removable){const remove=node('button','remove-photo','Убрать');remove.setAttribute('aria-label',`Убрать фото: ${photo.name}`);remove.onclick=()=>{if(!confirm('Убрать фото из этой записи?'))return;const card=board.cards.find(c=>c.id===noteId);if(card){changed(card.id,{...card,images:(card.images||[]).filter(p=>p.id!==photo.id),author,updatedAt:new Date().toISOString()});render();}};caption.append(remove);}
    fig.append(link,caption);grid.append(fig);
    fetchPhoto(photo).then(result=>{if(!fig.isConnected)return;image.src=result.url;link.href=result.url;}).catch(()=>{if(fig.isConnected)fig.prepend(node('p','photo-error','Фото пока недоступно. Обновите страницу после восстановления связи.'));});
  }
}
async function uploadPhotos(id,files){
  if(uploading.has(id))return;let card=board.cards.find(c=>c.id===id);if(!card)return;
  if(files.length+(card.images?.length||0)>IMAGE_LIMITS.maxCount){toast('В одной записи может быть до 8 фотографий.');return;}
  uploading.add(id);render();
  try{
    if(!room){await createRoom({showDialog:false});if(!room)throw new Error('Не удалось создать общий блокнот.');}
    for(const file of files){
      const prepared=await preparePhoto(file);
      const response=await fetch(`${window.NOTES_API_ORIGIN||''}/api/photo`,{method:'POST',headers:{Authorization:`Bearer ${room}`,'Content-Type':prepared.blob.type},body:prepared.blob,signal:AbortSignal.timeout(30000)});
      let data;try{data=await response.json();}catch{throw new Error('Сервер не ответил при загрузке фото.');}if(!response.ok)throw new Error(data.error||'Не удалось загрузить фото.');
      const photo=validatePhoto({...data.photo,name:prepared.name,width:prepared.width,height:prepared.height});
      photoCache.set(photo.id,Promise.resolve({blob:prepared.blob,url:URL.createObjectURL(prepared.blob)}));
      card=board.cards.find(c=>c.id===id);if(!card)throw new Error('Запись уже удалена.');if((card.images?.length||0)>=IMAGE_LIMITS.maxCount)throw new Error('В записи уже 8 фотографий.');
      changed(id,{...card,images:[...(card.images||[]),photo],author,updatedAt:new Date().toISOString()});render();
    }
  }catch(e){toast(e.message);}finally{uploading.delete(id);render();}
}
function makeNote(c){
  const article=node('article','note');article.dataset.id=c.id;
  const title=node('input','note-title');title.maxLength=120;title.placeholder='Название записи';title.setAttribute('aria-label','Название записи');
  const text=node('textarea','note-text');text.maxLength=50000;text.rows=3;text.placeholder='Напишите идею, описание башни или вопрос…';
  const footer=node('div','note-footer'),meta=node('span',''),del=node('button','delete-note','Удалить');footer.append(meta,del);
  const edit=()=>{const previous=board.cards.find(x=>x.id===c.id);if(!previous)return;changed(c.id,{...previous,name:title.value.trim()||'Без названия',text:text.value,author,updatedAt:new Date().toISOString()});meta.textContent=author;};
  title.oninput=edit;title.onblur=()=>{if(!title.value.trim())title.value='Без названия';};text.oninput=()=>{resize(text);edit();};
  del.onclick=()=>{if(confirm('Удалить эту запись у вас обоих?')){changed(c.id,null);render();}};
  const grid=node('div','photo-grid'),tools=node('div','photo-tools'),attach=node('button','attach-photo','＋ Фото'),hint=node('span','photo-hint','JPG, PNG, WebP · до 8 фото'),uploadStatus=node('span','photo-status');uploadStatus.setAttribute('role','status');
  const picker=node('input');picker.type='file';picker.accept='image/jpeg,image/png,image/webp';picker.multiple=true;picker.hidden=true;picker.setAttribute('aria-label','Прикрепить фото');
  attach.onclick=()=>picker.click();picker.onchange=()=>{const files=[...picker.files];picker.value='';uploadPhotos(c.id,files);};tools.append(attach,hint,uploadStatus,picker);
  article.append(title,text,grid,tools,footer);return article;
}
function render(){
  const container=$('notes'),x=window.scrollX,y=window.scrollY,active=document.activeElement;
  const selection=active?.matches('.note-title,.note-text')?{start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection,scrollTop:active.scrollTop}:null;
  const oldNotes=[...container.children];
  const anchor=y>0?oldNotes.find(el=>el.getBoundingClientRect().bottom>0):null;
  const anchorTop=anchor?.getBoundingClientRect().top;
  const existing=new Map(oldNotes.map(el=>[el.dataset.id,el]));
  const wanted=new Set(board.cards.map(c=>c.id));
  // Keep existing inputs in the DOM. A save should update text, not rebuild the page.
  for(const el of oldNotes)if(!wanted.has(el.dataset.id))el.remove();
  for(const [index,c] of board.cards.entries()){
    let article=existing.get(c.id),created=!article;
    if(created)article=makeNote(c);
    if(container.children[index]!==article)container.insertBefore(article,container.children[index]??null);
    const title=article.querySelector('.note-title'),text=article.querySelector('.note-text');
    if(title!==active&&title.value!==c.name)title.value=c.name;
    if(text!==active&&text.value!==c.text){text.value=c.text;resize(text);}
    else if(created)resize(text);
    text.setAttribute('aria-label',`Текст записи: ${c.name}`);
    article.querySelector('.delete-note').setAttribute('aria-label',`Удалить запись: ${c.name}`);
    article.querySelector('.note-footer span').textContent=c.author||'Участник';
    drawPhotos(article.querySelector('.photo-grid'),c.images||[],true,c.id);
    article.classList.toggle('uploading',uploading.has(c.id));article.querySelector('.attach-photo').disabled=uploading.has(c.id);article.querySelector('.photo-status').textContent=uploading.has(c.id)?'Загружаем фото…':'';
  }
  $('empty').hidden=board.cards.length>0;syncUI();
  // Reordering an existing element may blur it in some browsers. Restore only if necessary.
  if(selection&&active.isConnected&&document.activeElement!==active){
    active.focus({preventScroll:true});active.setSelectionRange(selection.start,selection.end,selection.direction);active.scrollTop=selection.scrollTop;
  }
  // Anchor to the same visible note even if another author's text above it grows.
  const targetY=anchor?.isConnected?y+anchor.getBoundingClientRect().top-anchorTop:y;
  if(window.scrollX!==x||window.scrollY!==targetY)window.scrollTo({left:x,top:targetY,behavior:'instant'});
}
async function createRoom({showDialog=true}={}){
  if(busy||!ready)return;busy=true;syncUI();
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
  try{const result=await api('POST',{board},token);room=token;location.hash=new URLSearchParams({room}).toString();key=`game-notes:room:${room}`;board=result.board;pending={};lastSync=new Date();persist();render();if(showDialog)openShare();toast('Блокнот создан. Отправьте эту ссылку другу.');}
  catch(e){toast(e.message+' Записи остались в браузере.');}finally{busy=false;syncUI();}
}
function openShare(){if(!room){createRoom();return;}$('author').value=author==='Участник'?'':author;$('room-link').value=location.href;$('share-dialog').showModal();}
function showConflicts(items){
  conflicts=items;paused=true;$('conflicts-list').replaceChildren();
  for(const [i,c] of items.entries()){
    const container=node('section','conflict');container.append(node('h3','',c.mine?.name??c.theirs?.name??'Удалённая запись'));const options=node('div','conflict-options');
    for(const [choice,title,value] of [['theirs','Общая версия',c.theirs],['mine','Моя версия',c.mine]]){
      const label=node('label','version'),radio=node('input');radio.type='radio';radio.name=`conflict-${i}`;radio.value=choice;radio.checked=choice==='theirs';label.append(radio,document.createTextNode(' '+title),node('pre','',value?`${value.name}\nАвтор: ${value.author}\nФото: ${value.images?.length||0}\n\n${value.text}`:'Запись удалена'));options.append(label);
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
        for(const [id,op] of Object.entries(pending)){const index=board.cards.findIndex(c=>c.id===id);if(op.value){if(index<0)board.cards.push(op.value);else board.cards[index]=op.value;}else if(index>=0)board.cards.splice(index,1);}
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
$('export').onclick=async()=>{
  const button=$('export');button.disabled=true;
  try{
    const snapshot=clone(board),photos=[];const seen=new Set();
    for(const card of snapshot.cards)for(const photo of card.images||[]){if(seen.has(photo.id))continue;seen.add(photo.id);const {blob}=await fetchPhoto(photo);const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});photos.push({id:photo.id,data});}
    const payload=photos.length?{format:'game-notes-backup',version:1,board:snapshot,photos}:snapshot;
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json'}));const a=node('a');a.href=url;a.download=`game-notes-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Копия записей и фотографий скачана.');
  }catch(e){toast('Не удалось скачать полную копию: '+e.message);}finally{button.disabled=false;}
};
$('import').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>50*1024*1024)throw new Error('Файл копии должен быть меньше 50 МБ.');const payload=JSON.parse(await file.text());const imported=validateBoard(payload.format==='game-notes-backup'?payload.board:payload);
    if(!confirm(`Загрузить ${imported.cards.length} записей? Совпадающие по ID заменятся. Изменения будут доступны другу.`))return;
    if(payload.format==='game-notes-backup'){
      if(!Array.isArray(payload.photos)||payload.photos.length>1000)throw new Error('Неверный список фото в копии.');
      if(!room){await createRoom({showDialog:false});if(!room)throw new Error('Не удалось создать блокнот.');}
      const mapping=new Map();
      for(const entry of payload.photos){if(typeof entry.data!=='string'||entry.data.length>3*1024*1024||!/^data:image\/(jpeg|png|webp);base64,/.test(entry.data))throw new Error('Неверная фотография в копии.');const blob=await(await fetch(entry.data)).blob();const response=await fetch(`${window.NOTES_API_ORIGIN||''}/api/photo`,{method:'POST',headers:{Authorization:`Bearer ${room}`,'Content-Type':blob.type},body:blob});const result=await response.json();if(!response.ok)throw new Error(result.error||'Не удалось восстановить фото.');mapping.set(entry.id,result.photo.id);}
      for(const card of imported.cards)if(card.images)card.images=card.images.map(photo=>{if(!mapping.has(photo.id))throw new Error('В копии отсутствует фотография.');return {...photo,id:mapping.get(photo.id)};});
    }
    for(const c of imported.cards)if(!equal(board.cards.find(x=>x.id===c.id),c))changed(c.id,c);render();
  }catch(e){toast(e.message);}finally{e.target.value='';}
};
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
