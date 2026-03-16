'use client';

import { useState, useCallback } from 'react';
import styles from './page.module.css';

// ── 定数 ────────────────────────────────────────────────
const BUDGET_OPTIONS = [
  { label: '～500円',    code: 'B009' },
  { label: '～1,000円',  code: 'B010' },
  { label: '～1,500円',  code: 'B011' },
  { label: '～2,000円',  code: 'B001' },
  { label: '～3,000円',  code: 'B002' },
  { label: '～4,000円',  code: 'B003' },
  { label: '～5,000円',  code: 'B008' },
  { label: '～7,000円',  code: 'B004' },
  { label: '～10,000円', code: 'B005' },
  { label: '～15,000円', code: 'B006' },
  { label: '～20,000円', code: 'B012' },
  { label: '～30,000円', code: 'B013' },
  { label: '30,001円～', code: 'B014' },
];

const DISTANCE_OPTIONS = [
  { label: '500m以内', range: '2' },
  { label: '1km以内',  range: '3' },
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
 * - 判定不能（openフィールドが空 / パース不可）→ false（閉店扱いで除外）
 * - 曜日パターンあり + 今日にマッチ + 現在時刻が範囲内 → true
 * - 曜日パターンなし + 時間帯あり + 現在時刻が範囲内 → true
 * - それ以外 → false（閉店扱いで除外）
 */
function isCurrentlyOpen(shop) {
  const openStr = shop.open;
  if (!openStr || typeof openStr !== 'string' || openStr.trim() === '') return false;

  const now      = new Date();
  const todayIdx = now.getDay();
  const cur      = now.getHours() * 60 + now.getMinutes();

  const chunks       = openStr.split(/[、,\n]+/);
  let hasDayPattern  = false;
  let currentDayActive = null; // 今日にマッチした曜日セグメント中かどうか

  for (const chunk of chunks) {
    const colonIdx = chunk.search(/[：:]/);
    if (colonIdx !== -1) {
      const dayPart  = chunk.slice(0, colonIdx).trim();
      const timePart = chunk.slice(colonIdx + 1).trim();

      if (/[月火水木金土日]/.test(dayPart)) {
        hasDayPattern    = true;
        currentDayActive = dayIncludes(dayPart, todayIdx) ? timePart : null;
      }
      if (currentDayActive !== null && checkTimeRanges(timePart, cur)) return true;
    } else if (currentDayActive !== null) {
      // コロンのない継続チャンク（同じ曜日セグメントの追加時間帯）
      if (checkTimeRanges(chunk, cur)) return true;
    }
  }

  // 曜日パターンがない場合：全体から時間帯のみで判断
  if (!hasDayPattern) {
    return checkTimeRanges(openStr, cur);
  }

  // 曜日パターンあり → 今日の時間帯にマッチしなかった = 閉店
  return false;
}

// ── ユーティリティ ────────────────────────────────────────
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getLocation() {
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
  const [selectedBudget,   setSelectedBudget]   = useState(null);
  const [selectedDistance, setSelectedDistance] = useState(DISTANCE_OPTIONS[0]);
  const [shop,     setShop]     = useState(null);
  const [allShops, setAllShops] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async (budget, distance) => {
    if (!budget) { setError('価格帯を選択してください'); return; }

    setLoading(true);
    setError(null);
    setShop(null);
    setSearched(false);

    try {
      const position = await getLocation();
      const { latitude: lat, longitude: lng } = position.coords;
      console.log(`📍 現在地取得: 緯度=${lat}, 経度=${lng}`);

      const now = new Date();
      console.log(
        `🕐 現在時刻: ${now.toLocaleTimeString('ja-JP')} (${DAYS_JP[now.getDay()]}曜日)`
      );

      const res  = await fetch(
        `/api/search?lat=${lat}&lng=${lng}&budget=${budget.code}&range=${distance.range}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'APIエラーが発生しました');

      const openShops = data.shops.filter(isCurrentlyOpen);
      console.log(`🍱 取得: ${data.shops.length}件 → 営業中フィルタ後: ${openShops.length}件`);

      setAllShops(openShops);
      setShop(openShops.length > 0 ? pickRandom(openShops) : null);
      setSearched(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleBudgetSelect = (budget) => {
    setSelectedBudget(budget);
    search(budget, selectedDistance);
  };

  const handleRetry = () => {
    if (allShops.length > 0) setShop(pickRandom(allShops));
    else search(selectedBudget, selectedDistance);
  };

  return (
    <div className={styles.container}>
      {/* ヘッダー */}
      <header className={styles.header}>
        <div className={styles.headerIcon}>🍱</div>
        <h1 className={styles.title}>ランチ＆ディナー<br />難民救済サービス</h1>
        <p className={styles.subtitle}>現在地周辺の営業中店舗をランダム提案</p>
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

      {/* 予算選択 */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>予算を選んでタップ！</h2>
        <div className={styles.budgetGrid}>
          {BUDGET_OPTIONS.map((b) => (
            <button
              key={b.code}
              className={`${styles.budgetBtn} ${selectedBudget?.code === b.code ? styles.budgetBtnActive : ''}`}
              onClick={() => handleBudgetSelect(b)}
              disabled={loading}
              aria-pressed={selectedBudget?.code === b.code}
            >
              {b.label}
            </button>
          ))}
        </div>
      </section>

      {/* ローディング */}
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
      {searched && !shop && !loading && !error && (
        <div className={styles.emptyBox}>
          <div className={styles.emptyIcon}>😔</div>
          <p>条件に合うお店が見つかりませんでした</p>
          <p className={styles.emptyHint}>時間帯・予算・検索範囲を変えてお試しください</p>
        </div>
      )}

      {/* 店舗カード */}
      {shop && !loading && (
        <div className={styles.resultSection}>
          <p className={styles.resultLabel}>🎲 今日のお店はこちら！</p>
          <div className={styles.card}>
            {shop.photo?.pc?.l && (
              <div className={styles.cardImageWrap}>
                <img src={shop.photo.pc.l} alt={shop.name} className={styles.cardImage} />
              </div>
            )}
            <div className={styles.cardBody}>
              <h3 className={styles.shopName}>{shop.name}</h3>
              {shop.genre?.name && (
                <span className={styles.badge}>{shop.genre.name}</span>
              )}
              <div className={styles.infoList}>
                {shop.address && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoIcon}>📍</span>
                    <span>{shop.address}</span>
                  </div>
                )}
                {shop.open && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoIcon}>🕐</span>
                    <span>{shop.open}</span>
                  </div>
                )}
                {shop.lunch && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoIcon}>🍽️</span>
                    <span>ランチ: {shop.lunch}</span>
                  </div>
                )}
                {shop.budget?.average && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoIcon}>💴</span>
                    <span>目安: {shop.budget.average}</span>
                  </div>
                )}
                {shop.access && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoIcon}>🚶</span>
                    <span>{shop.access}</span>
                  </div>
                )}
              </div>
              <div className={styles.cardActions}>
                <a
                  href={shop.urls?.pc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.linkBtn}
                >
                  ホットペッパーで見る
                </a>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.name + ' ' + shop.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${styles.linkBtn} ${styles.linkBtnSecondary}`}
                >
                  地図で見る
                </a>
              </div>
            </div>
          </div>

          <button className={styles.retryBtn} onClick={handleRetry}>
            🔀 もう一度探す
          </button>
          {allShops.length > 0 && (
            <p className={styles.countHint}>
              周辺に {allShops.length} 件見つかりました
            </p>
          )}
        </div>
      )}
    </div>
  );
}
