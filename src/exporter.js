const XLSX = require('xlsx');
const fs = require('fs');

class ExcelExporter {
    static exportToExcel(leads, filePath) {
        const data = leads.map((lead, index) => ({
            'STT': index + 1,
            'Tên doanh nghiệp': lead.name || '',
            'Địa chỉ': lead.address || '',
            'Số điện thoại': lead.phone || '',
            'Website': lead.website || 'Không có',
            'Có website': lead.has_website || lead.hasWebsite ? 'Có' : 'KHÔNG',
            'Đánh giá': lead.rating || '',
            'Số lượt đánh giá': lead.review_count || lead.reviewCount || '',
            'Loại hình': lead.category || '',
            'Giờ mở cửa': lead.opening_hours || lead.openingHours || '',
            'Ngày thu thập': lead.scraped_at || lead.scrapedAt || ''
        }));

        const worksheet = XLSX.utils.json_to_sheet(data);

        // Set column widths
        worksheet['!cols'] = [
            { wch: 5 },   // STT
            { wch: 35 },  // Tên
            { wch: 50 },  // Địa chỉ
            { wch: 15 },  // SĐT
            { wch: 30 },  // Website
            { wch: 12 },  // Có website
            { wch: 10 },  // Rating
            { wch: 15 },  // Reviews
            { wch: 20 },  // Category
            { wch: 20 },  // Hours
            { wch: 20 }   // Date
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');

        XLSX.writeFile(workbook, filePath);
        return filePath;
    }

    static exportToCsv(leads, filePath) {
        const headers = [
            'STT',
            'Tên doanh nghiệp',
            'Địa chỉ',
            'Số điện thoại',
            'Website',
            'Có website',
            'Đánh giá',
            'Số lượt đánh giá',
            'Loại hình',
            'Giờ mở cửa',
            'Ngày thu thập'
        ];

        const rows = leads.map((lead, index) => [
            index + 1,
            this.escapeCsv(lead.name || ''),
            this.escapeCsv(lead.address || ''),
            this.escapeCsv(lead.phone || ''),
            this.escapeCsv(lead.website || 'Không có'),
            lead.has_website || lead.hasWebsite ? 'Có' : 'KHÔNG',
            lead.rating || '',
            lead.review_count || lead.reviewCount || '',
            this.escapeCsv(lead.category || ''),
            this.escapeCsv(lead.opening_hours || lead.openingHours || ''),
            lead.scraped_at || lead.scrapedAt || ''
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        // Add BOM for UTF-8
        const bom = '\uFEFF';
        fs.writeFileSync(filePath, bom + csvContent, 'utf8');

        return filePath;
    }

    static escapeCsv(str) {
        if (!str) return '';
        str = String(str);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    }
}

module.exports = ExcelExporter;
