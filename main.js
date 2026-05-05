const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Ensure data directories exist (for scrape states and exports)
const dataDir = path.join(__dirname, 'data');
const exportsDir = path.join(__dirname, 'exports');
const statesDir = path.join(dataDir, 'states');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
if (!fs.existsSync(statesDir)) fs.mkdirSync(statesDir, { recursive: true });

// PostgreSQL connection string. Keep the real value in your local environment.
const DATABASE_URL = process.env.DATABASE_URL;

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'src', 'icon.ico'),
        title: 'Google Maps Lead Scraper'
    });

    mainWindow.loadFile('src/index.html');
}

app.whenReady().then(async () => {
    try {
        mobileServer = await startWebServer();
        console.log(`Mobile lead page: ${mobileServer.lanUrl}`);
    } catch (error) {
        mobileServerError = error.message;
        console.error('Mobile web server error:', error);
    }

    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('before-quit', () => {
    if (mobileServer?.server) {
        mobileServer.server.close();
    }
});

// IPC Handlers
const Scraper = require('./src/scraper');
const Database = require('./src/database');
const ExcelExporter = require('./src/exporter');
const LeadValidator = require('./src/validator');
const { startWebServer } = require('./web-server');

let scraper = null;
let db = null;
let mobileServer = null;
let mobileServerError = null;
const validator = new LeadValidator();

ipcMain.handle('get-mobile-server-info', async () => {
    if (mobileServer) {
        return {
            success: true,
            data: {
                port: mobileServer.port,
                localUrl: mobileServer.localUrl,
                lanUrl: mobileServer.lanUrl
            }
        };
    }

    return {
        success: false,
        error: mobileServerError || 'Mobile server is not ready'
    };
});

async function saveScrapedResultsToDatabase(keyword, location, rawResults) {
    let results = rawResults || [];

    if (!db || results.length === 0) {
        return { success: true, data: results };
    }

    console.log(`Filtering skipped leads from ${results.length} results...`);
    results = await db.skipDeletedLeads(results);
    console.log(`After filtering: ${results.length} results`);

    if (results.length === 0) {
        return { success: true, data: [], stats: { total: 0, inserted: 0, updated: 0 } };
    }

    console.log(`Saving ${results.length} results to database...`);
    const searchId = await db.saveSearch(keyword, location, results.length);
    console.log(`Created search with ID: ${searchId}`);

    const saveResults = [];
    for (const result of results) {
        result.searchId = searchId;
        const saveResult = await db.saveLead(result);
        result.id = saveResult.id;
        saveResults.push(saveResult);
    }

    const inserted = saveResults.filter(r => r.action === 'inserted').length;
    const updated = saveResults.filter(r => r.action === 'updated').length;

    console.log(`Save complete: ${inserted} inserted, ${updated} updated`);

    return {
        success: true,
        data: results,
        stats: {
            total: results.length,
            inserted,
            updated
        }
    };
}

// Initialize database
ipcMain.handle('init-db', async () => {
    try {
        if (!DATABASE_URL) {
            return { success: false, error: 'DATABASE_URL environment variable is missing' };
        }

        console.log('Initializing PostgreSQL database...');
        
        const dbInstance = new Database(DATABASE_URL);
        db = await dbInstance.init();
        
        // Log database stats after init
        const stats = await db.getLeadStats();
        console.log('Database initialized with stats:', stats);
        
        return { success: true, stats };
    } catch (error) {
        console.error('Database initialization error:', error);
        return { success: false, error: error.message };
    }
});

// Start scraping
ipcMain.handle('start-scraping', async (event, { keyword, location, limit, resumeSessionId, scrapeMode = 'all' }) => {
    try {
        scraper = new Scraper();
        await scraper.init();

        let results = await scraper.scrape(keyword, location, limit, (progress) => {
            mainWindow.webContents.send('scrape-progress', progress);
        }, resumeSessionId, scrapeMode);

        await scraper.close();

        return await saveScrapedResultsToDatabase(keyword, location, results);
    } catch (error) {
        console.error('Scraping error:', error);
        if (scraper) await scraper.close();
        return { success: false, error: error.message };
    }
});

// Stop scraping
ipcMain.handle('stop-scraping', async () => {
    if (scraper) {
        await scraper.close();
        scraper = null;
    }
    return { success: true };
});

// Resume scraping
ipcMain.handle('resume-scraping', async (event, { sessionId }) => {
    try {
        if (!scraper) {
            scraper = new Scraper();
        }
        
        const stateManager = scraper.getStateManager();
        const state = stateManager.loadState(sessionId);
        
        if (!state) {
            return { success: false, error: 'Không tìm thấy session để resume' };
        }

        await scraper.init();

        let results = await scraper.scrape(
            state.keyword, 
            state.location, 
            state.limit, 
            (progress) => {
                mainWindow.webContents.send('scrape-progress', progress);
            }, 
            sessionId,
            state.scrapeMode || 'all'
        );

        await scraper.close();

        return await saveScrapedResultsToDatabase(state.keyword, state.location, results);
    } catch (error) {
        if (scraper) await scraper.close();
        return { success: false, error: error.message };
    }
});

// Get scrape states
ipcMain.handle('get-scrape-states', async () => {
    try {
        const tempScraper = new Scraper();
        const states = tempScraper.getStateManager().listStates();
        return { success: true, data: states };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Delete scrape state
ipcMain.handle('delete-scrape-state', async (event, sessionId) => {
    try {
        const tempScraper = new Scraper();
        tempScraper.getStateManager().deleteState(sessionId);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Save completed scrape state results to database
ipcMain.handle('save-scrape-state-results', async (event, sessionId) => {
    try {
        if (!db) return { success: false, error: 'Database not initialized' };

        const tempScraper = new Scraper();
        const state = tempScraper.getStateManager().loadState(sessionId);

        if (!state) {
            return { success: false, error: 'Không tìm thấy session' };
        }

        if (!state.results || state.results.length === 0) {
            return { success: false, error: 'Session không có dữ liệu để lưu' };
        }

        return await saveScrapedResultsToDatabase(state.keyword, state.location, state.results);
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Get search history
ipcMain.handle('get-history', async () => {
    try {
        if (!db) {
            console.error('Database not initialized when calling get-history');
            return { success: false, error: 'Database not initialized' };
        }
        const history = await db.getSearchHistory();
        console.log(`get-history: Found ${history.length} searches`);
        return { success: true, data: history };
    } catch (error) {
        console.error('get-history error:', error);
        return { success: false, error: error.message };
    }
});

// Get leads by search ID
ipcMain.handle('get-leads', async (event, searchId) => {
    try {
        if (!db) return { success: false, error: 'Database not initialized' };
        const leads = await db.getLeadsBySearch(searchId);
        return { success: true, data: leads };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Get all leads
ipcMain.handle('get-all-leads', async (event, options = {}) => {
    try {
        if (!db) {
            console.error('Database not initialized when calling get-all-leads');
            return { success: false, error: 'Database not initialized' };
        }
        
        const leads = await db.getAllLeads(options);
        console.log(`get-all-leads: Found ${leads.length} leads`);
        return { success: true, data: leads };
    } catch (error) {
        console.error('get-all-leads error:', error);
        return { success: false, error: error.message };
    }
});

// Get lead stats
ipcMain.handle('get-lead-stats', async () => {
    try {
        if (!db) {
            console.error('Database not initialized when calling get-lead-stats');
            return { success: false, error: 'Database not initialized' };
        }
        const stats = await db.getLeadStats();
        console.log('get-lead-stats:', stats);
        return { success: true, data: stats };
    } catch (error) {
        console.error('get-lead-stats error:', error);
        return { success: false, error: error.message };
    }
});

// Update contacted status
ipcMain.handle('update-contacted', async (event, { leadId, contacted, notes }) => {
    try {
        if (!db) return { success: false, error: 'Database not initialized' };
        const result = await db.updateContacted(leadId, contacted, notes);
        return { success: true, data: result };
    } catch (error) {
        console.error('update-contacted error:', error);
        return { success: false, error: error.message };
    }
});

// Export to Excel
ipcMain.handle('export-excel', async (event, leads) => {
    try {
        const { filePath } = await dialog.showSaveDialog(mainWindow, {
            defaultPath: path.join(exportsDir, `leads_${Date.now()}.xlsx`),
            filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
        });

        if (!filePath) return { success: false, error: 'Cancelled' };

        ExcelExporter.exportToExcel(leads, filePath);
        return { success: true, path: filePath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Export to CSV
ipcMain.handle('export-csv', async (event, leads) => {
    try {
        const { filePath } = await dialog.showSaveDialog(mainWindow, {
            defaultPath: path.join(exportsDir, `leads_${Date.now()}.csv`),
            filters: [{ name: 'CSV Files', extensions: ['csv'] }]
        });

        if (!filePath) return { success: false, error: 'Cancelled' };

        ExcelExporter.exportToCsv(leads, filePath);
        return { success: true, path: filePath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Delete search
ipcMain.handle('delete-search', async (event, searchId) => {
    try {
        if (!db) return { success: false, error: 'Database not initialized' };
        await db.deleteSearch(searchId);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Delete single lead
ipcMain.handle('delete-lead', async (event, leadId) => {
    try {
        if (!db) return { success: false, error: 'Database not initialized' };
        const result = await db.deleteLead(leadId);
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Remove duplicates from database
ipcMain.handle('remove-duplicates', async () => {
    try {
        if (!db) return { success: false, error: 'Database not initialized' };
        await db.removeDuplicates();
        return { success: true, message: 'Đã xóa các bản ghi trùng lặp' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Validate leads
ipcMain.handle('validate-leads', async (event, leads) => {
    try {
        const result = validator.validateBatch(leads);
        return { success: true, data: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Cleanup old states
ipcMain.handle('cleanup-states', async (event, maxAgeDays = 7) => {
    try {
        const tempScraper = new Scraper();
        const deletedCount = tempScraper.getStateManager().cleanupOldStates(maxAgeDays);
        return { success: true, deletedCount };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Open URL in external browser
ipcMain.handle('open-external', async (event, url) => {
    try {
        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
            return { success: false, error: 'Invalid URL' };
        }
        await shell.openExternal(url);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});
