/* No GitHub token is accepted or stored by the client. */
(()=>{
'use strict';
const DEFAULT_URL='https://ai-chat-agent.kuksinaalena77.workers.dev';
window.githubAgentEnabled=false;window.githubAgentBusy=false;
let password='',busy=false,review=null,focusBefore=null;
const modal=document.createElement('div');modal.className='modal-bg';modal.id='agentModal';
modal.innerHTML=`<section class="modal agent-dialog" role="dialog" aria-modal="true" aria-labelledby="agentHeading">
 <div class="modal-head"><h2 id="agentHeading">Агент GitHub · MCP</h2><button class="icon-btn" id="agentClose" aria-label="Закрыть"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg></button></div>
 <div class="modal-body">
  <section id="agentConnectPanel">
   <p class="agent-note">После подключения пишите задачи в обычном чате. Чтение кода выполняется автоматически; любая запись в GitHub требует отдельного подтверждения.</p>
   <label for="agentUrl">Адрес вашего Cloudflare Worker</label><input id="agentUrl" type="url" autocomplete="off">
   <label for="agentPassword">Пароль агента</label><input id="agentPassword" type="password" autocomplete="off" placeholder="Задан как AGENT_PASSWORD в Cloudflare">
   <p class="agent-note">Это отдельный пароль, не токен и не пароль GitHub. Он хранится только в памяти вкладки. GitHub-токен добавляется исключительно в Secrets Cloudflare.</p>
   <div class="agent-actions"><button class="btn primary" id="agentConnect">Подключить и включить</button><button class="btn" id="agentDisable">Выключить и забыть пароль</button></div>
   <p class="agent-note">Используется модель, выбранная в чате. Она должна поддерживать tools/function calling. Её API-ключ передаётся вашему Worker по HTTPS только для выполнения запроса и не записывается в хранилище агента.</p>
  </section>
  <div id="agentStatus" class="agent-status" role="status" aria-live="polite"></div>
  <section id="agentReviewPanel" hidden>
   <h3>Разрешить изменение?</h3><p id="agentSummary"></p>
   <p class="agent-note">Проверьте каждый файл. Новые приложения и их код будут публичными. Не публикуйте ключи, пароли и личные данные. В основном чате агент создаёт только ветку и pull request — без слияния.</p>
   <label for="agentFile">Файлы для записи</label><select id="agentFile"></select>
   <textarea id="agentCode" class="agent-code" readonly aria-label="Подготовленный код" spellcheck="false"></textarea>
   <label class="agent-check"><input id="agentConfirmed" type="checkbox"><span>Я просмотрела файлы и разрешаю указанное действие в GitHub.</span></label>
   <div class="agent-actions"><button class="btn primary" id="agentApprove" disabled>Разрешить действие</button><button class="btn" id="agentReject">Отклонить</button></div>
  </section>
 </div>
 <div class="modal-foot"><button class="btn" id="agentDone">Закрыть</button></div>
</section>`;
document.body.append(modal);
const q=id=>modal.querySelector('#'+id);
q('agentUrl').value=lsGet('aichat_agent_url')||DEFAULT_URL;
const banner=document.createElement('div');banner.className='agent-banner';banner.innerHTML='<span id="agentBannerText">GitHub MCP · включён</span><button id="agentBannerSetup">Настроить</button>';
$('.topbar').after(banner);
function status(text,error=false){q('agentStatus').textContent=text;q('agentStatus').dataset.error=String(error);if(error)q('agentStatus').scrollIntoView({block:'nearest'});}
function enabled(value){window.githubAgentEnabled=value;banner.classList.toggle('active',value);$('#agentSettingsBtn').textContent=value?'🤖 Агент GitHub · включён':'🤖 Агент GitHub';}
function setBusy(value){busy=value;window.githubAgentBusy=value;['agentConnect','agentDisable','agentUrl','agentPassword','agentApprove','agentReject','agentConfirmed'].forEach(id=>q(id).disabled=value);q('agentApprove').disabled=value||!review||!q('agentConfirmed').checked;$('#agentBannerText').textContent=value?'GitHub MCP · выполняю задачу…':'GitHub MCP · включён';}
function open(){focusBefore=document.activeElement;modal.classList.add('show');if(innerWidth<760)$('#sidebar').classList.add('hidden');q('agentClose').focus({preventScroll:true});modal.querySelector('.modal-body').scrollTop=0;}
function close(){modal.classList.remove('show');focusBefore?.focus();}
$('#agentSettingsBtn').onclick=()=>{review=null;q('agentReviewPanel').hidden=true;q('agentConnectPanel').hidden=false;open();};$('#agentBannerSetup').onclick=$('#agentSettingsBtn').onclick;
q('agentClose').onclick=close;q('agentDone').onclick=close;
modal.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const nodes=[...modal.querySelectorAll('button,input,textarea,select')].filter(el=>!el.disabled&&el.getClientRects().length);if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
function model(){return {model:activeModel(),key:settings.keys[settings.provider],baseUrl:baseUrlOf(settings.provider)};}
async function api(path,body){
 let url;try{url=new URL(q('agentUrl').value.trim());}catch{throw Error('Укажите HTTPS-адрес вашего Worker.');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Нужен HTTPS origin Worker без дополнительного пути.');
 if(!password)throw Error('Подключите агента и введите отдельный пароль AGENT_PASSWORD.');
 const r=await fetch(url.origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+password,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(300000)});
 const data=await r.json().catch(()=>{throw Error('Worker вернул не JSON. Разверните код из папки cloudflare вместо стартового примера.');});
 if(!r.ok)throw Error(data.error||'HTTP '+r.status);return data;
}
q('agentConnect').onclick=async()=>{
 password=q('agentPassword').value;setBusy(true);status('Проверяю GitHub MCP…');
 try{const data=await api('/api/status');if(!data.ok)throw Error('Worker не подтвердил подключение.');
 const required=['get_file_contents','create_repository','push_files','create_branch','create_pull_request'];const missing=required.filter(n=>!data.tools?.includes(n));
 if(missing.length)throw Error('В MCP нет нужных инструментов: '+missing.join(', '));
 lsSet('aichat_agent_url',new URL(q('agentUrl').value).origin);q('agentPassword').value='';enabled(true);status('Подключено к '+data.owner+'. Теперь закройте окно и напишите задачу в обычном чате.');
 }catch(e){enabled(false);password='';status(e.message,true);}finally{setBusy(false);}
};
q('agentDisable').onclick=()=>{password='';q('agentPassword').value='';enabled(false);status('Агент выключен, пароль удалён из памяти. Обычный чат работает как прежде.');};
q('agentUrl').oninput=()=>{if(!busy){password='';enabled(false);status('Адрес изменён. Подключитесь заново.');}};
async function saveIfPresent(c){if(chats.some(x=>x===c))await persist(c);}
function applyResult(c,msg,r){msg.content=r.text||'';msg.agentLog=r.log||[];msg.agentPlan=r.pending||null;if(r.links?.length)msg.content+='\n\n'+r.links.filter(u=>/^https:\/\/(github\.com\/|[a-z0-9-]+\.github\.io\/)/i.test(u)).map(u=>'['+(new URL(u).hostname.endsWith('.github.io')?'Открыть сайт (после сборки)':'Открыть репозиторий / изменения')+']('+u+')').join('\n\n');}
function reviewButtons(){
 if(!current())return;
 $('#messages').querySelectorAll('.msg').forEach(el=>{
 const msg=current().messages[Number(el.dataset.idx)];if(!msg?.agentPlan||el.querySelector('.agent-review-btn'))return;
 const button=document.createElement('button');button.className='btn agent-review-btn';button.textContent='Проверить и подтвердить';button.disabled=busy;button.onclick=()=>showReview(current(),msg);el.querySelector('.bubble').append(button);
 });
}
const renderOriginal=renderMessages;renderMessages=function(){renderOriginal();reviewButtons();$("#messages").scrollTop=$("#messages").scrollHeight;};
function showReview(c,msg){
 review={c,msg,plan:msg.agentPlan};q('agentConnectPanel').hidden=true;q('agentReviewPanel').hidden=false;q('agentConfirmed').checked=false;q('agentApprove').disabled=true;status('Запись ещё не выполнялась. План действует 20 минут.');
 q('agentSummary').textContent=review.plan.summary;q('agentFile').replaceChildren(...review.plan.files.map(f=>{const option=document.createElement('option');option.value=f.path;option.textContent=f.path;return option;}));q('agentCode').value=review.plan.files[0]?.content||'';open();
}
q('agentFile').onchange=()=>{q('agentCode').value=review?.plan.files.find(f=>f.path===q('agentFile').value)?.content||'';};
q('agentConfirmed').onchange=()=>{q('agentApprove').disabled=busy||!review||!q('agentConfirmed').checked;};
async function decide(approve){
 if(busy||!review||approve&&!q('agentConfirmed').checked)return;
 const {c,msg,plan}=review;setBusy(true);status(approve?'Выполняю подтверждённое действие. Закрытие окна не отменит начатую операцию.':'Отклоняю действие…');
 try{const r=await api('/api/decision',{conversationId:c.id,planId:plan.id,approve});msg.agentPlan=null;
 const answer={role:'assistant',agent:true,content:'',time:Date.now(),model:'GitHub MCP'};applyResult(c,answer,r);c.messages.push(answer);await saveIfPresent(c);if(current()===c)renderMessages();review=null;q('agentReviewPanel').hidden=true;status(r.text);}
 catch(e){status(e.message+'\nЕсли запись могла начаться, проверьте GitHub перед повтором.',true);
 try{const state=await api('/api/state',{conversationId:c.id});msg.agentPlan=state.pending||null;await saveIfPresent(c);if(current()===c)renderMessages();if(!state.pending){review=null;q('agentReviewPanel').hidden=true;}}catch{}
 }finally{setBusy(false);reviewButtons();}
}
q('agentApprove').onclick=()=>decide(true);q('agentReject').onclick=()=>decide(false);
window.sendGitHubAgent=async()=>{
 if(busy||controller)return;
 const text=input.value.trim();if(!text)return;if(pending.length)return toast('В режиме GitHub-агента пока нет вложений. Уберите их или выключите агента.');
 if(!password){$('#agentSettingsBtn').click();return status('Сначала подключите агента.',true);}
 const config=model();if(!config.key)return toast('Укажите API-ключ модели в обычных настройках.');
 if(!current())newChat();const c=current();
 c.messages.push({role:'user',agent:true,content:text,time:Date.now()});if(settings.autoTitle&&c.title==='Новый чат')c.title=text.slice(0,48);
 input.value='';autoGrow();const msg={role:'assistant',agent:true,content:'Агент работает с GitHub…',time:Date.now(),model:config.model};c.messages.push(msg);setBusy(true);renderList();renderMessages();
 try{await saveIfPresent(c);const r=await api('/api/chat',{conversationId:c.id,message:text,provider:config});applyResult(c,msg,r);}
 catch(e){msg.content='';msg.error=e.name==='TimeoutError'?'Ожидание истекло. Работа на сервере могла продолжиться. Проверьте GitHub и не повторяйте запись вслепую.':e.message;}
 finally{setBusy(false);await saveIfPresent(c);if(current()===c)renderMessages();renderList();}
};
})();
