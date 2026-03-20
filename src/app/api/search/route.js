import { NextResponse } from 'next/server';

// ══════════════════════════════════════════════════════════════
//  切り替えフラグ: 'google' | 'hotpepper'
// ══════════════════════════════════════════════════════════════
const API_PROVIDER = 'hotpepper';

// ── ハーバーサイン距離（メートル）──────────────────────────
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── APIルート ──────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat   = searchParams.get('lat');
  const lng   = searchParams.get('lng');
  const range = searchParams.get('range') ?? '2';


  if (!lat || !lng) {
    return NextResponse.json({ error: '位置情報が取得できませんでした' }, { status: 400 });
  }

  if (API_PROVIDER === 'google') {
    return searchGoogle(lat, lng, range);
  } else {
    return searchHotpepper(lat, lng, range);
  }
}

// ══════════════════════════════════════════════════════════════
//  Google Maps Places API (New) - Nearby Search 複数タイプ並列
//  タイプ別に並列リクエストして結果をマージ（距離順保証）
// ══════════════════════════════════════════════════════════════
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.regularOpeningHours',
  'places.currentOpeningHours',
  'places.primaryTypeDisplayName',
  'places.photos',
  'places.googleMapsUri',
  'places.priceLevel',
  'places.rating',
  'places.userRatingCount',
].join(',');

// 検索対象のPlace Type（restaurantのみ）
const PLACE_TYPES = [
  'restaurant',
];

async function fetchNearby(apiKey, lat, lng, radius, type) {
  const body = {
    includedTypes:   [type],
    maxResultCount:  20,
    locationRestriction: {
      circle: {
        center: { latitude: parseFloat(lat), longitude: parseFloat(lng) },
        radius,
      },
    },
    // rankPreference を指定しない → Googleのデフォルト（人気度）で選出
    // 距離順ソートは取得後に haversine で行う
  };
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'X-Goog-Api-Key':   apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn(`⚠️ Nearby Search [${type}] status ${res.status}`);
    return [];
  }
  const data = await res.json();
  return data.places ?? [];
}

async function searchGoogle(lat, lng, range) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY が設定されていません' }, { status: 500 });
  }

  // 新形式: range='100','200','500','1000' → メートル直指定
  // 旧形式(Hotpepper互換): '1'=300m,'2'=500m,'3'=1000m,'4'=2000m,'5'=3000m
  const radiusMap = { '100': 100, '200': 200, '300': 300, '500': 500, '1000': 1000, '2000': 2000, '1': 300, '2': 500, '3': 1000, '4': 2000, '5': 3000 };
  const radius = radiusMap[range] ?? 300;

  try {
    const results = await Promise.all(
      PLACE_TYPES.map(t => fetchNearby(apiKey, lat, lng, radius, t))
    );
    const allPlaces = results.flat();
    console.log(`📦 取得: ${results[0].length}件`);

    // 重複除去（id基準）
    const seen = new Set();
    const unique = allPlaces.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    // 距離フィルタ（念のため）＋距離でソート
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const withinRadius = unique
      .map(p => ({
        ...p,
        _dist: (p.location?.latitude != null && p.location?.longitude != null)
          ? haversineMeters(userLat, userLng, p.location.latitude, p.location.longitude)
          : 0,
      }))
      .filter(p => p._dist <= radius)
      .sort((a, b) => a._dist - b._dist);

    console.log(`📍 重複除去後: ${unique.length}件 → 距離フィルタ後: ${withinRadius.length}件 (半径${radius}m以内)`);

    // Hotpepper互換フォーマットに変換
    const shops = withinRadius.map((p) => {
      const openStr = (p.regularOpeningHours?.weekdayDescriptions ?? []).join('\n');
      const priceLevelMap = {
        PRICE_LEVEL_FREE:           '無料',
        PRICE_LEVEL_INEXPENSIVE:    '～1,000円',
        PRICE_LEVEL_MODERATE:       '1,000～2,000円',
        PRICE_LEVEL_EXPENSIVE:      '2,000～5,000円',
        PRICE_LEVEL_VERY_EXPENSIVE: '5,000円～',
      };
      const budgetLabel = priceLevelMap[p.priceLevel] ?? null;
      let photoUrl = null;
      if (p.photos && p.photos.length > 0) {
        photoUrl = `https://places.googleapis.com/v1/${p.photos[0].name}/media?maxWidthPx=400&key=${apiKey}`;
      }
      return {
        id:              p.id,
        name:            p.displayName?.text ?? '',
        address:         p.formattedAddress ?? '',
        lat:             String(p.location?.latitude  ?? ''),
        lng:             String(p.location?.longitude ?? ''),
        open:            openStr,
        openNow:         p.currentOpeningHours?.openNow ?? null,
        genre:           { name: p.primaryTypeDisplayName?.text ?? '' },
        photo:           photoUrl ? { pc: { l: photoUrl } } : null,
        urls:            { pc: p.googleMapsUri ?? '' },
        budget:          budgetLabel ? { average: budgetLabel } : null,
        rating:          p.rating ?? null,
        userRatingCount: p.userRatingCount ?? null,
      };
    });

    console.log(`✅ Nearby Search 完了: ${shops.length}件 (半径${radius}m)`);
    return NextResponse.json({ shops });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'ネットワークエラーが発生しました' }, { status: 500 });
  }
}

/* ── 旧: Text Search + ページネーション（関連度順・距離保証なし）────
async function searchGoogleTextSearch(lat, lng, range) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const radiusMap = { '100':100,'200':200,'300':300,'500':500,'1000':1000 };
  const radius = radiusMap[range] ?? 300;
  let allPlaces = [], pageToken = null;
  for (let page = 0; page < 3; page++) {
    const body = {
      textQuery: '飲食店 レストラン', maxResultCount: 20,
      locationBias: { circle: { center: { latitude:parseFloat(lat), longitude:parseFloat(lng) }, radius } },
      ...(pageToken ? { pageToken } : {}),
    };
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method:'POST', headers:{ 'Content-Type':'application/json','X-Goog-Api-Key':apiKey,'X-Goog-FieldMask':`${FIELD_MASK},nextPageToken` },
      body: JSON.stringify(body),
    });
    if (!res.ok) break;
    const data = await res.json();
    allPlaces = allPlaces.concat(data.places ?? []);
    pageToken = data.nextPageToken ?? null;
    if (!pageToken) break;
  }
  // ... 重複除去・距離フィルタ・変換
}
── 旧: Text Search ここまで ── */


/* ── 旧: Nearby Search（最大20件）──────────────────────────────
async function searchGoogleNearby(lat, lng, range) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const radiusMap = { '100':100,'200':200,'300':300,'500':500,'1000':1000,'2':500,'3':1000 };
  const radius = radiusMap[range] ?? 300;
  const body = {
    includedTypes: ['restaurant'],
    maxResultCount: 20,
    locationRestriction: { circle: { center: { latitude:parseFloat(lat), longitude:parseFloat(lng) }, radius } },
    rankPreference: 'DISTANCE',
  };
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method:'POST',
    headers:{ 'Content-Type':'application/json','X-Goog-Api-Key':apiKey,'X-Goog-FieldMask':FIELD_MASK },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json({ shops: mapPlaces(data.places ?? [], apiKey) });
}
── 旧: Nearby Search ここまで ── */


// ══════════════════════════════════════════════════════════════
//  HOTPEPPER 旧コード（切り替え用に保持）
//  API_PROVIDER = 'hotpepper' にすると再び使用されます
// ══════════════════════════════════════════════════════════════
function toHankaku(str) {
  return str.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30));
}
function parseNum(s) {
  const n = parseInt(s.replace(/,/g, ''), 10);
  return isNaN(n) ? null : n;
}
function extractBudgetAmount(str, isLunch) {
  if (!str || typeof str !== 'string') return null;
  const s = toHankaku(str);
  const lunchFwd  = s.match(/(?:昼|ランチ)[^\d]*([\d,]+)/);
  const dinnerFwd = s.match(/(?:夜|ディナー)[^\d]*([\d,]+)/);
  const lunchRev  = s.match(/([\d,]+)円[^/\d]{0,15}(?:ランチ|昼)/);
  const dinnerRev = s.match(/([\d,]+)円[^/\d]{0,15}(?:ディナー|夜)/);
  const lunchAmt  = parseNum((lunchFwd  ?? lunchRev )?.[1] ?? '');
  const dinnerAmt = parseNum((dinnerFwd ?? dinnerRev)?.[1] ?? '');
  if (lunchAmt !== null || dinnerAmt !== null) {
    if (isLunch) return lunchAmt  ?? dinnerAmt;
    return          dinnerAmt ?? lunchAmt;
  }
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
  if (avg === null) { console.log(`  💰 ${shop.name}: 予算情報なし → ✅ 表示`); return true; }
  const pass = avg >= budgetMin && (budgetMax === null || avg <= budgetMax);
  console.log(`  💰 ${shop.name}: ${src} → ${avg}円 → ${pass ? '✅' : '❌'}`);
  return pass;
}

async function searchHotpepper(lat, lng, range) {
  const apiKey = process.env.HOTPEPPER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'HOTPEPPER_API_KEY が設定されていません' }, { status: 500 });
  }
  const params = new URLSearchParams({
    key: apiKey, lat, lng, range,
    lunch: '1', count: '100', format: 'json',
  });
  try {
    const res  = await fetch(`https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?${params.toString()}`);
    if (!res.ok) {
      return NextResponse.json({ error: 'ホットペッパーAPIの呼び出しに失敗しました' }, { status: 500 });
    }
    const data  = await res.json();
    const shops = data?.results?.shop ?? [];
    console.log(`✅ Hotpepper: ${shops.length}件取得`);
    return NextResponse.json({ shops });
  } catch (e) {
    return NextResponse.json({ error: 'ネットワークエラーが発生しました' }, { status: 500 });
  }
}
