
export interface ScrapingConfig {
  targetUrl: string;
  maxPages: number;
  delayMs: number;
  outputFormat: 'json' | 'csv' | 'both';
  respectRobots: boolean;
  enableJavaScript: boolean;
  maxDepth: number;
  contentTypes: string[];
}

export interface ScrapedItem {
  title: string;
  content: string;
  content_type: string;
  source_url: string;
  author?: string;
  user_id?: string;
}

export interface ScrapingResult {
  team_id: string;
  items: ScrapedItem[];
}

export class ScrapingEngine {
  private config: ScrapingConfig;
  private visitedUrls: Set<string> = new Set();
  private urlQueue: Array<{url: string, depth: number}> = [];
  private results: ScrapedItem[] = [];
  private domain: string;
  
  public onProgress?: (current: number, total: number, url: string) => void;
  public onLog?: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  public onStats?: (stats: any) => void;
  public onDataExtracted?: (data: ScrapedItem) => void;

  constructor(config: ScrapingConfig) {
    this.config = config;
    try {
      this.domain = new URL(config.targetUrl).hostname;
    } catch {
      throw new Error('Invalid target URL');
    }
  }

  async scrape(): Promise<ScrapingResult> {
    this.log('Initializing universal web scraper...', 'info');
    
    // Initialize queue with starting URL
    this.urlQueue.push({ url: this.config.targetUrl, depth: 0 });
    
    // Check robots.txt if enabled
    if (this.config.respectRobots) {
      await this.checkRobotsTxt();
    }

    let processedCount = 0;
    const maxPages = Math.min(this.config.maxPages, 1000); // Safety limit

    while (this.urlQueue.length > 0 && processedCount < maxPages) {
      const { url, depth } = this.urlQueue.shift()!;
      
      if (this.visitedUrls.has(url) || depth > this.config.maxDepth) {
        continue;
      }

      try {
        this.visitedUrls.add(url);
        processedCount++;

        this.onProgress?.(processedCount, Math.min(this.urlQueue.length + processedCount, maxPages), url);
        this.log(`Scraping page ${processedCount}/${maxPages}: ${url}`);

        const pageData = await this.scrapePage(url, depth);
        
        if (pageData) {
          this.results.push(pageData);
          this.onDataExtracted?.(pageData);
          this.log(`Extracted content: "${pageData.title}"`, 'success');
        }

        // Add delay between requests
        if (this.config.delayMs > 0) {
          await this.delay(this.config.delayMs);
        }

        this.onStats?.({
          linksFound: this.urlQueue.length + this.visitedUrls.size,
          errors: 0 // We'll track this later
        });

      } catch (error) {
        this.log(`Error scraping ${url}: ${error}`, 'error');
        this.onStats?.({ errors: 1 });
      }
    }

    const teamId = this.extractTeamId(this.domain);
    
    this.log(`Scraping completed! Processed ${processedCount} pages, extracted ${this.results.length} items`, 'success');
    
    return {
      team_id: teamId,
      items: this.results
    };
  }

  private async scrapePage(url: string, depth: number): Promise<ScrapedItem | null> {
    try {
      // Simulate browser automation (in real implementation, would use Playwright)
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      
      // Parse HTML and extract content
      const content = this.extractContent(html, url);
      const links = this.extractLinks(html, url, depth);
      
      // Add new links to queue
      links.forEach(link => {
        if (!this.visitedUrls.has(link) && this.isSameDomain(link)) {
          this.urlQueue.push({ url: link, depth: depth + 1 });
        }
      });

      return content;
      
    } catch (error) {
      this.log(`Failed to scrape ${url}: ${error}`, 'error');
      return null;
    }
  }

  private extractContent(html: string, url: string): ScrapedItem | null {
    // This is a simplified content extraction
    // In production, would use more sophisticated parsing
    
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Untitled';
    
    // Extract main content (simplified)
    let content = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Convert to markdown (simplified)
    const markdownContent = this.htmlToMarkdown(content);
    
    if (markdownContent.length < 100) {
      return null; // Skip pages with minimal content
    }

    // Detect content type
    const contentType = this.detectContentType(title, markdownContent, url);
    
    // Extract author
    const author = this.extractAuthor(html);

    return {
      title,
      content: markdownContent,
      content_type: contentType,
      source_url: url,
      author,
      user_id: author ? this.generateUserId(author) : undefined
    };
  }

  private extractLinks(html: string, baseUrl: string, depth: number): string[] {
    const links: string[] = [];
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      try {
        const href = match[1];
        const absoluteUrl = new URL(href, baseUrl).href;
        
        if (this.isSameDomain(absoluteUrl) && !this.isExcludedPath(absoluteUrl)) {
          links.push(absoluteUrl);
        }
      } catch {
        // Invalid URL, skip
      }
    }

    // Also look for dynamic content triggers
    this.extractDynamicContentLinks(html, baseUrl, links);

    return [...new Set(links)]; // Remove duplicates
  }

  private extractDynamicContentLinks(html: string, baseUrl: string, links: string[]): void {
    // Look for buttons and elements that might trigger content loading
    const buttonRegex = /<button[^>]*onclick=["']([^"']+)["'][^>]*>[\s\S]*?(read more|load more|show more|expand)/gi;
    const dataUrlRegex = /data-url=["']([^"']+)["']/gi;
    
    let match;
    while ((match = buttonRegex.exec(html)) !== null) {
      // In real implementation, would execute JavaScript to reveal URLs
      this.log('Found dynamic content trigger - would execute in browser', 'info');
    }
    
    while ((match = dataUrlRegex.exec(html)) !== null) {
      try {
        const url = new URL(match[1], baseUrl).href;
        if (this.isSameDomain(url)) {
          links.push(url);
        }
      } catch {
        // Invalid URL
      }
    }
  }

  private htmlToMarkdown(text: string): string {
    // Basic HTML to Markdown conversion
    return text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  private detectContentType(title: string, content: string, url: string): string {
    const lowerTitle = title.toLowerCase();
    const lowerContent = content.toLowerCase();
    const lowerUrl = url.toLowerCase();

    if (lowerUrl.includes('/blog/') || lowerTitle.includes('blog')) return 'blog';
    if (lowerUrl.includes('/docs/') || lowerTitle.includes('documentation')) return 'documentation';
    if (lowerUrl.includes('/article/') || lowerTitle.includes('article')) return 'article';
    if (lowerUrl.includes('/guide/') || lowerTitle.includes('guide')) return 'guide';
    if (lowerContent.includes('transcript')) return 'transcript';
    if (lowerUrl.includes('/podcast/')) return 'podcast_transcript';
    
    return 'other';
  }

  private extractAuthor(html: string): string | undefined {
    // Look for author meta tags and common patterns
    const authorPatterns = [
      /<meta[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*property=["']article:author["'][^>]*content=["']([^"']+)["']/i,
      /<span[^>]*class=["'][^"']*author[^"']*["'][^>]*>([^<]+)/i,
      /<div[^>]*class=["'][^"']*author[^"']*["'][^>]*>([^<]+)/i,
      /by\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/
    ];

    for (const pattern of authorPatterns) {
      const match = html.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  private generateUserId(author: string): string {
    // Simple hash function for generating consistent user IDs
    let hash = 0;
    for (let i = 0; i < author.length; i++) {
      const char = author.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `user_${Math.abs(hash)}`;
  }

  private isSameDomain(url: string): boolean {
    try {
      const urlDomain = new URL(url).hostname;
      return urlDomain === this.domain || urlDomain.endsWith(`.${this.domain}`);
    } catch {
      return false;
    }
  }

  private isExcludedPath(url: string): boolean {
    const excludedPatterns = [
      /\.(jpg|jpeg|png|gif|svg|pdf|doc|docx|zip|rar)$/i,
      /\/api\//,
      /\/admin\//,
      /\/login/,
      /\/logout/,
      /\/register/,
      /\/search/,
      /\/tag\//,
      /\/category\//,
      /#/
    ];

    return excludedPatterns.some(pattern => pattern.test(url));
  }

  private async checkRobotsTxt(): Promise<void> {
    try {
      const robotsUrl = `https://${this.domain}/robots.txt`;
      const response = await fetch(robotsUrl);
      if (response.ok) {
        const robotsTxt = await response.text();
        this.log(`Found robots.txt - ${robotsTxt.length} characters`, 'info');
        // In production, would parse and respect robots.txt rules
      }
    } catch {
      this.log('No robots.txt found or accessible', 'info');
    }
  }

  private extractTeamId(domain: string): string {
    // Extract a readable team ID from domain
    return domain.replace(/^www\./, '').replace(/\./g, '_');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private log(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info'): void {
    this.onLog?.(message, type);
  }
}
