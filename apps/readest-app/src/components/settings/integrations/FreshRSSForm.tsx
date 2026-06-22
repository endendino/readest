import clsx from 'clsx';
import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { FreshRSSClient } from '@/services/freshrss/greaderClient';
import type { FreshRSSSettings } from '@/types/settings';
import type { FreshRSSFolder, FreshRSSFeed } from '@/types/freshrss';
import SubPageHeader from '../SubPageHeader';
import { SectionTitle, SettingLabel, Tips } from '../primitives';

interface FreshRSSFormProps {
  onBack: () => void;
}

const FreshRSSForm: React.FC<FreshRSSFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const fr = settings.freshrss;
  const [serverUrl, setServerUrl] = useState(fr?.serverUrl ?? '');
  const [username, setUsername] = useState(fr?.username ?? '');
  const [apiPassword, setApiPassword] = useState(fr?.apiPassword ?? '');
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<{ folders: FreshRSSFolder[]; feeds: FreshRSSFeed[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const persist = async (next: Partial<FreshRSSSettings>) => {
    const newSettings = { ...settings, freshrss: { ...settings.freshrss, ...next } };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const handleTestAndSave = async () => {
    setIsTesting(true);
    setError(null);
    setResult(null);
    try {
      const client = new FreshRSSClient({
        serverUrl: serverUrl.trim(),
        username: username.trim(),
        apiPassword,
      });
      const { folders, feeds } = await client.listFoldersAndFeeds();
      setResult({ folders, feeds });
      await persist({ enabled: true, serverUrl: serverUrl.trim(), username: username.trim(), apiPassword });
    } catch (e) {
      setError(String(e));
      eventDispatcher.dispatch('toast', { message: _('FreshRSS connection failed'), type: 'error' });
    } finally {
      setIsTesting(false);
    }
  };

  const canTest = !!serverUrl.trim() && !!username.trim() && !!apiPassword;
  const isConfigured = !!fr?.serverUrl && !!fr?.apiPassword;
  const unreadTotal = result?.feeds.reduce((n, f) => n + f.unreadCount, 0) ?? 0;

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('FreshRSS')}
        description={_(
          'Read your FreshRSS feeds inside Readest. In FreshRSS, enable the GReader API (Settings → Profile → API access) and set an API password.',
        )}
        onBack={onBack}
      />

      <div className='space-y-5'>
        <div className='space-y-1.5'>
          <SectionTitle as='label' htmlFor='freshrss-url' className='block'>
            {_('Server URL')}
          </SectionTitle>
          <input
            id='freshrss-url'
            type='url'
            inputMode='url'
            placeholder='https://rss.example.com'
            className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
            spellCheck='false'
            autoCapitalize='off'
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
          />
        </div>

        <div className='space-y-1.5'>
          <SectionTitle as='label' htmlFor='freshrss-user' className='block'>
            {_('Username')}
          </SectionTitle>
          <input
            id='freshrss-user'
            type='text'
            className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
            spellCheck='false'
            autoCapitalize='off'
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <div className='space-y-1.5'>
          <SectionTitle as='label' htmlFor='freshrss-pass' className='block'>
            {_('API Password')}
          </SectionTitle>
          <input
            id='freshrss-pass'
            type='password'
            placeholder={_('FreshRSS API password')}
            className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
            spellCheck='false'
            value={apiPassword}
            onChange={(e) => setApiPassword(e.target.value)}
          />
        </div>

        <div className='flex justify-end'>
          <button
            type='button'
            onClick={handleTestAndSave}
            disabled={isTesting || !canTest}
            className={clsx(
              'btn btn-primary h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
              'focus-visible:ring-primary/40 focus-visible:outline-none focus-visible:ring-2',
              isTesting && 'opacity-60',
            )}
          >
            {isTesting ? (
              <span className='loading loading-spinner loading-sm' />
            ) : (
              _('Test Connection & Save')
            )}
          </button>
        </div>

        {error && (
          <div className='border-error/30 bg-error/10 text-error rounded-lg border px-4 py-3 text-sm'>
            {error}
          </div>
        )}

        {result && (
          <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
            <div className='border-base-200 border-b px-4 py-3 text-sm font-medium'>
              {_('Connected — {{folders}} folders, {{feeds}} feeds, {{unread}} unread', {
                folders: result.folders.length,
                feeds: result.feeds.length,
                unread: unreadTotal,
              })}
            </div>
            <div className='divide-base-200 max-h-64 divide-y overflow-y-auto'>
              {result.feeds.map((f) => (
                <div key={f.id} className='flex items-center justify-between gap-3 px-4 py-2 text-sm'>
                  <span className='min-w-0 truncate' dir='auto'>
                    {f.title}
                  </span>
                  <span className='text-base-content/60 flex-shrink-0'>{f.unreadCount}</span>
                </div>
              ))}
              {result.feeds.length === 0 && (
                <div className='text-base-content/60 px-4 py-3 text-sm'>
                  {_(
                    'Connected, but no feeds were returned. Check that this account has subscriptions and that the GReader API is enabled in FreshRSS.',
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {isConfigured && (
          <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
            <div className='divide-base-200 divide-y'>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Enabled')}</SettingLabel>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={fr?.enabled ?? false}
                  onChange={() => persist({ enabled: !fr?.enabled })}
                />
              </label>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Export highlights to Obsidian')}</SettingLabel>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={fr?.exportToObsidian ?? false}
                  onChange={() => persist({ exportToObsidian: !fr?.exportToObsidian })}
                />
              </label>
              <label className='flex min-h-14 items-center justify-between px-4'>
                <SettingLabel>{_('Auto-advance when RSVP finishes')}</SettingLabel>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={fr?.autoAdvanceOnRsvpEnd ?? true}
                  onChange={() => persist({ autoAdvanceOnRsvpEnd: !fr?.autoAdvanceOnRsvpEnd })}
                />
              </label>
            </div>
          </div>
        )}

        <Tips>
          <li>
            {_(
              'Articles open as temporary documents — never added to your book library or synced via WebDAV.',
            )}
          </li>
          <li>
            {_(
              'Read/unread state lives in FreshRSS, so it stays in sync across all your devices and other readers.',
            )}
          </li>
        </Tips>
      </div>
    </div>
  );
};

export default FreshRSSForm;
