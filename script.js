// ===== Configuración =====
        const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyri11I8noRSb6ZPIKaZ4oAPxvwbaXTdTeUtHlZCD6_HGyIBw6siouScl0uXkrEGwBFng/exec';
        const SECRET_KEY = 'pr_key_2025'; // Debe coincidir con SECRET_KEY en Code.gs
        const PROFILES = ['z4', 'shenqi', 'vaelor'];
        const PLATFORMS = [
            'PC',
            'NES', 'SNES', 'N64', 'GameCube', 'Wii', 'Wii U', 'Switch',
            'Game Boy', 'Game Boy Color', 'Game Boy Advance', 'DS', '3DS', 'Virtual Boy',
            'PS1', 'PS2', 'PS3', 'PS4', 'PS5', 'PSP', 'Vita',
            'Xbox', 'Xbox 360', 'Xbox One', 'Xbox Series X',
            'SEGA Master System', 'SEGA Genesis', 'SEGA Saturn', 'SEGA Dreamcast', 'Game Gear',
            'Atari 2600', 'Arcade', 'PC Engine', 'Neo Geo', 'Commodore 64', 'Web',
            'Celular'
        ];
        const PAGE_SIZE = 21;
        const PLACEHOLDER_URL = 'https://placehold.co/200x280/444/fff?text=';
        const MSG_INCOMPLETE = 'Por favor, completa todos los campos correctamente.';

        // ===== Estado =====
        let data = {};            // { z4: [], shenqi: [], vaelor: [] }
        let mustPlayData = [];
        let currentProfile = 'main';
        let editIndex = -1;
        let debugEnabled = false;
        const debugLines = [];
        let mainList = [];        // Vista principal: juegos agrupados y ordenados
        let mainShown = 0;
        let mustPlaySorted = [];
        let mustPlayShown = 0;

        // ===== Utilidades =====
        function escapeHtml(value) {
            return String(value ?? '').replace(/[&<>"']/g, c => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            })[c]);
        }

        function average(values) {
            return values.reduce((sum, v) => sum + v, 0) / values.length;
        }

        function setVisible(id, visible) {
            document.getElementById(id).style.display = visible ? 'block' : 'none';
        }

        function gameKey(game) {
            return `${game.titulo}-${game.año}-${game.plataforma}`;
        }

        function imageTag(game) {
            return `<img src="${escapeHtml(game.img)}" alt="${escapeHtml(game.titulo)}" onerror="this.onerror=null;this.src='${PLACEHOLDER_URL}'+encodeURIComponent(this.alt)">`;
        }

        function populatePlatformSelects() {
            const options = '<option value="">Selecciona Plataforma</option>' +
                PLATFORMS.map(p => `<option value="${p}">${p}</option>`).join('');
            ['gamePlatform', 'editGamePlatform', 'mustPlayPlatform'].forEach(id => {
                document.getElementById(id).innerHTML = options;
            });
        }

        // ===== Depuración =====
        function debugLog(message) {
            debugLines.push(escapeHtml(message));
            renderDebug();
        }

        function renderDebug() {
            if (debugEnabled) document.getElementById('debug').innerHTML = debugLines.join('<br>');
        }

        function toggleDebug() {
            debugEnabled = !debugEnabled;
            document.body.classList.toggle('debug-active', debugEnabled);
            document.querySelector('.debug-toggle').textContent = debugEnabled ? 'Ocultar Depuración' : 'Mostrar Depuración';
            renderDebug();
        }

        // ===== Persistencia local =====
        function saveLocal() {
            localStorage.setItem('gameData', JSON.stringify(data));
        }

        function saveLocalMustPlay() {
            localStorage.setItem('mustPlayData', JSON.stringify(mustPlayData));
        }

        // ===== Carga de datos (Google Apps Script <-> Google Sheets) =====
        // La hoja es la fuente de verdad. La copia en localStorage solo se usa si no hay conexión.
        function loadData() {
            debugLog('Cargando datos desde Google Sheets...');
            fetch(SCRIPT_URL)
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    return response.json();
                })
                .then(json => {
                    if (!json.ok) throw new Error(json.error);
                    const nuevos = {};
                    PROFILES.forEach(p => nuevos[p] = []);
                    json.data.games.forEach(g => {
                        if (nuevos[g.perfil]) {
                            nuevos[g.perfil].push({
                                titulo: g.titulo,
                                año: g.año,
                                plataforma: g.plataforma,
                                puntaje: g.puntaje,
                                genero: g.genero,
                                img: g.img,
                                _row: g._row
                            });
                        }
                    });
                    data = nuevos;
                    mustPlayData = json.data.mustPlay.map(m => ({
                        titulo: m.titulo,
                        año: m.año,
                        desarrolladora: m.desarrolladora,
                        plataforma: m.plataforma,
                        img: m.img,
                        _row: m._row
                    }));
                    saveLocal();
                    saveLocalMustPlay();
                    debugLog(`Datos cargados: ${json.data.games.length} juegos y ${mustPlayData.length} Must Play.`);
                    updateDisplay();
                    if (mustPlayVisible()) applyMustPlayFilters();
                })
                .catch(error => {
                    debugLog(`Error al cargar datos: ${error.message}`);
                    console.error('Error details:', error);
                    const savedData = localStorage.getItem('gameData');
                    if (savedData) {
                        data = JSON.parse(savedData);
                        updateDisplay();
                    }
                    const savedMustPlay = localStorage.getItem('mustPlayData');
                    if (savedMustPlay) {
                        mustPlayData = JSON.parse(savedMustPlay);
                        if (mustPlayVisible()) applyMustPlayFilters();
                    }
                });
        }

        // Envía un cambio al Apps Script, que lo escribe en la hoja. Se resuelve solo si la hoja se actualizó.
        // Se envía como text/plain para evitar el preflight de CORS que Apps Script no soporta.
        function sendToSheets(action, payload, row) {
            return fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ key: SECRET_KEY, action: action, data: payload, row: row })
            })
                .then(response => response.json())
                .then(json => {
                    if (!json.ok) throw new Error(json.error);
                    return json;
                });
        }

        // ===== Filtros =====
        function fillSelect(id, values) {
            const select = document.getElementById(id);
            const previous = select.value;
            select.innerHTML = '<option value="">Todos</option>' +
                values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
            if (previous && values.some(v => String(v) === previous)) select.value = previous;
        }

        function updateFilterOptions(games) {
            fillSelect('filterYear', [...new Set(games.map(g => g.año))].sort((a, b) => b - a));
            fillSelect('filterPlatform', [...new Set(games.map(g => g.plataforma))].sort());
            fillSelect('filterGenre', [...new Set(games.map(g => g.genero))].sort());
        }

        function getFilters() {
            return {
                year: document.getElementById('filterYear').value,
                platform: document.getElementById('filterPlatform').value,
                genre: document.getElementById('filterGenre').value,
                search: document.getElementById('searchInput').value.trim().toLowerCase()
            };
        }

        function matchesFilters(game, f) {
            return (!f.year || String(game.año) === f.year) &&
                   (!f.platform || game.plataforma === f.platform) &&
                   (!f.genre || game.genero === f.genre) &&
                   (!f.search || game.titulo.toLowerCase().includes(f.search));
        }

        // ===== Actualización general =====
        function updateDisplay() {
            if (currentProfile === 'main') {
                renderMain(true);
            } else {
                renderProfile();
            }
        }

        function loadProfile(profile) {
            currentProfile = profile;
            document.querySelectorAll('.profile-selector button[data-profile]').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.profile === profile);
            });
            hideForms();
            document.getElementById('gamesContainer').style.display = profile === 'main' ? 'none' : 'flex';
            document.getElementById('mainGamesContainer').style.display = profile === 'main' ? 'flex' : 'none';
            setVisible('loadMoreMain', false);
            setVisible('loadAllMain', false);
            updateDisplay();
        }

        window.onload = function () {
            populatePlatformSelects();
            loadData();
            loadProfile('main');
        };

        // Llamado por la búsqueda y los filtros: vuelve a renderizar la vista actual
        function applyFiltersAndSearch() {
            updateDisplay();
        }

        // ===== Vista de perfil (todos los juegos del perfil, orden por puntaje) =====
        function renderProfile() {
            const games = data[currentProfile] || [];
            updateFilterOptions(games);
            const f = getFilters();
            const container = document.getElementById('gamesContainer');
            container.innerHTML = '';

            // Guardamos el índice real dentro de data[perfil] para editar/eliminar sin errores
            const visible = games
                .map((game, index) => ({ game, index }))
                .filter(item => matchesFilters(item.game, f))
                .sort((a, b) => b.game.puntaje - a.game.puntaje);

            visible.forEach(({ game, index }) => {
                const otros = [];
                PROFILES.forEach(p => {
                    const found = (data[p] || []).find(g => gameKey(g) === gameKey(game));
                    if (found) otros.push({ profile: p, puntaje: found.puntaje });
                });
                const card = document.createElement('div');
                card.className = 'game-card';
                card.innerHTML = `
                    ${imageTag(game)}
                    <h3>${escapeHtml(game.titulo)}</h3>
                    <p>${game.año} | ${escapeHtml(game.plataforma)}</p>
                    <p>Género: ${escapeHtml(game.genero)}</p>
                    <p>Puntajes:<br>${otros.map(o => `${o.profile}: ${o.puntaje}`).join('<br>')}</p>
                    <p>Promedio: ${average(otros.map(o => o.puntaje)).toFixed(2)}</p>
                    <p><strong>Puntaje (${currentProfile}): ${game.puntaje}</strong></p>
                    <button class="edit-btn" onclick="editGame(${index})">Editar</button>
                    <button onclick="deleteGame(${index})">Eliminar</button>
                `;
                container.appendChild(card);
            });
        }

        // ===== Vista principal (agrupa todos los perfiles, paginada) =====
        function groupAllGames() {
            const groups = {};
            PROFILES.forEach(profile => {
                (data[profile] || []).forEach(game => {
                    const key = gameKey(game);
                    if (!groups[key]) groups[key] = { ...game, puntajes: [], profiles: [] };
                    groups[key].puntajes.push(game.puntaje);
                    groups[key].profiles.push(profile);
                });
            });
            return Object.values(groups).sort((a, b) => average(b.puntajes) - average(a.puntajes));
        }

        // reset = true reconstruye la lista desde cero; false muestra la siguiente página
        function renderMain(reset) {
            if (reset) {
                const f = getFilters();
                const allGames = PROFILES.flatMap(p => data[p] || []);
                updateFilterOptions(allGames);
                mainList = groupAllGames().filter(g => matchesFilters(g, f));
                mainShown = 0;
                document.getElementById('mainGamesContainer').innerHTML = '';
            }
            appendMainCards(mainShown + PAGE_SIZE);
        }

        function appendMainCards(end) {
            const container = document.getElementById('mainGamesContainer');
            const limit = Math.min(end, mainList.length);
            for (let i = mainShown; i < limit; i++) {
                const game = mainList[i];
                const card = document.createElement('div');
                card.className = 'main-game-card';
                card.innerHTML = `
                    ${imageTag(game)}
                    <h3>${escapeHtml(game.titulo)}</h3>
                    <p>${game.año} | ${escapeHtml(game.plataforma)}</p>
                    <p>Género: ${escapeHtml(game.genero)}</p>
                    <p>Puntajes:<br>${game.profiles.map((p, j) => `${p}: ${game.puntajes[j]}`).join('<br>')}</p>
                    <p>Promedio: <strong>${average(game.puntajes).toFixed(2)}</strong></p>
                `;
                container.appendChild(card);
            }
            mainShown = limit;
            const hasMore = mainShown < mainList.length;
            setVisible('loadMoreMain', hasMore);
            setVisible('loadAllMain', hasMore);
        }

        function loadMoreMainGames() {
            appendMainCards(mainShown + PAGE_SIZE);
        }

        function loadAllMainGames() {
            appendMainCards(mainList.length);
        }

        // ===== Formularios =====
        function hideForms() {
            ['addForm', 'editForm', 'mustPlayForm'].forEach(id => {
                document.getElementById(id).classList.remove('active');
            });
        }

        function openAddForm() {
            if (currentProfile === 'main') {
                alert('Primero selecciona un perfil (Z4, Shenqi o Vaelor) para agregar un juego.');
                return;
            }
            hideForms();
            document.getElementById('addForm').reset();
            document.getElementById('addForm').classList.add('active');
        }

        function openMustPlayForm() {
            hideForms();
            document.getElementById('mustPlayForm').reset();
            document.getElementById('mustPlayForm').classList.add('active');
        }

        function editGame(index) {
            const game = (data[currentProfile] || [])[index];
            if (!game) return;
            hideForms();
            editIndex = index;
            document.getElementById('editGameTitle').value = game.titulo;
            document.getElementById('editGameYear').value = game.año;
            document.getElementById('editGamePlatform').value = game.plataforma;
            document.getElementById('editGameGenre').value = game.genero;
            document.getElementById('editGamePuntaje').value = game.puntaje;
            document.getElementById('editGameImage').value = game.img;
            document.getElementById('editForm').classList.add('active');
            document.getElementById('editForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // ===== Alta / edición / baja de juegos de perfil =====
        function addGame() {
            if (currentProfile === 'main') {
                alert('Primero selecciona un perfil para agregar un juego.');
                return;
            }
            const titulo = document.getElementById('gameTitle').value.trim();
            const año = parseInt(document.getElementById('gameYear').value);
            const plataforma = document.getElementById('gamePlatform').value;
            const genero = document.getElementById('gameGenre').value.trim();
            const puntaje = parseFloat(document.getElementById('gamePuntaje').value);
            const img = document.getElementById('gameImage').value.trim();

            if (titulo && año && plataforma && genero && !isNaN(puntaje) && img) {
                sendToSheets('addGame', { perfil: currentProfile, titulo, año, plataforma, genero, puntaje, img })
                    .then(() => { hideForms(); loadData(); })
                    .catch(err => alert('No se pudo guardar en Google Sheets: ' + err.message));
            } else {
                alert(MSG_INCOMPLETE);
            }
        }

        function saveEdit() {
            const titulo = document.getElementById('editGameTitle').value.trim();
            const año = parseInt(document.getElementById('editGameYear').value);
            const plataforma = document.getElementById('editGamePlatform').value;
            const genero = document.getElementById('editGameGenre').value.trim();
            const puntaje = parseFloat(document.getElementById('editGamePuntaje').value);
            const img = document.getElementById('editGameImage').value.trim();

            if (titulo && año && plataforma && genero && !isNaN(puntaje) && img && editIndex >= 0) {
                const row = data[currentProfile][editIndex]._row;
                sendToSheets('editGame', { perfil: currentProfile, titulo, año, plataforma, genero, puntaje, img }, row)
                    .then(() => { editIndex = -1; hideForms(); loadData(); })
                    .catch(err => alert('No se pudo guardar en Google Sheets: ' + err.message));
            } else {
                alert(MSG_INCOMPLETE);
            }
        }

        function deleteGame(index) {
            if (confirm('¿Estás seguro de eliminar este juego?')) {
                const row = data[currentProfile][index]._row;
                sendToSheets('deleteGame', {}, row)
                    .then(() => loadData())
                    .catch(err => alert('No se pudo eliminar en Google Sheets: ' + err.message));
            }
        }

        // ===== Recarga manual desde Google Sheets (descarta cambios locales) =====
        function reloadFromSheets() {
            loadData();
        }

        // ===== Exportar CSV (escapa comas y comillas) =====
        function csvCell(value) {
            const text = String(value ?? '');
            return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        }

        function syncToClipboard() {
            const rows = [
                ['Perfil', 'Título', 'Año', 'Plataforma', 'Puntaje', 'Género', 'Imagen'],
                ...Object.entries(data).flatMap(([profile, games]) =>
                    games.map(g => [profile, g.titulo, g.año, g.plataforma, g.puntaje, g.genero, g.img])
                )
            ];
            const csvContent = rows.map(row => row.map(csvCell).join(',')).join('\n');
            navigator.clipboard.writeText(csvContent).then(() => {
                alert('Datos copiados al portapapeles. Pégalos en Google Sheets (reemplaza la hoja).');
            }).catch(err => {
                alert('Error al copiar: ' + err);
            });
        }

        // ===== Must Play =====
        function mustPlayVisible() {
            return document.getElementById('mustPlayContainer').style.display === 'block';
        }

        function loadMustPlay() {
            const container = document.getElementById('mustPlayContainer');
            const show = !mustPlayVisible();
            container.style.display = show ? 'block' : 'none';
            if (!show) return;
            applyMustPlayFilters();
            setTimeout(() => {
                const last = document.querySelector('#mustPlayList .must-play-card:last-child');
                (last || container).scrollIntoView({ behavior: 'smooth', block: 'end' });
            }, 100);
        }

        function applyMustPlayFilters() {
            const order = document.getElementById('sortOrder').value;
            mustPlaySorted = [...mustPlayData].sort((a, b) => order === 'asc' ? a.año - b.año : b.año - a.año);
            mustPlayShown = 0;
            document.getElementById('mustPlayList').innerHTML = '';
            appendMustPlayCards(mustPlayShown + PAGE_SIZE);
        }

        function mustPlayCardHtml(game) {
            return `
                <div class="must-play-card">
                    ${imageTag(game)}
                    <h3>${escapeHtml(game.titulo)}</h3>
                    <p>${game.año} | ${escapeHtml(game.plataforma)}</p>
                    <p>Desarrolladora: ${escapeHtml(game.desarrolladora)}</p>
                </div>`;
        }

        function appendMustPlayCards(end) {
            const list = document.getElementById('mustPlayList');
            if (mustPlaySorted.length === 0) {
                list.innerHTML = '<p>No hay juegos Must Play disponibles.</p>';
                setVisible('loadMoreMustPlay', false);
                setVisible('loadAllMustPlay', false);
                return;
            }
            const limit = Math.min(end, mustPlaySorted.length);
            let html = '';
            for (let i = mustPlayShown; i < limit; i++) {
                html += mustPlayCardHtml(mustPlaySorted[i]);
            }
            list.insertAdjacentHTML('beforeend', html);
            mustPlayShown = limit;
            const hasMore = mustPlayShown < mustPlaySorted.length;
            setVisible('loadMoreMustPlay', hasMore);
            setVisible('loadAllMustPlay', hasMore);
        }

        function loadMoreMustPlayGames() {
            appendMustPlayCards(mustPlayShown + PAGE_SIZE);
        }

        function loadAllMustPlayGames() {
            appendMustPlayCards(mustPlaySorted.length);
        }

        function addMustPlayGame() {
            const titulo = document.getElementById('mustPlayTitle').value.trim();
            const año = parseInt(document.getElementById('mustPlayYear').value);
            const desarrolladora = document.getElementById('mustPlayDeveloper').value.trim();
            const plataforma = document.getElementById('mustPlayPlatform').value;
            const img = document.getElementById('mustPlayImage').value.trim();

            if (titulo && año && desarrolladora && plataforma && img) {
                sendToSheets('addMustPlayGame', { titulo, año, desarrolladora, plataforma, img })
                    .then(() => { hideForms(); loadData(); })
                    .catch(err => alert('No se pudo guardar en Google Sheets: ' + err.message));
            } else {
                alert(MSG_INCOMPLETE);
            }
        }

        function tryYourLuck() {
            if (mustPlayData.length === 0) {
                alert('No hay juegos Must Play para seleccionar.');
                return;
            }
            const randomGame = mustPlayData[Math.floor(Math.random() * mustPlayData.length)];
            const list = document.getElementById('mustPlayList');
            list.innerHTML = mustPlayCardHtml(randomGame).replace('</div>',
                '    <p><strong>¡Ahora debes jugar este juego!</strong></p>\n                </div>');
            mustPlaySorted = [randomGame];
            mustPlayShown = 1;
            setVisible('loadMoreMustPlay', false);
            setVisible('loadAllMustPlay', false);
            document.getElementById('mustPlayContainer').scrollIntoView({ behavior: 'smooth', block: 'end' });
        }

        function scrollToTop() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
