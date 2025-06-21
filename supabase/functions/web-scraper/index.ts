
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
  private results: ScrapedItem[] = [];
  private domain: string;
  private baseUrl: string;

  constructor(config: ScrapingConfig) {
    this.config = config;
    this.baseUrl = config.targetUrl;
    const url = new URL(config.targetUrl);
    this.domain = url.hostname;
  }

  async scrape(): Promise<ScrapingResult> {
    console.log(`Starting blog scraping for: ${this.config.targetUrl}`);
    
    try {
      // Step 1: Scrape the main blog listing page to find article links
      console.log(`Fetching blog listing page: ${this.baseUrl}`);
      const response = await fetch(this.baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText} for ${this.baseUrl}`);
      }

      const html = await response.text();
      console.log(`Received HTML of length: ${html.length}`);
      
      // Step 2: Extract all article links from the blog listing page
      const articleLinks = this.extractArticleLinks(html, this.baseUrl);
      console.log(`Found ${articleLinks.length} article links on blog page`);
      
      if (articleLinks.length === 0) {
        console.log('No article links found on the blog page');
        return {
          team_id: this.extractTeamId(this.domain),
          items: []
        };
      }

      // Step 3: Scrape each individual article
      const maxArticles = Math.min(articleLinks.length, this.config.maxPages);
      for (let i = 0; i < maxArticles; i++) {
        const articleUrl = articleLinks[i];
        console.log(`Scraping article ${i + 1}/${maxArticles}: ${articleUrl}`);
        
        try {
          const articleContent = await this.scrapeIndividualArticle(articleUrl);
          if (articleContent) {
            this.results.push(articleContent);
            console.log(`✅ Extracted article: "${articleContent.title}"`);
          }
          
          // Add delay between requests
          if (this.config.delayMs > 0 && i < maxArticles - 1) {
            await this.delay(this.config.delayMs);
          }
        } catch (error) {
          console.error(`Error scraping article ${articleUrl}:`, error);
        }
      }

    } catch (error) {
      console.error(`Error scraping blog listing page:`, error);
    }

    const teamId = this.extractTeamId(this.domain);
    console.log(`🏁 Scraping completed. Extracted ${this.results.length} articles`);
    
    return {
      team_id: teamId,
      items: this.results
    };
  }

  private extractArticleLinks(html: string, baseUrl: string): string[] {
    console.log(`Extracting article links from blog page`);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links: string[] = [];

    if (!doc) return links;

    // Strategy 1: Look for "Read more" links specifically
    const readMoreLinks = doc.querySelectorAll('a');
    readMoreLinks.forEach(link => {
      const linkText = link.textContent?.toLowerCase().trim() || '';
      const href = link.getAttribute('href');
      
      if (href && (linkText.includes('read more') || linkText.includes('continue reading'))) {
        try {
          const absoluteUrl = new URL(href, baseUrl).href;
          if (this.isValidArticleUrl(absoluteUrl)) {
            links.push(absoluteUrl);
            console.log(`Found "Read more" link: ${absoluteUrl}`);
          }
        } catch {
          // Invalid URL, skip
        }
      }
    });

    // Strategy 2: Look for links that go to blog articles (if read more didn't work)
    if (links.length === 0) {
      console.log('No "Read more" links found, trying blog article pattern matching');
      
      const allLinks = doc.querySelectorAll('a[href]');
      allLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href) {
          try {
            const absoluteUrl = new URL(href, baseUrl).href;
            if (this.isValidArticleUrl(absoluteUrl) && this.looksLikeArticleLink(absoluteUrl, link)) {
              links.push(absoluteUrl);
              console.log(`Found article link: ${absoluteUrl}`);
            }
          } catch {
            // Invalid URL, skip
          }
        }
      });
    }

    // Remove duplicates
    const uniqueLinks = [...new Set(links)];
    console.log(`Total unique article links found: ${uniqueLinks.length}`);
    return uniqueLinks;
  }

  private isValidArticleUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      
      // Must be same domain
      if (urlObj.hostname !== this.domain) {
        return false;
      }

      // Must be different from the base blog URL
      if (url === this.baseUrl) {
        return false;
      }

      // Should contain /blog/ and have more path segments
      const lowerUrl = url.toLowerCase();
      if (lowerUrl.includes('/blog/') && lowerUrl !== this.baseUrl.toLowerCase()) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  private looksLikeArticleLink(url: string, linkElement: any): boolean {
    const lowerUrl = url.toLowerCase();
    
    // Check if URL looks like an individual article
    const articlePatterns = [
      /\/blog\/[^\/]+\/?$/,           // /blog/article-title
      /\/blog\/\d{4}\/\d{2}\/[^\/]+/, // /blog/2024/01/article-title
      /\/blog\/\w+-\w+/,              // /blog/word-word pattern
    ];
    
    const hasArticlePattern = articlePatterns.some(pattern => pattern.test(lowerUrl));
    
    // Exclude pagination and other non-article pages
    const excludePatterns = [
      /\/page\/\d+/,
      /\/category\//,
      /\/tag\//,
      /\/author\//,
      /\/archive/,
      /\.(jpg|jpeg|png|gif|svg|pdf)$/i,
    ];
    
    const shouldExclude = excludePatterns.some(pattern => pattern.test(lowerUrl));
    
    return hasArticlePattern && !shouldExclude;
  }

  private async scrapeIndividualArticle(articleUrl: string): Promise<ScrapedItem | null> {
    console.log(`Fetching individual article: ${articleUrl}`);
    
    const response = await fetch(articleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });

    if (!response.ok) {
      console.error(`HTTP ${response.status}: ${response.statusText} for ${articleUrl}`);
      return null;
    }

    const html = await response.text();
    console.log(`Received article HTML of length: ${html.length}`);
    
    return this.extractContentFromArticle(html, articleUrl);
  }

  private extractContentFromArticle(html: string, url: string): ScrapedItem | null {
    console.log(`Extracting content from article: ${url}`);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    if (!doc) {
      console.log('Failed to parse article HTML');
      return null;
    }

    // Extract title
    let title = 'Untitled';
    
    // Try multiple title extraction methods
    const h1Element = doc.querySelector('h1');
    if (h1Element?.textContent?.trim()) {
      title = h1Element.textContent.trim();
    } else {
      const titleElement = doc.querySelector('title');
      if (titleElement?.textContent?.trim()) {
        title = titleElement.textContent.trim();
      }
    }
    
    console.log(`Extracted title: ${title}`);

    // Extract article content
    let content = '';
    
    // Try multiple content extraction strategies
    const contentSelectors = [
      'article',
      '[role="main"] article',
      '.post-content',
      '.article-content',
      '.entry-content',
      '.blog-post-content',
      '.content',
      '.post-body',
      '.article-body',
      'main article',
      'main .content'
    ];

    for (const selector of contentSelectors) {
      const contentElement = doc.querySelector(selector);
      if (contentElement) {
        console.log(`Found content using selector: ${selector}`);
        content = this.cleanTextContent(contentElement.textContent || '');
        if (content.length > 200) {
          console.log(`Content extraction succeeded with ${content.length} characters`);
          break;
        }
      }
    }

    // Fallback: extract from main content area if specific selectors didn't work
    if (content.length < 200) {
      console.log('Trying fallback content extraction from main element');
      const mainElement = doc.querySelector('main');
      if (mainElement) {
        // Remove navigation, sidebar, and other non-content elements
        const elementsToRemove = mainElement.querySelectorAll('nav, aside, header, footer, .sidebar, .menu, .navigation');
        elementsToRemove.forEach(el => el.remove());
        
        content = this.cleanTextContent(mainElement.textContent || '');
        console.log(`Fallback extraction resulted in ${content.length} characters`);
      }
    }

    if (content.length < 200) {
      console.log('Content too short, skipping this article');
      return null;
    }

    // Extract author
    const author = this.extractAuthor(html);
    console.log(`Extracted author: ${author || 'Not found'}`);

    // Detect content type
    const contentType = this.detectContentType(title, content, url);

    console.log('Successfully created article content item');
    
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
    
    return 'blog';
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
    
    console.log('Starting blog scraping for:', config.targetUrl);
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
