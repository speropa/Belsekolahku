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
        let currentFirebaseTS = 0; // MENYIMPAN TIMESTAMP TERAKHIR FIREBASE (UNTUK ANTI MENTAL/BOUNCE)
        let masterJam = [], masterBel = [], jadwalKhusus = [], masterJadwal = {};
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
            editJam: 'editJamModal', 
            deleteJam: 'deleteJamModal', 
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

            signInWithEmailAndPassword(auth, hardcodedEmail, hardcodedPassword)
                .then(() => {
                    document.getElementById('loading-spinner').classList.add('hidden');
                    document.getElementById('login-page').classList.remove('hidden');
                    const pinInput = document.getElementById('pin');
                    setTimeout(() => { pinInput.focus(); }, 150);
                })
                .catch(err => {
                    document.getElementById('loading-spinner').classList.add('hidden');
                    document.getElementById('login-page').classList.remove('hidden');
                    console.error("Auth fail:", err);
                });

            document.getElementById('login-page').addEventListener('click', () => {
                const pinInput = document.getElementById('pin');
                if (!pinInput.disabled) { pinInput.focus(); }
            });

            const pinInput = document.getElementById('pin');
            const statusText = document.getElementById('login-status');
            
            pinInput.addEventListener('input', async (e) => {
                pinInput.value = pinInput.value.replace(/[^0-9]/g, '');
                pinInput.classList.remove('error-shake');
                statusText.textContent = "Menunggu input...";
                statusText.className = "text-slate-500 text-sm mt-4 text-center font-medium h-5 transition-all";
                
                if (pinInput.value.length === 6) {
                    pinInput.disabled = true;
                    statusText.textContent = "Memeriksa...";
                    statusText.classList.replace('text-slate-500', 'text-orange-500');
                    
                    try {
                        const snap = await get(ref(db, 'login/pin'));
                        if(snap.exists() && snap.val().toString() === pinInput.value) {
                            statusText.textContent = "Berhasil!";
                            statusText.classList.replace('text-orange-500', 'text-green-500');
                            setTimeout(() => {
                                document.getElementById('login-page').classList.add('hidden');
                                document.getElementById('main-app').classList.remove('hidden');
                                startApp();
                            }, 500);
                        } else {
                            triggerPinError();
                        }
                    } catch(err) { 
                        console.error(err); 
                        triggerPinError("Koneksi gagal.");
                    }
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
        }

        let desktopStatus = null, serverOffsetMs = 0, firebaseConnected = true, serverOnline = null;
        function listenToDesktopStatus() {
            onValue(ref(db, '.info/serverTimeOffset'), s => { serverOffsetMs = s.val() || 0; renderServerStatus(); });
            onValue(ref(db, '.info/connected'), s => { firebaseConnected = s.val() === true; renderServerStatus(); });
            onValue(ref(db, 'desktopStatus'), snap => { desktopStatus = snap.exists() ? snap.val() : null; renderServerStatus(); });
            setInterval(renderServerStatus, 10000);
            window.addEventListener('online', renderServerStatus);
            window.addEventListener('offline', renderServerStatus);
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
            el.className = `font-mono ${color} font-bold max-w-[55vw] sm:max-w-none sm:w-[350px] flex items-center gap-1.5 mt-0.5 text-[11px] sm:text-xs`;
            const warn = document.getElementById('serverWarn'), grid = document.getElementById('manualSoundGrid');
            if (warn) {
                const msgs = { noinet: 'HP tidak terhubung ke internet. Perintah remote tidak bisa dikirim.', offline: 'Server sekolah sedang offline. Perintah remote mungkin baru berjalan setelah server online.' };
                warn.classList.toggle('hidden', !msgs[state]);
                warn.textContent = msgs[state] || '';
                warn.className = 'mb-3 rounded-lg border px-3 py-2 text-sm font-semibold ' + (state === 'noinet' ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-red-50 border-red-300 text-red-700') + (msgs[state] ? '' : ' hidden');
            }
            if (grid) grid.classList.toggle('remote-offline', state === 'noinet' || state === 'offline');
        }

        function listenToConfig() {
            onValue(ref(db, 'schoolBellConfig'), snap => {
                const data = snap.val() || {};
                
                // Update tracker waktu terbaru dari firebase
                if(data.lastUpdated) {
                    currentFirebaseTS = new Date(data.lastUpdated).getTime();
                }

                masterJam = ensureArray(data.masterJam);
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
                if(document.querySelector('#jadwalTable tbody')) renderJadwalTable(); 
            });
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
            if(!firebaseConnected) { showToast('HP tidak terhubung internet. Perubahan tidak disimpan.', 'error'); return; }
            
            // ANTI MENTAL BUGS:
            // Pastikan timestamp web lebih baru daripada yg ada di Firebase (memaksa sinkronisasi dengan desktop app)
            let newTS = Date.now();
            if (newTS <= currentFirebaseTS) {
                newTS = currentFirebaseTS + 1000;
            }
            const newTimeStr = new Date(newTS).toISOString();

            const data = { 
                masterJam, masterBel, jadwalKhusus, masterJadwal, jadwalMendatang, 
                savedTemplate, manualDayOverride, temporaryOverride, secondSchedule, 
                lastUpdated: newTimeStr 
            };
            try { await set(ref(db, 'schoolBellConfig'), data); } catch (err) { console.error(err); showToast('Gagal menyimpan ke server. Periksa koneksi.', 'error'); }
        }
        
        function checkJadwalMendatang(todayStr) {
            if (lastCheckedDate === todayStr) return;
            lastCheckedDate = todayStr;
            if (isDataLoaded) scheduleNextBell();
            
            let configChanged = false;
            const todaysEvents = jadwalMendatang.filter(j => j.date === todayStr);

            todaysEvents.forEach(evt => {
                if (evt.type === 'template' && savedTemplate !== evt.value) {
                    savedTemplate = evt.value;
                    configChanged = true;
                } else if (evt.type === 'khusus') {
                    if (temporaryOverride.date !== todayStr || temporaryOverride.name !== evt.value) {
                        temporaryOverride = { date: todayStr, name: evt.value };
                        manualDayOverride = null;
                        configChanged = true;
                    }
                }
            });

            if (configChanged) {
                saveConfig();
            }
        }

        function updateTime() {
            const now = new Date();
            const todayStr = getTodayDateString();
            
            document.getElementById('time').textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            document.getElementById('date').textContent = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            
            if (isDataLoaded) checkJadwalMendatang(todayStr); // jangan tandai hari 'sudah dicek' sebelum data server tiba
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
            
            const upcoming = jadwalMendatang.filter(j => j.date >= todayStr).sort((a,b) => a.date.localeCompare(b.date));
            
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
                const icon = j.type === 'khusus' ? '★' : '🔄';
                const label = j.type === 'khusus' ? 'Khusus' : 'Template';
                const isToday = j.date === todayStr;
                
                return `
                <div class="flex-none lg:w-full flex justify-between items-center p-2 mb-1.5 rounded-md border bg-white border-slate-200 shadow-sm ${isToday ? 'border-blue-400 ring-1 ring-blue-100' : ''} min-w-[200px] lg:min-w-0">
                    <div class="flex flex-col items-center justify-center w-12 flex-shrink-0 border-r border-slate-100 pr-2">
                        <span class="font-black text-lg text-blue-600 leading-none">${dateObj.getDate()}</span>
                        <span class="text-[10px] font-bold uppercase text-slate-500 mt-0.5">${dateObj.toLocaleDateString('id-ID', {month:'short'})}</span>
                    </div>
                    <div class="flex flex-col flex-grow ml-3 leading-tight overflow-hidden">
                        <span class="font-bold text-sm text-slate-700 truncate w-full" title="${esc(j.value)}">${esc(j.value)}</span>
                        <span class="text-[10px] font-medium text-slate-500 mt-1 flex items-center gap-1">${icon} ${label}</span>
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

        function updateMendatangOptions() {
            const type = document.getElementById('mendatangType').value;
            const valSelect = document.getElementById('mendatangValue');
            
            if (type === 'template') {
                valSelect.innerHTML = templates.map(t => `<option value="${t}">${t}</option>`).join('');
            } else {
                if(jadwalKhusus.length === 0) {
                    valSelect.innerHTML = `<option value="">-- Belum Ada Jadwal Khusus --</option>`;
                } else {
                    valSelect.innerHTML = jadwalKhusus.map(k => `<option value="${esc(k.nama)}">${esc(k.nama)}</option>`).join('');
                }
            }
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
            document.getElementById('addHariForm').onsubmit = (e) => { e.preventDefault(); const v = document.getElementById('hariInput').value.trim().replace(/\s+/g, ' '); if (!v) return; if (jadwalKhusus.some(k => k.nama.toLowerCase() === v.toLowerCase())) { showToast('Nama jadwal khusus sudah ada!', 'error'); return; } jadwalKhusus.push({ nama: v, jadwal: {} }); saveConfig(); renderHariList(); e.target.reset(); };
            
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
                    Jadwal yang diatur di sini akan otomatis aktif pada tanggal yang ditentukan.
                </div>
                <div id="mendatangListContainer" class="space-y-3"></div>
            `;
            renderJadwalMendatangList();
            
            document.getElementById('btnTambahMendatang').onclick = () => {
                document.getElementById('formMendatangTitle').textContent = "Tambah Jadwal Mendatang";
                document.getElementById('formMendatang').reset();
                document.getElementById('mendatangId').value = "";
                document.getElementById('mendatangDate').min = getTodayDateString(); 
                updateMendatangOptions();
                showModal('formMendatang');
            };
            document.getElementById('mendatangType').onchange = updateMendatangOptions;
            
            document.getElementById('formMendatang').onsubmit = async (e) => {
                e.preventDefault();
                const id = document.getElementById('mendatangId').value;
                const date = document.getElementById('mendatangDate').value;
                const type = document.getElementById('mendatangType').value;
                const value = document.getElementById('mendatangValue').value;

                if(!value) { showToast("Pilih jadwal/template terlebih dahulu!", "error"); return; }

                if (id) {
                    const idx = jadwalMendatang.findIndex(j => j.id === id);
                    if (idx > -1) {
                        jadwalMendatang[idx] = { id, date, type, value };
                    }
                } else {
                    jadwalMendatang.push({ id: Date.now().toString(), date, type, value });
                }

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
                    document.getElementById('mendatangType').value = item.type;
                    updateMendatangOptions();
                    document.getElementById('mendatangValue').value = item.value;
                    showModal('formMendatang');
                } else if (target.classList.contains('delete-mendatang-btn')) {
                    const dateObj = parseLocalDate(item.date);
                    document.getElementById('deleteMendatangText').innerHTML = `Hapus otomatisasi <strong>${esc(item.value)}</strong> pada tanggal ${dateObj.toLocaleDateString('id-ID')}?`;
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

            // TAB: MASTER JAM
            document.getElementById('tab-content-jam').innerHTML = `
                <div class="mb-6">
                    <h4 class="text-lg font-semibold text-slate-800 mb-3">Master Jam</h4>
                    <form id="addJamForm" class="shadow-sm flex flex-col sm:flex-row items-center gap-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <input type="text" id="jamInput" class="w-full sm:w-32 bg-white border border-slate-300 rounded-md p-3 sm:p-2 text-xl sm:text-base text-center outline-none focus:ring-2 focus:ring-orange-200 tracking-widest sm:tracking-normal" placeholder="00:00" maxlength="5" required autocomplete="off">
                        <button type="submit" class="w-full sm:w-auto btn bg-orange-600 hover:bg-orange-700 text-white font-bold px-6 shadow-md border-0 py-3 sm:py-2">TAMBAH</button>
                    </form>
                </div>
                <div id="jamListContainer" class="space-y-2"></div>`;
                
            renderJamList();
            applyTimeInputMask('jamInput');
            
            document.getElementById('addJamForm').onsubmit = (e) => { 
                e.preventDefault(); 
                let v = document.getElementById('jamInput').value.trim();
                if(v.length === 4 && !v.includes(':')) v = v.substring(0,2) + ":" + v.substring(2);
                
                if(!validJam(v)){ showToast('Format jam harus HH:MM (00:00 - 23:59).', 'error'); return; } if(masterJam.includes(v)){ showToast('Jam tersebut sudah ada!', 'error'); return; } { masterJam.push(v); masterJam.sort(); saveConfig(); renderJamList(); renderJadwalTable(); e.target.reset(); document.getElementById('jamInput').value=''; }
            };
            
            document.getElementById('jamListContainer').onclick = e => { 
                const target = e.target.closest('button'); if(!target) return;
                const j = target.dataset.jamValue; const idx = masterJam.indexOf(j);
                if (target.classList.contains('delete-jam-btn') && idx > -1) { 
                    document.getElementById('deleteJamText').innerHTML = `Hapus jam <strong>${esc(j)}</strong> dari daftar?`; 
                    document.getElementById('confirmDeleteJamBtn').dataset.jamValue = j; 
                    showModal('deleteJam'); 
                } else if (target.classList.contains('edit-jam-btn') && idx > -1) { 
                    document.getElementById('editJamIndex').value = idx; 
                    document.getElementById('editJamInput').value = j; 
                    showModal('editJam'); 
                }
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

            // TAB: ATUR JADWAL
            document.getElementById('tab-content-jadwal').innerHTML = `
                <div class="mb-6">
                    <div class="flex justify-between items-center mb-3">
                        <h4 class="text-lg font-semibold text-slate-800">Atur Jadwal</h4>
                        <button id="btnKosongkanJadwal" class="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded text-xs font-bold border border-red-200 transition-all shadow-sm flex items-center gap-1">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            Kosongkan Jadwal
                        </button>
                    </div>
                    <div class="shadow-sm flex flex-col gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <select id="jadwalTemplateSelect" class="w-full bg-white border border-slate-300 p-3 sm:p-2 rounded-md outline-none focus:ring-2 focus:ring-orange-200 text-sm"></select>
                        <select id="jadwalDaySelect" class="w-full bg-white border border-slate-300 p-3 sm:p-2 rounded-md outline-none focus:ring-2 focus:ring-orange-200 text-sm"></select>
                    </div>
                </div>
                <div class="overflow-x-auto text-slate-800 -mx-4 sm:mx-0 px-4 sm:px-0 pb-4">
                    <table id="jadwalTable" class="w-full min-w-[300px]">
                        <thead><tr class="border-b border-slate-200"><th class="p-3 text-left">Jam</th><th class="p-3 text-left">Bel</th></tr></thead>
                        <tbody></tbody>
                    </table>
                </div>`;

            // Logika Tombol Kosongkan Jadwal (Ditaruh di luar fungsi onchange)
            document.getElementById('btnKosongkanJadwal').onclick = () => {
                const t = document.getElementById('jadwalTemplateSelect').value; 
                const d = document.getElementById('jadwalDaySelect').value;
                
                if (confirm(`Apakah Anda yakin ingin mengosongkan semua jadwal untuk ${d} (${t.replace(/_/g, ' ')})?`)) {
                    if (t === 'JADWAL_KHUSUS') {
                        const khusus = jadwalKhusus.find(x => x.nama === d);
                        if (khusus) khusus.jadwal = {}; 
                    } else {
                        if (masterJadwal[t] && masterJadwal[t][d]) {
                            masterJadwal[t][d] = {}; 
                        }
                    }
                    
                    saveConfig(); 
                    renderJadwalTable(); 
                    showToast(`Jadwal ${d} berhasil dikosongkan.`, 'success'); 
                }
            };

            // Logika Onchange Tabel Jadwal
            document.querySelector('#jadwalTable tbody').onchange = (e) => { 
                if(e.target.tagName==='SELECT') {
                    const t = document.getElementById('jadwalTemplateSelect').value; const d = document.getElementById('jadwalDaySelect').value;
                    const j = e.target.dataset.jam; const b = parseInt(e.target.value);
                    let s = (t==='JADWAL_KHUSUS') ? jadwalKhusus.find(x=>x.nama===d)?.jadwal : masterJadwal[t]?.[d];
                    if(s) { 
                        if(b===0) delete s[j]; else s[j]=b; 
                        saveConfig(); 
                        
                        const tr = e.target.closest('tr');
                        const sel = e.target;
                        
                        if(b === 0) {
                            tr.className = 'border-b border-slate-200';
                            sel.className = 'w-full p-2.5 rounded-md outline-none border border-slate-300 bg-slate-50 text-slate-500 shadow-sm cursor-pointer transition-all hover:bg-white focus:ring-2 focus:ring-slate-400 text-xs sm:text-sm';
                        } else {
                            tr.className = 'border-b border-slate-200 bg-orange-50/50';
                            sel.className = 'w-full p-2.5 rounded-md outline-none border-2 border-orange-400 bg-orange-100 text-orange-800 font-bold shadow-md cursor-pointer transition-all focus:ring-2 focus:ring-orange-500 text-xs sm:text-sm';
                        }
                    }
                }
            };

            
            document.getElementById('editHariForm').onsubmit = e => { e.preventDefault(); const i = parseInt(document.getElementById('editHariIndex').value); const n = document.getElementById('editHariInput').value.trim().replace(/\s+/g, ' '); const old = jadwalKhusus[i].nama; if (!n) return; if (jadwalKhusus.some((k, x) => x !== i && k.nama.toLowerCase() === n.toLowerCase())) { showToast('Nama jadwal khusus sudah ada!', 'error'); return; } if (n !== old) { jadwalKhusus[i].nama = n; renameKhusus(old, n); } saveConfig(); renderHariList(); hideModal('editHari'); renderAll(); };
            document.getElementById('confirmDeleteHariBtn').onclick = e => { const i = parseInt(e.target.dataset.deleteIndex); const nama = jadwalKhusus[i].nama; jadwalKhusus.splice(i, 1); removeKhusus(nama); saveConfig(); renderHariList(); hideModal('deleteHari'); renderAll(); };

            applyTimeInputMask('editJamInput');
            document.getElementById('editJamForm').onsubmit = e => { 
                e.preventDefault(); const i = document.getElementById('editJamIndex').value; const old = masterJam[i]; const n = document.getElementById('editJamInput').value;
                if(!validJam(n)){ showToast('Format jam harus HH:MM (00:00 - 23:59).', 'error'); return; } if(n !== old && masterJam.includes(n)){ showToast('Jam tersebut sudah ada!', 'error'); return; } { 
                    masterJam[i] = n; 
                    Object.values(masterJadwal).forEach(t=>Object.values(t).forEach(d=>{ if(d[old]){ d[n]=d[old]; delete d[old]; }}));
                    jadwalKhusus.forEach(k=>{ if(k.jadwal[old]){ k.jadwal[n]=k.jadwal[old]; delete k.jadwal[old]; }});
                    saveConfig(); renderJamList(); renderJadwalTable(); hideModal('editJam'); 
                }
            };

            document.getElementById('confirmDeleteJamBtn').onclick = e => { 
                const j = e.target.dataset.jamValue; const i = masterJam.indexOf(j);
                if(i>-1) { 
                    masterJam.splice(i,1); 
                    Object.values(masterJadwal).forEach(t=>Object.values(t).forEach(d=>delete d[j]));
                    jadwalKhusus.forEach(k=>delete k.jadwal[j]);
                    saveConfig(); renderJamList(); renderJadwalTable(); hideModal('deleteJam'); 
                }
            };

            document.getElementById('editBelForm').onsubmit = e => { e.preventDefault(); const i = document.getElementById('editBelIndex').value; masterBel[i].nama = document.getElementById('editBelNamaInput').value; masterBel[i].file = document.getElementById('editBelFileSelect').value; saveConfig(); renderBelList(); hideModal('editBel'); };
        }

        // --- RENDER LISTS SETTINGS ---
        function renderHariList() { document.getElementById('hariListContainer').innerHTML = jadwalKhusus.map((h,i)=>`<div class="flex justify-between items-center bg-white p-3 sm:p-4 border border-slate-200 rounded text-slate-800"><span>${esc(h.nama)}</span><div class="flex gap-2"><button class="btn p-2 sm:p-1 px-3 edit-hari-btn" data-index="${i}">Edit</button> <button class="btn p-2 sm:p-1 px-3 delete-hari-btn text-red-500" data-index="${i}">Hapus</button></div></div>`).join(''); }
        
        function renderJamList() { document.getElementById('jamListContainer').innerHTML = masterJam.sort().map((j,i)=>`<div class="flex justify-between items-center bg-white p-3 sm:p-4 border border-slate-200 rounded text-slate-800 text-sm font-semibold"><span>${j}</span><div class="flex gap-2"><button class="btn p-2 sm:p-1 px-3 edit-jam-btn" data-jam-value="${j}">Edit</button><button class="btn p-2 sm:p-1 px-3 text-red-500 delete-jam-btn" data-jam-value="${j}">Hapus</button></div></div>`).join(''); }
        
        function renderBelList() { document.getElementById('belListContainer').innerHTML = masterBel.map((b,i)=>`<div class="card p-4 sm:p-3 flex justify-between items-center text-sm text-slate-800"><div><p class="font-bold text-base sm:text-sm mb-1 sm:mb-0">${esc(b.nama)}</p><p class="text-xs text-slate-500">${esc(b.file || 'Kosong')}</p></div><button class="btn p-2 sm:p-1 px-4 edit-bel-btn" data-index="${i}">Edit</button></div>`).join(''); }
        
        function renderJadwalMendatangList() {
            const container = document.getElementById('mendatangListContainer');
            if (!container) return;
            if (!jadwalMendatang || jadwalMendatang.length === 0) { container.innerHTML = `<p class="text-slate-500 text-center italic bg-slate-50 p-6 rounded border border-slate-200 border-dashed">Belum ada jadwal yang dijadwalkan.</p>`; return; }

            const todayStr = getTodayDateString();
            const sorted = [...jadwalMendatang].sort((a,b) => a.date.localeCompare(b.date));

            container.innerHTML = sorted.map(j => {
                const isPast = j.date < todayStr;
                const isToday = j.date === todayStr;
                const dateObj = parseLocalDate(j.date);
                const displayDate = dateObj.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                
                let bgClass = "bg-white border-slate-200";
                let textClass = "text-slate-800";
                let badgeClass = "bg-blue-100 text-blue-800";
                
                if (isPast) { bgClass = "bg-slate-100 border-slate-200 opacity-60"; textClass = "text-slate-500 line-through"; badgeClass = "bg-slate-200 text-slate-500"; } 
                else if (isToday) { bgClass = "bg-orange-50 border-orange-300 shadow-sm"; badgeClass = "bg-orange-200 text-orange-800 font-bold animate-pulse"; }

                const typeLabel = j.type === 'khusus' ? 'Jadwal Khusus' : 'Ganti Template';

                return `
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 border rounded-lg ${bgClass} transition-all gap-4">
                    <div>
                        <div class="flex items-center gap-2 mb-1.5 sm:mb-1">
                            <span class="text-xs px-2 py-0.5 rounded ${badgeClass}">${typeLabel}</span>
                            ${isToday ? `<span class="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 font-bold">Hari Ini!</span>` : ''}
                        </div>
                        <p class="font-bold text-lg ${textClass}">${displayDate}</p>
                        <p class="text-sm font-semibold text-slate-600 mt-1">→ ${esc(j.value)}</p>
                    </div>
                    <div class="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-200">
                        <button class="btn flex-1 sm:flex-none p-3 sm:p-2 flex justify-center edit-mendatang-btn" data-id="${j.id}" title="Edit"><svg class="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                        <button class="btn flex-1 sm:flex-none p-3 sm:p-2 flex justify-center text-red-500 hover:bg-slate-100 delete-mendatang-btn" data-id="${j.id}" title="Hapus"><svg class="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                    </div>
                </div>`;
            }).join('');
        }
        
        function populateSettingsDropdowns() { 
            const t = document.getElementById('jadwalTemplateSelect'); const d = document.getElementById('jadwalDaySelect');
            if(!t || !d) return;
            t.innerHTML = [...templates.map(v => `<option value="${v}">${v}</option>`), `<option value="JADWAL_KHUSUS">JADWAL KHUSUS</option>`].join('');
            const u = () => { const s = t.value; let o = (s === 'JADWAL_KHUSUS') ? jadwalKhusus.map(j => j.nama) : jadwalUtama; d.innerHTML = o.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join(''); renderJadwalTable(); };
            t.onchange = u; d.onchange = renderJadwalTable; u();
        }
        
        function renderJadwalTable() {
            const b = document.querySelector('#jadwalTable tbody'); const t = document.getElementById('jadwalTemplateSelect').value; const d = document.getElementById('jadwalDaySelect').value; 
            if(!b) return;
            let s = (t === 'JADWAL_KHUSUS') ? (jadwalKhusus.find(x=>x.nama===d)?.jadwal || {}) : (masterJadwal[t]?.[d] || {});
            const c = masterBel.filter(l => l && (l.file || l.nama));
            
            let htmlTemp = '';
            [...masterJam].sort().forEach(j => {
                const i = s?.[j] || 0; const isFilled = i > 0;
                let o = `<option value="0">(Kosong)</option>` + c.map(l => `<option value="${l.id}" ${l.id == i ? 'selected' : ''}>${esc(l.nama)}</option>`).join('');
                
                const trClass = isFilled ? 'border-b border-slate-200 bg-orange-50/50' : 'border-b border-slate-200';
                const selectClass = isFilled 
                    ? 'w-full p-3 sm:p-2.5 rounded-md outline-none border-2 border-orange-400 bg-orange-100 text-orange-800 font-bold shadow-md cursor-pointer transition-all focus:ring-2 focus:ring-orange-500 text-xs sm:text-sm'
                    : 'w-full p-3 sm:p-2.5 rounded-md outline-none border border-slate-300 bg-slate-50 text-slate-500 shadow-sm cursor-pointer transition-all hover:bg-white focus:ring-2 focus:ring-slate-400 text-xs sm:text-sm';
                
                htmlTemp += `<tr class="${trClass}"><td class="p-4 sm:p-3 w-16 font-semibold text-slate-700">${j}</td><td class="p-2 sm:p-2"><select class="${selectClass}" data-jam="${j}">${o}</select></td></tr>`;
            });
            b.innerHTML = htmlTemp;
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
        function renameKhusus(oldN, newN) {
            jadwalMendatang.forEach(j => { if (j.type === 'khusus' && j.value === oldN) j.value = newN; });
            if (temporaryOverride && temporaryOverride.name === oldN) temporaryOverride.name = newN;
            if (secondSchedule.isKhusus && secondSchedule.day === oldN) secondSchedule.day = newN;
        }
        function removeKhusus(nama) {
            jadwalMendatang = jadwalMendatang.filter(j => !(j.type === 'khusus' && j.value === nama));
            if (temporaryOverride && temporaryOverride.name === nama) temporaryOverride = { date: null, name: null };
            if (secondSchedule.isKhusus && secondSchedule.day === nama) { secondSchedule.active = false; secondSchedule.isKhusus = false; secondSchedule.template = 'HARI NORMAL'; secondSchedule.day = 'Senin'; secondSchedule.date = null; }
        }
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
        const PICKER_TITLES = { templateSelect: 'Template Jadwal', secondTemplateSelect: 'Template Jadwal 2', secondDaySelect: 'Hari / Jadwal 2', mendatangType: 'Aksi Otomatis', mendatangValue: 'Pilih Jadwal', editBelFileSelect: 'File Suara MP3', jadwalTemplateSelect: 'Template', jadwalDaySelect: 'Hari' };
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
