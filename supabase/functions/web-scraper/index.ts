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
  private basePath: string;

  constructor(config: ScrapingConfig) {
    this.config = config;
    const url = new URL(config.targetUrl);
    this.domain = url.hostname;
    this.basePath = url.pathname;
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
        
        // Check if this is a blog listing page or an individual article
        if (this.isBlogListingPage(url)) {
          console.log(`Processing blog listing page: ${url}`);
          // Extract article links from the listing page
          const articleLinks = this.extractArticleLinks(html, url);
          console.log(`Found ${articleLinks.length} article links on listing page`);
          
          // Add article links to queue with higher priority (depth 0)
          articleLinks.forEach(link => {
            if (!this.visitedUrls.has(link)) {
              this.urlQueue.unshift({ url: link, depth: 1 }); // Use unshift to prioritize article links
              console.log(`Queued article for scraping: ${link}`);
            }
          });
          
          // Don't extract content from listing page itself
        } else {
          // This is an individual article page - extract its content
          console.log(`Processing individual article: ${url}`);
          const pageContent = this.extractContent(html, url);
          if (pageContent) {
            this.results.push(pageContent);
            console.log(`✅ Extracted article content: "${pageContent.title}"`);
          }
        }

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

  private isBlogListingPage(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    
    // Check if this looks like a blog listing page
    const listingPatterns = [
      /\/blog\/?$/,           // /blog or /blog/
      /\/blog\/page\/\d+/,    // /blog/page/1
      /\/articles\/?$/,       // /articles
      /\/posts\/?$/,          // /posts
      /\/news\/?$/            // /news
    ];
    
    return listingPatterns.some(pattern => pattern.test(lowerUrl));
  }

  private extractArticleLinks(html: string, baseUrl: string): string[] {
    console.log(`Extracting article links from: ${baseUrl}`);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links: string[] = [];

    if (!doc) return links;

    // Look for links that are likely to be individual articles
    const linkElements = doc.querySelectorAll('a[href]');
    
    linkElements.forEach(link => {
      try {
        const href = link.getAttribute('href');
        const linkText = link.textContent?.toLowerCase() || '';
        
        if (href) {
          const absoluteUrl = new URL(href, baseUrl).href;
          
          // Check if this link looks like an individual article
          if (this.isIndividualArticleLink(absoluteUrl, linkText, baseUrl)) {
            links.push(absoluteUrl);
            console.log(`Found article link: ${absoluteUrl}`);
          }
        }
      } catch {
        // Invalid URL, skip
      }
    });

    return [...new Set(links)]; // Remove duplicates
  }

  private isIndividualArticleLink(url: string, linkText: string, currentUrl: string): boolean {
    try {
      const urlObj = new URL(url);
      
      // Must be same domain
      if (urlObj.hostname !== this.domain) {
        return false;
      }

      const lowerUrl = url.toLowerCase();
      const lowerText = linkText.toLowerCase();
      
      // Patterns that indicate individual articles
      const articlePatterns = [
        /\/blog\/[^\/]+\/?$/,           // /blog/article-title
        /\/blog\/\d{4}\/\d{2}\/[^\/]+/, // /blog/2024/01/article-title
        /\/article\/[^\/]+/,            // /article/title
        /\/post\/[^\/]+/,               // /post/title
        /\/[^\/]+\/$/ // Any single path segment ending with /
      ];
      
      // Check if URL matches article patterns
      const hasArticlePattern = articlePatterns.some(pattern => pattern.test(lowerUrl));
      
      // Check for "read more" type links
      const readMoreTexts = [
        'read more',
        'continue reading',
        'full article',
        'read full',
        'learn more',
        'view post',
        'read article',
        'more details',
        'read story'
      ];
      
      const isReadMoreLink = readMoreTexts.some(text => lowerText.includes(text));
      
      // Exclude certain patterns that are not articles
      const excludePatterns = [
        /\.(jpg|jpeg|png|gif|svg|pdf)$/i,
        /\/tag\//,
        /\/category\//,
        /\/author\//,
        /\/search/,
        /\/login/,
        /\/register/,
        /\/contact/,
        /\/about/,
        /#/
      ];
      
      const shouldExclude = excludePatterns.some(pattern => pattern.test(lowerUrl));
      
      if (shouldExclude) {
        return false;
      }
      
      // Include if it has article pattern OR is a read more link
      const shouldInclude = hasArticlePattern || isReadMoreLink;
      
      if (shouldInclude) {
        console.log(`Valid article link: ${url} (pattern: ${hasArticlePattern}, readMore: ${isReadMoreLink})`);
      }
      
      return shouldInclude;
    } catch {
      return false;
    }
  }

  private extractContent(html: string, url: string): ScrapedItem | null {
    console.log(`Extracting content from: ${url}`);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    if (!doc) {
      console.log('Failed to parse HTML');
      return null;
    }

    // Extract title
    const titleElement = doc.querySelector('title');
    let title = titleElement?.textContent?.trim() || 'Untitled';
    
    // Try to get a better title from the page content
    const h1Element = doc.querySelector('h1');
    if (h1Element?.textContent?.trim()) {
      title = h1Element.textContent.trim();
    }
    
    console.log(`Extracted title: ${title}`);

    // Try multiple content extraction strategies for individual articles
    let content = '';
    let contentFound = false;

    // Strategy 1: Look for article or main content containers
    const contentSelectors = [
      'article',
      '[role="main"]',
      'main',
      '.post-content',
      '.article-content',
      '.entry-content',
      '.blog-post',
      '.content',
      '.post-body',
      '.article-body',
      '.single-post',
      '.post-single'
    ];

    for (const selector of contentSelectors) {
      const contentElement = doc.querySelector(selector);
      if (contentElement) {
        console.log(`Found content using selector: ${selector}`);
        content = this.cleanTextContent(contentElement.textContent || '');
        if (content.length > 200) {
          console.log(`Strategy 1 succeeded with ${content.length} characters`);
          contentFound = true;
          break;
        }
      }
    }

    // Strategy 2: Look for content between common markers
    if (!contentFound) {
      console.log('Trying content between markers strategy');
      
      // Remove unwanted elements first
      const unwantedSelectors = [
        'script', 'style', 'nav', 'header', 'footer', 'aside', 
        '.sidebar', '.menu', '.navigation', '.ad', '.advertisement',
        '.social-share', '.related-posts', '.comments'
      ];
      
      // Clone the document to avoid modifying the original
      const bodyClone = doc.querySelector('body')?.cloneNode(true);
      if (bodyClone) {
        unwantedSelectors.forEach(selector => {
          const elements = (bodyClone as any).querySelectorAll(selector);
          elements.forEach((el: any) => el.remove());
        });
        
        content = this.cleanTextContent(bodyClone.textContent || '');
        if (content.length > 200) {
          contentFound = true;
          console.log(`Strategy 2 succeeded with ${content.length} characters`);
        }
      }
    }

    console.log(`Final content length: ${content.length} characters`);

    // Check if content is substantial enough for an individual article
    if (content.length < 500) { // Increased threshold for individual articles
      console.log('Content too short for individual article, skipping');
      return null;
    }

    // Extract author
    const author = this.extractAuthor(html);
    console.log(`Extracted author: ${author || 'Not found'}`);

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
