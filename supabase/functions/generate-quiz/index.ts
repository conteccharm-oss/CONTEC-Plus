const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
const JSON_HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  if (!GROQ_API_KEY) {
    return new Response(JSON.stringify({ error: "GROQ_API_KEY가 설정되지 않았습니다." }), { status: 500, headers: JSON_HEADERS });
  }

  const body = await req.json().catch(() => ({}));
  const topic: string = body.topic ?? "mixed";       // mixed | contec | space_basics | trending
  const quizType: string = body.quizType ?? "mixed"; // mixed | subjective | multiple

  // CONTEC 관련 주제일 때만 홈페이지 크롤링
  let siteContent = "";
  if (topic === "mixed" || topic === "contec") {
    for (const url of ["https://contec.kr", "https://www.contec.kr"]) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; ContecBot/1.0)" },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const html = await res.text();
          siteContent = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 3000);
          break;
        }
      } catch (_) { /* 다음 URL 시도 */ }
    }
  }

  // 주제별 컨텍스트
  const topicContext: Record<string, string> = {
    mixed: [
      "컨텍(CONTEC)은 대한민국의 우주항공 스타트업으로 초소형 위성(큐브샛) 제조, 위성 버스 플랫폼, 우주 부품, 지구관측 데이터 서비스를 개발합니다.",
      siteContent ? `CONTEC 홈페이지 내용:\n${siteContent}` : "",
      "일반 우주 지식: 위성 궤도, 발사체, 우주정거장, 행성 탐사, 큐브샛 등 기초~중급 수준의 우주 상식도 포함하세요.",
    ].filter(Boolean).join("\n"),
    contec: [
      "컨텍(CONTEC)은 대한민국의 우주항공 스타트업으로 초소형 위성(큐브샛) 제조, 위성 버스 플랫폼, 우주 부품, 지구관측 데이터 서비스를 개발합니다.",
      siteContent ? `CONTEC 홈페이지 내용:\n${siteContent}` : "",
    ].filter(Boolean).join("\n"),
    space_basics: "우주 기초 지식 전반: 태양계, 위성 궤도(LEO/MEO/GEO), 발사체, 우주정거장(ISS), 로켓 원리, 인공위성 종류, 우주복, 블랙홀, 빅뱅 등 누구나 알면 좋은 우주 상식",
    trending: "최근 주목받는 우주 이슈: SpaceX 스타십, 아르테미스 달 탐사 프로그램, 한국 누리호 발사, 민간 우주여행, 화성 탐사(퍼서비어런스), 제임스웹 우주망원경, 위성 인터넷(스타링크), 소형위성 시장 성장 트렌드 등",
  };

  // 유형별 문제 수 지시
  const typeInstruction: Record<string, string> = {
    mixed: "주관식 7개, 객관식 3개",
    subjective: "주관식 10개 (객관식 없음)",
    multiple: "객관식 10개 (주관식 없음)",
  };

  const prompt = `아래 주제로 사내 퀴즈 릴레이용 문제 10개를 만들어주세요.

[주제 정보]
${topicContext[topic] ?? topicContext.mixed}

[요구사항]
- 문제 유형: ${typeInstruction[quizType] ?? typeInstruction.mixed}
- 난이도: 쉬움~보통 (일반 직원 누구나 도전할 수 있는 수준, 너무 전문적이지 않게)
- 힌트는 필요한 경우에만 포함 (없으면 null)
- 객관식은 정답이 반드시 4개 보기 중 하나와 정확히 일치

반드시 아래 JSON 배열 형식으로만 응답 (다른 텍스트 없이 JSON만):
[
  {
    "quiz_type": "subjective",
    "question": "문제 내용",
    "answer": "정답",
    "hint": "힌트 또는 null"
  },
  {
    "quiz_type": "multiple",
    "question": "문제 내용",
    "answer": "정답(보기 중 하나와 정확히 일치)",
    "hint": null,
    "option_a": "보기1",
    "option_b": "보기2",
    "option_c": "보기3",
    "option_d": "보기4"
  }
]`;

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 4000,
        temperature: 0.7,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await groqRes.json();

    if (data?.error) {
      return new Response(JSON.stringify({ error: `Groq 오류: ${data.error.message || JSON.stringify(data.error)}` }), { status: 500, headers: JSON_HEADERS });
    }

    const text = data?.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\[[\s\S]*\]/);

    if (!match) {
      return new Response(JSON.stringify({ error: `응답 파싱 실패 (text: ${text.slice(0, 200)})` }), { status: 500, headers: JSON_HEADERS });
    }

    const quizzes = JSON.parse(match[0]);
    return new Response(JSON.stringify({ quizzes }), { headers: JSON_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: JSON_HEADERS });
  }
});
