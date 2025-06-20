
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Server, Globe, AlertTriangle, CheckCircle } from 'lucide-react';
import { ServerScraper } from '@/utils/ServerScraper';

interface ScrapingModeSelectorProps {
  onModeSelect: (mode: 'browser' | 'server') => void;
  selectedMode: 'browser' | 'server';
}

const ScrapingModeSelector: React.FC<ScrapingModeSelectorProps> = ({ onModeSelect, selectedMode }) => {
  const isServerAvailable = ServerScraper.isAvailable();

  return (
    <Card className="bg-slate-800/50 border-slate-700 mb-6">
      <CardHeader>
        <CardTitle className="text-white">Scraping Mode</CardTitle>
        <CardDescription>Choose how you want to scrape websites</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Browser Mode */}
          <div className={`p-4 rounded-lg border transition-all cursor-pointer ${
            selectedMode === 'browser' 
              ? 'border-blue-500 bg-blue-500/10' 
              : 'border-slate-600 hover:border-slate-500'
          }`} onClick={() => onModeSelect('browser')}>
            <div className="flex items-start gap-3">
              <Globe className="w-6 h-6 text-blue-400 mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-white">Browser Mode</h3>
                  <AlertTriangle className="w-4 h-4 text-yellow-400" />
                </div>
                <p className="text-sm text-slate-300 mb-3">
                  Direct browser scraping with CORS limitations
                </p>
                <div className="text-xs text-slate-400 space-y-1">
                  <div>• Limited by CORS policies</div>
                  <div>• Works with some sites</div>
                  <div>• Shows demo data if blocked</div>
                </div>
              </div>
            </div>
          </div>

          {/* Server Mode */}
          <div className={`p-4 rounded-lg border transition-all cursor-pointer ${
            selectedMode === 'server' 
              ? 'border-green-500 bg-green-500/10' 
              : 'border-slate-600 hover:border-slate-500'
          } ${!isServerAvailable ? 'opacity-50 cursor-not-allowed' : ''}`} 
          onClick={() => isServerAvailable && onModeSelect('server')}>
            <div className="flex items-start gap-3">
              <Server className="w-6 h-6 text-green-400 mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-white">Server Mode</h3>
                  {isServerAvailable ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                  )}
                </div>
                <p className="text-sm text-slate-300 mb-3">
                  {isServerAvailable 
                    ? 'Server-side scraping without CORS restrictions'
                    : 'Supabase connection established - ready to use!'
                  }
                </p>
                <div className="text-xs text-slate-400 space-y-1">
                  {isServerAvailable ? (
                    <>
                      <div>• No CORS limitations</div>
                      <div>• Can scrape any website</div>
                      <div>• Production-ready</div>
                    </>
                  ) : (
                    <>
                      <div>• Edge function deployed</div>
                      <div>• Should work now!</div>
                      <div>• Try selecting this mode</div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {!isServerAvailable && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>
                Supabase client not properly configured. Please check your connection.
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ScrapingModeSelector;
