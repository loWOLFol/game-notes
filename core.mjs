export const CATEGORIES = {
  all: {name:'Все записи', icon:'▦', color:'#71845e', bg:'#edf2e6'},
  ideas: {name:'Идеи', icon:'✧', color:'#a58b45', bg:'#f7f1df'},
  towers: {name:'Башни и защитники', icon:'♜', color:'#6d8a63', bg:'#edf3e6'},
  enemies: {name:'Враги', icon:'♟', color:'#a87868', bg:'#f8ede6'},
  mechanics: {name:'Механики', icon:'⚙', color:'#6c87a1', bg:'#eaf1f7'},
  world: {name:'Мир и стиль', icon:'❋', color:'#9580a2', bg:'#f1edf6'}
};
export const STATUSES = {idea:'Идея', discuss:'Обсудить', accepted:'Принято'};
export function validateBoard(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.cards) || data.cards.length > 5000) throw new Error('Неверный формат: нужен JSON версии 1 со списком cards (до 5000 записей).');
  const seen = new Set();
  for (const c of data.cards) {
    if (!c || typeof c.id !== 'string' || !c.id || ['__proto__','constructor','prototype'].includes(c.id) || c.id.length > 150 || seen.has(c.id) || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 120 || typeof c.text !== 'string' || c.text.length > 50000 || !Object.hasOwn(CATEGORIES,c.category) || c.category === 'all' || !Object.hasOwn(STATUSES,c.status) || typeof c.author !== 'string' || c.author.length > 60 || typeof c.updatedAt !== 'string' || !Number.isFinite(Date.parse(c.updatedAt))) throw new Error('Неверные данные записи. Проверьте название, раздел, статус и дату.');
    seen.add(c.id);
  }
  return {version:1,cards:data.cards.map(c=>({id:c.id,name:c.name,category:c.category,status:c.status,text:c.text,author:c.author,updatedAt:c.updatedAt}))};
}
export function equal(a,b) {return JSON.stringify(a??null) === JSON.stringify(b??null);}
// Every edit remembers its original card. A remote edit is never silently overwritten.
export function mergeChanges(remote, pending) {
  const cards = new Map(remote.cards.map(c=>[c.id,c]));
  const conflicts = [];
  for (const [id,op] of Object.entries(pending)) {
    const theirs = cards.get(id) ?? null;
    if (!equal(theirs,op.base) && !equal(theirs,op.value)) {conflicts.push({id,mine:op.value,theirs});continue;}
    if(op.value === null) cards.delete(id); else cards.set(id,op.value);
  }
  return {board:{version:1,cards:[...cards.values()]}, conflicts};
}
export function encode(text) {return btoa(Array.from(new TextEncoder().encode(text), b=>String.fromCharCode(b)).join(''));}
export function decode(base64) {return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(base64.replace(/\s/g,'')), c=>c.charCodeAt(0)));}
export class GitHubStore {
  constructor({repo,branch,token},request=fetch) {this.repo=repo;this.branch=branch;this.token=token;this.request=request;}
  async call(method,body) {
    const path=this.repo.split('/').map(encodeURIComponent).join('/');
    const url=`https://api.github.com/repos/${path}/contents/data.json${method==='GET'?`?ref=${encodeURIComponent(this.branch)}`:''}`;
    const response=await this.request(url,{method,cache:'no-store',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${this.token}`,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
    if(!response.ok) {
      const messages={401:'Токен неверный или истёк. Подключитесь заново.',403:'Недостаточно прав или достигнут лимит запросов. Проверьте доступ к репозиторию и Contents: Read and write.',404:'Не найден data.json. Проверьте репозиторий, ветку и доступ токена. Загрузите файлы проекта в корень репозитория.',409:'Репозиторий изменился во время сохранения.',422:'GitHub отклонил запись. Проверьте права на ветку и правила защиты репозитория.'};
      const error=new Error(messages[response.status] || `Ошибка GitHub (${response.status}). Попробуйте позже.`);error.status=response.status;throw error;
    }
    return response.json();
  }
  async read() {
    const result=await this.call('GET');
    if(typeof result.content!=='string'||!result.sha||result.encoding!=='base64')throw new Error('GitHub не вернул содержимое файла. Размер data.json должен быть меньше 1 МБ.');
    return {board:validateBoard(JSON.parse(decode(result.content))),sha:result.sha};
  }
  async write(board,sha,author) {
    const json=JSON.stringify(validateBoard(board),null,2)+'\n';
    if(new TextEncoder().encode(json).length>900000)throw new Error('Записи занимают больше 900 КБ. Скачайте копию и разделите проект на несколько досок.');
    return this.call('PUT',{message:`Обновление записей: ${author||'участник'}`,branch:this.branch,sha,content:encode(json)});
  }
}
