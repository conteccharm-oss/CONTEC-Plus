import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC = "BJBv1mc1LjCfNoCPCthpPgg4SV_lwIgMrqjMZ_3qxr-HWJsgPYNNQm2YlrNnMploFP59X02kNL7BVbheEIS3oJo";
const VAPID_PRIVATE = "9LB3ku0oW9yuZvftzFZEUoL7PXNap6Z7zpeTV0IoHOM";

webpush.setVapidDetails("mailto:contecgpt@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const res = await fetch(supabaseUrl + "/rest/v1/push_subscriptions?select=id,subscription", {
    headers: {
      "apikey": supabaseKey,
      "Authorization": "Bearer " + supabaseKey,
    },
  });
  const rows = await res.json();

  // endpoint 기준 중복 제거 → 한 기기당 푸시 1번만 (구독 row가 중복돼 있어도 안전)
  const seen = new Set<string>();
  const uniqueRows = rows.filter((row) => {
    const ep = row?.subscription?.endpoint;
    if (!ep || seen.has(ep)) return false;
    seen.add(ep);
    return true;
  });

  let pushBody = "궤도 레이스가 시작되었습니다!";
  try { const d = await req.json(); if (d.body) pushBody = d.body; } catch {}
  const payload = JSON.stringify({
    title: "CONTEC+",
    body: pushBody,
  });

  const results = await Promise.allSettled(
    uniqueRows.map((row) => webpush.sendNotification(row.subscription, payload))
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  return new Response(JSON.stringify({ sent, total: uniqueRows.length, rawRows: rows.length }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
