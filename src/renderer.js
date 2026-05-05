// State
let currentResults = [];
let allLeads = [];
let searchHistory = [];
let scrapeStates = [];
let isScanning = false;
let currentSessionId = null;

// DOM Elements
const elements = {
    // Nav
    navItems: document.querySelectorAll('.nav-item'),
    tabContents: document.querySelectorAll('.tab-content'),

    // Stats
    totalLeads: document.getElementById('totalLeads'),
    noWebsiteCount: document.getElementById('noWebsiteCount'),
    hasPhoneCount: document.getElementById('hasPhoneCount'),
    contactedCount: document.getElementById('contactedCount'),

    // Form
    keyword: document.getElementById('keyword'),
    location: document.getElementById('location'),
    limit: document.getElementById('limit'),
    scrapeMode: document.getElementById('scrapeMode'),
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
    resumeBtn: document.getElementById('resumeBtn'),

    // Progress
    progressSection: document.getElementById('progressSection'),
    progressStatus: document.getElementById('progressStatus'),
    progressCount: document.getElementById('progressCount'),
    progressFill: document.getElementById('progressFill'),
    progressStats: document.getElementById('progressStats'),

    // Results
    resultsSection: document.getElementById('resultsSection'),
    resultsBody: document.getElementById('resultsBody'),
    filterNoWebsite: document.getElementById('filterNoWebsite'),
    filteredCount: document.getElementById('filteredCount'),
    exportExcelBtn: document.getElementById('exportExcelBtn'),
    exportCsvBtn: document.getElementById('exportCsvBtn'),

    // All Leads
    allLeadsBody: document.getElementById('allLeadsBody'),
    filterNoWebsiteAll: document.getElementById('filterNoWebsiteAll'),
    filterHasPhone: document.getElementById('filterHasPhone'),
    filterContacted: document.getElementById('filterContacted'),
    exportAllExcelBtn: document.getElementById('exportAllExcelBtn'),
    exportAllCsvBtn: document.getElementById('exportAllCsvBtn'),

    // History
    historyList: document.getElementById('historyList'),

    // Scrape States
    statesList: document.getElementById('statesList'),
    cleanupStatesBtn: document.getElementById('cleanupStatesBtn'),
    mobileUrl: document.getElementById('mobileUrl'),
    copyMobileUrlBtn: document.getElementById('copyMobileUrlBtn'),

    // Toast
    toast: document.getElementById('toast')
};

// Initialize
async function init() {
    const initResult = await window.electronAPI.initDb();
    console.log('Database init result:', initResult);
    
    if (!initResult.success) {
        showToast(`Lỗi khởi tạo database: ${initResult.error}`, 'error');
    } else {
        console.log('Database stats on init:', initResult.stats);
    }
    
    await loadAllLeads();
    await loadHistory();
    await loadScrapeStates();
    await updateStats();
    await loadMobileServerInfo();
    setupEventListeners();
    setupBackgroundSync();
}

// Event Listeners
function setupEventListeners() {
    // Navigation
    elements.navItems.forEach(item => {
        item.addEventListener('click', () => switchTab(item.dataset.tab));
    });

    // Start/Stop/Resume
    elements.startBtn.addEventListener('click', startScraping);
    elements.stopBtn.addEventListener('click', stopScraping);
    elements.resumeBtn?.addEventListener('click', showResumeDialog);

    // Filters
    elements.filterNoWebsite?.addEventListener('change', () => renderResults(currentResults));
    elements.filterNoWebsiteAll?.addEventListener('change', () => renderAllLeads());
    elements.filterHasPhone?.addEventListener('change', () => renderAllLeads());
    elements.filterContacted?.addEventListener('change', () => renderAllLeads());

    // Export current results
    elements.exportExcelBtn.addEventListener('click', () => exportData('excel', currentResults));
    elements.exportCsvBtn.addEventListener('click', () => exportData('csv', currentResults));

    // Export all leads
    elements.exportAllExcelBtn.addEventListener('click', () => exportData('excel', allLeads));
    elements.exportAllCsvBtn.addEventListener('click', () => exportData('csv', allLeads));

    // Cleanup states
    elements.cleanupStatesBtn?.addEventListener('click', cleanupOldStates);
    elements.copyMobileUrlBtn?.addEventListener('click', () => {
        const url = elements.mobileUrl?.dataset.url;
        if (url) copyToClipboard(url);
    });

    // Progress updates
    window.electronAPI.onScrapeProgress(handleProgress);
}

async function loadMobileServerInfo() {
    if (!elements.mobileUrl || !window.electronAPI.getMobileServerInfo) return;

    const result = await window.electronAPI.getMobileServerInfo();
    if (result.success) {
        const url = result.data.lanUrl;
        elements.mobileUrl.textContent = url;
        elements.mobileUrl.href = url;
        elements.mobileUrl.dataset.url = url;
    } else {
        elements.mobileUrl.textContent = 'Khong mo duoc mobile URL';
        elements.mobileUrl.removeAttribute('href');
        elements.mobileUrl.dataset.url = '';
        showToast(`Loi mobile URL: ${result.error}`, 'warning');
    }
}

function setupBackgroundSync() {
    let syncing = false;
    setInterval(async () => {
        if (syncing || document.hidden || isScanning) return;

        syncing = true;
        try {
            await updateStats();
            const activeTab = document.querySelector('.nav-item.active')?.dataset.tab;
            if (activeTab === 'leads') {
                await loadAllLeads();
            }
        } finally {
            syncing = false;
        }
    }, 5000);
}

// Tab switching
function switchTab(tabId) {
    elements.navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabId);
    });

    elements.tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabId}`);
    });

    if (tabId === 'leads') {
        loadAllLeads();
    } else if (tabId === 'history') {
        loadHistory();
    } else if (tabId === 'states') {
        loadScrapeStates();
    }
}

// Start scraping
async function startScraping() {
    const keyword = elements.keyword.value.trim();
    const location = elements.location.value.trim();
    const limit = parseInt(elements.limit.value) || 20;
    const scrapeMode = elements.scrapeMode?.value || 'all';

    if (!keyword || !location) {
        showToast('Vui lòng nhập từ khóa và vị trí!', 'error');
        return;
    }

    isScanning = true;
    currentResults = [];
    currentSessionId = null;

    // Update UI
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    elements.resumeBtn?.classList.add('hidden');
    elements.progressSection.style.display = 'block';
    elements.resultsSection.style.display = 'none';
    elements.progressFill.style.width = '0%';
    elements.progressStats.textContent = '';

    try {
        const result = await window.electronAPI.startScraping({ keyword, location, limit, scrapeMode });

        if (result.success) {
            currentResults = result.data;
            showToast(`Đã thu thập ${currentResults.length} doanh nghiệp! (Mới: ${result.stats?.inserted || 0}, Cập nhật: ${result.stats?.updated || 0})`, 'success');

            elements.resultsSection.style.display = 'block';
            renderResults(currentResults);

            await loadAllLeads();
            await loadHistory();
            await updateStats();
        } else {
            showToast(`Lỗi: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`Lỗi: ${error.message}`, 'error');
    }

    isScanning = false;
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
}

// Stop scraping
async function stopScraping() {
    await window.electronAPI.stopScraping();
    isScanning = false;
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    
    // Hiển thị nút resume
    elements.resumeBtn?.classList.remove('hidden');
    
    showToast('Đã dừng quét! Có thể resume sau.', 'warning');
    await loadScrapeStates();
}

// Show resume dialog
async function showResumeDialog() {
    const states = await window.electronAPI.getScrapeStates();
    if (!states.success || states.data.length === 0) {
        showToast('Không có session nào để resume!', 'error');
        return;
    }

    const incompleteStates = states.data.filter(s => s.status !== 'completed');
    if (incompleteStates.length === 0) {
        showToast('Tất cả session đã hoàn thành!', 'info');
        return;
    }

    // Hiển thị modal chọn state
    const stateList = incompleteStates.map(s => 
        `${s.keyword} - ${s.location} (${s.resultCount} kết quả, ${s.status})`
    ).join('\n');

    const selected = confirm(`Chọn session để resume:\n\n${stateList}\n\nResume session đầu tiên?`);
    
    if (selected && incompleteStates.length > 0) {
        await resumeScraping(incompleteStates[0].sessionId);
    }
}

// Resume scraping
async function resumeScraping(sessionId) {
    isScanning = true;
    currentSessionId = sessionId;

    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    elements.resumeBtn?.classList.add('hidden');
    elements.progressSection.style.display = 'block';
    elements.progressFill.style.width = '0%';

    try {
        const result = await window.electronAPI.resumeScraping({ sessionId });

        if (result.success) {
            currentResults = result.data;
            showToast(`Resume thành công! ${currentResults.length} doanh nghiệp!`, 'success');

            elements.resultsSection.style.display = 'block';
            renderResults(currentResults);

            await loadAllLeads();
            await loadHistory();
            await updateStats();
        } else {
            showToast(`Lỗi: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`Lỗi: ${error.message}`, 'error');
    }

    isScanning = false;
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    await loadScrapeStates();
}

// Handle progress updates
function handleProgress(data) {
    elements.progressStatus.textContent = data.status;
    elements.progressCount.textContent = `${data.current} / ${data.total}`;

    const percent = data.total > 0 ? (data.current / data.total) * 100 : 0;
    elements.progressFill.style.width = `${percent}%`;

    if (data.stats) {
        elements.progressStats.textContent = `Hợp lệ: ${data.stats.valid}, Không hợp lệ: ${data.stats.invalid}`;
    }

    if (data.canResume && data.sessionId) {
        currentSessionId = data.sessionId;
        elements.resumeBtn?.classList.remove('hidden');
    }

    if (data.lastItem && !currentResults.some(r => r.name === data.lastItem.name)) {
        currentResults.push(data.lastItem);
        renderResults(currentResults);
    }
}

// Open Website Modal
function openWebsiteModal(url, name) {
    if (!url) return;
    const modal = document.getElementById('websiteModal');
    const frame = document.getElementById('websiteFrame');
    const title = document.getElementById('modalTitle');
    const externalBtn = document.getElementById('openExternalBtn');
    
    title.textContent = name;
    
    if (externalBtn) {
        externalBtn.onclick = () => {
            window.electronAPI.openExternal(url);
        };
    }
    
    try {
        const normalizedUrl = url.startsWith('http://') || url.startsWith('https://') ? url : 'https://' + url;
        frame.src = normalizedUrl;
    } catch (e) {
        window.electronAPI.openExternal(url);
        return;
    }
    
    frame.addEventListener('did-fail-load', function onFail(e) {
        if (e.errorCode !== 0 && e.errorCode !== -3) {
            frame.removeEventListener('did-fail-load', onFail);
            window.electronAPI.openExternal(url);
        }
    });
    
    modal.classList.add('show');
}

// Close Website Modal
function closeModal() {
    const modal = document.getElementById('websiteModal');
    const frame = document.getElementById('websiteFrame');
    
    modal.classList.remove('show');
    try { frame.stop(); } catch (e) {}
    frame.src = 'about:blank';
}

// Render results table
function renderResults(data) {
    const filterNoWebsite = elements.filterNoWebsite?.checked || false;
    let filtered = data;

    if (filterNoWebsite) {
        filtered = data.filter(item => !item.hasWebsite && !item.has_website);
    }

    elements.filteredCount.textContent = `Hiển thị ${filtered.length} / ${data.length}`;

    if (filtered.length === 0) {
        elements.resultsBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 40px; color: var(--text-muted);">
          Không có dữ liệu
        </td>
      </tr>
    `;
        return;
    }

    elements.resultsBody.innerHTML = filtered.map((item, index) => `
    <tr class="${!item.hasWebsite && !item.has_website ? 'no-website' : ''}">
      <td>${index + 1}</td>
      <td><strong class="copy-link" onclick="copyToClipboard('${escapeHtml(item.name || '')}')">${escapeHtml(item.name || '')}</strong></td>
      <td>${escapeHtml(item.address || '-')}</td>
      <td>
        ${item.phone
            ? `<span class="phone-link" onclick="copyToClipboard('${escapeHtml(item.phone)}')">${escapeHtml(item.phone)}</span>`
            : '-'}
      </td>
      <td>
        ${item.website || item.has_website
            ? `<span class="website-badge has-website copy-link" data-url="${escapeHtml(item.website || '')}" data-name="${escapeHtml(item.name || '')}" onclick="openWebsiteModal(this.dataset.url, this.dataset.name)">${escapeHtml(item.website || 'Có website')}</span>`
            : `<span class="website-badge no-website">✗ Chưa có</span>`}
      </td>
      <td>
        ${item.rating
            ? `<span class="rating">⭐ ${item.rating} (${item.reviewCount || item.review_count || 0})</span>`
            : '-'}
      </td>
      <td>${escapeHtml(item.category || '-')}</td>
      <td>
        <button class="btn btn-delete-row" onclick="deleteLead(${item.id})" title="Xóa kết quả này">🗑️</button>
      </td>
    </tr>
  `).join('');
}

// Load all leads
async function loadAllLeads() {
    const options = {};
    if (elements.filterNoWebsiteAll?.checked) {
        options.hasWebsite = false;
    }
    if (elements.filterHasPhone?.checked) {
        options.hasPhone = true;
    }
    // Lọc "Chưa liên hệ" - tức là contacted = false
    if (elements.filterContacted?.checked) {
        options.contacted = false;
    }

    console.log('Loading all leads with options:', options);
    const result = await window.electronAPI.getAllLeads(options);
    console.log('getAllLeads result:', result);
    
    if (result.success) {
        allLeads = result.data;
        console.log(`Loaded ${allLeads.length} leads`);
        renderAllLeads();
    } else {
        console.error('Failed to load leads:', result.error);
        showToast(`Lỗi load leads: ${result.error}`, 'error');
    }
}

// Render all leads
function renderAllLeads() {
    console.log('Rendering leads, total count:', allLeads.length);
    
    let filtered = allLeads;

    if (elements.filterNoWebsiteAll?.checked) {
        filtered = filtered.filter(item => !item.has_website);
    }

    if (elements.filterHasPhone?.checked) {
        filtered = filtered.filter(item => item.phone);
    }
    
    console.log('After filtering:', filtered.length);

    if (filtered.length === 0) {
        elements.allLeadsBody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 40px; color: var(--text-muted);">
          Chưa có dữ liệu. Hãy bắt đầu quét!
        </td>
      </tr>
    `;
        return;
    }

    elements.allLeadsBody.innerHTML = filtered.map((item, index) => `
    <tr class="${!item.has_website ? 'no-website' : ''} ${item.contacted ? 'contacted' : ''}">
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(item.name || '')}</strong></td>
      <td>${escapeHtml(item.address || '-')}</td>
      <td>
        ${item.phone
            ? `<span class="phone-link" onclick="copyToClipboard('${escapeHtml(item.phone)}')">${escapeHtml(item.phone)}</span>`
            : '-'}
      </td>
      <td>
        ${item.has_website
            ? `<span class="website-badge has-website">✓ Có</span>`
            : `<span class="website-badge no-website">✗ Chưa có</span>`}
      </td>
      <td>
        ${item.rating
            ? `<span class="rating">⭐ ${item.rating}</span>`
            : '-'}
      </td>
      <td>${escapeHtml(item.keyword || '')} - ${escapeHtml(item.location || '')}</td>
      <td>
        <label class="contacted-checkbox">
          <input type="checkbox" 
                 ${item.contacted ? 'checked' : ''} 
                 onchange="toggleContacted(${item.id}, this.checked)"
                 title="${item.contacted ? 'Đã liên hệ' : 'Chưa liên hệ'}" />
          <span class="checkmark"></span>
        </label>
      </td>
      <td>
        <button class="btn btn-delete-row" onclick="deleteLead(${item.id})" title="Xóa kết quả này">🗑️</button>
      </td>
    </tr>
  `).join('');
}

// Load history
async function loadHistory() {
    const result = await window.electronAPI.getHistory();
    if (result.success) {
        searchHistory = result.data;
        renderHistory();
    }
}

// Render history
function renderHistory() {
    if (searchHistory.length === 0) {
        elements.historyList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📜</div>
        <div class="empty-state-title">Chưa có lịch sử</div>
        <p>Hãy bắt đầu quét để xem lịch sử tại đây</p>
      </div>
    `;
        return;
    }

    elements.historyList.innerHTML = searchHistory.map(item => `
    <div class="history-item" onclick="viewHistoryDetail(${item.id})">
      <div class="history-info">
        <div class="history-title">🔍 ${escapeHtml(item.keyword)} - ${escapeHtml(item.location)}</div>
        <div class="history-meta">
          <span>📊 ${item.result_count} kết quả</span>
          <span>📅 ${formatDate(item.created_at)}</span>
        </div>
      </div>
      <div class="history-actions">
        <button class="btn btn-secondary" onclick="event.stopPropagation(); exportHistoryItem(${item.id})">
          📥 Export
        </button>
        <button class="btn btn-danger" onclick="event.stopPropagation(); deleteHistoryItem(${item.id})">
          🗑️
        </button>
      </div>
    </div>
  `).join('');
}

// Load scrape states
async function loadScrapeStates() {
    const result = await window.electronAPI.getScrapeStates();
    if (result.success) {
        scrapeStates = result.data;
        renderScrapeStates();
    }
}

// Render scrape states
function renderScrapeStates() {
    if (!elements.statesList) return;

    if (scrapeStates.length === 0) {
        elements.statesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💾</div>
        <div class="empty-state-title">Chưa có session nào</div>
        <p>Các session quét chưa hoàn thành sẽ xuất hiện ở đây</p>
      </div>
    `;
        return;
    }

    elements.statesList.innerHTML = scrapeStates.map(item => {
        const statusClass = item.status === 'running' ? 'status-running' : 
                           item.status === 'completed' ? 'status-completed' : 'status-paused';
        const statusText = item.status === 'running' ? 'Đang chạy' : 
                          item.status === 'completed' ? 'Hoàn thành' : 'Tạm dừng';
        
        return `
    <div class="state-item">
      <div class="state-info">
        <div class="state-title">🔍 ${escapeHtml(item.keyword)} - ${escapeHtml(item.location)}</div>
        <div class="state-meta">
          <span class="state-status ${statusClass}">${statusText}</span>
          <span>📊 ${item.resultCount} kết quả</span>
          <span>📅 ${formatDate(item.updatedAt)}</span>
        </div>
      </div>
      <div class="state-actions">
        ${item.status !== 'completed' ? `
        <button class="btn btn-primary" onclick="resumeFromState('${item.sessionId}')">
          ▶️ Resume
        </button>
        ` : ''}
        ${item.status === 'completed' && item.resultCount > 0 ? `
        <button class="btn btn-success" onclick="saveStateResults('${item.sessionId}')">
          Lưu vào Lead
        </button>
        ` : ''}
        <button class="btn btn-danger" onclick="deleteState('${item.sessionId}')">
          🗑️
        </button>
      </div>
    </div>
  `}).join('');
}

// Resume from state
async function resumeFromState(sessionId) {
    await resumeScraping(sessionId);
}

// Save completed state results into the lead database
async function saveStateResults(sessionId) {
    if (!confirm('Lưu kết quả trong session này vào danh sách Lead?')) {
        return;
    }

    try {
        if (!window.electronAPI.saveScrapeStateResults) {
            showToast('Ứng dụng cần khởi động lại để bật chức năng lưu session.', 'error');
            return;
        }

        const result = await window.electronAPI.saveScrapeStateResults(sessionId);
        if (result.success) {
            const total = result.stats?.total ?? result.data?.length ?? 0;
            showToast(`Đã lưu ${total} lead từ session!`, 'success');
            await loadAllLeads();
            await loadHistory();
            await updateStats();
        } else {
            showToast(`Lỗi: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`Lỗi lưu session: ${error.message}`, 'error');
    }
}

// Delete state
async function deleteState(sessionId) {
    if (confirm('Bạn có chắc muốn xóa session này?')) {
        await window.electronAPI.deleteScrapeState(sessionId);
        await loadScrapeStates();
        showToast('Đã xóa session!', 'success');
    }
}

// Cleanup old states
async function cleanupOldStates() {
    if (confirm('Xóa các session cũ hơn 7 ngày?')) {
        const result = await window.electronAPI.cleanupStates(7);
        if (result.success) {
            showToast(`Đã xóa ${result.deletedCount} session cũ!`, 'success');
            await loadScrapeStates();
        }
    }
}

window.saveStateResults = saveStateResults;

// View history detail
async function viewHistoryDetail(searchId) {
    const result = await window.electronAPI.getLeads(searchId);
    if (result.success) {
        currentResults = result.data;
        elements.resultsSection.style.display = 'block';
        renderResults(currentResults);
        switchTab('scraper');
    }
}

// Export history item
async function exportHistoryItem(searchId) {
    const result = await window.electronAPI.getLeads(searchId);
    if (result.success) {
        exportData('excel', result.data);
    }
}

// Delete history item
async function deleteHistoryItem(searchId) {
    if (confirm('Bạn có chắc muốn xóa lịch sử này?')) {
        await window.electronAPI.deleteSearch(searchId);
        await loadHistory();
        await loadAllLeads();
        await updateStats();
        showToast('Đã xóa!', 'success');
    }
}

// Export data
async function exportData(type, data) {
    if (!data || data.length === 0) {
        showToast('Không có dữ liệu để export!', 'error');
        return;
    }

    let result;
    if (type === 'excel') {
        result = await window.electronAPI.exportExcel(data);
    } else {
        result = await window.electronAPI.exportCsv(data);
    }

    if (result.success) {
        showToast(`Đã export thành công: ${result.path}`, 'success');
    } else if (result.error !== 'Cancelled') {
        showToast(`Lỗi: ${result.error}`, 'error');
    }
}

// Update stats
async function updateStats() {
    const result = await window.electronAPI.getLeadStats();
    if (result.success) {
        const stats = result.data;
        elements.totalLeads.textContent = stats.total;
        elements.noWebsiteCount.textContent = stats.noWebsite;
        if (elements.hasPhoneCount) {
            elements.hasPhoneCount.textContent = stats.hasPhone;
        }
        if (elements.contactedCount) {
            elements.contactedCount.textContent = stats.contactedCount;
        }
    }
}

// Toggle contacted status
async function toggleContacted(leadId, contacted) {
    try {
        const result = await window.electronAPI.updateContacted({ leadId, contacted });
        if (result.success) {
            // Update local data
            const lead = allLeads.find(l => l.id === leadId);
            if (lead) {
                lead.contacted = contacted;
            }
            
            showToast(contacted ? 'Đã đánh dấu là đã liên hệ' : 'Đã đánh dấu là chưa liên hệ', 'success');
            await updateStats();
            
            // Reload if filter is active
            if (elements.filterContacted?.checked) {
                await loadAllLeads();
            }
        } else {
            showToast(`Lỗi: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`Lỗi: ${error.message}`, 'error');
    }
}

// Delete single lead
async function deleteLead(leadId) {
    if (!confirm('Bạn có chắc chắn muốn xóa kết quả này?\nKết quả đã xóa sẽ không bị quét lại trong tương lai.')) {
        return;
    }

    try {
        const result = await window.electronAPI.deleteLead(leadId);
        if (result.success) {
            showToast('Đã xóa kết quả!', 'success');
            
            currentResults = currentResults.filter(item => item.id !== leadId);
            allLeads = allLeads.filter(l => l.id !== leadId);
            
            renderResults(currentResults);
            renderAllLeads();
            await loadHistory();
            await updateStats();
        } else {
            showToast(`Lỗi: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`Lỗi: ${error.message}`, 'error');
    }
}

// Utility functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Đã copy: ' + text, 'success');
    });
}

function showToast(message, type = 'success') {
    elements.toast.textContent = message;
    elements.toast.className = `toast ${type} show`;

    setTimeout(() => {
        elements.toast.classList.remove('show');
    }, 3000);
}

// Make functions global
window.copyToClipboard = copyToClipboard;
window.viewHistoryDetail = viewHistoryDetail;
window.exportHistoryItem = exportHistoryItem;
window.deleteHistoryItem = deleteHistoryItem;
window.resumeFromState = resumeFromState;
window.deleteState = deleteState;
window.toggleContacted = toggleContacted;

// Initialize app
init();
