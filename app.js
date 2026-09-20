// app.js - Show Verse Frontend Engine: Data Grouping, Real Trending Logic, Top Categories & YouTube-Style Player Page
import { 
  collection, 
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.js";

// Source of Truth from Firestore
export let firestoreEpisodes = [];

// Grouped Series Structure (1 Poster per Show)
export let groupedShows = [];

// Current Active Category Filter ('All' | 'Kdrama' | 'Anime' | 'Chinese Drama' | 'Movie')
export let currentCategoryFilter = 'All';

// Currently Active Show and Episode in YouTube-Style Player
export let currentSelectedShow = null;
export let currentSelectedEpisodeIndex = 0;
let previousViewBeforePlayer = 'home';
let isYtAmbientOn = true;
let ytIdleTimeout = null;

// Normalize Category String strictly into one of the 4 valid categories
export function normalizeCategory(cat) {
  if (!cat) return 'Anime';
  const c = String(cat).trim().toLowerCase();
  if (c === 'kdrama' || c === 'k-drama' || c === 'korean drama') return 'Kdrama';
  if (c === 'anime' || c === 'animation') return 'Anime';
  if (c === 'chinese drama' || c === 'c-drama' || c === 'cdrama') return 'Chinese Drama';
  if (c === 'movie' || c === 'movies' || c === 'film') return 'Movie';
  return 'Anime';
}

// Format numbers (e.g. 842100 -> 842K, 1200000 -> 1.2M)
export function formatViews(num) {
  const n = Number(num) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

// Format seconds into MM:SS or HH:MM:SS
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

// Deterministic seed for initial realistic view counts
function getInitialSeedViews(title) {
  let hash = 0;
  const str = String(title || 'showverse');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const positive = Math.abs(hash);
  return 120000 + (positive % 820000);
}

// Robust function to extract clean series name without "(S1 Ep 1)" or other episode tags
export function cleanSeriesTitle(epOrTitle) {
  if (!epOrTitle) return 'Untitled Series';

  let raw = '';
  if (typeof epOrTitle === 'string') {
    raw = epOrTitle;
  } else if (typeof epOrTitle === 'object') {
    if (typeof epOrTitle.seriesName === 'string' && epOrTitle.seriesName.trim()) {
      raw = epOrTitle.seriesName.trim();
    } else if (typeof epOrTitle.seriesTitle === 'string' && epOrTitle.seriesTitle.trim()) {
      raw = epOrTitle.seriesTitle.trim();
    } else if (typeof epOrTitle.showTitle === 'string' && epOrTitle.showTitle.trim()) {
      raw = epOrTitle.showTitle.trim();
    } else if (typeof epOrTitle.title === 'string' && epOrTitle.title.trim()) {
      raw = epOrTitle.title.trim();
    } else {
      raw = 'Untitled Series';
    }
  }

  // Strip trailing season/episode indicators like:
  // (S1 Ep 1), (S01 E01), [S1 Ep 1], (Ep 1), (Episode 1)
  // - Episode 1, - Ep 1, - Ep. 1, - S1 Ep 1
  // S1 Ep 1, S1E1, etc.
  let cleaned = raw
    .replace(/\s*[\(\[]\s*S\d+\s*(?:Ep|Episode|E)\s*\d+[^)\]]*[\)\]]/gi, '')
    .replace(/\s*[\(\[]\s*(?:Ep|Episode|E)\.?\s*\d+[^)\]]*[\)\]]/gi, '')
    .replace(/\s*-\s*(?:Season\s*\d+\s*)?(?:Episode|Ep\.?)\s*\d+/gi, '')
    .replace(/\s+-\s+S\d+\s+Ep\s+\d+/gi, '')
    .replace(/\s+S\d+\s+(?:Ep|Episode|E)\s*\d+$/gi, '')
    .trim();

  return cleaned || raw.trim() || 'Untitled Series';
}

// Extract clean episode number from doc or title
export function extractEpisodeNumber(ep, fallbackIndex = 1) {
  if (!ep) return fallbackIndex;
  if (ep.episode !== undefined && ep.episode !== null && ep.episode !== '') {
    const num = parseInt(ep.episode, 10);
    if (!isNaN(num) && num > 0) return num;
  }
  if (ep.episodeNumber !== undefined && ep.episodeNumber !== null && ep.episodeNumber !== '') {
    const num = parseInt(ep.episodeNumber, 10);
    if (!isNaN(num) && num > 0) return num;
  }
  const title = String(ep.title || ep.episodes || '');
  const match = title.match(/(?:Ep|Episode|E)\.?\s*(\d+)/i);
  if (match && match[1]) {
    const parsed = parseInt(match[1], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return fallbackIndex;
}

// Extract season number
export function extractSeasonNumber(ep) {
  if (!ep) return 1;
  if (ep.season !== undefined && ep.season !== null && ep.season !== '') {
    const num = parseInt(ep.season, 10);
    if (!isNaN(num) && num > 0) return num;
  }
  const title = String(ep.title || ep.episodes || '');
  const match = title.match(/S(\d+)/i);
  if (match && match[1]) {
    const parsed = parseInt(match[1], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 1;
}

// 1. DATA GROUPING: GROUP ALL FIRESTORE DOCUMENTS BY SERIES TITLE (STRICT 1 CARD PER SHOW)
export function groupEpisodesIntoShows(episodesList) {
  if (!Array.isArray(episodesList) || episodesList.length === 0) {
    return [];
  }

  // Load persistent views counters from localStorage
  let storedViews = {};
  try {
    storedViews = JSON.parse(localStorage.getItem('showverse_series_views') || '{}');
  } catch (_) {
    storedViews = {};
  }

  const map = new Map();

  episodesList.forEach((ep) => {
    const cleanTitle = cleanSeriesTitle(ep);
    const key = cleanTitle.toLowerCase().trim();

    if (!map.has(key)) {
      // Check stored views or seed deterministically
      let views = storedViews[key];
      if (typeof views !== 'number' || isNaN(views) || views <= 0) {
        views = getInitialSeedViews(cleanTitle);
        storedViews[key] = views;
      }

      // Consistent rating
      let seedRating = (9.2 + ((getInitialSeedViews(cleanTitle) % 8) / 10)).toFixed(1);

      map.set(key, {
        id: ep.id || `show_${key}`,
        showKey: key,
        title: cleanTitle,
        category: normalizeCategory(ep.category),
        image: ep.image || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=800&q=80',
        description: ep.description || ep.desc || `Watch ${cleanTitle} in ultra-high bitrate 4K with Dolby Atmos sound and synchronized subtitles on Show Verse.`,
        season: extractSeasonNumber(ep),
        rating: ep.rating || seedRating,
        views: views,
        episodes: []
      });
    }

    const show = map.get(key);

    // Keep category accurate if any episode has a non-default category
    if (ep.category && normalizeCategory(ep.category) !== 'Anime') {
      show.category = normalizeCategory(ep.category);
    }
    // Update image if this episode has a custom image
    if (ep.image && (!show.image || show.image.includes('unsplash'))) {
      show.image = ep.image;
    }

    const epNum = extractEpisodeNumber(ep, show.episodes.length + 1);
    const sNum = extractSeasonNumber(ep) || show.season || 1;
    const vUrl = ep.videoUrl || 'https://vjs.zencdn.net/v/oceans.mp4';

    // Prevent duplicate entries for the exact same episode
    const exists = show.episodes.some(existing => 
      (existing.id && ep.id && existing.id === ep.id) ||
      (existing.episodeNumber === epNum && existing.season === sNum && existing.videoUrl === vUrl)
    );

    if (!exists) {
      show.episodes.push({
        id: ep.id || `${key}_ep_${epNum}`,
        showTitle: cleanTitle,
        episodeNumber: epNum,
        season: sNum,
        episodeTitle: ep.episodeTitle || `Episode ${epNum}`,
        videoUrl: vUrl,
        image: ep.image || show.image,
        quality: ep.quality || '1080p',
        createdAt: ep.createdAt || ep.uploadedAt || ''
      });
    }
  });

  // Save views map back to localStorage
  try {
    localStorage.setItem('showverse_series_views', JSON.stringify(storedViews));
  } catch (_) {}

  // Sort episodes in each show in natural order (Season ascending, Episode ascending)
  const shows = Array.from(map.values());
  shows.forEach((show) => {
    show.episodes.sort((a, b) => {
      const sA = parseInt(a.season, 10) || 1;
      const sB = parseInt(b.season, 10) || 1;
      if (sA !== sB) return sA - sB;
      const eA = parseInt(a.episodeNumber, 10) || 0;
      const eB = parseInt(b.episodeNumber, 10) || 0;
      return eA - eB;
    });
  });

  return shows;
}

// Increment view count for a series when watched
export function incrementShowViews(showKey) {
  if (!showKey) return;
  const key = String(showKey).trim().toLowerCase();
  let storedViews = {};
  try {
    storedViews = JSON.parse(localStorage.getItem('showverse_series_views') || '{}');
  } catch (_) {}

  const current = storedViews[key] || getInitialSeedViews(key);
  storedViews[key] = current + 1;

  try {
    localStorage.setItem('showverse_series_views', JSON.stringify(storedViews));
  } catch (_) {}

  // Update in-memory grouped show
  const show = groupedShows.find(s => s.showKey === key);
  if (show) {
    show.views = storedViews[key];
    const viewsEl = document.getElementById('ytShowViews');
    if (viewsEl && currentSelectedShow && currentSelectedShow.showKey === key) {
      viewsEl.innerHTML = `<i data-lucide="flame" class="w-4 h-4 text-amber-400"></i> ${formatViews(show.views)} Views`;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

// 2. LISTEN TO FIRESTORE "showverse_episodes" REAL-TIME (SINGLE SOURCE OF TRUTH)
export function initShowverseEpisodesSync() {
  // Load cached episodes immediately from localStorage so UI is instant even offline
  try {
    const cached = localStorage.getItem('showverse_cached_episodes');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        firestoreEpisodes = parsed;
        groupedShows = groupEpisodesIntoShows(firestoreEpisodes);
        if (typeof window !== "undefined") {
          window.firestoreEpisodes = firestoreEpisodes;
          window.groupedShows = groupedShows;
        }
        renderAllViews();
      }
    }
  } catch (_) {}

  if (!db) {
    console.warn("[Show Verse] Firestore db instance not ready; rendering blank states.");
    renderAllViews();
    return;
  }

  // Real-time onSnapshot subscription to "showverse_episodes"
  onSnapshot(collection(db, "showverse_episodes"), (snapshot) => {
    const list = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      list.push({
        id: docSnap.id,
        isLiveFirestore: true,
        ...data,
        category: normalizeCategory(data.category)
      });
    });

    // Sort newest first
    list.sort((a, b) => {
      const timeA = a.uploadedAt || a.createdAt || '';
      const timeB = b.uploadedAt || b.createdAt || '';
      return timeB.localeCompare(timeA);
    });

    firestoreEpisodes = list;
    groupedShows = groupEpisodesIntoShows(firestoreEpisodes);

    if (typeof window !== "undefined") {
      window.firestoreEpisodes = firestoreEpisodes;
      window.groupedShows = groupedShows;
    }
    try {
      localStorage.setItem('showverse_cached_episodes', JSON.stringify(list));
    } catch (_) {}

    console.log(`[Show Verse] Synced ${list.length} episode(s) grouped into ${groupedShows.length} series`);
    
    // Master render across views
    renderAllViews();
  }, (err) => {
    console.log("[Show Verse] Real-time sync operating in offline-cached mode:", err ? (err.message || String(err)) : "offline");
    renderAllViews();
  });
}

// Master Render Function
export function renderAllViews() {
  if (!groupedShows || groupedShows.length === 0) {
    groupedShows = groupEpisodesIntoShows(firestoreEpisodes);
  }

  renderCategoryRows();
  renderTrendingRows();
  renderHeroFromFirestore();

  if (currentCategoryFilter && currentCategoryFilter !== 'All') {
    renderDedicatedCategoryGrid(currentCategoryFilter);
  }

  if (typeof window !== "undefined" && typeof window.renderContinueWatching === "function") {
    window.renderContinueWatching();
  }

  if (window.lucide) window.lucide.createIcons();
}

// 3. RENDER HOMEPAGE CATEGORY SLIDERS (STRICTLY 1 POSTER PER SHOW)
export function renderCategoryRows() {
  const categorized = {
    'Kdrama': groupedShows.filter(show => show.category === 'Kdrama'),
    'Anime': groupedShows.filter(show => show.category === 'Anime'),
    'Chinese Drama': groupedShows.filter(show => show.category === 'Chinese Drama'),
    'Movie': groupedShows.filter(show => show.category === 'Movie')
  };

  // Update counts on top filter chip badges
  updateCategoryCounters(categorized);

  // Render each category container (1 poster per series)
  renderRowContainer('kdramaRow', categorized['Kdrama'], 'Kdrama');
  renderRowContainer('animeRow', categorized['Anime'], 'Anime');
  renderRowContainer('cdramaRow', categorized['Chinese Drama'], 'Chinese Drama');
  renderRowContainer('moviesRow', categorized['Movie'], 'Movie');

  if (window.lucide) window.lucide.createIcons();
}

function updateCategoryCounters(categorized) {
  const countKdrama = document.getElementById('badge-count-Kdrama');
  const countAnime = document.getElementById('badge-count-Anime');
  const countCDrama = document.getElementById('badge-count-ChineseDrama');
  const countMovie = document.getElementById('badge-count-Movie');

  if (countKdrama) countKdrama.innerText = categorized['Kdrama'].length;
  if (countAnime) countAnime.innerText = categorized['Anime'].length;
  if (countCDrama) countCDrama.innerText = categorized['Chinese Drama'].length;
  if (countMovie) countMovie.innerText = categorized['Movie'].length;

  const headerKdrama = document.getElementById('header-count-Kdrama');
  const headerAnime = document.getElementById('header-count-Anime');
  const headerCDrama = document.getElementById('header-count-ChineseDrama');
  const headerMovie = document.getElementById('header-count-Movie');

  if (headerKdrama) headerKdrama.innerText = `${categorized['Kdrama'].length} Series`;
  if (headerAnime) headerAnime.innerText = `${categorized['Anime'].length} Series`;
  if (headerCDrama) headerCDrama.innerText = `${categorized['Chinese Drama'].length} Series`;
  if (headerMovie) headerMovie.innerText = `${categorized['Movie'].length} Series`;
}

// Generate Card HTML for each Series in horizontal category sliders (1 Poster per Show)
function renderRowContainer(elementId, shows, categoryName) {
  const container = document.getElementById(elementId);
  if (!container) return;

  if (!shows || shows.length === 0) {
    container.innerHTML = `
      <div class="flex-shrink-0 w-80 p-6 text-center glass-card rounded-2xl border border-dashed border-white/10 flex flex-col items-center justify-center gap-2">
        <i data-lucide="film" class="w-8 h-8 text-slate-500"></i>
        <p class="font-bold text-xs text-slate-300">No series published in ${categoryName} yet</p>
        <p class="text-[11px] text-slate-400">Upload episodes via Creator Studio to feature series here.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = shows.map((show) => {
    const safeTitle = (show.title || 'Untitled').replace(/'/g, "\\'");
    const epCount = show.episodes.length;
    const epLabel = epCount === 1 ? '1 Episode' : `${epCount} Episodes`;

    return `
      <div class="relative flex-shrink-0 w-44 sm:w-52 glass-card rounded-2xl overflow-hidden tilt-card group cursor-pointer border border-white/5 hover:border-brand-cyan/40 transition-all duration-300" onclick="openShowPlayerPage('${safeTitle}')">
        <!-- 2:3 Aspect Poster -->
        <div class="relative aspect-[2/3] overflow-hidden bg-slate-950">
          <img src="${show.image}" alt="${show.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
          
          <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent"></div>
          
          <!-- Top Badges -->
          <div class="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between">
            <span class="px-2 py-0.5 rounded-full bg-black/60 backdrop-blur text-[10px] font-bold text-slate-300 border border-white/10 uppercase">
              ${show.category}
            </span>
            <span class="px-2 py-0.5 rounded-full bg-brand-cyan/90 text-black text-[10px] font-black uppercase shadow-neon-cyan">
              ★ ${show.rating}
            </span>
          </div>

          <!-- Play Hover Overlay -->
          <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-[2px]">
            <div class="w-12 h-12 rounded-full bg-brand-cyan text-black flex items-center justify-center shadow-neon-cyan transform scale-90 group-hover:scale-100 transition-transform">
              <i data-lucide="play" class="w-5 h-5 fill-black ml-0.5"></i>
            </div>
          </div>

          <!-- Bottom Meta Info -->
          <div class="absolute bottom-2.5 left-2.5 right-2.5 text-left">
            <div class="flex items-center justify-between text-[11px] text-slate-300 mb-1">
              <span class="font-mono text-brand-cyan text-[10px] font-bold">${epLabel}</span>
              <span class="text-[10px] text-amber-400 font-mono">🔥 ${formatViews(show.views)}</span>
            </div>
            <h3 class="text-xs font-black text-white truncate group-hover:text-brand-cyan transition-colors">
              ${show.title}
            </h3>
            <p class="text-[10px] text-slate-400 truncate mt-0.5">Season ${show.season || '1'} • 4K Dolby Atmos</p>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// 4. REAL TRENDING LOGIC: SORT GROUPED SHOWS BY HIGHEST VIEWS WITH RANK NUMERALS
export function renderTrendingRows() {
  const container = document.getElementById('trendingRow');
  if (!container) return;

  if (!groupedShows || groupedShows.length === 0) {
    container.innerHTML = `
      <div class="w-full p-8 text-center glass-card rounded-2xl border border-dashed border-white/10 flex flex-col items-center justify-center gap-2">
        <i data-lucide="flame" class="w-8 h-8 text-slate-500"></i>
        <p class="font-bold text-slate-300">No trending series available yet</p>
        <p class="text-xs text-slate-400">Titles will appear ranked by user stream views.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // Sort series by highest views descending
  const sortedByViews = [...groupedShows].sort((a, b) => (b.views || 0) - (a.views || 0));
  const trendingItems = sortedByViews.slice(0, 10);

  container.innerHTML = trendingItems.map((show, index) => {
    const safeTitle = (show.title || 'Untitled').replace(/'/g, "\\'");
    const epCount = show.episodes.length;
    const epLabel = epCount === 1 ? '1 Episode' : `${epCount} Episodes`;

    return `
      <div class="relative flex-shrink-0 w-44 sm:w-52 glass-card rounded-2xl overflow-hidden tilt-card group cursor-pointer border border-white/5 hover:border-brand-cyan/40 transition-all duration-300" onclick="openShowPlayerPage('${safeTitle}')">
        <div class="relative aspect-[2/3] overflow-hidden bg-slate-950">
          <img src="${show.image}" alt="${show.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy">
          <div class="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent"></div>
          
          <!-- Large Netflix-Style Rank Number -->
          <span class="absolute -bottom-3 -left-1 text-7xl font-black italic tracking-tighter text-transparent select-none" style="-webkit-text-stroke: 2px #00F0FF; opacity: 0.85;">
            ${index + 1}
          </span>

          <!-- Views Counter Badge Top Right -->
          <div class="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-black/75 backdrop-blur border border-amber-400/40 text-amber-300 text-[10px] font-mono font-bold flex items-center gap-1">
            <i data-lucide="flame" class="w-3 h-3 text-amber-400"></i> ${formatViews(show.views)}
          </div>
        </div>
        <div class="p-3 pl-14">
          <h4 class="font-bold text-xs text-white truncate group-hover:text-brand-cyan transition">${show.title}</h4>
          <p class="text-[10px] text-slate-400 truncate mt-0.5">${show.category} • ${epLabel}</p>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

// 5. HERO BANNER: FEATURING TOP SERIES (OPENS YOUTUBE-STYLE PLAYER PAGE)
export function renderHeroFromFirestore() {
  const heroTitle = document.getElementById('heroTitle');
  const heroDesc = document.getElementById('heroDesc');
  const heroImage = document.getElementById('heroImage');
  const heroPlayBtn = document.getElementById('heroPlayBtn');

  if (!heroTitle || !heroDesc) return;

  if (groupedShows.length > 0) {
    // Pick highest trending show
    const sorted = [...groupedShows].sort((a, b) => (b.views || 0) - (a.views || 0));
    const featured = sorted[0];

    heroTitle.innerText = featured.title.toUpperCase();
    heroDesc.innerText = featured.description || `Streaming ${featured.title} with high bitrate, ambient glow, and Dolby Atmos audio on Show Verse.`;
    if (heroImage && featured.image) {
      heroImage.src = featured.image;
    }
    if (heroPlayBtn) {
      const safeTitle = featured.title.replace(/'/g, "\\'");
      heroPlayBtn.setAttribute('onclick', `openShowPlayerPage('${safeTitle}')`);
      heroPlayBtn.innerHTML = `<i data-lucide="play" class="w-4 h-4 fill-black"></i> Play`;
    }
  } else {
    heroTitle.innerText = "SHOW VERSE";
    heroDesc.innerText = "Your private streaming universe for Kdrama, Anime, Chinese Drama, and 4K Movies. No titles have been published yet. Open Creator Studio from the 'Me' tab to publish series.";
    if (heroPlayBtn) {
      heroPlayBtn.setAttribute('onclick', "if(window.openCreatorStudio){window.openCreatorStudio();}else{window.openMeModal();}");
      heroPlayBtn.innerHTML = `<i data-lucide="plus-circle" class="w-4 h-4 fill-black"></i> Open Creator Studio`;
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

// 6. TOP CATEGORY BAR & DEDICATED FULL-PAGE SLIDE TRANSITIONS
export function filterCategoryView(selectedCategory) {
  currentCategoryFilter = selectedCategory;

  // Highlight active chip in the top navigation bar
  const chips = ['All', 'Kdrama', 'Anime', 'Chinese Drama', 'Movie'];
  chips.forEach((c) => {
    const chipId = c === 'Chinese Drama' ? 'chip-ChineseDrama' : `chip-${c}`;
    const el = document.getElementById(chipId);
    if (!el) return;

    if (c === selectedCategory) {
      el.className = "category-filter-chip active px-4 py-1.5 rounded-xl text-xs font-black transition flex items-center gap-2 bg-brand-cyan text-black shadow-neon-cyan whitespace-nowrap scale-105 cursor-pointer";
    } else {
      el.className = "category-filter-chip px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-2 glass-card hover:bg-white/15 border border-white/15 text-white whitespace-nowrap scale-100 cursor-pointer";
    }
  });

  const indicator = document.getElementById('categoryActiveIndicator');
  if (indicator) {
    if (selectedCategory === 'All') {
      indicator.innerText = "All Categories Active";
      indicator.className = "hidden sm:inline-flex text-[11px] font-semibold text-brand-cyan bg-brand-cyan/10 border border-brand-cyan/20 px-2.5 py-0.5 rounded-full whitespace-nowrap";
    } else {
      indicator.innerText = `Viewing: ${selectedCategory}`;
      indicator.className = "hidden sm:inline-flex text-[11px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 rounded-full whitespace-nowrap";
    }
  }

  const homeView = document.getElementById('homeView');
  const dedicatedCategoryView = document.getElementById('dedicatedCategoryView');
  const showPlayerPage = document.getElementById('showPlayerPage');

  // Close player page if currently open when switching categories
  if (showPlayerPage && !showPlayerPage.classList.contains('hidden')) {
    pauseYtVideo();
    showPlayerPage.classList.add('hidden');
  }

  if (selectedCategory === 'All') {
    // Show Main Homepage with Hero and Sliders
    if (dedicatedCategoryView) dedicatedCategoryView.classList.add('hidden');
    if (homeView) {
      homeView.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } else {
    // Hide Homepage, Transition to Dedicated Category Full-Page Slide
    if (homeView) homeView.classList.add('hidden');
    if (dedicatedCategoryView) {
      dedicatedCategoryView.classList.remove('hidden');
      renderDedicatedCategoryGrid(selectedCategory);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  if (window.showToast) {
    window.showToast(selectedCategory === 'All' ? 'Browsing Show Verse Homepage' : `Switched to ${selectedCategory} Category`);
  }
}

// Render the dedicated category full-page grid (1 Poster per Show)
function renderDedicatedCategoryGrid(category) {
  const titleEl = document.getElementById('categoryHeaderTitle');
  const subtitleEl = document.getElementById('categoryHeaderSubtitle');
  const iconEl = document.getElementById('categoryHeaderIcon');
  const countBadgeEl = document.getElementById('categorySeriesCountBadge');
  const gridContainer = document.getElementById('categoryShowsGrid');

  if (!gridContainer) return;

  const shows = groupedShows.filter(s => s.category === category);

  // Category specific branding
  const meta = {
    'Kdrama': {
      title: 'Korean Dramas & Series',
      desc: 'Romance, thriller, and action K-dramas with official subtitles and studio dubs.',
      icon: 'heart',
      color: 'text-rose-400',
      border: 'border-rose-500/40'
    },
    'Anime': {
      title: 'Anime Universe',
      desc: 'Top-tier seasonal animation, shonen, and fantasy series in Dolby Atmos.',
      icon: 'zap',
      color: 'text-brand-cyan',
      border: 'border-brand-cyan/40'
    },
    'Chinese Drama': {
      title: 'Chinese Historical & Modern Dramas',
      desc: 'Wuxia, xianxia, and contemporary romantic drama series streaming in high bitrate.',
      icon: 'flame',
      color: 'text-amber-400',
      border: 'border-amber-500/40'
    },
    'Movie': {
      title: 'Feature Cinema & Movies',
      desc: 'Full-length cinematic blockbuster movies, 4K masters, and high-fidelity sound.',
      icon: 'film',
      color: 'text-purple-400',
      border: 'border-purple-500/40'
    }
  }[category] || {
    title: `${category} Series`,
    desc: 'Browse streaming series on Show Verse.',
    icon: 'compass',
    color: 'text-brand-cyan',
    border: 'border-brand-cyan/40'
  };

  if (titleEl) titleEl.innerText = meta.title;
  if (subtitleEl) subtitleEl.innerText = meta.desc;
  if (iconEl) {
    iconEl.className = `w-12 h-12 rounded-2xl bg-white/5 border ${meta.border} ${meta.color} flex items-center justify-center shadow-lg`;
    iconEl.innerHTML = `<i data-lucide="${meta.icon}" class="w-6 h-6"></i>`;
  }
  if (countBadgeEl) {
    countBadgeEl.innerText = `${shows.length} ${shows.length === 1 ? 'Series' : 'Series'} Available`;
  }

  if (shows.length === 0) {
    gridContainer.innerHTML = `
      <div class="col-span-full py-16 text-center glass-card rounded-3xl border border-dashed border-white/10 flex flex-col items-center justify-center gap-3">
        <i data-lucide="${meta.icon}" class="w-12 h-12 text-slate-600"></i>
        <p class="font-bold text-base text-slate-300">No series available in ${category} yet</p>
        <p class="text-xs text-slate-400 max-w-md">Open Creator Studio from the profile menu to upload and publish series in this category.</p>
        <button onclick="filterCategoryView('All')" class="mt-2 px-5 py-2.5 rounded-xl bg-brand-cyan text-black font-bold text-xs shadow-neon-cyan cursor-pointer">
          Back to All Categories
        </button>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  gridContainer.innerHTML = shows.map((show) => {
    const safeTitle = (show.title || 'Untitled').replace(/'/g, "\\'");
    const epCount = show.episodes.length;
    const epLabel = epCount === 1 ? '1 Episode' : `${epCount} Episodes`;

    return `
      <div class="glass-card rounded-2xl overflow-hidden group cursor-pointer border border-white/5 hover:border-brand-cyan/40 transition-all duration-300 hover:scale-[1.02]" onclick="openShowPlayerPage('${safeTitle}')">
        <div class="relative aspect-[2/3] overflow-hidden bg-slate-950">
          <img src="${show.image}" alt="${show.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
          <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent"></div>
          
          <div class="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-brand-cyan/90 text-black text-[10px] font-black uppercase shadow-neon-cyan">
            ★ ${show.rating}
          </div>

          <div class="absolute bottom-2.5 left-2.5 right-2.5">
            <span class="text-[10px] text-amber-400 font-mono font-bold block mb-0.5">🔥 ${formatViews(show.views)} Views</span>
            <h3 class="text-xs sm:text-sm font-black text-white truncate group-hover:text-brand-cyan transition">
              ${show.title}
            </h3>
            <p class="text-[11px] text-slate-400 truncate mt-0.5">${show.category} • ${epLabel}</p>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

// 7. YOUTUBE-STYLE SHOW DETAILS & PLAYER PAGE CONTROLLER
export function openShowPlayerPage(showKeyOrTitle, episodeIndex = 0, resumeTime = 0) {
  if (!showKeyOrTitle) return;

  const raw = String(showKeyOrTitle).trim().toLowerCase();
  const cleanKey = cleanSeriesTitle(showKeyOrTitle).trim().toLowerCase();
  let show = groupedShows.find(s => 
    s.showKey === raw || 
    s.title.toLowerCase() === raw || 
    s.showKey === cleanKey || 
    s.title.toLowerCase() === cleanKey
  );

  // Fallback: If not found yet, re-group
  if (!show) {
    groupedShows = groupEpisodesIntoShows(firestoreEpisodes);
    show = groupedShows.find(s => 
      s.showKey === raw || 
      s.title.toLowerCase() === raw || 
      s.showKey === cleanKey || 
      s.title.toLowerCase() === cleanKey
    );
  }

  if (!show) {
    console.warn(`[Show Verse] Show "${showKeyOrTitle}" not found in grouped database.`);
    if (window.showToast) window.showToast(`Series "${showKeyOrTitle}" is being loaded...`);
    return;
  }

  currentSelectedShow = show;
  currentSelectedEpisodeIndex = Math.max(0, Math.min(show.episodes.length - 1, Number(episodeIndex) || 0));

  // Remember previous view so "Back to Browse" returns to the right screen
  const homeView = document.getElementById('homeView');
  const dedicatedCategoryView = document.getElementById('dedicatedCategoryView');
  const showPlayerPage = document.getElementById('showPlayerPage');

  if (dedicatedCategoryView && !dedicatedCategoryView.classList.contains('hidden')) {
    previousViewBeforePlayer = currentCategoryFilter || 'category';
  } else {
    previousViewBeforePlayer = 'home';
  }

  // Increment series views dynamically & save
  incrementShowViews(show.showKey);

  // Switch UI view to YouTube Player Page
  if (homeView) homeView.classList.add('hidden');
  if (dedicatedCategoryView) dedicatedCategoryView.classList.add('hidden');
  if (showPlayerPage) {
    showPlayerPage.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Populate Metadata (Ensure clean series title without S1 Ep 1 suffix)
  const cleanTitle = cleanSeriesTitle(show.title);
  const breadcrumbCat = document.getElementById('ytBreadcrumbCategory');
  const breadcrumbTitle = document.getElementById('ytBreadcrumbTitle');
  const showTitleEl = document.getElementById('ytShowTitle');
  const showDescEl = document.getElementById('ytShowDesc');
  const showViewsEl = document.getElementById('ytShowViews');
  const metaCategoryEl = document.getElementById('ytMetaCategory');
  const metaSeasonEl = document.getElementById('ytMetaSeason');
  const metaRatingEl = document.getElementById('ytMetaRating');
  const episodeCountBadge = document.getElementById('ytEpisodeCountBadge');

  if (breadcrumbCat) breadcrumbCat.innerText = show.category;
  if (breadcrumbTitle) breadcrumbTitle.innerText = cleanTitle;
  if (showTitleEl) showTitleEl.innerText = cleanTitle;
  if (showDescEl) showDescEl.innerText = show.description;
  if (showViewsEl) showViewsEl.innerHTML = `<i data-lucide="flame" class="w-4 h-4 text-amber-400"></i> ${formatViews(show.views)} Views`;
  if (metaCategoryEl) metaCategoryEl.innerText = show.category;
  if (metaSeasonEl) metaSeasonEl.innerText = `Season ${show.season || '1'}`;
  if (metaRatingEl) metaRatingEl.innerText = `★ ${show.rating}`;
  if (episodeCountBadge) {
    const total = show.episodes.length;
    episodeCountBadge.innerText = `${total} ${total === 1 ? 'Episode' : 'Episodes'}`;
  }

  // Load Active Episode into Embedded Video
  loadActiveYtEpisode(currentSelectedEpisodeIndex, resumeTime);

  // Render Horizontal Episodes Carousel
  renderYtEpisodesRow();

  // Render Suggested for You Carousel
  renderYtSuggestedRow();

  if (window.lucide) window.lucide.createIcons();
}

function loadActiveYtEpisode(index, resumeTime = 0) {
  if (!currentSelectedShow || !currentSelectedShow.episodes[index]) return;

  const episode = currentSelectedShow.episodes[index];
  const video = document.getElementById('ytVideo');
  const curEpTitle = document.getElementById('ytCurrentEpisodeTitle');
  const badgeQuality = document.getElementById('ytBadgeQuality');

  if (curEpTitle) {
    if (currentSelectedShow.category === 'Movie' && currentSelectedShow.episodes.length === 1) {
      curEpTitle.innerText = 'Feature Film • 4K Master';
    } else {
      curEpTitle.innerText = `Episode ${episode.episodeNumber}`;
    }
  }
  if (badgeQuality) {
    badgeQuality.innerText = `${(episode.quality || '1080p').toUpperCase()} MASTER`;
  }

  // Track in Watch History immediately
  if (typeof window.recordWatchHistory === 'function') {
    window.recordWatchHistory({
      id: episode.id,
      title: `${cleanSeriesTitle(currentSelectedShow.title)} - Ep ${episode.episodeNumber}`,
      videoUrl: episode.videoUrl,
      image: episode.image || currentSelectedShow.image,
      category: currentSelectedShow.category,
      currentTime: Number(resumeTime) || 0
    });
  }

  if (video) {
    const targetUrl = episode.videoUrl || 'https://vjs.zencdn.net/v/oceans.mp4';
    video.src = targetUrl;
    video.load();

    // Check resume timestamp from Continue Watching if not provided
    let seekTo = Number(resumeTime) || 0;
    if (seekTo <= 0 && typeof window.getContinueWatchingList === 'function') {
      const saved = window.getContinueWatchingList().find(x => x.title && x.title.includes(cleanSeriesTitle(currentSelectedShow.title)));
      if (saved && saved.currentTime > 2) {
        seekTo = saved.currentTime;
      }
    }

    const applyResume = () => {
      if (seekTo > 0 && video.duration && seekTo < video.duration) {
        video.currentTime = seekTo;
        if (window.showToast) window.showToast(`Resumed Ep ${episode.episodeNumber} at ${formatDuration(seekTo)}`);
      }
    };

    video.addEventListener('loadedmetadata', applyResume, { once: true });

    // Auto-play
    const p = video.play();
    if (p !== undefined) {
      p.then(() => updateYtPlayIcon(true))
       .catch(() => updateYtPlayIcon(false));
    }

    initYtVideoListeners();
  }
}

// Render Horizontal Scrollable Row showing ALL Episodes of the current grouped show
function renderYtEpisodesRow() {
  const container = document.getElementById('ytEpisodesRow');
  if (!container || !currentSelectedShow) return;

  const episodes = currentSelectedShow.episodes;

  if (!episodes || episodes.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center text-xs text-slate-400 w-full glass-card rounded-2xl border border-white/10">
        No episodes published for this show yet.
      </div>
    `;
    return;
  }

  // If single movie entry
  if (currentSelectedShow.category === 'Movie' && episodes.length === 1) {
    container.innerHTML = `
      <button type="button" onclick="switchYtEpisode(0)" class="px-5 py-3 rounded-2xl border-2 border-brand-cyan shadow-neon-cyan bg-brand-cyan/20 text-brand-cyan font-black text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer transition">
        <i data-lucide="film" class="w-4 h-4"></i>
        <span>Full Movie / Feature Film</span>
      </button>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  container.innerHTML = episodes.map((ep, idx) => {
    const isActive = idx === currentSelectedEpisodeIndex;

    return `
      <button 
        type="button"
        onclick="switchYtEpisode(${idx})" 
        id="ep-btn-${idx}" 
        title="Episode ${ep.episodeNumber}" 
        aria-label="Play Episode ${ep.episodeNumber}"
        class="episode-selector-btn flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl flex items-center justify-center transition-all duration-200 cursor-pointer select-none relative ${
          isActive 
            ? 'is-active border-2 border-brand-cyan shadow-neon-cyan bg-brand-cyan/20 text-brand-cyan font-black scale-105 ring-2 ring-brand-cyan/40' 
            : 'bg-white/5 hover:bg-white/15 border border-white/10 hover:border-brand-cyan/40 text-slate-200 hover:text-white font-bold'
        }">
        <span class="text-xl sm:text-2xl font-black">${ep.episodeNumber}</span>
      </button>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

// Render "Suggested for You" Horizontal Slider Row
function renderYtSuggestedRow() {
  const container = document.getElementById('ytSuggestedRow');
  if (!container || !currentSelectedShow) return;

  // Other shows except current
  const others = groupedShows.filter(s => s.showKey !== currentSelectedShow.showKey);
  const suggested = others.slice(0, 8);

  if (suggested.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center text-xs text-slate-400 w-full glass-card rounded-2xl border border-white/10">
        More recommendations will appear as new series are uploaded.
      </div>
    `;
    return;
  }

  container.innerHTML = suggested.map((show) => {
    const safeTitle = (show.title || 'Untitled').replace(/'/g, "\\'");
    const epCount = show.episodes.length;
    const epLabel = epCount === 1 ? '1 Ep' : `${epCount} Eps`;

    return `
      <div onclick="openShowPlayerPage('${safeTitle}')" class="flex-shrink-0 w-44 sm:w-48 glass-card rounded-2xl overflow-hidden cursor-pointer border border-white/5 hover:border-brand-purple/50 transition-all duration-300 group">
        <div class="relative aspect-[2/3] overflow-hidden bg-slate-950">
          <img src="${show.image}" alt="${show.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
          <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent"></div>
          
          <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-brand-purple/90 text-white text-[9px] font-black uppercase">
            ★ ${show.rating}
          </div>

          <div class="absolute bottom-2.5 left-2.5 right-2.5">
            <span class="text-[9px] text-amber-400 font-mono font-bold block mb-0.5">🔥 ${formatViews(show.views)}</span>
            <h4 class="text-xs font-black text-white truncate group-hover:text-purple-300 transition">${show.title}</h4>
            <p class="text-[10px] text-slate-400 truncate">${show.category} • ${epLabel}</p>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

// Switch episode in the YouTube-Style Player Page
export function switchYtEpisode(index) {
  if (!currentSelectedShow || !currentSelectedShow.episodes[index]) return;
  currentSelectedEpisodeIndex = index;
  loadActiveYtEpisode(index);
  renderYtEpisodesRow();
  // Scroll video into view smoothly if user is looking down at episodes
  const stage = document.getElementById('ytPlayerStage');
  if (stage) {
    stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Close the YouTube-Style Player Page and return to browsing
export function closeShowPlayerPage() {
  pauseYtVideo();
  const showPlayerPage = document.getElementById('showPlayerPage');
  const homeView = document.getElementById('homeView');
  const dedicatedCategoryView = document.getElementById('dedicatedCategoryView');

  if (document.fullscreenElement || document.webkitFullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }

  if (showPlayerPage) showPlayerPage.classList.add('hidden');

  if (previousViewBeforePlayer === 'home' || previousViewBeforePlayer === 'All') {
    if (homeView) homeView.classList.remove('hidden');
  } else {
    if (dedicatedCategoryView) dedicatedCategoryView.classList.remove('hidden');
    else if (homeView) homeView.classList.remove('hidden');
  }
}

// Embedded YouTube-Style Video Engine Controls
function initYtVideoListeners() {
  const video = document.getElementById('ytVideo');
  if (!video) return;

  let lastSave = 0;

  video.ontimeupdate = () => {
    const cur = video.currentTime;
    const dur = video.duration;
    if (!Number.isFinite(dur) || dur <= 0 || !Number.isFinite(cur)) return;

    const pct = Math.max(0, Math.min(100, (cur / dur) * 100));
    const progressBar = document.getElementById('ytProgressBar');
    const timeDisplay = document.getElementById('ytTimeDisplay');

    if (progressBar) progressBar.style.width = `${pct}%`;
    if (timeDisplay) timeDisplay.innerText = `${formatDuration(cur)} / ${formatDuration(dur)}`;

    // Periodic progress saving
    const curSec = Math.floor(cur);
    if (curSec - lastSave >= 3) {
      lastSave = curSec;
      if (typeof window.saveContinueWatchingProgress === 'function') {
        window.saveContinueWatchingProgress(cur, dur);
      }
    }

    // Buffered bar
    if (video.buffered && video.buffered.length > 0) {
      const bEnd = video.buffered.end(video.buffered.length - 1);
      if (Number.isFinite(bEnd)) {
        const bPct = Math.max(0, Math.min(100, (bEnd / dur) * 100));
        const bBar = document.getElementById('ytBufferedBar');
        if (bBar) bBar.style.width = `${bPct}%`;
      }
    }
  };

  video.onpause = () => {
    updateYtPlayIcon(false);
    if (typeof window.saveContinueWatchingProgress === 'function') {
      window.saveContinueWatchingProgress(video.currentTime, video.duration);
    }
  };

  video.onplay = () => {
    updateYtPlayIcon(true);
  };

  video.onended = () => {
    updateYtPlayIcon(false);
    if (typeof window.saveContinueWatchingProgress === 'function') {
      window.saveContinueWatchingProgress(video.currentTime, video.duration);
    }
    // Auto advance to next episode if available
    if (currentSelectedShow && currentSelectedEpisodeIndex < currentSelectedShow.episodes.length - 1) {
      if (window.showToast) window.showToast("Playing next episode...");
      switchYtEpisode(currentSelectedEpisodeIndex + 1);
    }
  };
}

export function toggleYtPlay() {
  const video = document.getElementById('ytVideo');
  if (!video) return;
  if (video.paused) {
    video.play();
    updateYtPlayIcon(true);
  } else {
    video.pause();
    updateYtPlayIcon(false);
  }
}

export function pauseYtVideo() {
  const video = document.getElementById('ytVideo');
  if (video && !video.paused) {
    video.pause();
    updateYtPlayIcon(false);
  }
}

function updateYtPlayIcon(isPlaying) {
  const icon = document.getElementById('ytPlayIcon');
  if (icon) {
    icon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
    if (window.lucide) window.lucide.createIcons();
  }
}

let ytSkipAnimTimeout = null;
let ytLastTapTime = 0;
let ytLastTapX = 0;
let ytSingleTapTimeout = null;

export function triggerYtSkipAnimation(seconds) {
  const isForward = seconds > 0;
  const leftEl = document.getElementById('ytSkipLeftIndicator');
  const rightEl = document.getElementById('ytSkipRightIndicator');
  const targetEl = isForward ? rightEl : leftEl;
  const otherEl = isForward ? leftEl : rightEl;
  const textEl = document.getElementById(isForward ? 'ytSkipRightText' : 'ytSkipLeftText');

  if (otherEl) {
    otherEl.classList.remove('animate-skip-left', 'animate-skip-right');
  }

  if (targetEl) {
    if (textEl) textEl.innerText = `${isForward ? '+' : ''}${seconds}s`;
    targetEl.classList.remove('animate-skip-left', 'animate-skip-right');
    // Force reflow
    void targetEl.offsetWidth;
    targetEl.classList.add(isForward ? 'animate-skip-right' : 'animate-skip-left');

    if (ytSkipAnimTimeout) clearTimeout(ytSkipAnimTimeout);
    ytSkipAnimTimeout = setTimeout(() => {
      targetEl.classList.remove('animate-skip-left', 'animate-skip-right');
    }, 650);
  }
}

export function handleYtPlayerTap(e) {
  if (e.target.closest('button, input, select, a, #ytScrubContainer, #ytControlsOverlay .space-y-3, #ytControlsOverlay .flex-items-center')) {
    return;
  }

  const stage = document.getElementById('ytPlayerStage');
  if (!stage) return;

  const now = Date.now();
  const tapDelay = now - ytLastTapTime;
  const rect = stage.getBoundingClientRect();
  const tapX = e.clientX - rect.left;
  const width = rect.width;

  if (tapDelay < 320 && Math.abs(tapX - ytLastTapX) < 120) {
    // DOUBLE TAP DETECTED
    if (ytSingleTapTimeout) {
      clearTimeout(ytSingleTapTimeout);
      ytSingleTapTimeout = null;
    }
    ytLastTapTime = 0;

    if (tapX < width * 0.42) {
      skipYtTime(-10);
    } else if (tapX > width * 0.58) {
      skipYtTime(10);
    } else {
      toggleYtPlay();
    }
  } else {
    ytLastTapTime = now;
    ytLastTapX = tapX;
    if (ytSingleTapTimeout) clearTimeout(ytSingleTapTimeout);
    ytSingleTapTimeout = setTimeout(() => {
      toggleYtPlay();
      ytSingleTapTimeout = null;
    }, 280);
  }
}

export function skipYtTime(seconds) {
  const video = document.getElementById('ytVideo');
  if (!video || !Number.isFinite(video.duration)) return;
  const target = Math.max(0, Math.min(video.duration, video.currentTime + Number(seconds)));
  video.currentTime = target;
  triggerYtSkipAnimation(seconds);
}

export function seekYtVideo(e) {
  const video = document.getElementById('ytVideo');
  const bar = document.getElementById('ytScrubContainer');
  if (!video || !bar || !Number.isFinite(video.duration)) return;
  const rect = bar.getBoundingClientRect();
  if (!rect.width) return;
  const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  video.currentTime = pos * video.duration;
}

export function changeYtVolume(val) {
  const video = document.getElementById('ytVideo');
  if (!video) return;
  video.volume = Math.max(0, Math.min(1, Number(val)));
  const icon = document.getElementById('ytVolumeIcon');
  if (icon) {
    icon.setAttribute('data-lucide', video.volume === 0 ? 'volume-x' : 'volume-2');
    if (window.lucide) window.lucide.createIcons();
  }
}

export function toggleYtMute() {
  const video = document.getElementById('ytVideo');
  if (!video) return;
  video.muted = !video.muted;
  const slider = document.getElementById('ytVolumeSlider');
  if (slider) slider.value = video.muted ? 0 : video.volume;
  changeYtVolume(video.muted ? 0 : 1);
}

export function toggleYtAmbient() {
  const stage = document.getElementById('ytPlayerStage');
  const btn = document.getElementById('ytAmbientBtn');
  if (!stage) return;
  isYtAmbientOn = !isYtAmbientOn;
  if (isYtAmbientOn) {
    stage.classList.add('yt-player-glow');
    if (btn) btn.classList.add('text-brand-cyan');
    if (window.showToast) window.showToast("Ambient Lighting: ON");
  } else {
    stage.classList.remove('yt-player-glow');
    if (btn) btn.classList.remove('text-brand-cyan');
    if (window.showToast) window.showToast("Ambient Lighting: OFF");
  }
}

export function toggleYtFullscreen() {
  const stage = document.getElementById('ytPlayerStage');
  if (!stage) return;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    if (stage.requestFullscreen) {
      stage.requestFullscreen().catch(() => {});
    } else if (stage.webkitRequestFullscreen) {
      stage.webkitRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
}

export function toggleFullscreenPlayerModal() {
  // If user prefers the cinema full modal, route active episode there
  if (currentSelectedShow && currentSelectedShow.episodes[currentSelectedEpisodeIndex]) {
    const ep = currentSelectedShow.episodes[currentSelectedEpisodeIndex];
    const video = document.getElementById('ytVideo');
    const curTime = video ? video.currentTime : 0;
    pauseYtVideo();
    if (typeof window.playMedia === 'function') {
      window.playMedia(
        `${currentSelectedShow.title} - Ep ${ep.episodeNumber}`,
        ep.videoUrl,
        curTime,
        { id: ep.id, image: ep.image || currentSelectedShow.image, category: currentSelectedShow.category }
      );
    }
  }
}

// Global Exports
export function scrollSlider(rowId, distance) {
  const row = document.getElementById(rowId);
  if (row) {
    row.scrollBy({ left: distance, behavior: 'smooth' });
  }
}

// Expose all functions to window for global and inline access
if (typeof window !== "undefined") {
  window.scrollSlider = scrollSlider;
  window.filterCategoryView = filterCategoryView;
  window.renderCategoryRows = renderCategoryRows;
  window.renderTrendingRows = renderTrendingRows;
  window.renderHeroFromFirestore = renderHeroFromFirestore;
  window.renderAllViews = renderAllViews;
  window.initShowverseEpisodesSync = initShowverseEpisodesSync;
  window.normalizeCategory = normalizeCategory;
  window.groupEpisodesIntoShows = groupEpisodesIntoShows;
  window.openShowPlayerPage = openShowPlayerPage;
  window.closeShowPlayerPage = closeShowPlayerPage;
  window.switchYtEpisode = switchYtEpisode;
  window.toggleYtPlay = toggleYtPlay;
  window.handleYtPlayerTap = handleYtPlayerTap;
  window.triggerYtSkipAnimation = triggerYtSkipAnimation;
  window.skipYtTime = skipYtTime;
  window.seekYtVideo = seekYtVideo;
  window.changeYtVolume = changeYtVolume;
  window.toggleYtMute = toggleYtMute;
  window.toggleYtAmbient = toggleYtAmbient;
  window.toggleYtFullscreen = toggleYtFullscreen;
  window.toggleFullscreenPlayerModal = toggleFullscreenPlayerModal;
}

// Auto-initialize when DOM is ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener('DOMContentLoaded', () => {
      initShowverseEpisodesSync();
    });
  } else {
    initShowverseEpisodesSync();
  }
}
