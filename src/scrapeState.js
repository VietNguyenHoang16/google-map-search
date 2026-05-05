/**
 * Scrape State Manager - Lưu và khôi phục trạng thái quét
 * Cho phép resume khi bị gián đoạn
 */

const fs = require('fs');
const path = require('path');

class ScrapeStateManager {
  constructor(dataDir = './data') {
    this.stateDir = path.join(dataDir, 'states');
    this.ensureDirectory();
  }

  ensureDirectory() {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
  }

  /**
   * Tạo ID duy nhất cho session
   */
  generateSessionId(keyword, location) {
    const timestamp = Date.now();
    const normalizedKeyword = keyword.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const normalizedLocation = location.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `${normalizedKeyword}_${normalizedLocation}_${timestamp}`;
  }

  /**
   * Lưu trạng thái hiện tại
   */
  saveState(sessionId, state) {
    const stateFile = path.join(this.stateDir, `${sessionId}.json`);
    const stateData = {
      sessionId,
      keyword: state.keyword,
      location: state.location,
      limit: state.limit,
      scrapeMode: state.scrapeMode,
      results: state.results || [],
      scrapedUrls: Array.from(state.scrapedUrls || []),
      scrollAttempts: state.scrollAttempts || 0,
      lastScrollPosition: state.lastScrollPosition || 0,
      status: state.status || 'running',
      error: state.error || null,
      createdAt: state.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(stateFile, JSON.stringify(stateData, null, 2));
    return stateFile;
  }

  /**
   * Load trạng thái từ file
   */
  loadState(sessionId) {
    const stateFile = path.join(this.stateDir, `${sessionId}.json`);
    
    if (!fs.existsSync(stateFile)) {
      return null;
    }

    try {
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      // Convert scrapedUrls back to Set
      data.scrapedUrls = new Set(data.scrapedUrls || []);
      return data;
    } catch (error) {
      console.error('Error loading state:', error);
      return null;
    }
  }

  /**
   * Tìm state gần nhất cho keyword + location
   */
  findRecentState(keyword, location, maxAgeHours = 24) {
    const normalizedKeyword = keyword.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const normalizedLocation = location.toLowerCase().replace(/[^a-z0-9]/g, '_');
    
    const files = fs.readdirSync(this.stateDir);
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

    let recentState = null;
    let recentTime = 0;

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      try {
        const filePath = path.join(this.stateDir, file);
        const stats = fs.statSync(filePath);
        const age = now - stats.mtime.getTime();

        // Chỉ xem xét file trong vòng maxAgeHours
        if (age > maxAgeMs) continue;

        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        // Kiểm tra keyword và location match
        const fileKeyword = data.keyword?.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const fileLocation = data.location?.toLowerCase().replace(/[^a-z0-9]/g, '_');

        if (fileKeyword === normalizedKeyword && fileLocation === normalizedLocation) {
          // Ưu tiên state đang running hoặc paused
          if (data.status === 'running' || data.status === 'paused') {
            if (stats.mtime.getTime() > recentTime) {
              recentTime = stats.mtime.getTime();
              recentState = data;
            }
          }
        }
      } catch (e) {
        console.error('Error reading state file:', e);
      }
    }

    if (recentState) {
      recentState.scrapedUrls = new Set(recentState.scrapedUrls || []);
    }

    return recentState;
  }

  /**
   * Cập nhật trạng thái
   */
  updateState(sessionId, updates) {
    const state = this.loadState(sessionId);
    if (!state) return null;

    const newState = {
      ...state,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    return this.saveState(sessionId, newState);
  }

  /**
   * Đánh dấu state là completed
   */
  markCompleted(sessionId, finalResults = null) {
    return this.updateState(sessionId, {
      status: 'completed',
      results: finalResults || undefined,
      completedAt: new Date().toISOString()
    });
  }

  /**
   * Đánh dấu state là failed
   */
  markFailed(sessionId, error) {
    return this.updateState(sessionId, {
      status: 'failed',
      error: error.message || error,
      failedAt: new Date().toISOString()
    });
  }

  /**
   * Đánh dấu state là paused
   */
  markPaused(sessionId) {
    return this.updateState(sessionId, {
      status: 'paused',
      pausedAt: new Date().toISOString()
    });
  }

  /**
   * Xóa state
   */
  deleteState(sessionId) {
    const stateFile = path.join(this.stateDir, `${sessionId}.json`);
    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
      return true;
    }
    return false;
  }

  /**
   * Lấy danh sách tất cả states
   */
  listStates() {
    const files = fs.readdirSync(this.stateDir);
    const states = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const filePath = path.join(this.stateDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const stats = fs.statSync(filePath);

        states.push({
          sessionId: data.sessionId,
          keyword: data.keyword,
          location: data.location,
          status: data.status,
          resultCount: data.results?.length || 0,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          fileSize: stats.size
        });
      } catch (e) {
        console.error('Error reading state file:', e);
      }
    }

    return states.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  /**
   * Cleanup old states
   */
  cleanupOldStates(maxAgeDays = 7) {
    const files = fs.readdirSync(this.stateDir);
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const filePath = path.join(this.stateDir, file);
        const stats = fs.statSync(filePath);
        const age = now - stats.mtime.getTime();

        if (age > maxAgeMs) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      } catch (e) {
        console.error('Error deleting old state:', e);
      }
    }

    return deletedCount;
  }

  /**
   * Export state để backup
   */
  exportState(sessionId, exportPath) {
    const state = this.loadState(sessionId);
    if (!state) return null;

    fs.writeFileSync(exportPath, JSON.stringify(state, null, 2));
    return exportPath;
  }

  /**
   * Import state từ backup
   */
  importState(importPath) {
    if (!fs.existsSync(importPath)) return null;

    try {
      const data = JSON.parse(fs.readFileSync(importPath, 'utf8'));
      data.scrapedUrls = new Set(data.scrapedUrls || []);
      
      // Tạo sessionId mới để tránh conflict
      data.sessionId = this.generateSessionId(data.keyword, data.location);
      data.importedAt = new Date().toISOString();
      
      this.saveState(data.sessionId, data);
      return data.sessionId;
    } catch (error) {
      console.error('Error importing state:', error);
      return null;
    }
  }
}

module.exports = ScrapeStateManager;
