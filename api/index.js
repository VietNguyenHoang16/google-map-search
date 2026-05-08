const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

try {
    require('../src/env').loadEnv({ rootDir: path.join(__dirname, '..') });
} catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'web')));

const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;
const CALL_STATUS_VALUES = new Set(['no_answer', 'rejected', 'contact_later']);

function normalizeCallStatus(value) {
    if (!value) return null;
    return CALL_STATUS_VALUES.has(value) ? value : null;
}

function getPool() {
    if (!DATABASE_URL) throw new Error('DATABASE_URL environment variable is missing');
    if (!pool) {
        pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    }
    return pool;
}

async function initDb() {
    const p = getPool();
    const client = await p.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS searches (
                id SERIAL PRIMARY KEY,
                keyword TEXT NOT NULL,
                location TEXT NOT NULL,
                result_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS deleted_leads (
                id SERIAL PRIMARY KEY,
                place_id TEXT,
                name TEXT,
                normalized_name TEXT,
                address TEXT,
                normalized_address TEXT,
                phone TEXT,
                normalized_phone TEXT,
                deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS leads (
                id SERIAL PRIMARY KEY,
                search_id INTEGER REFERENCES searches(id) ON DELETE CASCADE,
                place_id TEXT,
                name TEXT NOT NULL,
                normalized_name TEXT,
                address TEXT,
                normalized_address TEXT,
                phone TEXT,
                normalized_phone TEXT,
                website TEXT,
                rating REAL,
                review_count INTEGER,
                category TEXT,
                opening_hours TEXT,
                has_website INTEGER DEFAULT 0,
                scraped_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                platform TEXT DEFAULT 'google_maps',
                shop_url TEXT,
                product_count INTEGER,
                follower_count INTEGER,
                response_rate INTEGER,
                response_time TEXT,
                join_time TEXT,
                contacted INTEGER DEFAULT 0,
                call_status TEXT,
                contacted_at TIMESTAMP,
                notes TEXT
            )
        `);
        await client.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS call_status TEXT');
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
            CREATE INDEX IF NOT EXISTS idx_leads_normalized_phone ON leads(normalized_phone);
            CREATE INDEX IF NOT EXISTS idx_leads_place_id ON leads(place_id);
            CREATE INDEX IF NOT EXISTS idx_leads_name_address ON leads(name, address);
            CREATE INDEX IF NOT EXISTS idx_leads_normalized ON leads(normalized_name, normalized_address);
            CREATE INDEX IF NOT EXISTS idx_leads_search_id ON leads(search_id);
            CREATE INDEX IF NOT EXISTS idx_leads_platform ON leads(platform);
            CREATE INDEX IF NOT EXISTS idx_leads_shop_url ON leads(shop_url);
            CREATE INDEX IF NOT EXISTS idx_leads_contacted ON leads(contacted);
            CREATE INDEX IF NOT EXISTS idx_leads_call_status ON leads(call_status);
            CREATE INDEX IF NOT EXISTS idx_deleted_leads_place_id ON deleted_leads(place_id);
            CREATE INDEX IF NOT EXISTS idx_deleted_leads_phone ON deleted_leads(normalized_phone);
            CREATE INDEX IF NOT EXISTS idx_deleted_leads_name_addr ON deleted_leads(normalized_name, normalized_address);
        `);
        console.log('Database tables initialized');
    } finally {
        client.release();
    }
}

// Health
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Init DB + stats
app.post('/api/init-db', async (req, res) => {
    try {
        await initDb();
        const p = getPool();
        const result = await p.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN has_website = 0 THEN 1 END) as no_website,
                COUNT(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 END) as has_phone,
                COUNT(CASE WHEN contacted = 1 THEN 1 END) as contacted
            FROM leads
        `);
        const row = result.rows[0];
        res.json({ success: true, stats: {
            total: parseInt(row.total),
            noWebsite: parseInt(row.no_website),
            hasPhone: parseInt(row.has_phone),
            contactedCount: parseInt(row.contacted)
        }});
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Start scraping - not available on Vercel
app.post('/api/start-scraping', (req, res) => {
    res.json({ success: false, error: 'Scraping khong kha dung tren Vercel. Vui long chay Electron de quet du lieu.' });
});

app.post('/api/stop-scraping', (req, res) => {
    res.json({ success: true });
});

app.get('/api/states', (req, res) => {
    res.json({ success: true, data: [] });
});

app.delete('/api/states/:sessionId', (req, res) => {
    res.json({ success: true });
});

// Search history
app.get('/api/history', async (req, res) => {
    try {
        const p = getPool();
        const result = await p.query('SELECT * FROM searches ORDER BY created_at DESC');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// All leads with filters
app.get('/api/leads', async (req, res) => {
    try {
        const p = getPool();
        let query = 'SELECT * FROM leads WHERE 1=1';
        const params = [];

        if (req.query.hasWebsite === 'false') {
            query += ' AND has_website = 0';
        }
        if (req.query.hasPhone === 'true') {
            query += ' AND phone IS NOT NULL AND phone != \'\'';
        }
        if (req.query.contacted === 'false') {
            query += ' AND contacted = 0';
        }

        query += ' ORDER BY created_at DESC';

        const result = await p.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Leads by search ID
app.get('/api/leads/:searchId', async (req, res) => {
    try {
        const p = getPool();
        const result = await p.query('SELECT * FROM leads WHERE search_id = $1 ORDER BY created_at DESC', [parseInt(req.params.searchId)]);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Stats
app.get('/api/stats', async (req, res) => {
    try {
        const p = getPool();
        const result = await p.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN has_website = 0 THEN 1 END) as no_website,
                COUNT(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 END) as has_phone,
                COUNT(CASE WHEN contacted = 1 THEN 1 END) as contacted
            FROM leads
        `);
        const row = result.rows[0];
        res.json({ success: true, data: {
            total: parseInt(row.total),
            noWebsite: parseInt(row.no_website),
            hasPhone: parseInt(row.has_phone),
            contactedCount: parseInt(row.contacted)
        }});
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Mark contacted
app.put('/api/leads/:leadId/contacted', async (req, res) => {
    try {
        const p = getPool();
        const { contacted, notes, callStatus } = req.body;
        const shouldUpdateCallStatus = Object.prototype.hasOwnProperty.call(req.body, 'callStatus') || !contacted;
        const normalizedCallStatus = normalizeCallStatus(callStatus);
        const nextContacted = contacted || Boolean(normalizedCallStatus);
        const result = await p.query(
            `UPDATE leads
             SET contacted = $1,
                 call_status = CASE WHEN $2 THEN $3 ELSE call_status END,
                 contacted_at = CASE WHEN $1 = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
                 notes = $4,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $5
             RETURNING *`,
            [nextContacted ? 1 : 0, shouldUpdateCallStatus, normalizedCallStatus, notes || null, parseInt(req.params.leadId)]
        );
        if (result.rows.length === 0) {
            return res.json({ success: false, error: 'Lead not found' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Delete lead
app.delete('/api/leads/:leadId', async (req, res) => {
    try {
        const p = getPool();
        const client = await p.connect();
        try {
            await client.query('BEGIN');
            const leadResult = await client.query('SELECT * FROM leads WHERE id = $1', [parseInt(req.params.leadId)]);
            if (leadResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.json({ success: false, error: 'Lead not found' });
            }
            const lead = leadResult.rows[0];
            await client.query(
                'INSERT INTO deleted_leads (place_id, name, normalized_name, address, normalized_address, phone, normalized_phone) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING',
                [lead.place_id, lead.name, lead.normalized_name, lead.address, lead.normalized_address, lead.phone, lead.normalized_phone]
            );
            await client.query('DELETE FROM leads WHERE id = $1', [parseInt(req.params.leadId)]);
            await client.query('COMMIT');
            res.json({ success: true });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Delete search history
app.delete('/api/history/:searchId', async (req, res) => {
    try {
        const p = getPool();
        await p.query('DELETE FROM searches WHERE id = $1', [parseInt(req.params.searchId)]);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

module.exports = app;
