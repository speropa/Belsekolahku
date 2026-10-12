import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
        import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
        import { getDatabase, ref, set, onValue, get } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";

        const firebaseConfig = {
            apiKey: "AIzaSyCnR2U7iBj1R7CFbAJzVYxzASxXcAztqp8",
            authDomain: "bel-sekolah-5ab64.firebaseapp.com",
            databaseURL: "https://bel-sekolah-5ab64-default-rtdb.firebaseio.com",
            projectId: "bel-sekolah-5ab64",
            storageBucket: "bel-sekolah-5ab64.appspot.com",
            messagingSenderId: "100622592851",
            appId: "1:100622592851:web:0b23f7d00ae0a44bf94fa6"
        };

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getDatabase(app);

        // --- GLOBAL VARIABLES ---
        const ownWrites = new Set(); // cap waktu perubahan yang kita tulis sendiri (mengenali gema Firebase)
        let lastServerData = null, _restoring = false; // data server terakhir (untuk memulihkan tampilan bila simpan ditolak)
        let currentFirebaseTS = 0; // MENYIMPAN TIMESTAMP TERAKHIR FIREBASE (UNTUK ANTI MENTAL/BOUNCE)
        let masterBel = [], jadwalKhusus = [], masterJadwal = {};
        let jadwalMendatang = [];
        let savedTemplate = 'HARI NORMAL';
        let temporaryOverride = { date: null, name: null };
        let secondSchedule = { active: false, template: 'HARI NORMAL', day: 'Senin', isKhusus: false, date: null };
        let manualDayOverride = null;
        let availableSounds = [];
        let nextBellTimeout = null;
        let isDataLoaded = false;
        let lastCheckedDate = null;
        let lastRenderedMinute = null;
        
        // --- VARIABLES UNTUK REKAMAN PENGUMUMAN ---
        let mediaRecorder;
        let audioChunks = [];
        let audioBlob = null;
        let announcementAudioUrl = null;
        let recordInterval = null;
        let recordSeconds = 0;
        let audioContext = null; // Tambahan untuk memanipulasi stream audio
        let micStream = null;    // Menyimpan sumber mic

        const templates = ['HARI NORMAL', 'BULAN PUASA', 'UJIAN', 'KOKULIKULER', 'LAINNYA'];
        const jadwalUtama = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const MODALS = { 
            settings: 'settingsModal', 
            editHari: 'editHariModal', 
            deleteHari: 'deleteHariModal', 
            formMendatang: 'formMendatangModal', 
            deleteMendatang: 'deleteMendatangModal', 
            editBel: 'editBelModal', 
            confirmPlay: 'confirmPlayModal',
            pengumuman: 'pengumumanModal',
            confirmBroadcast: 'confirmBroadcastModal', picker: 'pickerModal' // <-- Tambahkan ini
        };

        function ensureArray(dataItem) {
            if (!dataItem) return [];
            if (Array.isArray(dataItem)) return dataItem.filter(i => i !== null && i !== undefined);
            return Object.values(dataItem).filter(i => i !== null && i !== undefined);
        }

        // AMBIL TANGGAL LOKAL YANG BENAR MENGHINDARI BUG UTC TIMEZONE
        function getTodayDateString() { 
            const d = new Date();
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        // --- INIT ---
        document.addEventListener('DOMContentLoaded', () => {
            const hardcodedEmail = "speropa@gmail.com";
            const hardcodedPassword = "Pajangan201184*";
            const PIN_CACHE_KEY = 'belPinHash';
            const pinInput = document.getElementById('pin');
            const statusText = document.getElementById('login-status');

            // Layar PIN tampil seketika; koneksi ke server berjalan di latar belakang.
            document.getElementById('loading-spinner').classList.add('hidden');
            document.getElementById('login-page').classList.remove('hidden');
            setTimeout(() => { pinInput.focus(); }, 50);

            // Login Firebase: pakai sesi tersimpan bila ada (tanpa jaringan), kalau tidak baru login.
            let authPromise = null;
            function ensureAuth() {
                if (!authPromise) {
                    authPromise = (async () => {
                        try { if (auth.authStateReady) await auth.authStateReady(); } catch (e) {}
                        if (!auth.currentUser) await signInWithEmailAndPassword(auth, hardcodedEmail, hardcodedPassword);
                        return true;
                    })().catch(err => { authPromise = null; throw err; });
                }
                return authPromise;
            }
            // PIN dari server diambil lebih awal (sambil pengguna mengetik), bukan setelah 6 digit selesai.
            let pinFetch = null;
            function fetchServerPin() {
                if (!pinFetch) {
                    pinFetch = ensureAuth().then(() => get(ref(db, 'login/pin'))).then(s => s.exists() ? String(s.val()) : null)
                        .catch(err => { pinFetch = null; throw err; });
                }
                return pinFetch;
            }
            // PIN yang pernah benar disimpan sebagai hash di perangkat ini -> pemeriksaan berikutnya instan.
            async function hashPin(p) {
                try {
                    if (window.crypto && crypto.subtle) {
                        const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('belsperopa:' + p));
                        return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
                    }
                } catch (e) {}
                return null;
            }
            function getCachedHash() { try { return localStorage.getItem(PIN_CACHE_KEY); } catch (e) { return null; } }
            function setCachedHash(h) { try { if (h) localStorage.setItem(PIN_CACHE_KEY, h); } catch (e) {} }
            function clearCachedHash() { try { localStorage.removeItem(PIN_CACHE_KEY); } catch (e) {} }

            ensureAuth().then(fetchServerPin).catch(err => console.error('Auth/PIN awal gagal:', err));

            function enterApp(hash, verifyInBackground) {
                statusText.textContent = 'Berhasil!';
                statusText.classList.replace('text-orange-500', 'text-green-500');
                document.getElementById('login-page').classList.add('hidden');
                document.getElementById('main-app').classList.remove('hidden');
                ensureAuth().then(() => startApp()).catch(err => { console.error(err); showToast('Gagal terhubung ke server. Muat ulang halaman.', 'error'); });
                // Bila PIN di server ternyata sudah diganti, cache dibuang dan layar PIN muncul lagi.
                if (verifyInBackground) fetchServerPin().then(async sp => {
                    if (sp === null) return;
                    const h = await hashPin(sp);
                    if (h && h !== hash) { clearCachedHash(); location.reload(); }
                }).catch(() => {});
            }

            document.getElementById('login-page').addEventListener('click', () => {
                if (!pinInput.disabled) { pinInput.focus(); }
            });

            pinInput.addEventListener('input', async () => {
                pinInput.value = pinInput.value.replace(/[^0-9]/g, '');
                pinInput.classList.remove('error-shake');
                statusText.textContent = "Menunggu input...";
                statusText.className = "text-slate-500 text-sm mt-4 text-center font-medium h-5 transition-all";
                if (pinInput.value.length !== 6) return;

                const entered = pinInput.value;
                pinInput.disabled = true;
                statusText.textContent = "Memeriksa...";
                statusText.classList.replace('text-slate-500', 'text-orange-500');
                try {
                    const h = await hashPin(entered), cached = getCachedHash();
                    if (h && cached && h === cached) { enterApp(h, true); return; } // cocok dengan cache: langsung masuk
                    // Pertama kali di perangkat ini: harus menunggu server. Beri tahu bila lambat, dan jangan menggantung selamanya.
                    const slow = setTimeout(() => { statusText.textContent = 'Koneksi lambat, menunggu server...'; }, 3000);
                    let sp;
                    try {
                        sp = await Promise.race([fetchServerPin(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
                    } finally { clearTimeout(slow); }
                    if (sp !== null && sp === entered) { setCachedHash(h); enterApp(h, false); }
                    else triggerPinError();
                } catch (err) {
                    console.error(err);
                    pinFetch = null; authPromise = null; ensureAuth().then(fetchServerPin).catch(() => {}); // siapkan ulang untuk percobaan berikutnya
                    triggerPinError("Koneksi gagal.");
                }
            });
            function triggerPinError(msg = "PIN salah!") {
                statusText.textContent = msg;
                statusText.classList.replace('text-orange-500', 'text-red-500');
                pinInput.classList.add('error-shake');
                setTimeout(() => {
                    pinInput.value = '';
                    pinInput.disabled = false;
                    pinInput.focus();
                    pinInput.classList.remove('error-shake');
                    statusText.textContent = "Coba lagi...";
                    statusText.classList.replace('text-red-500', 'text-slate-500');
                }, 600);
            }
            
                    });

        function startApp() {
            document.getElementById('bottom-nav').classList.remove('hidden'); initMobileNav(); initPWA();
            listenToConfig();
            listenToDesktopStatus();
            listenAvailableSounds();
            setInterval(updateTime, 1000);
            setupEventListeners();
            initVolumePanel();
        }

        let desktopStatus = null, serverOffsetMs = 0, firebaseConnected = true, serverOnline = null;
        function listenToDesktopStatus() {
            onValue(ref(db, '.info/serverTimeOffset'), s => { serverOffsetMs = s.val() || 0; renderServerStatus(); });
            onValue(ref(db, '.info/connected'), s => { firebaseConnected = s.val() === true; if (!firebaseConnected) setSyncStatus('offline'); updateSettingsOffline(); renderServerStatus(); });
            onValue(ref(db, 'desktopStatus'), snap => { desktopStatus = snap.exists() ? snap.val() : null; renderServerStatus(); });
            onValue(ref(db, 'desktopVolume'), snap => { desktopVolume = snap.exists() ? snap.val() : null; renderVolumePanel(); });
            setInterval(renderServerStatus, 10000);
            window.addEventListener('online', renderServerStatus);
            window.addEventListener('offline', renderServerStatus);
        }
        // Saat HP offline, Pengaturan dikunci supaya tidak ada perubahan yang tampak tersimpan padahal tidak.
        function updateSettingsOffline() {
            const m = document.getElementById('settingsModal'); if (!m) return;
            m.classList.toggle('settings-offline', !firebaseConnected);
            let b = document.getElementById('settingsOfflineBanner');
            if (!firebaseConnected && !b) {
                const main = m.querySelector('main'); if (!main) return;
                b = document.createElement('div'); b.id = 'settingsOfflineBanner'; b.className = 'settings-offline-banner';
                b.textContent = 'HP tidak terhubung internet. Pengaturan tidak bisa diubah sampai tersambung lagi.';
                main.insertBefore(b, main.firstChild);
            } else if (firebaseConnected && b) { b.remove(); }
        }

        // ---------- Volume komputer sekolah (pantau & atur dari web) ----------
        // Desktop menulis ke 'desktopVolume' {level, muted, updatedAt}; web mengirim perintah ke 'volumeCommand'.
        let desktopVolume = null, volumeDragging = false, volumePending = null;
        function volumeFresh() { return desktopVolume && (Date.now() + serverOffsetMs - (desktopVolume.updatedAt || 0)) < 60000; }
        function renderVolumePanel() {
            const slider = document.getElementById('volumeSlider'); if (!slider) return;
            const val = document.getElementById('volumeValue'), badge = document.getElementById('volumeBadge');
            const bMax = document.getElementById('btnVolMax'), bMute = document.getElementById('btnVolMute'), hint = document.getElementById('volumeHint');
            const usable = serverOnline !== false && firebaseConnected && volumeFresh();
            const lv = usable ? desktopVolume.level : null, muted = usable ? !!desktopVolume.muted : false;
            if (volumePending && (Date.now() > volumePending.until || (lv !== null && (volumePending.level == null || lv === volumePending.level) && (volumePending.muted == null || muted === volumePending.muted)))) volumePending = null;
            slider.disabled = !usable; bMax.disabled = !usable; bMute.disabled = !usable;
            if (!volumeDragging) slider.value = lv === null ? 0 : lv;
            val.textContent = lv === null ? '--' : (volumeDragging ? slider.value : lv) + '%';
            let cls = 'bg-slate-200 text-slate-600', txt = 'Tidak ada data';
            if (usable) {
                if (muted) { cls = 'bg-red-100 text-red-700'; txt = 'MUTE'; }
                else if (lv < 100) { cls = 'bg-amber-100 text-amber-800'; txt = 'Belum 100%'; }
                else { cls = 'bg-green-100 text-green-700'; txt = 'Normal 100%'; }
            }
            badge.className = 'text-[10px] px-2 py-0.5 rounded font-bold whitespace-nowrap ' + cls; badge.textContent = txt;
            bMute.textContent = muted ? 'Unmute' : 'Mute';
            bMax.classList.toggle('hidden', usable && lv === 100 && !muted);
            hint.textContent = !firebaseConnected ? 'HP tidak terhubung internet.' : (serverOnline === false ? 'Server sekolah offline, volume tidak bisa dipantau/diubah.' : (!volumeFresh() ? 'Belum ada data volume dari server (pastikan aplikasi desktop versi terbaru berjalan).' : (volumePending ? 'Mengirim perintah ke komputer sekolah…' : 'Perubahan dikirim ke komputer sekolah dan langsung diterapkan.')));
        }
        async function sendVolumeCommand(level, muted) {
            if (!auth.currentUser) { showToast('Belum login ke server.', 'error'); return; }
            const cmd = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), by: 'web', at: Date.now() };
            if (typeof level === 'number') cmd.level = Math.max(0, Math.min(100, Math.round(level)));
            if (typeof muted === 'boolean') cmd.muted = muted;
            volumePending = { level: cmd.level == null ? null : cmd.level, muted: cmd.muted == null ? null : cmd.muted, until: Date.now() + 12000 };
            renderVolumePanel();
            try { await set(ref(db, 'volumeCommand'), cmd); }
            catch (err) { console.error(err); volumePending = null; renderVolumePanel(); showToast(err && err.code === 'PERMISSION_DENIED' ? 'Ditolak Firebase: tambahkan aturan untuk volumeCommand & desktopVolume.' : 'Gagal mengirim perintah volume.', 'error'); }
        }
        function initVolumePanel() {
            const slider = document.getElementById('volumeSlider'); if (!slider) return;
            slider.addEventListener('input', () => { volumeDragging = true; document.getElementById('volumeValue').textContent = slider.value + '%'; });
            slider.addEventListener('change', () => { volumeDragging = false; sendVolumeCommand(parseInt(slider.value, 10), slider.value > 0 ? false : undefined); });
            document.getElementById('btnVolMax').addEventListener('click', () => sendVolumeCommand(100, false));
            document.getElementById('btnVolMute').addEventListener('click', () => sendVolumeCommand(undefined, !(desktopVolume && desktopVolume.muted)));
            renderVolumePanel();
        }

        function renderServerStatus() {
            const el = document.getElementById('desktop-status-text'); if (!el) return;
            const d = desktopStatus; let state, label, dot, color;
            if (!navigator.onLine || !firebaseConnected) { state = 'noinet'; label = 'HP tidak terhubung internet'; dot = 'bg-amber-500'; color = 'text-amber-400'; }
            else if (!d) { state = 'unknown'; label = 'Belum ada data server'; dot = 'bg-gray-500'; color = 'text-gray-400'; }
            else if (d.online && (Date.now() + serverOffsetMs - (d.lastSeen || 0)) < 60000) { state = 'online'; label = 'Online'; dot = 'bg-green-500 shadow-[0_0_8px_#22c55e]'; color = 'text-green-400'; }
            else {
                state = 'offline'; dot = 'bg-red-500'; color = 'text-red-400';
                const t = d.lastSeen ? new Date(d.lastSeen).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\./g, ':') : '';
                label = 'Offline' + (t ? ' (Terakhir aktif: ' + t + ')' : '');
            }
            serverOnline = (state === 'online') ? true : (state === 'offline' ? false : null);
            el.innerHTML = `<span class="w-2 h-2 rounded-full ${dot} flex-shrink-0"></span> <span class="truncate">${esc(label)}</span>`;
            el.className = `font-mono ${color} font-bold min-w-0 max-w-full sm:max-w-[350px] flex items-center gap-1.5 mt-0.5 text-[11px] sm:text-xs`; el.title = label;
            const warn = document.getElementById('serverWarn'), grid = document.getElementById('manualSoundGrid');
            if (warn) {
                const msgs = { noinet: 'HP tidak terhubung ke internet. Perintah remote tidak bisa dikirim.', offline: 'Server sekolah sedang offline. Perintah remote mungkin baru berjalan setelah server online.' };
                warn.classList.toggle('hidden', !msgs[state]);
                warn.textContent = msgs[state] || '';
                warn.className = 'mb-3 rounded-lg border px-3 py-2 text-sm font-semibold ' + (state === 'noinet' ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-red-50 border-red-300 text-red-700') + (msgs[state] ? '' : ' hidden');
            }
            if (grid) grid.classList.toggle('remote-offline', state === 'noinet' || state === 'offline');
            if (typeof renderVolumePanel === 'function') renderVolumePanel();
        }

        function listenToConfig() {
            onValue(ref(db, 'schoolBellConfig'), snap => {
                const data = snap.val() || {};
                
                // Update tracker waktu terbaru dari firebase
                if(data.lastUpdated) {
                    currentFirebaseTS = new Date(data.lastUpdated).getTime();
                }
                // Gema dari perubahan yang baru kita simpan sendiri: data di memori sudah sama, tidak perlu render ulang
                if (isDataLoaded && currentFirebaseTS && ownWrites.has(currentFirebaseTS)) return;

                lastServerData = JSON.parse(JSON.stringify(data)); // salinan terpisah dari data yang diedit
                applyServerData(data);
            });
        }

        function applyServerData(data) {
                if (data.masterBel) {
                    masterBel = ensureArray(data.masterBel);
                } else {
                    masterBel = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, nama: `Bel ${i + 1}`, file: '' }));
                }
                jadwalKhusus = ensureArray(data.jadwalKhusus);
                jadwalMendatang = ensureArray(data.jadwalMendatang);
                masterJadwal = data.masterJadwal || {};
                
                savedTemplate = data.savedTemplate || 'HARI NORMAL';
                manualDayOverride = data.manualDayOverride || null;
                temporaryOverride = data.temporaryOverride || {date:null,name:null};
                secondSchedule = data.secondSchedule || {active:false,template:'HARI NORMAL',day:'Senin',isKhusus:false,date:null};

                // PENGGUNAAN TANGGAL LOKAL BUKAN ISO STRING
                const today = getTodayDateString();
                if(temporaryOverride.date && temporaryOverride.date !== today) temporaryOverride = {date:null,name:null};
                if(manualDayOverride && manualDayOverride.date !== today) manualDayOverride = null;
                if(secondSchedule.active && secondSchedule.date !== today) { secondSchedule.active=false; secondSchedule.date=null; }

                templates.forEach(t => { if(!masterJadwal[t]) masterJadwal[t]={}; jadwalUtama.forEach(day => { if(!masterJadwal[t][day]) masterJadwal[t][day]={}; }); });
                jadwalKhusus.forEach(k => { if(!k.jadwal) k.jadwal={}; });

                checkJadwalMendatang(today);

                if(!isDataLoaded) {
                    isDataLoaded = true;
                    document.getElementById('settingBtn').disabled = false;
                    document.getElementById('templateSelect').disabled = false;
                    scheduleNextBell();
                }
                renderAll();
                refreshSettingsIfOpen(); // perubahan dari desktop/perangkat lain ikut tampil di Pengaturan yang sedang terbuka
                setSyncStatus('synced', remoteNote(data));
        }


        function listenAvailableSounds() {
            onValue(ref(db, 'availableSounds'), snap => {
                const files = snap.val() || [];
                availableSounds = [{value:'', text:'(Pilih Suara)'}, ...files.map(f=>({value:f, text:f}))];
            });
        }

        async function saveConfig() {
            if(!auth.currentUser) return;
            // Jangan menimpa server memakai data basi bila HP sedang offline.
            if(!firebaseConnected) { setSyncStatus('offline'); showToast('HP tidak terhubung internet. Perubahan tidak disimpan.', 'error'); if (lastServerData && !_restoring) { _restoring = true; try { applyServerData(JSON.parse(JSON.stringify(lastServerData))); } finally { _restoring = false; } } return false; }
            
            // ANTI MENTAL BUGS:
            // Pastikan timestamp web lebih baru daripada yg ada di Firebase (memaksa sinkronisasi dengan desktop app)
            let newTS = Date.now();
            if (newTS <= currentFirebaseTS) {
                newTS = currentFirebaseTS + 1000;
            }
            const newTimeStr = new Date(newTS).toISOString();
            ownWrites.add(newTS); if (ownWrites.size > 50) ownWrites.delete(ownWrites.values().next().value);

            const data = { 
                masterJam: computeMasterJam(), // turunan otomatis (kompatibilitas klien lama)
                masterBel, jadwalKhusus, masterJadwal, jadwalMendatang, 
                savedTemplate, manualDayOverride, temporaryOverride, secondSchedule, 
                lastUpdated: newTimeStr, lastUpdatedBy: 'web' 
            };
            setSyncStatus('saving');
            try { await set(ref(db, 'schoolBellConfig'), data); setSyncStatus('synced'); return true; }
            catch (err) { console.error(err); setSyncStatus('error', err.code || ''); showToast('Gagal menyimpan ke server. Periksa koneksi.', 'error'); return false; }
        }

        function updateTime() {
            const now = new Date();
            const todayStr = getTodayDateString();
            
            document.getElementById('time').textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            document.getElementById('date').textContent = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            
            if (isDataLoaded && lastCheckedDate !== todayStr) checkJadwalMendatang(todayStr); // jangan tandai hari 'sudah dicek' sebelum data server tiba
            updateCountdown(now);
            
            const minKey = now.getHours() + ':' + now.getMinutes();
            if (minKey !== lastRenderedMinute) {
                lastRenderedMinute = minKey;
                renderActiveSchedule();
                if (secondSchedule && secondSchedule.active) renderSecondSchedule();
            }
        }

        function updateCountdown(now) {
            const { schedule } = getActiveInfo();
            const container = document.getElementById('nextBellContainer');
            const display = document.getElementById('countdownDisplay');

            if (!schedule || Object.keys(schedule).length === 0) {
                container.classList.add('hidden');
                return;
            }

            const nowTime = now.getHours() * 60 + now.getMinutes();
            const nowSeconds = now.getSeconds();
            const sortedTimes = Object.keys(schedule).filter(j => schedule[j] > 0).sort();
            let nextJam = null;

            for (let jam of sortedTimes) {
                const [h, m] = jam.split(':').map(Number);
                const jamMinutes = h * 60 + m;
                if (jamMinutes > nowTime || (jamMinutes === nowTime && nowSeconds === 0)) {
                    nextJam = { totalMin: jamMinutes };
                    break;
                }
            }

            if (nextJam) {
                container.classList.remove('hidden');
                const totalSecondsNow = nowTime * 60 + nowSeconds;
                const totalSecondsTarget = nextJam.totalMin * 60;
                let diffSeconds = totalSecondsTarget - totalSecondsNow;
                
                if(diffSeconds < 0) diffSeconds = 0;

                const mm = Math.floor(diffSeconds / 60);
                const ss = diffSeconds % 60;
                
                display.textContent = `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
                
                if (mm === 0) {
                    container.classList.add('bg-red-900/40', 'border-red-500/50');
                    display.classList.add('text-red-200');
                } else {
                    container.classList.remove('bg-red-900/40', 'border-red-500/50');
                    display.classList.remove('text-red-200');
                }
            } else {
                container.classList.add('hidden');
            }
        }

        function getActiveInfo() {
            // PENGGUNAAN TANGGAL LOKAL BUKAN ISO STRING
            const today = getTodayDateString(); 
            const dayName = new Date().toLocaleString('id-ID', { weekday: 'long' });
            
            if (temporaryOverride.date === today && temporaryOverride.name) {
                const khusus = jadwalKhusus.find(j => j.nama === temporaryOverride.name);
                return { schedule: khusus ? khusus.jadwal : {}, displayName: temporaryOverride.name.toUpperCase(), isOverride: true, effectiveDayName: temporaryOverride.name };
            }
            const effectiveDayName = (manualDayOverride && manualDayOverride.dayName) || dayName;
            const templateSchedule = masterJadwal[savedTemplate] || {};
            return { schedule: templateSchedule[effectiveDayName] || {}, displayName: savedTemplate.replace(/_/g, ' '), isOverride: false, effectiveDayName: effectiveDayName };
        }

        function scheduleNextBell() {
            if (nextBellTimeout) clearTimeout(nextBellTimeout);
            const now = new Date();
            const { schedule } = getActiveInfo();
            if (!schedule) return;
            
            const times = Object.keys(schedule).filter(j => schedule[j] > 0).sort();
            const nextTimeStr = times.find(t => {
                const [h, m] = t.split(':');
                const d = new Date(); d.setHours(h, m, 0, 0);
                return d > now;
            });

            if (nextTimeStr) {
                const [h, m] = nextTimeStr.split(':');
                const nextDate = new Date(); nextDate.setHours(h, m, 0, 0);
                const diff = nextDate.getTime() - now.getTime();
                nextBellTimeout = setTimeout(() => {
                    const belId = schedule[nextTimeStr];
                    const bel = masterBel.find(b => b.id == belId);
                    if(bel) playSimulation(bel, nextTimeStr);
                    scheduleNextBell();
                    renderActiveSchedule();
                }, diff);
            }
        }

        function playSimulation(bel, jam) {
            const items = document.querySelectorAll(`[data-jam="${jam}"]`);
            items.forEach(item => {
                item.classList.add('bell-ringing');
                setTimeout(()=>item.classList.remove('bell-ringing'), 1500);
            });
            showToast(`Perintah Bel [${jam}] dijalankan di Server.`, 'info');
        }

        function renderAll() {
            renderJadwalUtamaButtons();
            renderJadwalKhususButtons();
            renderManualSoundButtons();
            renderTemplateSelect();
            
            const { displayName, isOverride, effectiveDayName } = getActiveInfo(); 
            document.getElementById('activeDayDisplay').textContent = isOverride ? displayName : effectiveDayName.toUpperCase(); 
            document.getElementById('activeTemplateDisplay').textContent = `(${isOverride ? 'JADWAL KHUSUS' : displayName})`;
            
            renderActiveSchedule();
            renderSecondSchedule();
            updateSecondScheduleSelectors();
            renderJadwalMendatangWidget();
            if (isDataLoaded) scheduleNextBell();
        }

        // --- RENDERERS ---
        function renderJadwalUtamaButtons() { 
            const c = document.getElementById('jadwalUtamaContainer'); c.innerHTML = ''; 
            const { effectiveDayName, isOverride } = getActiveInfo(); 
            jadwalUtama.forEach(d => { 
                const b = document.createElement('button'); 
                b.className = 'btn btn-day flex-none max-w-full flex items-center justify-center text-center whitespace-normal text-sm font-bold px-4 py-2.5 lg:w-full lg:py-1.5'; 
                b.textContent = d; 
                if (d === effectiveDayName && !isOverride) b.classList.add('active'); 
                c.appendChild(b); 
            }); 
        }
        function renderJadwalKhususButtons() { 
            const c = document.getElementById('jadwalKhususContainer'); c.innerHTML = ''; 
            const t = getTodayDateString();
            if (!jadwalKhusus || jadwalKhusus.length === 0) { c.innerHTML = `<p class="text-slate-400 col-span-full text-center text-xs mt-2 w-full">Kosong.</p>`; } 
            else { 
                jadwalKhusus.forEach(i => { 
                    const b = document.createElement('button'); 
                    b.className = 'btn btn-day flex-none flex items-center justify-center text-center whitespace-nowrap lg:whitespace-normal text-sm font-bold px-4 py-2.5 lg:w-full lg:py-1.5'; 
                    b.textContent = i.nama; b.dataset.nama = i.nama; 
                    if (temporaryOverride.date === t && temporaryOverride.name === i.nama) b.classList.add('active'); 
                    c.appendChild(b); 
                }); 
            } 
        }
        
        function renderJadwalMendatangWidget() {
            const container = document.getElementById('jadwalMendatangWidget');
            const todayStr = getTodayDateString();
            
            const upcoming = jadwalMendatang.filter(j => mendatangEnd(j) >= todayStr).sort((a,b) => a.date.localeCompare(b.date));
            
            // JIKA JADWAL MENDATANG KOSONG, SEMBUNYIKAN KARTUNYA
            if (upcoming.length === 0) {
                document.getElementById('jadwalMendatangCard').classList.add('hidden');
                document.getElementById('jadwalKhususCard').classList.remove('lg:flex-1');
                document.getElementById('jadwalKhususCard').style.flex = "2 1 0%";
                return;
            }

            // JIKA ADA JADWAL MENDATANG, TAMPILKAN DAN KEMBALIKAN RASIO 1:1
            document.getElementById('jadwalMendatangCard').classList.remove('hidden');
            document.getElementById('jadwalKhususCard').style.flex = "1 1 0%";
            document.getElementById('jadwalKhususCard').classList.add('lg:flex-1');

            container.innerHTML = upcoming.map(j => {
                const dateObj = parseLocalDate(j.date);
                
                const isToday = mendatangInRange(j, todayStr);
                
                return `
                <div class="flex-none lg:w-full flex justify-between items-center p-2 mb-1.5 rounded-md border bg-white border-slate-200 shadow-sm ${isToday ? 'border-blue-400 ring-1 ring-blue-100' : ''} min-w-[200px] lg:min-w-0">
                    <div class="flex flex-col items-center justify-center w-12 flex-shrink-0 border-r border-slate-100 pr-2">
                        <span class="font-black text-lg text-blue-600 leading-none">${dateObj.getDate()}</span>
                        <span class="text-[10px] font-bold uppercase text-slate-500 mt-0.5">${dateObj.toLocaleDateString('id-ID', {month:'short'})}</span>
                    </div>
                    <div class="flex flex-col flex-grow ml-3 leading-tight overflow-hidden">
                        <span class="font-bold text-sm text-slate-700 truncate w-full" title="${esc(mendatangTitle(j))}">${esc(mendatangTitle(j))}</span>
                        <span class="text-[10px] font-medium text-slate-500 mt-1 flex items-center gap-1">${esc(mendatangBadges(j))}</span>
                    </div>
                </div>`;
            }).join('');
        }

        function renderManualSoundButtons() { 
            const g = document.getElementById('manualSoundGrid'); g.innerHTML = ''; 
            masterBel.forEach((b, i) => { 
                const btn = document.createElement('button'); 
                const hasFile = b.file && b.file.trim() !== "";
                btn.className = 'btn flex items-center justify-center text-center h-14 text-xs sm:text-sm font-bold leading-tight p-1 whitespace-normal shadow-sm transition-all'; 
                btn.textContent = b.nama; btn.dataset.belIndex = i; 
                if (!hasFile) btn.disabled = true; 
                g.appendChild(btn); 
            }); 
        }
        function renderTemplateSelect() { 
            const s = document.getElementById('templateSelect'); 
            s.innerHTML = templates.map(t => `<option value="${t}" ${t === savedTemplate ? 'selected' : ''}>${t.replace(/_/g, ' ')}</option>`).join(''); 
        }
        function renderActiveSchedule() { 
            const c = document.getElementById('activeScheduleContainer'); 
            const { schedule } = getActiveInfo(); 
            
            if (!schedule || Object.keys(schedule).length === 0) { 
                c.innerHTML = `<p class="text-slate-400 text-center p-2 text-xs w-full">Tidak ada jadwal.</p>`; return; 
            } 
            
            const sorted = Object.keys(schedule).filter(j => schedule[j] > 0).sort(); 
            const now = new Date(); const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; 
            
            c.innerHTML = sorted.map((jam, i) => { 
                const bel = masterBel.find(b => b.id == schedule[jam]); 
                
                let bgClass = 'schedule-item';
                if (jam < currentTime) bgClass = 'past-schedule-item'; 
                else if (jam === currentTime) bgClass = 'current-schedule-item pulse-active';

                return `<div class="flex justify-between items-center p-3 sm:p-2 mb-2 sm:mb-1.5 rounded-lg sm:rounded-md border shadow-sm transition-all duration-300 ${bgClass}" data-jam="${jam}">
                    <div class="flex items-center flex-shrink-0"> 
                        <span class="font-mono text-xs sm:text-[13px] mr-2 opacity-60 font-semibold index-text">[${i + 1}]</span> 
                        <span class="font-bold text-sm sm:text-[14px] text-slate-700 time-text">${jam}</span> 
                    </div>
                    <span class="text-[11px] sm:text-xs font-bold px-3 py-1.5 sm:py-1 rounded-md text-right whitespace-normal leading-tight max-w-[150px] ml-2 flex-grow flex justify-end items-center h-full min-h-[28px] badge-text" title="${esc(bel?.nama)}">${esc(bel?.nama)}</span>
                </div>`;
            }).join('');
        }
        
        function renderSecondSchedule() {
            const card2 = document.getElementById('secondScheduleCard');
            const remoteSection = document.getElementById('remoteSection');
            const scheduleSection = document.getElementById('activeScheduleSection');
            const gridContainer = document.getElementById('scheduleGridContainer');
            const btnAdd = document.getElementById('btnAddSecondSchedule');
            const manualGrid = document.getElementById('manualSoundGrid');
            
            if (!secondSchedule.active) {
                card2.classList.add('hidden'); btnAdd.classList.remove('hidden');
                
                remoteSection.className = "lg:col-span-8 card flex flex-col lg:h-full lg:min-h-0 transition-all duration-300";
                scheduleSection.className = "lg:col-span-2 flex flex-col gap-4 lg:h-full lg:min-h-0 transition-all duration-300";
                gridContainer.className = "flex flex-col lg:grid lg:grid-cols-1 gap-4 flex-1 lg:min-h-0 transition-all duration-300";
                
                manualGrid.className = "grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 lg:content-start gap-2 pb-2";
                return;
            }
            card2.classList.remove('hidden'); btnAdd.classList.add('hidden');
            
            remoteSection.className = "lg:col-span-6 card flex flex-col lg:h-full lg:min-h-0 transition-all duration-300";
            scheduleSection.className = "lg:col-span-4 flex flex-col gap-4 lg:h-full lg:min-h-0 transition-all duration-300";
            gridContainer.className = "flex flex-col lg:grid lg:grid-cols-2 gap-4 flex-1 lg:min-h-0 transition-all duration-300";
            
            manualGrid.className = "grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 lg:content-start gap-2 pb-2";
            
            let s = (secondSchedule.isKhusus) ? (jadwalKhusus.find(x => x.nama === secondSchedule.day)?.jadwal || {}) : (masterJadwal[secondSchedule.template]?.[secondSchedule.day] || {});
            const sorted = Object.keys(s).filter(j => s[j] > 0).sort();
            const now = new Date(); const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            
            document.getElementById('secondScheduleContainer').innerHTML = sorted.map((jam, i) => {
                const bel = masterBel.find(b => b.id == s[jam]);
                
                let bgClass = 'schedule-item';
                if (jam < currentTime) bgClass = 'past-schedule-item'; 
                else if (jam === currentTime) bgClass = 'current-schedule-item pulse-active';

                return `<div class="flex justify-between items-center p-3 sm:p-2 mb-2 sm:mb-1.5 rounded-lg sm:rounded-md border shadow-sm transition-all duration-300 ${bgClass}" data-jam="${jam}">
                    <div class="flex items-center flex-shrink-0"> 
                        <span class="font-mono text-xs sm:text-[13px] mr-2 opacity-60 font-semibold index-text">[${i + 1}]</span> 
                        <span class="font-bold text-sm sm:text-[14px] text-slate-700 time-text">${jam}</span> 
                    </div>
                    <span class="text-[11px] sm:text-xs font-bold px-3 py-1.5 sm:py-1 rounded-md text-right whitespace-normal leading-tight max-w-[150px] ml-2 flex-grow flex justify-end items-center h-full min-h-[28px] badge-text" title="${esc(bel?.nama)}">${esc(bel?.nama)}</span>
                </div>`;
            }).join('') || '<p class="text-center text-slate-400 text-sm sm:text-xs mt-4 italic w-full">Kosong</p>';
        }
        
        function updateSecondScheduleSelectors() {
            const tSelect = document.getElementById('secondTemplateSelect'); const dSelect = document.getElementById('secondDaySelect');
            if(!tSelect || !dSelect) return;
            tSelect.innerHTML = [...templates, "KHUSUS"].map(t => `<option value="${t}" ${secondSchedule.template === t ? 'selected' : ''}>${t}</option>`).join('');
            let dayOptions = (secondSchedule.template === "KHUSUS") ? jadwalKhusus.map(j => j.nama) : jadwalUtama;
            dSelect.innerHTML = dayOptions.map(d => `<option value="${esc(d)}" ${secondSchedule.day === d ? 'selected' : ''}>${esc(d)}</option>`).join('');
        }

        // --- EVENT HANDLERS ---
        function setupEventListeners() {
            document.getElementById('settingBtn').addEventListener('click', () => { renderSettingsContent(); populateSettingsDropdowns(); showModal('settings'); });
            document.querySelectorAll('[data-action="close"]').forEach(btn => {
                btn.addEventListener('click', (e) => { 
                    hideModal(e.target.closest('.modal-backdrop').id.replace('Modal', '')); 
                    if(e.target.closest('.modal-backdrop').id === 'pengumumanModal') stopRecording();
                    renderAll(); 
                });
            });
            
            // Event Listener Pengumuman
            document.getElementById('btnOpenPengumuman').addEventListener('click', () => {
                resetRecorder();
                showModal('pengumuman');
            });
            document.getElementById('btnStartRecord').addEventListener('click', startRecording);
            document.getElementById('btnStopRecord').addEventListener('click', stopRecording);
            document.getElementById('btnRetakeRecord').addEventListener('click', resetRecorder);
            document.getElementById('btnUploadAudio').addEventListener('click', () => {
                document.getElementById('uploadAudioInput').click();
            });
            document.getElementById('uploadAudioInput').addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                // Batas ukuran 5MB untuk mencegah query firebase kepenuhan dari base64
                if (file.size > 5 * 1024 * 1024) {
                    showToast("Ukuran file terlalu besar! Maksimal 5MB.", "error");
                    e.target.value = '';
                    return;
                }

                audioBlob = file;
                if (announcementAudioUrl) {
                    URL.revokeObjectURL(announcementAudioUrl);
                }
                announcementAudioUrl = URL.createObjectURL(file);
                
                const player = document.getElementById('previewAudioPlayer');
                player.src = announcementAudioUrl;
                player.classList.remove('hidden');
                
                document.getElementById('recordStatusText').textContent = "Pratinjau File Audio:";
                
                document.getElementById('btnStartRecord').classList.add('hidden');
                document.getElementById('btnUploadAudio').classList.add('hidden');
                document.getElementById('btnStopRecord').classList.add('hidden');
                document.getElementById('btnRetakeRecord').classList.remove('hidden');
                document.getElementById('btnBroadcastRecord').classList.remove('hidden');
                
                // Set durasi dari file upload
                const audio = new Audio(announcementAudioUrl);
                audio.addEventListener('loadedmetadata', () => {
                    let dur = audio.duration;
                    if(dur && dur !== Infinity) {
                        recordSeconds = Math.floor(dur);
                    } else {
                        recordSeconds = 0;
                    }
                });
                
                e.target.value = ''; // Reset input agar bisa upload ulang
            });
            
            // PERUBAHAN: Memunculkan modal konfirmasi sebelum mengirim
            document.getElementById('btnBroadcastRecord').addEventListener('click', () => {
                if(!audioBlob) return;
                const mm = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
                const ss = String(recordSeconds % 60).padStart(2, '0');
                document.getElementById('broadcastDurationDisplay').textContent = `Durasi: ${mm}:${ss}`;
                showModal('confirmBroadcast');
            });
            
            // EKSEKUSI PENGIRIMAN: Dijalankan jika klik "Ya, Siarkan!"
            document.getElementById('confirmSendBroadcastBtn').addEventListener('click', () => {
                hideModal('confirmBroadcast');
                broadcastAnnouncement();
            });
            
            document.body.addEventListener('click', (e) => { 
                if(e.target.matches('.modal-backdrop')) {
                    hideModal(e.target.id.replace('Modal','')); 
                    if(e.target.id === 'pengumumanModal') stopRecording();
                }
                
                const navBtn = e.target.closest('.settings-nav-btn');
                if(navBtn) {
                    document.querySelectorAll('.settings-nav-btn').forEach(b => b.classList.remove('active'));
                    navBtn.classList.add('active');
                    const tab = navBtn.dataset.tab;
                    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
                    document.getElementById(`tab-content-${tab}`).classList.remove('hidden');
                }
            });
            
            document.getElementById('templateSelect').addEventListener('change', (e) => { savedTemplate = e.target.value; saveConfig(); renderAll(); });
            document.getElementById('jadwalUtamaContainer').addEventListener('click', (e) => { 
                const btn = e.target.closest('.btn-day');
                if (btn) { 
                    const dayName = btn.textContent; 
                    if (manualDayOverride && manualDayOverride.dayName === dayName) manualDayOverride = null; else manualDayOverride = { date: getTodayDateString(), dayName: dayName }; 
                    temporaryOverride = { date: null, name: null }; renderAll(); saveConfig(); 
                } 
            });
            document.getElementById('jadwalKhususContainer').addEventListener('click', (e) => { 
                const btn = e.target.closest('.btn-day');
                if (btn) { 
                    const nama = btn.dataset.nama; const t = getTodayDateString(); 
                    if (temporaryOverride.date === t && temporaryOverride.name === nama) temporaryOverride = { date: null, name: null }; else temporaryOverride = { date: t, name: nama }; 
                    manualDayOverride = null; renderAll(); saveConfig(); 
                } 
            });
            document.getElementById('manualSoundGrid').addEventListener('click', e => { 
                const btn = e.target.closest('.btn');
                if (btn && !btn.disabled) { 
                    if (!navigator.onLine || !firebaseConnected) { showToast('Tidak ada koneksi internet.', 'error'); return; }
                    const index = parseInt(btn.dataset.belIndex); 
                    document.getElementById('confirmBellName').textContent = masterBel[index].nama;
                    document.getElementById('confirmPlayBtn').onclick = () => { triggerRemote(masterBel[index]); hideModal('confirmPlay'); };
                    document.getElementById('confirmPlayWarn').classList.toggle('hidden', serverOnline !== false); showModal('confirmPlay');
                } 
            });

            document.getElementById('btnAddSecondSchedule').addEventListener('click', () => { secondSchedule.active = true; secondSchedule.date = getTodayDateString(); renderAll(); saveConfig(); });
            document.getElementById('btnRemoveSecondSchedule').addEventListener('click', () => { secondSchedule.active = false; renderAll(); saveConfig(); });
            document.getElementById('secondTemplateSelect').addEventListener('change', (e) => { 
                secondSchedule.template = e.target.value; secondSchedule.isKhusus = (e.target.value === "KHUSUS"); 
                secondSchedule.date = getTodayDateString();
                if (secondSchedule.isKhusus) secondSchedule.day = jadwalKhusus.length > 0 ? jadwalKhusus[0].nama : ''; else secondSchedule.day = "Senin";
                renderAll(); saveConfig(); 
            });
            document.getElementById('secondDaySelect').addEventListener('change', (e) => { secondSchedule.day = e.target.value; secondSchedule.date = getTodayDateString(); renderAll(); saveConfig(); });
        }


        async function triggerRemote(bel) {
            if(!bel || !bel.id) return;
            try { await set(ref(db, 'remotePlayTrigger'), { belId: bel.id, timestamp: Date.now() }); } catch (err) { console.error(err); showToast('Gagal mengirim perintah. Periksa koneksi.', 'error'); return; }
            if (navigator.vibrate) navigator.vibrate(40);
            showToast(`Perintah: ${bel.nama} terkirim.`, 'success');
        }

        // --- FUNGSI REKAM SUARA (BARU) ---
        function resetRecorder() {
            if (recordInterval) clearInterval(recordInterval);
            recordSeconds = 0;
            audioChunks = [];
            audioBlob = null;
            if(announcementAudioUrl) {
                URL.revokeObjectURL(announcementAudioUrl);
                announcementAudioUrl = null;
            }
            
            // Pastikan stream dan context audio dimatikan
            if (audioContext && audioContext.state !== 'closed') audioContext.close();
            if (micStream) micStream.getTracks().forEach(track => track.stop());
            
            document.getElementById('recordTimer').textContent = "00:00";
            document.getElementById('recordTimer').classList.add('hidden');
            document.getElementById('recordStatusText').textContent = "Siap Merekam...";
            document.getElementById('previewAudioPlayer').classList.add('hidden');
            
            document.getElementById('btnStartRecord').classList.remove('hidden');
            document.getElementById('btnUploadAudio').classList.remove('hidden'); // Munculkan kembali tombol Upload
            document.getElementById('btnStopRecord').classList.add('hidden');
            document.getElementById('btnStartRecord').classList.remove('recording-active');
            
            document.getElementById('btnRetakeRecord').classList.add('hidden');
            document.getElementById('btnBroadcastRecord').classList.add('hidden');
            document.getElementById('btnBroadcastRecord').disabled = false;
            document.getElementById('btnBroadcastRecord').innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"></path></svg> Kirim & Siarkan`;
            
            document.getElementById('uploadProgressContainer').classList.add('hidden');
            document.getElementById('uploadProgressBar').style.width = '0%';
            document.getElementById('uploadProgressText').textContent = "Mengirim...";
        }

        async function startRecording() {
            try {
                // UI Langsung berubah, Anda bisa langsung bicara!
                document.getElementById('btnStartRecord').classList.add('hidden');
                document.getElementById('btnUploadAudio').classList.add('hidden'); // Sembunyikan tombol Upload
                document.getElementById('btnStopRecord').classList.remove('hidden');
                document.getElementById('recordStatusText').textContent = "Merekam... (Silakan bicara)";
                document.getElementById('recordTimer').classList.remove('hidden');
                document.getElementById('btnStopRecord').classList.add('recording-active');
                
                const audioConstraints = {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    channelCount: 1
                };

                micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                
                // --- TRIK MANIPULASI DELAY 2 DETIK ---
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const source = audioContext.createMediaStreamSource(micStream);
                
                // Buat penahan suara (Delay) maksimal 3 detik, set ke 2 detik
                const delayNode = audioContext.createDelay(3.0);
                delayNode.delayTime.value = 2.0; 
                
                const destination = audioContext.createMediaStreamDestination();
                
                // Sambungkan Mic -> Delay 2 Detik -> Destination
                source.connect(delayNode);
                delayNode.connect(destination);

                let recorderOptions = { audioBitsPerSecond: 128000 };
                if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                    recorderOptions.mimeType = 'audio/webm;codecs=opus';
                }

                // Rekam dari 'destination' yang suaranya sudah tertahan 2 detik
                mediaRecorder = new MediaRecorder(destination.stream, recorderOptions);
                
                mediaRecorder.ondataavailable = e => {
                    if (e.data.size > 0) {
                        audioChunks.push(e.data);
                    }
                };
                
                mediaRecorder.onstop = () => {
                    audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    announcementAudioUrl = URL.createObjectURL(audioBlob);
                    
                    const player = document.getElementById('previewAudioPlayer');
                    player.src = announcementAudioUrl;
                    player.classList.remove('hidden');
                    
                    document.getElementById('recordTimer').classList.add('hidden');
                    document.getElementById('recordStatusText').textContent = "Pratinjau Hasil Rekaman:";
                    
                    document.getElementById('btnStartRecord').classList.add('hidden');
                    document.getElementById('btnStopRecord').classList.add('hidden');
                    document.getElementById('btnRetakeRecord').classList.remove('hidden');
                    document.getElementById('btnBroadcastRecord').classList.remove('hidden');

                    // Bersihkan memori audio
                    if (audioContext && audioContext.state !== 'closed') audioContext.close();
                    if (micStream) micStream.getTracks().forEach(track => track.stop());
                };
                
                audioChunks = [];
                mediaRecorder.start();
                
                recordSeconds = 0;
                recordInterval = setInterval(() => {
                    recordSeconds++;
                    const mm = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
                    const ss = String(recordSeconds % 60).padStart(2, '0');
                    document.getElementById('recordTimer').textContent = `${mm}:${ss}`;
                    
                    // Batas otomatis 3 menit (180 detik)
                    if (recordSeconds >= 180) {
                        stopRecording();
                        showToast("Batas maksimal rekaman (3 menit) tercapai.", "info");
                    }
                }, 1000);
                
            } catch (err) {
                console.error(err);
                showToast("Gagal mengakses mikrofon! Pastikan izin diberikan.", "error");
                resetRecorder();
            }
        }

        function stopRecording() {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                if (recordInterval) clearInterval(recordInterval);
                document.getElementById('btnStopRecord').classList.remove('recording-active');
                document.getElementById('recordStatusText').textContent = "Menyimpan... (Tunggu 2 detik)";
                
                // KITA HARUS MENUNGGU 2 DETIK SEBELUM MEMATIKAN REKAMAN!
                // Mengapa? Karena suara terakhir yang baru saja Anda ucapkan masih "berjalan"
                // di dalam efek DelayNode. Kita beri waktu 2 detik agar suara terakhir masuk ke rekaman.
                setTimeout(() => {
                    mediaRecorder.stop();
                }, 2000);
            }
        }

        async function broadcastAnnouncement() {
            if(!audioBlob) return;
            
            const btnBroadcast = document.getElementById('btnBroadcastRecord');
            const progressContainer = document.getElementById('uploadProgressContainer');
            const progressBar = document.getElementById('uploadProgressBar');
            const progressText = document.getElementById('uploadProgressText');
            const originalBtnHTML = btnBroadcast.innerHTML;
            
            // UI Loading State (Mencegah tombol terlihat stuck)
            btnBroadcast.disabled = true;
            btnBroadcast.innerHTML = `<div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> <span>Memproses...</span>`;
            progressContainer.classList.remove('hidden');
            progressBar.style.width = '50%';
            progressText.textContent = "Mengkonversi suara...";
            
            try {
                // Konversi Blob Suara menjadi Base64 String (Data URL)
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = async () => {
                    const base64AudioData = reader.result;
                    
                    progressBar.style.width = '80%';
                    progressText.textContent = "Mengirim ke server...";
                    
                    try {
                        // Kirim String Base64 langsung ke Realtime Database! (Gratis & Tanpa Storage)
                        await set(ref(db, 'remotePlayTrigger'), { 
                            url: base64AudioData, // Mengirim suara berupa teks Base64
                            isAnnouncement: true,
                            timestamp: Date.now()
                        });
                        
                        progressBar.style.width = '100%';
                        progressText.textContent = "Selesai!";
                        
                        showToast("Pengumuman berhasil dikirim dan disiarkan!", "success");
                        
                        // Perilaku diubah: Tidak menutup modal, cukup mereset UI tombol agar bisa diputar lagi
                        setTimeout(() => {
                            btnBroadcast.disabled = false;
                            btnBroadcast.innerHTML = originalBtnHTML;
                            progressContainer.classList.add('hidden');
                            progressBar.style.width = '0%';
                        }, 1000);
                        
                    } catch (error) {
                        console.error("Gagal kirim Database", error);
                        showToast("Gagal mengirim perintah ke server!", "error");
                        btnBroadcast.disabled = false;
                        btnBroadcast.innerHTML = originalBtnHTML;
                        progressContainer.classList.add('hidden');
                    }
                };
                
                reader.onerror = () => {
                    showToast("Gagal membaca rekaman audio!", "error");
                    btnBroadcast.disabled = false;
                    btnBroadcast.innerHTML = originalBtnHTML;
                    progressContainer.classList.add('hidden');
                };

            } catch (e) {
                console.error("System error", e);
                showToast("Terjadi kesalahan sistem!", "error");
                btnBroadcast.disabled = false;
                btnBroadcast.innerHTML = originalBtnHTML;
                progressContainer.classList.add('hidden');
            }
        }

        // --- SETTINGS LOGIC ---
        function renderSettingsContent() {
            
            // TAB: HARI KHUSUS
            document.getElementById('tab-content-hari').innerHTML = `
                <div class="mb-6">
                    <h4 class="text-lg font-semibold text-slate-800 mb-3">Jadwal Khusus</h4>
                    <form id="addHariForm" class="shadow-sm flex flex-col sm:flex-row items-center gap-3 sm:gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <input type="text" id="hariInput" class="w-full sm:w-auto bg-white border border-slate-300 rounded-md p-3 sm:p-2 text-base flex-grow outline-none focus:ring-2 focus:ring-orange-200" placeholder="Nama Jadwal" required>
                        <button type="submit" class="w-full sm:w-auto btn bg-orange-600 hover:bg-orange-700 text-white border-0 py-3 sm:py-2">Tambah</button>
                    </form>
                </div>
                <div id="hariListContainer" class="space-y-2"></div>`;
            renderHariList();
            document.getElementById('addHariForm').onsubmit = (e) => { e.preventDefault(); const v = document.getElementById('hariInput').value.trim().replace(/\s+/g, ' '); if (!v) return; if (jadwalKhusus.some(k => k.nama.toLowerCase() === v.toLowerCase())) { showToast('Nama jadwal khusus sudah ada!', 'error'); return; } jadwalKhusus.push({ nama: v, jadwal: {} }); saveConfig(); renderHariList(); e.target.reset(); refreshSettingsIfOpen(); };
            
            document.getElementById('hariListContainer').onclick = e => {
                const target = e.target.closest('button');
                if (!target) return;
                const idx = target.dataset.index;
                
                if (target.classList.contains('edit-hari-btn')) {
                    document.getElementById('editHariIndex').value = idx;
                    document.getElementById('editHariInput').value = jadwalKhusus[idx].nama;
                    showModal('editHari');
                } else if (target.classList.contains('delete-hari-btn')) {
                    document.getElementById('deleteHariText').textContent = `Hapus jadwal khusus "${jadwalKhusus[idx].nama}"?`;
                    document.getElementById('confirmDeleteHariBtn').dataset.deleteIndex = idx;
                    showModal('deleteHari');
                }
            };

            // TAB: JADWAL MENDATANG
            document.getElementById('tab-content-mendatang').innerHTML = `
                <div class="mb-6">
                    <h4 class="text-lg font-semibold text-slate-800 mb-3">Daftar Jadwal Mendatang</h4>
                    <button id="btnTambahMendatang" class="w-full sm:w-max btn bg-orange-600 hover:bg-orange-700 text-white shadow-md flex gap-2 items-center justify-center border-0 py-3 sm:py-2">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        Tambah Jadwal
                    </button>
                </div>
                <div class="bg-blue-50 border border-blue-200 p-4 rounded-lg text-sm text-blue-800 mb-6">
                    Pilih tanggal, lalu atur <b>Jadwal 1</b>, <b>Jadwal 2</b>, atau keduanya. Isi "Sampai Tanggal" bila ingin berlaku beberapa hari berturut-turut (mis. 2–3 hari). Jadwal 1 bisa berupa jadwal khusus atau ganti template (permanen sejak tanggal mulai); Jadwal 2 hanya berlaku selama rentang yang Anda pilih. Bagian yang tidak diatur tetap otomatis (Jadwal 1 mengikuti hari saat itu). Jika tanggal sudah lewat, jadwal menjadi usang (abu-abu).
                </div>
                <div id="mendatangListContainer" class="space-y-3"></div>
            `;
            renderJadwalMendatangList();
            
            document.getElementById('btnTambahMendatang').onclick = () => {
                document.getElementById('formMendatangTitle').textContent = "Tambah Jadwal Mendatang";
                document.getElementById('formMendatang').reset();
                document.getElementById('mendatangId').value = "";
                document.getElementById('mendatangDate').min = getTodayDateString(); 
                fillMendatangSecond(null);
                showModal('formMendatang');
            };
            
            document.getElementById('formMendatang').onsubmit = async (e) => {
                e.preventDefault();
                const id = document.getElementById('mendatangId').value;
                const date = document.getElementById('mendatangDate').value;
                if (!date) { showToast("Pilih tanggal terlebih dahulu!", "error"); return; }
                const sec = readMendatangFields(); if (!sec) return;

                if (id) {
                    const idx = jadwalMendatang.findIndex(j => j.id === id);
                    if (idx > -1) {
                        jadwalMendatang[idx] = { id, date, applied: false, ...sec };
                    }
                } else {
                    jadwalMendatang.push({ id: Date.now().toString(), date, applied: false, ...sec });
                }

                checkJadwalMendatang(getTodayDateString(), true); // acara hari ini langsung berlaku
                await saveConfig();
                renderJadwalMendatangList(); 
                renderAll(); 
                hideModal('formMendatang');
                showToast("Jadwal mendatang disimpan!", "success");
            };

            document.getElementById('mendatangListContainer').onclick = e => {
                const target = e.target.closest('button');
                if (!target) return;
                const id = target.dataset.id;
                const item = jadwalMendatang.find(j => j.id === id);
                if(!item) return;

                if (target.classList.contains('edit-mendatang-btn')) {
                    document.getElementById('formMendatangTitle').textContent = "Edit Jadwal Mendatang";
                    document.getElementById('mendatangId').value = item.id;
                    document.getElementById('mendatangDate').value = item.date;
                    fillMendatangSecond(item);
                    showModal('formMendatang');
                } else if (target.classList.contains('delete-mendatang-btn')) {
                    const dateObj = parseLocalDate(item.date);
                    document.getElementById('deleteMendatangText').innerHTML = `Hapus jadwal mendatang <strong>${esc(mendatangTitle(item))}</strong> pada ${esc(mendatangRangeText(item))}?`;
                    document.getElementById('confirmDeleteMendatangBtn').dataset.id = id;
                    showModal('deleteMendatang');
                }
            };

            document.getElementById('confirmDeleteMendatangBtn').onclick = async (e) => {
                const id = e.currentTarget.dataset.id;
                jadwalMendatang = jadwalMendatang.filter(j => j.id !== id);
                await saveConfig();
                renderJadwalMendatangList();
                renderAll();
                hideModal('deleteMendatang');
                showToast("Jadwal mendatang dihapus", "success");
            };

            // TAB: MASTER BEL
            document.getElementById('tab-content-bel').innerHTML = `
                <div class="mb-6">
                    <h4 class="text-lg font-semibold text-slate-800 mb-3">Master Bel</h4>
                    <div class="bg-blue-50 border border-blue-200 p-4 rounded-lg text-sm text-blue-800">
                        Atur nama bel dan file suara yang akan diputar di Server Sekolah.
                    </div>
                </div>
                <div id="belListContainer" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>`;
            renderBelList();
            document.getElementById('belListContainer').onclick = e => { const target = e.target.closest('.edit-bel-btn'); if (target) { const index = parseInt(target.dataset.index); const bel = masterBel[index]; document.getElementById('editBelTitleId').textContent = bel.id; document.getElementById('editBelIndex').value = index; document.getElementById('editBelNamaInput').value = bel.nama; document.getElementById('editBelFileSelect').innerHTML = availableSounds.map(s => `<option value="${esc(s.value)}" ${s.value === bel.file ? 'selected' : ''}>${esc(s.text)}</option>`).join(''); showModal('editBel'); } };

            // TAB: ATUR JADWAL (per-jadwal, lihat blok bersama di bawah)
            renderJadwalTab();

            document.getElementById('editHariForm').onsubmit = e => { e.preventDefault(); const i = parseInt(document.getElementById('editHariIndex').value); const n = document.getElementById('editHariInput').value.trim().replace(/\s+/g, ' '); const old = jadwalKhusus[i].nama; if (!n) return; if (jadwalKhusus.some((k, x) => x !== i && k.nama.toLowerCase() === n.toLowerCase())) { showToast('Nama jadwal khusus sudah ada!', 'error'); return; } if (n !== old) { jadwalKhusus[i].nama = n; renameKhusus(old, n); } saveConfig(); renderHariList(); hideModal('editHari'); renderAll(); refreshSettingsIfOpen(); };
            document.getElementById('confirmDeleteHariBtn').onclick = e => { const i = parseInt(e.target.dataset.deleteIndex); const nama = jadwalKhusus[i].nama; jadwalKhusus.splice(i, 1); removeKhusus(nama); saveConfig(); renderHariList(); hideModal('deleteHari'); renderAll(); refreshSettingsIfOpen(); };

            document.getElementById('editBelForm').onsubmit = e => { e.preventDefault(); const i = document.getElementById('editBelIndex').value; masterBel[i].nama = document.getElementById('editBelNamaInput').value; masterBel[i].file = document.getElementById('editBelFileSelect').value; saveConfig(); renderBelList(); hideModal('editBel'); refreshSettingsIfOpen(); };
        }

        // --- RENDER LISTS SETTINGS ---
        function renderHariList() { document.getElementById('hariListContainer').innerHTML = jadwalKhusus.map((h,i)=>`<div class="flex justify-between items-center bg-white p-3 sm:p-4 border border-slate-200 rounded text-slate-800"><span>${esc(h.nama)}</span><div class="flex gap-2"><button class="btn p-2 sm:p-1 px-3 edit-hari-btn" data-index="${i}">Edit</button> <button class="btn p-2 sm:p-1 px-3 delete-hari-btn text-red-500" data-index="${i}">Hapus</button></div></div>`).join(''); }
        
        
        function renderBelList() { document.getElementById('belListContainer').innerHTML = masterBel.map((b,i)=>`<div class="card p-4 sm:p-3 flex justify-between items-center text-sm text-slate-800"><div><p class="font-bold text-base sm:text-sm mb-1 sm:mb-0">${esc(b.nama)}</p><p class="text-xs text-slate-500">${esc(b.file || 'Kosong')}</p></div><button class="btn p-2 sm:p-1 px-4 edit-bel-btn" data-index="${i}">Edit</button></div>`).join(''); }
        
        function renderJadwalMendatangList() {
            const container = document.getElementById('mendatangListContainer');
            if (!container) return;
            if (!jadwalMendatang || jadwalMendatang.length === 0) { container.innerHTML = `<p class="text-slate-500 text-center italic bg-slate-50 p-6 rounded border border-slate-200 border-dashed">Belum ada jadwal yang dijadwalkan.</p>`; return; }

            const todayStr = getTodayDateString();
            const sorted = [...jadwalMendatang].sort((a,b) => a.date.localeCompare(b.date));

            container.innerHTML = sorted.map(j => {
                const isPast = mendatangEnd(j) < todayStr;
                const isToday = mendatangInRange(j, todayStr);
                const dateObj = parseLocalDate(j.date);
                const displayDate = mendatangRangeText(j);
                
                let bgClass = "bg-white border-slate-200";
                let textClass = "text-slate-800";
                let badgeClass = "bg-blue-100 text-blue-800";
                
                if (isPast) { bgClass = "bg-slate-100 border-slate-200 opacity-60"; textClass = "text-slate-500 line-through"; badgeClass = "bg-slate-200 text-slate-500"; } 
                else if (isToday) { bgClass = "bg-orange-50 border-orange-300 shadow-sm"; badgeClass = "bg-orange-200 text-orange-800 font-bold animate-pulse"; }

                const typeLabel = mendatangTypeLabel(j);

                return `
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 border rounded-lg ${bgClass} transition-all gap-4">
                    <div>
                        <div class="flex items-center gap-2 mb-1.5 sm:mb-1">
                            <span class="text-xs px-2 py-0.5 rounded ${badgeClass}">${typeLabel}</span>
                            ${isToday ? `<span class="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 font-bold">Hari Ini!</span>` : ''}
                        </div>
                        <p class="font-bold text-lg ${textClass}">${displayDate}</p>
                        ${mendatangDetailHtml(j)}
                    </div>
                    <div class="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-200">
                        <button class="btn flex-1 sm:flex-none p-3 sm:p-2 flex justify-center edit-mendatang-btn" data-id="${j.id}" title="Edit"><svg class="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                        <button class="btn flex-1 sm:flex-none p-3 sm:p-2 flex justify-center text-red-500 hover:bg-slate-100 delete-mendatang-btn" data-id="${j.id}" title="Hapus"><svg class="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                    </div>
                </div>`;
            }).join('');
        }
        
        

        // --- HELPERS ---
        function applyTimeInputMask(id) {
            const el = document.getElementById(id); if(!el) return;
            const newClone = el.cloneNode(true);
            el.parentNode.replaceChild(newClone, el);
            const freshInput = document.getElementById(id);

            freshInput.addEventListener('input', function(e) {
                let v = this.value.replace(/[^0-9]/g, '');
                if(v.length > 4) v = v.slice(0, 4);
                if(v.length >= 2) {
                    if(parseInt(v.slice(0, 2)) > 23) v = '23' + v.slice(2);
                    this.value = v.slice(0, 2) + ':' + v.slice(2);
                    if(v.length >= 3) {
                        if(v.slice(2).length == 2 && parseInt(v.slice(2)) > 59) this.value = v.slice(0, 2) + ':59';
                    }
                } else {
                    this.value = v;
                }
            });
            freshInput.addEventListener('keydown', function(e) {
                if (e.key === 'Backspace' && this.value.endsWith(':')) {
                    e.preventDefault(); this.value = this.value.slice(0, -1);
                }
            });
            freshInput.addEventListener('blur', function() {
                let v = this.value;
                if(v.length === 0) return;
                const clean = v.replace(/[^0-9]/g, '');
                if (clean.length === 1) this.value = '0' + clean + ':00';
                else if (clean.length === 2) this.value = clean + ':00';
                else if (clean.length === 3) this.value = '0' + clean.slice(0,1) + ':' + clean.slice(1);
            });
        }
        function showModal(k) { document.documentElement.classList.add('modal-open'); document.body.classList.add('modal-open'); const el = document.getElementById(MODALS[k]); el.classList.remove('hidden'); void el.offsetWidth; el.classList.add('visible'); }
        function hideModal(k) { const el = document.getElementById(MODALS[k]); el.classList.remove('visible'); setTimeout(() => { if (!el.classList.contains('visible')) el.classList.add('hidden'); if (!document.querySelector('.modal-backdrop.visible')) { document.documentElement.classList.remove('modal-open'); document.body.classList.remove('modal-open'); } }, 280); }
        function showToast(m, t='info') { const e = document.createElement('div'); e.className = `toast toast-${t}`; e.textContent = m; document.getElementById('toast-container').appendChild(e); setTimeout(() => { e.classList.add('hiding'); e.addEventListener('animationend', () => e.remove()); }, 3000); }
    

        // ===================== TAMBAHAN REVISI =====================
        // --- Helper ---
        function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
        function parseLocalDate(str) { const [y, m, d] = String(str).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
        function validJam(v) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(v); }
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && isDataLoaded) { lastRenderedMinute = null; updateTime(); scheduleNextBell(); renderServerStatus(); }
        });

        // --- Navigasi bawah (HP) ---
        function setMobileTab(t) {
            document.body.dataset.mtab = t;
            document.querySelectorAll('#bottom-nav [data-mtab]').forEach(b => { const a = b.dataset.mtab === t; b.classList.toggle('active', a); b.setAttribute('aria-current', a ? 'page' : 'false'); });
            window.scrollTo({ top: 0 });
        }
        function initMobileNav() {
            setMobileTab('remote');
            document.getElementById('bottom-nav').addEventListener('click', e => {
                const b = e.target.closest('[data-mtab]'); if (!b) return;
                const t = b.dataset.mtab;
                if (t === 'siaran') document.getElementById('btnOpenPengumuman').click();
                else if (t === 'setelan') document.getElementById('settingBtn').click();
                else setMobileTab(t);
            });
        }

        // --- Picker modal: pengganti dropdown <select> bawaan browser ---
        const PICKER_TITLES = { templateSelect: 'Template Jadwal', secondTemplateSelect: 'Template Jadwal 2', secondDaySelect: 'Hari / Jadwal 2', mendatangType: 'Aksi Otomatis', mendatangValue: 'Pilih Jadwal', addBelSelect: 'Pilih bel', salinTemplate: 'Salin dari: template', salinDay: 'Salin dari: hari', mendatangSecondTemplate: 'Template Jadwal 2', mendatangSecondDay: 'Hari / Jadwal 2', editBelFileSelect: 'File Suara MP3', jadwalTemplateSelect: 'Template', jadwalDaySelect: 'Hari' };
        const _selValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        let pickerTarget = null;

        function enhanceSelect(sel) {
            if (sel.dataset.picker) return; sel.dataset.picker = '1';
            const btn = document.createElement('button'); btn.type = 'button'; btn.setAttribute('aria-haspopup', 'dialog');
            const label = document.createElement('span'); label.className = 'picker-label'; btn.appendChild(label);
            sel.style.display = 'none'; sel.insertAdjacentElement('afterend', btn);
            const sync = () => {
                const o = sel.options[sel.selectedIndex];
                label.textContent = o ? o.text : '—';
                btn.className = 'picker-trigger ' + sel.className.replace(/\bhidden\b/g, '');
                btn.disabled = sel.disabled;
            };
            Object.defineProperty(sel, 'value', { get() { return _selValue.get.call(this); }, set(v) { _selValue.set.call(this, v); sync(); }, configurable: true });
            new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
            sel.addEventListener('change', sync);
            btn.addEventListener('click', () => openPicker(sel));
            sync();
        }
        function openPicker(sel) {
            if (sel.disabled) return; pickerTarget = sel;
            document.getElementById('pickerTitle').textContent = PICKER_TITLES[sel.id] || (sel.dataset.jam ? 'Bel untuk jam ' + sel.dataset.jam : 'Pilih opsi');
            const many = sel.options.length > 8, search = document.getElementById('pickerSearch');
            document.getElementById('pickerSearchWrap').classList.toggle('hidden', !many); search.value = '';
            renderPickerList(''); showModal('picker');
            if (many && window.matchMedia('(hover: hover)').matches) setTimeout(() => search.focus(), 80);
            setTimeout(() => { const c = document.querySelector('#pickerList .selected'); if (c) c.scrollIntoView({ block: 'center' }); }, 80);
        }
        function renderPickerList(q) {
            const sel = pickerTarget, list = document.getElementById('pickerList'); if (!sel) return;
            q = q.trim().toLowerCase();
            const items = [...sel.options].filter(o => !o.disabled && (!q || o.text.toLowerCase().includes(q)));
            const check = '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>';
            list.innerHTML = items.length ? items.map(o => { const on = o.index === sel.selectedIndex; return `<button type="button" role="option" aria-selected="${on}" class="picker-item ${on ? 'selected' : ''}" data-idx="${o.index}"><span>${esc(o.text)}</span>${on ? check : ''}</button>`; }).join('') : '<p class="text-center text-slate-400 text-sm py-6">Tidak ditemukan.</p>';
        }
        function closePicker() { hideModal('picker'); pickerTarget = null; }
        function initPickers() {
            document.getElementById('pickerList').addEventListener('click', e => {
                const b = e.target.closest('.picker-item'); if (!b || !pickerTarget) return;
                const sel = pickerTarget, o = sel.options[parseInt(b.dataset.idx)];
                closePicker();
                if (o && o.index !== sel.selectedIndex) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
            });
            document.getElementById('pickerSearch').addEventListener('input', e => renderPickerList(e.target.value));
            document.querySelector('[data-picker-close]').addEventListener('click', closePicker);
            document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('pickerModal').classList.contains('visible')) closePicker(); });
            const scan = root => { if (root.nodeType !== 1) return; if (root.tagName === 'SELECT') enhanceSelect(root); else root.querySelectorAll && root.querySelectorAll('select:not([data-picker])').forEach(enhanceSelect); };
            document.querySelectorAll('select').forEach(enhanceSelect);
            new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
        }
        initPickers();

        // ====================================================================
        // ATUR JADWAL v2  -  tiap jadwal punya daftar jam sendiri (tanpa Master Jam)
        // CATATAN: blok ini IDENTIK di desktop-app.html dan app.js (web) agar tampilan
        // dan perilakunya selaras. Jika diubah, ubah di kedua file.
        // ====================================================================
        const BEL_KAT = {
            masuk:     { label: 'Bel masuk',          color: '#16a34a' },
            pelajaran: { label: 'Jam pelajaran',      color: '#2563eb' },
            istirahat: { label: 'Istirahat',          color: '#d97706' },
            pulang:    { label: 'Pulang',             color: '#dc2626' },
            kegiatan:  { label: 'Upacara & kegiatan', color: '#7c3aed' },
            ujian:     { label: 'Ujian',              color: '#0891b2' },
            lain:      { label: 'Lainnya',            color: '#64748b' }
        };

        function belKategori(bel) {
            const n = String((bel && bel.nama) || '').toLowerCase();
            if (/pulang/.test(n)) return 'pulang';
            if (/istirahat/.test(n)) return 'istirahat';
            if (/ujian/.test(n)) return 'ujian';
            if (/^jam\s*\d+/.test(n)) return 'pelajaran';
            if (/masuk/.test(n)) return 'masuk';
            if (/upacara|jumat|kerohanian|indonesia raya|bagimu negeri|doa/.test(n)) return 'kegiatan';
            return 'lain';
        }
        function belColor(belId) {
            const bel = masterBel.find(b => b && b.id == belId);
            return BEL_KAT[belKategori(bel)].color;
        }

        // "7:30", "730", "0730", "07.30" -> "07:30"; selain itu null
        function normalizeJam(raw) {
            const s = String(raw == null ? '' : raw).trim().replace(/[.\s]/g, ':');
            const mt = s.match(/^(\d{1,2}):(\d{2})$/) || s.match(/^(\d{1,2})(\d{2})$/);
            if (!mt) return null;
            const h = parseInt(mt[1], 10), m = parseInt(mt[2], 10);
            if (h > 23 || m > 59) return null;
            return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        }
        function maskJamInput(el) {
            let v = el.value.replace(/[^0-9]/g, '').slice(0, 4);
            if (v.length >= 2) {
                if (parseInt(v.slice(0, 2), 10) > 23) v = '23' + v.slice(2);
                let out = v.slice(0, 2) + ':' + v.slice(2);
                if (v.length === 4 && parseInt(v.slice(2), 10) > 59) out = v.slice(0, 2) + ':59';
                el.value = out;
            } else {
                el.value = v;
            }
        }

        function daysFor(tv) { return tv === 'JADWAL_KHUSUS' ? jadwalKhusus.map(j => j.nama) : jadwalUtama; }
        function schedTitle(t, d) { return t === 'JADWAL_KHUSUS' ? ('Khusus: ' + d) : (t + ' \u2022 ' + d); }
        function currentSched() {
            const t = document.getElementById('jadwalTemplateSelect'), d = document.getElementById('jadwalDaySelect');
            return { t: t ? t.value : '', d: d ? d.value : '' };
        }
        // Objek {jam: idBel} milik satu jadwal. create=true -> dibuat bila belum ada.
        function getScheduleObj(t, d, create) {
            if (!d) return null;
            if (t === 'JADWAL_KHUSUS') {
                const k = jadwalKhusus.find(x => x.nama === d);
                if (!k) return null;
                if (!k.jadwal) k.jadwal = {};
                return k.jadwal;
            }
            if (!masterJadwal[t]) { if (!create) return null; masterJadwal[t] = {}; }
            if (!masterJadwal[t][d]) { if (!create) return null; masterJadwal[t][d] = {}; }
            return masterJadwal[t][d];
        }
        function schedEntries(s) {
            return s ? Object.keys(s).filter(j => parseInt(s[j], 10) > 0).sort() : [];
        }
        function countSched(t, d) { return schedEntries(getScheduleObj(t, d, false)).length; }

        // Daftar jam gabungan, hanya untuk kompatibilitas klien lama yang masih membaca "masterJam".
        function computeMasterJam() {
            const set = new Set();
            Object.values(masterJadwal || {}).forEach(t => { if (t) Object.values(t).forEach(day => { if (day) Object.keys(day).forEach(j => set.add(j)); }); });
            (jadwalKhusus || []).forEach(k => { if (k && k.jadwal) Object.keys(k.jadwal).forEach(j => set.add(j)); });
            return [...set].sort();
        }

        // ---------- Pilihan bel (dikelompokkan per kategori) ----------
        function belOptionsHTML(selectedId) {
            const groups = {};
            masterBel.forEach(b => {
                if (!b) return;
                if (!(b.file || b.id == selectedId)) return;
                const k = belKategori(b);
                (groups[k] = groups[k] || []).push(b);
            });
            let html = '';
            if (selectedId && !masterBel.some(b => b && b.id == selectedId)) {
                html += '<option value="' + esc(selectedId) + '" selected>(Bel #' + esc(selectedId) + ' tidak ditemukan)</option>';
            }
            Object.keys(BEL_KAT).forEach(k => {
                if (!groups[k]) return;
                html += '<optgroup label="' + esc(BEL_KAT[k].label) + '">' +
                    groups[k].map(b => '<option value="' + b.id + '"' + (b.id == selectedId ? ' selected' : '') + '>' + esc(b.nama) + '</option>').join('') +
                    '</optgroup>';
            });
            return html;
        }
        function refreshAddBelOptions() {
            const sel = document.getElementById('addBelSelect'); if (!sel) return;
            const keep = sel.value;
            sel.innerHTML = '<option value="">Pilih bel\u2026</option>' + belOptionsHTML(0);
            if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
        }

        // ---------- Render tab Atur Jadwal ----------
        function renderJadwalTab() {
            const el = document.getElementById('tab-content-jadwal'); if (!el) return;
            el.innerHTML =
                '<h4 class="text-lg font-semibold text-slate-800 mb-3">Atur Jadwal</h4>' +
                '<div id="jadwalHeader" class="jadwal-sticky">' +
                    '<div class="grid grid-cols-2 gap-2">' +
                        '<select id="jadwalTemplateSelect" class="jsel" aria-label="Template"></select>' +
                        '<select id="jadwalDaySelect" class="jsel" aria-label="Hari / jadwal"></select>' +
                    '</div>' +
                    '<form id="addRowForm" class="flex items-center gap-2 mt-2" autocomplete="off">' +
                        '<input id="jamInput" type="text" inputmode="numeric" maxlength="5" placeholder="00:00" class="jam-input" aria-label="Jam baru">' +
                        '<select id="addBelSelect" class="jsel bel-add" aria-label="Pilih bel"></select>' +
                        '<button type="submit" class="jbtn jbtn-primary">+ Tambah</button>' +
                    '</form>' +
                    '<div class="flex flex-wrap items-center gap-2 mt-2">' +
                        '<span id="jadwalCount" class="jcount"></span>' +
                        '<span class="sync-badge sync-pill"></span>' +
                        '<div class="ml-auto flex flex-wrap gap-2">' +
                            '<button type="button" id="btnSalinDari" class="jbtn">Salin dari\u2026</button>' +
                            '<button type="button" id="btnTerapkanKe" class="jbtn">Terapkan ke\u2026</button>' +
                            '<button type="button" id="btnKosongkanJadwal" class="jbtn jbtn-danger">Kosongkan</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div id="jadwalRows" class="space-y-2 mt-3 pb-6"></div>';
            bindJadwalTab();
            fixJadwalStickyOffset();
            renderSyncBadge();
        }

        // Header melayang menempel tepat di tepi atas area scroll (menutupi padding), sehingga tidak ada baris yang mengintip di atasnya.
        function fixJadwalStickyOffset() {
            const hdr = document.getElementById('jadwalHeader'); if (!hdr) return;
            const box = hdr.closest('.overflow-y-auto'); if (!box) return;
            const pt = parseFloat(getComputedStyle(box).paddingTop) || 0;
            hdr.style.top = (-pt) + 'px';
            hdr.style.paddingTop = Math.max(pt, 8) + 'px';
        }

        function populateSettingsDropdowns() {
            const t = document.getElementById('jadwalTemplateSelect'), d = document.getElementById('jadwalDaySelect');
            if (!t || !d) return;
            t.innerHTML = [...templates.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>'), '<option value="JADWAL_KHUSUS">JADWAL KHUSUS</option>'].join('');
            const fillDays = () => {
                const names = daysFor(t.value);
                d.innerHTML = names.length ? names.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('') : '<option value="">(belum ada jadwal khusus)</option>';
            };
            t.onchange = () => { fillDays(); renderJadwalTable(); };
            d.onchange = () => renderJadwalTable();
            fillDays();
            renderJadwalTable();
        }

        function rowHTML(jam, belId) {
            return '<div class="jrow" data-jam="' + esc(jam) + '" style="--c:' + belColor(belId) + '">' +
                '<input class="jam-input" type="text" inputmode="numeric" maxlength="5" value="' + esc(jam) + '" data-old="' + esc(jam) + '" aria-label="Jam">' +
                '<select class="jsel bel-select" data-jam="' + esc(jam) + '" aria-label="Bel untuk jam ' + esc(jam) + '">' + belOptionsHTML(belId) + '</select>' +
                '<button type="button" class="jrow-del" data-jam="' + esc(jam) + '" title="Hapus jam ' + esc(jam) + '" aria-label="Hapus jam ' + esc(jam) + '">' +
                    '<svg class="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>' +
                '</button></div>';
        }

        function renderJadwalTable() {
            const box = document.getElementById('jadwalRows'); if (!box) return;
            const { t, d } = currentSched();
            const s = getScheduleObj(t, d, false);
            const keys = schedEntries(s);
            const cnt = document.getElementById('jadwalCount');
            if (cnt) cnt.textContent = d ? (keys.length + ' bel') : '';
            const form = document.getElementById('addRowForm');
            if (form) form.classList.toggle('opacity-50', !d);
            refreshAddBelOptions();
            if (!d) {
                box.innerHTML = '<div class="jempty">Belum ada jadwal khusus. Buat dulu di tab <b>Hari Khusus</b>.</div>';
                return;
            }
            if (!keys.length) {
                box.innerHTML = '<div class="jempty">Belum ada bel di jadwal ini.<br>Isi jam dan pilih bel di atas, lalu tekan <b>+ Tambah</b>, atau gunakan <b>Salin dari\u2026</b>.</div>';
                return;
            }
            const used = new Set();
            let html = keys.map(j => { used.add(belKategori(masterBel.find(b => b && b.id == s[j]))); return rowHTML(j, parseInt(s[j], 10)); }).join('');
            html += '<div class="jlegend">' + Object.keys(BEL_KAT).filter(k => used.has(k)).map(k => '<span><i style="background:' + BEL_KAT[k].color + '"></i>' + esc(BEL_KAT[k].label) + '</span>').join('') + '</div>';
            box.innerHTML = html;
        }

        function flashJadwalRow(jam) {
            const row = document.querySelector('#jadwalRows .jrow[data-jam="' + jam + '"]');
            if (!row) return;
            row.classList.add('flash');
            row.scrollIntoView({ block: 'center', behavior: 'smooth' });
            setTimeout(() => row.classList.remove('flash'), 1500);
        }

        let _refreshPending = false;
        function bindJadwalTab() {
            applyTimeInputMask('jamInput');
            document.getElementById('addRowForm').onsubmit = onAddRow;
            document.getElementById('btnSalinDari').onclick = openSalin;
            document.getElementById('btnTerapkanKe').onclick = openTerapkan;
            document.getElementById('btnKosongkanJadwal').onclick = onKosongkan;
            const rows = document.getElementById('jadwalRows');
            rows.oninput = e => { if (e.target.classList && e.target.classList.contains('jam-input')) maskJamInput(e.target); };
            rows.onkeydown = e => {
                const el = e.target; if (!el.classList || !el.classList.contains('jam-input')) return;
                if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
                else if (e.key === 'Escape') { el.value = el.dataset.old; el.blur(); }
                else if (e.key === 'Backspace' && el.value.endsWith(':')) { e.preventDefault(); el.value = el.value.slice(0, -1); }
            };
            rows.onchange = onRowChange;
            rows.onclick = onRowClick;
            rows.addEventListener('focusout', () => {
                if (!_refreshPending) return;
                setTimeout(() => {
                    const a = document.activeElement;
                    if (a && a.closest && a.closest('#jadwalRows')) return;
                    _refreshPending = false; renderJadwalTable();
                }, 0);
            });
        }

        function onAddRow(e) {
            e.preventDefault();
            const { t, d } = currentSched();
            if (!d) { showToast('Pilih jadwal terlebih dahulu.', 'error'); return; }
            const jamEl = document.getElementById('jamInput'), belEl = document.getElementById('addBelSelect');
            const jam = normalizeJam(jamEl.value);
            if (!jam) { showToast('Format jam salah! Gunakan HH:MM (contoh 07:00).', 'error'); jamEl.focus(); return; }
            const bel = parseInt(belEl.value, 10);
            if (!bel) { showToast('Pilih bel terlebih dahulu.', 'error'); return; }
            const s = getScheduleObj(t, d, true);
            if (!s) { showToast('Jadwal tidak ditemukan.', 'error'); return; }
            if (parseInt(s[jam], 10) > 0) {
                showToast('Jam ' + jam + ' sudah ada di jadwal ini. Ubah belnya langsung pada daftar.', 'error');
                flashJadwalRow(jam); return;
            }
            s[jam] = bel;
            saveConfig();
            jamEl.value = '';
            renderJadwalTable();
            flashJadwalRow(jam);
            showToast('Jam ' + jam + ' ditambahkan', 'success');
            jamEl.focus();
        }

        function onRowChange(e) {
            const el = e.target; if (!el.classList) return;
            const { t, d } = currentSched();
            if (el.classList.contains('jam-input')) {
                const old = el.dataset.old, nj = normalizeJam(el.value);
                if (!nj) { showToast('Format jam salah! Gunakan HH:MM.', 'error'); el.value = old; return; }
                if (nj === old) { el.value = old; return; }
                const s = getScheduleObj(t, d, true);
                if (!s || !(parseInt(s[old], 10) > 0)) { renderJadwalTable(); return; }
                if (parseInt(s[nj], 10) > 0) { showToast('Jam ' + nj + ' sudah ada di jadwal ini.', 'error'); el.value = old; return; }
                s[nj] = s[old]; delete s[old];
                saveConfig();
                renderJadwalTable();
                flashJadwalRow(nj);
            } else if (el.classList.contains('bel-select')) {
                const jam = el.dataset.jam, b = parseInt(el.value, 10);
                if (!b) return;
                const s = getScheduleObj(t, d, true);
                if (!s) return;
                s[jam] = b;
                saveConfig();
                const row = el.closest('.jrow');
                if (row) row.style.setProperty('--c', belColor(b));
            }
        }

        async function onRowClick(e) {
            const btn = e.target.closest ? e.target.closest('.jrow-del') : null;
            if (!btn) return;
            const jam = btn.dataset.jam, { t, d } = currentSched();
            const s0 = getScheduleObj(t, d, false); if (!s0) return;
            const bel = masterBel.find(b => b && b.id == s0[jam]);
            const ok = await askConfirm({
                title: 'Hapus jam ini?',
                html: 'Hapus jam <b>' + esc(jam) + '</b> (' + esc(bel ? bel.nama : 'bel') + ') dari jadwal <b>' + esc(schedTitle(t, d)) + '</b>?' +
                      '<br><span class="text-xs text-slate-500">Hanya jadwal ini yang berubah, jadwal lain tidak terpengaruh.</span>',
                okText: 'Hapus'
            });
            if (!ok) return;
            const s = getScheduleObj(t, d, false);
            if (s) delete s[jam];
            saveConfig();
            renderJadwalTable();
            showToast('Jam ' + jam + ' dihapus', 'success');
        }

        async function onKosongkan() {
            const { t, d } = currentSched();
            const s0 = getScheduleObj(t, d, false);
            const n = schedEntries(s0).length;
            if (!d || !n) { showToast('Jadwal ini sudah kosong.', 'info'); return; }
            const ok = await askConfirm({
                title: 'Kosongkan jadwal?',
                html: 'Semua <b>' + n + ' bel</b> pada jadwal <b>' + esc(schedTitle(t, d)) + '</b> akan dihapus.',
                okText: 'Kosongkan'
            });
            if (!ok) return;
            const s = getScheduleObj(t, d, true);
            if (s) Object.keys(s).forEach(k => delete s[k]);
            saveConfig();
            renderJadwalTable();
            showToast('Jadwal ' + d + ' dikosongkan', 'success');
        }

        // ---------- Salin dari ----------
        let _salin = null;
        function fillSalinDays(preferDay) {
            const st = document.getElementById('salinTemplate'), sd = document.getElementById('salinDay');
            const names = daysFor(st.value).filter(n => !(_salin && st.value === _salin.t && n === _salin.d));
            sd.innerHTML = names.length ? names.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('') : '<option value="">(tidak ada pilihan)</option>';
            if (preferDay && names.includes(preferDay)) sd.value = preferDay;
        }
        function updateSalinInfo() {
            const st = document.getElementById('salinTemplate'), sd = document.getElementById('salinDay');
            const info = document.getElementById('salinInfo'), ok = document.getElementById('salinOkBtn');
            const n = sd.value ? countSched(st.value, sd.value) : 0;
            info.textContent = !sd.value ? 'Pilih jadwal sumber.' : (n ? (n + ' bel akan disalin.') : 'Jadwal sumber masih kosong.');
            ok.disabled = !n;
        }
        function openSalin() {
            const { t, d } = currentSched();
            if (!d) { showToast('Pilih jadwal tujuan terlebih dahulu.', 'error'); return; }
            _salin = { t, d };
            document.getElementById('salinTarget').textContent = schedTitle(t, d);
            const st = document.getElementById('salinTemplate');
            st.innerHTML = [...templates.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>'), '<option value="JADWAL_KHUSUS">JADWAL KHUSUS</option>'].join('');
            st.value = t;
            st.onchange = () => { fillSalinDays(); updateSalinInfo(); };
            document.getElementById('salinDay').onchange = updateSalinInfo;
            fillSalinDays();
            updateSalinInfo();
            document.querySelector('input[name="salinMode"][value="replace"]').checked = true;
            showModal('salin');
        }
        async function doSalin() {
            if (!_salin) return;
            const { t, d } = _salin;
            const st = document.getElementById('salinTemplate').value, sd = document.getElementById('salinDay').value;
            const mode = document.querySelector('input[name="salinMode"]:checked').value;
            const src = getScheduleObj(st, sd, false);
            const keys = schedEntries(src);
            if (!keys.length) { showToast('Jadwal sumber kosong.', 'error'); return; }
            const existing = countSched(t, d);
            if (mode === 'replace' && existing) {
                const ok = await askConfirm({
                    title: 'Gantikan jadwal?',
                    html: 'Jadwal <b>' + esc(schedTitle(t, d)) + '</b> sudah berisi <b>' + existing + ' bel</b> dan akan diganti dengan <b>' + keys.length + ' bel</b> dari <b>' + esc(schedTitle(st, sd)) + '</b>.',
                    okText: 'Ya, gantikan'
                });
                if (!ok) return;
            }
            const copy = {}; keys.forEach(k => { copy[k] = src[k]; });
            const target = getScheduleObj(t, d, true);
            if (!target) { showToast('Jadwal tujuan tidak ditemukan.', 'error'); return; }
            if (mode === 'replace') Object.keys(target).forEach(k => delete target[k]);
            Object.assign(target, copy);
            saveConfig();
            hideModal('salin');
            renderJadwalTable();
            showToast(keys.length + ' bel disalin ke ' + d, 'success');
        }

        // ---------- Terapkan ke jadwal lain ----------
        let _terapkan = null;
        function listTargets(exceptT, exceptD) {
            const groups = [];
            templates.forEach(tp => {
                const items = jadwalUtama.filter(dd => !(tp === exceptT && dd === exceptD)).map(dd => ({ t: tp, d: dd, n: countSched(tp, dd) }));
                if (items.length) groups.push({ label: tp, items });
            });
            const kh = jadwalKhusus.filter(k => !(exceptT === 'JADWAL_KHUSUS' && k.nama === exceptD)).map(k => ({ t: 'JADWAL_KHUSUS', d: k.nama, n: countSched('JADWAL_KHUSUS', k.nama) }));
            if (kh.length) groups.push({ label: 'Jadwal Khusus', items: kh });
            return groups;
        }
        function updateTerapkanInfo() {
            const checked = [...document.querySelectorAll('#terapkanList .tchk:checked')];
            const filled = checked.filter(c => _terapkan.flat[+c.dataset.i].n > 0).length;
            document.getElementById('terapkanInfo').textContent = checked.length
                ? (checked.length + ' jadwal dipilih' + (filled ? (', ' + filled + ' di antaranya sudah berisi') : '') + '.')
                : 'Belum ada jadwal dipilih.';
            document.getElementById('terapkanOkBtn').disabled = !checked.length;
        }
        function openTerapkan() {
            const { t, d } = currentSched();
            const n = countSched(t, d);
            if (!d || !n) { showToast('Jadwal ini masih kosong, tidak ada yang bisa diterapkan.', 'warning'); return; }
            const groups = listTargets(t, d);
            if (!groups.length) { showToast('Tidak ada jadwal lain sebagai tujuan.', 'info'); return; }
            const flat = []; let html = '';
            groups.forEach((g, gi) => {
                html += '<details class="tgroup"' + (g.label === t || (t === 'JADWAL_KHUSUS' && g.label === 'Jadwal Khusus') ? ' open' : '') + '><summary><span>' + esc(g.label) + '</span>' +
                    '<label class="tall"><input type="checkbox" class="tgrp" data-g="' + gi + '"> Semua</label></summary><div class="tbody">';
                g.items.forEach(it => {
                    html += '<label class="titem"><input type="checkbox" class="tchk" data-i="' + flat.length + '" data-g="' + gi + '"> <span>' + esc(it.d) + '</span><em>' + (it.n ? it.n + ' bel' : 'kosong') + '</em></label>';
                    flat.push(it);
                });
                html += '</div></details>';
            });
            _terapkan = { t, d, flat };
            document.getElementById('terapkanSource').textContent = schedTitle(t, d) + ' (' + n + ' bel)';
            const list = document.getElementById('terapkanList');
            list.innerHTML = html;
            list.onchange = ev => {
                const el = ev.target;
                if (el.classList.contains('tgrp')) list.querySelectorAll('.tchk[data-g="' + el.dataset.g + '"]').forEach(c => { c.checked = el.checked; });
                updateTerapkanInfo();
            };
            document.querySelector('input[name="terapkanMode"][value="replace"]').checked = true;
            updateTerapkanInfo();
            showModal('terapkan');
        }
        async function doTerapkan() {
            if (!_terapkan) return;
            const { t, d, flat } = _terapkan;
            const targets = [...document.querySelectorAll('#terapkanList .tchk:checked')].map(c => flat[+c.dataset.i]);
            if (!targets.length) return;
            const mode = document.querySelector('input[name="terapkanMode"]:checked').value;
            const src = getScheduleObj(t, d, false), keys = schedEntries(src);
            if (!keys.length) { showToast('Jadwal sumber kosong.', 'error'); return; }
            const filled = targets.filter(x => x.n > 0).length;
            const ok = await askConfirm({
                title: 'Terapkan jadwal?',
                html: 'Jadwal <b>' + esc(schedTitle(t, d)) + '</b> (' + keys.length + ' bel) akan ' + (mode === 'replace' ? 'menggantikan' : 'digabungkan ke') + ' <b>' + targets.length + ' jadwal</b>' +
                      (mode === 'replace' && filled ? '<br><span class="text-xs text-red-600">' + filled + ' di antaranya sudah berisi dan isinya akan hilang.</span>' : '') + '.',
                okText: 'Terapkan', danger: mode === 'replace' && filled > 0
            });
            if (!ok) return;
            const copy = {}; keys.forEach(k => { copy[k] = src[k]; });
            targets.forEach(x => {
                const target = getScheduleObj(x.t, x.d, true); if (!target) return;
                if (mode === 'replace') Object.keys(target).forEach(k => delete target[k]);
                Object.assign(target, copy);
            });
            saveConfig();
            hideModal('terapkan');
            renderJadwalTable();
            showToast('Jadwal diterapkan ke ' + targets.length + ' jadwal', 'success');
        }

        // ---------- Dialog konfirmasi umum ----------
        let _confirmResolve = null;
        function askConfirm(opt) {
            const o = Object.assign({ title: 'Konfirmasi', html: '', okText: 'Ya', danger: true }, opt || {});
            return new Promise(res => {
                if (_confirmResolve) _confirmResolve(false);
                _confirmResolve = res;
                document.getElementById('confirmTitle').textContent = o.title;
                document.getElementById('confirmBody').innerHTML = o.html;
                const ok = document.getElementById('confirmOkBtn');
                ok.textContent = o.okText;
                ok.className = 'btn w-full border-0 text-white ' + (o.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-600 hover:bg-orange-700');
                showModal('confirm');
            });
        }
        function _closeConfirm(v) {
            hideModal('confirm');
            if (_confirmResolve) { const r = _confirmResolve; _confirmResolve = null; r(v); }
        }

        // ---------- Jadwal Mendatang: atur Jadwal 1, Jadwal 2, atau keduanya ----------
        // Jadwal 1: 'khusus' (selama rentang tanggal) atau 'template' (ganti template permanen dari tanggal mulai).
        // Jadwal 2: berlaku selama rentang tanggal (default 1 hari), lalu mati. Yang tidak diatur tetap otomatis (Jadwal 1 mengikuti hari).
        function secondDaysFor(tv) { return tv === 'KHUSUS' ? jadwalKhusus.map(j => j.nama) : jadwalUtama; }
        function secondLabel(sec) { return sec.isKhusus ? ('Khusus: ' + sec.day) : (sec.template + ' \u2022 ' + sec.day); }
        function mendatangSec(j) { return (j && j.second && j.second.day) ? j.second : null; }
        function mendatangHasPrimary(j) { return !!(j && j.type && j.value); }
        function mendatangEnd(j) { return (j && j.endDate && j.endDate > j.date) ? j.endDate : j.date; }
        function mendatangInRange(j, d) { return d >= j.date && d <= mendatangEnd(j); }
        function mendatangDateObj(s) { const p = String(s).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); }
        function mendatangDays(j) { return Math.round((mendatangDateObj(mendatangEnd(j)) - mendatangDateObj(j.date)) / 86400000) + 1; }
        function mendatangRangeText(j) {
            const o = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
            const a = mendatangDateObj(j.date).toLocaleDateString('id-ID', o);
            if (mendatangEnd(j) === j.date) return a;
            return a + ' s/d ' + mendatangDateObj(mendatangEnd(j)).toLocaleDateString('id-ID', o) + ' (' + mendatangDays(j) + ' hari)';
        }
        function mendatangTitle(j) { if (mendatangHasPrimary(j)) return j.value; const s = mendatangSec(j); return s ? secondLabel(s) : '-'; }
        function mendatangBadges(j) {
            const a = [];
            if (mendatangHasPrimary(j)) a.push(j.type === 'khusus' ? '\u2605 Jadwal 1: Khusus' : '\uD83D\uDD04 Jadwal 1: Ganti Template');
            const s = mendatangSec(j); if (s) a.push('\u2795 Jadwal 2: ' + secondLabel(s));
            if (mendatangEnd(j) > j.date) a.push('\uD83D\uDCC5 ' + mendatangDays(j) + ' hari');
            return a.join(' \u00B7 ');
        }
        function mendatangTypeLabel(j) {
            const p = mendatangHasPrimary(j), s = !!mendatangSec(j);
            if (p && s) return 'Jadwal 1 + Jadwal 2';
            if (p) return j.type === 'khusus' ? 'Jadwal 1 \u00B7 Khusus' : 'Jadwal 1 \u00B7 Ganti Template';
            return 'Jadwal 2';
        }
        function mendatangDetailHtml(j) {
            let h = '';
            if (mendatangHasPrimary(j)) h += '<p class="text-sm font-semibold text-slate-600 mt-1">\u2192 Jadwal 1: ' + (j.type === 'khusus' ? 'Khusus \u2013 ' : 'Ganti template \u2013 ') + esc(j.value) + '</p>';
            else h += '<p class="text-xs text-slate-500 mt-1">Jadwal 1: otomatis sesuai hari</p>';
            const s = mendatangSec(j);
            if (s) h += '<p class="text-xs font-bold text-indigo-600 mt-0.5">+ Jadwal 2: ' + esc(secondLabel(s)) + '</p>';
            return h;
        }
        function updateMendatangOptions() {
            const t = document.getElementById('mendatangType'), v = document.getElementById('mendatangValue'); if (!t || !v) return;
            if (t.value === 'template') v.innerHTML = templates.map(x => '<option value="' + esc(x) + '">' + esc(x) + '</option>').join('');
            else v.innerHTML = jadwalKhusus.length ? jadwalKhusus.map(k => '<option value="' + esc(k.nama) + '">' + esc(k.nama) + '</option>').join('') : '<option value="">-- Belum Ada Jadwal Khusus --</option>';
        }
        function fillMendatangSecondDays(keep) {
            const tp = document.getElementById('mendatangSecondTemplate'), dy = document.getElementById('mendatangSecondDay');
            if (!tp || !dy) return;
            const names = secondDaysFor(tp.value);
            dy.innerHTML = names.length ? names.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('') : '<option value="">(belum ada jadwal khusus)</option>';
            if (typeof keep === 'string' && names.includes(keep)) dy.value = keep;
        }
        function syncMendatangUI() {
            const p = document.getElementById('mendatangPrimaryOn'), s = document.getElementById('mendatangSecondOn');
            const pf = document.getElementById('mendatangPrimaryFields'), sf = document.getElementById('mendatangSecondFields');
            if (p && pf) pf.classList.toggle('hidden', !p.checked);
            if (s && sf) sf.classList.toggle('hidden', !s.checked);
        }
        function ensureMendatangSecondFields() {
            if (document.getElementById('mendatangFieldsWrap')) return;
            const holder = document.querySelector('#formMendatang .space-y-4'); if (!holder) return;
            const cls = 'w-full bg-white border border-slate-300 text-slate-800 p-3 rounded-md outline-none focus:ring-2 focus:ring-orange-300';
            const div = document.createElement('div');
            div.id = 'mendatangFieldsWrap'; div.className = 'space-y-3';
            div.innerHTML =
                '<div class="rounded-lg border border-slate-200 bg-slate-50 p-3">' +
                    '<label class="flex items-start gap-2 font-semibold text-slate-700 cursor-pointer"><input type="checkbox" id="mendatangPrimaryOn" class="mt-1 w-4 h-4"> <span>Atur Jadwal 1 (utama)<br><span class="text-xs font-normal text-slate-500">Jika tidak dicentang, Jadwal 1 tetap otomatis mengikuti hari.</span></span></label>' +
                    '<div id="mendatangPrimaryFields" class="hidden mt-3 space-y-2">' +
                        '<select id="mendatangType" class="' + cls + '"><option value="khusus">Terapkan Jadwal Khusus (Selama Rentang Tanggal)</option><option value="template">Ubah Template Utama (Permanen dari tgl tsb)</option></select>' +
                        '<select id="mendatangValue" class="' + cls + '"></select>' +
                    '</div>' +
                '</div>' +
                '<div class="rounded-lg border border-slate-200 bg-slate-50 p-3">' +
                    '<label class="flex items-start gap-2 font-semibold text-slate-700 cursor-pointer"><input type="checkbox" id="mendatangSecondOn" class="mt-1 w-4 h-4"> <span>Atur Jadwal 2<br><span class="text-xs font-normal text-slate-500">Hanya berlaku pada tanggal/rentang tersebut, lalu otomatis mati.</span></span></label>' +
                    '<div id="mendatangSecondFields" class="hidden mt-3 space-y-2">' +
                        '<select id="mendatangSecondTemplate" class="' + cls + '"></select>' +
                        '<select id="mendatangSecondDay" class="' + cls + '"></select>' +
                    '</div>' +
                '</div>';
            holder.appendChild(div);
            const rng = document.createElement('div');
            rng.id = 'mendatangRangeWrap';
            rng.innerHTML =
                '<label class="block text-sm font-semibold text-slate-700 mb-1">Sampai Tanggal (opsional)</label>' +
                '<input type="date" id="mendatangEndDate" class="w-full bg-slate-50 border border-slate-300 text-slate-800 p-3 rounded-md focus:ring-2 focus:ring-orange-300 outline-none">' +
                '<p class="text-xs text-slate-500 mt-1">Kosongkan jika hanya 1 hari. Rentang (mis. 2\u20133 hari berturut-turut) berlaku untuk Jadwal Khusus dan Jadwal 2. Ganti Template tetap permanen sejak tanggal mulai.</p>';
            holder.insertBefore(rng, div);
            const sd = document.getElementById('mendatangDate');
            const firstLabel = holder.querySelector('label'); if (firstLabel) firstLabel.textContent = 'Tanggal Mulai';
            sd.addEventListener('change', () => { const e = document.getElementById('mendatangEndDate'); e.min = sd.value || ''; if (e.value && sd.value && e.value < sd.value) e.value = ''; });
            document.getElementById('mendatangPrimaryOn').onchange = syncMendatangUI;
            document.getElementById('mendatangSecondOn').onchange = syncMendatangUI;
            document.getElementById('mendatangType').onchange = updateMendatangOptions;
            document.getElementById('mendatangSecondTemplate').onchange = () => fillMendatangSecondDays();
        }
        // Dipanggil saat form dibuka: item = null (baru) atau jadwal mendatang yang diedit.
        function fillMendatangSecond(item) {
            ensureMendatangSecondFields();
            const tp = document.getElementById('mendatangSecondTemplate'); if (!tp) return;
            const hasP = item ? mendatangHasPrimary(item) : true, sec = item ? mendatangSec(item) : null;
            document.getElementById('mendatangPrimaryOn').checked = hasP;
            document.getElementById('mendatangSecondOn').checked = !!sec;
            document.getElementById('mendatangType').value = (item && item.type) || 'khusus';
            updateMendatangOptions();
            if (item && item.value) document.getElementById('mendatangValue').value = item.value;
            tp.innerHTML = [...templates, 'KHUSUS'].map(v => '<option value="' + esc(v) + '">' + esc(v === 'KHUSUS' ? 'JADWAL KHUSUS' : v) + '</option>').join('');
            tp.value = sec ? (sec.isKhusus ? 'KHUSUS' : sec.template) : templates[0];
            fillMendatangSecondDays(sec ? sec.day : null);
            const ee = document.getElementById('mendatangEndDate');
            if (ee) { ee.value = (item && item.endDate) || ''; ee.min = document.getElementById('mendatangDate').value || ''; }
            syncMendatangUI();
        }
        // false = input salah (toast sudah tampil); objek berisi hanya bagian yang diatur: {type, value} dan/atau {second}
        function readMendatangFields() {
            const pOn = document.getElementById('mendatangPrimaryOn'), sOn = document.getElementById('mendatangSecondOn');
            if (!pOn || !sOn) return false;
            if (!pOn.checked && !sOn.checked) { showToast('Centang minimal satu: Jadwal 1 atau Jadwal 2.', 'error'); return false; }
            const r = {};
            if (pOn.checked) {
                const type = document.getElementById('mendatangType').value, value = document.getElementById('mendatangValue').value;
                if (!value) { showToast('Pilih jadwal/template untuk Jadwal 1 terlebih dahulu!', 'error'); return false; }
                r.type = type; r.value = value;
            }
            if (sOn.checked) {
                const tv = document.getElementById('mendatangSecondTemplate').value, day = document.getElementById('mendatangSecondDay').value;
                if (!day) { showToast('Pilih jadwal untuk Jadwal 2 (atau hapus centangnya).', 'error'); return false; }
                r.second = { template: tv, day: day, isKhusus: tv === 'KHUSUS' };
            }
            const sd = document.getElementById('mendatangDate').value, ed = (document.getElementById('mendatangEndDate') || {}).value;
            if (ed) {
                if (sd && ed < sd) { showToast('Tanggal akhir tidak boleh sebelum tanggal mulai.', 'error'); return false; }
                if (ed > sd) r.endDate = ed;
            }
            return r;
        }


        // Dipakai bersama oleh desktop & web: aturan penerapan jadwal mendatang HARUS sama.
        function checkJadwalMendatang(todayStr, noSave) {
            if (typeof lastCheckedDate !== 'undefined' && lastCheckedDate !== todayStr) {
                lastCheckedDate = todayStr;
                if (typeof isDataLoaded !== 'undefined' && isDataLoaded && typeof scheduleNextBell === 'function') scheduleNextBell();
            }
            let changed = false;
            [...jadwalMendatang].sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach(evt => {
                if (evt.date > todayStr) return;
                const end = mendatangEnd(evt);
                const legacyDone = evt.applied && !evt.endDate; // jadwal 1 hari yang sudah diproses
                // Jadwal 1 - ganti template: sekali saja, permanen sejak tanggal mulai.
                if (evt.type === 'template' && !evt.applied) { savedTemplate = evt.value; evt.applied = true; changed = true; }
                // Jadwal 1 khusus & Jadwal 2: berlaku pada setiap hari dalam rentang tanggal.
                const hasDaily = evt.type === 'khusus' || !!mendatangSec(evt); // ganti-template cukup sekali, tidak perlu simpan ulang tiap hari
                if (hasDaily && !legacyDone && todayStr <= end && evt.lastApplied !== todayStr) {
                    if (evt.type === 'khusus') {
                        temporaryOverride = { date: todayStr, name: evt.value };
                        manualDayOverride = null;
                    }
                    const sec = mendatangSec(evt);
                    if (sec) secondSchedule = { active: true, template: sec.template, day: sec.day, isKhusus: !!sec.isKhusus, date: todayStr };
                    evt.lastApplied = todayStr; changed = true;
                }
                // Tandai selesai bila rentang sudah berakhir.
                if (!evt.applied && todayStr >= end) { evt.applied = true; changed = true; }
            });
            if (changed && !noSave) saveConfig();
            return changed;
        }

        // ---------- Status sinkronisasi ----------
        let syncStatus = { state: 'idle', at: null, note: '' };
        function syncMe() { return document.getElementById('conn-status') ? 'desktop' : 'web'; }
        function remoteNote(data) {
            const by = data && data.lastUpdatedBy;
            return (by && by !== syncMe()) ? ('Diperbarui dari ' + (by === 'web' ? 'Web' : 'Desktop')) : '';
        }
        function setSyncStatus(state, note) {
            syncStatus = { state: state, at: Date.now(), note: note || '' };
            renderSyncBadge();
        }
        function renderSyncBadge() {
            const s = syncStatus;
            const hhmm = new Date(s.at || Date.now()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\./g, ':');
            const map = {
                idle:    ['bg-gray-400', 'Menunggu data'],
                saving:  ['bg-amber-400 animate-pulse', 'Menyimpan\u2026'],
                synced:  ['bg-green-500', (s.note ? s.note : 'Tersinkron') + ' ' + hhmm],
                pending: ['bg-amber-500', 'Belum terkirim (menunggu koneksi)'],
                offline: ['bg-red-500', 'Offline'],
                error:   ['bg-red-500', 'Gagal sinkron' + (s.note ? ': ' + s.note : '')]
            };
            const m = map[s.state] || map.idle;
            document.querySelectorAll('.sync-badge').forEach(el => {
                el.innerHTML = '<span class="w-2 h-2 rounded-full flex-shrink-0 ' + m[0] + '"></span><span class="truncate">' + esc(m[1]) + '</span>';
                el.title = 'Status sinkronisasi: ' + m[1];
            });
        }
        function ensureSyncBadge() {
            if (document.getElementById('sync-badge-main')) return;
            const span = document.createElement('span');
            span.id = 'sync-badge-main';
            span.className = 'sync-badge sync-pill';
            const conn = document.getElementById('conn-status');
            if (conn) {
                span.className += ' border-l border-slate-700 pl-4';
                conn.insertAdjacentElement('afterend', span);
            } else {
                const bar = document.getElementById('server-status-bar');
                const right = bar && bar.lastElementChild;
                if (right) right.insertBefore(span, right.firstChild);
            }
            renderSyncBadge();
        }

        // ---------- Segarkan Pengaturan yang sedang terbuka (perubahan dari sisi lain) ----------
        function refreshSettingsIfOpen() {
            const m = document.getElementById('settingsModal');
            if (!m || !m.classList.contains('visible')) return;
            try {
                renderHariList(); renderBelList(); renderJadwalMendatangList();
                const t = document.getElementById('jadwalTemplateSelect'), d = document.getElementById('jadwalDaySelect');
                if (t && d) {
                    const keepD = d.value;
                    const names = daysFor(t.value);
                    d.innerHTML = names.length ? names.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('') : '<option value="">(belum ada jadwal khusus)</option>';
                    if (names.includes(keepD)) d.value = keepD;
                    const a = document.activeElement;
                    if (a && a.closest && a.closest('#jadwalRows')) { _refreshPending = true; return; }
                    renderJadwalTable();
                }
            } catch (e) { console.error('Gagal menyegarkan Pengaturan:', e); }
        }

        // ---------- Rename / hapus jadwal khusus: semua rujukan ikut diperbarui ----------
        function renameKhusus(oldN, newN) {
            jadwalMendatang.forEach(j => {
                if (j.type === 'khusus' && j.value === oldN) j.value = newN;
                if (j.second && j.second.isKhusus && j.second.day === oldN) j.second.day = newN;
            });
            if (temporaryOverride && temporaryOverride.name === oldN) temporaryOverride.name = newN;
            if (secondSchedule.isKhusus && secondSchedule.day === oldN) secondSchedule.day = newN;
        }
        function removeKhusus(nama) {
            jadwalMendatang.forEach(j => { if (j.type === 'khusus' && j.value === nama) { delete j.type; delete j.value; } if (j.second && j.second.isKhusus && j.second.day === nama) delete j.second; });
            jadwalMendatang = jadwalMendatang.filter(j => mendatangHasPrimary(j) || mendatangSec(j));
            if (temporaryOverride && temporaryOverride.name === nama) temporaryOverride = { date: null, name: null };
            if (secondSchedule.isKhusus && secondSchedule.day === nama) { secondSchedule.active = false; secondSchedule.isKhusus = false; secondSchedule.template = 'HARI NORMAL'; secondSchedule.day = 'Senin'; secondSchedule.date = null; }
        }

        // ---------- Pasang CSS, dialog, dan lencana status (sekali) ----------
        function injectJadwalUiOnce() {
            if (document.getElementById('jadwal-ui-style')) return;
            const st = document.createElement('style');
            st.id = 'jadwal-ui-style';
            st.textContent = [
                '.jadwal-sticky{position:sticky;top:0;z-index:5;background:#fff;padding:.75rem 0;border-bottom:1px solid #e2e8f0;box-shadow:0 8px 10px -8px rgba(15,23,42,.28)}',
                '.jsel{width:100%;min-width:0;background-color:#fff;border:1px solid #cbd5e1;border-radius:.5rem;padding:.5rem .6rem;font-weight:600;color:#334155;outline:none}',
                '.jsel:focus{box-shadow:0 0 0 2px #fed7aa;border-color:#fb923c}',
                '.jam-input{width:5.2rem;flex:none;text-align:center;font-weight:800;font-size:1rem;padding:.5rem .25rem;border:1px solid #cbd5e1;border-radius:.5rem;background:#fff;color:#1e293b;font-variant-numeric:tabular-nums;outline:none}',
                '.jam-input:focus{box-shadow:0 0 0 2px #fed7aa;border-color:#fb923c}',
                '.jbtn{background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;border-radius:.5rem;padding:.45rem .8rem;font-weight:700;font-size:.8rem;white-space:nowrap;transition:background .15s}',
                '.jbtn:hover{background:#e2e8f0}',
                '.jbtn-primary{background:#ea580c;border-color:#c2410c;color:#fff;font-size:.9rem}',
                '.jbtn-primary:hover{background:#c2410c}',
                '.jbtn-danger{background:#fef2f2;border-color:#fecaca;color:#dc2626}',
                '.jbtn-danger:hover{background:#fee2e2}',
                '.jcount{font-size:.8rem;font-weight:800;color:#ea580c;background:#fff7ed;border:1px solid #fed7aa;border-radius:999px;padding:.15rem .6rem}',
                '.jrow{display:flex;align-items:center;gap:.5rem;padding:.4rem .5rem .4rem .6rem;border:1px solid #e2e8f0;border-left:5px solid var(--c,#94a3b8);border-radius:.6rem;background:#fff}',
                '.jrow:hover{background:#f8fafc}',
                '.jrow.flash{animation:jflash 1.4s ease}',
                '@keyframes jflash{0%{background:#fde047}100%{background:#fff}}',
                '.jrow .bel-select{flex:1}',
                '.jrow-del{flex:none;display:flex;align-items:center;justify-content:center;width:2.4rem;height:2.4rem;border-radius:.5rem;color:#ef4444;border:1px solid transparent}',
                '.jrow-del:hover{background:#fef2f2;border-color:#fecaca}',
                '.jempty{text-align:center;color:#64748b;font-style:italic;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:.6rem;padding:1.5rem 1rem}',
                '.jlegend{display:flex;flex-wrap:wrap;gap:.25rem .9rem;padding-top:.5rem;font-size:.72rem;color:#64748b}',
                '.jlegend i{display:inline-block;width:.7rem;height:.7rem;border-radius:3px;margin-right:.3rem;vertical-align:-1px}',
                '.sync-pill{display:inline-flex;align-items:center;gap:.4rem;font-size:.72rem;font-weight:700;min-width:0;max-width:100%}',
                '.tgroup{border:1px solid #e2e8f0;border-radius:.6rem;margin-bottom:.5rem;background:#fff}',
                '.tgroup>summary{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.55rem .75rem;font-weight:700;color:#334155;cursor:pointer}',
                '.tgroup .tall{font-size:.75rem;font-weight:600;color:#64748b;display:flex;align-items:center;gap:.3rem;cursor:pointer}',
                '.tgroup .tbody{padding:.1rem .75rem .6rem;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.25rem .75rem}',
                '.titem{display:flex;align-items:center;gap:.4rem;font-size:.9rem;color:#334155;cursor:pointer;padding:.2rem 0}',
                '.titem em{margin-left:auto;font-style:normal;font-size:.7rem;color:#94a3b8}',
                '@media (min-width:768px){#tab-content-jadwal{padding-right:3rem}}',
                '.settings-offline main>.flex-grow{pointer-events:none;opacity:.5;filter:grayscale(.4)}',
                '.settings-offline-banner{flex:none;background:#fef3c7;color:#92400e;border-bottom:1px solid #fcd34d;padding:.55rem 1rem;font-size:.8rem;font-weight:700;text-align:center}',
                '@media (max-width:420px){.jbtn{padding:.4rem .6rem}.jam-input{width:4.6rem}}'
            ].join('\n');
            document.head.appendChild(st);

            // Modul lama (Master Jam) dibuang bila masih ada di HTML
            ['editJamModal', 'deleteJamModal', 'tab-content-jam'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
            document.querySelectorAll('.settings-nav-btn[data-tab="jam"]').forEach(b => b.remove());
            delete MODALS.editJam; delete MODALS.deleteJam;

            const wrap = document.createElement('div');
            wrap.innerHTML =
                '<div id="confirmModal" class="modal-backdrop" style="z-index:60"><div class="card w-full max-w-sm p-6 text-center">' +
                    '<h3 id="confirmTitle" class="text-xl font-bold mb-3 text-slate-800">Konfirmasi</h3>' +
                    '<div id="confirmBody" class="mb-5 text-sm text-slate-600"></div>' +
                    '<div class="flex gap-3"><button type="button" id="confirmCancelBtn" class="btn w-full">Batal</button>' +
                    '<button type="button" id="confirmOkBtn" class="btn w-full border-0 text-white bg-red-600 hover:bg-red-700">Ya</button></div>' +
                '</div></div>' +
                '<div id="salinModal" class="modal-backdrop"><div class="card w-full max-w-md p-6 overflow-y-auto max-h-[90vh]">' +
                    '<h3 class="text-xl font-bold mb-1 text-slate-800">Salin jadwal dari\u2026</h3>' +
                    '<p class="text-sm text-slate-500 mb-4">Tujuan: <b id="salinTarget" class="text-slate-700"></b></p>' +
                    '<div class="space-y-3"><select id="salinTemplate" class="jsel"></select><select id="salinDay" class="jsel"></select>' +
                    '<p id="salinInfo" class="text-sm font-semibold text-slate-600"></p>' +
                    '<div class="space-y-2 text-sm text-slate-700">' +
                        '<label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="salinMode" value="replace" checked> Gantikan seluruh jadwal tujuan</label>' +
                        '<label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="salinMode" value="merge"> Gabungkan (jam yang sama ditimpa)</label>' +
                    '</div></div>' +
                    '<div class="flex gap-3 mt-6"><button type="button" id="salinCancelBtn" class="btn w-full">Batal</button>' +
                    '<button type="button" id="salinOkBtn" class="btn bg-orange-600 text-white w-full border-0 hover:bg-orange-700">Salin</button></div>' +
                '</div></div>' +
                '<div id="terapkanModal" class="modal-backdrop"><div class="card w-full max-w-lg p-6 flex flex-col max-h-[90vh]">' +
                    '<h3 class="text-xl font-bold mb-1 text-slate-800">Terapkan ke jadwal lain</h3>' +
                    '<p class="text-sm text-slate-500 mb-3">Sumber: <b id="terapkanSource" class="text-slate-700"></b></p>' +
                    '<div id="terapkanList" class="flex-1 overflow-y-auto min-h-0 pr-1"></div>' +
                    '<p id="terapkanInfo" class="text-sm font-semibold text-slate-600 mt-3"></p>' +
                    '<div class="space-y-2 text-sm text-slate-700 mt-2">' +
                        '<label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="terapkanMode" value="replace" checked> Gantikan isi jadwal tujuan</label>' +
                        '<label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="terapkanMode" value="merge"> Gabungkan (jam yang sama ditimpa)</label>' +
                    '</div>' +
                    '<div class="flex gap-3 mt-4"><button type="button" id="terapkanCancelBtn" class="btn w-full">Batal</button>' +
                    '<button type="button" id="terapkanOkBtn" class="btn bg-orange-600 text-white w-full border-0 hover:bg-orange-700">Terapkan</button></div>' +
                '</div></div>';
            while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
            MODALS.confirm = 'confirmModal'; MODALS.salin = 'salinModal'; MODALS.terapkan = 'terapkanModal';

            document.getElementById('confirmOkBtn').onclick = () => _closeConfirm(true);
            document.getElementById('confirmCancelBtn').onclick = () => _closeConfirm(false);
            document.getElementById('salinOkBtn').onclick = doSalin;
            document.getElementById('salinCancelBtn').onclick = () => hideModal('salin');
            document.getElementById('terapkanOkBtn').onclick = doTerapkan;
            document.getElementById('terapkanCancelBtn').onclick = () => hideModal('terapkan');
            document.addEventListener('keydown', e => {
                if (e.key === 'Escape' && document.getElementById('confirmModal').classList.contains('visible')) _closeConfirm(false);
            });
            window.addEventListener('resize', fixJadwalStickyOffset);
            ensureSyncBadge();
        }
        injectJadwalUiOnce();


        // ===================== PWA =====================
        let deferredInstall = null, appReady = false, bannerOpen = false;
        const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
        const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        function installDismissed() { try { return Date.now() - Number(localStorage.getItem('installDismissedAt') || 0) < 7 * 864e5; } catch (e) { return false; } }
        function canInstall() { return appReady && !isStandalone() && (!!deferredInstall || isIOS()); }
        function updateInstallTop() { const t = document.getElementById('btnInstallTop'); if (t) t.classList.toggle('hidden', !(canInstall() && !bannerOpen)); }
        function openInstallBanner() {
            if (!canInstall()) return;
            const btn = document.getElementById('installBtn'), hint = document.getElementById('installHint');
            if (deferredInstall) { btn.classList.remove('hidden'); hint.textContent = 'Buka cepat dari layar utama HP.'; }
            else { btn.classList.add('hidden'); hint.textContent = 'Ketuk tombol Bagikan, lalu pilih "Tambah ke Layar Utama".'; }
            document.getElementById('installBanner').classList.remove('hidden'); bannerOpen = true; updateInstallTop();
        }
        function closeInstallBanner(remember) {
            document.getElementById('installBanner').classList.add('hidden'); bannerOpen = false;
            if (remember) { try { localStorage.setItem('installDismissedAt', String(Date.now())); } catch (e) {} }
            updateInstallTop();
        }
        function maybeShowInstall() { if (canInstall() && !installDismissed()) openInstallBanner(); else updateInstallTop(); }
        async function doInstall() {
            if (!deferredInstall) { openInstallBanner(); return; }
            deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; closeInstallBanner(false);
        }
        window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; maybeShowInstall(); });
        window.addEventListener('appinstalled', () => { deferredInstall = null; closeInstallBanner(false); });
        document.getElementById('installBtn').addEventListener('click', doInstall);
        document.getElementById('btnInstallTop').addEventListener('click', doInstall);
        document.getElementById('installClose').addEventListener('click', () => closeInstallBanner(true));
        function initPWA() { appReady = true; maybeShowInstall(); }
        if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW gagal:', err)));
