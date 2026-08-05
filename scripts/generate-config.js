const fs = require("fs");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;

if (!url || !key) {
  console.error("SUPABASE_URL, SUPABASE_KEY 환경변수가 필요합니다.");
  process.exit(1);
}

fs.writeFileSync(
  "config.js",
  `const SUPABASE_URL = "${url}";\nconst SUPABASE_KEY = "${key}";\nconst BUCKET_NAME  = "shared-files";\n`
);
console.log("config.js 생성 완료");
