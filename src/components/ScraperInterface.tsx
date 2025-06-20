import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Terminal, Globe, Download, Settings, Play, Pause, RotateCcw } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { ScrapingEngine } from '../utils/ScrapingEngine';
import { ServerScraper } from '../utils/ServerScraper';
import { OutputFormatter } from '../utils/OutputFormatter';
import ScrapingModeSelector from './ScrapingModeSelector';

interface ScrapingConfig {
  targetUrl: string;
  maxPages: number;
  delayMs: number;
  outputFormat: 'json' | 'csv' | 'both';
  respectRobots: boolean;
  enableJavaScript: boolean;
  maxDepth: number;
  contentTypes: string[];
}

const ScraperInterface = () => {
  const [config, setConfig] = useState<ScrapingConfig>({
    targetUrl: '',
    maxPages: 100,
    delayMs: 1000,
    outputFormat: 'json',
    respectRobots: true,
    enableJavaScript: true,
    maxDepth: 3,
    contentTypes: ['blog', 'documentation', 'article']
  });

  const [scrapingMode, setScrapingMode] = useState<'browser' | 'server'>('server');
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentUrl, setCurrentUrl] = useState('');
  const [stats, setStats] = useState({
    pagesScraped: 0,
    linksFound: 0,
    errors: 0,
    dataExtracted: 0
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [scrapedData, setScrapedData] = useState<any[]>([]);

  const { toast } = useToast();

  const addLog = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${type.toUpperCase()}: ${message}`;
    setLogs(prev => [...prev.slice(-99), logEntry]);
    console.log(logEntry);
  };

  const updateConfig = (field: keyof ScrapingConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleNumberInput = (field: keyof ScrapingConfig, value: string) => {
    const numValue = parseInt(value);
    if (!isNaN(numValue) && numValue > 0) {
      updateConfig(field, numValue);
    } else if (value === '') {
      updateConfig(field, 0);
    }
  };

  const validateConfig = (): boolean => {
    if (!config.targetUrl) {
      toast({
        title: "Configuration Error",
        description: "Please enter a target URL",
        variant: "destructive"
      });
      return false;
    }

    try {
      new URL(config.targetUrl);
    } catch {
      toast({
        title: "Configuration Error", 
        description: "Please enter a valid URL",
        variant: "destructive"
      });
      return false;
    }

    if (config.maxPages <= 0) {
      toast({
        title: "Configuration Error",
        description: "Max pages must be greater than 0",
        variant: "destructive"
      });
      return false;
    }

    if (config.delayMs < 0) {
      toast({
        title: "Configuration Error", 
        description: "Delay must be 0 or greater",
        variant: "destructive"
      });
      return false;
    }

    return true;
  };

  const startScraping = async () => {
    if (!validateConfig()) return;

    setIsRunning(true);
    setIsPaused(false);
    setProgress(0);
    setStats({ pagesScraped: 0, linksFound: 0, errors: 0, dataExtracted: 0 });
    setScrapedData([]);
    
    addLog(`Starting ${scrapingMode} scraping for: ${config.targetUrl}`, 'info');
    addLog(`Configuration: Max ${config.maxPages} pages, ${config.delayMs}ms delay, depth ${config.maxDepth}`, 'info');

    try {
      let results;

      if (scrapingMode === 'server') {
        results = await ServerScraper.scrapeWebsite(
          config,
          (current: number, total: number, url: string) => {
            setProgress((current / total) * 100);
            setCurrentUrl(url);
            setStats(prev => ({ ...prev, pagesScraped: current }));
          },
          addLog,
          (data: any) => {
            setScrapedData(prev => [...prev, data]);
            setStats(prev => ({ ...prev, dataExtracted: prev.dataExtracted + 1 }));
          }
        );
      } else {
        // Browser mode (existing implementation)
        const engine = new ScrapingEngine(config);
        
        engine.onProgress = (current: number, total: number, url: string) => {
          setProgress((current / total) * 100);
          setCurrentUrl(url);
          setStats(prev => ({ ...prev, pagesScraped: current }));
        };

        engine.onLog = addLog;
        
        engine.onStats = (newStats: any) => {
          setStats(prev => ({ ...prev, ...newStats }));
        };

        engine.onDataExtracted = (data: any) => {
          setScrapedData(prev => [...prev, data]);
          setStats(prev => ({ ...prev, dataExtracted: prev.dataExtracted + 1 }));
        };

        results = await engine.scrape();
      }
      
      addLog(`Scraping completed! Extracted ${results.items.length} items`, 'success');
      
      // Auto-download results
      const formatter = new OutputFormatter();
      if (config.outputFormat === 'json' || config.outputFormat === 'both') {
        formatter.downloadJSON(results, `scraper-results-${Date.now()}.json`);
      }
      if (config.outputFormat === 'csv' || config.outputFormat === 'both') {
        formatter.downloadCSV(results, `scraper-results-${Date.now()}.csv`);
      }

      toast({
        title: "Scraping Complete",
        description: `Successfully scraped ${results.items.length} items from ${stats.pagesScraped} pages`,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(`Scraping failed: ${errorMessage}`, 'error');
      toast({
        title: "Scraping Failed",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsRunning(false);
      setProgress(100);
    }
  };

  const pauseResumeScraping = () => {
    setIsPaused(!isPaused);
    addLog(isPaused ? 'Resuming scraping...' : 'Pausing scraping...', 'warning');
  };

  const stopScraping = () => {
    setIsRunning(false);
    setIsPaused(false);
    addLog('Scraping stopped by user', 'warning');
  };

  const resetScraper = () => {
    setProgress(0);
    setCurrentUrl('');
    setStats({ pagesScraped: 0, linksFound: 0, errors: 0, dataExtracted: 0 });
    setLogs([]);
    setScrapedData([]);
    addLog('Scraper reset', 'info');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl">
            <Globe className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Universal Web Scraper
            </h1>
            <p className="text-slate-400">Production-grade dynamic content extraction</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Configuration Panel */}
          <div className="lg:col-span-1 space-y-6">
            {/* Scraping Mode Selector */}
            <ScrapingModeSelector 
              onModeSelect={setScrapingMode} 
              selectedMode={scrapingMode}
            />

            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Settings className="w-5 h-5" />
                  Configuration
                </CardTitle>
                <CardDescription>Configure your scraping parameters</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="url">Target URL</Label>
                  <Input
                    id="url"
                    placeholder="https://example.com"
                    value={config.targetUrl}
                    onChange={(e) => updateConfig('targetUrl', e.target.value)}
                    className="bg-slate-700 border-slate-600"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="maxPages">Max Pages</Label>
                    <Input
                      id="maxPages"
                      type="number"
                      min="1"
                      value={config.maxPages || ''}
                      onChange={(e) => handleNumberInput('maxPages', e.target.value)}
                      className="bg-slate-700 border-slate-600"
                    />
                  </div>
                  <div>
                    <Label htmlFor="delay">Delay (ms)</Label>
                    <Input
                      id="delay"
                      type="number"
                      min="0"
                      value={config.delayMs || ''}
                      onChange={(e) => handleNumberInput('delayMs', e.target.value)}
                      className="bg-slate-700 border-slate-600"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="maxDepth">Max Depth</Label>
                  <Input
                    id="maxDepth"
                    type="number"
                    min="1"
                    max="10"
                    value={config.maxDepth || ''}
                    onChange={(e) => handleNumberInput('maxDepth', e.target.value)}
                    className="bg-slate-700 border-slate-600"
                  />
                </div>

                <div>
                  <Label htmlFor="format">Output Format</Label>
                  <Select value={config.outputFormat} onValueChange={(value) => updateConfig('outputFormat', value)}>
                    <SelectTrigger className="bg-slate-700 border-slate-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="json">JSON</SelectItem>
                      <SelectItem value="csv">CSV</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="javascript">Enable JavaScript</Label>
                  <Switch
                    id="javascript"
                    checked={config.enableJavaScript}
                    onCheckedChange={(checked) => updateConfig('enableJavaScript', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="robots">Respect robots.txt</Label>
                  <Switch
                    id="robots"
                    checked={config.respectRobots}
                    onCheckedChange={(checked) => updateConfig('respectRobots', checked)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Controls */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="pt-6">
                <div className="flex gap-2">
                  {!isRunning ? (
                    <Button onClick={startScraping} className="flex-1 bg-green-600 hover:bg-green-700">
                      <Play className="w-4 h-4 mr-2" />
                      Start
                    </Button>
                  ) : (
                    <>
                      <Button onClick={pauseResumeScraping} variant="outline" className="flex-1">
                        {isPaused ? <Play className="w-4 h-4 mr-2" /> : <Pause className="w-4 h-4 mr-2" />}
                        {isPaused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button onClick={stopScraping} variant="destructive" className="flex-1">
                        Stop
                      </Button>
                    </>
                  )}
                </div>
                <Button onClick={resetScraper} variant="outline" className="w-full mt-2">
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Main Panel */}
          <div className="lg:col-span-2 space-y-6">
            {/* Progress */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white">Progress</CardTitle>
                <CardDescription>
                  {isRunning ? `Currently scraping: ${currentUrl}` : 'Ready to start scraping'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Progress value={progress} className="mb-4" />
                <div className="grid grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-blue-400">{stats.pagesScraped}</div>
                    <div className="text-sm text-slate-400">Pages Scraped</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-green-400">{stats.dataExtracted}</div>
                    <div className="text-sm text-slate-400">Items Extracted</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-yellow-400">{stats.linksFound}</div>
                    <div className="text-sm text-slate-400">Links Found</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-red-400">{stats.errors}</div>
                    <div className="text-sm text-slate-400">Errors</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Terminal Logs */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Terminal className="w-5 h-5" />
                  Live Logs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-black/50 rounded-lg p-4 h-64 overflow-y-auto font-mono text-sm">
                  {logs.length === 0 ? (
                    <div className="text-slate-500">No logs yet. Start scraping to see live updates...</div>
                  ) : (
                    logs.map((log, index) => (
                      <div key={index} className={`mb-1 ${
                        log.includes('ERROR') ? 'text-red-400' :
                        log.includes('SUCCESS') ? 'text-green-400' :
                        log.includes('WARNING') ? 'text-yellow-400' :
                        'text-slate-300'
                      }`}>
                        {log}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Results Preview */}
            {scrapedData.length > 0 && (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <Download className="w-5 h-5" />
                    Extracted Data Preview
                  </CardTitle>
                  <CardDescription>Latest {Math.min(5, scrapedData.length)} items extracted</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {scrapedData.slice(-5).map((item, index) => (
                      <div key={index} className="bg-slate-700/50 p-3 rounded border border-slate-600">
                        <div className="font-semibold text-blue-400 truncate">{item.title}</div>
                        <div className="text-sm text-slate-400 truncate">{item.source_url}</div>
                        <div className="text-xs text-slate-500 mt-1">
                          Type: {item.content_type} | Author: {item.author || 'Unknown'}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScraperInterface;
