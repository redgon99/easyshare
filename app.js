const TITLE_MAX_LEN = 28;
const FILE_SIZE_MAX = 50 * 1024 * 1024;
const PAGE_SIZE     = 20;

// Supabase Auth 세션이 소유권의 기준. RLS는 auth.uid()로 검증한다.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let CURRENT_USER = null;   // supabase auth user 객체
let OWNER_EMAIL  = "";     // CURRENT_USER.email (표시·필터용)

function setUser(user) {
  CURRENT_USER = user || null;
  OWNER_EMAIL  = normalizeEmail(user?.email || "");
}

const composerCard   = document.querySelector("#composerCard");
const composerTitle  = document.querySelector("#composerTitle");
const composerText   = document.querySelector("#composerText");
const fileInput      = document.querySelector("#fileInput");
const cameraInput    = document.querySelector("#cameraInput");
const postExpiry     = document.querySelector("#postExpiry");
const fileQueueEl    = document.querySelector("#fileQueue");
const sharePostBtn   = document.querySelector("#sharePostBtn");
const clearPostBtn   = document.querySelector("#clearPostBtn");
const shareList      = document.querySelector("#shareList");
const loadMoreBtn    = document.querySelector("#loadMoreBtn");
const searchInput    = document.querySelector("#searchInput");
const sortSelect     = document.querySelector("#sortSelect");
const filterChips    = document.querySelector("#filterChips");
const suggestBar     = document.querySelector("#suggestBar");
const multiCancelBtn = document.querySelector("#multiCancelBtn");
const multiMergeBtn  = document.querySelector("#multiMergeBtn");
const multiDeleteBtn = document.querySelector("#multiDeleteBtn");
const mergeModal     = document.querySelector("#mergeModal");
const mergeModalDesc = document.querySelector("#mergeModalDesc");
const mergeTitleInput = document.querySelector("#mergeTitleInput");
const mergeConfirmBtn = document.querySelector("#mergeConfirmBtn");
const mergeCancelBtn  = document.querySelector("#mergeCancelBtn");
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
const editModal        = document.querySelector("#editModal");
const editModalHeading = document.querySelector("#editModalHeading");
const editTextFields   = document.querySelector("#editTextFields");
const editFileFields   = document.querySelector("#editFileFields");
const editTitleInput   = document.querySelector("#editTitleInput");
const editContentInput = document.querySelector("#editContentInput");
const editFileCurrent  = document.querySelector("#editFileCurrent");
const editFileInput    = document.querySelector("#editFileInput");
const editFilePickLabel = document.querySelector("#editFilePickLabel");
const editSaveBtn      = document.querySelector("#editSaveBtn");
const editCancelBtn    = document.querySelector("#editCancelBtn");
let editingItem = null;

// 공유 링크(?share=id)로 접근하면 로그인 없이 해당 게시물만 표시
const SHARE_VIEW_ID = new URLSearchParams(location.search).get("share");

// 저장된 세션 유무로 초기 화면을 추정 (getSession 확정 전 깜빡임 방지)
const HAS_SESSION_HINT = Object.keys(localStorage).some(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
document.getElementById('loginScreen').hidden = HAS_SESSION_HINT || !!SHARE_VIEW_ID;
document.querySelector('.app').hidden = !HAS_SESSION_HINT && !SHARE_VIEW_ID;

let shares       = [];
let displayCount = PAGE_SIZE;
let rtChannel    = null;
let isUploading  = false;
let selectedIds  = new Set();
let activeFilter = "all";
/** @type {{ id: string, file: File }[]} */
let fileQueue    = [];
/** @type {Map<string, 'list'|'grid'>} */
const bundleViewMode = new Map();

init();

async function init() {
  loadTheme();
  if (SHARE_VIEW_ID) {
    await startShareView(SHARE_VIEW_ID);
    return;
  }

  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") location.reload();
  });

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    setUser(session.user);
    document.getElementById('loginScreen').hidden = true;
    document.querySelector('.app').hidden = false;
    await startApp();
    return;
  }

  document.getElementById('loginScreen').hidden = false;
  document.querySelector('.app').hidden = true;
  document.getElementById('loginBtn').addEventListener('click', () => submitAuth('login'));
  document.getElementById('signupBtn').addEventListener('click', () => submitAuth('signup'));
  document.getElementById('loginPasswordInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitAuth('login');
  });
}

// ── 공유 링크 보기 ───────────────────────────────────────
async function startShareView(id) {
  document.body.classList.add("share-view");
  bindEvents();

  const banner = document.createElement("div");
  banner.className = "share-banner";
  banner.innerHTML = `🔗 공유된 게시물입니다. <a href="${location.pathname}">전체 자료함 열기</a>`;
  shareList.closest(".card").prepend(banner);

  renderSkeleton();
  const { data, error } = await supabaseClient
    .from("shares").select("*").eq("id", id).maybeSingle();

  shareList.replaceChildren();
  if (error || !data || (data.expires_at && new Date(data.expires_at) <= new Date())) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "게시물을 찾을 수 없거나 만료되었습니다.";
    shareList.appendChild(empty);
    statusBadge.textContent = "공유 보기";
    return;
  }
  shares = [data];
  statusBadge.textContent = "공유 보기";
  shareList.appendChild(createItemEl(data));
}

function shareLinkFor(id) {
  return `${location.origin}${location.pathname}?share=${id}`;
}

async function startApp() {
  bindEvents();
  updateProfileBtn();
  logVisit();
  renderSkeleton();
  await claimMyShares();
  await loadShares();
  subscribeRealtime();
}

/** 계정 도입 전 자료(owner_email 일치)를 내 계정으로 연결 */
async function claimMyShares() {
  const { data, error } = await supabaseClient.rpc("claim_my_shares");
  if (!error && data > 0) showToast(`기존 자료 ${data}개를 계정에 연결했습니다`);
}

function logVisit() {
  supabaseClient.from('visits').insert({
    owner_email: OWNER_EMAIL,
    user_agent: navigator.userAgent.slice(0, 250),
  }).then(() => {});
}

async function submitAuth(mode) {
  const emailInput = document.getElementById('loginEmailInput');
  const pwInput    = document.getElementById('loginPasswordInput');
  const errEl      = document.getElementById('loginError');
  const email      = normalizeEmail(emailInput.value);
  const password   = pwInput.value;

  if (!email || !email.includes('@')) {
    errEl.textContent = '올바른 이메일 주소를 입력하세요.';
    emailInput.focus();
    return;
  }
  if (!password || password.length < 6) {
    errEl.textContent = '비밀번호는 6자 이상이어야 합니다.';
    pwInput.focus();
    return;
  }
  errEl.classList.remove('ok');
  errEl.textContent = '처리 중…';

  const { data, error } = mode === 'signup'
    ? await supabaseClient.auth.signUp({
        email, password,
        // 인증 메일의 링크를 누르면 이 앱으로 돌아와 자동 로그인됨
        options: { emailRedirectTo: location.origin + location.pathname },
      })
    : await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    errEl.textContent = translateAuthError(error);
    return;
  }
  if (!data.session) {
    // Confirm email 사용: 세션 없이 가입만 완료된 상태
    errEl.classList.add('ok');
    errEl.textContent = '인증 메일을 보냈습니다. 메일함(스팸함 포함)에서 링크를 누르면 자동으로 로그인됩니다.';
    return;
  }

  setUser(data.session.user);
  errEl.textContent = '';
  const ls = document.getElementById('loginScreen');
  ls.classList.add('fade-out');
  setTimeout(async () => {
    ls.hidden = true;
    document.querySelector('.app').hidden = false;
    await startApp();
  }, 300);
}

function translateAuthError(error) {
  const msg = error?.message || '';
  if (/invalid login credentials/i.test(msg))    return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (/already registered/i.test(msg))           return '이미 가입된 이메일입니다. 로그인해 주세요.';
  if (/email.*invalid|invalid.*email/i.test(msg)) return '사용할 수 없는 이메일 주소입니다.';
  if (/password.*(short|least)/i.test(msg))      return '비밀번호가 너무 짧습니다 (6자 이상).';
  if (/rate limit|too many/i.test(msg))          return '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.';
  if (/not confirmed/i.test(msg))                return '이메일 인증이 완료되지 않은 계정입니다.';
  return `오류: ${msg}`;
}

// ── 이벤트 바인딩 ────────────────────────────────────────
function bindEvents() {
  // 작성기 카드 = 드롭존
  ["dragenter","dragover"].forEach(evt =>
    composerCard.addEventListener(evt, e => { e.preventDefault(); composerCard.classList.add("dragover"); })
  );
  ["dragleave","drop"].forEach(evt =>
    composerCard.addEventListener(evt, e => { e.preventDefault(); composerCard.classList.remove("dragover"); })
  );
  composerCard.addEventListener("drop", e => queueFiles([...e.dataTransfer.files]));
  fileInput.addEventListener("change",   e => { queueFiles([...e.target.files]); fileInput.value = ""; });
  cameraInput.addEventListener("change", e => { queueFiles([...e.target.files]); cameraInput.value = ""; });

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
    if (e.target.closest("#composerCard")) return;
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) { e.preventDefault(); queueFiles(files); }
  });

  // 클립보드 붙여넣기
  document.addEventListener("paste", e => {
    const items = [...(e.clipboardData?.items || [])];
    const fileItems = items.filter(i => i.kind === "file");
    if (fileItems.length) {
      e.preventDefault();
      queueFiles(fileItems.map(i => i.getAsFile()).filter(Boolean));
    }
  });

  // 게시물 공유
  sharePostBtn.addEventListener("click", sharePost);
  clearPostBtn.addEventListener("click", clearComposer);
  fileQueueEl.addEventListener("click", e => {
    const btn = e.target.closest("[data-queue-remove]");
    if (!btn) return;
    removeFromFileQueue(btn.dataset.queueRemove);
  });

  // 검색 / 정렬 / 필터
  searchInput.addEventListener("input", () => { displayCount = PAGE_SIZE; renderShares(); });
  sortSelect.addEventListener("change",  () => { displayCount = PAGE_SIZE; renderShares(); });
  filterChips.addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    activeFilter = chip.dataset.filter;
    filterChips.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === chip));
    displayCount = PAGE_SIZE;
    renderShares();
  });

  // 더 보기
  loadMoreBtn.addEventListener("click", () => { displayCount += PAGE_SIZE; renderShares(); });

  // 멀티셀렉트
  multiCancelBtn.addEventListener("click", () => { exitMultiSelect(); renderShares(); });
  multiMergeBtn.addEventListener("click", openMergeModal);
  multiDeleteBtn.addEventListener("click", deleteSelected);

  mergeConfirmBtn.addEventListener("click", confirmMerge);
  mergeCancelBtn.addEventListener("click", closeMergeModal);
  mergeModal.addEventListener("click", e => { if (e.target === mergeModal) closeMergeModal(); });
  mergeTitleInput.addEventListener("keydown", e => { if (e.key === "Enter") confirmMerge(); });

  // 이벤트 위임
  shareList.addEventListener("click",  handleItemAction);
  shareList.addEventListener("change", handleItemCheck);

  // 라이트박스 닫기
  lightbox.addEventListener("click", () => lightbox.classList.remove("open"));
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      lightbox.classList.remove("open");
      qrModal.classList.remove("open");
      closeAccountModal();
      closeEditModal();
      closeMergeModal();
    }
  });

  // QR 닫기
  qrClose.addEventListener("click", () => qrModal.classList.remove("open"));
  qrModal.addEventListener("click", e => { if (e.target === qrModal) qrModal.classList.remove("open"); });

  // 다크모드
  themeBtn.addEventListener("click", toggleTheme);

  // 프로필 / 계정
  profileBtn.addEventListener("click", openAccountModal);
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("accountCancelBtn").addEventListener("click", closeAccountModal);
  emailModal.addEventListener("click", e => { if (e.target === emailModal) closeAccountModal(); });

  editSaveBtn.addEventListener("click", saveEdit);
  editCancelBtn.addEventListener("click", closeEditModal);
  editModal.addEventListener("click", e => { if (e.target === editModal) closeEditModal(); });
  editFileInput.addEventListener("change", () => {
    const file = editFileInput.files?.[0];
    const pick = editFileInput.closest(".edit-file-pick");
    if (file) {
      pick?.classList.add("has-file");
      editFilePickLabel.textContent = file.name;
    } else {
      pick?.classList.remove("has-file");
      editFilePickLabel.textContent = "새 파일 선택";
    }
  });

  bindLongPress();
}

/** RLS 정책과 동일한 기준: 내 계정(user_id) 소유이거나 완전 무소유 레거시 */
function isItemOwner(item) {
  if (!CURRENT_USER) return false;
  if (item.user_id) return item.user_id === CURRENT_USER.id;
  if (item.owner_email) return normalizeEmail(item.owner_email) === OWNER_EMAIL;
  return !item.owner_token;
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

// ── 계정 / 프로필 ────────────────────────────────────────
function openAccountModal() {
  document.getElementById("accountEmail").textContent = OWNER_EMAIL || "-";
  emailModal.classList.add("open");
}
function closeAccountModal() {
  emailModal.classList.remove("open");
}
async function logout() {
  closeAccountModal();
  showToast("로그아웃 중…");
  await supabaseClient.auth.signOut();
  location.reload();
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
// ── 멀티셀렉트 ───────────────────────────────────────────
// 체크박스는 항목에 마우스를 올리면 나타나고(모바일은 길게 누르기),
// 하나라도 선택되면 전체 체크박스와 합치기/삭제 버튼이 표시된다.
function updateMultiSelectUi() {
  const n = selectedIds.size;
  document.body.classList.toggle("multiselect", n > 0);
  multiDeleteBtn.textContent = `선택 삭제 (${n})`;
  multiMergeBtn.textContent = `합치기 (${n})`;
  multiMergeBtn.disabled = n < 2;
}

function exitMultiSelect() {
  selectedIds.clear();
  updateMultiSelectUi();
}

function handleItemCheck(e) {
  const cb = e.target.closest(".item-check");
  if (!cb) return;
  const id = cb.closest(".item")?.dataset.id;
  if (!id) return;
  cb.checked ? selectedIds.add(id) : selectedIds.delete(id);
  cb.closest(".item").classList.toggle("selected", cb.checked);
  updateMultiSelectUi();
}

// 모바일: 항목을 길게 누르면 선택 토글
let longPressTimer = null;
function bindLongPress() {
  shareList.addEventListener("pointerdown", e => {
    const itemEl = e.target.closest(".item");
    if (!itemEl || e.target.closest("button, a, input")) return;
    longPressTimer = setTimeout(() => {
      const cb = itemEl.querySelector(".item-check");
      if (!cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }, 500);
  });
  ["pointerup", "pointermove", "pointercancel"].forEach(evt =>
    shareList.addEventListener(evt, () => clearTimeout(longPressTimer))
  );
}

function getMergeTargets() {
  return shares.filter(s => selectedIds.has(s.id));
}

function openMergeModal() {
  if (selectedIds.size < 2) {
    showToast("합치려면 2개 이상 선택하세요.");
    return;
  }
  const targets = getMergeTargets();
  if (!targets.every(isItemOwner)) {
    showToast("이 계정의 자료만 합칠 수 있습니다.");
    return;
  }
  const fileCount = targets.reduce((n, item) => n + getShareFiles(item).length, 0);
  const textCount = targets.filter(t => getShareText(t)).length;
  const parts = [];
  if (fileCount) parts.push(`파일 ${fileCount}개`);
  if (textCount) parts.push(`글 ${textCount}개`);
  mergeModalDesc.textContent = `선택한 ${targets.length}개 항목(${parts.join(", ")})을 하나로 합칩니다.`;
  mergeTitleInput.value = "";
  mergeModal.classList.add("open");
  setTimeout(() => mergeTitleInput.focus(), 50);
}

function closeMergeModal() {
  mergeModal.classList.remove("open");
  mergeConfirmBtn.disabled = false;
}

async function confirmMerge() {
  const title = mergeTitleInput.value.trim();
  if (!title) { showToast("제목을 입력하세요."); return; }

  const targets = getMergeTargets();
  if (targets.length < 2) { closeMergeModal(); return; }

  mergeConfirmBtn.disabled = true;
  // 오래된 항목부터 순서대로 이어붙인다
  const sorted = [...targets].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const seen = new Set();
  const files = [];
  for (const item of sorted) {
    for (const f of getShareFiles(item)) {
      if (!f.path || seen.has(f.path)) continue;
      seen.add(f.path);
      files.push(f);
    }
  }
  const texts = sorted.map(getShareText).filter(Boolean);
  const content = texts.join("\n\n---\n\n") || null;

  if (!files.length && !content) {
    showToast("합칠 내용이 없습니다.");
    mergeConfirmBtn.disabled = false;
    return;
  }

  const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
  const first = files[0];
  const expiries = targets.map(t => t.expires_at).filter(Boolean).map(d => new Date(d).getTime());
  const expiresAt = expiries.length ? new Date(Math.min(...expiries)).toISOString() : null;

  const { error: insertError } = await supabaseClient.from("shares").insert({
    type: files.length ? "files" : "text",
    title,
    content,
    files: files.length ? files : null,
    file_path: first?.path ?? null,
    file_url: first?.url ?? null,
    file_name: first?.name ?? null,
    file_size: files.length ? totalSize : null,
    mime_type: first?.mime ?? null,
    user_id: CURRENT_USER.id,
    owner_email: OWNER_EMAIL || null,
    ...(expiresAt && { expires_at: expiresAt }),
  });

  if (insertError) {
    console.error("merge insert:", insertError);
    showToast(`합치기 실패: ${insertError.message || "DB 오류"}`);
    mergeConfirmBtn.disabled = false;
    return;
  }

  for (const item of targets) {
    await supabaseClient.from("shares").delete().eq("id", item.id);
  }

  closeMergeModal();
  exitMultiSelect();
  await loadShares();
  showToast(`${targets.length}개 항목을 하나로 합쳤습니다`);
}

async function deleteSelected() {
  if (!selectedIds.size) return;
  if (!confirm(`선택한 ${selectedIds.size}개 항목을 삭제할까요?`)) return;
  const targets = shares.filter(s => selectedIds.has(s.id));
  for (const item of targets) {
    await removeShareStorage(item);
    await supabaseClient.from("shares").delete().eq("id", item.id);
  }
  exitMultiSelect();
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

  if (action === "more") {
    const acts = btn.closest(".item-actions");
    const open = acts.classList.toggle("open");
    btn.textContent = open ? "−" : "+";
    btn.title = open ? "접기" : "더 보기";
  }
  if (action === "copy"            && item) { await copyToClipboard(getShareText(item) || item.title || ""); }
  if (action === "share-link"      && item) {
    await copyToClipboard(shareLinkFor(item.id));
    showToast("공유 링크가 복사되었습니다");
  }
  if (action === "delete"          && item) {
    if (confirm(`"${item.title || "제목 없음"}" 항목을 삭제할까요?`)) await deleteShare(item);
  }
  if (action === "expand"                  ) { toggleExpand(btn); }
  if (action === "view-list" || action === "view-grid") { setBundleView(itemEl, action === "view-list" ? "list" : "grid"); }
  if (action === "show-qr"         && item) {
    const files = getShareFiles(item);
    const text  = getShareText(item);
    if (files.length === 1 && !text) openQr(files[0].url);
    else if (!files.length && text)  openQr(text);
    else                             openQr(shareLinkFor(item.id));
  }
  if (action === "edit"            && item) { openEditModal(item); }
}

function toggleExpand(btn) {
  const item = btn.closest(".item");
  const expanded = item.classList.toggle("open");
  btn.textContent = expanded ? "접기" : "펼치기";
}

function setBundleView(itemEl, mode) {
  if (!itemEl) return;
  const wrap = itemEl.querySelector(".bundle-wrap");
  if (!wrap) return;
  bundleViewMode.set(itemEl.dataset.id, mode);
  wrap.classList.toggle("view-list", mode === "list");
  wrap.classList.toggle("view-grid", mode === "grid");
  wrap.querySelectorAll("[data-action='view-list'], [data-action='view-grid']").forEach(b => {
    b.classList.toggle("active", b.dataset.action === `view-${mode}`);
  });
}

function buildBundleListEl(files) {
  const ul = document.createElement("ul");
  ul.className = "bundle-files";
  files.forEach(f => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "bf-name";
    name.textContent = f.name;
    name.title = f.name;
    const sz = document.createElement("span");
    sz.className = "bf-size";
    sz.textContent = formatBytes(f.size);
    const acts = document.createElement("span");
    acts.className = "bf-actions";
    const openA = document.createElement("a");
    openA.href = f.url; openA.target = "_blank"; openA.rel = "noreferrer";
    const openB = document.createElement("button");
    openB.textContent = "열기";
    openA.appendChild(openB);
    const dlA = document.createElement("a");
    dlA.href = fileDownloadUrl(f.url, f.name); dlA.download = f.name; dlA.rel = "noreferrer";
    const dlB = document.createElement("button");
    dlB.className = "secondary"; dlB.textContent = "↓";
    dlA.appendChild(dlB);
    acts.append(openA, dlA);
    li.append(name, sz, acts);
    ul.appendChild(li);
  });
  return ul;
}

function buildBundleGridEl(files) {
  const grid = document.createElement("div");
  grid.className = "bundle-grid";
  files.forEach(f => {
    const tile = document.createElement("a");
    tile.className = "bundle-tile";
    tile.href = f.url;
    tile.target = "_blank";
    tile.rel = "noreferrer";
    tile.title = `${f.name} (${formatBytes(f.size)})`;
    const thumb = document.createElement("div");
    thumb.className = "bundle-tile-thumb";
    if (f.mime?.startsWith("image/") && f.url) {
      const img = document.createElement("img");
      img.src = thumbUrl(f.url, 96);
      img.alt = f.name;
      img.loading = "lazy";
      img.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        lightboxImg.src = f.url;
        lightbox.classList.add("open");
      });
      thumb.appendChild(img);
    } else {
      thumb.textContent = getFileIcon(f.mime);
    }
    const label = document.createElement("span");
    label.className = "bundle-tile-name";
    label.textContent = f.name;
    tile.append(thumb, label);
    grid.appendChild(tile);
  });
  return grid;
}

function openQr(text) {
  if (!text) return;
  qrCanvas.innerHTML = "";
  new QRCode(qrCanvas, { text, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
  qrLabel.textContent = text.length > 60 ? text.slice(0, 60) + "…" : text;
  qrModal.classList.add("open");
}

function openEditModal(item) {
  if (!isItemOwner(item)) { showToast("이 계정으로 올린 자료만 수정할 수 있습니다."); return; }
  editingItem = item;
  editFileInput.value = "";
  editFileInput.closest(".edit-file-pick")?.classList.remove("has-file");
  editFilePickLabel.textContent = "새 파일 선택";

  const files = getShareFiles(item);
  editModalHeading.textContent = "게시물 수정";
  editTextFields.hidden = false;
  editTitleInput.value = item.title || "";
  editContentInput.value = getShareText(item);

  // 파일 교체는 단일 첨부일 때만 지원
  if (files.length === 1) {
    editFileFields.hidden = false;
    editFileCurrent.textContent = `현재 파일: ${files[0].name}${files[0].size != null ? ` (${formatBytes(files[0].size)})` : ""}`;
  } else {
    editFileFields.hidden = true;
  }

  editModal.classList.add("open");
  setTimeout(() => editTitleInput.focus(), 50);
}

function closeEditModal() {
  editModal.classList.remove("open");
  editingItem = null;
  editSaveBtn.disabled = false;
}

async function saveEdit() {
  if (!editingItem) return;
  if (!isItemOwner(editingItem)) { showToast("수정 권한이 없습니다."); closeEditModal(); return; }

  editSaveBtn.disabled = true;
  try {
    const files   = getShareFiles(editingItem);
    const content = editContentInput.value.trim();
    if (!content && !files.length) { showToast("내용을 입력하세요."); return; }

    const rawTitle = editTitleInput.value.trim();
    const title = rawTitle
      || (content ? (content.length > TITLE_MAX_LEN ? content.slice(0, TITLE_MAX_LEN) + "…" : content)
                  : (files[0]?.name || "제목 없음"));

    const { error } = await supabaseClient.from("shares")
      .update({ title, content: content || null })
      .eq("id", editingItem.id);
    if (error) { showToast("수정 실패"); return; }
    editingItem.title = title;
    editingItem.content = content || null;

    // 단일 첨부이고 새 파일을 골랐으면 파일도 교체
    const newFile = editFileInput.files?.[0];
    if (files.length === 1 && newFile) {
      const ok = await replaceFileItem(editingItem, newFile);
      if (!ok) return;
      showToast("파일 교체 완료");
      closeEditModal();
      await loadShares();
      return;
    }

    showToast("수정 완료");
    closeEditModal();
    renderShares();
  } finally {
    editSaveBtn.disabled = false;
  }
}

async function replaceFileItem(item, file) {
  if (file.size > FILE_SIZE_MAX) {
    showToast(`파일 크기 초과 (최대 50 MB)`);
    return false;
  }

  const oldPaths = getShareFiles(item).map(f => f.path).filter(Boolean);
  const oldPath = oldPaths[0];
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${Date.now()}-${generateId()}-${safeName}`;

  showProgress(true);
  showToast(`${file.name} 업로드 중…`);

  const { error: uploadError } = await supabaseClient.storage.from(BUCKET_NAME).upload(path, file, { upsert: false });

  if (uploadError) {
    showProgress(false);
    showToast(`업로드 실패: ${file.name}`);
    return false;
  }

  const { data: urlData } = supabaseClient.storage.from(BUCKET_NAME).getPublicUrl(path);
  const newFile = {
    path,
    url: urlData.publicUrl,
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
  };
  const { error: updateError } = await supabaseClient.from("shares").update({
    files: [newFile],
    file_path: path,
    file_url: newFile.url,
    file_name: file.name,
    file_size: file.size,
    mime_type: newFile.mime,
  }).eq("id", item.id);

  showProgress(false);

  if (updateError) {
    await supabaseClient.storage.from(BUCKET_NAME).remove([path]);
    showToast("파일 정보 저장 실패");
    return false;
  }

  if (oldPath && oldPath !== path) {
    await supabaseClient.storage.from(BUCKET_NAME).remove(oldPaths);
  }
  return true;
}

// ── 업로드 ───────────────────────────────────────────────
function lockUpload(lock) {
  isUploading = lock;
  composerCard.classList.toggle("locked", lock);
  fileInput.disabled    = lock;
  cameraInput.disabled  = lock;
  sharePostBtn.disabled = lock;
  clearPostBtn.disabled = lock;
}

function calcExpiresAt(minutesStr) {
  if (!minutesStr) return null;
  const d = new Date();
  d.setMinutes(d.getMinutes() + parseInt(minutesStr, 10));
  return d.toISOString();
}

function queueFiles(files) {
  if (isUploading) return;
  let added = 0;
  for (const file of files) {
    if (!file) continue;
    if (file.size > FILE_SIZE_MAX) {
      showToast(`파일 크기 초과: ${file.name} (최대 50 MB)`);
      continue;
    }
    const dup = fileQueue.some(
      q => q.file.name === file.name && q.file.size === file.size && q.file.lastModified === file.lastModified
    );
    if (dup) continue;
    fileQueue.push({ id: generateId(), file });
    added++;
  }
  if (added) {
    renderFileQueue();
    showToast(`${added}개 파일 추가됨`);
  }
}

function removeFromFileQueue(id) {
  fileQueue = fileQueue.filter(q => q.id !== id);
  renderFileQueue();
}

function clearComposer() {
  fileQueue = [];
  composerTitle.value = "";
  composerText.value = "";
  fileInput.value = "";
  cameraInput.value = "";
  renderFileQueue();
}

function renderFileQueue() {
  fileQueueEl.replaceChildren();
  if (!fileQueue.length) {
    fileQueueEl.hidden = true;
    sharePostBtn.textContent = "공유";
    return;
  }
  fileQueueEl.hidden = false;
  sharePostBtn.textContent = `공유 (파일 ${fileQueue.length}개)`;

  fileQueue.forEach(({ id, file }) => {
    const li = document.createElement("li");
    li.className = "file-queue-item";
    li.innerHTML = `
      <span class="file-queue-icon">${getFileIcon(file.type)}</span>
      <div class="file-queue-info">
        <div class="file-queue-name" title="${escapeAttr(file.name)}">${escapeHtml(file.name)}</div>
        <div class="file-queue-size">${formatBytes(file.size)}</div>
      </div>
      <button type="button" class="file-queue-remove" data-queue-remove="${id}">제거</button>
    `;
    fileQueueEl.appendChild(li);
  });
}

/** (레거시) content가 파일 묶음 JSON이면 files 배열 반환 */
function parseBundleContent(content) {
  if (!content || typeof content !== "string") return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const data = JSON.parse(trimmed);
    if (!Array.isArray(data.files) || !data.files.length) return null;
    if (!data.files.every(f => f && f.path && f.url)) return null;
    return data.files;
  } catch {
    return null;
  }
}

/** 첨부 파일 목록. files 컬럼 우선, 레거시(content JSON·file_path) 폴백 @returns {{ path, url, name, size, mime }[]} */
function getShareFiles(item) {
  if (Array.isArray(item.files) && item.files.length) return item.files;
  const bundled = parseBundleContent(item.content);
  if (bundled) return bundled;
  if (item.file_path) {
    return [{
      path: item.file_path,
      url: item.file_url,
      name: item.file_name || item.title || "file",
      size: item.file_size,
      mime: item.mime_type || "application/octet-stream",
    }];
  }
  return [];
}

/** 본문 텍스트 (레거시 묶음 JSON은 본문으로 치지 않음) */
function getShareText(item) {
  if (!item.content) return "";
  if (parseBundleContent(item.content)) return "";
  return item.content;
}

function getShareTotalSize(item) {
  return getShareFiles(item).reduce((s, f) => s + (f.size || 0), 0);
}

function getShareSearchText(item) {
  const names = getShareFiles(item).map(f => f.name).join(" ");
  return `${item.title || ""} ${getShareText(item)} ${names}`;
}

async function removeShareStorage(item) {
  const paths = getShareFiles(item).map(f => f.path).filter(Boolean);
  if (paths.length) await supabaseClient.storage.from(BUCKET_NAME).remove(paths);
}

/** 통합 작성기: 글·첨부를 한 게시물로 공유 */
async function sharePost() {
  if (isUploading) return;
  const content = composerText.value.trim();
  const queued  = fileQueue.map(q => q.file);
  if (!content && !queued.length) {
    showToast("내용을 입력하거나 파일을 첨부하세요.");
    return;
  }

  lockUpload(true);
  try {
    const uploaded = await uploadQueuedFiles(queued);
    if (uploaded === null) return; // 업로드 실패 (토스트는 내부에서 표시)

    const expiresAt = calcExpiresAt(postExpiry.value);
    const rawTitle  = composerTitle.value.trim();
    let title = rawTitle;
    if (!title) {
      if (content)                    title = content.length > TITLE_MAX_LEN ? content.slice(0, TITLE_MAX_LEN) + "…" : content;
      else if (uploaded.length === 1) title = uploaded[0].name;
      else                            title = `${uploaded[0].name} 외 ${uploaded.length - 1}개`;
    }
    const first = uploaded[0];

    const { error } = await supabaseClient.from("shares").insert({
      type: uploaded.length ? "files" : "text",
      title,
      content: content || null,
      files: uploaded.length ? uploaded : null,
      file_path: first?.path ?? null,
      file_url: first?.url ?? null,
      file_name: first?.name ?? null,
      file_size: uploaded.length ? uploaded.reduce((s, f) => s + f.size, 0) : null,
      mime_type: first?.mime ?? null,
      user_id: CURRENT_USER.id,
      owner_email: OWNER_EMAIL || null,
      ...(expiresAt && { expires_at: expiresAt }),
    });

    if (error) {
      if (uploaded.length) {
        await supabaseClient.storage.from(BUCKET_NAME).remove(uploaded.map(u => u.path));
      }
      console.error("post insert:", error);
      showToast(`공유 실패: ${error.message || "DB 오류"}`);
      return;
    }
    clearComposer();
    showToast("공유 완료");
    await loadShares();
  } finally {
    lockUpload(false);
  }
}

/** 큐의 파일을 모두 업로드. 성공 시 메타 배열, 실패 시 null (부분 업로드는 롤백) */
async function uploadQueuedFiles(files) {
  if (!files.length) return [];
  const uploaded = [];

  showProgress(true);
  try {
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${Date.now()}-${generateId()}-${safeName}`;
      showToast(`${file.name} 업로드 중… (${uploaded.length + 1}/${files.length})`);

      const { error: uploadError } = await supabaseClient.storage.from(BUCKET_NAME).upload(path, file, { upsert: false });

      if (uploadError) {
        showToast(`업로드 실패: ${file.name}`);
        if (uploaded.length) {
          await supabaseClient.storage.from(BUCKET_NAME).remove(uploaded.map(u => u.path));
        }
        return null;
      }

      const { data: urlData } = supabaseClient.storage.from(BUCKET_NAME).getPublicUrl(path);
      uploaded.push({
        path,
        url: urlData.publicUrl,
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
      });
    }
  } finally {
    showProgress(false);
  }
  return uploaded;
}

async function deleteShare(item) {
  await removeShareStorage(item);
  const { error } = await supabaseClient.from("shares").delete().eq("id", item.id);
  if (error) { showToast("삭제 실패"); }
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
  if (SHARE_VIEW_ID) return;
  // 내 계정 자료 + 소유자 없는 레거시 자료 표시
  const { data, error } = await supabaseClient
    .from("shares").select("*")
    .or(`user_id.eq.${CURRENT_USER.id},owner_email.is.null`)
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
    if (s === "size")   return getShareTotalSize(b) - getShareTotalSize(a);
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

function matchesFilter(item) {
  if (activeFilter === "files") return getShareFiles(item).length > 0;
  if (activeFilter === "text")  return !!getShareText(item);
  if (activeFilter === "image") return getShareFiles(item).some(f => f.mime?.startsWith("image/"));
  return true;
}

function renderShares() {
  const keyword  = searchInput.value.trim().toLowerCase();
  const filtered = getSorted(shares).filter(item =>
    matchesFilter(item) && getShareSearchText(item).toLowerCase().includes(keyword)
  );
  const visible = filtered.slice(0, displayCount);

  renderSuggestion();

  shareList.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = keyword || activeFilter !== "all" ? "조건에 맞는 자료가 없습니다." : "아직 공유된 자료가 없습니다.";
    shareList.appendChild(empty);
    loadMoreBtn.hidden = true; return;
  }
  visible.forEach(item => shareList.appendChild(createItemEl(item)));
  loadMoreBtn.hidden = filtered.length <= displayCount;
  resetListScroll();
}

// ── 유사 항목 합치기 제안 ─────────────────────────────────
function normalizeTitleKey(title = "") {
  return title
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/i, "")          // 확장자
    .replace(/\s*외\s*\d+개\s*$/, "")            // "외 N개"
    .replace(/[\s_\-()\[\]{}.,]+/g, " ")         // 구분 기호
    .replace(/\d+/g, "#")                        // 연번 → #
    .trim();
}

function findSimilarGroup() {
  const mine = shares.filter(isItemOwner);
  const groups = new Map();
  for (const item of mine) {
    const key = normalizeTitleKey(item.title);
    if (key.replace(/[#\s]/g, "").length < 3) continue; // 의미 없는 짧은 키 제외
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const dismissed = new Set(JSON.parse(localStorage.getItem("dismissedSuggests") || "[]"));
  for (const [, items] of groups) {
    if (items.length < 2) continue;
    const sig = items.map(i => i.id).sort().join(",");
    if (dismissed.has(sig)) continue;
    return { items, sig };
  }
  return null;
}

function renderSuggestion() {
  const group = findSimilarGroup();
  if (!group) { suggestBar.hidden = true; suggestBar.replaceChildren(); return; }

  suggestBar.replaceChildren();
  const label = document.createElement("span");
  label.className = "suggest-label";
  const names = group.items.slice(0, 2).map(i => `"${i.title || "제목 없음"}"`).join(", ");
  label.textContent = `💡 비슷한 항목 ${group.items.length}개 발견: ${names}${group.items.length > 2 ? " 외" : ""}`;

  const mergeBtn = document.createElement("button");
  mergeBtn.textContent = "합치기";
  mergeBtn.addEventListener("click", () => {
    selectedIds = new Set(group.items.map(i => i.id));
    updateMultiSelectUi();
    renderShares();
    openMergeModal();
  });

  const dismissBtn = document.createElement("button");
  dismissBtn.className = "secondary";
  dismissBtn.textContent = "무시";
  dismissBtn.addEventListener("click", () => {
    const dismissed = JSON.parse(localStorage.getItem("dismissedSuggests") || "[]");
    dismissed.push(group.sig);
    localStorage.setItem("dismissedSuggests", JSON.stringify(dismissed.slice(-50)));
    renderSuggestion();
  });

  suggestBar.append(label, mergeBtn, dismissBtn);
  suggestBar.hidden = false;
}

/** 스켈레톤 shimmer 등으로 생긴 가로 스크롤 잔여 위치 초기화 */
function resetListScroll() {
  requestAnimationFrame(() => {
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
    shareList.scrollLeft = 0;
  });
}

function createItemEl(item) {
  const files     = getShareFiles(item);
  const text      = getShareText(item);
  const hasFiles  = files.length > 0;
  const firstFile = files[0];
  const firstImg  = firstFile?.mime?.startsWith("image/") ? firstFile : null;
  const isOwner   = isItemOwner(item);
  const date    = new Date(item.created_at).toLocaleString("ko-KR", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const sizeParts = [];
  if (hasFiles) sizeParts.push(files.length > 1 ? `파일 ${files.length}개 · ${formatBytes(getShareTotalSize(item))}` : formatBytes(getShareTotalSize(item)));
  if (text)     sizeParts.push("텍스트");
  const size = sizeParts.join(" + ") || "빈 게시물";

  const article = document.createElement("article");
  article.className = "item"; article.dataset.id = item.id;

  // 체크박스
  const cb = document.createElement("input");
  cb.type = "checkbox"; cb.className = "item-check";
  if (selectedIds.has(item.id)) cb.checked = true;

  // 아이콘 / 썸네일
  const iconDiv = document.createElement("div");
  iconDiv.className = "icon";
  if (firstImg?.url) {
    const thumb = document.createElement("img");
    thumb.src     = thumbUrl(firstImg.url, 88);
    thumb.alt     = "";
    thumb.loading = "lazy";
    thumb.addEventListener("click", e => {
      e.stopPropagation();
      lightboxImg.src = firstImg.url;
      lightbox.classList.add("open");
    });
    iconDiv.appendChild(thumb);
  } else {
    iconDiv.textContent = files.length > 1 ? "📁" : (hasFiles ? getFileIcon(firstFile?.mime) : "📝");
  }

  // 본문
  const body = document.createElement("div"); body.className = "item-body";

  const titleEl = document.createElement("p");
  titleEl.className   = "item-title";
  titleEl.textContent = item.title || "제목 없음";
  titleEl.title       = item.title || "";

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
  body.appendChild(meta); // 제목은 아래에서 액션과 함께 .item-head 로 묶어 맨 위에 삽입

  // 텍스트: 한줄 스니펫 + 펼친 본문
  if (text) {
    const snippet = document.createElement("div");
    snippet.className   = "item-snippet";
    snippet.textContent = text.replace(/\s+/g, " ").trim();
    body.appendChild(snippet);

    const full = document.createElement("div");
    full.className = "text-full";
    full.innerHTML = DOMPurify.sanitize(marked.parse(text));
    body.appendChild(full);
  }

  // 첨부 파일 목록: 2개 이상이거나, 1개라도 파일명이 제목·목록에 드러나지 않을 때 표시
  const showAttachList = files.length > 1
    || (files.length === 1 && (!!text || (item.title && item.title !== firstFile?.name)));
  if (showAttachList) {
    const viewMode = bundleViewMode.get(item.id) || "list";
    const wrap = document.createElement("div");
    wrap.className = `bundle-wrap view-${viewMode}`;

    const preview = document.createElement("div");
    preview.className = "bundle-preview";
    const previewNames = files.slice(0, 3).map(f => f.name).join(", ");
    preview.textContent = files.length > 3
      ? `📎 ${previewNames} 외 ${files.length - 3}개`
      : `📎 ${previewNames}`;

    const toolbar = document.createElement("div");
    toolbar.className = "bundle-toolbar";
    if (files.length > 1) {
      toolbar.innerHTML = `<span class="bundle-toolbar-label">보기</span>`;
      const listBtn = document.createElement("button");
      listBtn.type = "button";
      listBtn.className = `view-btn${viewMode === "list" ? " active" : ""}`;
      listBtn.dataset.action = "view-list";
      listBtn.textContent = "리스트";
      const gridBtn = document.createElement("button");
      gridBtn.type = "button";
      gridBtn.className = `view-btn${viewMode === "grid" ? " active" : ""}`;
      gridBtn.dataset.action = "view-grid";
      gridBtn.textContent = "아이콘";
      toolbar.append(listBtn, gridBtn);
    }

    const bundleBody = document.createElement("div");
    bundleBody.className = "bundle-body";
    bundleBody.append(buildBundleListEl(files), buildBundleGridEl(files));

    if (files.length > 1) wrap.append(preview, toolbar, bundleBody);
    else wrap.append(preview, bundleBody);
    body.appendChild(wrap);
  }

  // 펼치기 버튼 (본문 또는 파일 목록이 있을 때)
  if (text || showAttachList) {
    const expBtn = document.createElement("button");
    expBtn.className = "expand-btn"; expBtn.dataset.action = "expand";
    expBtn.textContent = "펼치기";
    body.appendChild(expBtn);
  }

  // 액션: 공유·다운로드 우선 3개 상시 표시, 나머지는 + 로 펼침
  const actions = document.createElement("div"); actions.className = "item-actions";

  const defs = [];
  if (hasFiles && firstFile?.url) {
    defs.push({ icon: "↗", label: files.length > 1 ? "첫 번째 파일 열기" : "파일 열기", href: firstFile.url });
  }
  if (files.length === 1 && firstFile?.url) {
    defs.push({ icon: "↓", label: "다운로드", href: fileDownloadUrl(firstFile.url, firstFile.name), download: firstFile.name || "file" });
  }
  defs.push({ icon: "🔗", label: "공유 링크 복사", action: "share-link" });
  if (text) defs.push({ icon: "📋", label: "내용 복사", action: "copy" });
  defs.push({ icon: "QR", label: "QR 코드", action: "show-qr" });
  if (isOwner) {
    defs.push({ icon: "✏️", label: "수정", action: "edit" });
    defs.push({ icon: "🗑", label: "삭제", action: "delete", cls: "icon-danger" });
  }

  // 4개 이하면 전부 표시 (+ 하나 숨기려고 + 버튼을 만드는 건 낭비)
  const visibleCount = defs.length <= 4 ? defs.length : 3;

  defs.forEach((d, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = `icon-act ${d.cls || ""}`.trim();
    b.textContent = d.icon; b.title = d.label; b.setAttribute("aria-label", d.label);
    let el = b;
    if (d.href) {
      const a = document.createElement("a");
      a.href = d.href; a.rel = "noreferrer";
      if (d.download) a.download = d.download; else a.target = "_blank";
      a.appendChild(b);
      el = a;
    } else {
      b.dataset.action = d.action;
    }
    if (i >= visibleCount) el.classList.add("extra");
    actions.appendChild(el);
  });

  if (defs.length > visibleCount) {
    const moreBtn = document.createElement("button");
    moreBtn.type = "button"; moreBtn.className = "icon-act more-btn";
    moreBtn.dataset.action = "more"; moreBtn.textContent = "+";
    moreBtn.title = "더 보기"; moreBtn.setAttribute("aria-label", "더 보기");
    actions.appendChild(moreBtn);
  }

  // 제목 + 액션을 한 줄(상단)로 묶기
  const head = document.createElement("div");
  head.className = "item-head";
  head.append(titleEl, actions);
  body.prepend(head);

  article.appendChild(cb);
  article.appendChild(iconDiv);
  article.appendChild(body);
  return article;
}

// ── 유틸 ─────────────────────────────────────────────────
/* supabase-js는 업로드 진행률 콜백을 지원하지 않으므로 진행 중 표시(indeterminate)만 제공 */
function showProgress(on) {
  progressWrap.hidden = !on;
  progressBar.classList.toggle("indeterminate", on);
}

function renderSkeleton() {
  shareList.replaceChildren();
  for (let i = 0; i < 3; i++) {
    const sk = document.createElement("div"); sk.className = "skeleton"; shareList.appendChild(sk);
  }
  resetListScroll();
}

function showToast(msg) {
  toast.textContent = msg; toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2500);
}
