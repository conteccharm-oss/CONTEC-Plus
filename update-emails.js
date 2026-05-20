const XLSX = require("xlsx");
const path = require("path");

const SUPABASE_URL = "https://ifytanvhskqmbvmjoohi.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("사용법: node update-emails.js <엑셀파일경로>");
    process.exit(1);
  }
  if (!SERVICE_KEY) {
    console.error("SUPABASE_SERVICE_KEY 환경변수를 설정해 주세요.");
    process.exit(1);
  }

  // 엑셀 읽기
  const wb = XLSX.readFile(path.resolve(filePath));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);

  console.log(`총 ${rows.length}행 읽음`);

  let updated = 0;
  let notFound = [];

  for (const row of rows) {
    const name = String(row["이름"] || "").trim();
    const email = String(row["이메일"] || "").trim();

    if (!name || !email) continue;

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/employees?name=eq.${encodeURIComponent(name)}`,
      {
        method: "PATCH",
        headers: {
          "apikey": SERVICE_KEY,
          "Authorization": "Bearer " + SERVICE_KEY,
          "Content-Type": "application/json",
          "Prefer": "return=representation",
        },
        body: JSON.stringify({ email }),
      }
    );

    const result = await res.json();
    if (Array.isArray(result) && result.length > 0) {
      console.log(`✔ ${name} → ${email}`);
      updated++;
    } else {
      console.log(`✘ ${name} — DB에서 찾을 수 없음`);
      notFound.push(name);
    }
  }

  console.log(`\n완료: ${updated}명 업데이트, ${notFound.length}명 미매칭`);
  if (notFound.length > 0) {
    console.log("미매칭 목록:", notFound.join(", "));
  }
}

main();
