import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts"

interface ScrapingConfig {
  targetUrl: string;
  maxPages: number;
  delayMs: number;
  maxDepth: number;
  respectRobots: boolean;
}

interface ScrapedItem {
  title: string;
  content: string;
  content_type: string;
  source_url: string;
  author?: string;
  user_id?: string;
}

interface ScrapingResult {
  team_id: string;
  items: ScrapedItem[];
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

class ServerScraper {
  private config: ScrapingConfig;
  private visitedUrls: Set<string> = new Set();
  private urlQueue: Array<{url: string, depth: number}> = [];
  private results: ScrapedItem[] = [];
  private domain: string;

  constructor(config: ScrapingConfig) {
    this.config = config;
    this.domain = new URL(config.targetUrl).hostname;
  }

  async scrape(): Promise<ScrapingResult> {
    console.log(`Starting enhanced server-side scraping for: ${this.config.targetUrl}`);
    this.urlQueue.push({ url: this.config.targetUrl, depth: 0 });

    let processedCount = 0;
    const maxPages = Math.min(this.config.maxPages, 100);

    while (this.urlQueue.length > 0 && processedCount < maxPages) {
      const { url, depth } = this.urlQueue.shift()!;
      
      if (this.visitedUrls.has(url) || depth > this.config.maxDepth) {
        continue;
      }

      try {
        this.visitedUrls.add(url);
        processedCount++;

        console.log(`Fetching: ${url}`);

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          }
        });

        if (!response.ok) {
          console.error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
          continue;
        }

        const html = await response.text();
        console.log(`Received HTML of length: ${html.length}`);
        
        // Extract content from this page
        const pageContent = this.extractContent(html, url);
        if (pageContent) {
          this.results.push(pageContent);
          console.log(`✅ Extracted 1 items from ${url}`);
        }

        // Extract and queue new links for further scraping
        const newLinks = this.extractLinks(html, url, depth);
        console.log(`Found ${newLinks.length} new links on ${url}`);
        
        newLinks.forEach(link => {
          if (!this.visitedUrls.has(link) && this.isSameDomain(link) && !this.isExcludedPath(link)) {
            this.urlQueue.push({ url: link, depth: depth + 1 });
          }
        });

        if (this.config.delayMs > 0) {
          await this.delay(this.config.delayMs);
        }

      } catch (error) {
        console.error(`Error scraping ${url}:`, error);
      }
    }

    const teamId = this.extractTeamId(this.domain);
    console.log(`🏁 Scraping completed. Visited ${processedCount} pages, extracted ${this.results.length} items`);
    
    return {
      team_id: teamId,
      items: this.results
    };
  }

  private extractContent(html: string, url: string): ScrapedItem | null {
    console.log(`Extracting content from: ${url}`);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    if (!doc) {
      console.log('Failed to parse HTML');
      return null;
    }

    console.log(`HTML length: ${html.length} characters`);

    // Extract title
    const titleElement = doc.querySelector('title');
    const title = titleElement?.textContent?.trim() || 'Untitled';
    console.log(`Extracted title: ${title}`);

    // Try multiple content extraction strategies
    let content = '';
    let contentFound = false;

    // Strategy 1: Look for article or main content
    const contentSelectors = [
      'article',
      'main', 
      '[role="main"]',
      '.post-content',
      '.article-content',
      '.entry-content',
      '.blog-post',
      '.content'
    ];

    for (const selector of contentSelectors) {
      const contentElement = doc.querySelector(selector);
      if (contentElement) {
        console.log(`Found ${selector} tag`);
        content = this.cleanTextContent(contentElement.textContent || '');
        if (content.length > 200) {
          console.log(`Strategy 1 succeeded with ${content.length} characters`);
          contentFound = true;
          break;
        }
      }
    }

    // Strategy 2: Look for main tag and extract substantial content
    if (!contentFound) {
      const mainElement = doc.querySelector('main');
      if (mainElement) {
        console.log('Found main tag');
        content = this.cleanTextContent(mainElement.textContent || '');
        if (content.length > 200) {
          console.log(`Strategy 2 succeeded with ${content.length} characters`);
          contentFound = true;
        }
      }
    }

    // Strategy 3: Fall back to body but remove navigation/header/footer
    if (!contentFound) {
      console.log('All strategies failed, using body content');
      const unwantedSelectors = ['script', 'style', 'nav', 'header', 'footer', 'aside', '.ad', '.advertisement'];
      unwantedSelectors.forEach(selector => {
        const elements = doc.querySelectorAll(selector);
        elements.forEach(el => el.remove());
      });

      const bodyElement = doc.querySelector('body');
      if (bodyElement) {
        content = this.cleanTextContent(bodyElement.textContent || '');
      }
    }

    console.log(`Final content length: ${content.length} characters`);

    // Check if content is substantial
    const hasSubstantialContent = content.length > 200;
    console.log(`Has substantial content: ${hasSubstantialContent}`);

    // Additional check for expected content patterns
    const hasExpectedContent = content.toLowerCase().includes('read') || 
                              content.toLowerCase().includes('article') ||
                              content.toLowerCase().includes('blog') ||
                              content.length > 500;
    console.log(`Has expected content: ${hasExpectedContent}`);

    if (!hasSubstantialContent) {
      console.log('Content too short, skipping');
      return null;
    }

    // Extract author
    const author = this.extractAuthor(html);
    console.log(`Extracted author: ${author}`);

    // Detect content type
    const contentType = this.detectContentType(title, content, url);

    console.log('Successfully created content item');
    
    return {
      title,
      content: content.slice(0, 10000), // Limit content length
      content_type: contentType,
      source_url: url,
      author,
      user_id: author ? this.generateUserId(author) : undefined
    };
  }

  private extractLinks(html: string, baseUrl: string, depth: number): string[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links: string[] = [];

    if (!doc) return links;

    const linkElements = doc.querySelectorAll('a[href]');
    
    linkElements.forEach(link => {
      try {
        const href = link.getAttribute('href');
        if (href) {
          const absoluteUrl = new URL(href, baseUrl).href;
          
          // Only include links from same domain that look like content
          if (this.isSameDomain(absoluteUrl) && this.isContentLink(absoluteUrl, link.textContent || '')) {
            links.push(absoluteUrl);
          }
        }
      } catch {
        // Invalid URL, skip
      }
    });

    return [...new Set(links)];
  }

  private isContentLink(url: string, linkText: string): boolean {
    const lowerUrl = url.toLowerCase();
    const lowerText = linkText.toLowerCase();
    
    // Include links that look like blog posts, articles, or content
    const contentPatterns = [
      /\/blog\//,
      /\/article/,
      /\/post/,
      /\/news/,
      /\/guide/,
      /\/tutorial/,
      /\/story/,
      /\d{4}\/\d{2}/, // Date patterns like 2024/01
    ];

    const isContentUrl = contentPatterns.some(pattern => pattern.test(lowerUrl));
    
    // Also include links with content-suggesting text
    const contentTextPatterns = [
      'read more',
      'continue reading',
      'full article',
      'learn more',
      'view post',
      'read article'
    ];
    
    const isContentText = contentTextPatterns.some(pattern => lowerText.includes(pattern));
    
    return isContentUrl || isContentText;
  }

  private cleanTextContent(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
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
    let hash = 0;
    for (let i = 0; i < author.length; i++) {
      const char = author.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
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

  private extractTeamId(domain: string): string {
    return domain.replace(/^www\./, '').replace(/\./g, '_');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

serve(async (req) => {
  console.log(`Received ${req.method} request`);
  
  if (req.method === 'OPTIONS') {
    console.log('Handling CORS preflight request');
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('Processing scraping request...');
    const { config } = await req.json();
    
    console.log('Starting server-side scraping for:', config.targetUrl);
    console.log('Config:', JSON.stringify(config, null, 2));
    
    const scraper = new ServerScraper(config);
    const result = await scraper.scrape();
    
    console.log('Scraping completed successfully');
    console.log('Result:', JSON.stringify({ team_id: result.team_id, itemCount: result.items.length }, null, 2));
    
    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error('Scraping error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return new Response(JSON.stringify({ 
      error: errorMessage,
      team_id: 'error',
      items: []
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  }
});
