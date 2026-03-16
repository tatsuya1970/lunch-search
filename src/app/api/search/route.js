import { NextResponse } from 'next/server';

// 全角数字 → 半角数字
function toHankaku(str) {
  return str.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30));
}

function parseNum(s) {
  const n = parseInt(s.replace(/,/g, ''), 10);
  return isNaN(n) ? null : n;
}

function extractBudgetAmount(str, isLunch) {
  if (!str || typeof str !== 'string') return null;

  const s = toHankaku(str); // 全角→半角に正規化

  // ① 順方向: ランチ/昼 → 数字   例: "ランチ: 900円", "昼1500円"
  const lunchFwd  = s.match(/(?:昼|ランチ)[^\d]*([\d,]+)/);
  // ② 順方向: ディナー/夜 → 数字
  const dinnerFwd = s.match(/(?:夜|ディナー)[^\d]*([\d,]+)/);
  // ③ 逆方向: 数字 → (ランチ...)   例: "750円(ランチ平均)"
  const lunchRev  = s.match(/([\d,]+)円[^/\d]{0,15}(?:ランチ|昼)/);
  // ④ 逆方向: 数字 → (ディナー...) 例: "4000円(ディナー)"
  const dinnerRev = s.match(/([\d,]+)円[^/\d]{0,15}(?:ディナー|夜)/);

  const lunchAmt  = parseNum((lunchFwd  ?? lunchRev )?.[1] ?? '');
  const dinnerAmt = parseNum((dinnerFwd ?? dinnerRev)?.[1] ?? '');

  if (lunchAmt !== null || dinnerAmt !== null) {
    if (isLunch) return lunchAmt  ?? dinnerAmt;
    return          dinnerAmt ?? lunchAmt;
  }

  // ラベルなし: 全数字の平均（範囲対応）
  const nums = s.replace(/,/g, '').match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  const vals = nums.map(Number).filter(n => !isNaN(n));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function isInBudgetRange(shop, budgetMin, budgetMax, isLunch) {
  let avg = extractBudgetAmount(shop.budget?.average, isLunch);
  let src = `average "${shop.budget?.average}"`;

  if (avg === null) {
    avg = extractBudgetAmount(shop.budget?.name, isLunch);
    src = `name "${shop.budget?.name}"`;
  }

  const timeLabel = isLunch ? '昼' : '夜';
  const maxLabel  = budgetMax === null ? '∞' : `${budgetMax}`;

  if (avg === null) {
    console.log(`  💰 ${shop.name}: 予算情報なし → ✅ 表示（スルー）`);
    return true;
  }

  const pass = avg >= budgetMin && (budgetMax === null || avg <= budgetMax);
  console.log(
    `  💰 ${shop.name}: ${src} → ${avg}円 [${timeLabel}帯] | 選択: ～${maxLabel}円 → ${pass ? '✅ 表示' : '❌ 除外'}`
  );
  return pass;
}

// ── APIルート ──────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat       = searchParams.get('lat');
  const lng       = searchParams.get('lng');
  const range     = searchParams.get('range') ?? '2';
  const budgetMin = parseInt(searchParams.get('budgetMin') ?? '0', 10);
  const budgetMaxRaw = searchParams.get('budgetMax');
  const budgetMax = budgetMaxRaw === '' || budgetMaxRaw === null ? null : parseInt(budgetMaxRaw, 10);
  const isLunch   = searchParams.get('isLunch') === '1';

  if (!lat || !lng) {
    return NextResponse.json({ error: '位置情報が取得できませんでした' }, { status: 400 });
  }

  const apiKey = process.env.HOTPEPPER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'APIキーが設定されていません' }, { status: 500 });
  }

  const params = new URLSearchParams({
    key: apiKey, lat, lng, range,
    lunch: '1',
    count: '100',
    format: 'json',
  });

  try {
    const res  = await fetch(
      `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?${params.toString()}`
    );
    if (!res.ok) {
      return NextResponse.json({ error: 'ホットペッパーAPIの呼び出しに失敗しました' }, { status: 500 });
    }
    const data  = await res.json();
    const shops = data?.results?.shop ?? [];

    console.log(`\n🔍 予算フィルタ開始 (${isLunch ? '昼帯' : '夜帯'} / ～${budgetMax ?? '∞'}円) [${shops.length}件]`);
    const filtered = shops.filter(s => isInBudgetRange(s, budgetMin, budgetMax, isLunch));
    console.log(`✅ 予算フィルタ後: ${filtered.length}件\n`);

    return NextResponse.json({ shops: filtered });
  } catch (e) {
    return NextResponse.json({ error: 'ネットワークエラーが発生しました' }, { status: 500 });
  }
}
