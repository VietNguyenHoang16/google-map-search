const API_URL = getApiBaseUrl();

let currentResults = [];
let allLeads = [];
let searchHistory = [];
let isScanning = false;
let activeTab = 'leads';
let lastSyncAt = 0;
const CALL_STATUS_OPTIONS = [
    { value: '', label: 'Chưa có trạng thái' },
    { value: 'no_answer', label: 'Không bốc máy' },
    { value: 'rejected', label: 'Từ chối' },
    { value: 'contact_later', label: 'Liên hệ sau' },
    { value: 'closed', label: 'Đã nghỉ kinh doanh' }
];

const elements = {
    keyword: document.getElementById('keyword'),
    location: document.getElementById('location'),
    limit: document.getElementById('limit'),
    scrapeMode: document.getElementById('scrapeMode'),
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
    progressCard: document.getElementById('progressCard'),
    progressStatus: document.getElementById('progressStatus'),
    progressCount: document.getElementById('progressCount'),
    progressFill: document.getElementById('progressFill'),
    resultsCard: document.getElementById('resultsCard'),
    resultCount: document.getElementById('resultCount'),
    resultsList: document.getElementById('resultsList'),
    filterNoWebsite: document.getElementById('filterNoWebsite'),
    leadsList: document.getElementById('leadsList'),
    leadSearch: document.getElementById('leadSearch'),
    filterNoWebsiteAll: document.getElementById('filterNoWebsiteAll'),
    filterHasPhone: document.getElementById('filterHasPhone'),
    filterContacted: document.getElementById('filterContacted'),
    historyList: document.getElementById('historyList'),
    totalLeads: document.getElementById('totalLeads'),
    noWebsiteCount: document.getElementById('noWebsiteCount'),
    contactedCount: document.getElementById('contactedCount'),
    apiConfig: document.getElementById('apiConfig'),
    apiBaseInput: document.getElementById('apiBaseInput'),
    saveApiBaseBtn: document.getElementById('saveApiBaseBtn'),
    toast: document.getElementById('toast'),
    navBtns: document.querySelectorAll('.nav-btn'),
    tabContents: document.querySelectorAll('.tab-content')
};

async function init() {
    setupEvents();
    setupApiConfig();
    switchTab('leads');

    const result = await apiCall('/api/init-db', 'POST');
    if (result.success) {
        updateStats(result.stats);
    }

    await loadAllLeads();
    await loadHistory();
    startAutoSync();
}

function setupEvents() {
    elements.navBtns.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    elements.startBtn?.addEventListener('click', startScraping);
    elements.stopBtn?.addEventListener('click', stopScraping);

    elements.filterNoWebsite?.addEventListener('change', () => renderResults(currentResults));
    elements.filterNoWebsiteAll?.addEventListener('change', () => loadAllLeads());
    elements.filterHasPhone?.addEventListener('change', () => loadAllLeads());
    elements.filterContacted?.addEventListener('change', () => loadAllLeads());
    elements.leadSearch?.addEventListener('input', renderLeads);
    elements.saveApiBaseBtn?.addEventListener('click', saveApiBaseUrl);
}

function getApiBaseUrl() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('api');
    if (fromQuery) {
        const normalized = normalizeApiUrl(fromQuery);
        localStorage.setItem('leadApiBaseUrl', normalized);
        return normalized;
    }

    return normalizeApiUrl(localStorage.getItem('leadApiBaseUrl') || '');
}

function normalizeApiUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
}

function setupApiConfig() {
    if (!elements.apiConfig) return;

    elements.apiBaseInput.value = API_URL;
    const needsApi = location.hostname.endsWith('github.io') && !API_URL;
    elements.apiConfig.classList.toggle('show', needsApi);

    if (needsApi) {
        showToast('Can nhap API HTTPS de dong bo lead', 'error');
    }
}

function saveApiBaseUrl() {
    const value = normalizeApiUrl(elements.apiBaseInput?.value || '');
    if (!value || !value.startsWith('https://')) {
        showToast('API tren GitHub Pages can la HTTPS', 'error');
        return;
    }

    localStorage.setItem('leadApiBaseUrl', value);
    window.location.reload();
}

function switchTab(tabId) {
    activeTab = tabId;

    elements.navBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    elements.tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabId}`);
    });

    if (tabId === 'leads') loadAllLeads();
    else if (tabId === 'history') loadHistory();
}

function startAutoSync() {
    setInterval(async () => {
        if (document.hidden || isScanning) return;

        const stats = await apiCall('/api/stats');
        if (stats.success) updateStats(stats.data);

        if (activeTab === 'leads') {
            await loadAllLeads({ silent: true });
        }
    }, 5000);
}

async function apiCall(endpoint, method = 'GET', body = null) {
    try {
        const options = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(API_URL + endpoint, options);
        return await res.json();
    } catch (error) {
        showToast('Loi ket noi: ' + error.message, 'error');
        return { success: false, error: error.message };
    }
}

async function startScraping() {
    const keyword = elements.keyword.value.trim();
    const location = elements.location.value.trim();
    const limit = parseInt(elements.limit.value, 10) || 20;
    const scrapeMode = elements.scrapeMode?.value || 'all';

    if (!keyword || !location) {
        showToast('Nhap tu khoa va vi tri!', 'error');
        return;
    }

    isScanning = true;
    currentResults = [];
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    elements.progressCard.style.display = 'block';
    elements.resultsCard.style.display = 'none';
    elements.progressStatus.textContent = 'Dang quet...';
    elements.progressCount.textContent = `0/${limit}`;
    elements.progressFill.style.width = '10%';

    try {
        const result = await apiCall('/api/start-scraping', 'POST', { keyword, location, limit, scrapeMode });

        if (result.success) {
            currentResults = result.data || [];
            showToast(`Da quet ${currentResults.length} doanh nghiep!`, 'success');
            elements.resultsCard.style.display = 'block';
            elements.progressFill.style.width = '100%';
            elements.progressCount.textContent = `${currentResults.length}/${limit}`;
            renderResults(currentResults);
            await loadAllLeads();
            await loadHistory();
            const stats = await apiCall('/api/stats');
            if (stats.success) updateStats(stats.data);
        } else {
            showToast('Loi: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Loi: ' + error.message, 'error');
    }

    isScanning = false;
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
}

async function stopScraping() {
    await apiCall('/api/stop-scraping', 'POST');
    isScanning = false;
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    showToast('Da dung!', 'success');
}

function renderResults(data) {
    const filterNoWebsite = elements.filterNoWebsite?.checked || false;
    let filtered = data || [];

    if (filterNoWebsite) {
        filtered = filtered.filter(item => !item.hasWebsite && !item.has_website);
    }

    elements.resultCount.textContent = filtered.length;

    if (filtered.length === 0) {
        elements.resultsList.innerHTML = '<div class="empty-state">Không có dữ liệu</div>';
        return;
    }

    elements.resultsList.innerHTML = filtered.map(item => renderLeadCard(item, { allowDelete: false })).join('');
}

async function loadAllLeads(options = {}) {
    const params = {};
    if (elements.filterNoWebsiteAll?.checked) params.hasWebsite = 'false';
    if (elements.filterHasPhone?.checked) params.hasPhone = 'true';
    if (elements.filterContacted?.checked) params.contacted = 'false';

    const query = new URLSearchParams(params).toString();
    const result = await apiCall('/api/leads' + (query ? '?' + query : ''));

    if (result.success) {
        allLeads = result.data || [];
        lastSyncAt = Date.now();
        renderLeads();
    } else if (!options.silent) {
        showToast(`Loi load lead: ${result.error}`, 'error');
    }
}

function renderLeads() {
    const keyword = normalizeSearch(elements.leadSearch?.value || '');
    let filtered = allLeads;

    if (keyword) {
        filtered = filtered.filter(item => {
            const haystack = normalizeSearch(`${item.name || ''} ${item.address || ''} ${item.phone || ''}`);
            return haystack.includes(keyword);
        });
    }

    if (filtered.length === 0) {
        elements.leadsList.innerHTML = '<div class="empty-state">Chưa có lead phù hợp</div>';
        return;
    }

    elements.leadsList.innerHTML = filtered.map(item => renderLeadCard(item, { allowDelete: true })).join('');
}

function renderLeadCard(item, options = {}) {
    const phone = item.phone || '';
    const contacted = Boolean(Number(item.contacted));
    const callStatus = getCallStatusValue(item);
    const callStatusLabel = getCallStatusLabel(callStatus);
    const websiteText = item.has_website || item.hasWebsite ? 'Có web' : 'Chưa web';
    const source = [item.keyword, item.location].filter(Boolean).join(' - ');

    return `
        <article class="lead-item ${!item.has_website && !item.hasWebsite ? 'no-website' : ''} ${contacted ? 'contacted' : ''} ${callStatus ? 'has-call-status' : ''}">
            <div class="lead-main">
                <label class="called-toggle" title="${contacted ? 'Đã gọi' : 'Chưa gọi'}">
                    <input type="checkbox" ${contacted ? 'checked' : ''} onchange="toggleContacted(${item.id}, this.checked)">
                    <span></span>
                </label>
                <div class="lead-copy">
                    <div class="lead-name">${escapeHtml(item.name || '')}</div>
                    <div class="lead-address">${escapeHtml(item.address || '-')}</div>
                </div>
            </div>

            <div class="lead-actions">
                ${phone ? `<a class="call-btn" href="${escapeAttr(telHref(phone))}" onclick="markCalledAfterTap(${item.id})">Gọi ${escapeHtml(phone)}</a>` : '<span class="call-btn disabled">Không có SĐT</span>'}
                <button class="contact-btn ${contacted ? 'done' : ''}" onclick="toggleContacted(${item.id}, ${!contacted})">
                    ${contacted ? 'Đã gọi' : 'Tick đã gọi'}
                </button>
                <button class="search-btn" onclick="searchLeadInfo(${item.id})" title="Tìm kiếm thông tin về lead này">Tìm kiếm</button>
                <label class="call-status-label">
                    <span>Trạng thái phụ</span>
                    <select onchange="updateCallStatus(${item.id}, this.value)">
                        ${renderCallStatusOptions(callStatus)}
                    </select>
                </label>
            </div>

            <div class="lead-info">
                <span class="lead-badge ${item.has_website || item.hasWebsite ? 'website has' : 'website no'}">${websiteText}</span>
                ${callStatus ? `<span class="lead-badge call-status ${callStatus}">${escapeHtml(callStatusLabel)}</span>` : ''}
                ${item.rating ? `<span class="lead-badge">Rating ${escapeHtml(String(item.rating))}</span>` : ''}
                ${source ? `<span class="lead-badge source">${escapeHtml(source)}</span>` : ''}
            </div>

            ${options.allowDelete ? `<button class="delete-link" onclick="deleteLead(${item.id})">Xóa lead</button>` : ''}
        </article>
    `;
}

function renderCallStatusOptions(selectedValue) {
    return CALL_STATUS_OPTIONS.map(option => `
        <option value="${escapeAttr(option.value)}" ${option.value === selectedValue ? 'selected' : ''}>
            ${escapeHtml(option.label)}
        </option>
    `).join('');
}

function getCallStatusValue(item) {
    const value = item?.call_status || item?.callStatus || '';
    return CALL_STATUS_OPTIONS.some(option => option.value === value) ? value : '';
}

function getCallStatusLabel(value) {
    return CALL_STATUS_OPTIONS.find(option => option.value === value)?.label || '';
}

async function loadHistory() {
    const result = await apiCall('/api/history');
    if (result.success) {
        searchHistory = result.data || [];
        renderHistory();
    }
}

function renderHistory() {
    if (searchHistory.length === 0) {
        elements.historyList.innerHTML = '<div class="empty-state">Chua co lich su</div>';
        return;
    }

    elements.historyList.innerHTML = searchHistory.map(item => `
        <div class="history-item">
            <div class="history-title">${escapeHtml(item.keyword)} - ${escapeHtml(item.location)}</div>
            <div class="history-meta">
                <span>${item.result_count} ket qua</span>
                <span>${formatDate(item.created_at)}</span>
            </div>
        </div>
    `).join('');
}

async function toggleContacted(leadId, contacted) {
    const lead = findLeadById(leadId);
    const previous = lead ? { contacted: lead.contacted, call_status: lead.call_status } : null;
    if (lead) {
        lead.contacted = contacted ? 1 : 0;
        if (!contacted) lead.call_status = null;
    }
    refreshLeadViews();

    const result = await apiCall(`/api/leads/${leadId}/contacted`, 'PUT', {
        contacted,
        callStatus: contacted ? getCallStatusValue(lead) : ''
    });
    if (result.success) {
        showToast(contacted ? 'Đã tick đã gọi' : 'Đã bỏ tick', 'success');
        const stats = await apiCall('/api/stats');
        if (stats.success) updateStats(stats.data);
        if (elements.filterContacted?.checked) await loadAllLeads({ silent: true });
    } else {
        if (lead && previous) {
            lead.contacted = previous.contacted;
            lead.call_status = previous.call_status;
        }
        refreshLeadViews();
        showToast(`Loi: ${result.error}`, 'error');
    }
}

async function updateCallStatus(leadId, callStatus) {
    const lead = findLeadById(leadId);
    const previous = lead ? { contacted: lead.contacted, call_status: lead.call_status } : null;
    const nextCallStatus = CALL_STATUS_OPTIONS.some(option => option.value === callStatus) ? callStatus : '';

    if (lead) {
        lead.call_status = nextCallStatus || null;
        if (nextCallStatus) lead.contacted = 1;
    }
    refreshLeadViews();

    const result = await apiCall(`/api/leads/${leadId}/contacted`, 'PUT', {
        contacted: lead ? Boolean(Number(lead.contacted)) : Boolean(nextCallStatus),
        callStatus: nextCallStatus
    });

    if (result.success) {
        showToast(nextCallStatus ? `Đã lưu: ${getCallStatusLabel(nextCallStatus)}` : 'Đã xóa trạng thái phụ', 'success');
        const stats = await apiCall('/api/stats');
        if (stats.success) updateStats(stats.data);
        if (elements.filterContacted?.checked && nextCallStatus) await loadAllLeads({ silent: true });
    } else {
        if (lead && previous) {
            lead.contacted = previous.contacted;
            lead.call_status = previous.call_status;
        }
        refreshLeadViews();
        showToast(`Loi: ${result.error}`, 'error');
    }
}

function findLeadById(leadId) {
    return allLeads.find(item => item.id === leadId) || currentResults.find(item => item.id === leadId);
}

function refreshLeadViews() {
    if (activeTab === 'leads') renderLeads();
    if (currentResults.length > 0) renderResults(currentResults);
}

function markCalledAfterTap(leadId) {
    const lead = allLeads.find(item => item.id === leadId);
    if (!lead || Boolean(Number(lead.contacted))) return;
    setTimeout(() => toggleContacted(leadId, true), 250);
}

async function deleteLead(leadId) {
    if (!confirm('Ban co chac muon xoa lead nay? Lead da xoa se khong bi quet lai.')) {
        return;
    }

    const result = await apiCall(`/api/leads/${leadId}`, 'DELETE');
    if (result.success) {
        allLeads = allLeads.filter(item => item.id !== leadId);
        renderLeads();
        await loadHistory();
        const stats = await apiCall('/api/stats');
        if (stats.success) updateStats(stats.data);
        showToast('Da xoa lead', 'success');
    } else {
        showToast(`Loi: ${result.error}`, 'error');
    }
}

function updateStats(stats) {
    if (!stats) return;
    elements.totalLeads.textContent = stats.total || 0;
    elements.noWebsiteCount.textContent = stats.noWebsite || 0;
    if (elements.contactedCount) elements.contactedCount.textContent = stats.contactedCount || 0;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, '&quot;');
}

function normalizeSearch(text) {
    return String(text)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function telHref(phone) {
    const cleaned = String(phone).replace(/[^\d+]/g, '');
    return `tel:${cleaned}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('vi-VN');
}

function showToast(message, type = 'success') {
    elements.toast.textContent = message;
    elements.toast.className = `toast ${type} show`;
    setTimeout(() => elements.toast.classList.remove('show'), 2500);
}

function searchLeadInfo(leadId) {
    const lead = findLeadById(leadId);
    if (!lead) {
        showToast('Không tìm thấy lead', 'error');
        return;
    }

    const searchQuery = `${lead.name || ''} ${lead.address || ''}`.trim();
    if (!searchQuery) {
        showToast('Không đủ thông tin để tìm kiếm', 'error');
        return;
    }

    const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
    window.open(googleSearchUrl, '_blank', 'noopener');
}

window.toggleContacted = toggleContacted;
window.updateCallStatus = updateCallStatus;
window.markCalledAfterTap = markCalledAfterTap;
window.deleteLead = deleteLead;
window.searchLeadInfo = searchLeadInfo;

init();
