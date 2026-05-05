const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');

const dataDir = path.join(__dirname, 'data');
const exportsDir = path.join(__dirname, 'exports');
const statesDir = path.join(dataDir, 'states');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
if (!fs.existsSync(statesDir)) fs.mkdirSync(statesDir, { recursive: true });

const DATABASE_URL = process.env.DATABASE_URL;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'web')));

const Scraper = require('./src/scraper');
const Database = require('./src/database');
const ExcelExporter = require('./src/exporter');
const LeadValidator = require('./src/validator');

let db = null;
let scraper = null;
const validator = new LeadValidator();

async function initDb() {
    if (!DATABASE_URL) {
        throw new Error('DATABASE_URL environment variable is missing');
    }

    if (!db) {
        db = new Database(DATABASE_URL);
        await db.init();
    }
    return db;
}

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/init-db', async (req, res) => {
    try {
        const dbInstance = await initDb();
        const stats = await dbInstance.getLeadStats();
        res.json({ success: true, stats });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/start-scraping', async (req, res) => {
    try {
        const { keyword, location, limit = 20, scrapeMode = 'all' } = req.body;
        
        if (!keyword || !location) {
            return res.json({ success: false, error: 'Thiếu từ khóa hoặc vị trí' });
        }

        const dbInstance = await initDb();
        scraper = new Scraper();
        await scraper.init();

        let results = await scraper.scrape(keyword, location, limit, (progress) => {
            res.write(`data: ${JSON.stringify(progress)}\n\n`);
        }, null, scrapeMode);

        await scraper.close();

        if (results.length > 0) {
            results = await dbInstance.skipDeletedLeads(results);

            if (results.length === 0) {
                return res.json({ success: true, data: [], stats: { total: 0, inserted: 0, updated: 0 } });
            }

            const searchId = await dbInstance.saveSearch(keyword, location, results.length);
            const saveResults = [];
            
            for (const result of results) {
                result.searchId = searchId;
                const saveResult = await dbInstance.saveLead(result);
                result.id = saveResult.id;
                saveResults.push(saveResult);
            }

            const inserted = saveResults.filter(r => r.action === 'inserted').length;
            const updated = saveResults.filter(r => r.action === 'updated').length;

            return res.json({ 
                success: true, 
                data: results,
                stats: { total: results.length, inserted, updated }
            });
        }

        res.json({ success: true, data: results });
    } catch (error) {
        if (scraper) await scraper.close();
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/stop-scraping', async (req, res) => {
    if (scraper) {
        await scraper.close();
        scraper = null;
    }
    res.json({ success: true });
});

app.get('/api/states', async (req, res) => {
    try {
        const tempScraper = new Scraper();
        const states = tempScraper.getStateManager().listStates();
        res.json({ success: true, data: states });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.delete('/api/states/:sessionId', async (req, res) => {
    try {
        const tempScraper = new Scraper();
        tempScraper.getStateManager().deleteState(req.params.sessionId);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.get('/api/history', async (req, res) => {
    try {
        const dbInstance = await initDb();
        const history = await dbInstance.getSearchHistory();
        res.json({ success: true, data: history });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.get('/api/leads', async (req, res) => {
    try {
        const dbInstance = await initDb();
        const options = {};
        if (req.query.hasWebsite === 'false') options.hasWebsite = false;
        if (req.query.hasPhone === 'true') options.hasPhone = true;
        if (req.query.contacted === 'false') options.contacted = false;
        
        const leads = await dbInstance.getAllLeads(options);
        res.json({ success: true, data: leads });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.get('/api/leads/:searchId', async (req, res) => {
    try {
        const dbInstance = await initDb();
        const leads = await dbInstance.getLeadsBySearch(parseInt(req.params.searchId));
        res.json({ success: true, data: leads });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const dbInstance = await initDb();
        const stats = await dbInstance.getLeadStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.put('/api/leads/:leadId/contacted', async (req, res) => {
    try {
        const dbInstance = await initDb();
        const { contacted, notes } = req.body;
        const result = await dbInstance.updateContacted(parseInt(req.params.leadId), contacted, notes);
        res.json({ success: true, data: result });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.delete('/api/leads/:leadId', async (req, res) => {
    try {
        const dbInstance = await initDb();
        const result = await dbInstance.deleteLead(parseInt(req.params.leadId));
        res.json(result);
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.delete('/api/history/:searchId', async (req, res) => {
    try {
        const dbInstance = await initDb();
        await dbInstance.deleteSearch(parseInt(req.params.searchId));
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

function getLanIp() {
    const interfaces = os.networkInterfaces();

    for (const addresses of Object.values(interfaces)) {
        for (const address of addresses || []) {
            if (address.family === 'IPv4' && !address.internal) {
                return address.address;
            }
        }
    }

    return 'localhost';
}

function listenOnPort(port) {
    return new Promise((resolve, reject) => {
        const server = app.listen(port, '0.0.0.0');

        server.once('listening', () => {
            const actualPort = server.address().port;
            const lanIp = getLanIp();

            resolve({
                server,
                port: actualPort,
                localUrl: `http://localhost:${actualPort}`,
                lanUrl: `http://${lanIp}:${actualPort}`
            });
        });

        server.once('error', reject);
    });
}

async function startWebServer(options = {}) {
    const preferredPort = Number(options.port ?? process.env.PORT ?? 3000);
    const maxAttempts = Number(options.maxAttempts ?? 10);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const port = preferredPort + attempt;
        try {
            return await listenOnPort(port);
        } catch (error) {
            if (!['EADDRINUSE', 'EACCES'].includes(error.code) || attempt === maxAttempts - 1) {
                throw error;
            }
        }
    }

    throw new Error('Unable to start web server');
}

if (require.main === module) {
    startWebServer()
        .then(({ localUrl, lanUrl }) => {
            console.log(`Web server running at ${localUrl}`);
            console.log(`Open on mobile: ${lanUrl}`);
        })
        .catch((error) => {
            console.error('Unable to start web server:', error);
            process.exit(1);
        });
}

module.exports = {
    app,
    startWebServer
};
