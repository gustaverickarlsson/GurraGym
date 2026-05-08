// ==================== DATA LAYER ====================

const DB_KEY = 'gurragym_data';
const SYNC_KEY = 'gurragym_sync';
const SYNC_FILENAME = 'GurraGym-data.json';

let _dataCache = null;
let _savePending = false;

function safeJsonParse(raw, fallback) {
    try {
        return JSON.parse(raw);
    } catch (err) {
        console.warn('Failed to parse JSON payload, using fallback.', err);
        return fallback;
    }
}

function sanitizeDataShape(value) {
    if (!value || typeof value !== 'object') {
        return { phases: [], logs: [], gyms: [] };
    }
    return {
        ...value,
        phases: Array.isArray(value.phases) ? value.phases : [],
        logs: Array.isArray(value.logs) ? value.logs : [],
        gyms: Array.isArray(value.gyms) ? value.gyms : [],
    };
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function loadData() {
    if (_dataCache) return _dataCache;
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
        _dataCache = sanitizeDataShape(safeJsonParse(raw, { phases: [], logs: [], gyms: [] }));
    } else {
        _dataCache = { phases: [], logs: [], gyms: [] };
    }
    return _dataCache;
}

function saveData(data) {
    _dataCache = data;
    if (_savePending) return;
    _savePending = true;
    requestAnimationFrame(() => {
        data.lastModified = new Date().toISOString();
        localStorage.setItem(DB_KEY, JSON.stringify(data));
        _savePending = false;
        markUnsyncedChanges();
    });
}

function flushSave() {
    if (_savePending && _dataCache) {
        _dataCache.lastModified = new Date().toISOString();
        localStorage.setItem(DB_KEY, JSON.stringify(_dataCache));
        _savePending = false;
    }
}

function invalidateCache() {
    _dataCache = null;
}

function getData() {
    return loadData();
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

// ==================== iCLOUD FILE SYNC ====================

function getSyncInfo() {
    const raw = localStorage.getItem(SYNC_KEY);
    if (raw) return safeJsonParse(raw, { lastSaved: null, lastLoaded: null, hasUnsyncedChanges: false });
    return { lastSaved: null, lastLoaded: null, hasUnsyncedChanges: false };
}

function setSyncInfo(info) {
    localStorage.setItem(SYNC_KEY, JSON.stringify(info));
}

function markUnsyncedChanges() {
    const info = getSyncInfo();
    info.hasUnsyncedChanges = true;
    setSyncInfo(info);
    updateSyncStatus();
}

function exportToFile() {
    flushSave();
    const data = getData();
    const exportData = {
        ...data,
        _exported: new Date().toISOString(),
        _version: 2,
        _app: 'GurraGym'
    };

    const btn = document.getElementById('btn-sync-save');
    btn.classList.add('saving');
    btn.disabled = true;

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });

    const finish = () => {
        setTimeout(() => { btn.classList.remove('saving'); btn.disabled = false; }, 600);
    };

    // Use share API on mobile for direct iCloud save
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], SYNC_FILENAME, { type: 'application/json' })] })) {
        const file = new File([blob], SYNC_FILENAME, { type: 'application/json' });
        navigator.share({
            files: [file],
            title: 'GurraGym Backup',
        }).then(() => {
            markSynced('saved');
            showToast('Sparad till fil!');
            finish();
        }).catch(() => {
            downloadFile(blob);
            finish();
        });
    } else {
        downloadFile(blob);
        finish();
    }
}

function downloadFile(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = SYNC_FILENAME;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    markSynced('saved');
    showToast('Sparad! Flytta filen till iCloud Drive i Filer-appen.');
}

function importFromFile() {
    document.getElementById('sync-file-input').click();
}

function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = sanitizeDataShape(safeJsonParse(e.target.result, null));

            // Validate structure
            if (!Array.isArray(imported?.phases) || !Array.isArray(imported?.logs)) {
                alert('Ogiltig fil - saknar data.');
                return;
            }

            // Check if imported data is newer
            const currentData = getData();
            const currentMod = currentData.lastModified || '2000-01-01';
            const importedMod = imported.lastModified || imported._exported || '2000-01-01';

            if (currentData.logs.length > 0 && currentMod > importedMod) {
                if (!confirm('Lokal data är nyare än filen. Vill du ändå ladda filen? (Lokal data skrivs över)')) {
                    return;
                }
            }

            // Merge or replace
            const mergedData = mergeData(currentData, imported);
            invalidateCache();
            localStorage.setItem(DB_KEY, JSON.stringify(mergedData));

            markSynced('loaded');
            showToast(`Laddad! ${mergedData.phases.length} faser, ${mergedData.logs.length} loggar.`);

            // Refresh everything
            renderWeekBanner();
            renderPhaseIndicator();
            autoSelectCurrentContext();
            renderLogTab();
            if (state.currentTab === 'history') renderHistoryTab();
            if (state.currentTab === 'phases') renderPhasesTab();
            if (state.currentTab === 'program') renderProgramTab();

        } catch (err) {
            alert('Kunde inte läsa filen: ' + err.message);
        }
    };
    reader.readAsText(file);

    // Reset input so same file can be loaded again
    event.target.value = '';
}

function normalizeLogEntry(log) {
    if (!log || typeof log !== 'object') return null;
    if (!log.phaseId || !log.day) return null;
    const week = Number(log.week);
    if (!Number.isFinite(week)) return null;

    return {
        ...log,
        id: typeof log.id === 'string' ? log.id : '',
        phaseId: log.phaseId,
        week,
        day: String(log.day),
        date: log.date || '',
        gym: log.gym || '',
        exercises: Array.isArray(log.exercises) ? log.exercises : [],
    };
}

function mergeData(local, imported) {
    // Smart merge: combine logs from both, prefer newer entries for same unique log id.
    const localGyms = local.gyms || [];
    const importedGyms = imported.gyms || [];
    const mergedGyms = [...new Set([...localGyms, ...importedGyms])];
    const localPhaseMap = new Map((local.phases || []).map(p => [p.id, p]));
    const importedPhaseMap = new Map((imported.phases || []).map(p => [p.id, p]));
    const mergedPhases = [...(local.phases || [])];

    importedPhaseMap.forEach((phase, phaseId) => {
        const localPhase = localPhaseMap.get(phaseId);
        if (!localPhase) {
            mergedPhases.push(phase);
            return;
        }
        const localMod = local.lastModified || '';
        const importedMod = imported.lastModified || imported._exported || '';
        if (importedMod > localMod) {
            const idx = mergedPhases.findIndex(p => p.id === phaseId);
            if (idx >= 0) mergedPhases[idx] = phase;
        }
    });

    const merged = {
        phases: mergedPhases,
        logs: [],
        gyms: mergedGyms,
        lastModified: new Date().toISOString()
    };

    // Build map of all logs by stable id; for id-less legacy entries, use a strict fallback key.
    const logMap = new Map();

    const fallbackKey = (log) => `${log.phaseId}_${log.week}_${log.day}_${log.gym || ''}_${JSON.stringify(log.exercises || [])}`;

    // Add local logs first.
    (local.logs || []).forEach(rawLog => {
        const log = normalizeLogEntry(rawLog);
        if (!log) return;
        const key = log.id ? `id:${log.id}` : `fallback:${fallbackKey(log)}`;
        logMap.set(key, log);
    });

    // Override with imported logs (or add new ones) if imported entry is newer.
    (imported.logs || []).forEach(rawLog => {
        const log = normalizeLogEntry(rawLog);
        if (!log) return;
        const key = log.id ? `id:${log.id}` : `fallback:${fallbackKey(log)}`;
        const existing = logMap.get(key);
        if (!existing || ((log.date || '') >= (existing.date || ''))) {
            logMap.set(key, log);
        }
    });

    merged.logs = Array.from(logMap.values()).map((log) => ({
        ...log,
        id: log.id || generateId(),
    }));
    return merged;
}

function markSynced(type) {
    const info = getSyncInfo();
    const now = new Date().toISOString();
    if (type === 'saved') info.lastSaved = now;
    if (type === 'loaded') info.lastLoaded = now;
    info.hasUnsyncedChanges = false;
    setSyncInfo(info);
    updateSyncStatus();
}

function updateSyncStatus() {
    const el = document.getElementById('sync-status-text');
    if (!el) return;

    const info = getSyncInfo();

    if (info.hasUnsyncedChanges) {
        const lastSync = info.lastSaved || info.lastLoaded;
        if (lastSync) {
            el.textContent = `Osparade ändringar · Senast: ${formatSyncTime(lastSync)}`;
        } else {
            el.textContent = 'Osparade ändringar';
        }
        el.className = 'needs-sync';
    } else if (info.lastSaved || info.lastLoaded) {
        const lastSync = info.lastSaved > (info.lastLoaded || '') ? info.lastSaved : info.lastLoaded;
        const type = info.lastSaved > (info.lastLoaded || '') ? 'Sparad' : 'Laddad';
        el.textContent = `${type}: ${formatSyncTime(lastSync)}`;
        el.className = 'synced';
    } else {
        el.textContent = 'Inte synkad ännu';
        el.className = '';
    }
}

function formatSyncTime(isoStr) {
    const d = new Date(isoStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'just nu';
    if (diffMins < 60) return `${diffMins} min sedan`;
    if (diffHours < 24) return `${diffHours}h sedan`;

    return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }) + ' ' +
           d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

function initSync() {
    document.getElementById('btn-sync-save').addEventListener('click', exportToFile);
    document.getElementById('btn-sync-load').addEventListener('click', importFromFile);
    document.getElementById('sync-file-input').addEventListener('change', handleFileImport);
    updateSyncStatus();

    // Update sync time display every minute
    setInterval(updateSyncStatus, 60000);
}

// ==================== HELP MODAL ====================

function showHelpModal() {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
        <h2>Hur man använder GurraGym</h2>
        <div class="help-content">
            <h3>1. Installera på din telefon</h3>
            <p>Öppna denna länk i Safari (iPhone) eller Chrome (Android):</p>
            <span class="help-url">https://gustaverickarlsson.github.io/GurraGym/</span>
            <ol>
                <li><strong>iPhone:</strong> Tryck på delningsknappen (rutan med pil uppåt) → "Lägg till på hemskärmen"</li>
                <li><strong>Android:</strong> Tryck på menyn (⋮) → "Lägg till på startskärmen"</li>
            </ol>
            <p>Nu har du appen som en ikon på din hemskärm!</p>

            <hr class="help-divider">

            <h3>2. Kom igång</h3>
            <ol>
                <li>Gå till <strong>Faser</strong>-fliken och skapa en ny fas (välj 4, 6 eller 8 veckor)</li>
                <li>Gå till <strong>Program</strong>-fliken och lägg till övningar för varje träningsdag</li>
                <li>Gå till <strong>Logga</strong>-fliken för att börja logga dina pass</li>
            </ol>

            <hr class="help-divider">

            <h3>3. Logga ditt pass</h3>
            <ul>
                <li>Välj rätt fas, vecka, dag och gym</li>
                <li>Fyll i vikt och reps för varje set</li>
                <li>Allt sparas automatiskt efter varje fält</li>
                <li>Timern startar automatiskt efter du fyller i reps (3 min vila)</li>
                <li>Pilar visar om du gått upp ▲ eller ner ▼ i vikt jämfört med förra veckan</li>
            </ul>

            <hr class="help-divider">

            <h3>4. Gym-val</h3>
            <p>Du kan välja vilket gym du tränar på för varje pass. Olika gym har olika utrustning, så det hjälper dig jämföra vikter rätt.</p>
            <p>Hantera dina gym under <strong>Faser</strong>-fliken.</p>

            <hr class="help-divider">

            <h3>5. Synka mellan enheter</h3>
            <ul>
                <li><strong>Spara:</strong> Tryck "Spara" i botten → spara filen till iCloud Drive</li>
                <li><strong>Ladda:</strong> Tryck "Ladda" på den andra enheten → välj filen från iCloud</li>
            </ul>

            <hr class="help-divider">

            <h3>6. Historik</h3>
            <p>Under <strong>Historik</strong>-fliken kan du se din progression per övning över alla faser och veckor.</p>

            <hr class="help-divider">

            <h3>7. Rensa all data</h3>
            <p>Om du vill börja om helt från scratch:</p>
            <ol>
                <li>Öppna webbläsarens utvecklarverktyg (Safari: Inställningar → Avancerat → Webbinspektör)</li>
                <li>Kör: <code>localStorage.clear()</code></li>
                <li>Ladda om sidan</li>
            </ol>
        </div>
        <div class="modal-buttons">
            <button class="btn-primary" id="modal-close-help">Stäng</button>
        </div>
    `;

    overlay.classList.remove('hidden');
    document.getElementById('modal-close-help').onclick = () => overlay.classList.add('hidden');
}

// ==================== GYM MANAGEMENT ====================

function getGyms() {
    return getData().gyms || [];
}

function addGym(name) {
    const data = getData();
    if (!data.gyms) data.gyms = [];
    if (data.gyms.includes(name)) return;
    data.gyms.push(name);
    saveData(data);
}

function removeGym(name) {
    const data = getData();
    data.gyms = (data.gyms || []).filter(g => g !== name);
    saveData(data);
}

function renderGymManager(container) {
    const gyms = getGyms();
    let html = `<div class="gym-manager">
        <label style="font-size:0.85rem; color:var(--text-dim); font-weight:600;">Mina Gym</label>
        <div class="gym-manager-list">`;

    gyms.forEach(g => {
        html += `<span class="gym-tag">${g}<button class="gym-remove" data-gym="${g}">×</button></span>`;
    });

    if (gyms.length === 0) {
        html += `<span style="font-size:0.82rem; color:var(--text-dim);">Inga gym tillagda</span>`;
    }

    html += `</div>
        <div class="gym-add-row">
            <input type="text" id="gym-add-input" placeholder="Lägg till gym..." maxlength="30">
            <button class="btn-secondary" id="gym-add-btn">+</button>
        </div>
    </div>`;

    container.insertAdjacentHTML('beforeend', html);

    container.querySelectorAll('.gym-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            removeGym(btn.dataset.gym);
            renderPhasesTab();
        });
    });

    const addBtn = container.querySelector('#gym-add-btn');
    const addInput = container.querySelector('#gym-add-input');
    const doAdd = () => {
        const name = addInput.value.trim();
        if (name) {
            addGym(name);
            renderPhasesTab();
        }
    };
    addBtn.addEventListener('click', doAdd);
    addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
}

// ==================== EXERCISE CATEGORIES ====================

const CATEGORIES = {
    push: { label: 'Push', color: '#4a9eff' },
    pull: { label: 'Pull', color: '#ab47bc' },
    legs: { label: 'Legs', color: '#66bb6a' },
    core: { label: 'Core', color: '#ffa726' },
    other: { label: 'Övrigt', color: '#78909c' },
};

const CATEGORY_RULES = [
    // Core first (leg raise = core, not legs)
    { cat: 'core', patterns: [/\bplank/i, /\bab\b/i, /\bcrunch/i, /\bleg\s*raise/i, /\bhang/i, /\bsit.?up/i] },
    // Legs
    { cat: 'legs', patterns: [/\bsquat/i, /\bleg\b/i, /\bdeadlift/i, /\bcalf/i, /\bcalfs/i, /\blegpress/i, /\blunge/i, /\bhip\b/i] },
    // Pull (check before push since some overlap)
    { cat: 'pull', patterns: [/\bpull.?up/i, /\bpull.?down/i, /\bchin.?up/i, /\brow\b/i, /\brows\b/i, /\bcurl/i, /\bbicep/i, /\bshrug/i, /\brear\s*delt/i, /\bbayesian/i, /\bpinwheel/i, /\bspider/i, /\bface\s*pull/i] },
    // Push
    { cat: 'push', patterns: [/\bpress/i, /\bbench/i, /\bdip\b/i, /\bdips\b/i, /\bpush.?down/i, /\btricep/i, /\bextension/i, /\blateral\s*raise/i, /\bshoulder/i, /\bflye/i, /\bpec/i, /\bbradford/i, /\barnold/i, /\bpush.?up/i] },
];

function guessCategory(name) {
    const str = name || '';
    for (const rule of CATEGORY_RULES) {
        if (rule.patterns.some(p => p.test(str))) return rule.cat;
    }
    return 'other';
}

function getCategoryBadge(cat) {
    const c = CATEGORIES[cat] || CATEGORIES.other;
    return `<span class="category-badge" style="background:${c.color}22; color:${c.color}; border:1px solid ${c.color}44;">${c.label}</span>`;
}

function getExerciseCategory(exercise) {
    return exercise.category || guessCategory(exercise.name);
}

// ==================== SEED DATA ====================

function seedExampleData() {
    const data = getData();
    if (data.phases.length > 0) return;

    data.phases = [
        {
            id: 'phase1',
            name: 'Phase One',
            weeks: [4, 5, 6, 7],
            days: [
                {
                    name: 'Måndag',
                    exercises: [
                        { id: 'e1', name: 'Dumbbell Press', scheme: '3 sets RPT (4-6, 4-6, 6-8)', notes: '', numSets: 3 },
                        { id: 'e2', name: 'Pulldowns / Weighted Chin-ups', scheme: '3 sets RPT (5, 6, 12)', notes: '', numSets: 3 },
                        { id: 'e3', name: '2 Arm Triceps Extensions kabel', scheme: '3 sets RPT (8-10, 8-10, 10-12)', notes: 'axeln och armbågen stilla i en linje', numSets: 3 },
                        { id: 'e4', name: 'Lateral Raises', scheme: 'Rest Pause (12-15 reps + 4-5, 4-5, 4-5)', notes: '', numSets: 1, restPauseParts: 4 }
                    ]
                },
                {
                    name: 'Onsdag',
                    exercises: [
                        { id: 'e5', name: 'Body weight squat', scheme: '15st', notes: '', numSets: 1 },
                        { id: 'e6', name: 'Legpress', scheme: '3 sets RPT (6-8, 6-8, 8-10)', notes: '', numSets: 3 },
                        { id: 'e7', name: 'Romanian Deadlifts', scheme: '3 sets x 10-12 reps', notes: '', numSets: 3 },
                        { id: 'e8', name: 'Leg extensions', scheme: '3 sets x 10-12 reps', notes: '', numSets: 3 },
                        { id: 'e9', name: 'DB Shrugs', scheme: '3 x 10', notes: '', numSets: 3 }
                    ]
                },
                {
                    name: 'Fredag',
                    exercises: [
                        { id: 'e10', name: 'Incline DB Bench Press', scheme: '4 sets RPT (4-5, 5-6, 6-8, 8-10)', notes: '', numSets: 4 },
                        { id: 'e11', name: 'Pinned Hammer Biceps Curls', scheme: '4 sets (4-8, 4-8, 6-10, 6-10)', notes: '', numSets: 4 },
                        { id: 'e12', name: 'Bent Over Flyes', scheme: 'Rest Pause (12-15 reps + 4-5, 4-5, 4-5)', notes: '', numSets: 1, restPauseParts: 4 },
                        { id: 'e13', name: 'Hanging leg Raises', scheme: '4 sets of 8-12 reps (Kino Rep Training)', notes: '', numSets: 4 }
                    ]
                }
            ]
        },
        {
            id: 'phase2',
            name: 'Phase Two',
            weeks: [8, 9, 10, 11, 12, 13, 14, 15],
            days: [
                {
                    name: 'Måndag',
                    exercises: [
                        { id: 'e14', name: 'Seated Machine Shoulder Press', scheme: '5-8, 8-10, 8-10 (RPT)', notes: '', numSets: 3 },
                        { id: 'e15', name: 'Pull-ups', scheme: '2 sets 6, 8 (RPT)', notes: '', numSets: 2 },
                        { id: 'e16', name: 'Seated Close grip Rows', scheme: '2 sets of 8-12 reps (RPT)', notes: '', numSets: 2 },
                        { id: 'e17', name: 'Triceps Pushdowns', scheme: '6-8, 8-10, 10-12, 10-12 (RPT)', notes: '', numSets: 4 },
                        { id: 'e18', name: 'Lateral raises', scheme: '4 sets of 10-15 reps (Kino Rep Training)', notes: '', numSets: 4 }
                    ]
                },
                {
                    name: 'Onsdag',
                    exercises: [
                        { id: 'e19', name: 'Smithmachine squats', scheme: '3 sets RPT (6-8, 6-8, 8-10)', notes: 'Vikt utan smith stång ena sidan', numSets: 3 },
                        { id: 'e20', name: 'Machine Calf Raises', scheme: '4 sets of 12-15 reps (Kino Rep Training)', notes: '', numSets: 4 },
                        { id: 'e21', name: 'Leg Curls', scheme: '3 sets of 10-12 reps (Kino Rep Training)', notes: '', numSets: 3 },
                        { id: 'e22', name: 'Shrugs', scheme: '4 sets of 12-15 (Kino Rep Training)', notes: '', numSets: 4 }
                    ]
                },
                {
                    name: 'Fredag',
                    exercises: [
                        { id: 'e23', name: 'Seated Machine Chest Press', scheme: '5-8, 8-10, 8-10 (RPT)', notes: '', numSets: 3 },
                        { id: 'e24', name: 'Weighted Dips', scheme: '6, 8 reps (RPT)', notes: '', numSets: 2 },
                        { id: 'e25', name: 'Hammer Curls', scheme: '3 sets of 8-12 (kino rep)', notes: '', numSets: 3 },
                        { id: 'e26', name: 'Spider Incline Curls', scheme: '5-8, 8-10, 10-12 (RPT)', notes: '', numSets: 3 },
                        { id: 'e27', name: 'Cable Face Pulls', scheme: '15-20 + 6-8, 6-8, 6-8 (Rest Pause)', notes: '', numSets: 1, restPauseParts: 4 }
                    ]
                }
            ]
        },
        {
            id: 'phase3',
            name: 'Phase Three',
            weeks: [49, 50, 51, 52],
            days: [
                {
                    name: 'Måndag',
                    exercises: [
                        { id: 'e28', name: 'DB Shoulder Press', scheme: '6-8, 6-8 (Reverse Pyramid Training)', notes: 'Per arm', numSets: 2 },
                        { id: 'e29', name: 'Neutral Weighted Chin-up', scheme: '6-8, 8-10 (Reverse Pyramid Training)', notes: 'knyt händerna som en idiot', numSets: 2 },
                        { id: 'e30', name: 'Bradford Press (or Arnold press)', scheme: '4 sets of 6-10 reps (Kino Density Training)', notes: '60 sec', numSets: 4 },
                        { id: 'e31', name: 'Pendlay Rows', scheme: '4 sets of 6-10 reps (Kino Density Training)', notes: '', numSets: 4 },
                        { id: 'e32', name: 'Rope Pushdowns', scheme: '4 sets of 6-10 reps (Kino Density Training)', notes: '', numSets: 4 },
                        { id: 'e33', name: 'Lateral Raise', scheme: '4 sets of 6-10 reps (Kino Density Training)', notes: 'pausa på toppen', numSets: 4 }
                    ]
                },
                {
                    name: 'Onsdag',
                    exercises: [
                        { id: 'e34', name: 'Leg Curls', scheme: '4 sets of 6-10 reps (Kino Density Training)', notes: '', numSets: 4 },
                        { id: 'e35', name: 'Squat', scheme: '6-8, 6-8 (Reverse Pyramid Training)', notes: '', numSets: 2 },
                        { id: 'e36', name: 'Calfs', scheme: '4 sets of 6-10 reps (Kino Density Training)', notes: '', numSets: 4 },
                        { id: 'e37', name: 'Leg extensions', scheme: '4 sets of 6-10 reps (Kino Density Training)', notes: '', numSets: 4 }
                    ]
                },
                {
                    name: 'Fredag',
                    exercises: [
                        { id: 'e38', name: 'Incline Bench', scheme: '6-8, 6-8 (Reverse Pyramid Training)', notes: '', numSets: 2 },
                        { id: 'e39', name: 'Flat DB Bench Press', scheme: '4 sets of 6-10 reps (Kino Density Training)', notes: '', numSets: 4 },
                        { id: 'e40', name: 'Bayesian Concentration Curls', scheme: '4-6, 6-8, 8-10 (Reverse Pyramid Training)', notes: '', numSets: 3 },
                        { id: 'e41', name: 'Pinwheel Curls', scheme: '4 sets of 6-10 reps (Kino Density Training)', notes: '', numSets: 4 },
                        { id: 'e42', name: 'Pecdeck', scheme: '4 sets of 6-10 reps (Kino Density Training)', notes: '', numSets: 4 },
                        { id: 'e43', name: 'Rear Delt Flyes', scheme: '4 sets of 6-10 reps (Kino Density Training)', notes: '', numSets: 4 }
                    ]
                }
            ]
        }
    ];

    // Example logs for Phase One, Week 4, Måndag
    data.logs = [
        {
            id: 'log1',
            phaseId: 'phase1',
            week: 4,
            day: 'Måndag',
            date: '2026-01-26',
            exercises: [
                {
                    exerciseId: 'e1',
                    name: 'Dumbbell Press',
                    sets: [
                        { weight: '30', reps: '7', notes: '' },
                        { weight: '25', reps: '9', notes: '' },
                        { weight: '22,5', reps: '8', notes: '' }
                    ]
                },
                {
                    exerciseId: 'e2',
                    name: 'Pulldowns / Weighted Chin-ups',
                    sets: [
                        { weight: '96', reps: '5', notes: '' },
                        { weight: '89', reps: '6', notes: '' },
                        { weight: '68', reps: '8', notes: 'Underhand utan band' }
                    ]
                },
                {
                    exerciseId: 'e3',
                    name: '2 Arm Triceps Extensions kabel',
                    sets: [
                        { weight: '27', reps: '8', notes: 'stång' },
                        { weight: '23,5', reps: '10', notes: 'Stång' },
                        { weight: '20', reps: '8', notes: 'Stång' }
                    ]
                },
                {
                    exerciseId: 'e4',
                    name: 'Lateral Raises',
                    sets: [
                        { weight: '12,5', reps: '15', notes: '' },
                        { weight: '', reps: '5', notes: 'rest pause' },
                        { weight: '', reps: '5', notes: 'rest pause' },
                        { weight: '', reps: '4', notes: 'rest pause' }
                    ]
                }
            ]
        },
        {
            id: 'log2',
            phaseId: 'phase1',
            week: 4,
            day: 'Onsdag',
            date: '2026-01-28',
            exercises: [
                {
                    exerciseId: 'e5',
                    name: 'Body weight squat',
                    sets: [{ weight: 'BW', reps: '15', notes: '' }]
                },
                {
                    exerciseId: 'e6',
                    name: 'Legpress',
                    sets: [
                        { weight: '200', reps: '4', notes: '' },
                        { weight: '150', reps: '7', notes: '' },
                        { weight: '100', reps: '8', notes: '' }
                    ]
                },
                {
                    exerciseId: 'e7',
                    name: 'Romanian Deadlifts',
                    sets: [
                        { weight: '60', reps: '12', notes: '' },
                        { weight: '60', reps: '10', notes: '' },
                        { weight: '60', reps: '10', notes: 'höj' }
                    ]
                },
                {
                    exerciseId: 'e8',
                    name: 'Leg extensions',
                    sets: [
                        { weight: '80', reps: '', notes: '' }
                    ]
                },
                {
                    exerciseId: 'e9',
                    name: 'DB Shrugs',
                    sets: [
                        { weight: '25', reps: '12', notes: '' },
                        { weight: '25', reps: '10', notes: '' },
                        { weight: '25', reps: '10', notes: 'höj' }
                    ]
                }
            ]
        },
        {
            id: 'log3',
            phaseId: 'phase1',
            week: 4,
            day: 'Fredag',
            date: '2026-01-30',
            exercises: [
                {
                    exerciseId: 'e10',
                    name: 'Incline DB Bench Press',
                    sets: [
                        { weight: '35', reps: '4', notes: '' },
                        { weight: '32,5', reps: '6', notes: '' },
                        { weight: '30', reps: '6', notes: '' },
                        { weight: '25', reps: '7', notes: '' }
                    ]
                },
                {
                    exerciseId: 'e11',
                    name: 'Pinned Hammer Biceps Curls',
                    sets: [
                        { weight: '25', reps: '6', notes: '' },
                        { weight: '22,5', reps: '8', notes: '' },
                        { weight: '20', reps: '8', notes: '' },
                        { weight: '17,5', reps: '9', notes: '' }
                    ]
                },
                {
                    exerciseId: 'e12',
                    name: 'Bent Over Flyes',
                    sets: [
                        { weight: '8', reps: '12', notes: '' },
                        { weight: '', reps: '5', notes: 'rest pause' },
                        { weight: '', reps: '5', notes: 'rest pause' },
                        { weight: '', reps: '5', notes: 'rest pause' }
                    ]
                },
                {
                    exerciseId: 'e13',
                    name: 'Hanging leg Raises',
                    sets: [
                        { weight: 'BW', reps: '8', notes: '' },
                        { weight: 'BW', reps: '8', notes: '' },
                        { weight: 'BW', reps: '8', notes: '' },
                        { weight: 'BW', reps: '5', notes: '' }
                    ]
                }
            ]
        }
    ];

    saveData(data);
}

// ==================== CURRENT WEEK ====================

function getCurrentWeekNumber() {
    const now = new Date();
    const utcDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayNum = utcDate.getUTCDay() || 7;
    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
    return Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getTodayDayName() {
    const days = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
    return days[new Date().getDay()];
}

function findCurrentPhase(data) {
    const currentWeek = getCurrentWeekNumber();
    // Find phase that contains current week
    for (const phase of data.phases) {
        if (phase.weeks.includes(currentWeek)) return phase;
    }
    // Fallback to last phase
    return data.phases[data.phases.length - 1] || null;
}

// ==================== REST TIMER ====================

let timerState = {
    running: false,
    seconds: 180, // 3 minutes
    total: 180,
    intervalId: null,
};

function initTimer() {
    const timerEl = document.getElementById('rest-timer');
    const startBtn = document.getElementById('timer-start');
    const resetBtn = document.getElementById('timer-reset');

    startBtn.addEventListener('click', () => {
        if (timerState.running) {
            stopTimer();
        } else {
            startTimer();
        }
    });

    resetBtn.addEventListener('click', () => {
        resetTimer();
    });

    updateTimerDisplay();
}

function showTimer() {
    document.getElementById('rest-timer').classList.remove('hidden');
}

function hideTimer() {
    document.getElementById('rest-timer').classList.add('hidden');
    stopTimer();
}

function startTimer() {
    if (timerState.seconds <= 0) {
        timerState.seconds = timerState.total;
    }
    timerState.running = true;
    const startBtn = document.getElementById('timer-start');
    startBtn.textContent = 'Pausa';
    startBtn.classList.add('running');

    timerState.intervalId = setInterval(() => {
        timerState.seconds--;
        updateTimerDisplay();

        if (timerState.seconds <= 0) {
            stopTimer();
            timerDone();
        }
    }, 1000);
}

function stopTimer() {
    timerState.running = false;
    clearInterval(timerState.intervalId);
    const startBtn = document.getElementById('timer-start');
    startBtn.textContent = timerState.seconds <= 0 ? 'Starta 3:00' : 'Fortsätt';
    startBtn.classList.remove('running');
}

function resetTimer() {
    stopTimer();
    timerState.seconds = timerState.total;
    updateTimerDisplay();
    const startBtn = document.getElementById('timer-start');
    startBtn.textContent = 'Starta 3:00';
    const timerEl = document.getElementById('rest-timer');
    timerEl.classList.remove('timer-done', 'timer-warning');
}

function updateTimerDisplay() {
    const display = document.getElementById('timer-display');
    const progress = document.getElementById('timer-progress');
    const mins = Math.floor(timerState.seconds / 60);
    const secs = timerState.seconds % 60;
    display.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    const pct = (timerState.seconds / timerState.total) * 100;
    progress.style.width = pct + '%';

    // Remove all state classes
    display.classList.remove('timer-running', 'timer-done', 'timer-warning');
    progress.classList.remove('warning', 'done');

    if (timerState.seconds <= 0) {
        display.classList.add('timer-done');
        progress.classList.add('done');
    } else if (timerState.seconds <= 30) {
        display.classList.add('timer-warning');
        progress.classList.add('warning');
    } else if (timerState.running) {
        display.classList.add('timer-running');
    }
}

function timerDone() {
    const timerEl = document.getElementById('rest-timer');
    timerEl.classList.add('timer-done');
    document.getElementById('timer-display').textContent = 'KÖR!';
    document.getElementById('timer-start').textContent = 'Starta 3:00';

    // Vibrate if available
    if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 400]);
    }

    // Play a beep
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.3;
        osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, 500);
    } catch (e) {}
}

// ==================== PWA ====================

let deferredPrompt = null;

function initPWA() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js');
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        showInstallBanner();
    });
}

function showInstallBanner() {
    // Create install banner if it doesn't exist
    if (!document.getElementById('pwa-install')) {
        const banner = document.createElement('div');
        banner.id = 'pwa-install';
        const label = document.createElement('span');
        label.textContent = 'Installera GurraGym på din telefon';
        const button = document.createElement('button');
        button.id = 'pwa-install-btn';
        button.textContent = 'Installera';
        banner.appendChild(label);
        banner.appendChild(button);
        document.querySelector('header').after(banner);

        document.getElementById('pwa-install-btn').addEventListener('click', async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const result = await deferredPrompt.userChoice;
                deferredPrompt = null;
                banner.remove();
            }
        });
    }
}

// ==================== APP STATE ====================

let state = {
    currentTab: 'log',
    logPhase: null,
    logWeek: null,
    logDay: null,
    logGym: '',
    progPhase: null,
    progDay: null,
    histPhase: null,
    histDay: null,
    histExercise: null,
};

// ==================== INIT ====================

document.addEventListener('DOMContentLoaded', () => {
    seedExampleData();
    initTabs();
    initTimer();
    initPWA();
    initSync();
    renderWeekBanner();
    renderPhaseIndicator();
    autoSelectCurrentContext();
    renderLogTab();
    renderPhasesTab();
    showTimer();

    document.getElementById('btn-help').addEventListener('click', showHelpModal);

    // Ensure pending saves are flushed before page unload
    window.addEventListener('beforeunload', flushSave);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushSave();
    });
});

// ==================== TABS ====================

function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            document.getElementById('tab-' + tabName).classList.add('active');
            state.currentTab = tabName;

            if (tabName === 'log') { renderLogTab(); showTimer(); }
            else {
                hideTimer();
                if (tabName === 'program') renderProgramTab();
                else if (tabName === 'history') renderHistoryTab();
                else if (tabName === 'phases') renderPhasesTab();
            }
        });
    });
}

// ==================== WEEK BANNER ====================

function renderWeekBanner() {
    const data = getData();
    const el = document.getElementById('week-banner');
    const currentWeek = getCurrentWeekNumber();
    const today = getTodayDayName();
    const currentPhase = findCurrentPhase(data);

    let phaseInfo = '';
    let warningHtml = '';

    if (currentPhase) {
        const weekIdx = currentPhase.weeks.indexOf(currentWeek);
        const weeksLeft = weekIdx >= 0 ? currentPhase.weeks.length - weekIdx - 1 : '?';
        phaseInfo = `<span class="week-detail">${currentPhase.name} &middot; ${weeksLeft} veckor kvar</span>`;

        if (currentPhase.weeks.length >= 8 && weeksLeft <= 1) {
            warningHtml = `<div class="phase-switch-warning">Dags att byta fas snart!</div>`;
        }
    } else if (data.phases.length > 0) {
        phaseInfo = `<span class="week-detail" style="color: var(--orange);">Vecka ${currentWeek} finns inte i någon fas</span>`;
    }

    el.innerHTML = `
        <div>
            <span class="current-week">Vecka ${currentWeek}</span>
            <span class="week-detail">&middot; ${today}</span>
        </div>
        <div style="text-align: right;">
            ${phaseInfo}
            ${warningHtml}
        </div>
    `;
}

function autoSelectCurrentContext() {
    const data = getData();
    const currentWeek = getCurrentWeekNumber();
    const phase = findCurrentPhase(data);

    if (phase) {
        state.logPhase = phase.id;
        state.logWeek = phase.weeks.includes(currentWeek) ? currentWeek : phase.weeks[phase.weeks.length - 1];

        // Auto-select today's day if it matches a training day
        const today = getTodayDayName();
        const matchingDay = phase.days.find(d => d.name === today);
        if (matchingDay) {
            state.logDay = matchingDay.name;
        }
    }
}

// ==================== PHASE INDICATOR ====================

function renderPhaseIndicator() {
    const data = getData();
    const el = document.getElementById('phase-indicator');
    if (data.phases.length === 0) {
        el.innerHTML = 'Inga faser skapade';
        return;
    }

    const currentPhase = findCurrentPhase(data);
    if (!currentPhase) return;
    const weekCount = currentPhase.weeks.length;
    let html = `Aktiv: <strong>${currentPhase.name}</strong> (Vecka ${currentPhase.weeks[0]}-${currentPhase.weeks[currentPhase.weeks.length - 1]})`;

    if (weekCount >= 8) {
        html += ` <span class="phase-warning">Dags att byta fas!</span>`;
    }
    el.innerHTML = html;
}

// ==================== LOG TAB ====================

function renderLogTab() {
    const data = getData();
    const phaseSelect = document.getElementById('log-phase');
    const weekSelect = document.getElementById('log-week');
    const daySelect = document.getElementById('log-day');

    // Populate phases
    phaseSelect.innerHTML = data.phases.map(p =>
        `<option value="${p.id}" ${state.logPhase === p.id ? 'selected' : ''}>${p.name}</option>`
    ).join('');

    if (data.phases.length === 0) {
        phaseSelect.innerHTML = '<option>Skapa en fas först</option>';
        document.getElementById('log-exercises').innerHTML = '<div class="empty-state"><p>Gå till Faser och skapa din första fas.</p></div>';
        return;
    }

    if (!state.logPhase) state.logPhase = data.phases[data.phases.length - 1].id;
    phaseSelect.value = state.logPhase;

    const phase = data.phases.find(p => p.id === state.logPhase);
    if (!phase) return;

    // Populate weeks
    weekSelect.innerHTML = phase.weeks.map(w =>
        `<option value="${w}" ${state.logWeek == w ? 'selected' : ''}>Vecka ${w}</option>`
    ).join('');

    if (!state.logWeek || !phase.weeks.includes(Number(state.logWeek))) {
        state.logWeek = phase.weeks[phase.weeks.length - 1];
    }
    weekSelect.value = state.logWeek;

    // Populate days
    const dayNames = phase.days.map(d => d.name);
    daySelect.innerHTML = dayNames.map(d =>
        `<option value="${d}" ${state.logDay === d ? 'selected' : ''}>${d}</option>`
    ).join('');

    if (!state.logDay || !dayNames.includes(state.logDay)) {
        state.logDay = dayNames[0];
    }
    daySelect.value = state.logDay;

    // Gym selector
    const gymSelect = document.getElementById('log-gym');
    const gyms = data.gyms || [];

    // Check existing log for gym
    const existingLogForGym = data.logs.find(l =>
        l.phaseId === state.logPhase && l.week == state.logWeek && l.day === state.logDay
    );
    if (existingLogForGym?.gym && !state.logGym) {
        state.logGym = existingLogForGym.gym;
    }

    gymSelect.innerHTML = '';
    const emptyGymOption = document.createElement('option');
    emptyGymOption.value = '';
    emptyGymOption.textContent = 'Inget gym';
    gymSelect.appendChild(emptyGymOption);
    gyms.forEach((gym) => {
        const option = document.createElement('option');
        option.value = gym;
        option.textContent = gym;
        option.selected = state.logGym === gym;
        gymSelect.appendChild(option);
    });

    // Event listeners
    phaseSelect.onchange = () => { state.logPhase = phaseSelect.value; state.logWeek = null; state.logDay = null; state.logGym = ''; renderLogTab(); };
    weekSelect.onchange = () => { state.logWeek = Number(weekSelect.value); state.logGym = ''; renderLogTab(); };
    daySelect.onchange = () => { state.logDay = daySelect.value; state.logGym = ''; renderLogTab(); };
    gymSelect.onchange = () => { state.logGym = gymSelect.value; autoSaveLog(); };

    renderLogExercises();
}

function renderLogExercises() {
    const data = getData();
    const phase = data.phases.find(p => p.id === state.logPhase);
    if (!phase) return;

    const day = phase.days.find(d => d.name === state.logDay);
    if (!day) {
        document.getElementById('log-exercises').innerHTML = '<div class="empty-state"><p>Inga övningar för denna dag.</p></div>';
        return;
    }

    // Check for existing log
    const existingLog = data.logs.find(l =>
        l.phaseId === state.logPhase && l.week == state.logWeek && l.day === state.logDay
    );

    // Get previous log for this day (previous week)
    const prevLog = findPreviousLog(data, state.logPhase, state.logWeek, state.logDay);

    const container = document.getElementById('log-exercises');
    container.innerHTML = '';

    day.exercises.forEach((exercise, exIdx) => {
        const card = document.createElement('div');
        card.className = 'exercise-card';

        const existingEx = existingLog?.exercises.find(e => e.exerciseId === exercise.id || e.name === exercise.name);
        const prevEx = prevLog?.exercises.find(e => e.exerciseId === exercise.id || e.name === exercise.name);

        const cat = getExerciseCategory(exercise);
        let html = `
            <div class="exercise-card-header">
                <div>
                    <div class="exercise-name">${exercise.name} ${getCategoryBadge(cat)}</div>
                    <div class="exercise-scheme">${exercise.scheme}</div>
                    ${exercise.notes ? `<div class="exercise-notes">${exercise.notes}</div>` : ''}
                </div>
            </div>
            <div class="sets-container" data-exercise-idx="${exIdx}" data-exercise-id="${exercise.id}">
        `;

        const numSets = existingEx ? existingEx.sets.length : exercise.numSets;

        for (let s = 0; s < numSets; s++) {
            const existingSet = existingEx?.sets[s];
            const prevSet = prevEx?.sets[s];
            const weight = existingSet?.weight || '';
            const reps = existingSet?.reps || '';
            const notes = existingSet?.notes || '';

            let progressionHtml = '';
            if (prevSet && prevSet.weight && weight) {
                const prevW = parseWeight(prevSet.weight);
                const currW = parseWeight(weight);
                if (prevW !== null && currW !== null) {
                    if (currW > prevW) progressionHtml = `<span class="progression-up">▲</span>`;
                    else if (currW < prevW) progressionHtml = `<span class="progression-down">▼</span>`;
                    else progressionHtml = `<span class="progression-same">●</span>`;
                }
            }

            let prevHint = '';
            if (prevSet) {
                prevHint = `${prevSet.weight || '?'}kg × ${prevSet.reps || '?'}`;
            }

            html += `
                <div class="set-row">
                    <span class="set-label">S${s + 1}</span>
                    <input type="text" inputmode="decimal" class="weight-input" placeholder="${prevSet?.weight || 'kg'}" value="${weight}" data-set="${s}" data-field="weight">
                    <span style="color: var(--text-dim);">×</span>
                    <input type="text" inputmode="numeric" class="reps-input" placeholder="${prevSet?.reps || 'reps'}" value="${reps}" data-set="${s}" data-field="reps">
                    <input type="text" class="set-notes-input" placeholder="anteckning" value="${notes}" data-set="${s}" data-field="notes">
                    ${progressionHtml}
                </div>
            `;
        }

        html += `</div>`;
        html += `<button class="add-set-btn" data-exercise-idx="${exIdx}">+ Lägg till set</button>`;

        card.innerHTML = html;
        container.appendChild(card);

        // Auto-save on any input change (debounced)
        card.querySelectorAll('input').forEach(input => {
            input.addEventListener('blur', debouncedAutoSave);
            input.addEventListener('input', debouncedAutoSave);
        });

        // Auto-start timer when user fills in reps (leaving a reps field)
        card.querySelectorAll('.reps-input').forEach(input => {
            input.addEventListener('blur', () => {
                if (input.value.trim()) {
                    resetTimer();
                    startTimer();
                }
            });
        });

        // Add set button
        card.querySelector('.add-set-btn').addEventListener('click', () => {
            const setsContainer = card.querySelector('.sets-container');
            const setCount = setsContainer.querySelectorAll('.set-row').length;
            const setHtml = `
                <div class="set-row">
                    <span class="set-label">S${setCount + 1}</span>
                    <input type="text" inputmode="decimal" class="weight-input" placeholder="kg" value="" data-set="${setCount}" data-field="weight">
                    <span style="color: var(--text-dim);">×</span>
                    <input type="text" inputmode="numeric" class="reps-input" placeholder="reps" value="" data-set="${setCount}" data-field="reps">
                    <input type="text" class="set-notes-input" placeholder="anteckning" value="" data-set="${setCount}" data-field="notes">
                </div>
            `;
            setsContainer.insertAdjacentHTML('beforeend', setHtml);
            // Attach save listeners to new inputs
            const newRow = setsContainer.lastElementChild;
            newRow.querySelectorAll('input').forEach(inp => {
                inp.addEventListener('blur', debouncedAutoSave);
                inp.addEventListener('input', debouncedAutoSave);
            });
            newRow.querySelector('.reps-input').addEventListener('blur', () => {
                if (newRow.querySelector('.reps-input').value.trim()) {
                    resetTimer();
                    startTimer();
                }
            });
        });
    });
}

function parseWeight(w) {
    if (!w || w === 'BW' || w === 'bw') return null;
    const cleaned = String(w).replace(',', '.').replace(/[^0-9.+\-]/g, '');
    // Handle addition like "30,5 + 1.75"
    if (cleaned.includes('+')) {
        const parts = cleaned.split('+');
        return parts.reduce((sum, p) => sum + (parseFloat(p.trim()) || 0), 0);
    }
    return parseFloat(cleaned) || null;
}

function findPreviousLog(data, phaseId, currentWeek, dayName) {
    const phase = data.phases.find(p => p.id === phaseId);
    if (!phase) return null;

    const weekIdx = phase.weeks.indexOf(Number(currentWeek));
    if (weekIdx <= 0) {
        // Check previous phase for same day
        const phaseIdx = data.phases.findIndex(p => p.id === phaseId);
        if (phaseIdx > 0) {
            const prevPhase = data.phases[phaseIdx - 1];
            const prevWeek = prevPhase.weeks[prevPhase.weeks.length - 1];
            return data.logs.find(l => l.phaseId === prevPhase.id && l.week == prevWeek && l.day === dayName) || null;
        }
        return null;
    }

    const prevWeek = phase.weeks[weekIdx - 1];
    return data.logs.find(l => l.phaseId === phaseId && l.week == prevWeek && l.day === dayName) || null;
}

let _saveStatusTimer = null;

function autoSaveLog() {
    const data = getData();
    const phase = data.phases.find(p => p.id === state.logPhase);
    if (!phase) return;

    const day = phase.days.find(d => d.name === state.logDay);
    if (!day) return;

    const containers = document.querySelectorAll('#log-exercises .sets-container');
    const exercises = [];
    let hasAnyData = false;

    containers.forEach((container, idx) => {
        const exercise = day.exercises[idx];
        if (!exercise) return;

        const sets = [];
        container.querySelectorAll('.set-row').forEach(row => {
            const weight = row.querySelector('[data-field="weight"]')?.value || '';
            const reps = row.querySelector('[data-field="reps"]')?.value || '';
            const notes = row.querySelector('[data-field="notes"]')?.value || '';
            if (weight || reps || notes) hasAnyData = true;
            sets.push({ weight, reps, notes });
        });

        exercises.push({
            exerciseId: exercise.id,
            name: exercise.name,
            sets
        });
    });

    const existingIdx = data.logs.findIndex(l =>
        l.phaseId === state.logPhase && l.week == state.logWeek && l.day === state.logDay
    );

    if (!hasAnyData) {
        if (existingIdx >= 0) {
            data.logs.splice(existingIdx, 1);
            saveData(data);
        }
        return;
    }

    const logEntry = {
        id: existingIdx >= 0 ? data.logs[existingIdx].id : generateId(),
        phaseId: state.logPhase,
        week: Number(state.logWeek),
        day: state.logDay,
        date: new Date().toISOString().split('T')[0],
        gym: state.logGym || '',
        exercises
    };

    if (existingIdx >= 0) {
        data.logs[existingIdx] = logEntry;
    } else {
        data.logs.push(logEntry);
    }

    saveData(data);

    // Show save indicator (debounce the fade-out)
    const statusEl = document.getElementById('log-save-status');
    if (statusEl) {
        statusEl.textContent = 'Sparat';
        statusEl.style.opacity = '1';
        clearTimeout(_saveStatusTimer);
        _saveStatusTimer = setTimeout(() => { statusEl.style.opacity = '0'; }, 1500);
    }
}

const debouncedAutoSave = debounce(autoSaveLog, 300);

// ==================== PROGRAM TAB ====================

function renderProgramTab() {
    const data = getData();
    const phaseSelect = document.getElementById('prog-phase');
    const daySelect = document.getElementById('prog-day');

    phaseSelect.innerHTML = data.phases.map(p =>
        `<option value="${p.id}" ${state.progPhase === p.id ? 'selected' : ''}>${p.name}</option>`
    ).join('');

    if (data.phases.length === 0) {
        phaseSelect.innerHTML = '<option>Skapa en fas först</option>';
        document.getElementById('program-exercises').innerHTML = '';
        return;
    }

    if (!state.progPhase) state.progPhase = data.phases[0].id;
    phaseSelect.value = state.progPhase;

    const phase = data.phases.find(p => p.id === state.progPhase);
    if (!phase) return;

    const dayNames = phase.days.map(d => d.name);
    daySelect.innerHTML = dayNames.map(d =>
        `<option value="${d}" ${state.progDay === d ? 'selected' : ''}>${d}</option>`
    ).join('');

    if (!state.progDay || !dayNames.includes(state.progDay)) {
        state.progDay = dayNames[0];
    }
    daySelect.value = state.progDay;

    phaseSelect.onchange = () => { state.progPhase = phaseSelect.value; state.progDay = null; renderProgramTab(); };
    daySelect.onchange = () => { state.progDay = daySelect.value; renderProgramExercises(); };

    document.getElementById('btn-add-exercise').onclick = () => showExerciseModal(null);

    renderProgramExercises();
}

function renderProgramExercises() {
    const data = getData();
    const phase = data.phases.find(p => p.id === state.progPhase);
    if (!phase) return;

    const day = phase.days.find(d => d.name === state.progDay);
    if (!day) {
        document.getElementById('program-exercises').innerHTML = '<div class="empty-state"><p>Inga övningar.</p></div>';
        return;
    }

    const container = document.getElementById('program-exercises');
    container.innerHTML = '';

    day.exercises.forEach((ex, idx) => {
        const card = document.createElement('div');
        card.className = 'prog-exercise-card';
        const exCat = getExerciseCategory(ex);
        card.innerHTML = `
            <div class="prog-exercise-header">
                <div class="prog-exercise-info">
                    <h3>${escapeHtml(ex.name)} ${getCategoryBadge(exCat)}</h3>
                    <div class="scheme-text">${escapeHtml(ex.scheme)}</div>
                    ${ex.notes ? `<div class="notes-text">${escapeHtml(ex.notes)}</div>` : ''}
                    <div class="scheme-text">${ex.numSets} sets${ex.restPauseParts ? ' (Rest Pause)' : ''}</div>
                </div>
                <div class="prog-exercise-actions">
                    <button class="btn-small btn-edit-ex" data-idx="${idx}">Redigera</button>
                    <button class="btn-danger btn-del-ex" data-idx="${idx}">Ta bort</button>
                </div>
            </div>
        `;
        container.appendChild(card);

        // Move up/down with drag would be complex, use edit/delete for now
        card.querySelector('.btn-edit-ex').addEventListener('click', () => showExerciseModal(idx));
        card.querySelector('.btn-del-ex').addEventListener('click', () => {
            if (confirm(`Ta bort "${ex.name}"?`)) {
                day.exercises.splice(idx, 1);
                saveData(data);
                renderProgramExercises();
            }
        });
    });

    if (day.exercises.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Inga övningar ännu. Klicka "+ Övning" för att lägga till.</p></div>';
    }
}

function showExerciseModal(editIdx) {
    const data = getData();
    const phase = data.phases.find(p => p.id === state.progPhase);
    const day = phase.days.find(d => d.name === state.progDay);
    const exercise = editIdx !== null ? day.exercises[editIdx] : null;

    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');

    const currentCat = exercise ? getExerciseCategory(exercise) : '';

    content.innerHTML = `
        <h2>${exercise ? 'Redigera Övning' : 'Ny Övning'}</h2>
        <label>Namn</label>
        <input type="text" id="ex-name" value="${escapeHtml(exercise?.name || '')}" placeholder="t.ex. Bench Press">
        <label>Kategori</label>
        <div class="category-picker" id="cat-picker">
            ${Object.entries(CATEGORIES).map(([key, c]) =>
                `<button class="cat-pick-btn ${currentCat === key ? 'selected' : ''}" data-cat="${key}" style="--cat-color:${c.color}">${c.label}</button>`
            ).join('')}
        </div>
        <label>Upplägg (scheme)</label>
        <input type="text" id="ex-scheme" value="${escapeHtml(exercise?.scheme || '')}" placeholder="t.ex. 3 sets RPT (6-8, 6-8, 8-10)">
        <label>Antal sets</label>
        <input type="number" id="ex-sets" value="${exercise?.numSets || 3}" min="1" max="20">
        <label>Anteckningar</label>
        <input type="text" id="ex-notes" value="${escapeHtml(exercise?.notes || '')}" placeholder="Valfritt">
        <div class="modal-buttons">
            <button class="btn-secondary" id="modal-cancel">Avbryt</button>
            <button class="btn-primary" id="modal-save">Spara</button>
        </div>
    `;

    // Category picker logic
    let selectedCat = currentCat;
    const catPicker = content.querySelector('#cat-picker');
    catPicker.querySelectorAll('.cat-pick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            catPicker.querySelectorAll('.cat-pick-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedCat = btn.dataset.cat;
        });
    });

    // Auto-detect category when name changes (only if no manual selection yet)
    const nameInput = content.querySelector('#ex-name');
    if (!exercise) {
        nameInput.addEventListener('input', () => {
            if (!selectedCat || selectedCat === guessCategory('')) {
                const guessed = guessCategory(nameInput.value);
                catPicker.querySelectorAll('.cat-pick-btn').forEach(b => b.classList.remove('selected'));
                catPicker.querySelector(`[data-cat="${guessed}"]`)?.classList.add('selected');
                selectedCat = guessed;
            }
        });
    }

    overlay.classList.remove('hidden');

    document.getElementById('modal-cancel').onclick = () => overlay.classList.add('hidden');
    document.getElementById('modal-save').onclick = () => {
        const name = document.getElementById('ex-name').value.trim();
        const scheme = document.getElementById('ex-scheme').value.trim();
        const numSets = parseInt(document.getElementById('ex-sets').value) || 3;
        const notes = document.getElementById('ex-notes').value.trim();

        if (!name) { alert('Ange ett namn'); return; }

        const category = selectedCat || guessCategory(name);

        if (editIdx !== null) {
            day.exercises[editIdx].name = name;
            day.exercises[editIdx].scheme = scheme;
            day.exercises[editIdx].numSets = numSets;
            day.exercises[editIdx].notes = notes;
            day.exercises[editIdx].category = category;
        } else {
            day.exercises.push({
                id: generateId(),
                name,
                scheme,
                notes,
                numSets,
                category
            });
        }

        saveData(data);
        overlay.classList.add('hidden');
        renderProgramExercises();
    };
}

// ==================== HISTORY TAB ====================

function getAllExerciseNames(data) {
    const nameMap = new Map();

    data.logs.forEach(log => {
        const phase = data.phases.find(p => p.id === log.phaseId);
        const phaseName = phase?.name || '?';
        log.exercises.forEach(ex => {
            const key = ex.name.toLowerCase();
            if (!nameMap.has(key)) {
                nameMap.set(key, { name: ex.name, category: null, logCount: 0, phases: new Set(), lastWeight: null, lastDate: null });
            }
            const entry = nameMap.get(key);
            entry.logCount++;
            entry.phases.add(phaseName);
            if (!entry.lastDate || log.date > entry.lastDate) {
                entry.lastDate = log.date;
                const topSet = ex.sets.find(s => s.weight && s.reps);
                if (topSet) entry.lastWeight = `${topSet.weight}kg × ${topSet.reps}`;
            }
        });
    });

    // Also add from program (with category)
    data.phases.forEach(phase => {
        phase.days.forEach(day => {
            day.exercises.forEach(ex => {
                const key = ex.name.toLowerCase();
                if (!nameMap.has(key)) {
                    nameMap.set(key, { name: ex.name, category: getExerciseCategory(ex), logCount: 0, phases: new Set([phase.name]), lastWeight: null, lastDate: null });
                } else {
                    const entry = nameMap.get(key);
                    entry.phases.add(phase.name);
                    if (!entry.category) entry.category = getExerciseCategory(ex);
                }
            });
        });
    });

    // Auto-detect category for any that don't have one
    for (const entry of nameMap.values()) {
        if (!entry.category) entry.category = guessCategory(entry.name);
    }

    return Array.from(nameMap.values()).sort((a, b) => b.logCount - a.logCount);
}

function renderHistoryTab() {
    const data = getData();
    const searchInput = document.getElementById('hist-search');
    const listEl = document.getElementById('hist-exercise-list');
    const contentEl = document.getElementById('history-content');

    const allExercises = getAllExerciseNames(data);

    if (allExercises.length === 0) {
        listEl.innerHTML = '';
        contentEl.innerHTML = '<div class="empty-state"><p>Ingen historik ännu.</p></div>';
        return;
    }

    // Build grouped dropdown
    function buildDropdown(filter) {
        const filtered = filter
            ? allExercises.filter(e => e.name.toLowerCase().includes(filter.toLowerCase()))
            : allExercises;

        // Group by category
        const groups = {};
        for (const cat of Object.keys(CATEGORIES)) {
            groups[cat] = [];
        }
        filtered.forEach(ex => {
            const cat = ex.category || 'other';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(ex);
        });

        let html = `<select id="hist-exercise-select" class="hist-dropdown">
            <option value="">Välj övning...</option>`;

        for (const [cat, exercises] of Object.entries(groups)) {
            if (exercises.length === 0) continue;
            const c = CATEGORIES[cat];
            html += `<optgroup label="${c.label}">`;
            exercises.forEach(ex => {
                const meta = ex.lastWeight ? ` (${ex.lastWeight})` : '';
                const selected = state.histExercise === ex.name ? 'selected' : '';
                html += `<option value="${ex.name}" ${selected}>${ex.name}${meta}</option>`;
            });
            html += `</optgroup>`;
        }

        html += `</select>`;
        listEl.innerHTML = html;

        document.getElementById('hist-exercise-select').onchange = (e) => {
            state.histExercise = e.target.value;
            if (state.histExercise) {
                renderExerciseProgression(contentEl, data, state.histExercise);
            } else {
                contentEl.innerHTML = '<div class="empty-state"><p>Välj en övning för att se progression.</p></div>';
            }
        };
    }

    searchInput.oninput = () => buildDropdown(searchInput.value);
    buildDropdown(searchInput.value);

    if (state.histExercise) {
        renderExerciseProgression(contentEl, data, state.histExercise);
    } else {
        contentEl.innerHTML = '<div class="empty-state"><p>Välj en övning för att se progression.</p></div>';
    }
}

function renderHistoryContent() {
    renderHistoryTab();
}

function renderExerciseProgression(container, data, exerciseName) {
    // Collect entries for this exercise across ALL phases and logs
    const entries = [];
    const nameLower = exerciseName.toLowerCase();

    // Sort logs by date
    const sortedLogs = [...data.logs].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.week - b.week;
    });

    sortedLogs.forEach(log => {
        const ex = log.exercises.find(e => e.name.toLowerCase() === nameLower);
        if (ex) {
            const phase = data.phases.find(p => p.id === log.phaseId);
            entries.push({
                week: log.week,
                day: log.day,
                date: log.date,
                phaseName: phase?.name || '?',
                gym: log.gym || '',
                sets: ex.sets,
                name: ex.name
            });
        }
    });

    if (entries.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Ingen loggad historik för denna övning ännu.</p></div>';
        return;
    }

    let html = '';

    // Top set progression summary
    html += `<div style="margin-bottom: 16px;">`;
    html += `<h3 style="color: var(--accent); margin-bottom: 8px; font-size: 1rem;">${entries[0].name}</h3>`;
    html += `<h4 style="color: var(--text-dim); margin-bottom: 8px; font-size: 0.85rem;">Top Set Progression</h4>`;

    entries.forEach((entry, i) => {
        const topSet = entry.sets[0];
        if (!topSet) return;
        const prevEntry = i > 0 ? entries[i - 1] : null;
        const prevTop = prevEntry?.sets[0];

        let arrow = '';
        if (prevTop) {
            const pw = parseWeight(prevTop.weight);
            const cw = parseWeight(topSet.weight);
            if (pw !== null && cw !== null) {
                const diff = cw - pw;
                if (diff > 0) arrow = `<span class="progression-up">+${diff.toFixed(1)}kg</span>`;
                else if (diff < 0) arrow = `<span class="progression-down">${diff.toFixed(1)}kg</span>`;
                else {
                    const prevR = parseInt(prevTop.reps) || 0;
                    const currR = parseInt(topSet.reps) || 0;
                    if (currR > prevR) arrow = `<span class="progression-up">+${currR - prevR} reps</span>`;
                    else if (currR < prevR) arrow = `<span class="progression-down">${currR - prevR} reps</span>`;
                    else arrow = `<span class="progression-same">±0</span>`;
                }
            }
        }

        const gymBadge = entry.gym ? `<span class="gym-badge">${entry.gym}</span>` : '';
        html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid var(--surface2); font-size:0.88rem;">
            <div>
                <span style="color:var(--text-dim); font-size:0.78rem;">V${entry.week}</span>
                <span style="margin-left:4px;">${topSet.weight || '?'}kg × ${topSet.reps || '?'}</span>
                ${topSet.notes ? `<span style="color:var(--text-dim); font-size:0.78rem; margin-left:4px;">${topSet.notes}</span>` : ''}
                ${gymBadge}
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                ${arrow}
                <span style="color:var(--text-dim); font-size:0.72rem;">${entry.phaseName}</span>
            </div>
        </div>`;
    });
    html += `</div>`;

    // Detailed table
    html += `<div class="history-summary">`;
    html += `<h4 style="color: var(--text-dim); margin-bottom: 8px; font-size: 0.85rem;">Alla Sets</h4>`;
    html += `<table><thead><tr><th>Vecka</th><th>Fas</th><th>Gym</th><th>Set</th><th>Vikt</th><th>Reps</th><th>Trend</th></tr></thead><tbody>`;

    entries.forEach((entry, entryIdx) => {
        const prevEntry = entryIdx > 0 ? entries[entryIdx - 1] : null;

        entry.sets.forEach((set, si) => {
            const prevSet = prevEntry?.sets[si];
            let trend = '';

            if (prevSet) {
                const prevW = parseWeight(prevSet.weight);
                const currW = parseWeight(set.weight);
                const prevR = parseInt(prevSet.reps) || 0;
                const currR = parseInt(set.reps) || 0;

                if (currW !== null && prevW !== null) {
                    if (currW > prevW) trend = '<span class="progression-up">▲</span>';
                    else if (currW < prevW) trend = '<span class="progression-down">▼</span>';
                    else if (currR > prevR) trend = '<span class="progression-up">▲R</span>';
                    else if (currR < prevR) trend = '<span class="progression-down">▼R</span>';
                    else trend = '<span class="progression-same">●</span>';
                }
            }

            html += `<tr>
                ${si === 0 ? `<td rowspan="${entry.sets.length}" style="font-weight:600;">V${entry.week}</td>` : ''}
                ${si === 0 ? `<td rowspan="${entry.sets.length}" style="font-size:0.75rem; color:var(--text-dim);">${entry.phaseName}</td>` : ''}
                ${si === 0 ? `<td rowspan="${entry.sets.length}" style="font-size:0.75rem; color:var(--text-dim);">${entry.gym || '-'}</td>` : ''}
                <td>S${si + 1}</td>
                <td>${set.weight || '-'}</td>
                <td>${set.reps || '-'}</td>
                <td>${trend}</td>
            </tr>`;
        });
    });

    html += `</tbody></table></div>`;

    container.innerHTML = html;
}

// ==================== PHASES TAB ====================

function renderPhasesTab() {
    const data = getData();
    const container = document.getElementById('phases-list');

    document.getElementById('btn-add-phase').onclick = () => showPhaseModal(null);

    if (data.phases.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Inga faser ännu.</p></div>';
        return;
    }

    container.innerHTML = '';

    // Gym manager at the top
    const gymSection = document.createElement('div');
    gymSection.style.cssText = 'grid-column: 1 / -1; margin-bottom: 8px;';
    renderGymManager(gymSection);
    container.appendChild(gymSection);

    data.phases.forEach((phase, idx) => {
        const card = document.createElement('div');
        card.className = 'phase-card';

        const weekCount = phase.weeks.length;
        let warningHtml = '';
        if (weekCount >= 8) {
            warningHtml = `<span style="color: var(--orange); font-size: 0.8rem; font-weight: 600;"> ⚠ ${weekCount} veckor - byt fas!</span>`;
        }

        const firstW = phase.weeks[0];
        const lastW = phase.weeks[phase.weeks.length - 1];
        const currentWeek = getCurrentWeekNumber();
        const isCurrent = phase.weeks.includes(currentWeek);

        card.innerHTML = `
            <div class="phase-card-header">
                <span class="phase-card-name">${escapeHtml(phase.name)}${isCurrent ? ' <span style="font-size:0.75rem; color:var(--green);">(aktiv)</span>' : ''}${warningHtml}</span>
                <div>
                    <button class="btn-small btn-edit-phase" data-idx="${idx}">Redigera</button>
                    <button class="btn-danger btn-del-phase" data-idx="${idx}">Ta bort</button>
                </div>
            </div>
            <div class="phase-weeks">Vecka ${firstW} → ${lastW} (${weekCount} veckor)</div>
            <div class="phase-days">
                ${phase.days.map(d => `<span class="phase-day-tag">${d.name} (${d.exercises.length} övningar)</span>`).join('')}
            </div>
        `;

        container.appendChild(card);

        card.querySelector('.btn-edit-phase').addEventListener('click', () => showPhaseModal(idx));
        card.querySelector('.btn-del-phase').addEventListener('click', () => {
            if (confirm(`Ta bort "${phase.name}" och all tillhörande data?`)) {
                data.logs = data.logs.filter(l => l.phaseId !== phase.id);
                data.phases.splice(idx, 1);
                saveData(data);
                renderPhasesTab();
                renderPhaseIndicator();
            }
        });
    });
}

function getNextPhaseStart(data) {
    if (data.phases.length === 0) return getCurrentWeekNumber();
    const lastPhase = data.phases[data.phases.length - 1];
    const lastWeek = lastPhase.weeks[lastPhase.weeks.length - 1];
    return lastWeek + 1;
}

function showPhaseModal(editIdx) {
    const data = getData();
    const phase = editIdx !== null ? data.phases[editIdx] : null;

    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');

    const isEdit = editIdx !== null;
    const startWeek = isEdit ? phase.weeks[0] : getNextPhaseStart(data);
    const currentDuration = isEdit ? phase.weeks.length : 0;

    content.innerHTML = `
        <h2>${isEdit ? 'Redigera Fas' : 'Ny Fas'}</h2>
        <label>Namn</label>
        <input type="text" id="phase-name" value="${escapeHtml(phase?.name || '')}" placeholder="t.ex. Phase Four">

        ${isEdit ? '' : `
        <label>Längd</label>
        <div class="phase-duration-picker">
            <button class="phase-duration-btn" data-weeks="4">4<small>veckor</small></button>
            <button class="phase-duration-btn" data-weeks="6">6<small>veckor</small></button>
            <button class="phase-duration-btn selected" data-weeks="8">8<small>veckor</small></button>
        </div>
        <div class="phase-start-info" id="phase-start-info">
            Startar <strong>vecka ${startWeek}</strong> → slutar <strong>vecka ${startWeek + 7}</strong>
        </div>
        `}

        ${isEdit ? `
        <label>Veckor (kommaseparerade)</label>
        <input type="text" id="phase-weeks-manual" value="${escapeHtml(phase.weeks.join(', '))}">
        ` : ''}

        <label>Dagar (kommaseparerade)</label>
        <input type="text" id="phase-days" value="${escapeHtml(phase?.days.map(d => d.name).join(', ') || 'Måndag, Onsdag, Fredag')}" placeholder="t.ex. Måndag, Onsdag, Fredag">

        <div class="modal-buttons">
            <button class="btn-secondary" id="modal-cancel">Avbryt</button>
            <button class="btn-primary" id="modal-save">${isEdit ? 'Spara' : 'Starta Fas'}</button>
        </div>
    `;

    overlay.classList.remove('hidden');

    // Duration picker logic (only for new phases)
    let selectedDuration = 8;
    if (!isEdit) {
        const durationBtns = content.querySelectorAll('.phase-duration-btn');
        const infoEl = content.querySelector('#phase-start-info');

        durationBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                durationBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                selectedDuration = parseInt(btn.dataset.weeks);
                const endWeek = startWeek + selectedDuration - 1;
                infoEl.innerHTML = `Startar <strong>vecka ${startWeek}</strong> → slutar <strong>vecka ${endWeek}</strong>`;
            });
        });
    }

    document.getElementById('modal-cancel').onclick = () => overlay.classList.add('hidden');
    document.getElementById('modal-save').onclick = () => {
        const name = document.getElementById('phase-name').value.trim();
        const daysStr = document.getElementById('phase-days').value.trim();

        if (!name) { alert('Ange ett namn'); return; }

        const dayNames = daysStr.split(',').map(d => d.trim()).filter(d => d);
        if (dayNames.length === 0) { alert('Ange minst en dag'); return; }

        let weeks;
        if (isEdit) {
            const weeksStr = document.getElementById('phase-weeks-manual').value.trim();
            weeks = weeksStr.split(',').map(w => parseInt(w.trim())).filter(w => !isNaN(w));
            if (weeks.length === 0) { alert('Ange giltiga veckor'); return; }
        } else {
            weeks = [];
            for (let i = 0; i < selectedDuration; i++) {
                weeks.push(startWeek + i);
            }
        }

        if (isEdit) {
            data.phases[editIdx].name = name;
            data.phases[editIdx].weeks = weeks;

            const existingDays = data.phases[editIdx].days;
            const newDays = dayNames.map(dn => {
                const existing = existingDays.find(d => d.name === dn);
                return existing || { name: dn, exercises: [] };
            });
            data.phases[editIdx].days = newDays;
        } else {
            data.phases.push({
                id: generateId(),
                name,
                weeks,
                days: dayNames.map(dn => ({ name: dn, exercises: [] }))
            });
        }

        saveData(data);
        overlay.classList.add('hidden');
        renderPhasesTab();
        renderPhaseIndicator();
        renderWeekBanner();
    };
}

// ==================== TOAST ====================

function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--green);
        color: #fff;
        padding: 10px 24px;
        border-radius: 8px;
        font-weight: 600;
        font-size: 0.9rem;
        z-index: 2000;
        animation: fadeInOut 2s ease-in-out;
    `;

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);

    // Add animation
    if (!document.getElementById('toast-style')) {
        const style = document.createElement('style');
        style.id = 'toast-style';
        style.textContent = `
            @keyframes fadeInOut {
                0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
                15% { opacity: 1; transform: translateX(-50%) translateY(0); }
                85% { opacity: 1; transform: translateX(-50%) translateY(0); }
                100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
            }
        `;
        document.head.appendChild(style);
    }
}

// ==================== CLOSE MODAL ON OVERLAY CLICK ====================

document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        e.currentTarget.classList.add('hidden');
    }
});
