'use client';

import { useState, useCallback } from 'react';
import styles from './page.module.css';

// ── デバッグ用固定座標（本番時は null に戻す）──────────────
// const DEBUG_LOCATION = { lat: 34.3942032224381, lng: 132.45875854135784 };
// const DEBUG_LOCATION = { lat: 35.6812, lng: 139.7671 }; // 東京駅
const DEBUG_LOCATION = null;

// ── デバッグ用固定時刻（本番時は null に戻す）──────────────
// const DEBUG_TIME = { hour: 12, minute: 0 }; // 12:00 に固定
const DEBUG_TIME = null;

// ── 営業中判定モード ────────────────────────────────────────
// true  → Google Places の openNow を使用（推奨・シンプル）
// false → 自前で営業時間テキストをパース（Hotpepper互換・旧方式）
const USE_OPEN_NOW = true;

function getNow() {
  if (!DEBUG_TIME) return new Date();
  const d = new Date();
  d.setHours(DEBUG_TIME.hour, DEBUG_TIME.minute, 0, 0);
  return d;
}

// ── 定数 ────────────────────────────────────────────────
const DISTANCE_OPTIONS = [
  { label: '100m以内', range: '100' },
  { label: '300m以内', range: '300' },
];

const TIME_OPTIONS = [
  { label: '営業中のみ',      value: 'open' },
  { label: '営業時間外含む', value: 'all'  },
];

// ── 営業時間パーサー ──────────────────────────────────────
const DAYS_JP = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_MAP  = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };

function toMinutes(t) {
  const m = t.match(/(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
}

function dayIncludes(dayStr, todayIdx) {
  const rng = dayStr.match(/([月火水木金土日])[～〜]([月火水木金土日])/);
  if (rng) {
    const s = DAY_MAP[rng[1]], e = DAY_MAP[rng[2]];
    return s <= e
      ? todayIdx >= s && todayIdx <= e
      : todayIdx >= s || todayIdx <= e;
  }
  return (dayStr.match(/[月火水木金土日]/g) || []).includes(DAYS_JP[todayIdx]);
}

function checkTimeRanges(text, cur) {
  const matches = text.match(/(\d{1,2}:\d{2})[～〜](\d{1,2}:\d{2})/g) || [];
  for (const t of matches) {
    const [, s, e] = t.match(/(\d{1,2}:\d{2})[～〜](\d{1,2}:\d{2})/);
    let start = toMinutes(s), end = toMinutes(e);
    if (start === null || end === null) continue;
    if (end < start) end += 1440; // 翌日またぎ
    if (cur >= start && cur < end) return true;
  }
  return false;
}

/**
 * 現在この瞬間に営業中かどうかを判定する。
 *
 * USE_OPEN_NOW = true  → shop.openNow（Google APIの値）を使用
 * USE_OPEN_NOW = false → 営業時間テキストを自前でパース（旧方式）
 *
 * openNow が null（情報なし）の場合は自前パーサーにフォールバック。
 */
function isCurrentlyOpen(shop) {
  // ── openNow モード ──────────────────────────────────────
  if (USE_OPEN_NOW && shop.openNow !== null && shop.openNow !== undefined) {
    return shop.openNow; // true=営業中 / false=閉店
  }

  // ── 自前パーサー（旧方式 / フォールバック）──────────────
  const openStr = shop.open;
  if (!openStr || typeof openStr !== 'string' || openStr.trim() === '') return false;

  const now      = getNow();
  const todayIdx = now.getDay();
  const cur      = now.getHours() * 60 + now.getMinutes();

  // Google Places形式: "月曜日: 11:00〜22:00\n火曜日: ..." など
  const lines = openStr.split('\n').map(l => l.trim()).filter(Boolean);

  const dayNamesJP = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
  const todayName  = dayNamesJP[todayIdx];

  for (const line of lines) {
    if (line.startsWith(todayName)) {
      const timePart = line.slice(todayName.length).replace(/^[：:]\s*/, '');
      if (checkTimeRanges(timePart, cur)) return true;
    }
  }

  // Hotpepper形式フォールバック
  const chunks       = openStr.split(/[、,\n]+/);
  let hasDayPattern  = false;
  let currentDayActive = null;
  for (const chunk of chunks) {
    const colonIdx = chunk.search(/[：:]/);
    if (colonIdx !== -1) {
      const dayPart  = chunk.slice(0, colonIdx).trim();
      const timePart = chunk.slice(colonIdx + 1).trim();
      if (/[月火水木金土日]/.test(dayPart) && !dayPart.includes('曜日')) {
        hasDayPattern    = true;
        currentDayActive = dayIncludes(dayPart, todayIdx) ? timePart : null;
      }
      if (currentDayActive !== null && checkTimeRanges(timePart, cur)) return true;
    } else if (currentDayActive !== null) {
      if (checkTimeRanges(chunk, cur)) return true;
    }
  }
  if (!hasDayPattern) return checkTimeRanges(openStr, cur);
  return false;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** ハーバーサイン式で2点間の距離（メートル）を返す */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`;
}

function getLocation() {
  if (DEBUG_LOCATION) {
    console.log('⚠️ デバッグモード: 固定座標を使用');
    return Promise.resolve({
      coords: { latitude: DEBUG_LOCATION.lat, longitude: DEBUG_LOCATION.lng },
    });
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('このブラウザは位置情報に対応していません'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, () =>
      reject(new Error('位置情報の取得が拒否されました。ブラウザの設定を確認してください。'))
    );
  });
}

// ── コンポーネント ─────────────────────────────────────────
export default function Home() {
  const [selectedDistance, setSelectedDistance] = useState(DISTANCE_OPTIONS[0]);
  const [timeMode,         setTimeMode]         = useState('open'); // 'open' | 'all'
  const [shop,             setShop]             = useState(null);
  const [allShops,         setAllShops]         = useState([]);
  const [loading,          setLoading]          = useState(false);
  const [error,            setError]            = useState(null);
  const [searched,         setSearched]         = useState(false);
  const [userPos,          setUserPos]          = useState(null);

  const search = useCallback(async (distance, tMode) => {
    setLoading(true);
    setError(null);
    setShop(null)
    setSearched(false);

    try {
      const position = await getLocation();
      const { latitude: lat, longitude: lng } = position.coords;
      console.log(`📍 現在地取得: 緯度=${lat}, 経度=${lng}`);
      setUserPos({ lat, lng });

      const now = getNow();
      console.log(`🕐 現在時刻: ${now.toLocaleTimeString('ja-JP')} (${DAYS_JP[now.getDay()]}曜日)`);

      const params = new URLSearchParams({ lat, lng, range: distance.range });
      const res  = await fetch(`/api/search?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'APIエラーが発生しました');

      // 営業時間フィルタの適用
      const candidates = tMode === 'open'
        ? data.shops.filter(s => isCurrentlyOpen(s))
        : data.shops;

      console.log(`🍽️ 取得: ${data.shops.length}件 → 候補: ${candidates.length}件 [${tMode === 'open' ? '営業中のみ' : '営業時間外含む'}]`);

      setAllShops(candidates);
      setShop(candidates.length > 0 ? pickRandom(candidates) : null);
      setSearched(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = () => search(selectedDistance, timeMode);

  const handleRetry = () => {
    if (allShops.length > 0) setShop(pickRandom(allShops));
    else search(selectedDistance, timeMode);
  };

  // 店舗カード共通レンダラー
  const renderShopCard = (s, key) => (
    <div key={key} className={styles.card}>
      {s.photo?.pc?.l && (
        <div className={styles.cardImageWrap}>
          <img src={s.photo.pc.l} alt={s.name} className={styles.cardImage} />
        </div>
      )}
      <div className={styles.cardBody}>
        <h3 className={styles.shopName}>{s.name}</h3>
        {s.genre?.name && <span className={styles.badge}>{s.genre.name}</span>}
        {s.rating && (
          <span className={styles.badge} style={{ marginLeft: '4px', background: 'linear-gradient(135deg,#f6b93b,#e55039)' }}>
            ⭐ {s.rating.toFixed(1)}{s.userRatingCount ? ` (${s.userRatingCount})` : ''}
          </span>
        )}
        <div className={styles.infoList}>
          {s.address && (
            <div className={styles.infoRow}>
              <span className={styles.infoIcon}>📍</span>
              <span>{s.address}</span>
              {userPos && s.lat && s.lng && (
                <span className={styles.distanceBadge}>
                  {formatDistance(haversine(userPos.lat, userPos.lng, parseFloat(s.lat), parseFloat(s.lng)))}
                </span>
              )}
            </div>
          )}
          {s.open && (
            <div className={styles.infoRow}>
              <span className={styles.infoIcon}>🕐</span>
              <span style={{ whiteSpace: 'pre-line', fontSize: '0.85em' }}>{s.open}</span>
            </div>
          )}
          {s.budget?.average && (
            <div className={styles.infoRow}>
              <span className={styles.infoIcon}>💴</span>
              <span>目安: {s.budget.average}</span>
            </div>
          )}
        </div>
        <div className={styles.cardActions}>
          {s.urls?.pc && (
            <a
              href={s.urls.pc}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkBtn}
            >
              HOT Pepperで見る
            </a>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className={styles.container}>
      {/* ヘッダー */}
      <header className={styles.header}>
        <div className={styles.headerIcon}>🍽️</div>
        <h1 className={styles.title}>ごはんガチャ</h1>
        <p className={styles.subtitle}>現在地周辺の飲食店をパッと表示</p>
      </header>

      {/* 距離選択 */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>検索範囲</h2>
        <div className={styles.distanceGrid}>
          {DISTANCE_OPTIONS.map((d) => (
            <button
              key={d.range}
              className={`${styles.distanceBtn} ${selectedDistance.range === d.range ? styles.distanceBtnActive : ''}`}
              onClick={() => setSelectedDistance(d)}
              disabled={loading}
              aria-pressed={selectedDistance.range === d.range}
            >
              {d.label}
            </button>
          ))}
        </div>
      </section>

      {/* 検索オプション */}
      <section className={styles.section}>
        <div className={styles.optionRow}>
          <div className={styles.optionGroup}>
            <span className={styles.optionLabel}>時間</span>
            <div className={styles.optionBtns}>
              {TIME_OPTIONS.map(o => (
                <button
                  key={o.value}
                  className={`${styles.optionBtn} ${timeMode === o.value ? styles.optionBtnActive : ''}`}
                  onClick={() => setTimeMode(o.value)}
                  disabled={loading}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 検索ボタン */}
      <button
        className={styles.searchBtn}
        onClick={handleSearch}
        disabled={loading}
      >
        {loading ? '検索中…' : '🔍 検索する'}
      </button>

      {loading && (
        <div className={styles.loadingWrap}>
          <div className={styles.spinner} />
          <p className={styles.loadingText}>近くのお店を探しています…</p>
        </div>
      )}

      {/* エラー */}
      {error && !loading && (
        <div className={styles.errorBox}>
          <span className={styles.errorIcon}>⚠️</span>
          <p>{error}</p>
        </div>
      )}

      {/* 結果なし */}
      {searched && allShops.length === 0 && !loading && !error && (
        <div className={styles.emptyBox}>
          <div className={styles.emptyIcon}>😔</div>
          <p>条件に合うお店が見つかりませんでした</p>
          <p className={styles.emptyHint}>検索範囲を変えてお試しください</p>
        </div>
      )}

      {/* 店舗カード（1件モード） */}
      {shop && !loading && (
        <div className={styles.resultSection}>
          <p className={styles.resultLabel}>🎲 今日のお店はこちら！</p>
          <p className={styles.searchHint}>近隣の最大60件から抽選しています</p>
          {renderShopCard(shop, shop.id)}

          <button className={styles.retryBtn} onClick={handleRetry}>
            🎲 もう1度ガチャ
          </button>
        </div>
      )}
    </div>
  );
}
