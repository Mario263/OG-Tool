
import { ScrapingResult, ScrapedItem } from './ScrapingEngine';

export class OutputFormatter {
  downloadJSON(data: ScrapingResult, filename: string): void {
    const jsonString = JSON.stringify(data, null, 2);
    this.downloadFile(jsonString, filename, 'application/json');
  }

  downloadCSV(data: ScrapingResult, filename: string): void {
    const headers = ['source', 'url', 'content', 'author', 'content_type', 'title'];
    const csvRows = [
      headers.join(','),
      ...data.items.map(item => [
        this.escapeCSV(data.team_id),
        this.escapeCSV(item.source_url),
        this.escapeCSV(item.content),
        this.escapeCSV(item.author || ''),
        this.escapeCSV(item.content_type),
        this.escapeCSV(item.title)
      ].join(','))
    ];
    
    const csvString = csvRows.join('\n');
    this.downloadFile(csvString, filename, 'text/csv');
  }

  downloadMarkdown(data: ScrapingResult, filename: string): void {
    const markdownContent = this.formatAsMarkdown(data);
    this.downloadFile(markdownContent, filename, 'text/markdown');
  }

  private formatAsMarkdown(data: ScrapingResult): string {
    let markdown = `# ${data.team_id} - Scraped Content\n\n`;
    markdown += `Generated on: ${new Date().toISOString()}\n`;
    markdown += `Total items: ${data.items.length}\n\n`;
    markdown += '---\n\n';

    data.items.forEach((item, index) => {
      markdown += `## ${index + 1}. ${item.title}\n\n`;
      markdown += `**Source:** ${item.source_url}\n`;
      markdown += `**Type:** ${item.content_type}\n`;
      if (item.author) {
        markdown += `**Author:** ${item.author}\n`;
      }
      markdown += '\n';
      markdown += item.content;
      markdown += '\n\n---\n\n';
    });

    return markdown;
  }

  private escapeCSV(text: string): string {
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
  }

  exportToParquet(data: ScrapingResult): Uint8Array {
    // Placeholder for Parquet export
    // In production, would use a library like parquetjs
    throw new Error('Parquet export not implemented yet');
  }

  validateOutput(data: ScrapingResult): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!data.team_id) {
      errors.push('Missing team_id');
    }
    
    if (!Array.isArray(data.items)) {
      errors.push('Items must be an array');
    } else {
      data.items.forEach((item, index) => {
        if (!item.title) errors.push(`Item ${index}: Missing title`);
        if (!item.content) errors.push(`Item ${index}: Missing content`);
        if (!item.source_url) errors.push(`Item ${index}: Missing source_url`);
        if (!item.content_type) errors.push(`Item ${index}: Missing content_type`);
      });
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  generateReport(data: ScrapingResult): string {
    const totalItems = data.items.length;
    const contentTypes = data.items.reduce((acc, item) => {
      acc[item.content_type] = (acc[item.content_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const authors = data.items
      .filter(item => item.author)
      .reduce((acc, item) => {
        acc[item.author!] = (acc[item.author!] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    const avgContentLength = data.items.reduce((sum, item) => sum + item.content.length, 0) / totalItems;

    let report = `# Scraping Report for ${data.team_id}\n\n`;
    report += `**Total Items:** ${totalItems}\n`;
    report += `**Average Content Length:** ${Math.round(avgContentLength)} characters\n\n`;
    
    report += `## Content Types\n`;
    Object.entries(contentTypes).forEach(([type, count]) => {
      report += `- ${type}: ${count} items (${((count / totalItems) * 100).toFixed(1)}%)\n`;
    });
    
    if (Object.keys(authors).length > 0) {
      report += `\n## Top Authors\n`;
      Object.entries(authors)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .forEach(([author, count]) => {
          report += `- ${author}: ${count} items\n`;
        });
    }

    return report;
  }
}
