'use client';

import { useState, useCallback } from 'react';
import styles from './page.module.css';

// ── デバッグ用固定座標（本番時は null に戻す）──────────────
// const DEBUG_LOCATION = { lat: 34.3942032224381, lng: 132.45875854135784 };
const DEBUG_LOCATION = null;

// ── デバッグ用固定時刻（本番時は null に戻す）──────────────
// const DEBUG_TIME = { hour: 12, minute: 0 }; // 12:00 に固定
const DEBUG_TIME = null;

function getNow() {
  if (!DEBUG_TIME) return new Date();
  const d = new Date();
  d.setHours(DEBUG_TIME.hour, DEBUG_TIME.minute, 0, 0);
  return d;
}

// ── 定数 ────────────────────────────────────────────────
const BUDGET_OPTIONS = [
  { label: '～500円',    min: 0,     max: 500 },
  { label: '～1,000円',  min: 501,   max: 1000 },
  { label: '～1,500円',  min: 1001,  max: 1500 },
  { label: '～2,000円',  min: 1501,  max: 2000 },
  { label: '～3,000円',  min: 2001,  max: 3000 },
  { label: '～4,000円',  min: 3001,  max: 4000 },
  { label: '～5,000円',  min: 4001,  max: 5000 },
  { label: '～7,000円',  min: 5001,  max: 7000 },
  { label: '～10,000円', min: 7001,  max: 10000 },
  { label: '～15,000円', min: 10001, max: 15000 },
  { label: '～20,000円', min: 15001, max: 20000 },
  { label: '～30,000円', min: 20001, max: 30000 },
  { label: '30,001円～', min: 30001, max: Infinity },
];

const DISTANCE_OPTIONS = [
  { label: '500m以内', range: '2' },
  { label: '1km以内',  range: '3' },
];

const RESULT_OPTIONS = [
  { label: '1件ランダム', value: 'one' },
  { label: '全部表示',   value: 'all' },
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
 * - 判定不能（openフィールドが空 / パース不可）→ false（閉店扱いで除外）
 * - 曜日パターンあり + 今日にマッチ + 現在時刻が範囲内 → true
 * - 曜日パターンなし + 時間帯あり + 現在時刻が範囲内 → true
 * - それ以外 → false（閉店扱いで除外）
 */
function isCurrentlyOpen(shop) {
  const openStr = shop.open;
  if (!openStr || typeof openStr !== 'string' || openStr.trim() === '') return false;

  const now      = getNow();
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

/**
 * 現在時刻が昼帯（10:00〜15:00）かどうかを判定する。
 */
function isLunchHour(now) {
  const h = now.getHours();
  return h >= 10 && h < 15;
}

/**
 * 予算文字列から金額（円）を抽出する。
 *
 * 対応パターン:
 *  - "昼800円 夜2,000円" / "ランチ1,000円 ディナー2,500円"
 *  - "～1,000円" / "1,001～1,500円" （範囲は中間値）
 *  - "1,200円前後" などシンプルな数値
 *
 * @param {string} str    予算文字列
 * @param {boolean} isLunch 昼帯かどうか
 * @returns {number|null}  金額（不明な場合はnull）
 */
function extractBudgetAmount(str, isLunch) {
  if (!str || typeof str !== 'string') return null;

  // 昼/夜 両方の記載があるか確認
  const lunchM  = str.match(/(?:昼|ランチ)[^\d０-９]*([\d,０-９]+)/);
  const dinnerM = str.match(/(?:夜|ディナー)[^\d０-９]*([\d,０-９]+)/);

  if (lunchM || dinnerM) {
    const toNum = (m) => m ? parseInt(m[1].replace(/,/g, '')) : null;
    const lunchAmt  = toNum(lunchM);
    const dinnerAmt = toNum(dinnerM);
    // 昼帯なら昼、夜帯なら夜を優先。片方しかなければそちらを使用
    if (isLunch)  return lunchAmt  ?? dinnerAmt;
    return          dinnerAmt ?? lunchAmt;
  }

  // 通常パターン: 数値を全部拾って平均（範囲対応）
  const nums = str.replace(/,/g, '').match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  const vals = nums.map(Number);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * 店舗が選択された予算範囲内かを判定する。
 * budget.average → なければ budget.name にフォールバック。
 */
function isInBudgetRange(shop, budget, now) {
  const isLunch = isLunchHour(now);
  const timeLabel = isLunch ? '昼' : '夜';

  // budget.average を優先、なければ budget.name で代替
  let avg = extractBudgetAmount(shop.budget?.average, isLunch);
  let src = `average "${shop.budget?.average}"`;

  if (avg === null) {
    avg = extractBudgetAmount(shop.budget?.name, isLunch);
    src = `name "${shop.budget?.name}"`;
  }

  const min = budget.min ?? 0;
  const max = budget.max === Infinity ? '∞' : budget.max;

  if (avg === null) {
    console.log(`💰 ${shop.name}: 予算情報なし → ✅ 表示（スルー）`);
    return true;
  }

  const pass = avg >= (budget.min ?? 0) && avg <= (budget.max ?? Infinity);
  console.log(
    `💰 ${shop.name}: ${src} → ${avg}円 [${timeLabel}帯] | 選択: ～${max}円 → ${pass ? '✅ 表示' : '❌ 除外'}`
  );
  return pass;
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
  const [selectedBudgets,  setSelectedBudgets]  = useState([]);
  const [selectedDistance, setSelectedDistance] = useState(DISTANCE_OPTIONS[0]);
  const [resultMode,       setResultMode]       = useState('one');  // 'one' | 'all'
  const [timeMode,         setTimeMode]         = useState('open'); // 'open' | 'all'
  const [shop,           setShop]           = useState(null);
  const [allShops,       setAllShops]       = useState([]);
  const [allBudgetShops, setAllBudgetShops] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [searched, setSearched] = useState(false);
  const [userPos,  setUserPos]  = useState(null);
  const [showAll,  setShowAll]  = useState(false);

  const search = useCallback(async (budgets, distance, rMode, tMode) => {
    if (!budgets.length) { setError('価格帯を選択してください'); return; }

    setLoading(true);
    setError(null);
    setShop(null);
    setSearched(false);
    setShowAll(false);

    try {
      const position = await getLocation();
      const { latitude: lat, longitude: lng } = position.coords;
      console.log(`📍 現在地取得: 緯度=${lat}, 経度=${lng}`);
      setUserPos({ lat, lng });

      const now = getNow();
      const isLunch = isLunchHour(now);
      console.log(
        `🕐 現在時刻: ${now.toLocaleTimeString('ja-JP')} (${DAYS_JP[now.getDay()]}曜日) [${isLunch ? '昼帯' : '夜帯'}]${DEBUG_TIME ? ' ⚠️デバッグ時刻' : ''}`
      );

      // 選択された予算の結合範囲を計算
      const budgetMin = Math.min(...budgets.map(b => b.min ?? 0));
      const budgetMaxVal = Math.max(...budgets.map(b => b.max ?? Infinity));
      const params = new URLSearchParams({
        lat, lng,
        range: distance.range,
        budgetMin,
        budgetMax: budgetMaxVal === Infinity ? '' : budgetMaxVal,
        isLunch: isLunch ? '1' : '0',
      });

      const res  = await fetch(`/api/search?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'APIエラーが発生しました');

      // 営業時間フィルタの適用
      const candidates = tMode === 'open'
        ? data.shops.filter(s => isCurrentlyOpen(s))
        : data.shops;

      console.log(`🍱 取得: ${data.shops.length}件 → 候補: ${candidates.length}件 [${tMode === 'open' ? '営業中のみ' : '営業時間外含む'}]`);

      setAllBudgetShops(data.shops);
      setAllShops(candidates);

      if (rMode === 'all') {
        setShop(null); // 全部モードは単一カードなし
      } else {
        setShop(candidates.length > 0 ? pickRandom(candidates) : null);
      }
      setSearched(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = () => search(selectedBudgets, selectedDistance, resultMode, timeMode);

  const handleBudgetSelect = (budget) => {
    setSelectedBudgets(prev =>
      prev.some(b => b.label === budget.label)
        ? prev.filter(b => b.label !== budget.label) // 選択解除
        : [...prev, budget]                           // 追加
    );
  };

  const handleRetry = () => {
    if (allShops.length > 0) setShop(pickRandom(allShops));
    else search(selectedBudgets, selectedDistance, resultMode, timeMode);
  };

  return (
    <div className={styles.container}>
      {/* ヘッダー */}
      <header className={styles.header}>
        <div className={styles.headerIcon}>🍽️</div>
        <h1 className={styles.title}>ランチ難民・ディナー難民<br />救済サービス</h1>
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

      {/* 予算選択 */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>予算を選んでタップ！</h2>
        <div className={styles.budgetGrid}>
          {(() => {
            // 選択された予算の全体的な範囲を計算
            const overallMin = selectedBudgets.length > 0 ? Math.min(...selectedBudgets.map(b => b.min ?? 0))     : null;
            const overallMax = selectedBudgets.length > 0 ? Math.max(...selectedBudgets.map(b => b.max ?? Infinity)) : null;
            return BUDGET_OPTIONS.map((b) => {
              const isSelected = selectedBudgets.some(s => s.label === b.label);
              const isIncluded = !isSelected && overallMin !== null
                && (b.min ?? 0) >= overallMin
                && (b.max ?? Infinity) <= overallMax;
              return (
                <button
                  key={b.label}
                  className={`${styles.budgetBtn} ${isSelected ? styles.budgetBtnActive : isIncluded ? styles.budgetBtnIncluded : ''}`}
                  onClick={() => handleBudgetSelect(b)}
                  disabled={loading}
                  aria-pressed={isSelected}
                >
                  {b.label}
                </button>
              );
            });
          })()}
        </div>
      </section>

      {/* 検索オプション */}
      <section className={styles.section}>
        <div className={styles.optionRow}>
          <div className={styles.optionGroup}>
            <span className={styles.optionLabel}>結果</span>
            <div className={styles.optionBtns}>
              {RESULT_OPTIONS.map(o => (
                <button
                  key={o.value}
                  className={`${styles.optionBtn} ${resultMode === o.value ? styles.optionBtnActive : ''}`}
                  onClick={() => setResultMode(o.value)}
                  disabled={loading}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
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
        disabled={loading || selectedBudgets.length === 0}
      >
        {loading ? '検索中…' : '🔍 検索する'}
      </button>
      {selectedBudgets.length === 0 && !loading && (
        <p className={styles.searchHint}>上の予算を選択してください（複数可）</p>
      )}

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
      {searched && !shop && allShops.length === 0 && !loading && !error && (
        <div className={styles.emptyBox}>
          <div className={styles.emptyIcon}>😔</div>
          <p>条件に合うお店が見つかりませんでした</p>
          <p className={styles.emptyHint}>検索範囲・予算を変えてお試しください</p>
        </div>
      )}
      {/* 店舗カード（全部モード） */}
      {searched && resultMode === 'all' && allShops.length > 0 && !loading && (
        <div className={styles.resultSection}>
          <p className={styles.resultLabel}>📍 {allShops.length}件見つかりました</p>
          <div className={styles.allShopsList}>
            {allShops.map(s => (
              <div key={s.id} className={styles.card}>
                {s.photo?.pc?.l && (
                  <div className={styles.cardImageWrap}>
                    <img src={s.photo.pc.l} alt={s.name} className={styles.cardImage} />
                  </div>
                )}
                <div className={styles.cardBody}>
                  <h3 className={styles.shopName}>{s.name}</h3>
                  {s.genre?.name && <span className={styles.badge}>{s.genre.name}</span>}
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
                    {s.open && <div className={styles.infoRow}><span className={styles.infoIcon}>🕐</span><span>{s.open}</span></div>}
                    {s.lunch && <div className={styles.infoRow}><span className={styles.infoIcon}>🍽️</span><span>ランチ: {s.lunch}</span></div>}
                    {s.budget?.average && <div className={styles.infoRow}><span className={styles.infoIcon}>💴</span><span>目安: {s.budget.average}</span></div>}
                    {s.access && <div className={styles.infoRow}><span className={styles.infoIcon}>🚶</span><span>{s.access}</span></div>}
                  </div>
                  <div className={styles.cardActions}>
                    <a href={s.urls?.pc} target="_blank" rel="noopener noreferrer" className={styles.linkBtn}>ホットペッパーで見る</a>
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.name + ' ' + s.address)}`} target="_blank" rel="noopener noreferrer" className={`${styles.linkBtn} ${styles.linkBtnSecondary}`}>地図で見る</a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 店舗カード（1件モード） */}
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
                    {userPos && shop.lat && shop.lng && (
                      <span className={styles.distanceBadge}>
                        {formatDistance(haversine(userPos.lat, userPos.lng, parseFloat(shop.lat), parseFloat(shop.lng)))}
                      </span>
                    )}
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
            🎲 もう1度ガチャ
          </button>
          {allShops.length > 1 && (
            <>
              <button
                className={styles.showAllBtn}
                onClick={() => setShowAll(v => !v)}
              >
                {showAll ? '▲ 閉じる' : `他に ${allShops.length - 1} 件あります`}
                <span className={styles.showAllArrow}>{showAll ? '' : '全部見る'}</span>
              </button>
              {showAll && (
                <div className={styles.allShopsList}>
                  {allShops.filter(s => s.id !== shop.id).map(s => (
                    <div key={s.id} className={styles.card}>
                      {s.photo?.pc?.l && (
                        <div className={styles.cardImageWrap}>
                          <img src={s.photo.pc.l} alt={s.name} className={styles.cardImage} />
                        </div>
                      )}
                      <div className={styles.cardBody}>
                        <h3 className={styles.shopName}>{s.name}</h3>
                        {s.genre?.name && (
                          <span className={styles.badge}>{s.genre.name}</span>
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
                              <span>{s.open}</span>
                            </div>
                          )}
                          {s.lunch && (
                            <div className={styles.infoRow}>
                              <span className={styles.infoIcon}>🍽️</span>
                              <span>ランチ: {s.lunch}</span>
                            </div>
                          )}
                          {s.budget?.average && (
                            <div className={styles.infoRow}>
                              <span className={styles.infoIcon}>💴</span>
                              <span>目安: {s.budget.average}</span>
                            </div>
                          )}
                          {s.access && (
                            <div className={styles.infoRow}>
                              <span className={styles.infoIcon}>🚶</span>
                              <span>{s.access}</span>
                            </div>
                          )}
                        </div>
                        <div className={styles.cardActions}>
                          <a
                            href={s.urls?.pc}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.linkBtn}
                          >
                            ホットペッパーで見る
                          </a>
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.name + ' ' + s.address)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${styles.linkBtn} ${styles.linkBtnSecondary}`}
                          >
                            地図で見る
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
