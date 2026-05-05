/**
 * Data validation utilities for scraped leads
 */

class LeadValidator {
  constructor() {
    this.validationRules = {
      name: {
        required: true,
        minLength: 2,
        maxLength: 200,
        pattern: /^[\p{L}\p{N}\s\-&'().,]+$/u
      },
      phone: {
        required: false,
        pattern: /^[\d\s\-\+\(\)]{8,20}$/,
        normalize: true
      },
      address: {
        required: false,
        minLength: 5,
        maxLength: 500
      },
      website: {
        required: false,
        pattern: /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/,
        normalize: true
      },
      rating: {
        required: false,
        min: 0,
        max: 5
      }
    };
  }

  /**
   * Validate a single lead object
   * @param {Object} lead - Lead object to validate
   * @returns {Object} - { isValid: boolean, errors: [], warnings: [], sanitized: {} }
   */
  validate(lead) {
    const errors = [];
    const warnings = [];
    const sanitized = {};

    if (!lead || typeof lead !== 'object') {
      return {
        isValid: false,
        errors: ['Lead phải là một object'],
        warnings: [],
        sanitized: null
      };
    }

    // Validate name
    const nameValidation = this.validateName(lead.name);
    if (!nameValidation.isValid) {
      errors.push(...nameValidation.errors);
    } else {
      sanitized.name = nameValidation.value;
      sanitized.normalized_name = this.normalizeString(nameValidation.value);
    }

    // Validate phone
    const phoneValidation = this.validatePhone(lead.phone);
    if (phoneValidation.errors.length > 0) {
      errors.push(...phoneValidation.errors);
    } else if (phoneValidation.warnings.length > 0) {
      warnings.push(...phoneValidation.warnings);
    }
    sanitized.phone = phoneValidation.value;
    sanitized.normalized_phone = phoneValidation.normalized;

    // Validate address
    const addressValidation = this.validateAddress(lead.address);
    if (addressValidation.errors.length > 0) {
      errors.push(...addressValidation.errors);
    }
    sanitized.address = addressValidation.value;
    sanitized.normalized_address = addressValidation.normalized;

    // Validate website
    const websiteValidation = this.validateWebsite(lead.website);
    if (websiteValidation.errors.length > 0) {
      errors.push(...websiteValidation.errors);
    }
    sanitized.website = websiteValidation.value;
    sanitized.has_website = !!sanitized.website;

    // Validate rating
    const ratingValidation = this.validateRating(lead.rating);
    if (ratingValidation.errors.length > 0) {
      errors.push(...ratingValidation.errors);
    }
    sanitized.rating = ratingValidation.value;

    // Copy other fields
    sanitized.reviewCount = this.sanitizeNumber(lead.reviewCount);
    sanitized.category = this.sanitizeString(lead.category);
    sanitized.openingHours = this.sanitizeString(lead.openingHours);
    sanitized.placeId = this.sanitizeString(lead.placeId);
    sanitized.scrapedAt = lead.scrapedAt || new Date().toISOString();

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitized
    };
  }

  validateName(name) {
    const errors = [];
    const rules = this.validationRules.name;

    if (rules.required && (!name || !name.trim())) {
      errors.push('Tên doanh nghiệp là bắt buộc');
      return { isValid: false, errors, value: null };
    }

    const trimmedName = name ? name.trim() : '';

    if (trimmedName.length < rules.minLength) {
      errors.push(`Tên doanh nghiệp phải có ít nhất ${rules.minLength} ký tự`);
    }

    if (trimmedName.length > rules.maxLength) {
      errors.push(`Tên doanh nghiệp không được vượt quá ${rules.maxLength} ký tự`);
    }

    if (!rules.pattern.test(trimmedName)) {
      errors.push('Tên doanh nghiệp chứa ký tự không hợp lệ');
    }

    // Check for common spam/invalid patterns
    const spamPatterns = [
      /^\d+$/,
      /^test$/i,
      /^example$/i,
      /^unknown$/i,
      /^n\/a$/i
    ];

    for (const pattern of spamPatterns) {
      if (pattern.test(trimmedName)) {
        errors.push('Tên doanh nghiệp có vẻ không hợp lệ');
        break;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      value: trimmedName
    };
  }

  validatePhone(phone) {
    const errors = [];
    const warnings = [];

    if (!phone || !phone.trim()) {
      return { errors, warnings, value: null, normalized: null };
    }

    let normalizedPhone = phone.trim();

    // Remove common formatting characters
    normalizedPhone = normalizedPhone.replace(/[\s\-\(\)]/g, '');

    // Check if starts with country code
    if (normalizedPhone.startsWith('+84')) {
      normalizedPhone = '0' + normalizedPhone.substring(3);
    } else if (normalizedPhone.startsWith('84') && normalizedPhone.length > 9) {
      normalizedPhone = '0' + normalizedPhone.substring(2);
    }

    // Validate Vietnamese phone format
    const vietnamesePhonePattern = /^(0[1-9][0-9]{8,9})$/;
    if (!vietnamesePhonePattern.test(normalizedPhone)) {
      // Check if it's an international format
      const internationalPattern = /^\+[1-9]\d{7,14}$/;
      if (!internationalPattern.test(phone.trim())) {
        warnings.push('Số điện thoại có thể không đúng định dạng Việt Nam');
      }
    }

    // Check for suspicious patterns
    if (/^(\d)\1{7,}$/.test(normalizedPhone)) {
      warnings.push('Số điện thoại có vẻ không hợp lệ (các số giống nhau)');
    }

    return {
      errors,
      warnings,
      value: phone.trim(),
      normalized: normalizedPhone
    };
  }

  validateAddress(address) {
    const errors = [];

    if (!address || !address.trim()) {
      return { errors, value: null, normalized: null };
    }

    const trimmedAddress = address.trim();

    if (trimmedAddress.length < this.validationRules.address.minLength) {
      errors.push('Địa chỉ quá ngắn');
    }

    if (trimmedAddress.length > this.validationRules.address.maxLength) {
      errors.push('Địa chỉ quá dài');
    }

    // Check for invalid patterns
    const invalidPatterns = [
      /^\d+$/,
      /^test$/i,
      /^unknown$/i,
      /^n\/a$/i
    ];

    for (const pattern of invalidPatterns) {
      if (pattern.test(trimmedAddress)) {
        errors.push('Địa chỉ có vẻ không hợp lệ');
        break;
      }
    }

    return {
      errors,
      value: trimmedAddress,
      normalized: this.normalizeString(trimmedAddress)
    };
  }

  validateWebsite(website) {
    const errors = [];

    if (!website || !website.trim()) {
      return { errors, value: null };
    }

    let trimmedWebsite = website.trim();

    // Remove trailing slashes
    trimmedWebsite = trimmedWebsite.replace(/\/$/, '');

    // Add protocol if missing
    if (!/^https?:\/\//i.test(trimmedWebsite)) {
      trimmedWebsite = 'https://' + trimmedWebsite;
    }

    try {
      const url = new URL(trimmedWebsite);
      
      // Check for valid domain
      const domainPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
      if (!domainPattern.test(url.hostname.replace('www.', ''))) {
        errors.push('Domain website không hợp lệ');
      }

      // Check for common invalid domains
      const invalidDomains = [
        'google.com',
        'facebook.com',
        'goo.gl',
        'bit.ly',
        'maps.google.com'
      ];

      if (invalidDomains.some(d => url.hostname.includes(d))) {
        errors.push('Website không hợp lệ (có thể là link rút gọn hoặc trang mạng xã hội)');
      }
    } catch (e) {
      errors.push('URL website không hợp lệ');
    }

    return {
      errors,
      value: errors.length === 0 ? trimmedWebsite : null
    };
  }

  validateRating(rating) {
    const errors = [];

    if (rating === null || rating === undefined) {
      return { errors, value: null };
    }

    const numRating = parseFloat(rating);

    if (isNaN(numRating)) {
      errors.push('Rating phải là một số');
      return { errors, value: null };
    }

    if (numRating < this.validationRules.rating.min || numRating > this.validationRules.rating.max) {
      errors.push(`Rating phải nằm trong khoảng ${this.validationRules.rating.min} - ${this.validationRules.rating.max}`);
    }

    return {
      errors,
      value: numRating
    };
  }

  normalizeString(str) {
    if (!str) return null;
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  sanitizeString(str) {
    if (!str) return null;
    return str.trim().substring(0, 500);
  }

  sanitizeNumber(num) {
    if (num === null || num === undefined) return null;
    const parsed = parseInt(num);
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * Validate batch of leads
   * @param {Array} leads - Array of lead objects
   * @returns {Object} - { valid: [], invalid: [], stats: {} }
   */
  validateBatch(leads) {
    const valid = [];
    const invalid = [];
    const stats = {
      total: leads.length,
      valid: 0,
      invalid: 0,
      withWarnings: 0,
      errorsByField: {}
    };

    for (const lead of leads) {
      const result = this.validate(lead);

      if (result.isValid) {
        valid.push(result.sanitized);
        stats.valid++;
        if (result.warnings.length > 0) {
          stats.withWarnings++;
        }
      } else {
        invalid.push({
          original: lead,
          errors: result.errors,
          warnings: result.warnings
        });
        stats.invalid++;

        // Track errors by field
        for (const error of result.errors) {
          stats.errorsByField[error] = (stats.errorsByField[error] || 0) + 1;
        }
      }
    }

    return { valid, invalid, stats };
  }

  /**
   * Check if two leads are duplicates
   * @param {Object} lead1 
   * @param {Object} lead2 
   * @returns {boolean}
   */
  isDuplicate(lead1, lead2) {
    // Check by place_id
    if (lead1.placeId && lead2.placeId && lead1.placeId === lead2.placeId) {
      return true;
    }

    // Check by normalized phone
    if (lead1.normalized_phone && lead2.normalized_phone && 
        lead1.normalized_phone === lead2.normalized_phone) {
      return true;
    }

    // Check by normalized name + address
    if (lead1.normalized_name && lead2.normalized_name && 
        lead1.normalized_address && lead2.normalized_address) {
      if (lead1.normalized_name === lead2.normalized_name &&
          lead1.normalized_address === lead2.normalized_address) {
        return true;
      }
    }

    return false;
  }
}

module.exports = LeadValidator;
