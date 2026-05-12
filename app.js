const TITLE_MAX_LEN = 28;
const FILE_SIZE_MAX = 50 * 1024 * 1024;
const PAGE_SIZE     = 20;

// 소유권 토큰 (이 기기에서 올린 항목만 삭제/수정 가능)
let OWNER_TOKEN = localStorage.getItem("ownerToken");
if (!OWNER_TOKEN) { OWNER_TOKEN = generateId(); localStorage.setItem("ownerToken", OWNER_TOKEN); }

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const dropzone       = document.querySelector("#dropzone");
const fileInput      = document.querySelector("#fileInput");
const cameraInput    = document.querySelector("#cameraInput");
const fileExpiry     = document.querySelector("#fileExpiry");
const textInput      = document.querySelector("#textInput");
const titleInput     = document.querySelector("#titleInput");
const textExpiry     = document.querySelector("#textExpiry");
const shareTextBtn   = document.querySelector("#shareTextBtn");
const clearTextBtn   = document.querySelector("#clearTextBtn");
const shareList      = document.querySelector("#shareList");
const loadMoreBtn    = document.querySelector("#loadMoreBtn");
const searchInput    = document.querySelector("#searchInput");
const sortSelect     = document.querySelector("#sortSelect");
const multiToggleBtn = document.querySelector("#multiToggleBtn");
const multiDeleteBtn = document.querySelector("#multiDeleteBtn");
const toast          = document.querySelector("#toast");
const statusBadge    = document.querySelector("#statusBadge");
const progressWrap   = document.querySelector("#progressWrap");
const progressBar    = document.querySelector("#progressBar");
const themeBtn       = document.querySelector("#themeBtn");
const lightbox       = document.querySelector("#lightbox");
const lightboxImg    = document.querySelector("#lightboxImg");
const qrModal        = document.querySelector("#qrModal");
const qrCanvas       = document.querySelector("#qrCanvas");
const qrLabel        = document.querySelector("#qrLabel");
const qrClose        = document.querySelector("#qrClose");
const profileBtn     = document.querySelector("#profileBtn");
const emailModal     = document.querySelector("#emailModal");
const emailModalInput = document.querySelector("#emailModalInput");
const emailSaveBtn   = document.querySelector("#emailSaveBtn");
const emailClearBtn  = document.querySelector("#emailClearBtn");
const emailCancelBtn = document.querySelector("#emailCancelBtn");
let OWNER_EMAIL = localStorage.getItem('ownerEmail') || '';

// 이메일 유무에 따라 로그인 화면 또는 앱을 즉시 표시
document.getElementById('loginScreen').hidden = !!OWNER_EMAIL;
document.querySelector('.app').hidden = !OWNER_EMAIL;

let shares       = [];
let displayCount = PAGE_SIZE;
let rtChannel    = null;
let isUploading  = false;
let selectedIds  = new Set();

init();

async function init() {
  loadTheme();
  if (!OWNER_EMAIL) {
    document.getElementById('loginBtn').addEventListener('click', enterApp);
    document.getElementById('loginEmailInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') enterApp();
    });
    return;
  }
  await startApp();
}

async function startApp() {
  bindEvents();
  updateProfileBtn();
  logVisit();
  renderSkeleton();
  await loadShares();
  subscribeRealtime();
}

function logVisit() {
  supabaseClient.from('visits').insert({
    owner_email: OWNER_EMAIL,
    user_agent: navigator.userAgent.slice(0, 250),
  }).then(() => {});
}

async function enterApp() {
  const input = document.getElementById('loginEmailInput');
  const errEl = document.getElementById('loginError');
  const email = input.value.trim();
  if (!email || !email.includes('@')) {
    errEl.textContent = '올바른 이메일 주소를 입력하세요.';
    input.focus();
    return;
  }
  errEl.textContent = '';
  OWNER_EMAIL = email;
  localStorage.setItem('ownerEmail', email);
  const ls = document.getElementById('loginScreen');
  ls.classList.add('fade-out');
  setTimeout(async () => {
    ls.hidden = true;
    document.querySelector('.app').hidden = false;
    await startApp();
  }, 300);
}

// ── 이벤트 바인딩 ────────────────────────────────────────
function bindEvents() {
  // 드롭존 드래그
  ["dragenter","dragover"].forEach(evt =>
    dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add("dragover"); })
  );
  ["dragleave","drop"].forEach(evt =>
    dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove("dragover"); })
  );
  dropzone.addEventListener("drop", e => uploadFiles([...e.dataTransfer.files]));
  fileInput.addEventListener("change",   e => { uploadFiles([...e.target.files]); fileInput.value = ""; });
  cameraInput.addEventListener("change", e => { uploadFiles([...e.target.files]); cameraInput.value = ""; });

  // 전체 페이지 드래그
  document.addEventListener("dragenter", e => {
    if (e.dataTransfer?.types.includes("Files")) document.body.classList.add("page-dragover");
  });
  document.addEventListener("dragleave", e => {
    if (!e.relatedTarget) document.body.classList.remove("page-dragover");
  });
  document.addEventListener("dragover",  e => e.preventDefault());
  document.addEventListener("drop", e => {
    document.body.classList.remove("page-dragover");
    if (e.target.closest("#dropzone")) return;
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) { e.preventDefault(); uploadFiles(files); }
  });

  // 클립보드 붙여넣기
  document.addEventListener("paste", e => {
    const items = [...(e.clipboardData?.items || [])];
    const fileItems = items.filter(i => i.kind === "file");
    if (fileItems.length) {
      e.preventDefault();
      uploadFiles(fileItems.map(i => i.getAsFile()).filter(Boolean));
    }
  });

  // 텍스트 공유
  shareTextBtn.addEventListener("click", shareText);
  clearTextBtn.addEventListener("click", () => { textInput.value = ""; titleInput.value = ""; });

  // 검색 / 정렬
  searchInput.addEventListener("input", () => { displayCount = PAGE_SIZE; renderShares(); });
  sortSelect.addEventListener("change",  () => { displayCount = PAGE_SIZE; renderShares(); });

  // 더 보기
  loadMoreBtn.addEventListener("click", () => { displayCount += PAGE_SIZE; renderShares(); });

  // 멀티셀렉트
  multiToggleBtn.addEventListener("click", toggleMultiSelect);
  multiDeleteBtn.addEventListener("click", deleteSelected);

  // 이벤트 위임
  shareList.addEventListener("click",  handleItemAction);
  shareList.addEventListener("change", handleItemCheck);

  // 라이트박스 닫기
  lightbox.addEventListener("click", () => lightbox.classList.remove("open"));
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      lightbox.classList.remove("open");
      qrModal.classList.remove("open");
      closeEmailModal();
    }
  });

  // QR 닫기
  qrClose.addEventListener("click", () => qrModal.classList.remove("open"));
  qrModal.addEventListener("click", e => { if (e.target === qrModal) qrModal.classList.remove("open"); });

  // 다크모드
  themeBtn.addEventListener("click", toggleTheme);

  // 프로필 / 이메일
  profileBtn.addEventListener("click", openEmailModal);
  emailSaveBtn.addEventListener("click", saveEmail);
  emailClearBtn.addEventListener("click", clearEmail);
  emailCancelBtn.addEventListener("click", closeEmailModal);
  emailModalInput.addEventListener("keydown", e => { if (e.key === "Enter") saveEmail(); });
  emailModal.addEventListener("click", e => { if (e.target === emailModal) closeEmailModal(); });

}

// ── 다크모드 ─────────────────────────────────────────────
function loadTheme() {
  const saved = localStorage.getItem("theme") ||
    (window.matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light");
  applyTheme(saved);
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem("theme", next);
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  themeBtn.textContent = t === "dark" ? "☀️" : "🌙";
}

// ── 이메일 / 프로필 ──────────────────────────────────────
function openEmailModal() {
  emailModalInput.value = OWNER_EMAIL;
  emailModal.classList.add("open");
  setTimeout(() => emailModalInput.focus(), 50);
}
function closeEmailModal() {
  emailModal.classList.remove("open");
}
function saveEmail() {
  const val = emailModalInput.value.trim();
  OWNER_EMAIL = val;
  if (val) localStorage.setItem('ownerEmail', val);
  else localStorage.removeItem('ownerEmail');
  updateProfileBtn();
  closeEmailModal();
  showToast(val ? `이메일 설정: ${val}` : '이메일이 삭제되었습니다');
}
function clearEmail() {
  OWNER_EMAIL = '';
  localStorage.removeItem('ownerEmail');
  closeEmailModal();
  showToast('이메일이 삭제되었습니다');
  setTimeout(() => location.reload(), 900);
}
function updateProfileBtn() {
  if (OWNER_EMAIL) {
    profileBtn.textContent = getInitial(OWNER_EMAIL);
    profileBtn.style.cssText = `background:${getAvatarColor(OWNER_EMAIL)};color:#fff;font-size:15px;font-weight:800`;
  } else {
    profileBtn.textContent = '👤';
    profileBtn.style.cssText = '';
  }
}
function getInitial(email) {
  return email ? email[0].toUpperCase() : '';
}
function getAvatarColor(email) {
  const colors = ['#2563eb','#7c3aed','#db2777','#059669','#d97706','#dc2626','#0891b2'];
  let h = 0;
  for (let i = 0; i < email.length; i++) h = email.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

// ── 멀티셀렉트 ───────────────────────────────────────────
function toggleMultiSelect() {
  const on = !document.body.classList.contains("multiselect");
  document.body.classList.toggle("multiselect", on);
  multiToggleBtn.textContent = on ? "선택 취소" : "선택";
  if (!on) { selectedIds.clear(); renderShares(); }
}
function handleItemCheck(e) {
  const cb = e.target.closest(".item-check");
  if (!cb) return;
  const id = cb.closest(".item")?.dataset.id;
  if (!id) return;
  cb.checked ? selectedIds.add(id) : selectedIds.delete(id);
  cb.closest(".item").classList.toggle("selected", cb.checked);
  multiDeleteBtn.textContent = `선택 삭제 (${selectedIds.size})`;
}
async function deleteSelected() {
  if (!selectedIds.size) return;
  if (!confirm(`선택한 ${selectedIds.size}개 항목을 삭제할까요?`)) return;
  const targets = shares.filter(s => selectedIds.has(s.id));
  for (const item of targets) {
    if (item.type === "file" && item.file_path)
      await supabaseClient.storage.from(BUCKET_NAME).remove([item.file_path]);
    await supabaseClient.from("shares").delete().eq("id", item.id);
  }
  selectedIds.clear();
  document.body.classList.remove("multiselect");
  multiToggleBtn.textContent = "선택";
  showToast(`${targets.length}개 삭제 완료`);
  await loadShares();
}

// ── 아이템 액션 위임 ──────────────────────────────────────
async function handleItemAction(e) {
  const btn  = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const itemEl = btn.closest(".item");
  const item   = shares.find(s => s.id === itemEl?.dataset.id);

  if (action === "copy"            && item) { await copyToClipboard(item.content); }
  if (action === "copy-url"        && item) { await copyToClipboard(item.file_url); }
  if (action === "delete-request"          ) { showDeleteConfirm(btn); }
  if (action === "delete-confirm"  && item) { await deleteShare(item, itemEl); }
  if (action === "delete-cancel"           ) { resetDeleteBtn(itemEl); }
  if (action === "expand"                  ) { toggleExpand(btn); }
  if (action === "show-qr"         && item) { openQr(item.file_url || item.content); }
  if (action === "rename"          && item) { startRename(btn, item, itemEl); }
}

function showDeleteConfirm(deleteBtn) {
  deleteBtn.dataset.action = "delete-confirm";
  deleteBtn.textContent    = "정말 삭제?";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "secondary"; cancelBtn.dataset.action = "delete-cancel"; cancelBtn.textContent = "취소";
  deleteBtn.insertAdjacentElement("afterend", cancelBtn);
  deleteBtn._cancelTimer = setTimeout(() => resetDeleteBtn(deleteBtn.closest(".item")), 4000);
}
function resetDeleteBtn(itemEl) {
  const cb = itemEl?.querySelector('[data-action="delete-confirm"]');
  const cc = itemEl?.querySelector('[data-action="delete-cancel"]');
  if (cb) { clearTimeout(cb._cancelTimer); cb.dataset.action = "delete-request"; cb.textContent = "삭제"; }
  cc?.remove();
}

function toggleExpand(btn) {
  const item     = btn.closest(".item");
  const expanded = item.classList.toggle("text-open");
  btn.textContent = expanded ? "접기" : "펼치기";
}

function openQr(text) {
  if (!text) return;
  qrCanvas.innerHTML = "";
  new QRCode(qrCanvas, { text, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
  qrLabel.textContent = text.length > 60 ? text.slice(0, 60) + "…" : text;
  qrModal.classList.add("open");
}

function startRename(btn, item, itemEl) {
  const titleEl = itemEl.querySelector(".item-title");
  const input   = document.createElement("input");
  input.type      = "text";
  input.className = "title-edit-input";
  input.value     = item.title || "";
  titleEl.replaceWith(input);
  input.focus(); input.select();

  const save = async () => {
    const newTitle = input.value.trim() || item.title;
    if (newTitle !== item.title) {
      await supabaseClient.from("shares").update({ title: newTitle }).eq("id", item.id);
      item.title = newTitle;
    }
    const p = document.createElement("p");
    p.className = "item-title"; p.textContent = newTitle;
    p.dataset.action = "rename";
    input.replaceWith(p);
  };
  input.addEventListener("blur",    save);
  input.addEventListener("keydown", e => { if (e.key === "Enter") input.blur(); if (e.key === "Escape") { input.value = item.title; input.blur(); } });
}

// ── 업로드 ───────────────────────────────────────────────
function lockUpload(lock) {
  isUploading = lock;
  dropzone.classList.toggle("locked", lock);
  fileInput.disabled   = lock;
  cameraInput.disabled = lock;
}

function calcExpiresAt(minutesStr) {
  if (!minutesStr) return null;
  const d = new Date();
  d.setMinutes(d.getMinutes() + parseInt(minutesStr, 10));
  return d.toISOString();
}

async function uploadFiles(files) {
  if (isUploading) return;
  lockUpload(true);

  for (const file of files) {
    if (!file) continue;
    if (file.size > FILE_SIZE_MAX) { showToast(`파일 크기 초과: ${file.name} (최대 50 MB)`); continue; }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path     = `${Date.now()}-${generateId()}-${safeName}`;

    setProgress(0);
    showToast(`${file.name} 업로드 중…`);

    const { error: uploadError } = await supabaseClient.storage.from(BUCKET_NAME).upload(path, file, {
      upsert: false,
      onUploadProgress: p => setProgress(Math.round((p.loaded / p.total) * 100)),
    });

    if (uploadError) { setProgress(null); showToast(`업로드 실패: ${file.name}`); continue; }

    const { data: urlData } = supabaseClient.storage.from(BUCKET_NAME).getPublicUrl(path);
    const fileExpiresAt = calcExpiresAt(fileExpiry.value);

    const { error: insertError } = await supabaseClient.from("shares").insert({
      type: "file", title: file.name, content: null,
      file_path: path, file_url: urlData.publicUrl,
      file_size: file.size, mime_type: file.type || "application/octet-stream",
      owner_token: OWNER_TOKEN,
      owner_email: OWNER_EMAIL || null,
      ...(fileExpiresAt && { expires_at: fileExpiresAt }),
    });

    if (insertError) {
      await supabaseClient.storage.from(BUCKET_NAME).remove([path]);
      showToast(`저장 실패: ${file.name}`);
    } else {
      showToast(`공유 완료: ${file.name}`);
      await loadShares();
    }
    setProgress(null);
  }
  lockUpload(false);
}

async function shareText() {
  const content = textInput.value.trim();
  if (!content) { showToast("공유할 텍스트를 입력하세요."); return; }
  shareTextBtn.disabled = true;
  const rawTitle     = titleInput.value.trim();
  const title        = rawTitle || (content.length > TITLE_MAX_LEN ? content.slice(0, TITLE_MAX_LEN) + "…" : content);
  const textExpiresAt = calcExpiresAt(textExpiry.value);

  const { error } = await supabaseClient.from("shares").insert({
    type: "text", title, content,
    file_path: null, file_url: null, file_size: null, mime_type: null,
    owner_token: OWNER_TOKEN,
    owner_email: OWNER_EMAIL || null,
    ...(textExpiresAt && { expires_at: textExpiresAt }),
  });

  shareTextBtn.disabled = false;
  if (error) { showToast("텍스트 공유 실패"); return; }
  textInput.value = ""; titleInput.value = "";
  showToast("텍스트 공유 완료");
  await loadShares();
}

async function deleteShare(item, itemEl) {
  if (item.type === "file" && item.file_path)
    await supabaseClient.storage.from(BUCKET_NAME).remove([item.file_path]);
  const { error } = await supabaseClient.from("shares").delete().eq("id", item.id);
  if (error) { showToast("삭제 실패"); resetDeleteBtn(itemEl); }
  else { shares = shares.filter(s => s.id !== item.id); renderShares(); showToast("삭제 완료"); }
}

async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const el = document.createElement("textarea");
    el.value = text; el.setAttribute("style","position:fixed;left:-9999px;top:-9999px");
    document.body.appendChild(el); el.select(); document.execCommand("copy"); document.body.removeChild(el);
  }
  showToast("클립보드에 복사됨");
}

// ── 데이터 ───────────────────────────────────────────────
async function loadShares() {
  const { data, error } = await supabaseClient
    .from("shares").select("*")
    .eq("owner_email", OWNER_EMAIL)
    .order("created_at", { ascending: false }).limit(200);

  if (error) {
    statusBadge.textContent = "연결 확인 필요";
    showToast("Supabase 설정 또는 RLS 정책을 확인하세요.");
    shareList.replaceChildren(); return;
  }
  const now = Date.now();
  shares = (data || []).filter(item => !item.expires_at || new Date(item.expires_at).getTime() > now);
  statusBadge.textContent = "Supabase 연결됨";
  renderShares();
}

function subscribeRealtime() {
  if (rtChannel) supabaseClient.removeChannel(rtChannel);
  rtChannel = supabaseClient.channel("shares-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "shares" }, loadShares)
    .subscribe(status => {
      if (status === "CLOSED" || status === "CHANNEL_ERROR") setTimeout(subscribeRealtime, 3000);
    });
}

// ── 렌더링 ───────────────────────────────────────────────
function getSorted(arr) {
  const s = sortSelect.value;
  return [...arr].sort((a, b) => {
    if (s === "oldest") return new Date(a.created_at) - new Date(b.created_at);
    if (s === "size")   return (b.file_size || 0) - (a.file_size || 0);
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

function renderShares() {
  const keyword  = searchInput.value.trim().toLowerCase();
  const filtered = getSorted(shares).filter(item =>
    `${item.title||""} ${item.content||""}`.toLowerCase().includes(keyword)
  );
  const visible = filtered.slice(0, displayCount);

  shareList.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = keyword ? "검색 결과가 없습니다." : "아직 공유된 자료가 없습니다.";
    shareList.appendChild(empty);
    loadMoreBtn.hidden = true; return;
  }
  visible.forEach(item => shareList.appendChild(createItemEl(item)));
  loadMoreBtn.hidden = filtered.length <= displayCount;
}

function createItemEl(item) {
  const isFile  = item.type === "file";
  const isImage = isFile && item.mime_type?.startsWith("image/");
  const isOwner = item.owner_token === OWNER_TOKEN || !item.owner_token;
  const date    = new Date(item.created_at).toLocaleString("ko-KR", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const size = item.file_size != null ? formatBytes(item.file_size) : "텍스트";

  const article = document.createElement("article");
  article.className = "item"; article.dataset.id = item.id;

  // 체크박스
  const cb = document.createElement("input");
  cb.type = "checkbox"; cb.className = "item-check";
  if (selectedIds.has(item.id)) cb.checked = true;

  // 아이콘 / 썸네일
  const iconDiv = document.createElement("div");
  iconDiv.className = "icon";
  if (isImage && item.file_url) {
    const thumb = document.createElement("img");
    thumb.src     = thumbUrl(item.file_url, 88);
    thumb.alt     = "";
    thumb.loading = "lazy";
    thumb.addEventListener("click", e => {
      e.stopPropagation();
      lightboxImg.src = item.file_url;
      lightbox.classList.add("open");
    });
    iconDiv.appendChild(thumb);
  } else {
    iconDiv.textContent = isFile ? getFileIcon(item.mime_type) : "📝";
  }

  // 본문
  const body = document.createElement("div"); body.className = "item-body";

  const titleEl = document.createElement("p");
  titleEl.className   = "item-title";
  titleEl.textContent = item.title || "제목 없음";
  titleEl.title       = item.title || "";
  if (isOwner) titleEl.dataset.action = "rename";

  const meta = document.createElement("div"); meta.className = "item-meta";
  if (item.owner_email) {
    const av = document.createElement("span");
    av.className = "avatar";
    av.style.background = getAvatarColor(item.owner_email);
    av.textContent = getInitial(item.owner_email);
    av.title = item.owner_email;
    meta.appendChild(av);
  }
  let metaText = `${date} · ${size}`;
  if (item.expires_at) {
    const diffMs = new Date(item.expires_at) - Date.now();
    const h = Math.floor(diffMs / 3_600_000), m = Math.floor((diffMs % 3_600_000) / 60_000);
    metaText += ` · ⏱ ${h > 0 ? `${h}시간` : `${m}분`} 후 만료`;
  }
  meta.appendChild(document.createTextNode(metaText));
  body.appendChild(titleEl); body.appendChild(meta);

  // 텍스트: 한줄 스니펫 + 펼치기
  if (!isFile && item.content) {
    const snippet = document.createElement("div");
    snippet.className   = "item-snippet";
    snippet.textContent = item.content.replace(/\s+/g, " ").trim();
    body.appendChild(snippet);

    const full = document.createElement("div");
    full.className = "text-full";
    full.innerHTML = DOMPurify.sanitize(marked.parse(item.content));
    body.appendChild(full);

    const expBtn = document.createElement("button");
    expBtn.className = "expand-btn"; expBtn.dataset.action = "expand";
    expBtn.textContent = "펼치기";
    body.appendChild(expBtn);
  }

  // 액션
  const actions = document.createElement("div"); actions.className = "item-actions";

  if (isFile && item.file_url) {
    const openA = document.createElement("a");
    openA.href = item.file_url; openA.target = "_blank"; openA.rel = "noreferrer";
    const openBtn = document.createElement("button"); openBtn.textContent = "열기";
    openA.appendChild(openBtn); actions.appendChild(openA);

    const dlA = document.createElement("a");
    dlA.href = item.file_url; dlA.download = item.title || "file"; dlA.rel = "noreferrer";
    const dlBtn = document.createElement("button"); dlBtn.className = "secondary"; dlBtn.textContent = "↓";
    dlBtn.title = "다운로드";
    dlA.appendChild(dlBtn); actions.appendChild(dlA);

    const cuBtn = document.createElement("button");
    cuBtn.className = "secondary"; cuBtn.dataset.action = "copy-url";
    cuBtn.textContent = "링크"; cuBtn.title = "URL 복사";
    actions.appendChild(cuBtn);

    const qrBtn = document.createElement("button");
    qrBtn.className = "secondary"; qrBtn.dataset.action = "show-qr"; qrBtn.textContent = "QR";
    actions.appendChild(qrBtn);
  } else if (!isFile) {
    const copyBtn = document.createElement("button");
    copyBtn.dataset.action = "copy"; copyBtn.textContent = "복사";
    actions.appendChild(copyBtn);

    const qrBtn = document.createElement("button");
    qrBtn.className = "secondary"; qrBtn.dataset.action = "show-qr"; qrBtn.textContent = "QR";
    actions.appendChild(qrBtn);
  }

  if (isOwner) {
    const delBtn = document.createElement("button");
    delBtn.className = "danger"; delBtn.dataset.action = "delete-request"; delBtn.textContent = "✕";
    delBtn.title = "삭제";
    actions.appendChild(delBtn);
  }

  article.appendChild(cb);
  article.appendChild(iconDiv);
  article.appendChild(body);
  article.appendChild(actions);
  return article;
}

// ── 유틸 ─────────────────────────────────────────────────
function thumbUrl(url, w = 400) {
  return url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/") + `?width=${w}&resize=cover`;
}

function getFileIcon(m = "") {
  if (m.startsWith("image/"))                         return "🖼️";
  if (m.startsWith("video/"))                         return "🎬";
  if (m.startsWith("audio/"))                         return "🎵";
  if (m === "application/pdf")                        return "📄";
  if (/spreadsheet|excel/i.test(m))                   return "📊";
  if (/document|word|presentation|powerpoint/i.test(m)) return "📝";
  if (/zip|rar|compress|archive|7z/i.test(m))         return "🗜️";
  if (m.startsWith("text/"))                          return "📃";
  return "📎";
}

function setProgress(pct) {
  if (pct === null) { progressWrap.hidden = true; progressBar.style.width = "0%"; return; }
  progressWrap.hidden = false; progressBar.style.width = `${pct}%`;
}

function renderSkeleton() {
  shareList.replaceChildren();
  for (let i = 0; i < 3; i++) {
    const sk = document.createElement("div"); sk.className = "skeleton"; shareList.appendChild(sk);
  }
}

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const u = ["B","KB","MB","GB"], i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

function showToast(msg) {
  toast.textContent = msg; toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2500);
}
