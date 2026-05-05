const { Pool } = require('pg');

class LeadDatabase {
  constructor(connectionString) {
    this.connectionString = connectionString;
    this.pool = null;
  }

  async init() {
    this.pool = new Pool({
      connectionString: this.connectionString,
      ssl: {
        rejectUnauthorized: false
      }
    });

    // Test connection
    const client = await this.pool.connect();
    console.log('PostgreSQL connected successfully');
    client.release();

    await this.createTables();
    return this;
  }

  async createTables() {
    const client = await this.pool.connect();
    try {
      // Create searches table
      await client.query(`
        CREATE TABLE IF NOT EXISTS searches (
          id SERIAL PRIMARY KEY,
          keyword TEXT NOT NULL,
          location TEXT NOT NULL,
          result_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create deleted_leads table (store refs of deleted leads to skip re-scrape)
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

      // Create leads table
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
          contacted_at TIMESTAMP,
          notes TEXT
        )
      `);

      // Create indexes for performance
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

        CREATE INDEX IF NOT EXISTS idx_deleted_leads_place_id ON deleted_leads(place_id);
        CREATE INDEX IF NOT EXISTS idx_deleted_leads_phone ON deleted_leads(normalized_phone);
        CREATE INDEX IF NOT EXISTS idx_deleted_leads_name_addr ON deleted_leads(normalized_name, normalized_address);
      `);

      console.log('Tables and indexes created successfully');
    } finally {
      client.release();
    }
  }

  // Normalize string
  normalizeString(str) {
    if (!str) return null;
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  async saveSearch(keyword, location, resultCount) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO searches (keyword, location, result_count) VALUES ($1, $2, $3) RETURNING id`,
        [keyword, location, resultCount]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  // Check duplicate in database
  async findDuplicate(lead) {
    const client = await this.pool.connect();
    try {
      // 1. Check by place_id (most accurate)
      if (lead.placeId) {
        const result = await client.query(
          'SELECT id FROM leads WHERE place_id = $1 LIMIT 1',
          [lead.placeId]
        );
        if (result.rows.length > 0) {
          return { id: result.rows[0].id, matchType: 'place_id' };
        }
      }

      // 2. Check by phone
      if (lead.phone) {
        const normalizedPhone = this.normalizeString(lead.phone);
        const result = await client.query(
          'SELECT id FROM leads WHERE normalized_phone = $1 OR phone = $2 LIMIT 1',
          [normalizedPhone, lead.phone]
        );
        if (result.rows.length > 0) {
          return { id: result.rows[0].id, matchType: 'phone' };
        }
      }

      // 3. Check by normalized name + address
      const normalizedName = this.normalizeString(lead.name);
      const normalizedAddress = this.normalizeString(lead.address);

      if (normalizedName && normalizedAddress) {
        const result = await client.query(
          `SELECT id FROM leads 
           WHERE (normalized_name = $1 AND normalized_address = $2)
           OR (name = $3 AND address = $4)
           LIMIT 1`,
          [normalizedName, normalizedAddress, lead.name, lead.address]
        );
        if (result.rows.length > 0) {
          return { id: result.rows[0].id, matchType: 'name_address' };
        }
      }

      return null;
    } finally {
      client.release();
    }
  }

  // UPSERT - Insert or Update if exists
  async saveLead(lead) {
    const client = await this.pool.connect();
    try {
      const normalizedName = this.normalizeString(lead.name);
      const normalizedAddress = this.normalizeString(lead.address);
      const normalizedPhone = this.normalizeString(lead.phone);

      // Find duplicate
      const duplicate = await this.findDuplicate(lead);

      if (duplicate) {
        // Update with latest info
        await client.query(
          `UPDATE leads SET
            search_id = COALESCE($1, search_id),
            name = COALESCE($2, name),
            normalized_name = COALESCE($3, normalized_name),
            address = COALESCE($4, address),
            normalized_address = COALESCE($5, normalized_address),
            phone = COALESCE($6, phone),
            normalized_phone = COALESCE($7, normalized_phone),
            website = COALESCE($8, website),
            rating = COALESCE($9, rating),
            review_count = COALESCE($10, review_count),
            category = COALESCE($11, category),
            opening_hours = COALESCE($12, opening_hours),
            has_website = COALESCE($13, has_website),
            scraped_at = COALESCE($14, scraped_at),
            platform = COALESCE($15, platform),
            shop_url = COALESCE($16, shop_url),
            product_count = COALESCE($17, product_count),
            follower_count = COALESCE($18, follower_count),
            response_rate = COALESCE($19, response_rate),
            response_time = COALESCE($20, response_time),
            join_time = COALESCE($21, join_time),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $22`,
          [
            lead.searchId,
            lead.name,
            normalizedName,
            lead.address,
            normalizedAddress,
            lead.phone,
            normalizedPhone,
            lead.website,
            lead.rating,
            lead.reviewCount,
            lead.category,
            lead.openingHours,
            lead.hasWebsite ? 1 : 0,
            lead.scrapedAt,
            lead.platform || 'google_maps',
            lead.shopUrl || null,
            lead.productCount || null,
            lead.followerCount || null,
            lead.responseRate || null,
            lead.responseTime || null,
            lead.joinTime || null,
            duplicate.id
          ]
        );
        return { id: duplicate.id, action: 'updated', matchType: duplicate.matchType };
      } else {
        // Insert new
        const result = await client.query(
          `INSERT INTO leads (
            search_id, place_id, name, normalized_name, address, normalized_address,
            phone, normalized_phone, website, rating, review_count, category,
            opening_hours, has_website, scraped_at, platform, shop_url,
            product_count, follower_count, response_rate, response_time, join_time, contacted
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
          RETURNING id`,
          [
            lead.searchId,
            lead.placeId || null,
            lead.name,
            normalizedName,
            lead.address,
            normalizedAddress,
            lead.phone,
            normalizedPhone,
            lead.website,
            lead.rating,
            lead.reviewCount,
            lead.category,
            lead.openingHours,
            lead.hasWebsite ? 1 : 0,
            lead.scrapedAt,
            lead.platform || 'google_maps',
            lead.shopUrl || null,
            lead.productCount || null,
            lead.followerCount || null,
            lead.responseRate || null,
            lead.responseTime || null,
            lead.joinTime || null,
            0 // contacted = false by default
          ]
        );
        return { id: result.rows[0].id, action: 'inserted' };
      }
    } finally {
      client.release();
    }
  }

  // Update contacted status
  async updateContacted(leadId, contacted, notes = null) {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE leads SET 
          contacted = $1, 
          contacted_at = CASE WHEN $1 = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
          notes = COALESCE($2, notes),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3`,
        [contacted ? 1 : 0, notes, leadId]
      );
      return { success: true };
    } finally {
      client.release();
    }
  }

  // Batch save leads
  async saveLeadsBatch(leads) {
    const results = { inserted: 0, updated: 0, errors: [] };

    for (const lead of leads) {
      try {
        const result = await this.saveLead(lead);
        if (result.action === 'inserted') {
          results.inserted++;
        } else {
          results.updated++;
        }
      } catch (error) {
        results.errors.push({ lead: lead.name, error: error.message });
      }
    }

    return results;
  }

  async getSearchHistory() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT 
          s.id,
          s.keyword,
          s.location,
          COUNT(l.id)::int AS result_count,
          s.created_at
        FROM searches s
        LEFT JOIN leads l ON l.search_id = s.id
        GROUP BY s.id, s.keyword, s.location, s.created_at
        HAVING COUNT(l.id) > 0
        ORDER BY s.created_at DESC
        LIMIT 100`
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getLeadsBySearch(searchId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM leads WHERE search_id = $1 ORDER BY has_website ASC, rating DESC`,
        [searchId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getAllLeads(options = {}) {
    const client = await this.pool.connect();
    try {
      let query = `
        SELECT l.*, s.keyword, s.location 
        FROM leads l 
        LEFT JOIN searches s ON l.search_id = s.id 
      `;

      const conditions = [];
      const params = [];
      let paramIndex = 1;

      if (options.hasWebsite !== undefined) {
        conditions.push(`l.has_website = $${paramIndex}`);
        params.push(options.hasWebsite ? 1 : 0);
        paramIndex++;
      }

      if (options.hasPhone !== undefined) {
        conditions.push(options.hasPhone ? 'l.phone IS NOT NULL' : 'l.phone IS NULL');
      }

      if (options.platform) {
        conditions.push(`l.platform = $${paramIndex}`);
        params.push(options.platform);
        paramIndex++;
      }

      if (options.contacted !== undefined) {
        conditions.push(`l.contacted = $${paramIndex}`);
        params.push(options.contacted ? 1 : 0);
        paramIndex++;
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY l.updated_at DESC, l.created_at DESC';

      if (options.limit) {
        query += ` LIMIT $${paramIndex}`;
        params.push(parseInt(options.limit));
        paramIndex++;
      } else {
        query += ' LIMIT 1000';
      }

      const result = await client.query(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getLeadsWithoutWebsite() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM leads WHERE has_website = 0 ORDER BY rating DESC`
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getLeadStats() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN has_website = 0 THEN 1 ELSE 0 END) as no_website,
          SUM(CASE WHEN phone IS NOT NULL THEN 1 ELSE 0 END) as has_phone,
          SUM(CASE WHEN place_id IS NOT NULL THEN 1 ELSE 0 END) as has_place_id,
          SUM(CASE WHEN platform = 'shopee' THEN 1 ELSE 0 END) as shopee_count,
          SUM(CASE WHEN platform = 'google_maps' THEN 1 ELSE 0 END) as google_maps_count,
          SUM(CASE WHEN contacted = 1 THEN 1 ELSE 0 END) as contacted_count
        FROM leads
      `);

      const row = result.rows[0];
      return {
        total: parseInt(row.total) || 0,
        noWebsite: parseInt(row.no_website) || 0,
        hasPhone: parseInt(row.has_phone) || 0,
        hasPlaceId: parseInt(row.has_place_id) || 0,
        shopeeCount: parseInt(row.shopee_count) || 0,
        googleMapsCount: parseInt(row.google_maps_count) || 0,
        contactedCount: parseInt(row.contacted_count) || 0
      };
    } finally {
      client.release();
    }
  }

  async deleteSearch(searchId) {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM leads WHERE search_id = $1', [searchId]);
      await client.query('DELETE FROM searches WHERE id = $1', [searchId]);
    } finally {
      client.release();
    }
  }

  // Delete single lead and store reference to prevent future re-scrape
  async deleteLead(leadId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query('SELECT * FROM leads WHERE id = $1', [leadId]);
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Lead not found' };
      }

      const lead = result.rows[0];
      await client.query(
        `INSERT INTO deleted_leads (place_id, name, normalized_name, address, normalized_address, phone, normalized_phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [lead.place_id, lead.name, lead.normalized_name, lead.address, lead.normalized_address, lead.phone, lead.normalized_phone]
      );

      await client.query('DELETE FROM leads WHERE id = $1', [leadId]);

      if (lead.search_id) {
        const countResult = await client.query(
          'SELECT COUNT(*)::int AS count FROM leads WHERE search_id = $1',
          [lead.search_id]
        );
        const remainingCount = countResult.rows[0].count || 0;

        if (remainingCount === 0) {
          await client.query('DELETE FROM searches WHERE id = $1', [lead.search_id]);
        } else {
          await client.query(
            'UPDATE searches SET result_count = $1 WHERE id = $2',
            [remainingCount, lead.search_id]
          );
        }

        await client.query('COMMIT');
        return { success: true, searchId: lead.search_id, remainingCount };
      }

      await client.query('COMMIT');
      return { success: true, searchId: null, remainingCount: null };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Check if a lead matches any previously deleted lead
  async isLeadDeleted(lead) {
    const client = await this.pool.connect();
    try {
      const conditions = [];
      const params = [];
      let paramIndex = 1;

      if (lead.placeId) {
        conditions.push(`place_id = $${paramIndex}`);
        params.push(lead.placeId);
        paramIndex++;
      }

      if (lead.phone) {
        const normalizedPhone = this.normalizeString(lead.phone);
        conditions.push(`(normalized_phone = $${paramIndex} OR phone = $${paramIndex + 1})`);
        params.push(normalizedPhone, lead.phone);
        paramIndex += 2;
      }

      const normalizedName = this.normalizeString(lead.name);
      const normalizedAddress = this.normalizeString(lead.address);
      if (normalizedName && normalizedAddress) {
        conditions.push(`(normalized_name = $${paramIndex} AND normalized_address = $${paramIndex + 1})`);
        params.push(normalizedName, normalizedAddress);
        paramIndex += 2;
      }

      if (conditions.length === 0) return false;

      const query = `SELECT id FROM deleted_leads WHERE ${conditions.join(' OR ')} LIMIT 1`;
      const result = await client.query(query, params);
      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  // Filter out leads that match deleted_leads
  async skipDeletedLeads(leads) {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT place_id, normalized_phone, normalized_name, normalized_address FROM deleted_leads');
      const deletedRows = result.rows;

      if (deletedRows.length === 0) return leads;

      const deletedPlaceIds = new Set(deletedRows.map(r => r.place_id).filter(Boolean));
      const deletedPhones = new Set(deletedRows.map(r => r.normalized_phone).filter(Boolean));
      const deletedNameAddr = new Set(
        deletedRows
          .filter(r => r.normalized_name && r.normalized_address)
          .map(r => `${r.normalized_name}|${r.normalized_address}`)
      );

      return leads.filter(lead => {
        if (lead.placeId && deletedPlaceIds.has(lead.placeId)) return false;
        if (lead.phone && deletedPhones.has(this.normalizeString(lead.phone))) return false;
        if (lead.normalized_phone && deletedPhones.has(lead.normalized_phone)) return false;

        const nn = lead.normalized_name || this.normalizeString(lead.name);
        const na = lead.normalized_address || this.normalizeString(lead.address);
        if (nn && na && deletedNameAddr.has(`${nn}|${na}`)) return false;

        return true;
      });
    } finally {
      client.release();
    }
  }

  // Remove duplicate leads
  async removeDuplicates() {
    const client = await this.pool.connect();
    try {
      await client.query(`
        DELETE FROM leads 
        WHERE id NOT IN (
          SELECT MAX(id) 
          FROM leads 
          GROUP BY COALESCE(normalized_phone, normalized_name || normalized_address)
        )
      `);
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

module.exports = LeadDatabase;
