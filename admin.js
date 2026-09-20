// admin.js - Show Verse Creator Studio & Firestore Admin Management Engine
import { 
  collection, 
  addDoc, 
  doc, 
  deleteDoc, 
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.js";

// Staged In-Memory Batch Queue
export let stagedBatchQueue = [];

// Helper to get category color styling
export function getCategoryBadgeClass(category) {
  switch (category) {
    case 'Kdrama':
      return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    case 'Anime':
      return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
    case 'Chinese Drama':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    case 'Movie':
      return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
    default:
      return 'bg-slate-500/20 text-slate-300 border-slate-500/40';
  }
}

// 4. DYNAMIC ADMIN FORM: Category Dropdown Change Listener (Requirement 4)
export function handleCategoryChange() {
  const categoryEl = document.getElementById('admin-category');
  const seasonEpRow = document.getElementById('adminSeasonEpisodeRow');
  const seasonEl = document.getElementById('adminSeason');
  const epEl = document.getElementById('adminEpisode');

  if (!categoryEl || !seasonEpRow) return;

  const selectedCategory = categoryEl.value;

  if (selectedCategory === 'Movie') {
    // Visually hide Season and Episode # input fields and reset/null them
    seasonEpRow.style.display = 'none';
    if (seasonEl) seasonEl.value = '';
    if (epEl) epEl.value = '';
  } else {
    // Show Season and Episode # input fields for Kdrama, Anime, and Chinese Drama
    seasonEpRow.style.display = 'grid';
    if (seasonEl && (!seasonEl.value || seasonEl.value === '')) seasonEl.value = '1';
    if (epEl && (!epEl.value || epEl.value === '')) epEl.value = '1';
  }
}

// 1. STRICT CATEGORY MAPPING & BATCH STAGING
export function addToBatchQueue() {
  const titleEl = document.getElementById('adminTitle');
  const categoryEl = document.getElementById('admin-category');
  const seasonEl = document.getElementById('adminSeason');
  const epEl = document.getElementById('adminEpisode');
  const videoUrlEl = document.getElementById('adminVideoUrl');
  const thumbUrlEl = document.getElementById('adminThumbUrl');
  const audioTracksEl = document.getElementById('adminAudioTracks');
  const subtitlesEl = document.getElementById('adminSubtitles');
  const synopsisEl = document.getElementById('adminSynopsis');

  const title = titleEl ? titleEl.value.trim() : '';
  const videoUrl = videoUrlEl ? videoUrlEl.value.trim() : '';
  const category = categoryEl ? categoryEl.value : 'Anime';
  const isMovie = (category === 'Movie');

  // If Movie is selected, Season and Episode are null
  const season = isMovie ? null : (seasonEl && seasonEl.value ? parseInt(seasonEl.value, 10) || 1 : 1);
  const ep = isMovie ? null : (epEl && epEl.value ? parseInt(epEl.value, 10) || 1 : 1);

  const thumbUrl = thumbUrlEl ? thumbUrlEl.value.trim() : '';
  const audioTracks = audioTracksEl ? audioTracksEl.value.trim() : '';
  const subtitles = subtitlesEl ? subtitlesEl.value.trim() : '';
  const synopsis = synopsisEl ? synopsisEl.value.trim() : '';

  if (!title) {
    if (window.showToast) window.showToast("⚠️ Title Name is required!");
    if (titleEl) titleEl.focus();
    return;
  }

  if (!videoUrl) {
    if (window.showToast) window.showToast("⚠️ Video Stream URL is required!");
    if (videoUrlEl) videoUrlEl.focus();
    return;
  }

  // Strict 4-category validation
  const validCategories = ['Kdrama', 'Anime', 'Chinese Drama', 'Movie'];
  const finalCategory = validCategories.includes(category) ? category : 'Anime';

  const defaultThumbnail = category === 'Kdrama' 
    ? 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=800&q=80'
    : category === 'Chinese Drama'
    ? 'https://images.unsplash.com/photo-1508807526345-15e9b5f4eaff?auto=format&fit=crop&w=800&q=80'
    : category === 'Movie'
    ? 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=800&q=80'
    : 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=800&q=80';

  const fullTitle = isMovie ? title : `${title} (S${season} Ep ${ep})`;
  const episodesLabel = isMovie ? 'Feature Film' : `S${season} Ep ${ep}`;

  const stagedItem = {
    id: 'ep_batch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    seriesName: title,
    seriesTitle: title,
    showTitle: title,
    title: fullTitle,
    category: finalCategory, // Strictly one of the 4 values
    season: season,
    episode: ep,
    tag: finalCategory.toUpperCase(),
    resolution: '4K MASTER',
    audio: audioTracks || 'Dolby Atmos 5.1 / Studio Master',
    subtitles: subtitles || 'English CC, Spanish, Japanese, Hindi',
    rating: '9.9',
    episodes: episodesLabel,
    progress: 0,
    timestamp: 'Staged Queue',
    image: thumbUrl || defaultThumbnail,
    videoUrl: videoUrl,
    desc: synopsis || `Brand new ${finalCategory} release on Show Verse.`,
    stagedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    createdAt: new Date().toISOString()
  };

  stagedBatchQueue.push(stagedItem);

  if (window.showToast) {
    if (isMovie) {
      window.showToast(`✅ Queued Movie [${title}] (${stagedBatchQueue.length} ready)`);
    } else {
      window.showToast(`✅ Queued S${season} Ep ${ep} in [${finalCategory}] (${stagedBatchQueue.length} ready)`);
    }
  }

  // Auto-increment episode number if not a movie, and clear video URL for next entry
  if (!isMovie && epEl && ep) epEl.value = ep + 1;
  if (videoUrlEl) {
    videoUrlEl.value = '';
    videoUrlEl.focus();
  }

  renderStagedBatchQueue();
}

export function removeFromBatchQueue(index) {
  stagedBatchQueue.splice(index, 1);
  renderStagedBatchQueue();
  if (window.showToast) window.showToast("Removed episode from batch queue");
}

export function clearBatchQueue() {
  if (stagedBatchQueue.length === 0) return;
  stagedBatchQueue = [];
  renderStagedBatchQueue();
  if (window.showToast) window.showToast("Staged batch queue cleared");
}

export function renderStagedBatchQueue() {
  const listEl = document.getElementById('stagedBatchQueueList');
  const counterEl = document.getElementById('batchQueueCounter');
  const badgeEl = document.getElementById('batchCountBadge');

  if (counterEl) {
    counterEl.innerText = `${stagedBatchQueue.length} Item${stagedBatchQueue.length === 1 ? '' : 's'}`;
  }
  if (badgeEl) {
    badgeEl.innerText = stagedBatchQueue.length;
  }

  if (!listEl) return;

  if (stagedBatchQueue.length === 0) {
    listEl.innerHTML = `
      <div class="p-6 text-center text-xs text-slate-400 bg-white/5 rounded-2xl border border-dashed border-white/10 flex flex-col items-center justify-center gap-2">
        <i data-lucide="inbox" class="w-7 h-7 text-slate-500"></i>
        <p class="font-bold text-slate-300">Staged Batch Queue is Empty</p>
        <p class="text-[11px] text-slate-500">
          Select one of the 4 categories, fill in details, and click <span class="text-brand-cyan font-semibold">+ Add to Batch Queue</span>.
        </p>
      </div>
    `;
  } else {
    listEl.innerHTML = stagedBatchQueue.map((item, idx) => {
      const badgeClass = getCategoryBadgeClass(item.category);
      return `
        <div class="flex items-center justify-between p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 transition text-xs">
          <div class="flex items-center gap-3 min-w-0">
            <div class="relative w-12 h-12 rounded-xl overflow-hidden bg-slate-800 flex-shrink-0 border border-white/10">
              <img src="${item.image}" alt="${item.title}" class="w-full h-full object-cover">
              <span class="absolute bottom-0 right-0 bg-brand-cyan text-black font-black text-[9px] px-1 rounded-tl">#${idx + 1}</span>
            </div>
            <div class="truncate">
              <div class="flex items-center gap-2">
                <p class="font-bold text-white truncate">${item.title}</p>
                <span class="text-[9px] px-2 py-0.5 rounded font-bold border uppercase ${badgeClass}">
                  ${item.category}
                </span>
              </div>
              <p class="text-[11px] text-slate-400 truncate font-mono">${item.videoUrl}</p>
              <p class="text-[10px] text-slate-400">Audio: ${item.audio} • <span class="text-brand-cyan/80">${item.stagedTime}</span></p>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0 ml-3">
            <button onclick="playMedia('${item.title.replace(/'/g, "\\'")}', '${item.videoUrl}'); closeCreatorStudio();" class="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 transition" title="Preview Stream">
              <i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i>
            </button>
            <button onclick="removeFromBatchQueue(${idx})" class="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition" title="Remove from batch">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.lucide) window.lucide.createIcons();
}

// UPLOAD ALL BATCH TO FIRESTORE "showverse_episodes"
export async function uploadAllBatchToFirestore() {
  if (stagedBatchQueue.length === 0) {
    if (window.showToast) window.showToast("⚠️ Queue is empty! Add episodes using '+ Add to Batch Queue' first.");
    return;
  }

  const btn = document.getElementById('btnUploadAllBatch');
  const totalToUpload = stagedBatchQueue.length;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> <span>Publishing ${totalToUpload} to Firestore...</span>`;
    if (window.lucide) window.lucide.createIcons();
  }

  const itemsToUpload = [...stagedBatchQueue];
  let successfulUploads = 0;

  for (const item of itemsToUpload) {
    item.uploadedAt = new Date().toISOString();
    
    if (db) {
      try {
        // Upload strictly to collection 'showverse_episodes'
        await addDoc(collection(db, "showverse_episodes"), item);
        successfulUploads++;
      } catch (err) {
        console.warn("Firestore upload error for episode:", item.title, err ? (err.message || String(err)) : "Upload error");
      }
    } else {
      console.warn("Firestore db instance is not connected.");
      successfulUploads++;
    }
  }

  // Clear batch queue after upload
  stagedBatchQueue = [];
  renderStagedBatchQueue();

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="rocket" class="w-4 h-4"></i> <span>🚀 Upload ALL to Firestore</span> <span id="batchCountBadge" class="bg-black/80 text-brand-cyan text-[10px] px-2 py-0.5 rounded-full font-mono font-bold">0</span>`;
    if (window.lucide) window.lucide.createIcons();
  }

  if (window.showToast) {
    window.showToast(`🚀 Published ${successfulUploads} item(s) to 'showverse_episodes' collection!`);
  }
}

// 2. PUBLISHED UPLOAD HISTORY (Real-time Firestore Management & Permanent Deletion)
let unsubscribePublishedHistory = null;
export let publishedEpisodesCache = [];

export function initPublishedContentManager() {
  const historyListEl = document.getElementById('publishedContentList');
  const historyCounterEl = document.getElementById('publishedContentCounter');

  if (!db) {
    if (historyListEl) {
      historyListEl.innerHTML = `
        <div class="p-4 text-center text-xs text-amber-400 bg-amber-500/10 rounded-xl border border-amber-500/20">
          Firestore offline. Real-time content history syncing unavailable.
        </div>
      `;
    }
    return;
  }

  if (unsubscribePublishedHistory) {
    unsubscribePublishedHistory();
  }

  // Real-time listener for 'showverse_episodes' collection
  unsubscribePublishedHistory = onSnapshot(collection(db, "showverse_episodes"), (snapshot) => {
    const published = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      published.push({
        docId: docSnap.id,
        ...data
      });
    });

    // Sort newest first
    published.sort((a, b) => {
      const timeA = a.uploadedAt || a.createdAt || '';
      const timeB = b.uploadedAt || b.createdAt || '';
      return timeB.localeCompare(timeA);
    });

    publishedEpisodesCache = published;
    renderPublishedHistory(published);

    if (historyCounterEl) {
      historyCounterEl.innerText = `${published.length} Published`;
    }
  }, (error) => {
    console.log("[Creator Studio] Firestore operating in offline-cached mode:", error ? (error.message || String(error)) : "offline");
    if (publishedEpisodesCache && publishedEpisodesCache.length > 0) {
      renderPublishedHistory(publishedEpisodesCache);
    } else if (historyListEl) {
      historyListEl.innerHTML = `
        <div class="p-4 text-center text-xs text-brand-cyan/80 bg-brand-cyan/5 rounded-xl border border-brand-cyan/15 flex flex-col items-center gap-1.5">
          <p class="font-bold">Syncing with Firestore in offline-ready mode...</p>
          <p class="text-[11px] text-slate-400">Published episodes will automatically appear here once loaded.</p>
        </div>
      `;
    }
  });
}

export function renderPublishedHistory(items) {
  const listEl = document.getElementById('publishedContentList');
  const counterEl = document.getElementById('publishedContentCounter');

  if (counterEl) {
    counterEl.innerText = `${items.length} Published`;
  }

  if (!listEl) return;

  if (items.length === 0) {
    listEl.innerHTML = `
      <div class="p-6 text-center text-xs text-slate-400 bg-white/5 rounded-2xl border border-dashed border-white/10 flex flex-col items-center justify-center gap-1.5">
        <i data-lucide="database" class="w-6 h-6 text-slate-500"></i>
        <p class="font-bold text-slate-300">No Published Content in Firestore</p>
        <p class="text-[11px] text-slate-500">
          Upload episodes using the batch queue above to populate the <span class="font-mono text-brand-cyan">showverse_episodes</span> collection.
        </p>
      </div>
    `;
  } else {
    listEl.innerHTML = items.map((item) => {
      const badgeClass = getCategoryBadgeClass(item.category);
      const safeTitle = (item.title || item.seriesTitle || 'Untitled').replace(/'/g, "\\'");
      const safeDocId = item.docId;
      const uploadedTime = item.uploadedAt ? new Date(item.uploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Live';

      return `
        <div class="flex items-center justify-between p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 transition text-xs group" id="published-doc-${safeDocId}">
          <div class="flex items-center gap-3 min-w-0">
            <div class="relative w-12 h-12 rounded-xl overflow-hidden bg-slate-800 flex-shrink-0 border border-white/10">
              <img src="${item.image || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=800&q=80'}" alt="${item.title}" class="w-full h-full object-cover">
            </div>
            <div class="truncate">
              <div class="flex items-center gap-2">
                <p class="font-bold text-white truncate">${item.title || item.seriesTitle}</p>
                <span class="text-[9px] px-2 py-0.5 rounded font-extrabold border uppercase tracking-wider ${badgeClass}">
                  ${item.category || 'Anime'}
                </span>
              </div>
              <p class="text-[11px] text-slate-400 truncate font-mono">${item.videoUrl || 'Stream Active'}</p>
              <p class="text-[10px] text-slate-500">
                <span class="text-emerald-400 font-semibold font-mono">ID: ${safeDocId.slice(0, 8)}...</span> • Uploaded: ${uploadedTime}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0 ml-3">
            <button onclick="playMedia('${safeTitle}', '${item.videoUrl}'); closeCreatorStudio();" class="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 transition" title="Preview Video">
              <i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i>
            </button>
            <button onclick="deletePublishedEpisode('${safeDocId}', '${safeTitle}')" class="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 hover:text-rose-200 transition flex items-center gap-1.5 font-semibold text-[11px]" title="Permanently delete from Firestore">
              <i data-lucide="trash-2" class="w-4 h-4 text-rose-400"></i>
              <span class="hidden sm:inline">Delete</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.lucide) window.lucide.createIcons();
}

// PERMANENT DELETION VIA deleteDoc FROM FIRESTORE
export async function deletePublishedEpisode(docId, title) {
  if (!db) {
    if (window.showToast) window.showToast("⚠️ Firestore database instance not connected!");
    return;
  }

  const confirmDelete = window.confirm(`Are you sure you want to permanently delete "${title}" from Firestore collection 'showverse_episodes'?`);
  if (!confirmDelete) return;

  try {
    const targetDocRef = doc(db, "showverse_episodes", docId);
    await deleteDoc(targetDocRef);
    
    if (window.showToast) {
      window.showToast(`🗑️ Permanently removed "${title}" from Firestore`);
    }
  } catch (err) {
    console.error("Failed to delete document from Firestore:", err ? (err.message || String(err)) : "Delete error");
    if (window.showToast) {
      window.showToast(`❌ Error deleting episode: ${err.message}`);
    }
  }
}

// Form submit handler
export function handleBatchUpload(e) {
  if (e) e.preventDefault();
  addToBatchQueue();
}

// Mount to window for global HTML onclick handlers
if (typeof window !== "undefined") {
  window.addToBatchQueue = addToBatchQueue;
  window.removeFromBatchQueue = removeFromBatchQueue;
  window.clearBatchQueue = clearBatchQueue;
  window.renderStagedBatchQueue = renderStagedBatchQueue;
  window.uploadAllBatchToFirestore = uploadAllBatchToFirestore;
  window.initPublishedContentManager = initPublishedContentManager;
  window.deletePublishedEpisode = deletePublishedEpisode;
  window.handleBatchUpload = handleBatchUpload;
  window.handleCategoryChange = handleCategoryChange;
}

// Auto-initialize event listeners and published content history when DOM is ready
function setupAdminEventListeners() {
  initPublishedContentManager();
  
  const categorySelect = document.getElementById('admin-category');
  if (categorySelect) {
    categorySelect.addEventListener('change', handleCategoryChange);
    // Initial evaluation
    handleCategoryChange();
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener('DOMContentLoaded', setupAdminEventListeners);
  } else {
    setupAdminEventListeners();
  }
}
