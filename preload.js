const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Database
    initDb: () => ipcRenderer.invoke('init-db'),
    getMobileServerInfo: () => ipcRenderer.invoke('get-mobile-server-info'),

    // Scraping
    startScraping: (options) => ipcRenderer.invoke('start-scraping', options),
    stopScraping: () => ipcRenderer.invoke('stop-scraping'),
    resumeScraping: (options) => ipcRenderer.invoke('resume-scraping', options),
    onScrapeProgress: (callback) => ipcRenderer.on('scrape-progress', (event, data) => callback(data)),

    // Scrape States (Resume functionality)
    getScrapeStates: () => ipcRenderer.invoke('get-scrape-states'),
    deleteScrapeState: (sessionId) => ipcRenderer.invoke('delete-scrape-state', sessionId),
    saveScrapeStateResults: (sessionId) => ipcRenderer.invoke('save-scrape-state-results', sessionId),
    cleanupStates: (maxAgeDays) => ipcRenderer.invoke('cleanup-states', maxAgeDays),

    // History
    getHistory: () => ipcRenderer.invoke('get-history'),
    getLeads: (searchId) => ipcRenderer.invoke('get-leads', searchId),
    getAllLeads: (options) => ipcRenderer.invoke('get-all-leads', options),
    deleteSearch: (searchId) => ipcRenderer.invoke('delete-search', searchId),
    updateContacted: (data) => ipcRenderer.invoke('update-contacted', data),

    // Stats
    getLeadStats: () => ipcRenderer.invoke('get-lead-stats'),

    // Data Management
    removeDuplicates: () => ipcRenderer.invoke('remove-duplicates'),
    validateLeads: (leads) => ipcRenderer.invoke('validate-leads', leads),
    deleteLead: (leadId) => ipcRenderer.invoke('delete-lead', leadId),

    // Export
    exportExcel: (leads) => ipcRenderer.invoke('export-excel', leads),
    exportCsv: (leads) => ipcRenderer.invoke('export-csv', leads),

    // External browser
    openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
