import { createClientId } from './client-id.js';

const $ = (selector) => document.querySelector(selector);

function stored(key) { try { return localStorage.getItem(key); } catch { return null; } }
function store(key, value) { try { localStorage.setItem(key, value); } catch {} }
const state = {
  info: null, path: '', breadcrumbs: [], externalLibrary: false, sharedFolders: [], selectedRecipient: '__inbox__', devices: [], incoming: [], hostInbox: [], pollTimer: null,
  clientId: stored('lanflow-client-id') || stored('lantern-client-id') || createClientId(window.crypto),
  deviceName: stored('lanflow-device-name') || stored('lantern-device-name') || guessDeviceName(), eventSource: null
};
store('lanflow-client-id', state.clientId);
store('lanflow-device-name', state.deviceName);

function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android 设备';
  if (/Windows/i.test(ua)) return 'Windows 电脑';
  if (/Mac/i.test(ua)) return 'Mac';
  return '浏览器设备';
}

function escapeHtml(value) { const node = document.createElement('span'); node.textContent = String(value); return node.innerHTML; }
function formatSize(bytes) { if (bytes === 0) return '0 B'; if (!Number.isFinite(bytes)) return '—'; const units = ['B','KB','MB','GB','TB']; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`; }
function formatDate(value) { return new Intl.DateTimeFormat('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(value)); }
function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2400); }
function platformIcon(platform='') { return /phone|android|iphone/i.test(platform) ? '▯' : /ipad|tablet/i.test(platform) ? '▭' : '▰'; }
function previewKind(name='') {
  const extension = name.split('.').pop()?.toLowerCase();
  if (['jpg','jpeg','png','gif','webp','bmp','svg','avif'].includes(extension)) return 'image';
  if (['mp4','webm','mov','m4v'].includes(extension)) return 'video';
  if (['mp3','wav','ogg','m4a','aac','flac'].includes(extension)) return 'audio';
  if (extension === 'pdf') return 'pdf';
  if (['txt','md','csv','json','log','xml','yaml','yml'].includes(extension)) return 'text';
  return '';
}

function openPreview({ name, size, kind, previewUrl, downloadUrl }) {
  const body = $('#previewBody'); body.replaceChildren();
  let media;
  if (kind === 'image') { media = document.createElement('img'); media.alt = name; }
  else if (kind === 'video') { media = document.createElement('video'); media.controls = true; media.playsInline = true; }
  else if (kind === 'audio') { media = document.createElement('audio'); media.controls = true; }
  else { media = document.createElement('iframe'); media.title = `${name} 预览`; }
  media.src = previewUrl; body.append(media);
  $('#previewName').textContent = name;
  $('#previewMeta').textContent = formatSize(Number(size));
  $('#previewDownload').href = `${downloadUrl}${downloadUrl.includes('?') ? '&' : '?'}save=${Date.now()}`;
  $('#previewDownload').download = name;
  $('#previewDialog').showModal();
}

function bindPreviewRows() {
  document.querySelectorAll('.preview-button').forEach((button) => button.addEventListener('click', () => openPreview(button.dataset)));
}

function fileRow({ name, size, detail, previewUrl, downloadUrl }) {
  const kind = previewKind(name);
  const previewButton = kind ? `<button class="mini-button preview-button" data-name="${escapeHtml(name)}" data-size="${size}" data-kind="${kind}" data-preview-url="${escapeHtml(previewUrl)}" data-download-url="${escapeHtml(downloadUrl)}">预览</button>` : '';
  return `<div class="file-row"><span class="file-icon">${kind ? '◎' : '↓'}</span><span class="file-meta"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(detail)}</span></span><span class="row-actions">${previewButton}<a class="mini-button save-button" href="${escapeHtml(downloadUrl)}${downloadUrl.includes('?') ? '&' : '?'}save=${Date.now()}" download="${escapeHtml(name)}">保存</a></span></div>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (response.status === 401 && path !== '/api/auth') { $('#authDialog').showModal(); throw new Error('需要访问口令'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

async function boot() {
  $('#primaryAddress').textContent = location.origin;
  state.info = await api('/api/info');
  const address = state.info.addresses[0] || location.origin;
  $('#primaryAddress').textContent = address;
  if (state.info.authRequired && !state.info.authorized) { $('#authDialog').showModal(); return; }
  $('#addSharedFolderButton').classList.toggle('hidden', !state.info.isHost);
  $('#accessSettingsButton').classList.toggle('hidden', !state.info.isHost);
  $('#stopServiceButton').classList.toggle('hidden', !state.info.isHost);
  $('#openInboxButton').classList.toggle('hidden', !state.info.isHost);
  connectEvents();
  $('#inlineQr').src = `/api/qr?text=${encodeURIComponent(address)}&v=${Date.now()}`;
  await Promise.all([loadFiles(), loadSharedFolders(), refreshPresence()]);
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(refreshPresence, 8_000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function connectEvents() {
  state.eventSource?.close();
  const query = new URLSearchParams({ id:state.clientId, name:state.deviceName, platform:navigator.userAgent });
  state.eventSource = new EventSource(`/api/events?${query}`);
  state.eventSource.addEventListener('ready', () => { $('.connection').classList.add('online'); $('#connectionText').textContent = `已连接 · ${state.info.name}`; });
  state.eventSource.addEventListener('devices', (event) => { state.devices = JSON.parse(event.data).devices; renderDevices(); });
  state.eventSource.addEventListener('transfer', (event) => { const transfer = JSON.parse(event.data); state.incoming.unshift(transfer); renderInbox(); toast(`收到来自 ${transfer.senderName} 的文件`); });
  state.eventSource.addEventListener('inbox', () => { loadHostInbox(); toast('主机收件箱收到新文件'); });
  state.eventSource.addEventListener('library', () => { loadFiles(state.path); });
  state.eventSource.onerror = () => { $('.connection').classList.remove('online'); $('#connectionText').textContent = '正在重新连接'; };
}

async function loadDevices() { state.devices = (await api('/api/devices')).devices; renderDevices(); }
async function refreshPresence() {
  await api('/api/presence', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id:state.clientId, name:state.deviceName, platform:navigator.userAgent }) }).catch(() => {});
  await Promise.all([loadDevices(), loadIncoming(), loadHostInbox()]);
}
function renderDevices() {
  const others = state.devices.filter((device) => device.id !== state.clientId);
  const all = [{ id:'__inbox__', name:`${state.info?.name || '主机'} · 收件箱`, platform:'server' }, { id:'*', name:'所有在线设备', platform:'broadcast' }, ...others];
  if (!all.some((device) => device.id === state.selectedRecipient)) state.selectedRecipient = '__inbox__';
  $('#devices').innerHTML = all.map((device) => `<button class="device ${device.id === state.selectedRecipient ? 'selected' : ''}" data-id="${escapeHtml(device.id)}"><span class="device-icon">${device.id === '*' ? '✦' : device.id === '__inbox__' ? '⌂' : platformIcon(device.platform)}</span><strong>${escapeHtml(device.name)}</strong><small>${device.id === '*' ? '发送给当前所有设备' : device.id === '__inbox__' ? '主机未打开网页也能接收' : '在线 · 可接收'}</small></button>`).join('');
  $('#deviceSummary').textContent = others.length ? `${others.length} 个其他浏览器在线` : '主机收件箱始终可用';
  document.querySelectorAll('.device').forEach((button) => button.addEventListener('click', () => { state.selectedRecipient = button.dataset.id; renderDevices(); }));
}

async function loadFiles(path = state.path) {
  try { const result = await api(`/api/files?path=${encodeURIComponent(path)}`); state.path = result.path; state.breadcrumbs = result.breadcrumbs || []; state.externalLibrary = Boolean(result.external); $('#libraryUploadButton').classList.toggle('hidden', state.externalLibrary); renderBreadcrumbs(); renderFiles(result.items); }
  catch (error) { $('#fileList').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
}
function renderBreadcrumbs() {
  const parts = state.breadcrumbs.length ? state.breadcrumbs : [{ label:'共享空间', path:'' }];
  $('#breadcrumbs').innerHTML = parts.map((part,index) => `<button class="crumb" data-path="${escapeHtml(part.path)}">${index ? '› ' : ''}${escapeHtml(part.label)}</button>`).join('');
  document.querySelectorAll('.crumb').forEach((button) => button.addEventListener('click', () => loadFiles(button.dataset.path)));
}
function renderFiles(items) {
  if (!items.length) { $('#fileList').innerHTML = '<div class="empty">这个文件夹还是空的</div>'; return; }
  $('#fileList').innerHTML = items.map((item) => {
    const path = item.path || [state.path,item.name].filter(Boolean).join('/');
    if (item.type === 'directory') return `<div class="file-row" data-folder="${escapeHtml(path)}"><span class="file-icon folder">▰</span><span class="file-meta"><strong>${escapeHtml(item.name)}</strong><span>文件夹 · ${formatDate(item.modified)}</span></span><span class="file-action">打开 ›</span></div>`;
    const downloadUrl = `/api/download?path=${encodeURIComponent(path)}`;
    return fileRow({ name:item.name, size:item.size, detail:`${formatSize(item.size)} · ${formatDate(item.modified)}`, previewUrl:`/api/preview?path=${encodeURIComponent(path)}`, downloadUrl });
  }).join('');
  document.querySelectorAll('[data-folder]').forEach((row) => row.addEventListener('click', () => loadFiles(row.dataset.folder)));
  bindPreviewRows();
}

async function loadSharedFolders() {
  const result = await api('/api/shared-folders');
  state.sharedFolders = result.folders;
  const list = $('#sharedFolderList');
  if (!result.isHost || !state.sharedFolders.length) { list.classList.add('hidden'); list.replaceChildren(); return; }
  list.classList.remove('hidden');
  list.innerHTML = `<span>已共享：</span>${state.sharedFolders.map((folder) => `<span class="shared-folder-chip" title="${escapeHtml(folder.path || folder.name)}"><b>${escapeHtml(folder.name)}</b><button data-remove-folder="${escapeHtml(folder.id)}" aria-label="停止共享 ${escapeHtml(folder.name)}">×</button></span>`).join('')}`;
  document.querySelectorAll('[data-remove-folder]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/api/shared-folders/${encodeURIComponent(button.dataset.removeFolder)}`, { method:'DELETE' });
    toast('已停止共享该文件夹，原文件没有被删除');
    await Promise.all([loadSharedFolders(), loadFiles('')]);
  }));
}

function uploadFile(file) {
  const row = document.createElement('div'); row.className = 'upload-item';
  row.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>等待中</span><i class="progress" style="width:0"></i>`;
  $('#uploadQueue').prepend(row);
  const status = row.querySelector('span'); const progress = row.querySelector('.progress');
  const query = new URLSearchParams({ name:file.name, recipient:state.selectedRecipient, sender:state.clientId, senderName:state.deviceName, mode:state.selectedRecipient === '__inbox__' ? 'inbox' : 'transfer' });
  return new Promise((resolveUpload) => {
    const xhr = new XMLHttpRequest(); xhr.open('PUT', `/api/upload?${query}`);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) { const percent = Math.round(event.loaded / event.total * 100); progress.style.width = `${percent}%`; status.textContent = `${percent}%`; } };
    xhr.onload = () => { if (xhr.status < 300) { status.textContent = '已发送'; progress.style.width = '100%'; toast(`${file.name} 已发送`); } else { let message='发送失败'; try { message=JSON.parse(xhr.responseText).error || message; } catch {} status.textContent=message; progress.style.background='var(--coral)'; } resolveUpload(); };
    xhr.onerror = () => { status.textContent='网络中断'; progress.style.background='var(--coral)'; resolveUpload(); };
    xhr.send(file);
  });
}
async function uploadFiles(files) { for (const file of files) await uploadFile(file); }
async function uploadLibraryFiles(files) {
  for (const file of files) {
    const query = new URLSearchParams({ name:file.name, mode:'library', path:state.path });
    const response = await fetch(`/api/upload?${query}`, { method:'PUT', body:file });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { toast(result.error || `${file.name} 上传失败`); return; }
    toast(`${file.name} 已加入共享空间`);
  }
  await loadFiles(state.path);
}

function renderInbox() {
  const count = state.incoming.length + state.hostInbox.length;
  $('#inboxCount').textContent = count; $('#inboxCount').classList.toggle('hidden', !count);
  if (!count) { $('#inboxList').innerHTML='<div class="empty">手机发送到“主机收件箱”后，文件会保存在这里</div>'; return; }
  const hostRows = state.hostInbox.map((item) => fileRow({ name:item.name, size:item.size, detail:`${formatSize(item.size)} · ${formatDate(item.modified)}`, previewUrl:`/api/inbox/preview?name=${encodeURIComponent(item.name)}`, downloadUrl:`/api/inbox/download?name=${encodeURIComponent(item.name)}` })).join('');
  const transferRows = state.incoming.map((item) => fileRow({ name:item.name, size:item.size, detail:`${formatSize(item.size)} · 来自 ${item.senderName}`, previewUrl:`/api/transfers/${item.id}/preview`, downloadUrl:`/api/transfers/${item.id}` })).join('');
  $('#inboxList').innerHTML = `${hostRows ? '<div class="list-section-label">主机收件箱 <small>永久保留在 data/inbox</small></div>' + hostRows : ''}${transferRows ? '<div class="list-section-label">临时闪传 <small>到期后自动清理</small></div>' + transferRows : ''}`;
  bindPreviewRows();
}

async function loadIncoming() {
  const result = await api(`/api/transfers?recipient=${encodeURIComponent(state.clientId)}`);
  state.incoming = result.transfers;
  renderInbox();
}

async function loadHostInbox() {
  state.hostInbox = (await api('/api/inbox')).items;
  renderInbox();
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab,.view').forEach((node) => node.classList.remove('active'));
  tab.classList.add('active'); $(`#${tab.dataset.view}View`).classList.add('active');
}));
$('#copyAddress').addEventListener('click', async () => {
  const value = $('#primaryAddress').textContent;
  let copied = false;
  if (navigator.clipboard?.writeText) copied = await navigator.clipboard.writeText(value).then(() => true).catch(() => false);
  if (!copied) {
    const input = document.createElement('textarea'); input.value = value; input.style.position='fixed'; input.style.opacity='0'; document.body.append(input); input.select(); copied = document.execCommand('copy'); input.remove();
  }
  toast(copied ? '访问地址已复制' : `访问地址：${value}`);
});
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => {
  const dialog = $(`#${button.dataset.closeDialog}`); dialog.close();
  if (dialog.id === 'previewDialog') $('#previewBody').replaceChildren();
}));
$('#refreshFiles').addEventListener('click', () => loadFiles());
$('#openInboxButton').addEventListener('click', async () => {
  try { await api('/api/inbox/open', { method:'POST' }); toast('已打开主机接收箱目录'); }
  catch (error) { toast(error.message); }
});
$('#stopServiceButton').addEventListener('click', async () => {
  if (!window.confirm('确定结束 LANFlow 服务吗？其他设备会立即断开。')) return;
  const button = $('#stopServiceButton'); button.disabled = true; button.textContent = '正在结束…';
  try { await api('/api/shutdown', { method:'POST' }); $('#connectionText').textContent = '服务已结束'; toast('LANFlow 已结束，可以关闭此页面'); }
  catch (error) { button.disabled = false; button.textContent = '结束服务'; toast(error.message); }
});
function updateSettingsDialog() {
  const enabled = state.info.authRequired;
  const managed = state.info.accessCodeManagedByEnv;
  const select = $('#autoStopMinutes'); select.value = String(state.info.autoStopMinutes ?? 60);
  $('#settingsStatus').textContent = `${enabled ? '访问口令已启用' : '访问口令未启用'}；${state.info.autoStopMinutes ? `服务将在启动 ${state.info.autoStopMinutes} 分钟后自动断开` : '服务不会自动断开'}。`;
  $('#newAccessCode').disabled = managed;
  $('#newAccessCode').placeholder = managed ? '口令由启动环境变量管理' : '留空表示不修改，至少 4 位';
  $('#clearAccessCode').disabled = managed || !enabled;
}
$('#accessSettingsButton').addEventListener('click', () => {
  $('#settingsError').textContent = ''; $('#newAccessCode').value = ''; updateSettingsDialog(); $('#settingsDialog').showModal();
});
$('#settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#settingsError').textContent = '';
  const code = $('#newAccessCode').value;
  const body = { autoStopMinutes:Number($('#autoStopMinutes').value), ...(code ? { code, updateAccessCode:true } : {}) };
  try {
    const result = await api('/api/settings/access-code', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    state.info.authRequired = result.authRequired; state.info.autoStopMinutes = result.autoStopMinutes; state.info.autoStopAt = result.autoStopAt;
    $('#newAccessCode').value = ''; $('#settingsDialog').close(); toast(code ? '访问口令和自动断开设置已保存' : '自动断开设置已保存');
  } catch (error) { $('#settingsError').textContent = error.message; }
});
$('#clearAccessCode').addEventListener('click', async () => {
  $('#settingsError').textContent = '';
  try {
    const result = await api('/api/settings/access-code', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ clearAccessCode:true, autoStopMinutes:Number($('#autoStopMinutes').value) }) });
    state.info.authRequired = result.authRequired; state.info.autoStopMinutes = result.autoStopMinutes; state.info.autoStopAt = result.autoStopAt;
    $('#settingsDialog').close(); toast('访问口令已关闭');
  } catch (error) { $('#settingsError').textContent = error.message; }
});
$('#addSharedFolderButton').addEventListener('click', async () => {
  const button = $('#addSharedFolderButton'); button.disabled = true; button.textContent = '请选择文件夹…';
  try {
    const result = await api('/api/shared-folders/select', { method:'POST' });
    if (!result.cancelled) { toast(result.existing ? '这个文件夹已经在共享' : '共享文件夹已添加'); await Promise.all([loadSharedFolders(), loadFiles('')]); }
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = '添加共享文件夹'; }
});
$('#libraryUploadButton').addEventListener('click', () => $('#libraryFileInput').click());
$('#libraryFileInput').addEventListener('change', async (event) => { await uploadLibraryFiles([...event.target.files]); event.target.value=''; });
function openFileSourceDialog() { $('#fileSourceDialog').showModal(); }
$('#fileSourceDialog').addEventListener('click', (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
$('#mobileSendButton').addEventListener('click', (event) => { event.stopPropagation(); openFileSourceDialog(); });
$('#sourceFilesButton').addEventListener('click', () => { $('#fileSourceDialog').close(); $('#documentInput').click(); });
$('#sourceMediaButton').addEventListener('click', () => { $('#fileSourceDialog').close(); $('#mediaInput').click(); });
$('#fileInput').addEventListener('change', (event) => { uploadFiles([...event.target.files]); event.target.value=''; });
$('#documentInput').addEventListener('change', (event) => { uploadFiles([...event.target.files]); event.target.value=''; });
$('#mediaInput').addEventListener('change', (event) => { uploadFiles([...event.target.files]); event.target.value=''; });
for (const eventName of ['dragenter','dragover']) $('#dropzone').addEventListener(eventName, (event) => { event.preventDefault(); $('#dropzone').classList.add('dragging'); });
for (const eventName of ['dragleave','drop']) $('#dropzone').addEventListener(eventName, (event) => { event.preventDefault(); $('#dropzone').classList.remove('dragging'); });
$('#dropzone').addEventListener('drop', (event) => uploadFiles([...event.dataTransfer.files]));
$('#dropzone').addEventListener('click', (event) => { if (event.target.closest('button')) return; if (window.matchMedia('(max-width:760px)').matches) openFileSourceDialog(); else $('#fileInput').click(); });
$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#authError').textContent='';
  try { await api('/api/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ code:$('#accessCode').value }) }); $('#authDialog').close(); await boot(); }
  catch (error) { $('#authError').textContent=error.message; }
});
window.addEventListener('beforeunload', () => { state.eventSource?.close(); clearInterval(state.pollTimer); });
boot().catch((error) => { $('#connectionText').textContent='连接失败'; toast(error.message); });
