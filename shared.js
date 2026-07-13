/* 공용 유틸 — index(app.js)·admin.html 에서 함께 사용 */

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

function getInitial(email) {
  return email ? email[0].toUpperCase() : "";
}

function getAvatarColor(email) {
  const colors = ["#2563eb", "#7c3aed", "#db2777", "#059669", "#d97706", "#dc2626", "#0891b2"];
  let h = 0;
  for (let i = 0; i < email.length; i++) h = email.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const u = ["B", "KB", "MB", "GB"], i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

function getFileIcon(m = "") {
  if (m.startsWith("image/"))                           return "🖼️";
  if (m.startsWith("video/"))                           return "🎬";
  if (m.startsWith("audio/"))                           return "🎵";
  if (m === "application/pdf")                          return "📄";
  if (/spreadsheet|excel/i.test(m))                     return "📊";
  if (/document|word|presentation|powerpoint/i.test(m)) return "📝";
  if (/zip|rar|compress|archive|7z/i.test(m))           return "🗜️";
  if (m.startsWith("text/"))                            return "📃";
  return "📎";
}

function escapeAttr(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

function escapeHtml(value = "") {
  return escapeAttr(value)
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#039;");
}

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function thumbUrl(url, w = 400) {
  return url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/") + `?width=${w}&resize=cover`;
}

/* Supabase 공개 URL에 download 파라미터를 붙여 크로스오리진에서도 저장되게 함 */
function fileDownloadUrl(url, name) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}download=${encodeURIComponent(name || "file")}`;
}
