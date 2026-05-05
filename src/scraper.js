const puppeteer = require('puppeteer');
const LeadValidator = require('./validator');
const ScrapeStateManager = require('./scrapeState');

class Scraper {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.scrapedUrls = new Set();
    this.retryCount = 3;
    this.scrollDelay = 2000;
    this.validator = new LeadValidator();
    this.stateManager = new ScrapeStateManager();
    this.sessionId = null;
    this.state = null;
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--lang=vi-VN',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    this.page = await this.browser.newPage();
    
    await this.page.setViewport({ width: 1920, height: 1080 });
    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });
    
    this.isRunning = true;
  }

  async scrape(keyword, location, limit, onProgress, resumeSessionId = null, scrapeMode = 'all') {
    const results = [];
    const searchQuery = `${keyword} ${location}`;
    this.scrapeMode = scrapeMode;

    try {
      // Kiểm tra có state cũ để resume không
      if (resumeSessionId) {
        const savedState = this.stateManager.loadState(resumeSessionId);
        if (savedState && savedState.status !== 'completed') {
          this.sessionId = resumeSessionId;
          this.state = savedState;
          this.scrapedUrls = savedState.scrapedUrls;
          this.scrapeMode = savedState.scrapeMode || 'all';
          results.push(...(savedState.results || []));
          onProgress({ 
            status: `Đang resume từ lần quét trước (${results.length} kết quả)...`, 
            current: results.length, 
            total: limit 
          });
        }
      }

      // Tạo session mới nếu không resume
      if (!this.sessionId) {
        this.sessionId = this.stateManager.generateSessionId(keyword, location);
        this.state = {
          keyword,
          location,
          limit,
          scrapeMode,
          results: [],
          scrapedUrls: new Set(),
          scrollAttempts: 0,
          lastScrollPosition: 0,
          status: 'running'
        };
      }

      onProgress({ status: 'Đang mở Google Maps...', current: results.length, total: limit });

      await this.navigateWithRetry('https://www.google.com/maps?hl=vi', 3);
      await this.delay(3000);

      // Kiểm tra CAPTCHA
      const hasCaptcha = await this.detectCaptcha();
      if (hasCaptcha) {
        onProgress({ status: '⚠️ Phát hiện CAPTCHA - Vui lòng giải CAPTCHA trong 60 giây...', current: results.length, total: limit });
        await this.waitForCaptchaResolution(60000);
      }

      onProgress({ status: 'Đang tìm kiếm...', current: results.length, total: limit });
      await this.performSearchWithRetry(searchQuery);
      await this.delay(5000);

      const hasCaptchaAfterSearch = await this.detectCaptcha();
      if (hasCaptchaAfterSearch) {
        onProgress({ status: '⚠️ Phát hiện CAPTCHA sau tìm kiếm...', current: results.length, total: limit });
        await this.waitForCaptchaResolution(60000);
      }

      await this.waitForResultsWithRetry();
      onProgress({ status: 'Đang thu thập dữ liệu...', current: results.length, total: limit });

      // Scroll và collect với auto-save
      await this.scrollAndCollect(results, limit, onProgress);

      // Validate tất cả results trước khi hoàn thành
      const validationResult = this.validator.validateBatch(results);
      
      // Lọc kết quả theo chế độ quét
      let finalResults = validationResult.valid;
      let skippedCount = 0;
      
      if (this.scrapeMode === 'no_website') {
        const beforeFilter = finalResults.length;
        finalResults = finalResults.filter(r => !r.hasWebsite && !r.has_website);
        skippedCount = beforeFilter - finalResults.length;
      }

      if (this.scrapeMode === 'only_phone') {
        const beforeFilter = finalResults.length;
        finalResults = finalResults.filter(r => r.phone || r.normalized_phone);
        skippedCount = beforeFilter - finalResults.length;
      }

      let skipMsg = '';
      if (skippedCount > 0) {
        if (this.scrapeMode === 'no_website') skipMsg = ` (đã bỏ qua ${skippedCount} cửa hàng có website)`;
        else if (this.scrapeMode === 'only_phone') skipMsg = ` (đã bỏ qua ${skippedCount} cửa hàng không có SĐT)`;
      }

      onProgress({ 
        status: `Hoàn thành! ${finalResults.length} kết quả${skipMsg}`, 
        current: finalResults.length, 
        total: limit, 
        done: true,
        stats: validationResult.stats
      });

      // Mark state as completed
      this.stateManager.markCompleted(this.sessionId, finalResults);

      return finalResults;

    } catch (error) {
      console.error('Scraping error:', error);
      
      // Save state để resume sau
      if (this.sessionId) {
        this.stateManager.updateState(this.sessionId, {
          status: 'paused',
          results,
          scrapedUrls: Array.from(this.scrapedUrls),
          error: error.message,
          scrapeMode: this.scrapeMode
        });
      }
      
      onProgress({ 
        status: `Lỗi: ${error.message}. Đã lưu trạng thái để resume sau.`, 
        current: results.length, 
        total: limit, 
        error: true,
        canResume: true,
        sessionId: this.sessionId
      });

      return results;
    }
  }

  async navigateWithRetry(url, maxRetries) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.page.goto(url, { 
          waitUntil: 'networkidle2', 
          timeout: 60000 
        });
        return;
      } catch (e) {
        console.log(`Navigation attempt ${i + 1} failed: ${e.message}`);
        if (i === maxRetries - 1) throw e;
        await this.delay(3000);
      }
    }
  }

  async detectCaptcha() {
    try {
      const captchaSelectors = [
        'form[action*="/sorry"]',
        '#captcha-form',
        '.g-recaptcha',
        'iframe[src*="recaptcha"]',
        'text/Bot detected',
        'text/Xác minh',
        'text/Verify'
      ];
      
      for (const selector of captchaSelectors) {
        const element = await this.page.$(selector);
        if (element) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async waitForCaptchaResolution(timeout) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const hasCaptcha = await this.detectCaptcha();
      if (!hasCaptcha) return;
      await this.delay(2000);
    }
    throw new Error('Hết thờ gian chờ giải CAPTCHA');
  }

  async performSearchWithRetry(searchQuery) {
    const searchInputSelectors = [
      '#searchboxinput',
      'input[id^="searchboxinput"]',
      'input[name="q"]',
      'input[aria-label="Tìm kiếm trên Google Maps"]',
      'input[placeholder*="tìm"]'
    ];

    let searchBox = null;
    for (const selector of searchInputSelectors) {
      try {
        searchBox = await this.page.waitForSelector(selector, { timeout: 5000 });
        if (searchBox) break;
      } catch (e) { /* continue */ }
    }

    if (!searchBox) {
      throw new Error('Không tìm thấy ô tìm kiếm trên Google Maps');
    }

    await searchBox.click();
    await this.page.evaluate((el) => el.value = '', searchBox);
    await searchBox.type(searchQuery, { delay: 50 });
    await this.page.keyboard.press('Enter');

    const searchBtnSelector = '#searchbox-searchbutton';
    try {
      const searchBtn = await this.page.$(searchBtnSelector);
      if (searchBtn) await searchBtn.click();
    } catch (e) { /* ignore */ }
  }

  async waitForResultsWithRetry() {
    const resultSelectors = [
      '[role="feed"]',
      '[data-result-index]',
      '.section-result',
      'a[href*="/maps/place"]'
    ];

    for (const selector of resultSelectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 15000 });
        return;
      } catch (e) { /* continue */ }
    }
    throw new Error('Không tìm thấy kết quả tìm kiếm');
  }

  async scrollAndCollect(results, limit, onProgress) {
    let noNewCountAttempts = 0;
    const maxNoNewAttempts = 5;
    let scrollAttempts = this.state?.scrollAttempts || 0;
    const maxScrollAttempts = 100;
    let autoSaveCounter = 0;

    while (results.length < limit && scrollAttempts < maxScrollAttempts && this.isRunning) {
      const cards = await this.getBusinessCards();
      console.log(`Found ${cards.length} cards, already processed: ${this.scrapedUrls.size}`);

      let newItemsInThisScroll = 0;

      for (let i = 0; i < cards.length && results.length < limit && this.isRunning; i++) {
        const card = cards[i];
        
        const cardId = await this.getCardIdentifier(card);
        if (!cardId || this.scrapedUrls.has(cardId)) {
          continue;
        }

        try {
          const businessData = await this.extractBusinessDataWithRetry(card);

          if (businessData && businessData.name) {
            // Validate trước khi check duplicate
            const validation = this.validator.validate(businessData);
            
            if (!validation.isValid) {
              console.log(`Skipping invalid data: ${validation.errors.join(', ')}`);
              this.scrapedUrls.add(cardId);
              continue;
            }

            const sanitizedData = validation.sanitized;

            // Check duplicate
            const isDuplicate = this.isDuplicateResult(results, sanitizedData);
            
            if (!isDuplicate) {
              // Kiểm tra chế độ quét - nếu chỉ quét cửa hàng không có website
              if (this.scrapeMode === 'no_website' && (sanitizedData.hasWebsite || sanitizedData.has_website)) {
                console.log(`Skipping ${sanitizedData.name} - has website (no_website mode)`);
                this.scrapedUrls.add(cardId);
                continue;
              }

              // Kiểm tra chế độ quét - chỉ lấy cửa hàng CÓ số điện thoại
              if (this.scrapeMode === 'only_phone' && !sanitizedData.phone && !sanitizedData.normalized_phone) {
                console.log(`Skipping ${sanitizedData.name} - no phone (only_phone mode)`);
                this.scrapedUrls.add(cardId);
                continue;
              }

              results.push(sanitizedData);
              this.scrapedUrls.add(cardId);
              newItemsInThisScroll++;
              
              onProgress({
                status: `Đã thu thập: ${sanitizedData.name}`,
                current: results.length,
                total: limit,
                lastItem: sanitizedData
              });

              // Auto-save mỗi 10 items
              autoSaveCounter++;
              if (autoSaveCounter >= 10) {
                this.saveCurrentState(results, scrollAttempts);
                autoSaveCounter = 0;
              }
            }
          }
        } catch (err) {
          console.error('Error extracting business:', err.message);
          this.scrapedUrls.add(cardId);
        }
      }

      if (newItemsInThisScroll === 0) {
        noNewCountAttempts++;
        if (noNewCountAttempts >= maxNoNewAttempts) {
          console.log('No new items after multiple attempts, stopping...');
          break;
        }
      } else {
        noNewCountAttempts = 0;
      }

      if (results.length < limit) {
        await this.performScroll();
        scrollAttempts++;
        
        // Save state sau mỗi lần scroll
        if (this.sessionId) {
          this.state.scrollAttempts = scrollAttempts;
        }
      }
    }

    // Final save
    this.saveCurrentState(results, scrollAttempts);
  }

  saveCurrentState(results, scrollAttempts) {
    if (this.sessionId) {
      this.stateManager.saveState(this.sessionId, {
        ...this.state,
        results,
        scrapedUrls: this.scrapedUrls,
        scrollAttempts,
        status: 'running'
      });
    }
  }

  async getBusinessCards() {
    const selectors = [
      '[role="feed"] > div > div > a',
      '[role="feed"] a[href*="/maps/place"]',
      '[data-result-index]',
      '.section-result',
      'a[href*="/maps/place/"]'
    ];

    for (const selector of selectors) {
      try {
        const cards = await this.page.$$(selector);
        if (cards.length > 0) return cards;
      } catch (e) { /* continue */ }
    }
    return [];
  }

  async getCardIdentifier(card) {
    try {
      const href = await this.page.evaluate(el => el.href, card);
      if (href) return href;
      
      const index = await this.page.evaluate(el => el.getAttribute('data-result-index'), card);
      if (index) return index;
      
      const text = await this.page.evaluate(el => el.textContent, card);
      return text ? text.substring(0, 100) : null;
    } catch (e) {
      return null;
    }
  }

  async extractBusinessDataWithRetry(card) {
    let lastError;
    
    for (let attempt = 0; attempt < this.retryCount; attempt++) {
      try {
        await card.click();
        await this.delay(2500);

        const data = await this.extractBusinessData();
        
        try {
          const url = this.page.url();
          const placeIdMatch = url.match(/place\/([^\/]+)/);
          if (placeIdMatch) {
            data.placeId = placeIdMatch[1];
          }
        } catch (e) {}
        
        return data;
      } catch (err) {
        lastError = err;
        console.log(`Extract attempt ${attempt + 1} failed: ${err.message}`);
        await this.delay(1000);
      }
    }
    
    throw lastError;
  }

  async extractBusinessData() {
    try {
      const data = await this.page.evaluate(() => {
        const getText = (selectors) => {
          for (const selector of selectors) {
            try {
              const el = document.querySelector(selector);
              if (el && el.textContent.trim()) {
                return el.textContent.trim();
              }
            } catch (e) {}
          }
          return null;
        };

        const getAttr = (selectors, attr) => {
          for (const selector of selectors) {
            try {
              const el = document.querySelector(selector);
              if (el && el.getAttribute(attr)) {
                return el.getAttribute(attr);
              }
            } catch (e) {}
          }
          return null;
        };

        const getName = () => {
          return getText([
            'h1.DUwDvf',
            'h1[class*="title"]',
            '[role="main"] h1',
            '.section-hero-header-title'
          ]);
        };

        const getAddress = () => {
          const text = getText([
            '[data-item-id="address"] .fontBodyMedium',
            '[data-item-id="address"]',
            'button[data-item-id*="address"]',
            '[aria-label*="địa chỉ"]',
            '[aria-label*="address"]'
          ]);
          if (text) return text;

          const buttons = document.querySelectorAll('button[data-item-id]');
          for (const btn of buttons) {
            const itemId = btn.getAttribute('data-item-id') || '';
            if (itemId.includes('address')) {
              return btn.textContent.trim();
            }
          }
          return null;
        };

        const getPhone = () => {
          const text = getText([
            '[data-item-id^="phone:"] .fontBodyMedium',
            '[data-item-id^="phone:"]',
            'button[data-item-id^="phone:"]',
            '[aria-label*="số điện thoại"]',
            '[aria-label*="phone"]'
          ]);
          if (text) return text;

          const buttons = document.querySelectorAll('button[data-item-id]');
          for (const btn of buttons) {
            const itemId = btn.getAttribute('data-item-id') || '';
            if (itemId.startsWith('phone:')) {
              const text = btn.textContent.trim();
              const match = text.match(/[\d\s\-\+\(\)]{8,}/);
              return match ? match[0].trim() : text;
            }
          }
          return null;
        };

        const getWebsite = () => {
          const text = getText([
            '[data-item-id="authority"] .fontBodyMedium',
            '[data-item-id="authority"]',
            'a[data-item-id="authority"]'
          ]);
          if (text) return text;

          const href = getAttr(['a[data-item-id="authority"]'], 'href');
          if (href && !href.startsWith('javascript')) return href;

          const links = document.querySelectorAll('a[href^="http"]');
          for (const link of links) {
            const href = link.href;
            if (!href.includes('google.com') && !href.includes('goo.gl')) {
              return href;
            }
          }
          return null;
        };

        const getRating = () => {
          const text = getText([
            '.F7nice span[aria-hidden="true"]',
            '.section-star-display',
            '[role="img"][aria-label*="sao"]',
            '[role="img"][aria-label*="star"]'
          ]);
          if (text) {
            const match = text.match(/(\d+\.?\d*)/);
            return match ? parseFloat(match[1]) : null;
          }
          return null;
        };

        const getReviewCount = () => {
          const text = getText([
            '.F7nice span:last-child',
            '.section-rating-term',
            '[aria-label*="đánh giá"]',
            '[aria-label*="reviews"]'
          ]);
          if (text) {
            const match = text.match(/[\d,.]+/);
            return match ? parseInt(match[0].replace(/[,.]/g, '')) : null;
          }
          return null;
        };

        const getCategory = () => {
          return getText([
            'button.DkEaL',
            'button[class*="category"]',
            '[class*="category"]',
            '.section-rating-term:first-child'
          ]);
        };

        const getOpeningHours = () => {
          return getText([
            '[data-item-id="oh"] .fontBodyMedium',
            '[data-item-id="oh"]',
            'button[data-item-id="oh"]',
            '[aria-label*="giờ"]',
            '[aria-label*="hours"]'
          ]);
        };

        return {
          name: getName(),
          address: getAddress(),
          phone: getPhone(),
          website: getWebsite(),
          rating: getRating(),
          reviewCount: getReviewCount(),
          category: getCategory(),
          openingHours: getOpeningHours(),
          hasWebsite: !!getWebsite(),
          scrapedAt: new Date().toISOString()
        };
      });

      return data;
    } catch (error) {
      console.error('Extract error:', error);
      return null;
    }
  }

  normalizeString(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  isDuplicateResult(results, newData) {
    return this.validator.isDuplicate(
      { 
        placeId: newData.placeId, 
        normalized_phone: newData.normalized_phone,
        normalized_name: newData.normalized_name,
        normalized_address: newData.normalized_address
      },
      results.map(r => ({
        placeId: r.placeId,
        normalized_phone: r.normalized_phone,
        normalized_name: r.normalized_name,
        normalized_address: r.normalized_address
      }))
    );
  }

  async performScroll() {
    const feedSelectors = [
      '[role="feed"]',
      '.section-scrollbox',
      '[class*="scroll"]'
    ];

    for (const selector of feedSelectors) {
      try {
        const feed = await this.page.$(selector);
        if (feed) {
          await this.page.evaluate((feedEl) => {
            feedEl.scrollBy(0, 800);
          }, feed);
          await this.delay(this.scrollDelay);
          return;
        }
      } catch (e) {}
    }

    await this.page.evaluate(() => window.scrollBy(0, 800));
    await this.delay(this.scrollDelay);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async close() {
    this.isRunning = false;
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
    this.scrapedUrls.clear();
  }

  // Public methods cho state management
  getStateManager() {
    return this.stateManager;
  }

  getCurrentSessionId() {
    return this.sessionId;
  }
}

module.exports = Scraper;
