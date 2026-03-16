import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const budget = searchParams.get('budget');
  const range = searchParams.get('range') ?? '2'; // 1=300m 2=500m 3=1km 4=2km 5=3km

  if (!lat || !lng) {
    return NextResponse.json({ error: '位置情報が取得できませんでした' }, { status: 400 });
  }

  const apiKey = process.env.HOTPEPPER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'APIキーが設定されていません' }, { status: 500 });
  }

  const params = new URLSearchParams({
    key: apiKey,
    lat,
    lng,
    range,
    lunch: '1',
    count: '100',
    format: 'json',
  });

  if (budget) {
    params.append('budget', budget);
  }

  try {
    const res = await fetch(
      `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?${params.toString()}`
    );
    if (!res.ok) {
      return NextResponse.json({ error: 'ホットペッパーAPIの呼び出しに失敗しました' }, { status: 500 });
    }
    const data = await res.json();
    const shops = data?.results?.shop ?? [];
    return NextResponse.json({ shops });
  } catch (e) {
    return NextResponse.json({ error: 'ネットワークエラーが発生しました' }, { status: 500 });
  }
}
